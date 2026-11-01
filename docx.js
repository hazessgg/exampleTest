// Đọc DOCX không cần thư viện ngoài: giải nén zip, lấy word/document.xml, đổi công thức Word (OMML) sang LaTeX "$...$".
const zlib = require('zlib');

function readZipEntry(buf, wanted) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Không phải file DOCX hợp lệ');
  let p = buf.readUInt32LE(e + 16);
  for (let n = buf.readUInt16LE(e + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + nl) === wanted) {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28), data = buf.subarray(start, start + csize);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + nl + xl + cl;
  }
  throw new Error('Không tìm thấy nội dung trong file DOCX');
}

const ent = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function parseXml(xml) {
  const root = { name: '', attrs: {}, children: [] }, stack = [root];
  xml = xml.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(xml))) {
    if (m[5] != null) { stack[stack.length - 1].children.push({ text: ent(m[5]) }); continue; }
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {}; for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[2] ?? a[3];
    const node = { name: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) stack.push(node);
  }
  return root;
}
const kids = n => n.children.filter(c => c.name);
const first = (n, name) => kids(n).find(c => c.name === name);
const textOf = n => n.text ?? n.children.map(textOf).join('');

/* ---- OMML -> LaTeX ---- */
const FN = /\b(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|log|ln|lim|max|min|exp)\b/g;
const NARY = { '∑': '\\sum', '∫': '\\int', '∏': '\\prod', '∮': '\\oint', '∬': '\\iint' };
function math(n) {
  if (n.text != null) return '';
  const c = name => { const x = first(n, name); return x ? mseq(x) : ''; };
  const val = (pr, d) => { const x = first(n, pr); const y = x && first(x, pr.replace('Pr', '')); return y && y.attrs['m:val'] != null ? y.attrs['m:val'] : d; };
  switch (n.name) {
    case 'm:r': return kids(n).filter(k => k.name === 'm:t').map(textOf).join('').replace(/%/g, '\\%').replace(/&/g, '\\&').replace(/#/g, '\\#').replace(/\u2212/g, '-').replace(FN, '\\$1 ');
    case 'm:f': return `\\frac{${c('m:num')}}{${c('m:den')}}`;
    case 'm:sSub': return `{${c('m:e')}}_{${c('m:sub')}}`;
    case 'm:sSup': return `{${c('m:e')}}^{${c('m:sup')}}`;
    case 'm:sSubSup': return `{${c('m:e')}}_{${c('m:sub')}}^{${c('m:sup')}}`;
    case 'm:rad': { const d = c('m:deg'); return d ? `\\sqrt[${d}]{${c('m:e')}}` : `\\sqrt{${c('m:e')}}`; }
    case 'm:d': {
      const pr = first(n, 'm:dPr'), g = k => { const x = pr && first(pr, k); return x && x.attrs['m:val'] != null ? x.attrs['m:val'] : null; };
      const b = g('m:begChr') ?? '(', en = g('m:endChr') ?? ')', sep = g('m:sepChr') ?? '|';
      const esc = s => s === '{' ? '\\{' : s === '}' ? '\\}' : s;
      return esc(b) + kids(n).filter(k => k.name === 'm:e').map(mseq).join(sep) + esc(en);
    }
    case 'm:nary': {
      const pr = first(n, 'm:naryPr'), ch = pr && first(pr, 'm:chr'), sym = NARY[ch?.attrs['m:val'] ?? '∫'] || '\\int', sb = c('m:sub'), sp = c('m:sup');
      return sym + (sb ? `_{${sb}}` : '') + (sp ? `^{${sp}}` : '') + ' ' + c('m:e');
    }
    case 'm:acc': {
      const pr = first(n, 'm:accPr'), ch = pr && first(pr, 'm:chr'), v = ch?.attrs['m:val'] ?? '\u0302';
      const cmd = /[\u20d7→]/.test(v) ? '\\vec' : /[\u0305¯]/.test(v) ? '\\overline' : /\u0307/.test(v) ? '\\dot' : '\\hat';
      return `${cmd}{${c('m:e')}}`;
    }
    case 'm:bar': return `\\overline{${c('m:e')}}`;
    case 'm:limLow': return `{${c('m:e')}}_{${c('m:lim')}}`;
    case 'm:limUpp': return `{${c('m:e')}}^{${c('m:lim')}}`;
    case 'm:func': return c('m:fName') + ' ' + c('m:e');
    default: return n.name.endsWith('Pr') ? '' : mseq(n);
  }
}
const mseq = n => kids(n).map(math).join('');

/* ---- Đoạn văn ---- */
function runText(r) {
  const pr = first(r, 'w:rPr'), va = pr && first(pr, 'w:vertAlign')?.attrs['w:val'];
  let s = '';
  for (const k of kids(r)) {
    if (k.name === 'w:t') s += textOf(k);
    else if (k.name === 'w:tab') s += ' ';
    else if (k.name === 'w:br' || k.name === 'w:cr') s += '\n';
  }
  if (va === 'superscript' && s.trim()) return `$^{${s}}$`;
  if (va === 'subscript' && s.trim()) return `$_{${s}}$`;
  return s;
}
function inline(n) {
  if (n.text != null) return '';
  if (n.name === 'w:r') return runText(n);
  if (n.name === 'm:oMath') return '$' + mseq(n) + '$';
  if (n.name === 'm:oMathPara') return kids(n).map(inline).join(' ');
  if (['w:pPr', 'w:rPr', 'w:drawing', 'w:pict', 'w:instrText', 'mc:AlternateContent'].includes(n.name)) return '';
  return kids(n).map(inline).join('');
}
function paragraphs(n, out) {
  if (n.name === 'w:p') out.push(inline(n).replace(/\$\s*\$/g, '').replace(/\$\s*\$/g, '')); // bỏ công thức rỗng
  else kids(n).forEach(k => paragraphs(k, out));
  return out;
}

function docxText(buf) {
  const xml = readZipEntry(buf, 'word/document.xml').toString('utf8');
  return paragraphs(parseXml(xml), []).join('\n');
}
module.exports = { docxText };
