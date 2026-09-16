# Bản sửa công bố kết quả, định dạng nhận xét và đánh dấu ảnh

## 1. Lỗi tạo link Firestore

Lỗi cũ:

```text
Cannot use "undefined" as a Firestore value
(found in field "questions.0.aiDetails")
```

`api/publish-result.ts` nay làm sạch sâu riêng toàn bộ `questions` bằng JSON trước khi ghi Firestore. Các thuộc tính tùy chọn như `aiDetails`, `thumbnailUrl`, `size`, `x`, `y` không còn mang `undefined`. `serverTimestamp()` của payload chính vẫn được giữ nguyên.

Sau khi deploy Vercel, có thể bấm **Tạo link kết quả** lại ngay. Không cần xóa bài, chấm lại hoặc tạo submission mới.

## 2. Nhận xét dễ đọc

`MarkdownMath` nay:

- Bỏ ký hiệu tiêu đề `#`, `##`, `###` khi hiển thị.
- Chuyển chuỗi `\\n` thành xuống dòng thật.
- Tự xuống dòng trước các mục đánh số và tiêu đề in đậm.
- Tăng khoảng cách đoạn, danh sách và dòng.

Dữ liệu cũ trong Firestore không bị thay đổi; chỉ lớp hiển thị được làm sạch.

## 3. Đáp án/barem dạng bảng

Thêm `SolutionScoreTable.tsx`.

Nếu nội dung file Word được đọc thành dạng:

```text
Gọi x là chiều rộng...
0,25
Lập phương trình...
0,50
```

hệ thống tự hiển thị bảng:

| STT | Ý / bước trong lời giải | Điểm |
|---|---|---|
| 1 | Gọi x là chiều rộng... | 0,25 |
| 2 | Lập phương trình... | 0,50 |

Bảng được dùng tại:

- Màn AI gợi ý chấm.
- Màn giáo viên xem/chấm chi tiết.
- Màn xem lại đề.
- Màn học sinh xem lời giải khi được phép.
- Trang kết quả công khai cho phụ huynh.

Nếu không nhận dạng được dòng điểm, nội dung được hiển thị nguyên văn.

## 4. Đặt dấu trực tiếp lên ảnh bài làm

Trong **Chấm bài → Bài làm chi tiết**, tại mỗi câu tự luận có ảnh:

1. Chọn `✓ Đúng`, `✕ Sai` hoặc `△ Một phần`.
2. Nhập ghi chú cho dấu, hoặc để trống để dùng câu mặc định.
3. Bấm đúng vị trí trên ảnh.
4. Có thể bấm vào dấu đã đặt để xóa.
5. Bấm **Lưu điểm & dấu ảnh** hoặc **Xác nhận điểm & dấu ảnh**.
6. Bấm **Cập nhật trang kết quả** nếu link đã được tạo trước đó.

Tọa độ được lưu theo tỷ lệ `0..1`, nên dấu giữ đúng vị trí khi ảnh thay đổi kích thước. Ảnh Drive gốc không bị sửa.

## 5. Cập nhật Apps Script

`apps-script/Code.gs` đã yêu cầu Gemini trả thêm:

```json
{
  "awardedPoints": 0.25,
  "maxPoints": 0.5
}
```

và yêu cầu nhận xét xuống dòng, không dùng ký hiệu `#`.

Để dùng điểm theo từng ý do AI gợi ý:

1. Dán lại `apps-script/Code.gs`.
2. **Deploy → Manage deployments → Edit**.
3. Chọn **New version**.
4. Bấm **Deploy**.

Nếu chưa cập nhật Apps Script, bảng đáp án và đánh dấu ảnh thủ công vẫn hoạt động; chỉ cột điểm theo từng bước AI có thể chưa có.

## 6. Triển khai

```bash
npm install
npm run build
git add .
git commit -m "Fix public result formatting and image annotations"
git push
```

Trên Vercel, deploy commit mới. Lần đầu nên bỏ dùng lại Build Cache.
