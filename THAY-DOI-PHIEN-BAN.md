# Thay đổi phiên bản Gmail + Word đề/đáp án

## Firebase

- Bỏ 6 biến `VITE_FIREBASE_*`.
- Chuyển Firebase Web config sang `src/config/firebase.ts`.
- Giữ nguyên Firebase Admin credentials ở Vercel server.

## Đăng nhập học sinh

- Thêm đăng nhập Google tại `/student-login`.
- Thêm trường `studentEmail` vào hồ sơ học sinh và file Excel mẫu.
- Chỉ liên kết Google khi Gmail trùng chính xác một hồ sơ học sinh đang hoạt động.
- Chặn Gmail học sinh đăng nhập nhầm thành giáo viên mới.
- Giữ tài khoản username/password làm phương án dự phòng.
- Đối chiếu lại Gmail và trạng thái hồ sơ ở mỗi lần đăng nhập Google.

## Word

- Tách upload `File đề Word` và `File đáp án Word`.
- Thêm parser tự luận chuyên dụng, không phụ thuộc cấu trúc đề trắc nghiệm.
- Ghép đề và đáp án theo số câu.
- MathType OLE được chuyển sang LaTeX một lần khi upload.
- Lưu tên cả file đề và file đáp án.
- Giữ hình đáp án để giáo viên xem nhưng không gửi Gemini mặc định.
- Chặn giao bài khi đáp án chỉ có ảnh hoặc thiếu lời giải chữ/LaTeX.

## Chấm bài

- Gemini nhận trực tiếp đề và lời giải đã lưu.
- Không dùng Gemini để đọc file Word.
- Chỉ gọi Gemini khi giáo viên bấm `AI chấm gợi ý`.

## Bản cuối — xác nhận MathType OLE backend hiện có

- Hợp nhất chính xác parser v10 do người dùng cung cấp với luồng đề/đáp án tự luận.
- Thêm `VITE_MATHTYPE_SERVER_URL` vào `.env.example`.
- Không tạo backend MathType mới; sử dụng backend render hiện có qua `/health` và `/v1/convert`.
- Dừng import khi backend không chuyển đủ OLE, tránh mất công thức âm thầm.
- Đồng bộ fallback Firebase Admin giữa API TypeScript và API JavaScript cũ.
