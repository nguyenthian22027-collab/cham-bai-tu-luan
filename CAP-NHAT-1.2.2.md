# Cập nhật v1.2.2

## 1. Xóa vĩnh viễn bài đã giao
- Thêm nút **Xóa** tại trang Bài tự luận cho ADMIN/TEACHER.
- Xác nhận rõ đây là thao tác không thể hoàn tác.
- API mới: `api/delete-assignment.ts`.
- Khi xóa sẽ dọn: `assignments`, `assignmentTargets`, `submissions`, `submissionResults`, `submissionGrades`, `essayResultPublications`, `publicEssayResults`.
- Ảnh trong `essayImages` được gửi sang Apps Script action `deleteImages` để chuyển file Drive vào thùng rác.
- Nếu ảnh Drive xóa thất bại, metadata được giữ ở trạng thái orphan để không mất dấu và API trả cảnh báo.
- `assignmentExams` chỉ bị xóa nếu không còn bài giao nào khác dùng chung `examId`; tránh xóa một lớp làm hỏng lớp khác.

## 2. Phóng to ảnh bài làm cho giáo viên
- Thêm nút **Phóng to ảnh** dưới từng trang ảnh ở khu vực đánh dấu.
- Lightbox toàn màn hình, có zoom 50%–400%, vừa màn hình, mở ảnh gốc và đóng bằng ESC.
- Không ảnh hưởng hệ tọa độ dấu ✓ / ✕ / △ trên ảnh.

## 3. Apps Script
- `Code.gs` lên phiên bản 1.2.2.
- Bổ sung action `deleteImage` và `deleteImages`.
- Kiểm tra file phải thuộc đúng thư mục `EduCenter Essay Images` trước khi xóa hoặc đưa cho Gemini.
- Giữ prompt LaTeX đã tối ưu từ v1.2.1.

## Sau khi cập nhật
1. Copy lại toàn bộ `apps-script/Code.gs` vào Apps Script.
2. **Deploy > Manage deployments > Edit > New version > Deploy** (hoặc New deployment).
3. Giữ nguyên `ESSAY_APPS_SCRIPT_URL` nếu dùng Manage deployments và URL không đổi; nếu tạo deployment mới có URL mới thì cập nhật Vercel.
4. Deploy lại Vercel/GitHub source v1.2.2.
5. `firestore.rules` không cần thêm quyền xóa cascade vì API dùng Firebase Admin; rules v1.2.1 vẫn dùng được.
