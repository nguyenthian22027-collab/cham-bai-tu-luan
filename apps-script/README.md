# Apps Script Essay Bridge

File cần dùng: `Code.gs`.

## Script Properties

Trong Apps Script vào **Project Settings → Script properties**, tạo:

| Tên | Bắt buộc | Giá trị |
|---|---:|---|
| `API_SECRET` | Có | Chuỗi bí mật dài, phải giống `ESSAY_APPS_SCRIPT_SECRET` trên Vercel |
| `GEMINI_API_KEY` | Có | API key Gemini; tuyệt đối không đặt trong mã React |
| `GEMINI_MODEL` | Không | Mặc định `gemini-3.6-flash`; có thể đổi khi model tài khoản hỗ trợ thay đổi |
| `DRIVE_FOLDER_ID` | Không | ID thư mục Drive. Bỏ trống để script tự tạo `EduCenter Essay Images` |

## Deploy

1. Tạo một dự án Apps Script độc lập.
2. Xóa mã mẫu, dán toàn bộ `Code.gs`.
3. Chọn hàm `authorizeEssayBridge` và bấm **Run** một lần để cấp quyền Drive và gọi API ngoài.
4. Chọn **Deploy → New deployment → Web app**.
5. Execute as: **Me**.
6. Who has access: **Anyone**.
7. Sao chép URL kết thúc bằng `/exec` sang `ESSAY_APPS_SCRIPT_URL` trên Vercel.
8. Mỗi lần sửa `Code.gs`, tạo **New version** trong Manage deployments.

Bảo mật endpoint dựa trên `API_SECRET`; Apps Script không được gọi trực tiếp từ trình duyệt. Trình duyệt gọi API Vercel có Firebase ID token, Vercel mới gọi Apps Script.
