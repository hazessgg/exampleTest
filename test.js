const { parseText } = require('./parser'); const g = require('./grader'); const assert = require('assert');
const bank = parseText(`PHẦN I. Trắc nghiệm
Câu 1. Lực nào sau đây?
A. 10 N
B. 20 N
C. 30 N
D. 40 N
Đáp án: C
Điểm: 0.25
Câu 2. Chọn đúng
A. x B. y C. z D. w
PHẦN II. Đúng sai
Câu 3. Xét các phát biểu:
a) Một
b) Hai
c) Ba
d) Bốn
Đáp án: a-Đ, b-S, c-Đ, d-S
PHẦN III. Trả lời ngắn
Câu 4. Tính 2+3
Đáp án: 5
PHẦN IV. Tự luận
Câu 5. Tính W = 1/2 m w^2 A^2 với m=0,2; w=10; A=0,05. Điểm: 1
Ý 1: Viết đúng công thức 0.25đ
Ý 2: Thay đúng số liệu 0.25đ
Ý 3: Tính đúng 0.25đ
Ý 4: Kết luận đúng 0.25đ
Hướng dẫn: W = 0,025 J
ĐÁP ÁN
2 B`);
console.log(JSON.stringify(bank.map(q => [q.type, q.answer ?? q.tfAnswers ?? q.rubric?.length, q.points, q.warn])));
assert.deepEqual(bank.map(q => q.type), ['mcq', 'mcq', 'tf', 'short', 'essay']);
assert.equal(bank[0].answer, 2); assert.equal(bank[1].answer, 1); assert.equal(bank[1].options.length, 4); assert.equal(bank[4].rubric.length, 4);
const vs = g.makeVariants(bank, 6); assert.equal(new Set(vs.map(v => v.hash)).size, 6);
const v = vs[0], ans = {};
v.items.forEach((it, pos) => { const q = bank[it.qi];
  if (q.type === 'mcq') ans[pos] = it.o.indexOf(q.answer);
  if (q.type === 'tf') ans[pos] = it.s.map(o => q.tfAnswers[o]);
  if (q.type === 'short') ans[pos] = '5'; });
const r = g.gradeObjective(bank, v, ans), s = g.summarize(r);
console.log(s); assert.equal(s.pending, 1); assert.equal(s.earned, 0.25 * 2 + 1 + 0.5);
// sai 1/4 ý đúng/sai -> 0.5 điểm
const tfPos = v.items.findIndex(i => bank[i.qi].type === 'tf'); ans[tfPos][0] = !ans[tfPos][0];
assert.equal(g.gradeObjective(bank, v, ans)[tfPos].earned, 0.5);
console.log('OK');
// --- AI điền đáp án (giả lập API) ---
const P1 = (async () => {
  process.env.AI_KEY = 'x';
  const b = parseText('Câu 1. Chọn\nA. a\nB. b\nC. c\nD. d\nCâu 2. Chọn\nA. a\nB. b\nC. c\nD. d\nCâu 3. Xét:\na) 1\nb) 2\nc) 3\nd) 4');
  let call = 0;
  global.fetch = async (u, o) => { call++; const sys = JSON.parse(o.body).messages[0].content;
    const ans = sys.includes('trích xuất') ? [{ n: 1, answer: 'C' }] : [{ n: 2, answer: 'B' }, { n: 3, answer: 'a-Đ,b-S,c-Đ,d-S' }];
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ answers: ans }) } }] }) }; };
  const r = await g.aiFillAnswers(b, 'Đáp án 1 C', true);
  assert.deepEqual([r.found, r.guessed, r.left], [1, 2, 0]); assert.equal(b[0].answer, 2); assert.ok(!b[0].aiGuess); assert.ok(b[1].aiGuess && b[2].aiGuess);
  console.log('AI fill OK', call, 'calls');
})();

// --- AI chuẩn hoá công thức ---
P1.then(async () => {
  process.env.AI_KEY = 'x';
  const b = parseText('Câu 1. Lực cưỡng bức Fn = F0sin10πt (N) tác dụng\nA. 5 rad/s\nB. 10π rad/s\nC. 3 rad/s\nD. 2 rad/s');
  global.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ items: [
    { id: '0.text', text: 'Lực cưỡng bức $F_n = F_0 \\sin(10\\pi t)$ (N) tác dụng' },
    { id: '0.o0', text: '6 rad/s' }] }) } }] }) });
  const c = await g.aiFormat(b);
  assert.equal(c.length, 1); assert.equal(c[0].field, 'text'); // đề xuất đổi số (5→6) bị loại
  console.log('AI format OK');
});
// --- Đọc DOCX có công thức Word ---
{
  const { docxText } = require('./docx');
  const t = docxText(require('fs').readFileSync(__dirname + '/test/math.docx'));
  console.log(t);
  const b = parseText(t);
  assert.equal(b[0].options.length, 4); assert.equal(b[0].answer, 0);
  assert.ok(b[0].options[0].includes('\\frac{1}{2}') && b[0].options[0].includes('{x}^{2}'));
  assert.ok(b[0].options[3].includes('\\sqrt{kx}'));
  assert.ok(b[1].text.includes('$^{2}$') && b[1].text.includes('\\sin '));
  console.log('DOCX math OK');
}
