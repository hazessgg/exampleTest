const $ = (s, r = document) => r.querySelector(s);
const h = (tag, props, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled') e[k] = v;
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(9)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
let TOKEN = localStorage.token, USER = JSON.parse(localStorage.user || 'null'), TIMER = null, SAVER = null;
const toast = m => { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(toast.t); toast.t = setTimeout(() => t.style.display = 'none', 3500); };
const logout = () => { localStorage.clear(); TOKEN = USER = null; location.hash = ''; render(); };
async function api(url, o = {}) {
  const fd = o.body instanceof FormData;
  const r = await fetch('/api' + url, { method: o.method || 'GET', headers: { ...(o.body && !fd ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + TOKEN }, body: fd ? o.body : o.body && JSON.stringify(o.body) });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && TOKEN) { logout(); throw new Error('Phiên đăng nhập đã hết hạn'); }
  if (!r.ok) throw new Error(d.error || 'Lỗi ' + r.status);
  return d;
}
const act = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } catch (e) { toast(e.message); } btn.disabled = false; };
const btn = (label, fn, cls = '') => { const b = h('button', { class: cls }, label); b.onclick = act(b, fn); return b; };
const typeset = () => window.MathJax?.typesetPromise?.().catch(() => {});
const fmt = d => d ? new Date(d).toLocaleString('vi-VN') : '—';
const TYPE = { mcq: 'Trắc nghiệm', tf: 'Đúng/Sai', short: 'Trả lời ngắn', essay: 'Tự luận' };
const STATUS = { doing: ['Đang làm', 'warn'], grading: ['Đang chấm', 'warn'], pending: ['Chờ GV chấm', 'warn'], graded: ['Đã chấm', 'ok'] };
const sb = s => { const [t, c] = STATUS[s] || ['', '']; return h('span', { class: 'badge ' + c }, t); };

function shell(...content) {
  clearInterval(TIMER); clearInterval(SAVER);
  const app = $('#app'); app.replaceChildren();
  if (USER) app.append(h('header', { class: 'top' }, h('b', { }, h('a', { href: '#/' }, 'Phòng thi trực tuyến')), h('span', { class: 'sp' }), h('span', { class: 'mute' }, USER.name + ' · ' + (USER.role === 'teacher' ? 'Giáo viên' : 'Học sinh')), h('button', { class: 'ghost', onclick: logout }, 'Đăng xuất')));
  app.append(h('main', {}, content));
  typeset();
}

/* ---------- Đăng nhập ---------- */
function authView() {
  let mode = 'login';
  const draw = () => {
    const f = { name: h('input', { placeholder: 'Họ và tên' }), email: h('input', { type: 'email', placeholder: 'Email' }), pw: h('input', { type: 'password', placeholder: 'Mật khẩu (≥ 6 ký tự)' }),
      role: h('select', {}, h('option', { value: 'student' }, 'Tôi là học sinh'), h('option', { value: 'teacher' }, 'Tôi là giáo viên')), code: h('input', { placeholder: 'Mã giáo viên' }) };
    f.code.style.display = 'none'; f.role.onchange = () => f.code.style.display = f.role.value === 'teacher' ? '' : 'none';
    const go = btn(mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản', async () => {
      const d = await api(mode === 'login' ? '/login' : '/register', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.pw.value, role: f.role.value, teacherCode: f.code.value } });
      TOKEN = d.token; USER = d.user; localStorage.token = TOKEN; localStorage.user = JSON.stringify(USER); location.hash = '#/'; render();
    });
    f.pw.onkeydown = e => { if (e.key === 'Enter') go.click(); };
    $('#app').replaceChildren(h('div', { class: 'auth' }, h('h1', {}, 'Phòng thi trực tuyến'), h('div', { class: 'tabs' },
      h('button', { class: mode === 'login' ? '' : 'ghost', onclick: () => { mode = 'login'; draw(); } }, 'Đăng nhập'), h('button', { class: mode === 'reg' ? '' : 'ghost', onclick: () => { mode = 'reg'; draw(); } }, 'Đăng ký')),
      h('div', { class: 'card' }, mode === 'reg' && [f.name, f.role, f.code], f.email, f.pw, go)));
  };
  draw();
}

/* ---------- Giáo viên: tổng quan ---------- */
async function teacherHome() {
  const [classes, exams] = await Promise.all([api('/classes'), api('/exams')]);
  const name = h('input', { placeholder: 'Tên lớp, ví dụ: 11A1' });
  const file = h('input', { type: 'file', accept: '.docx,.pdf,.txt' }), title = h('input', { placeholder: 'Tên bài kiểm tra (để trống = tên file)', style: 'min-width:260px' }), dur = h('input', { type: 'number', value: 45, style: 'width:80px' });
  const cls = h('select', {}, h('option', { value: '' }, '— Chọn lớp —'), classes.map(c => h('option', { value: c.id }, c.name)));
  const members = h('div');
  shell(h('h1', {}, 'Tổng quan'),
    h('h2', {}, 'Tải đề lên'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, file, title, h('span', {}, 'Thời gian ', dur, ' phút'), cls,
      btn('Đọc đề & tạo bài', async () => {
        if (!file.files[0]) throw new Error('Chọn file DOCX/PDF trước');
        const fd = new FormData(); fd.append('file', file.files[0]); fd.append('title', title.value); fd.append('duration', dur.value); fd.append('class_id', cls.value);
        const r = await api('/exams/upload', { method: 'POST', body: fd }); toast('Đã đọc ' + r.count + ' câu'); location.hash = '#/exam/' + r.id;
      })), h('p', { class: 'mute' }, 'Mỗi câu bắt đầu bằng "Câu 1.", đáp án ghi "Đáp án: B", điểm "Điểm: 0.25", thang điểm tự luận "Ý 1: Viết đúng công thức 0.25đ". Sau khi đọc, bạn kiểm tra lại từng câu trước khi công bố.')),
    h('h2', {}, 'Đề thi'),
    exams.length ? h('div', { class: 'card' }, h('table', {}, h('tr', {}, ['Bài kiểm tra', 'Lớp', 'Mã đề', 'Đã nộp', 'Trạng thái', ''].map(x => h('th', {}, x))),
      exams.map(e => h('tr', {}, h('td', {}, h('a', { href: '#/exam/' + e.id }, e.title)), h('td', {}, e.class_name || '—'), h('td', {}, e.variants), h('td', {}, e.submitted),
        h('td', {}, h('span', { class: 'badge ' + (e.status === 'published' ? 'ok' : 'warn') }, e.status === 'published' ? 'Đang mở' : 'Nháp')), h('td', {}, h('a', { href: '#/results/' + e.id }, 'Kết quả')))))) : h('p', { class: 'mute' }, 'Chưa có đề nào. Hãy tải một file đề lên.'),
    h('h2', {}, 'Lớp học'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, name, btn('Tạo lớp', async () => { await api('/classes', { method: 'POST', body: { name: name.value } }); teacherHome(); }))),
    classes.map(c => h('div', { class: 'card' }, h('div', { class: 'row' }, h('div', { class: 'grow' }, h('h3', {}, c.name), h('span', { class: 'mute' }, c.members + ' học sinh · mã tham gia: '), h('b', {}, c.code)),
      btn('Danh sách', async () => {
        const m = await api('/classes/' + c.id + '/members');
        members.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'Học sinh lớp ' + c.name), m.length ? h('table', {}, m.map(u => h('tr', {}, h('td', {}, u.name), h('td', { class: 'mute' }, u.email), h('td', {}, btn('Xoá', async () => { await api('/classes/' + c.id + '/members/' + u.id, { method: 'DELETE' }); toast('Đã xoá'); }, 'danger'))))) : h('p', { class: 'mute' }, 'Chưa có học sinh. Gửi mã lớp cho học sinh để tham gia.')));
      }, 'ghost')))), members);
}

/* ---------- Giáo viên: soát & chỉnh đề ---------- */
async function examEditor(id) {
  const [e, classes] = await Promise.all([api('/exams/' + id), api('/classes')]);
  const bank = e.bank, T = h('input', { value: e.title, style: 'min-width:280px' }), D = h('input', { type: 'number', value: e.duration_min, style: 'width:80px' });
  const C = h('select', {}, h('option', { value: '' }, '— Chọn lớp —'), classes.map(c => h('option', { value: c.id, selected: c.id === e.class_id }, c.name)));
  const SR = h('input', { type: 'checkbox', checked: !!e.show_result });
  const N = h('input', { type: 'number', value: Math.max(e.variants.length, 4), min: 1, max: 100, style: 'width:80px' });
  const save = async () => { const r = await api('/exams/' + id, { method: 'PUT', body: { title: T.value, duration_min: D.value, class_id: C.value || null, show_result: SR.checked ? 1 : 0, bank } }); toast('Đã lưu' + (r.variantsReset ? ' — hãy tạo lại mã đề' : '')); return r; };
  const warns = bank.filter(q => q.warn?.length).length;
  const qcards = bank.map((q, i) => {
    const pts = h('input', { type: 'number', step: '0.05', value: q.points, style: 'width:80px', oninput: ev => q.points = +ev.target.value });
    let ctl;
    const prev = h('div', { class: 'qtext', style: 'color:var(--mute)' }, q.text.includes('$') ? 'Xem trước: ' + q.text : '');
    const touch = () => { if (q.aiGuess) { q.aiGuess = false; q.warn = (q.warn || []).filter(w => !/AI đề xuất/.test(w)); } };
    if (q.type === 'mcq') ctl = h('div', { class: 'row' }, 'Đáp án đúng:', h('select', { onchange: ev => { touch(); q.answer = ev.target.value === '' ? null : +ev.target.value; } }, h('option', { value: '' }, '— chưa có —'), q.options.map((_, k) => h('option', { value: k, selected: q.answer === k }, String.fromCharCode(65 + k)))));
    else if (q.type === 'tf') ctl = h('div', { class: 'row' }, 'Đáp án các ý (Đ/S):', h('input', { value: (q.tfAnswers || []).map(x => x ? 'Đ' : 'S').join(''), placeholder: 'ĐSĐS', onchange: ev => { touch(); const t = [...ev.target.value.toUpperCase()].filter(c => 'ĐSTF'.includes(c)).map(c => 'ĐT'.includes(c)); q.tfAnswers = t.length === q.statements.length ? t : null; ev.target.style.borderColor = q.tfAnswers ? '' : 'var(--bad)'; } }));
    else if (q.type === 'short') ctl = h('div', { class: 'row' }, 'Đáp án:', h('input', { value: q.answer || '', onchange: ev => { touch(); q.answer = ev.target.value; } }), 'Sai số cho phép:', h('input', { type: 'number', step: 'any', value: q.tol || 0, style: 'width:90px', onchange: ev => q.tol = +ev.target.value }), h('span', { class: 'mute' }, 'Nhiều đáp án chấp nhận: ngăn bằng ;'));
    else ctl = h('div', {}, h('div', { class: 'mute' }, 'Đáp án / hướng dẫn mẫu:'), h('textarea', { onchange: ev => q.sample = ev.target.value }, q.sample || ''),
      h('div', { class: 'mute' }, 'Thang điểm từng ý (mỗi dòng: nội dung | điểm):'), h('textarea', { placeholder: 'Viết đúng công thức | 0.25', onchange: ev => { q.rubric = ev.target.value.split('\n').map(l => l.split('|')).filter(p => p[0].trim() && +p[1] > 0).map(p => ({ text: p[0].trim(), points: +p[1] })); q.points = Math.round(q.rubric.reduce((s, r) => s + r.points, 0) * 100) / 100 || q.points; pts.value = q.points; } }, (q.rubric || []).map(r => r.text + ' | ' + r.points).join('\n')));
    return h('div', { class: 'card' }, h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Câu ' + (i + 1) + ' · ' + TYPE[q.type]), q.warn?.map(w => h('span', { class: 'badge warn' }, w)), q.aiGuess && h('button', { class: 'ghost', onclick: ev => { touch(); ev.target.parentElement.querySelectorAll('.badge.warn').forEach(b => b.remove()); ev.target.remove(); } }, 'Xác nhận đáp án này'), 'Điểm', pts),
      h('textarea', { onchange: ev => q.text = ev.target.value, oninput: ev => { prev.textContent = ev.target.value.includes('$') ? 'Xem trước: ' + ev.target.value : ''; clearTimeout(prev.t); prev.t = setTimeout(typeset, 400); } }, q.text), prev,
      q.options && q.options.map((o, k) => h('div', {}, h('b', {}, String.fromCharCode(65 + k) + '. '), h('input', { value: o, style: 'width:90%', onchange: ev => q.options[k] = ev.target.value }))),
      q.statements && q.statements.map((o, k) => h('div', {}, h('b', {}, 'abcd'[k] + ') '), h('input', { value: o, style: 'width:90%', onchange: ev => q.statements[k] = ev.target.value }))), ctl);
  });
  const panel = h('div');
  shell(h('a', { href: '#/' }, '← Tổng quan'), h('h1', {}, e.title, ' ', h('span', { class: 'badge ' + (e.status === 'published' ? 'ok' : 'warn') }, e.status === 'published' ? 'Đang mở' : 'Nháp')),
    h('div', { class: 'card' }, h('div', { class: 'row' }, T, h('span', {}, D, ' phút'), C, h('label', {}, SR, ' Cho HS xem đáp án sau khi nộp')),
      h('div', { class: 'row', style: 'margin-top:12px' }, btn('Lưu thay đổi', save),
        h('span', {}, 'Tạo ', N, ' mã đề'), btn('Tạo mã đề', async () => { await save(); const r = await api('/exams/' + id + '/variants', { method: 'POST', body: { count: +N.value } }); toast(r.note || 'Đã tạo ' + r.created + ' mã đề không trùng'); examEditor(id); }, 'ghost'),
        btn('AI điền đáp án thiếu', async () => { await save(); const r = await api('/exams/' + id + '/ai-answers', { method: 'POST' }); toast(`Tìm thấy ${r.found} đáp án trong file, AI tự giải ${r.guessed} câu (cần xác nhận)` + (r.left ? `, còn ${r.left} câu chưa có` : '')); examEditor(id); }, 'ghost'),
        btn('AI chuẩn hoá công thức', async () => {
          await save(); const r = await api('/exams/' + id + '/ai-format', { method: 'POST' });
          if (!r.changes.length) return toast('Không tìm thấy công thức nào cần chuẩn hoá');
          const boxes = r.changes.map(() => h('input', { type: 'checkbox', checked: true }));
          panel.replaceChildren(h('div', { class: 'card' }, h('h3', {}, 'AI đề xuất sửa ' + r.changes.length + ' chỗ. Bỏ tích chỗ nào chưa đúng.'),
            r.changes.map((c, i) => h('label', { class: 'row', style: 'align-items:flex-start;padding:8px 0;border-top:1px solid var(--line)' }, boxes[i], h('div', { class: 'grow' }, h('div', { class: 'mute' }, 'Câu ' + (c.qi + 1) + ' · ' + c.label), h('div', { class: 'qtext mute' }, c.before), h('div', { class: 'qtext' }, c.after)))),
            h('div', { class: 'row', style: 'margin-top:10px' }, btn('Áp dụng các chỗ đã chọn', async () => {
              r.changes.forEach((c, i) => { if (!boxes[i].checked) return; const q = bank[c.qi]; if (c.field === 'text') q.text = c.after; else if (c.field === 'sample') q.sample = c.after; else if (c.field === 'o') q.options[c.k] = c.after; else q.statements[c.k] = c.after; });
              await save(); examEditor(id);
            }), btn('Bỏ qua', async () => panel.replaceChildren(), 'ghost'))));
          typeset();
        }, 'ghost'),
        btn('AI tạo thang điểm tự luận', async () => { const r = await api('/exams/' + id + '/ai-rubric', { method: 'POST' }); toast('AI đã tạo thang điểm cho ' + r.updated + ' câu'); examEditor(id); }, 'ghost'),
        btn(e.status === 'published' ? 'Thu hồi về nháp' : 'Công bố bài thi', async () => { await save(); await api('/exams/' + id + '/publish', { method: 'POST', body: { publish: e.status !== 'published' } }); examEditor(id); }), h('a', { href: '#/results/' + id }, 'Xem kết quả'),
        btn('Xoá đề', async () => { if (!confirm('Xoá đề và toàn bộ bài làm?')) return; await api('/exams/' + id, { method: 'DELETE' }); location.hash = '#/'; }, 'danger')),
      h('p', { class: 'mute' }, 'Mã đề hiện có: ' + (e.variants.map(v => v.code).join(', ') || 'chưa có') + '. Sửa nội dung đề sẽ xoá mã đề cũ, cần tạo lại.')),
    panel,
    h('h2', {}, bank.length + ' câu hỏi' + (warns ? ` · ${warns} câu cần kiểm tra` : '')), qcards);
}

/* ---------- Giáo viên: kết quả ---------- */
async function resultsView(id) {
  const r = await api('/exams/' + id + '/results'), s = r.stats, mx = Math.max(1, ...s.dist.map(d => d.n));
  shell(h('a', { href: '#/exam/' + id }, '← Về đề thi'), h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Kết quả: ' + r.title), btn('Xuất Excel', async () => {
    const res = await fetch('/api/exams/' + id + '/export', { headers: { Authorization: 'Bearer ' + TOKEN } });
    if (!res.ok) throw new Error('Không xuất được file'); const a = h('a', { href: URL.createObjectURL(await res.blob()), download: r.title + '.xlsx' }); a.click();
  })),
    h('div', { class: 'stats' }, [['Đã nộp', s.submitted + '/' + s.enrolled], ['Điểm TB', s.avg ?? '—'], ['Cao nhất', s.max ?? '—'], ['Thấp nhất', s.min ?? '—']].map(([l, v]) => h('div', { class: 'card stat' }, h('span', { class: 'mute' }, l), h('b', {}, v)))),
    h('div', { class: 'card' }, h('h3', {}, 'Phổ điểm'), h('div', { class: 'bars', style: 'margin-top:12px' }, s.dist.map(d => h('div', {}, d.n, h('i', { style: `height:${d.n / mx * 90}px` }), d.label)))),
    h('div', { class: 'card' }, h('h3', {}, 'Tỉ lệ đạt từng câu'), h('div', { class: 'qrate', style: 'margin-top:10px' }, s.questions.map(q => h('span', { title: TYPE[q.type], style: q.rate != null && q.rate < 0.4 ? 'background:var(--badbg);color:var(--bad)' : '' }, q.n + ': ' + (q.rate == null ? '—' : Math.round(q.rate * 100) + '%'))))),
    h('div', { class: 'card' }, h('table', {}, h('tr', {}, ['Học sinh', 'Mã đề', 'Điểm', 'Trạng thái', 'Nộp lúc', ''].map(x => h('th', {}, x))),
      r.attempts.map(a => h('tr', {}, h('td', {}, a.name, h('div', { class: 'mute' }, a.email)), h('td', {}, a.code), h('td', {}, a.submitted_at ? h('b', {}, a.total) : '—'), h('td', {}, a.submitted_at ? sb(a.status) : h('span', { class: 'badge' }, 'Đang làm')), h('td', {}, fmt(a.submitted_at)), h('td', {}, a.submitted_at && h('a', { href: '#/attempt/' + a.id }, 'Xem / chấm')))))));
}

/* ---------- Xem bài làm (GV + HS) ---------- */
async function attemptView(id) {
  const a = await api('/attempts/' + id);
  const back = USER.role === 'teacher' ? h('a', { onclick: () => history.back() }, '← Quay lại') : h('a', { href: '#/' }, '← Trang chủ');
  if (a.hidden) return shell(back, h('h1', {}, a.exam), h('div', { class: 'card' }, 'Bài đã nộp. Điểm: ', h('b', {}, a.total + '/10'), '. Giáo viên chưa mở xem đáp án.'));
  const letter = k => String.fromCharCode(65 + k);
  const cards = a.items.map((it, n) => {
    const ok = it.earned != null && it.earned >= it.max - 1e-9;
    const head = h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Câu ' + (n + 1) + ' · ' + TYPE[it.type]), it.earned == null ? h('span', { class: 'badge warn' }, 'Chưa chấm') : h('span', { class: 'badge ' + (ok ? 'ok' : it.earned > 0 ? 'warn' : 'bad') }, it.earned + '/' + it.max));
    const body = [h('div', { class: 'qtext' }, it.text)];
    if (it.type === 'mcq') body.push(it.options.map((o, k) => h('div', { class: 'opt ' + (k === it.correct ? 'good' : k === it.answer ? 'wrong' : '') }, h('b', {}, letter(k) + '.'), o, k === it.answer && h('span', { class: 'mute' }, ' (bạn chọn)'))));
    if (it.type === 'tf') body.push(it.statements.map((s, k) => h('div', { class: 'tfrow' }, h('span', { class: 'st' }, 'abcd'[k] + ') ' + s), h('span', { class: 'badge ' + ((it.answer || [])[k] === it.correct[k] ? 'ok' : 'bad') }, 'Chọn: ' + ((it.answer || [])[k] == null ? '—' : it.answer[k] ? 'Đúng' : 'Sai')), h('span', { class: 'mute' }, 'Đáp án: ' + (it.correct[k] ? 'Đúng' : 'Sai')))));
    if (it.type === 'short') body.push(h('div', {}, 'Bài làm: ', h('b', {}, it.answer || '—'), ' · Đáp án: ', h('b', {}, it.correct)));
    if (it.type === 'essay') {
      body.push(h('div', { class: 'mute' }, 'Bài làm:'), h('div', { class: 'card qtext' }, it.answer || '(bỏ trống)'));
      const inputs = (it.criteria || it.rubric?.map(r => ({ text: r.text, max: r.points, score: 0 })) || []).map(c => h('div', { class: 'crit' }, a.teacher ? h('input', { type: 'number', step: '0.05', min: 0, max: c.max, value: c.score }) : h('b', {}, c.score), '/ ' + c.max + ' · ' + c.text, c.comment && h('span', { class: 'mute' }, '— ' + c.comment)));
      body.push(inputs);
      if (it.feedback) body.push(h('p', {}, h('b', {}, 'Nhận xét: '), it.feedback));
      if (a.teacher) body.push(h('div', { class: 'row' }, it.ai && h('span', { class: 'badge' }, 'AI chấm'), it.manual && h('span', { class: 'badge ok' }, 'GV chấm'),
        btn('Lưu điểm chấm tay', async () => { const sc = [...card.querySelectorAll('.crit input')].map(i => +i.value); await api('/attempts/' + id + '/essay', { method: 'PUT', body: { pos: it.pos, scores: sc } }); toast('Đã lưu'); attemptView(id); }, 'ghost'),
        btn('Chấm lại bằng AI', async () => { await api('/attempts/' + id + '/regrade', { method: 'POST' }); attemptView(id); }, 'ghost')));
      if (it.sample && a.teacher) body.push(h('details', {}, h('summary', { class: 'mute' }, 'Đáp án mẫu'), h('div', { class: 'qtext' }, it.sample)));
    }
    const card = h('div', { class: 'card' }, head, body);
    return card;
  });
  shell(back, h('h1', {}, a.exam + (USER.role === 'teacher' ? ' — ' + a.student.name : '')),
    h('div', { class: 'card row' }, h('div', { class: 'grow' }, h('span', { class: 'mute' }, 'Mã đề ' + a.code + ' · nộp ' + fmt(a.submitted_at))), sb(a.status), h('div', {}, h('b', { style: 'font-size:28px' }, a.total), ' / 10', h('div', { class: 'mute' }, a.earned + '/' + a.max + ' điểm thô'))), cards);
  if (a.status === 'grading') setTimeout(() => location.hash.startsWith('#/attempt/' + id) && attemptView(id), 6000);
}

/* ---------- Học sinh ---------- */
async function studentHome() {
  const [exams, classes] = await Promise.all([api('/exams'), api('/classes')]), code = h('input', { placeholder: 'Mã lớp (6 ký tự)', style: 'text-transform:uppercase' });
  shell(h('h1', {}, 'Bài kiểm tra của tôi'),
    exams.length ? exams.map(e => h('div', { class: 'card row' }, h('div', { class: 'grow' }, h('h3', {}, e.title), h('span', { class: 'mute' }, e.class_name + ' · ' + e.duration_min + ' phút')),
      e.submitted_at ? [sb(e.status), h('b', {}, e.total + '/10'), h('a', { href: '#/attempt/' + e.attempt_id }, 'Xem bài')] : btn(e.attempt_id ? 'Làm tiếp' : 'Bắt đầu làm bài', async () => { if (!e.attempt_id && !confirm('Đồng hồ sẽ chạy ngay khi bắt đầu (' + e.duration_min + ' phút). Bắt đầu?')) return; location.hash = '#/take/' + e.id; })))
      : h('p', { class: 'mute' }, classes.length ? 'Chưa có bài kiểm tra nào được mở.' : 'Bạn chưa tham gia lớp nào. Nhập mã lớp từ giáo viên bên dưới.'),
    h('h2', {}, 'Lớp của tôi'), h('div', { class: 'card' }, classes.length ? h('p', {}, classes.map(c => h('span', { class: 'badge', style: 'margin-right:6px' }, c.name))) : '', h('div', { class: 'row' }, code, btn('Tham gia lớp', async () => { const c = await api('/join', { method: 'POST', body: { code: code.value } }); toast('Đã vào lớp ' + c.name); studentHome(); }))));
}

/* ---------- Phòng thi ---------- */
async function takeExam(examId) {
  const d = await api('/exams/' + examId + '/start', { method: 'POST' });
  const key = 'ans_' + d.attempt_id, local = JSON.parse(localStorage[key] || 'null');
  const ans = { ...d.answers, ...(local || {}) }; let cur = 0, dirty = !!local, deadline = Date.now() + d.remain * 1000, submitting = false;
  const items = d.paper, done = i => { const a = ans[i], t = items[i].type; return t === 'tf' ? Array.isArray(a) && a.some(x => x != null) : a != null && a !== ''; };
  const saveNow = async () => { if (!dirty) return; try { await api('/attempts/' + d.attempt_id + '/save', { method: 'PUT', body: { answers: ans } }); dirty = false; $('#sv') && ($('#sv').textContent = 'Đã lưu'); } catch (e) { $('#sv') && ($('#sv').textContent = 'Chưa lưu được — đang thử lại'); } };
  const change = () => { localStorage[key] = JSON.stringify(ans); dirty = true; if ($('#sv')) $('#sv').textContent = 'Đang lưu…'; clearTimeout(change.t); change.t = setTimeout(saveNow, 1200); paint(false); };
  const submit = async (auto) => {
    if (submitting) return; const left = items.filter((_, i) => !done(i)).length;
    if (!auto && !confirm(left ? `Còn ${left} câu chưa làm. Vẫn nộp bài?` : 'Nộp bài ngay?')) return;
    submitting = true; window.onbeforeunload = null;
    try { await api('/attempts/' + d.attempt_id + '/submit', { method: 'POST', body: { answers: ans } }); delete localStorage[key]; toast(auto ? 'Hết giờ — bài đã được nộp' : 'Đã nộp bài'); location.hash = '#/attempt/' + d.attempt_id; }
    catch (e) { submitting = false; toast(e.message + ' — thử nộp lại'); }
  };
  function paint(full = true) {
    const q = items[cur], pal = $('.pal .g');
    if (pal) pal.replaceChildren(...items.map((_, i) => h('button', { class: (done(i) ? 'done ' : '') + (i === cur ? 'cur' : ''), onclick: () => { cur = i; paint(); } }, i + 1)));
    if (!full) return;
    let body;
    if (q.type === 'mcq') body = q.options.map((o, k) => h('label', { class: 'opt' + (ans[cur] === k ? ' sel' : '') }, h('input', { type: 'radio', name: 'q', checked: ans[cur] === k, onchange: () => { ans[cur] = k; change(); paint(); } }), h('b', {}, String.fromCharCode(65 + k) + '.'), h('span', {}, o)));
    else if (q.type === 'tf') body = q.statements.map((s, k) => h('div', { class: 'tfrow' }, h('span', { class: 'st' }, 'abcd'[k] + ') ' + s), [true, false].map(v => h('label', {}, h('input', { type: 'radio', name: 'tf' + k, checked: (ans[cur] || [])[k] === v, onchange: () => { const a = ans[cur] = [...(ans[cur] || Array(q.statements.length).fill(null))]; a[k] = v; change(); } }), v ? 'Đúng' : 'Sai'))));
    else { const t = q.type === 'short' ? h('input', { value: ans[cur] || '', placeholder: 'Nhập đáp án (số hoặc từ)', style: 'width:100%' }) : h('textarea', { value: ans[cur] || '', placeholder: 'Trình bày lời giải từng bước. Viết công thức dạng $x^2$ nếu cần.', style: 'min-height:260px' }); t.oninput = () => { ans[cur] = t.value; change(); }; body = t; }
    $('#qbox').replaceChildren(h('div', { class: 'row' }, h('h3', { class: 'grow' }, 'Câu ' + (cur + 1) + '/' + items.length + ' · ' + TYPE[q.type]), h('span', { class: 'badge' }, q.points + ' điểm')), h('div', { class: 'qtext', style: 'margin:12px 0' }, q.text), ...[body].flat(),
      h('div', { class: 'row', style: 'margin-top:14px' }, h('button', { class: 'ghost', disabled: cur === 0, onclick: () => { cur--; paint(); } }, '← Câu trước'), h('button', { class: 'ghost', disabled: cur === items.length - 1, onclick: () => { cur++; paint(); } }, 'Câu sau →')));
    typeset();
  }
  shell(h('div', { class: 'exam' }, h('div', { class: 'pal card' }, h('h3', {}, d.title), h('div', { class: 'mute' }, 'Mã đề ' + d.code), h('div', { class: 'timer', id: 'tm', style: 'margin:10px 0' }, '--:--'), h('div', { class: 'g' }), h('p', { class: 'mute', id: 'sv' }, 'Đã lưu'), h('button', { onclick: () => submit(false), style: 'width:100%' }, 'Nộp bài')), h('div', { class: 'card', id: 'qbox' })));
  paint();
  window.onbeforeunload = () => dirty || undefined;
  SAVER = setInterval(saveNow, 15000);
  TIMER = setInterval(() => {
    const s = Math.max(0, Math.round((deadline - Date.now()) / 1000)), t = $('#tm'); if (!t) return;
    t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); t.classList.toggle('low', s < 300);
    if (s === 0) { clearInterval(TIMER); submit(true); }
  }, 500);
}

/* ---------- Điều hướng ---------- */
async function render() {
  window.onbeforeunload = null;
  if (!TOKEN || !USER) return authView();
  const [, route, id] = location.hash.split('/');
  try {
    if (USER.role === 'teacher') {
      if (route === 'exam') return await examEditor(id);
      if (route === 'results') return await resultsView(id);
      if (route === 'attempt') return await attemptView(id);
      return await teacherHome();
    }
    if (route === 'take') return await takeExam(id);
    if (route === 'attempt') return await attemptView(id);
    return await studentHome();
  } catch (e) { toast(e.message); if (route) { location.hash = '#/'; } else shell(h('p', {}, e.message)); }
}
addEventListener('hashchange', render);
render();
