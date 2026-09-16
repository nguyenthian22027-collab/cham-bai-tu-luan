# HƯỚNG DẪN TRIỂN KHAI CUỐI — EDUCENTER TỰ LUẬN WORD + MATHTYPE OLE

## 1. Những gì bản này đã có

- Firebase Web config hardcode tại `src/config/firebase.ts`.
- Học sinh đăng nhập Google theo Gmail đã gắn với hồ sơ học sinh.
- Giáo viên upload riêng file đề `.docx` và file đáp án `.docx`.
- `mathWordParserService.ts` v10 đọc DOCX bằng JSZip, lấy MathType OLE `.bin`, gửi backend hiện có và ghép LaTeX trả về vào đúng `rId` trong Word.
- Word Equation/OMML được đọc trực tiếp, không gọi Gemini.
- Gemini chỉ được gọi khi giáo viên bấm chấm gợi ý cho bài học sinh.
- Giáo viên phải xác nhận từng câu trước khi lưu điểm cuối và công bố link.
- Trang kết quả công khai hỗ trợ Markdown, MathJax, ảnh bài làm và gửi Zalo.

## 2. Firebase Web hardcode

Mở:

```text
src/config/firebase.ts
```

Thay đủ sáu giá trị `PASTE_FIREBASE_...` bằng cấu hình Web App trong Firebase Console. Đây là cấu hình public của Firebase Web, không phải service-account private key.

Không tạo lại các biến `VITE_FIREBASE_*` trên Vercel.

## 3. Biến môi trường Vercel

### Bắt buộc

```env
VITE_MATHTYPE_SERVER_URL=https://backend-mathtype-cua-ban.com
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
ESSAY_APPS_SCRIPT_URL=https://script.google.com/macros/s/DEPLOYMENT_ID/exec
ESSAY_APPS_SCRIPT_SECRET=CHUOI_BI_MAT
PUBLIC_APP_URL=https://ten-du-an.vercel.app
```

`VITE_MATHTYPE_SERVER_URL` chỉ là origin backend. Không thêm `/health`, `/v1/convert` hoặc dấu `/` cuối.

### Tùy chọn

```env
VITE_CENTER_NAME=Ten trung tam
ZALO_BACKEND_URL=https://backend-zalo-cua-ban.com
ZALO_BACKEND_API_KEY=...
```

Hai biến Zalo chỉ cần khi dùng nút gửi Zalo.

## 4. Hợp đồng backend MathType hiện có

Frontend gọi trực tiếp:

```http
GET /health
POST /v1/convert
Content-Type: application/json
```

Request chuyển đổi:

```json
{
  "items": [
    { "id": "rId12", "ole_b64": "BASE64_OLE_BIN" }
  ],
  "wrap": true
}
```

Response:

```json
{
  "results": [
    { "id": "rId12", "latex": "$\\frac{x+1}{x-1}$" }
  ]
}
```

Backend phải cho phép CORS từ domain production của ứng dụng:

```http
Access-Control-Allow-Origin: https://ten-du-an.vercel.app
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

Bản này không đóng gói lại backend MathType vì bạn đã có backend render. Nó sử dụng backend đó qua `VITE_MATHTYPE_SERVER_URL`.

## 5. Cơ chế chống mất công thức

Khi file có MathType OLE:

1. Parser tìm relationship `oleObject` và file `word/embeddings/*.bin`.
2. Mỗi OLE được gửi với đúng `rId`.
3. Backend trả LaTeX theo `rId`.
4. Parser chèn LaTeX vào đúng vị trí `<o:OLEObject r:id="...">`.
5. Nếu backend không hoạt động hoặc chỉ trả được một phần công thức, import bị dừng. Hệ thống không lưu đề/đáp án thiếu công thức.

## 6. Apps Script Properties

Trong Apps Script → Project Settings → Script properties:

```env
API_SECRET=CHUOI_GIONG_ESSAY_APPS_SCRIPT_SECRET
GEMINI_API_KEY=...
GEMINI_MODEL=MODEL_BACKEND_CUA_BAN_HO_TRO
```

Tùy chọn:

```env
DRIVE_FOLDER_ID=...
```

Apps Script chỉ upload/đọc ảnh Drive và gọi Gemini chấm. File Word không được gửi sang Gemini.

## 7. Firebase Authentication

Bật:

- Google.
- Email/Password nếu vẫn dùng tài khoản học sinh dự phòng.

Thêm domain Vercel vào Authorized domains. Trong hồ sơ học sinh, nhập đúng Gmail học sinh; email phải duy nhất.

## 8. Quy trình sử dụng

1. Giáo viên upload file đề Word.
2. Parser đọc text, OMML, hình và MathType OLE.
3. Giáo viên upload file đáp án Word.
4. Hệ thống ghép đáp án theo số câu và lưu lời giải text/LaTeX.
5. Giao bài cho lớp/học sinh.
6. Học sinh nhập lời giải hoặc tải ảnh bài viết tay.
7. Giáo viên bấm AI chấm gợi ý.
8. Giáo viên xác nhận từng câu và lưu điểm cuối.
9. Tạo link phụ huynh và gửi Zalo.

## 9. Kiểm thử bắt buộc

- File đề chỉ có OMML.
- File đề có MathType OLE.
- File đáp án có nhiều MathType OLE trên cùng một dòng.
- Backend MathType tắt: upload phải báo lỗi và không lưu file thiếu công thức.
- Backend trả thiếu một `rId`: upload phải báo rõ công thức lỗi.
- Gmail không nằm trong hồ sơ: đăng nhập học sinh phải bị từ chối.
- AI chấm nhưng chưa xác nhận: không được công bố kết quả.
- Link phụ huynh hiển thị MathJax và ảnh đúng.

## 10. Build và deploy

```bash
npm install
npm run build
```

Sau khi thêm hoặc sửa biến Vercel, luôn Redeploy. Khi sửa Apps Script, tạo **New version** cho Web App `/exec`.

---

## Sửa lỗi Vercel ESM của API

Bản này đã thêm hậu tố `.js` cho toàn bộ import tương đối giữa các file TypeScript trong `api/`. Đây là yêu cầu lúc Node.js chạy ESM sau khi Vercel biên dịch. Nếu log cũ còn báo `Cannot find module '/var/task/api/_auth'`, hãy redeploy commit mới và không dùng lại build cache.
