# Phòng thi trực tuyến (auto-exam) – V1

## Chạy trên Windows
1. Cài Node.js 18+ và MySQL 8 (đang chạy).
2. `copy .env.example .env` rồi sửa DB_PASSWORD, JWT_SECRET, TEACHER_CODE (và AI_KEY nếu có).
3. `npm install` → `npm start` → mở http://localhost:3000 (database và bảng tự tạo).
4. Đăng ký giáo viên bằng TEACHER_CODE → tạo lớp → tải đề → soát đề → tạo mã đề → chọn lớp → Công bố.
5. Học sinh đăng ký, nhập mã lớp, làm bài.

## Định dạng đề (DOCX / PDF có chữ / TXT)
PHẦN I. Trắc nghiệm / PHẦN II. Đúng sai / PHẦN III. Trả lời ngắn / PHẦN IV. Tự luận
Câu 1. Nội dung ... A. ... B. ... C. ... D. ...   Đáp án: C   Điểm: 0.25
Đúng/Sai: các ý a) b) c) d), "Đáp án: a-Đ, b-S, c-Đ, d-S" (đúng 1/2/3/4 ý = 0.1/0.25/0.5/1 điểm của câu)
Tự luận: "Ý 1: Viết đúng công thức 0.25đ" ... và "Hướng dẫn: ..."
Cuối đề có thể có mục "ĐÁP ÁN" dạng "1 B  2 C  3 A" cho trắc nghiệm.

## Kiểm thử logic
`npm test` (kiểm tra đọc đề, sinh mã đề không trùng, chấm điểm).
