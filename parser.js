// Đọc DOCX/PDF/TXT -> ngân hàng câu hỏi. Mỗi câu: {type,text,options,answer,statements,tfAnswers,points,rubric,sample,warn}
const path = require('path');
const num = s => parseFloat(String(s).replace(',', '.'));
const sum = a => a.reduce((x, y) => x + y, 0);

async function extract(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ext === '.docx') { try { return require('./docx').docxText(file.buffer); } catch (e) { throw new Error('Không đọc được file DOCX (' + e.message + '). Nếu là file .doc cũ, hãy mở bằng Word và Lưu thành .docx'); } }
  if (ext === '.pdf') return (await require('pdf-parse')(file.buffer)).text;
  if (ext === '.txt') return file.buffer.toString('utf8');
  throw new Error('Chỉ hỗ trợ file .docx, .pdf hoặc .txt');
}

function parseTF(s) {
  const t = s.replace(/đúng/gi, 'Đ').replace(/sai/gi, 'S').replace(/\b[a-d]\b/g, '');
  return [...t.matchAll(/[ĐSTF]/gi)].map(m => /[ĐT]/i.test(m[0]));
}

function build(b, key) {
  const text = [], opts = [], sts = [], sample = [], rub = [];
  let ans = '', pts = null, mode = 'text', last = null;
  for (const l of b.lines) {
    let m;
    if ((m = l.match(/^(?:Đáp án|ĐA|Đ\/A)\s*[:：]\s*(.*)$/i))) { ans = m[1]; mode = 'ans'; continue; }
    if ((m = l.match(/^(?:Điểm|Thang điểm)\s*[:：]\s*([\d.,]+)/i))) { pts = num(m[1]); continue; }
    if (/^(Hướng dẫn( giải| chấm)?|Lời giải|Bài giải)\s*[:：]?/i.test(l)) { mode = 'sample'; sample.push(l.replace(/^[^:：]*[:：]?\s*/, '')); continue; }
    if ((m = l.match(/^Ý\s*(\d+)\s*[:.)]\s*(.+?)[\s\-–(:]*(\d+(?:[.,]\d+)?)\s*(?:đ|điểm)\s*\)?$/i))) { rub.push({ text: m[2], points: num(m[3]) }); mode = 'rub'; continue; }
    if (mode === 'ans') { ans += ' ' + l; continue; }
    if (mode === 'sample') { sample.push(l); continue; }
    if (/^[A-D]\s*[.)]\s/.test(l)) {
      for (const p of l.split(/\s+(?=[B-D][.)]\s)/)) { const mm = p.match(/^[A-D]\s*[.)]\s*(.*)$/); if (mm) { opts.push(mm[1]); last = opts; } }
      continue;
    }
    if ((m = l.match(/^[a-d]\s*[.)]\s*(.*)$/))) { sts.push(m[1]); last = sts; continue; }
    if (last && last.length && mode === 'text') { last[last.length - 1] += ' ' + l; continue; }
    text.push(l);
  }
  let type;
  if (opts.length >= 2) type = 'mcq';
  else if (sts.length >= 2) type = 'tf';
  else if (rub.length || sample.length || b.hint === 'essay') type = 'essay';
  else if (ans) type = ans.length > 20 ? 'essay' : 'short';
  else type = b.hint === 'short' ? 'short' : 'essay';

  const q = { n: b.n, type, text: text.join('\n').trim(), warn: [] };
  ans = ans.trim();
  if (type === 'mcq') {
    q.options = opts; q.points = pts ?? 0.25;
    const L = (ans.match(/[A-D]/) || [key[b.n]])[0];
    q.answer = L ? L.charCodeAt(0) - 65 : null;
    if (q.answer == null) q.warn.push('Chưa nhận diện được đáp án');
  } else if (type === 'tf') {
    q.statements = sts; q.points = pts ?? 1;
    const t = parseTF(ans);
    q.tfAnswers = t.length === sts.length ? t : null;
    if (!q.tfAnswers) q.warn.push('Chưa nhận diện được đáp án Đúng/Sai');
  } else if (type === 'short') {
    q.points = pts ?? 0.5; q.answer = ans; q.tol = 0;
  } else {
    q.sample = (sample.join('\n') || ans).trim();
    let total = pts ?? (rub.length ? sum(rub.map(r => r.points)) : 1);
    const rs = sum(rub.map(r => r.points));
    q.rubric = rub.length ? rub.map(r => ({ text: r.text, points: Math.round(r.points * total / rs * 100) / 100 })) : [];
    q.points = total;
    if (!q.rubric.length) q.warn.push('Chưa có thang điểm từng ý (có thể nhờ AI tạo)');
  }
  return q;
}

function parseText(raw) {
  const lines = raw.replace(/\r/g, '').replace(/\u00a0/g, ' ').split('\n').map(s => s.trim());
  const blocks = [], key = {};
  let hint = 'mcq', cur = null, inKey = false;
  for (const l of lines) {
    if (!l) continue;
    if (/^(BẢNG\s+)?(ĐÁP ÁN|HƯỚNG DẪN CHẤM)\s*:?\s*$/i.test(l)) { inKey = true; cur = null; continue; }
    if (inKey) { for (const m of l.matchAll(/(?:Câu\s*)?(\d+)\s*[.:\-–)]?\s*([A-D])\b/g)) key[+m[1]] = m[2]; continue; }
    if (/^PHẦN\s+[IVX\d]+/i.test(l)) {
      if (/đúng\s*[-–/]?\s*sai/i.test(l)) hint = 'tf';
      else if (/trả lời ngắn|điền/i.test(l)) hint = 'short';
      else if (/tự luận/i.test(l)) hint = 'essay';
      else if (/trắc nghiệm/i.test(l)) hint = 'mcq';
      cur = null; continue;
    }
    let m;
    if ((m = l.match(/^(?:Câu|Bài)\s*(\d+)\s*[.:)]?\s*(.*)$/i))) { cur = { n: +m[1], hint, lines: [m[2]] }; blocks.push(cur); continue; }
    if (cur) cur.lines.push(l);
  }
  return blocks.map(b => build(b, key)).filter(q => q.text || q.options || q.statements);
}

module.exports = { extract, parseText, parseTF };
