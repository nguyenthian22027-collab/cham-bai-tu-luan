import { BookOpen, CheckCircle, XCircle, AlertTriangle, FileText, FileCheck2 } from 'lucide-react';
import Modal from './Modal';

interface Props {
  open: boolean;
  onClose: () => void;
}

const DO_ITEMS_QUESTION = [
  'Đặt tên câu: "Câu 1:" hoặc "Bài 1:" ở đầu mỗi câu',
  'Mỗi câu là một đoạn văn riêng biệt (Enter sau mỗi câu)',
  'Dùng MathType OLE hoặc Word Equation (Insert → Equation)',
  'Ảnh minh họa chèn trực tiếp vào trong đoạn câu',
  'Sub-phần viết là "a)" "b)" "c)" trên cùng dòng hoặc đoạn riêng',
];
const DONT_ITEMS_QUESTION = [
  'Dùng ảnh chụp/screenshot công thức toán',
  'Gõ công thức bằng ký tự thường (không dùng Equation)',
  'Số câu ở trong bảng mà không có tên "Câu X" rõ ràng',
];
const DO_ITEMS_ANSWER = [
  'Mỗi câu bắt đầu bằng "Câu 1:" hoặc "Bài 1:"',
  'Thêm dòng "Lời giải:" hoặc "Đáp án:" ngay dưới tiêu đề câu',
  'Công thức trong lời giải dùng MathType OLE hoặc Word Equation',
  'Số câu trong file đáp án phải khớp với file đề',
];
const DONT_ITEMS_ANSWER = [
  'Để toàn bộ lời giải là ảnh chụp (không đọc được LaTeX)',
  'Bỏ dòng "Lời giải:" — hệ thống sẽ không tách đúng nội dung',
  'Đánh số câu khác với file đề (VD: đề có "Câu 1", đáp án ghi "1.")',
];

const EXAMPLE_QUESTION = `Câu 1: Cho hàm số f(x) = x² + 2x − 3.
   a) Tính f(1)    b) Tìm x để f(x) = 0

Câu 2: Giải phương trình...`;

const EXAMPLE_ANSWER = `Câu 1:
Lời giải:
a) f(1) = 1 + 2 − 3 = 0
b) x² + 2x − 3 = 0 ⟹ x = 1 hoặc x = −3

Câu 2:
Lời giải:
...`;

export default function WordFileGuideModal({ open, onClose }: Props) {
  return (
    <Modal open={open} onClose={onClose} title={<><BookOpen size={18} /> Hướng dẫn chuẩn bị file Word</>} size="modal-lg">
      <div className="word-guide-modal">
        <p className="word-guide-intro">
          Hệ thống đọc file Word theo cấu trúc văn bản — <strong>không gọi AI</strong>. Để hiển thị đúng và đẹp, cần soạn file theo hướng dẫn sau.
        </p>

        <div className="word-guide-grid">
          {/* File đề */}
          <div className="word-guide-col">
            <div className="word-guide-col-title">
              <FileText size={16} /> File đề
            </div>
            <ul className="word-guide-list">
              {DO_ITEMS_QUESTION.map((item) => (
                <li key={item} className="word-guide-do">
                  <CheckCircle size={15} /> {item}
                </li>
              ))}
              {DONT_ITEMS_QUESTION.map((item) => (
                <li key={item} className="word-guide-dont">
                  <XCircle size={15} /> {item}
                </li>
              ))}
            </ul>
          </div>

          {/* File đáp án */}
          <div className="word-guide-col">
            <div className="word-guide-col-title">
              <FileCheck2 size={16} /> File đáp án
            </div>
            <ul className="word-guide-list">
              {DO_ITEMS_ANSWER.map((item) => (
                <li key={item} className="word-guide-do">
                  <CheckCircle size={15} /> {item}
                </li>
              ))}
              {DONT_ITEMS_ANSWER.map((item) => (
                <li key={item} className="word-guide-dont">
                  <XCircle size={15} /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Examples */}
        <div className="word-guide-examples">
          <div className="word-guide-example">
            <div className="word-guide-example-label">📄 Ví dụ file đề</div>
            <pre className="word-guide-pre">{EXAMPLE_QUESTION}</pre>
          </div>
          <div className="word-guide-example">
            <div className="word-guide-example-label">📋 Ví dụ file đáp án</div>
            <pre className="word-guide-pre">{EXAMPLE_ANSWER}</pre>
          </div>
        </div>

        <div className="word-guide-warning">
          <AlertTriangle size={16} />
          <span>
            Công thức toán <strong>phải dùng MathType OLE hoặc Insert → Equation</strong> — ảnh chụp công thức sẽ bị mất khi chuyển sang LaTeX.
            Số thứ tự câu trong 2 file phải khớp nhau để ghép lời giải đúng.
          </span>
        </div>
      </div>
    </Modal>
  );
}
