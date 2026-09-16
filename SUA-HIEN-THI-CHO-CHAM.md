# Sửa hiển thị 0 điểm khi bài tự luận chưa được chấm

## Nguyên nhân

Khi học sinh nộp bài tự luận, server chấm tự động trả `autoScore = 0` và đánh dấu câu là `pending`. Đây chỉ là điểm tự động của phần chưa thể chấm, không phải điểm cuối.

Bản trước có lưu `pendingCount` vào Firestore nhưng không trả trường này qua `plainSubmission()`. Giao diện vì thế hiểu nhầm `autoScore = 0` là kết quả thật và hiển thị `0/10`, `F - Cần cố gắng`.

## Thay đổi

- Thêm `pendingCount` vào kiểu `Submission`.
- API trả `pendingCount` và `attemptCount` cho học sinh.
- Bài cũ thiếu `pendingCount` được tính lại trên server từ đề gốc.
- Khi `status = submitted`, chưa có điểm cuối và `pendingCount > 0`, giao diện hiển thị:
  - `Đã nộp – chờ chấm`.
  - `Bài đã được ghi nhận`.
  - Không hiển thị 0/10, phần trăm hoặc xếp loại F.
- Trang tự kiểm tra kết quả mới mỗi 15 giây khi đang chờ giáo viên chốt điểm.
- Sau khi nộp, số lượt làm lại được cập nhật từ `attemptCount` mới nhất.

## File đã sửa

- `src/types.ts`
- `server/examStore.js`
- `api/student-assignment.js`
- `src/pages/StudentWorkRoom.tsx`

## Triển khai

Đẩy toàn bộ source mới lên GitHub và tạo deployment mới trên Vercel. Nên bỏ build cache ở lần redeploy đầu tiên.

Bài đã nộp trước đó không cần nộp lại. Khi học sinh mở lại trang, API sẽ tự suy ra số câu đang chờ chấm nếu document cũ chưa có `pendingCount`.
