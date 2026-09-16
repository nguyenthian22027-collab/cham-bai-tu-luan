# Sửa lỗi Vercel `ERR_MODULE_NOT_FOUND`

## Triệu chứng

API trả HTTP 500 và log có dạng:

```text
Cannot find module '/var/task/api/_auth' imported from /var/task/api/essay-image.js
```

## Nguyên nhân

Dự án dùng `"type": "module"`. Sau khi Vercel biên dịch file TypeScript thành JavaScript, Node.js chạy theo ESM và yêu cầu import tương đối phải trỏ tới tên file JavaScript đầy đủ.

Sai:

```ts
import { requireApprovedUser } from './_auth';
```

Đúng:

```ts
import { requireApprovedUser } from './_auth.js';
```

TypeScript/Vercel sẽ ánh xạ import `.js` này về file nguồn `.ts` khi build và tạo `_auth.js` khi chạy.

## File đã sửa

- `api/_auth.ts`
- `api/essay-image.ts`
- `api/grade-essay.ts`
- `api/publish-result.ts`
- `api/public-result.ts`

Các import tới `_auth`, `_firebaseAdmin`, `_essayAppsScript` đều đã có hậu tố `.js`.

## Triển khai

1. Thay mã GitHub bằng bản ZIP sửa lỗi.
2. Commit và push.
3. Trong Vercel chọn **Redeploy**; nên bỏ chọn dùng lại Build Cache nếu giao diện có tùy chọn đó.
4. Thử lại tải ảnh bài làm.

Lỗi này không liên quan tới việc học sinh đăng nhập bằng Gmail tự động. Tài khoản học sinh hiện tại vẫn có thể nộp bài nếu đã đăng nhập, được duyệt và có `studentId` hợp lệ.
