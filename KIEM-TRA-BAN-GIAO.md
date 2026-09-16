# KIỂM TRA BẢN BÀN GIAO CUỐI

## Phạm vi đã xác nhận

- Firebase Web config dùng `src/config/firebase.ts`, không đọc `VITE_FIREBASE_*`.
- Google login học sinh được đối chiếu với Gmail hồ sơ.
- Upload riêng đề Word và đáp án Word.
- Parser MathType OLE v10 của dự án được giữ nguyên phần lõi và hợp nhất với các hàm nhập tự luận.
- Có `VITE_MATHTYPE_SERVER_URL` trong `.env.example` và `src/vite-env.d.ts`.
- OLE `.bin` được gửi đến `/v1/convert`; LaTeX được ghép theo `rId`.
- Import tự luận dừng nếu backend MathType lỗi hoặc trả thiếu công thức.
- Word/OMML/MathType không gọi Gemini khi upload.
- Gemini chỉ dùng khi chấm bài học sinh.
- Giáo viên xác nhận từng câu trước khi công bố.
- Kết quả công khai dùng token, Markdown an toàn và MathJax.

## Biến bắt buộc

```text
VITE_MATHTYPE_SERVER_URL
FIREBASE_SERVICE_ACCOUNT_JSON
ESSAY_APPS_SCRIPT_URL
ESSAY_APPS_SCRIPT_SECRET
PUBLIC_APP_URL
```

Zalo là tùy chọn.

## Kiểm tra kỹ thuật cần chạy khi bàn giao

- TypeScript/TSX syntax.
- `tsc --noEmit` hoặc `npm run build` khi dependency đã cài.
- JavaScript API/server qua `node --check`.
- JSON parse.
- Import nội bộ.
- ZIP integrity.

## Kết quả kiểm tra thực tế của bản đóng gói

- 48 file TypeScript/TSX: không có lỗi cú pháp.
- `tsc --noEmit --noCheck --skipLibCheck`: đạt.
- Import tương đối nội bộ: không thiếu file.
- JavaScript trong `api/` và `server/`: qua `node --check`.
- `apps-script/Code.gs`: qua kiểm tra cú pháp V8 bằng `node --check`.
- 6 file JSON: hợp lệ.
- Parser có đủ lõi v10, `/health`, `/v1/convert`, nhập đề tự luận, nhập đáp án và ghép lời giải.
- Không còn các màn điểm danh, học phí, bảng lương và quản lý nhân sự đã loại bỏ.

`npm install` không chạy được trong môi trường kiểm tra vì registry nội bộ trả 404 cho `@types/react`. Cần chạy lại `npm install && npm run build` trên máy hoặc Vercel dùng registry npm bình thường.
