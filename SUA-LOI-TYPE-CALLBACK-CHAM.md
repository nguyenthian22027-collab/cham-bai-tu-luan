# Sửa lỗi TypeScript callback chấm bài

## Lỗi

```text
src/pages/AssignmentGrading.tsx(...): error TS2322
Type '(q, score, feedback, aiScore?, aiFeedback?, aiDetails?, status?) => Promise<...>'
is not assignable to type '(q, score, feedback, aiDetails?) => void'.
```

## Nguyên nhân

`saveQ()` đã được mở rộng để nhận lần lượt:

```text
q, score, feedback, aiScore, aiFeedback, aiDetails, status
```

nhưng prop `QuestionGradeBlock.onSave` vẫn dùng chữ ký cũ, trong đó tham số thứ tư là `aiDetails`. Vì vậy TypeScript hiểu `EssayAiDetails` đang được truyền vào vị trí `aiScore: number`.

## Cách sửa

- Đồng bộ kiểu `onSave` với đầy đủ bảy tham số của `saveQ()`.
- Đổi kiểu trả về thành `Promise<void>`.
- Nút xác nhận truyền đúng thứ tự:
  - `grade?.aiScore`
  - `grade?.aiFeedback`
  - `details`
  - `'GRADED'`
- Dùng `void onSave(...)` trong sự kiện click.

Việc này vừa hết lỗi build, vừa bảo toàn gợi ý AI và dấu ảnh khi giáo viên xác nhận điểm.
