# HƯỚNG DẪN CẬP NHẬT: FIREBASE HARDCODE, HỌC SINH ĐĂNG NHẬP GMAIL, ĐỀ + ĐÁP ÁN WORD

## 1. Hardcode Firebase Web config

Mở file:

```text
src/config/firebase.ts
```

Thay đúng 6 giá trị sau:

```ts
const firebaseConfig = {
  apiKey: 'PASTE_FIREBASE_API_KEY',
  authDomain: 'PASTE_FIREBASE_AUTH_DOMAIN',
  projectId: 'PASTE_FIREBASE_PROJECT_ID',
  storageBucket: 'PASTE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'PASTE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'PASTE_FIREBASE_APP_ID',
} as const;
```

Lấy các giá trị tại:

```text
Firebase Console
→ Project settings
→ General
→ Your apps
→ Web app
→ SDK setup and configuration
→ Config
```

Sau khi dán xong, không cần tạo các biến `VITE_FIREBASE_*` trên Vercel nữa.

Lưu ý: Firebase Web config là cấu hình public của web app. Không dán `FIREBASE_SERVICE_ACCOUNT_JSON`, private key hoặc Apps Script secret vào file frontend.

---

## 2. Bật đăng nhập Google cho học sinh

Trong Firebase Console:

```text
Authentication
→ Sign-in method
→ Google
→ Enable
→ Save
```

Nếu vẫn muốn giữ tài khoản tên đăng nhập/mật khẩu dự phòng, tiếp tục bật cả `Email/Password`.

Trong Authentication → Settings → Authorized domains, thêm domain Vercel production nếu chưa có.

---

## 3. Khai báo Gmail cho từng học sinh

Giáo viên hoặc admin mở:

```text
Học sinh & Gmail
```

Sửa từng học sinh và điền trường:

```text
Email Google học sinh
```

Ví dụ:

```text
nguyenvana@gmail.com
```

Quy tắc:

- Gmail phải đúng chính xác tài khoản học sinh sẽ dùng.
- Một Gmail chỉ được gán cho một học sinh.
- Hồ sơ học sinh phải có trạng thái `Đang học`.
- Email phụ huynh và Gmail học sinh là hai trường khác nhau.

Có thể import Excel. File mẫu mới đã có cột `Email Google học sinh`.

---

## 4. Cách học sinh đăng nhập Gmail

Học sinh mở:

```text
https://TEN-MIEN/student-login
```

Sau đó bấm:

```text
Đăng nhập Gmail học sinh
```

Hệ thống thực hiện:

1. Firebase xác thực tài khoản Google.
2. Tìm hồ sơ `students` có `studentEmail` trùng Gmail.
3. Nếu trùng đúng một hồ sơ đang hoạt động, tạo/liên kết profile `users/{uid}` với role `STUDENT`.
4. Nếu không trùng, hệ thống đăng xuất và từ chối truy cập.

Tài khoản Google không cần mật khẩu do giáo viên cấp. Tài khoản tên/mật khẩu cũ vẫn dùng được làm dự phòng.

Nếu học sinh đã từng bấm nhầm trang đăng nhập giáo viên và bị tạo profile `TEACHER` chờ duyệt, admin cần xóa document tương ứng trong collection `users`, sau đó học sinh đăng nhập lại tại `/student-login`.

---

## 5. Dán Firestore Rules mới

Mở file:

```text
firestore.rules
```

Dán toàn bộ vào Firebase Console → Firestore Database → Rules → Publish.

Rules mới cho phép tài khoản Google chưa có profile chỉ đọc đúng hồ sơ học sinh có `studentEmail` trùng email trong Firebase token. Tài khoản không thể tự chọn một `studentId` khác.

---

## 6. Chuẩn bị file đề Word

Dùng file `.docx`, mỗi câu bắt đầu bằng một trong các dạng:

```text
Câu 1. Nội dung câu hỏi...
Câu 2: Nội dung câu hỏi...
Bài 3. Nội dung câu hỏi...
```

Có thể có tiêu đề:

```text
PHẦN TỰ LUẬN
```

Hỗ trợ:

- Văn bản Word.
- Công thức OMML của Word Equation.
- MathType OLE theo logic chuyển đổi hiện có.
- Hình vẽ nhúng trong Word.
- LaTeX có sẵn trong văn bản.

Không cần chụp từng câu thành ảnh. Hệ thống giải nén `.docx` và lưu nội dung đã chuyển thành văn bản/LaTeX.

---

## 7. Chuẩn bị file đáp án Word

Số câu trong file đáp án phải khớp file đề:

```text
Câu 1. ...
Lời giải:
Nội dung lời giải câu 1

Câu 2. ...
Lời giải:
Nội dung lời giải câu 2
```

Các marker được nhận diện:

```text
Lời giải:
Đáp án:
Hướng dẫn giải:
```

Nếu file đáp án chỉ ghi:

```text
Câu 1. Nội dung lời giải...
```

thì toàn bộ nội dung sau `Câu 1.` được dùng làm lời giải.

MathType OLE trong file đáp án được chuyển thành LaTeX đúng một lần khi upload. Lời giải LaTeX được lưu cùng đề và tái sử dụng ở mọi lượt chấm.

Hình trong file đáp án được giữ để giáo viên đối chiếu nhưng mặc định không gửi sang Gemini, giúp giảm dữ liệu ảnh và chi phí multimodal.

---

## 8. Tạo bài bằng hai file Word

Mở:

```text
Bài tự luận & chấm bài
→ Tạo bài mới
```

Thực hiện theo thứ tự:

1. Upload `File đề Word`.
2. Upload `File đáp án Word`.
3. Kiểm tra chỉ số `Đã ghép X/Y câu`.
4. Mở `Xem đề + đáp án` để kiểm tra MathJax, hình và lời giải.
5. Cấu hình điểm.
6. Chọn lớp, học sinh và giao bài.

Hệ thống không cho giao nếu chưa ghép đủ đáp án cho mọi câu.

---

## 9. Khi nào hệ thống dùng API?

### Không dùng Gemini khi:

- Upload file đề Word.
- Upload file đáp án Word.
- Tách câu hỏi.
- Đọc Word Equation/OMML.
- Lưu nội dung đề và lời giải.
- Hiển thị MathJax.

### Có dùng server MathType khi:

File Word chứa MathType OLE. Trình duyệt gửi riêng các OLE `.bin` đến server chuyển MathType hiện có để đổi sang LaTeX. Việc này chỉ xảy ra một lần cho mỗi file được upload, không lặp lại khi chấm từng học sinh.

URL server được cấu hình tại:

```text
src/services/mathWordParserService.ts
```

hoặc biến hiện có:

```text
VITE_MATHTYPE_SERVER_URL
```

### Dùng Gemini khi:

Giáo viên bấm:

```text
AI chấm gợi ý
```

Gemini nhận:

- Nội dung câu hỏi đã lưu.
- Lời giải/đáp án LaTeX đã lưu.
- Văn bản bài học sinh.
- Ảnh bài làm học sinh nếu có.

Gemini không phải tải và đọc lại file Word.

---

## 10. Biến Vercel còn cần

Không còn cần:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Vẫn cần các biến server:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
ESSAY_APPS_SCRIPT_URL
ESSAY_APPS_SCRIPT_SECRET
PUBLIC_APP_URL
ZALO_BACKEND_URL
ZALO_BACKEND_API_KEY
```

Nếu dùng server MathType production qua biến môi trường:

```text
VITE_MATHTYPE_SERVER_URL
```

---

## 11. Apps Script

Apps Script vẫn chỉ phụ trách:

- Upload ảnh bài làm lên Google Drive.
- Đọc ảnh bài làm từ Drive khi chấm.
- Gọi Gemini.

Không cần đưa file đề Word hoặc file đáp án Word lên Apps Script.

Script Properties:

```text
API_SECRET
GEMINI_API_KEY
GEMINI_MODEL=gemini-3.6-flash
```

---

## 12. Kiểm thử trước khi deploy

```bash
npm install
npm run build
```

Sau đó kiểm thử:

1. Admin/giáo viên thêm Gmail cho một học sinh.
2. Học sinh đăng nhập tại `/student-login` bằng đúng Gmail.
3. Upload file đề Word có MathType OLE.
4. Upload file đáp án Word có MathType OLE.
5. Kiểm tra `Đã ghép X/X câu`.
6. Giao bài.
7. Học sinh nộp văn bản hoặc ảnh.
8. Giáo viên bấm AI chấm gợi ý.
9. Xác nhận từng câu, công bố kết quả và gửi Zalo.
10. Thử một Gmail không được khai báo; hệ thống phải từ chối.


## 13. Lưu ý về file đáp án chỉ có ảnh

Để không phải gọi AI/OCR đọc lại đáp án ở mỗi lượt chấm, mỗi câu trong file đáp án phải có **văn bản, Equation/OMML hoặc MathType OLE**. Ảnh minh họa vẫn được giữ để giáo viên xem, nhưng mặc định không gửi sang Gemini. Hệ thống sẽ không cho giao bài nếu câu nào chỉ có ảnh mà không có lời giải chữ/LaTeX có thể tái sử dụng.

---

## 15. Xác nhận backend MathType OLE của dự án

Bản này sử dụng trực tiếp logic `mathWordParserService.ts` v10 do dự án cung cấp:

- tìm `word/embeddings/*.bin` theo relationship `oleObject`;
- gọi `GET {VITE_MATHTYPE_SERVER_URL}/health`;
- gọi `POST {VITE_MATHTYPE_SERVER_URL}/v1/convert`;
- ghép LaTeX về đúng `rId` trong `document.xml`.

Backend render MathType không nằm trong ZIP frontend vì đang được triển khai riêng. Chỉ cần cấu hình URL production và CORS. Nếu một công thức không chuyển được, bản cuối dừng import để tránh mất công thức âm thầm.
