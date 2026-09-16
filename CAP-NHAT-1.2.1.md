# Cập nhật 1.2.1

Bản này tập trung sửa lỗi chấm tự luận và tăng an toàn cho luồng bài làm.

- Sửa Markdown + LaTeX trong nhận xét giáo viên, AI và màn học sinh; bảo vệ vùng `$...$` trước Showdown và chờ MathJax/Markdown CDN sẵn sàng.
- Thêm cơ chế sửa mềm trường hợp AI vô tình bọc cả câu tiếng Việt trong một cặp `$...$`.
- Thêm xem trước nhận xét Markdown/LaTeX khi giáo viên nhập nhận xét câu và nhận xét cuối.
- Khi làm lại: xóa điểm/nhận xét/chú thích lượt cũ, xóa kết quả cũ, reset điểm cuối và dọn ảnh Drive của lượt trước theo cơ chế best-effort.
- Không trả đáp án/lời giải khi học sinh vẫn còn quyền làm lại. Chỉ review đầy đủ khi hết quyền retry hoặc bài đã chấm/đóng/hết hạn.
- Chấm AI lấy đề, rubric và bài làm trực tiếp từ Firestore phía server thay vì tin payload từ client.
- Ảnh upload có metadata ownership `essayImages`; chấm/xóa ảnh xác minh đúng assignment/học sinh/câu hỏi.
- Xóa ảnh mới sẽ đồng thời xóa file Drive; ảnh legacy không có metadata chỉ gỡ khỏi bài để tránh xóa nhầm file.
- `public-image` không còn fetch URL tùy ý; chỉ dựng URL Google Drive từ `fileId`, có kiểm tra MIME và giới hạn dung lượng.
- Sửa hệ tọa độ dấu ✓/✕/△ theo khung ảnh hiển thị thật để tránh lệch khi ảnh dọc/có `max-height`.
- Đồng bộ cách đọc biến môi trường Firebase Admin và bổ sung `.env.example`.

## Lưu ý khi cập nhật Apps Script

Cần copy lại `apps-script/Code.gs` và deploy lại Web App vì bản này bổ sung action xóa ảnh (`deleteImage`, `deleteImages`) và siết định dạng phản hồi Gemini.
