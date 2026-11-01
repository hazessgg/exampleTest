require('dotenv').config();
const express = require('express'), mysql = require('mysql2/promise'), multer = require('multer'), bcrypt = require('bcryptjs'),
  jwt = require('jsonwebtoken'), path = require('path'), ExcelJS = require('exceljs');
const { extract, parseText } = require('./parser');
const G = require('./grader');
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

let db;
const Q = async (sql, p) => (await db.query(sql, p))[0];
const J = s => (s ? JSON.parse(s) : null);
const fail = (code, msg) => Object.assign(new Error(msg), { code });
const wrap = f => (req, res) => f(req, res).catch(e => { if (e.code > 0 && e.code < 600) return res.status(e.code).json({ error: e.message }); console.error(e); res.status(500).json({ error: e.message }); });
const auth = roles => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
    if (roles && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Không đủ quyền' });
    next();
  } catch { res.status(401).json({ error: 'Chưa đăng nhập' }); }
};
const T = auth(['teacher']), S = auth(['student']), ANY = auth();

async function initDb() {
  const cfg = { host: process.env.DB_HOST || 'localhost', user: process.env.DB_USER || 'root', password: process.env.DB_PASSWORD || '' };
  const name = process.env.DB_NAME || 'auto_exam';
  const boot = await mysql.createConnection(cfg);
  await boot.query(`CREATE DATABASE IF NOT EXISTS \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await boot.end();
  db = mysql.createPool({ ...cfg, database: name, charset: 'utf8mb4', connectionLimit: 10 });
  const tables = [
    `users(id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, email VARCHAR(190) NOT NULL UNIQUE, pass VARCHAR(100) NOT NULL, role ENUM('teacher','student') NOT NULL)`,
    `classes(id INT AUTO_INCREMENT PRIMARY KEY, teacher_id INT NOT NULL, name VARCHAR(150) NOT NULL, code VARCHAR(12) NOT NULL UNIQUE)`,
    `class_members(class_id INT NOT NULL, user_id INT NOT NULL, PRIMARY KEY(class_id,user_id))`,
    `exams(id INT AUTO_INCREMENT PRIMARY KEY, teacher_id INT NOT NULL, class_id INT NULL, title VARCHAR(200) NOT NULL, duration_min INT NOT NULL DEFAULT 45, status ENUM('draft','published') NOT NULL DEFAULT 'draft', show_result TINYINT NOT NULL DEFAULT 1, bank LONGTEXT NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
    `variants(id INT AUTO_INCREMENT PRIMARY KEY, exam_id INT NOT NULL, code VARCHAR(10) NOT NULL, hash CHAR(40) NOT NULL, data LONGTEXT NOT NULL, UNIQUE(exam_id,hash), INDEX(exam_id))`,
    `exam_raw(exam_id INT PRIMARY KEY, raw LONGTEXT)`,
    `attempts(id INT AUTO_INCREMENT PRIMARY KEY, exam_id INT NOT NULL, student_id INT NOT NULL, variant_id INT NOT NULL, started_at DATETIME NOT NULL, submitted_at DATETIME NULL, answers LONGTEXT, detail LONGTEXT, total DECIMAL(5,2) DEFAULT 0, earned DECIMAL(7,2) DEFAULT 0, max_total DECIMAL(7,2) DEFAULT 0, status ENUM('doing','grading','pending','graded') NOT NULL DEFAULT 'doing', UNIQUE(exam_id,student_id))`
  ];
  for (const t of tables) await db.query('CREATE TABLE IF NOT EXISTS ' + t + ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

/* ---------- Tài khoản ---------- */
const sign = u => jwt.sign({ id: u.id, role: u.role, name: u.name }, SECRET, { expiresIn: '12h' });
app.post('/api/register', wrap(async (req, res) => {
  const { name, email, password, role, teacherCode } = req.body;
  if (!name || !email || !password || password.length < 6) throw fail(400, 'Nhập đủ họ tên, email, mật khẩu (≥ 6 ký tự)');
  if (role === 'teacher' && teacherCode !== (process.env.TEACHER_CODE || 'GV2026')) throw fail(403, 'Mã giáo viên không đúng');
  if ((await Q('SELECT id FROM users WHERE email=?', [email])).length) throw fail(409, 'Email đã được đăng ký');
  const r = await Q('INSERT INTO users(name,email,pass,role) VALUES(?,?,?,?)', [name.trim(), email.trim().toLowerCase(), await bcrypt.hash(password, 10), role === 'teacher' ? 'teacher' : 'student']);
  const u = { id: r.insertId, name: name.trim(), role: role === 'teacher' ? 'teacher' : 'student' };
  res.json({ token: sign(u), user: u });
}));
app.post('/api/login', wrap(async (req, res) => {
  const [u] = await Q('SELECT * FROM users WHERE email=?', [String(req.body.email || '').trim().toLowerCase()]);
  if (!u || !(await bcrypt.compare(req.body.password || '', u.pass))) throw fail(401, 'Sai email hoặc mật khẩu');
  res.json({ token: sign(u), user: { id: u.id, name: u.name, role: u.role } });
}));

/* ---------- Lớp học ---------- */
app.get('/api/classes', ANY, wrap(async (req, res) => {
  res.json(req.user.role === 'teacher'
    ? await Q('SELECT c.*,(SELECT COUNT(*) FROM class_members m WHERE m.class_id=c.id) members FROM classes c WHERE teacher_id=? ORDER BY id DESC', [req.user.id])
    : await Q('SELECT c.id,c.name FROM classes c JOIN class_members m ON m.class_id=c.id WHERE m.user_id=?', [req.user.id]));
}));
app.post('/api/classes', T, wrap(async (req, res) => {
  if (!req.body.name) throw fail(400, 'Nhập tên lớp');
  for (let i = 0; i < 5; i++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    try { const r = await Q('INSERT INTO classes(teacher_id,name,code) VALUES(?,?,?)', [req.user.id, req.body.name, code]); return res.json({ id: r.insertId, code }); } catch (e) { if (e.code !== 'ER_DUP_ENTRY') throw e; }
  }
  throw fail(500, 'Không tạo được mã lớp');
}));
app.get('/api/classes/:id/members', T, wrap(async (req, res) => {
  res.json(await Q('SELECT u.id,u.name,u.email FROM users u JOIN class_members m ON m.user_id=u.id JOIN classes c ON c.id=m.class_id WHERE c.id=? AND c.teacher_id=? ORDER BY u.name', [req.params.id, req.user.id]));
}));
app.delete('/api/classes/:id/members/:uid', T, wrap(async (req, res) => {
  await Q('DELETE m FROM class_members m JOIN classes c ON c.id=m.class_id WHERE c.id=? AND c.teacher_id=? AND m.user_id=?', [req.params.id, req.user.id, req.params.uid]);
  res.json({ ok: true });
}));
app.post('/api/join', S, wrap(async (req, res) => {
  const [c] = await Q('SELECT id,name FROM classes WHERE code=?', [String(req.body.code || '').trim().toUpperCase()]);
  if (!c) throw fail(404, 'Mã lớp không tồn tại');
  await Q('INSERT IGNORE INTO class_members VALUES(?,?)', [c.id, req.user.id]);
  res.json(c);
}));

/* ---------- Đề thi ---------- */
async function myExam(id, user) {
  const [e] = await Q('SELECT * FROM exams WHERE id=? AND teacher_id=?', [id, user.id]);
  if (!e) throw fail(404, 'Không tìm thấy đề');
  return e;
}
const examOut = e => ({ id: e.id, title: e.title, duration_min: e.duration_min, status: e.status, class_id: e.class_id, show_result: e.show_result });

app.get('/api/exams', ANY, wrap(async (req, res) => {
  if (req.user.role === 'teacher') return res.json(await Q(`SELECT e.id,e.title,e.duration_min,e.status,e.class_id,c.name class_name,
    (SELECT COUNT(*) FROM variants v WHERE v.exam_id=e.id) variants,(SELECT COUNT(*) FROM attempts a WHERE a.exam_id=e.id AND a.submitted_at IS NOT NULL) submitted
    FROM exams e LEFT JOIN classes c ON c.id=e.class_id WHERE e.teacher_id=? ORDER BY e.id DESC`, [req.user.id]));
  res.json(await Q(`SELECT e.id,e.title,e.duration_min,c.name class_name,a.id attempt_id,a.status,a.submitted_at,a.total
    FROM exams e JOIN class_members m ON m.class_id=e.class_id AND m.user_id=? LEFT JOIN classes c ON c.id=e.class_id
    LEFT JOIN attempts a ON a.exam_id=e.id AND a.student_id=? WHERE e.status='published' ORDER BY e.id DESC`, [req.user.id, req.user.id]));
}));

app.post('/api/exams/upload', T, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw fail(400, 'Chưa chọn file');
  req.file.originalname = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
  const raw = await extract(req.file), bank = parseText(raw);
  if (!bank.length) throw fail(422, 'Không nhận diện được câu hỏi nào. Đề cần bắt đầu mỗi câu bằng "Câu 1.", "Câu 2."… Nếu là PDF scan ảnh, hãy dùng bản DOCX/PDF có chữ.');
  let ai = null;
  if (process.env.AI_KEY && bank.some(G.missing)) { try { ai = await G.aiFillAnswers(bank, raw, false); } catch (err) { console.error('AI fill', err.message); } } // tầng 1 chạy tự động
  const r = await Q('INSERT INTO exams(teacher_id,class_id,title,duration_min,bank) VALUES(?,?,?,?,?)', [req.user.id, req.body.class_id || null, req.body.title || req.file.originalname.replace(/\.\w+$/, ''), +req.body.duration || 45, JSON.stringify(bank)]);
  await Q('INSERT INTO exam_raw VALUES(?,?)', [r.insertId, raw.slice(0, 500000)]);
  res.json({ id: r.insertId, count: bank.length, aiFound: ai?.found || 0 });
}));

app.get('/api/exams/:id', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user);
  res.json({ ...examOut(e), bank: J(e.bank), variants: await Q('SELECT id,code FROM variants WHERE exam_id=? ORDER BY code', [e.id]) });
}));
app.put('/api/exams/:id', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user), b = req.body;
  const newBank = b.bank ? JSON.stringify(b.bank) : e.bank, changed = newBank !== e.bank; // chỉ coi là "sửa đề" khi nội dung đề thật sự đổi
  if (changed && (await Q('SELECT 1 FROM attempts WHERE exam_id=? LIMIT 1', [e.id])).length) throw fail(409, 'Đã có học sinh làm bài, không thể sửa nội dung đề');
  if (changed) await Q('DELETE FROM variants WHERE exam_id=?', [e.id]); // sửa đề => phải sinh lại mã đề
  await Q('UPDATE exams SET title=?,duration_min=?,class_id=?,show_result=?,bank=? WHERE id=?', [b.title ?? e.title, +b.duration_min || e.duration_min, b.class_id === undefined ? e.class_id : b.class_id || null, b.show_result ?? e.show_result, newBank, e.id]);
  res.json({ ok: true, variantsReset: changed });
}));
app.delete('/api/exams/:id', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user);
  await Q('DELETE FROM attempts WHERE exam_id=?', [e.id]); await Q('DELETE FROM variants WHERE exam_id=?', [e.id]); await Q('DELETE FROM exam_raw WHERE exam_id=?', [e.id]); await Q('DELETE FROM exams WHERE id=?', [e.id]);
  res.json({ ok: true });
}));

function validateBank(bank) {
  const errs = [];
  bank.forEach((q, i) => {
    if (q.type === 'mcq' && q.answer == null) errs.push(`Câu ${i + 1}: chưa có đáp án`);
    if (q.type === 'tf' && !q.tfAnswers) errs.push(`Câu ${i + 1}: chưa có đáp án Đúng/Sai`);
    if (q.type === 'short' && !String(q.answer || '').trim()) errs.push(`Câu ${i + 1}: chưa có đáp án`);
  });
  return errs;
}
app.post('/api/exams/:id/variants', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user);
  if ((await Q('SELECT 1 FROM attempts WHERE exam_id=? LIMIT 1', [e.id])).length) throw fail(409, 'Đã có học sinh làm bài, không thể sinh lại mã đề');
  const bank = J(e.bank), errs = validateBank(bank);
  if (errs.length) throw fail(422, errs.slice(0, 5).join('; '));
  const count = Math.min(Math.max(+req.body.count || 4, 1), 100), vs = G.makeVariants(bank, count);
  await Q('DELETE FROM variants WHERE exam_id=?', [e.id]);
  for (const v of vs) await Q('INSERT INTO variants(exam_id,code,hash,data) VALUES(?,?,?,?)', [e.id, v.code, v.hash, JSON.stringify({ items: v.items })]);
  res.json({ created: vs.length, requested: count, note: vs.length < count ? 'Đề quá ít câu nên chỉ tạo được ' + vs.length + ' mã khác nhau hoàn toàn' : null });
}));
app.post('/api/exams/:id/ai-rubric', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user), bank = J(e.bank);
  if (!process.env.AI_KEY) throw fail(400, 'Chưa cấu hình AI_KEY trong file .env');
  let n = 0;
  for (const q of bank) if (q.type === 'essay' && !q.rubric?.length) { const r = await G.genRubricAI(q); if (r) { q.rubric = r; q.warn = (q.warn || []).filter(w => !/thang điểm/.test(w)); n++; } }
  await Q('UPDATE exams SET bank=? WHERE id=?', [JSON.stringify(bank), e.id]);
  res.json({ updated: n, bank });
}));
app.post('/api/exams/:id/ai-answers', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user), bank = J(e.bank);
  if (!process.env.AI_KEY) throw fail(400, 'Chưa cấu hình AI_KEY trong file .env');
  if ((await Q('SELECT 1 FROM attempts WHERE exam_id=? LIMIT 1', [e.id])).length) throw fail(409, 'Đã có học sinh làm bài, không thể sửa đề');
  const [r] = await Q('SELECT raw FROM exam_raw WHERE exam_id=?', [e.id]);
  const out = await G.aiFillAnswers(bank, r?.raw, true);
  await Q('UPDATE exams SET bank=? WHERE id=?', [JSON.stringify(bank), e.id]);
  await Q('DELETE FROM variants WHERE exam_id=?', [e.id]);
  res.json(out);
}));
app.post('/api/exams/:id/ai-format', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user);
  if (!process.env.AI_KEY) throw fail(400, 'Chưa cấu hình AI_KEY trong file .env');
  res.json({ changes: await G.aiFormat(J(e.bank)) }); // chỉ đề xuất, chưa lưu gì
}));
app.post('/api/exams/:id/publish', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user), pub = !!req.body.publish;
  if (pub) {
    const unconfirmed = J(e.bank).filter(q => q.aiGuess).length;
    if (unconfirmed) throw fail(422, unconfirmed + ' câu có đáp án do AI đề xuất chưa được xác nhận. Hãy kiểm tra và bấm "Xác nhận" ở từng câu');
    if (!e.class_id) throw fail(400, 'Hãy chọn lớp cho đề thi trước khi công bố');
    if (!(await Q('SELECT 1 FROM variants WHERE exam_id=? LIMIT 1', [e.id])).length) throw fail(400, 'Chưa có mã đề. Hãy tạo mã đề trước');
  }
  await Q('UPDATE exams SET status=? WHERE id=?', [pub ? 'published' : 'draft', e.id]);
  res.json({ ok: true });
}));

/* ---------- Làm bài ---------- */
const REMAIN = 'TIMESTAMPDIFF(SECOND,NOW(),DATE_ADD(a.started_at,INTERVAL e.duration_min MINUTE))';
async function sweep(examId) {
  const rows = await Q(`SELECT a.id FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.exam_id=? AND a.submitted_at IS NULL AND ${REMAIN}<-30`, [examId]);
  for (const r of rows) await finish(r.id);
}
app.post('/api/exams/:id/start', S, wrap(async (req, res) => {
  const [e] = await Q(`SELECT e.* FROM exams e JOIN class_members m ON m.class_id=e.class_id AND m.user_id=? WHERE e.id=? AND e.status='published'`, [req.user.id, req.params.id]);
  if (!e) throw fail(404, 'Đề thi không tồn tại hoặc bạn không thuộc lớp');
  let [a] = await Q('SELECT * FROM attempts WHERE exam_id=? AND student_id=?', [e.id, req.user.id]);
  if (a?.submitted_at) throw fail(409, 'Bạn đã nộp bài này rồi');
  if (!a) {
    const [v] = await Q('SELECT v.id FROM variants v WHERE v.exam_id=? ORDER BY (SELECT COUNT(*) FROM attempts x WHERE x.variant_id=v.id), RAND() LIMIT 1', [e.id]); // chia đều mã đề
    try { await Q('INSERT INTO attempts(exam_id,student_id,variant_id,started_at,answers) VALUES(?,?,?,NOW(),?)', [e.id, req.user.id, v.id, '{}']); } catch (x) { if (x.code !== 'ER_DUP_ENTRY') throw x; }
    [a] = await Q('SELECT * FROM attempts WHERE exam_id=? AND student_id=?', [e.id, req.user.id]);
  }
  const [{ remain }] = await Q(`SELECT ${REMAIN} remain FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?`, [a.id]);
  if (remain <= 0) { await finish(a.id); throw fail(409, 'Đã hết giờ làm bài'); }
  const [v] = await Q('SELECT code,data FROM variants WHERE id=?', [a.variant_id]);
  res.json({ attempt_id: a.id, remain, title: e.title, code: v.code, paper: G.buildPaper(J(e.bank), J(v.data)), answers: J(a.answers) || {} });
}));
async function myAttempt(id, uid) {
  const [a] = await Q(`SELECT a.*,${REMAIN} remain FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND a.student_id=?`, [id, uid]);
  if (!a) throw fail(404, 'Không tìm thấy bài làm');
  if (a.submitted_at) throw fail(409, 'Bài đã nộp');
  return a;
}
app.put('/api/attempts/:id/save', S, wrap(async (req, res) => {
  const a = await myAttempt(req.params.id, req.user.id);
  if (a.remain < -30) { await finish(a.id); throw fail(409, 'Đã hết giờ, bài được nộp tự động'); }
  await Q('UPDATE attempts SET answers=? WHERE id=?', [JSON.stringify(req.body.answers || {}), a.id]);
  res.json({ ok: true, remain: a.remain });
}));
app.post('/api/attempts/:id/submit', S, wrap(async (req, res) => {
  const a = await myAttempt(req.params.id, req.user.id);
  if (a.remain >= -30 && req.body.answers) await Q('UPDATE attempts SET answers=? WHERE id=?', [JSON.stringify(req.body.answers), a.id]);
  await finish(a.id);
  res.json({ ok: true });
}));

async function loadCtx(attemptId) {
  const [a] = await Q('SELECT * FROM attempts WHERE id=?', [attemptId]);
  const [e] = await Q('SELECT * FROM exams WHERE id=?', [a.exam_id]);
  const [v] = await Q('SELECT data,code FROM variants WHERE id=?', [a.variant_id]);
  return { a, e, bank: J(e.bank), v: J(v.data), code: v.code, ans: J(a.answers) || {}, items: J(a.detail) };
}
async function saveItems(id, items, submit) {
  const s = G.summarize(items);
  await Q(`UPDATE attempts SET detail=?,total=?,earned=?,max_total=?,status=? ${submit ? ',submitted_at=NOW()' : ''} WHERE id=?`, [JSON.stringify(items), s.total, s.earned, s.max, s.pending ? 'grading' : 'graded', id]);
}
async function finish(id) {
  const [chk] = await Q('SELECT id FROM attempts WHERE id=? AND submitted_at IS NULL', [id]);
  if (!chk) return;
  const c = await loadCtx(id);
  await saveItems(id, G.gradeObjective(c.bank, c.v, c.ans), true);
  aiGrade(id).catch(err => console.error('AI grade', id, err.message));
}
async function aiGrade(id, force) {
  const c = await loadCtx(id);
  for (const it of c.items) {
    if (it.type !== 'essay' || (!force && it.earned != null) || it.manual) continue;
    const q = c.bank[it.qi], text = String(c.ans[it.pos] ?? '').trim();
    if (!text) { it.earned = 0; it.feedback = 'Chưa làm bài'; it.criteria = (q.rubric || []).map(r => ({ text: r.text, max: r.points, score: 0, comment: '' })); continue; }
    try { const r = await G.gradeEssayAI(q, text); if (r) Object.assign(it, r, { ai: true }); } catch (err) { console.error('AI essay', err.message); }
  }
  await saveItems(id, c.items, false);
  await Q("UPDATE attempts SET status='pending' WHERE id=? AND status='grading'", [id]); // còn câu chưa chấm => chờ giáo viên
}

/* ---------- Xem bài / chấm tay ---------- */
function review(c, showKey) {
  return c.items.map(it => {
    const q = c.bank[it.qi], vi = c.v.items[it.pos], a = c.ans[it.pos], o = { ...it, text: q.text, answer: a ?? null };
    if (q.type === 'mcq') { o.options = vi.o.map(i => q.options[i]); if (showKey) o.correct = vi.o.indexOf(q.answer); }
    if (q.type === 'tf') { o.statements = vi.s.map(i => q.statements[i]); if (showKey) o.correct = vi.s.map(i => q.tfAnswers[i]); }
    if (q.type === 'short' && showKey) o.correct = q.answer;
    if (q.type === 'essay' && showKey) { o.sample = q.sample; o.rubric = q.rubric; }
    return o;
  });
}
app.get('/api/attempts/:id', ANY, wrap(async (req, res) => {
  const [a0] = await Q('SELECT a.student_id,e.teacher_id,e.show_result,a.submitted_at FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=?', [req.params.id]);
  if (!a0) throw fail(404, 'Không tìm thấy');
  const teacher = req.user.role === 'teacher' && a0.teacher_id === req.user.id;
  if (!teacher && a0.student_id !== req.user.id) throw fail(403, 'Không có quyền xem');
  if (!a0.submitted_at) throw fail(409, 'Bài chưa nộp');
  const c = await loadCtx(req.params.id), [u] = await Q('SELECT name,email FROM users WHERE id=?', [c.a.student_id]);
  const base = { id: c.a.id, exam: c.e.title, code: c.code, student: u, status: c.a.status, total: c.a.total, earned: c.a.earned, max: c.a.max_total, submitted_at: c.a.submitted_at, teacher };
  if (!teacher && !c.e.show_result) return res.json({ ...base, hidden: true });
  res.json({ ...base, items: review(c, true) });
}));
app.put('/api/attempts/:id/essay', T, wrap(async (req, res) => {
  const [a0] = await Q('SELECT a.id FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND e.teacher_id=? AND a.submitted_at IS NOT NULL', [req.params.id, req.user.id]);
  if (!a0) throw fail(404, 'Không tìm thấy bài');
  const c = await loadCtx(a0.id), it = c.items.find(i => i.pos === +req.body.pos && i.type === 'essay');
  if (!it) throw fail(400, 'Không phải câu tự luận');
  const q = c.bank[it.qi], rub = q.rubric?.length ? q.rubric : [{ text: 'Điểm câu', points: q.points }];
  it.criteria = rub.map((r, i) => ({ text: r.text, max: r.points, score: G.round(G.clamp(req.body.scores?.[i], 0, r.points)), comment: it.criteria?.[i]?.comment || '' }));
  it.earned = G.round(it.criteria.reduce((s, x) => s + x.score, 0)); it.manual = true; it.ai = false;
  if (req.body.feedback != null) it.feedback = String(req.body.feedback).slice(0, 800);
  await saveItems(a0.id, c.items, false);
  res.json({ ok: true, earned: it.earned });
}));
app.post('/api/attempts/:id/regrade', T, wrap(async (req, res) => {
  const [a0] = await Q('SELECT a.id FROM attempts a JOIN exams e ON e.id=a.exam_id WHERE a.id=? AND e.teacher_id=? AND a.submitted_at IS NOT NULL', [req.params.id, req.user.id]);
  if (!a0) throw fail(404, 'Không tìm thấy bài');
  if (!process.env.AI_KEY) throw fail(400, 'Chưa cấu hình AI_KEY');
  await aiGrade(a0.id, true);
  res.json({ ok: true });
}));

/* ---------- Kết quả, thống kê, Excel ---------- */
async function results(examId) {
  await sweep(examId);
  const rows = await Q(`SELECT a.id,a.status,a.total,a.earned,a.max_total,a.submitted_at,a.detail,u.name,u.email,v.code FROM attempts a JOIN users u ON u.id=a.student_id JOIN variants v ON v.id=a.variant_id WHERE a.exam_id=? ORDER BY u.name`, [examId]);
  return rows.map(r => ({ ...r, items: J(r.detail) || [] }));
}
function stats(rows, bank, enrolled) {
  const done = rows.filter(r => r.submitted_at), t = done.map(r => +r.total);
  const dist = Array(5).fill(0); t.forEach(x => dist[Math.min(4, Math.floor(x / 2))]++);
  return {
    enrolled, submitted: done.length, avg: t.length ? G.round(t.reduce((a, b) => a + b, 0) / t.length) : null, max: t.length ? Math.max(...t) : null, min: t.length ? Math.min(...t) : null,
    dist: ['0–<2', '2–<4', '4–<6', '6–<8', '8–10'].map((l, i) => ({ label: l, n: dist[i] })),
    questions: bank.map((q, i) => { const e = done.flatMap(r => r.items.filter(x => x.qi === i && x.earned != null)); return { n: i + 1, type: q.type, rate: e.length ? G.round(e.reduce((s, x) => s + x.earned / x.max, 0) / e.length) : null }; })
  };
}
app.get('/api/exams/:id/results', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user), rows = await results(e.id);
  const [{ n }] = await Q('SELECT COUNT(*) n FROM class_members WHERE class_id=?', [e.class_id || 0]);
  res.json({ title: e.title, stats: stats(rows, J(e.bank), n), attempts: rows.map(({ items, detail, ...r }) => r) });
}));
app.get('/api/exams/:id/export', T, wrap(async (req, res) => {
  const e = await myExam(req.params.id, req.user), bank = J(e.bank), rows = await results(e.id), st = stats(rows, bank, 0);
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Kết quả');
  ws.columns = [{ header: 'STT', width: 6 }, { header: 'Họ tên', width: 26 }, { header: 'Email', width: 28 }, { header: 'Mã đề', width: 8 }, { header: 'Điểm (thang 10)', width: 15 }, { header: 'Điểm thô', width: 10 }, { header: 'Tối đa', width: 9 }, { header: 'Trạng thái', width: 14 }, { header: 'Nộp lúc', width: 20 }, ...bank.map((_, i) => ({ header: 'Câu ' + (i + 1), width: 8 }))];
  const ST = { doing: 'Đang làm', grading: 'Đang chấm', pending: 'Chờ GV chấm', graded: 'Đã chấm' };
  rows.forEach((r, i) => ws.addRow([i + 1, r.name, r.email, r.code, r.submitted_at ? +r.total : null, +r.earned, +r.max_total, ST[r.status], r.submitted_at, ...bank.map((_, k) => r.items.find(x => x.qi === k)?.earned ?? null)]));
  ws.getRow(1).font = { bold: true };
  const w2 = wb.addWorksheet('Thống kê');
  [['Đã nộp', st.submitted], ['Điểm trung bình', st.avg], ['Cao nhất', st.max], ['Thấp nhất', st.min], [], ['Phổ điểm'], ...st.dist.map(d => [d.label, d.n]), [], ['Câu', 'Loại', 'Tỉ lệ đạt (0-1)'], ...st.questions.map(q => [q.n, q.type, q.rate])].forEach(r => w2.addRow(r));
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(e.title + '.xlsx'));
  await wb.xlsx.write(res); res.end();
}));

initDb().then(() => app.listen(process.env.PORT || 3000, () => console.log('Auto-exam chạy tại http://localhost:' + (process.env.PORT || 3000)))).catch(e => { console.error('Không kết nối được MySQL:', e.message); process.exit(1); });
