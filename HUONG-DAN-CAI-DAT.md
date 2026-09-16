# HƯỚNG DẪN CÀI ĐẶT HOÀN CHỈNH

> Đọc thêm `HUONG-DAN-CAP-NHAT-GMAIL-WORD.md` cho phần Firebase hardcode, đăng nhập Gmail và hai file Word.

## 1. Phiên bản này đã thay đổi gì?

Bản này tập trung vào một quy trình duy nhất:

**Giáo viên upload đề Word + đáp án Word → giao bài → học sinh nhập lời giải/tải ảnh → AI gợi ý → giáo viên xác nhận từng câu → tạo trang kết quả → gửi link Zalo phụ huynh.**

Đã gỡ khỏi menu và mã chạy chính các màn:

- Điểm danh, bảng điểm, học phí/thanh toán.
- Nhân sự, ca làm, bảng công, tính lương.
- Trang báo cáo phụ huynh cũ.
- Chế độ bài thi trắc nghiệm/chống chuyển tab trong màn tạo bài mới.

Các collection cũ trên Firestore không bị xóa tự động để tránh mất dữ liệu, nhưng rules mới chặn truy cập từ ứng dụng.

---

## 2. Sao lưu trước khi triển khai

1. Giữ nguyên ZIP đang chạy hiện tại.
2. Trong Firebase Console, xuất dữ liệu quan trọng nếu đang có học sinh/bài làm.
3. Trên Vercel, ghi lại toàn bộ Environment Variables hiện tại.
4. Không xóa project Firebase hoặc dữ liệu cũ trước khi kiểm thử bản mới.

---

## 3. Cài Google Apps Script

### 3.1 Tạo dự án

1. Mở Google Apps Script và tạo **New project**.
2. Trong ZIP mới, mở `apps-script/Code.gs`.
3. Sao chép toàn bộ nội dung vào file `Code.gs` của dự án Apps Script.

Không dùng ba dashboard Apps Script cũ làm trang đăng nhập nữa. Bản mới chỉ dùng Apps Script như cầu nối server để:

- Lưu ảnh lên Google Drive.
- Đọc ảnh từ Drive.
- Gọi Gemini chấm bài.

### 3.2 Tạo secret

Có thể tạo chuỗi ngẫu nhiên bằng PowerShell:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | ForEach-Object {[char]$_})
```

Hoặc Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3.3 Script Properties

Vào **Project Settings → Script properties** và thêm:

```text
API_SECRET      = chuỗi ngẫu nhiên vừa tạo
GEMINI_API_KEY  = API key Gemini
GEMINI_MODEL    = gemini-3.6-flash
```

`DRIVE_FOLDER_ID` là tùy chọn. Bỏ trống để script tự tạo thư mục `EduCenter Essay Images`.

### 3.4 Cấp quyền và deploy Web App

1. Trên thanh chọn hàm, chọn `authorizeEssayBridge` rồi bấm **Run** một lần.
2. Chấp nhận quyền Google Drive và kết nối dịch vụ ngoài.
3. Chọn **Deploy → New deployment**.
4. Type: **Web app**.
5. Execute as: **Me**.
6. Who has access: **Anyone**.
7. Bấm Deploy.
8. Sao chép URL dạng:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Lưu ý: sau khi sửa Apps Script, vào **Manage deployments → Edit → New version → Deploy**. Chỉ bấm Save trong trình soạn thảo là chưa cập nhật bản `/exec`.

---

## 4. Cấu hình Firebase

### 4.1 Firebase Authentication

Bật:

- Authentication → Sign-in method → Google.
- Authentication → Sign-in method → Email/Password, vì tài khoản học sinh dùng email nội bộ do ứng dụng tạo.

Thêm domain Vercel production vào **Authorized domains** nếu Firebase chưa tự thêm.

### 4.2 Firebase Web configuration hardcode

Lấy thông tin từ **Project settings → Your apps → Web app** và dán trực tiếp 6 giá trị vào `src/config/firebase.ts`. Không còn dùng các biến `VITE_FIREBASE_*`. Xem chi tiết trong `HUONG-DAN-CAP-NHAT-GMAIL-WORD.md`.

### 4.3 Firebase Admin service account

1. Firebase Console → Project settings → Service accounts.
2. Chọn **Generate new private key**.
3. Mở file JSON vừa tải.
4. Thu gọn thành một dòng rồi đặt vào biến Vercel:

```text
FIREBASE_SERVICE_ACCOUNT_JSON
```

Không đưa file JSON service account vào GitHub.

### 4.4 Dán Firestore Rules

Cách dùng Console:

1. Firebase Console → Firestore Database → Rules.
2. Mở file `firestore.rules` trong ZIP mới.
3. Dán toàn bộ và bấm **Publish**.

Cách dùng Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use YOUR_PROJECT_ID
firebase deploy --only firestore:rules,firestore:indexes
```

Rules mới chỉ cho phép ứng dụng truy cập tài khoản, lớp, học sinh, bài tự luận, bài nộp và phần chấm. Dữ liệu trang kết quả công khai chỉ được API Firebase Admin đọc/ghi.

### 4.5 Thiết lập quản trị viên đầu tiên

Ứng dụng không tự cấp quyền admin.

1. Deploy web tạm thời và đăng nhập Google một lần.
2. Firebase Console → Firestore → collection `users` → document có UID của tài khoản vừa đăng nhập.
3. Sửa:

```text
role        = ADMIN
isApproved  = true
```

4. Đăng xuất rồi đăng nhập lại.

Các giáo viên đăng nhập sau sẽ ở trạng thái `TEACHER`, `isApproved=false`; admin duyệt trong menu **Người dùng**.

---

## 5. Cấu hình Vercel

Trong Vercel → Project → Settings → Environment Variables, thêm:

```text
FIREBASE_SERVICE_ACCOUNT_JSON

ESSAY_APPS_SCRIPT_URL
ESSAY_APPS_SCRIPT_SECRET
PUBLIC_APP_URL

ZALO_BACKEND_URL
ZALO_BACKEND_API_KEY
```

Quy tắc quan trọng:

- `ESSAY_APPS_SCRIPT_SECRET` phải giống chính xác `API_SECRET` trong Apps Script.
- `PUBLIC_APP_URL` là URL production, ví dụ `https://chambai.example.com`, không có dấu `/` ở cuối.
- Không tạo biến `VITE_GEMINI_API_KEY`. Gemini key chỉ nằm trong Apps Script Properties.
- Sau khi đổi Environment Variables, bấm **Redeploy**.

---

## 6. Đưa mã lên GitHub và Vercel

Tại thư mục dự án:

```bash
npm install
npm run build
```

Nếu build thành công:

```bash
git add .
git commit -m "Focus app on essay grading and public parent results"
git push
```

Vercel sẽ tự deploy nếu repository đã kết nối. Kiểm tra deployment không có lỗi ở Functions:

- `/api/essay-image`
- `/api/grade-essay`
- `/api/publish-result`
- `/api/public-result`
- `/api/zalo`

---

## 7. Quy trình sử dụng

### Giáo viên

1. Tạo lớp và thêm học sinh.
2. Khai báo `Email Gmail học sinh`, hoặc tạo tài khoản username/password dự phòng.
3. Vào **Bài tự luận & chấm bài → Tạo bài mới**.
4. Upload file đề Word `.docx`.
5. Upload file đáp án Word `.docx`; kiểm tra `Đã ghép X/X câu`.
6. Kiểm tra đề, MathType/LaTeX, lời giải và cấu hình điểm.
7. Chọn lớp, học sinh, thời gian mở/hạn nộp và giao bài.

### Học sinh

1. Đăng nhập bằng Gmail đã khai báo hoặc tài khoản học sinh dự phòng.
2. Mở bài tự luận.
3. Nhập lời giải, công thức hoặc tải ảnh JPG/PNG/WebP.
4. Ảnh được nén, tải lên Drive ngay; Firestore chỉ lưu metadata và URL.
5. Nộp bài.

### Chấm bài

1. Mở **Chấm bài** và chọn học sinh.
2. Bấm **AI chấm gợi ý**.
3. AI trả điểm gợi ý, nhận xét Markdown/MathJax và các bước đúng/sai.
4. Kiểm tra từng câu, sửa điểm/nhận xét nếu cần.
5. Bấm **Xác nhận điểm câu** cho từng câu.
6. Nhập nhận xét tổng hợp và bấm **Lưu điểm cuối**.
7. Hệ thống không cho lưu điểm cuối khi còn câu chỉ ở trạng thái gợi ý AI.

### Công bố và gửi Zalo

1. Sau khi lưu điểm cuối, bấm **Tạo link kết quả**.
2. Mở link để kiểm tra giao diện phụ huynh.
3. Bấm **Gửi Zalo phụ huynh**, hoặc **Sao chép** để gửi thủ công.
4. Có thể bấm **Thu hồi link**; trang công khai sẽ trả thông báo link đã bị thu hồi.

Trang `/result/<token>` có:

- Bài làm văn bản và ảnh gốc.
- Dấu ✓ / ✕ / △ theo vị trí AI nhận diện được.
- Đối chiếu từng bước.
- Markdown qua Showdown, làm sạch bằng DOMPurify.
- Công thức qua MathJax.
- Nút in hoặc lưu PDF.

Dấu trên ảnh là lớp HTML phủ lên ảnh; ảnh gốc trên Drive không bị ghi đè.

---

## 8. File Word tự luận nên có cấu trúc

Ví dụ:

```text
PHẦN TỰ LUẬN

Câu 1. Giải phương trình $x^2 - 5x + 6 = 0$.

Đáp án: Nêu rõ barem hoặc các ý cần đạt.
Lời giải: ...

Câu 2. Chứng minh ...
Đáp án: ...
Lời giải: ...
```

Sau khi upload, luôn mở **Xem / chỉnh đề** để kiểm tra câu đã được nhận đúng loại **Tự luận**.

---

## 9. Kiểm thử bắt buộc trước khi dùng thật

Tạo một lớp thử và một học sinh thử, sau đó kiểm tra đủ các trường hợp:

1. Học sinh chỉ nhập văn bản.
2. Học sinh chỉ nộp một ảnh.
3. Học sinh nộp nhiều ảnh.
4. Ảnh lớn được nén và upload thành công.
5. AI trả công thức và MathJax hiển thị đúng.
6. AI gợi ý nhưng chưa xác nhận: không lưu được điểm cuối.
7. Xác nhận đủ câu: lưu được điểm cuối.
8. Link phụ huynh mở được khi chưa đăng nhập.
9. Thu hồi link: phụ huynh không mở lại được.
10. Số phụ huynh sai/thiếu: nút Zalo báo rõ và vẫn sao chép link được.
11. Mở link trên điện thoại và thử in/lưu PDF.

---

## 10. Xử lý lỗi thường gặp

### “Thiếu ESSAY_APPS_SCRIPT_URL hoặc ESSAY_APPS_SCRIPT_SECRET”

Thêm hai biến vào Vercel và Redeploy.

### “Sai API secret”

`ESSAY_APPS_SCRIPT_SECRET` trên Vercel không giống `API_SECRET` trong Apps Script.

### “Apps Script trả dữ liệu không hợp lệ”

Thường do dùng URL `/dev`, deployment cũ, hoặc Web App không để quyền **Anyone**. Dùng URL `/exec` và tạo version mới.

### “Google Workspace đang chặn chia sẻ Anyone with link”

Admin Workspace đang chặn chia sẻ công khai. Cho phép chia sẻ link hoặc chạy Apps Script bằng tài khoản Google khác có quyền chia sẻ.

### Gemini lỗi 404 model

Đổi `GEMINI_MODEL` trong Script Properties sang model được API key hiện tại hỗ trợ, rồi thử lại. Không cần sửa mã React.

### Gemini lỗi quota/rate limit

Đợi quota hồi phục hoặc dùng API key/project có quota phù hợp. Mỗi lần bấm AI chấm một câu là một lần gọi Gemini; upload ảnh không gọi Gemini.

### “Hãy lưu điểm cuối trước khi công bố”

Bài nộp chưa có trạng thái `graded`. Xác nhận từng câu rồi bấm **Lưu điểm cuối**.

### Link mở ra 404 sau khi deploy

Kiểm tra `vercel.json` còn rewrite SPA và `PUBLIC_APP_URL` đúng domain production.

### Ảnh cũ base64 không hiện trong bản mới

Bản mới cố ý không tiếp tục lưu base64 trong Firestore. Các bài nháp cũ dạng base64 nên được hoàn thành ở bản cũ hoặc học sinh tải lại ảnh sau khi nâng cấp.

---

## 11. Giới hạn cần biết

- Drive được đặt “Anyone with link” để trình duyệt phụ huynh xem ảnh. Thu hồi token sẽ chặn trang kết quả, nhưng một người đã sao chép URL Drive trực tiếp trước đó vẫn có thể mở ảnh. Không đưa link kết quả lên nơi công khai.
- Tọa độ dấu ✓/✕ là gợi ý của AI, có thể không chính xác với ảnh nghiêng/mờ. Nhận xét văn bản và xác nhận của giáo viên là nguồn kết quả chính.
- AI không thay thế quyết định của giáo viên.

---

## 12. Các file quan trọng đã thêm/sửa

```text
apps-script/Code.gs
api/_essayAppsScript.ts
api/essay-image.ts
api/grade-essay.ts
api/publish-result.ts
api/public-result.ts
src/components/MarkdownMath.tsx
src/components/EssayQuestionInput.tsx
src/components/EssayGraderPanel.tsx
src/pages/PublicEssayResult.tsx
src/pages/AssignmentGrading.tsx
src/services/publicResultService.ts
src/services/essayGradingService.ts
firestore.rules
.env.example
```
