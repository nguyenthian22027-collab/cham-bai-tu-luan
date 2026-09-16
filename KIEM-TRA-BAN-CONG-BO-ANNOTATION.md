# Báo cáo kiểm tra bản công bố + đánh dấu ảnh

Ngày kiểm tra: 06/08/2026

## Đã kiểm tra

- 49 file TypeScript/TSX: không có lỗi cú pháp parser.
- `tsc --noEmit --noCheck --skipLibCheck`: đạt.
- Toàn bộ import ESM trong `api/` và `server/`: hợp lệ.
- Không thiếu import tương đối nội bộ.
- Apps Script `Code.gs`: qua `node --check` sau khi đổi phần mở rộng tạm.
- 6 file JSON: hợp lệ.
- Kiểm thử parser barem: nội dung nhiều dòng + dòng điểm `0,25`, `0,50` ghép đúng thành các hàng.
- Payload câu hỏi công khai được JSON-sanitize, loại toàn bộ `undefined` lồng nhau.
- ZIP được kiểm tra giải nén bằng `unzip -t`.

## Chưa thực hiện trong môi trường đóng gói

Không chạy được build production đầy đủ với dependency thật vì môi trường này không có `node_modules`. Hãy chạy:

```bash
npm install
npm run build
```

trên máy hoặc để Vercel thực hiện sau khi push source.
