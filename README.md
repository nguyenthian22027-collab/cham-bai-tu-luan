# EduCenter — Chấm bài tự luận từ Word

Ứng dụng React + Firebase tập trung vào quy trình:

- Giáo viên upload riêng **file đề Word** và **file đáp án Word**.
- Word Equation/OMML và MathType OLE được chuyển thành LaTeX khi upload.
- Nội dung đề/đáp án được lưu một lần; Gemini không đọc lại file Word khi chấm.
- Học sinh đăng nhập bằng Gmail đã gắn với hồ sơ, hoặc tài khoản dự phòng.
- Học sinh nhập lời giải hoặc tải ảnh bài viết tay lên Google Drive.
- Gemini tạo gợi ý chấm; giáo viên xác nhận điểm cuối.
- Kết quả công khai bằng token, Showdown + DOMPurify + MathJax và gửi Zalo.

## Cài đặt

Đọc theo thứ tự:

1. `HUONG-DAN-TRIEN-KHAI-CUOI.md`
2. `HUONG-DAN-CAP-NHAT-GMAIL-WORD.md`
3. `HUONG-DAN-CAI-DAT.md`

Sau khi điền Firebase config trong `src/config/firebase.ts`:

```bash
npm install
npm run build
npm run dev
```

## Kiến trúc

```text
Word đề + Word đáp án
   ├─ JSZip đọc DOCX tại trình duyệt
   ├─ Word Equation/OMML → text/LaTeX
   └─ MathType OLE → server chuyển đổi một lần
                         │
                         ▼
                 Firestore payload chunks
                         │
Học sinh nộp text/ảnh ───┴──► Giáo viên bấm chấm
                                  │
                                  ▼
                           Vercel API + Apps Script
                                  │
                                  ▼
                                Gemini
```

Firebase Web config được hardcode trong frontend. Firebase Admin service account, Gemini key và Apps Script secret vẫn phải nằm ở server, không đưa lên GitHub.


Backend MathType OLE hiện có được cấu hình bằng `VITE_MATHTYPE_SERVER_URL` và phải cung cấp `GET /health`, `POST /v1/convert`.

---

## Bản 1.1.0 — công bố kết quả và đánh dấu ảnh

- Làm sạch `undefined` trước khi ghi kết quả công khai lên Firestore.
- Nhận xét Markdown xuống dòng rõ và không hiện ký hiệu `#`.
- Hiển thị đáp án/barem Word thành bảng ý và điểm khi nhận dạng được.
- Giáo viên đặt dấu ✓ / ✕ / △ trực tiếp lên ảnh bài làm.
- Dấu được lưu theo tọa độ tương đối và hiển thị trong link phụ huynh.

Xem `SUA-LOI-CONG-BO-DINH-DANG-DANH-DAU-ANH.md`.
