import React, { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import MathText from './MathText';
import SolutionScoreTable from './SolutionScoreTable';
import { ExamData, Question, QuestionOption, QuestionType } from '../types';

interface Props {
  examData: ExamData;
  open: boolean;
  onClose: () => void;
  onConfirm: (data: ExamData) => void;
}

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: 'Trắc nghiệm',
  true_false: 'Đúng / Sai',
  short_answer: 'Trả lời ngắn',
  writing: 'Tự luận',
  unknown: 'Khác',
};

const TYPE_BADGE: Record<string, string> = {
  multiple_choice: 'badge-info',
  true_false: 'badge-success',
  short_answer: 'badge-warning',
  writing: 'badge-teacher',
  unknown: '',
};

const MC_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TF_LETTERS = ['a', 'b', 'c', 'd'];

function normalizeOptions(options?: QuestionOption[]): QuestionOption[] {
  return (options || []).map((o, index) => ({
    letter: o.letter || MC_LETTERS[index] || String(index + 1),
    text: o.text || '',
    isCorrect: o.isCorrect,
  }));
}

function makeDefaultOptions(type: QuestionType): QuestionOption[] {
  if (type === 'true_false') {
    return TF_LETTERS.map((letter) => ({ letter, text: '' }));
  }
  if (type === 'multiple_choice') {
    return MC_LETTERS.slice(0, 4).map((letter) => ({ letter, text: '' }));
  }
  return [];
}

function imageSrc(img: { base64?: string; contentType?: string }) {
  if (!img.base64) return '';
  return `data:${img.contentType || 'image/png'};base64,${img.base64}`;
}

function stripTags(s: string) {
  return (s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export default function ExamReviewModal({ examData, open, onClose, onConfirm }: Props) {
  const [questions, setQuestions] = useState<Question[]>(examData.questions || []);
  const [filter, setFilter] = useState<QuestionType | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Question | null>(null);

  useEffect(() => {
    if (open) setQuestions(examData.questions || []);
  }, [examData, open]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return questions.filter((q) => {
      if (filter !== 'all' && q.type !== filter) return false;
      if (!needle) return true;
      const text = [q.text, q.correctAnswer || '', q.solution || '', ...(q.options || []).map((o) => o.text)]
        .map(stripTags)
        .join(' ')
        .toLowerCase();
      return text.includes(needle);
    });
  }, [questions, filter, search]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    questions.forEach((q) => {
      c[q.type] = (c[q.type] || 0) + 1;
    });
    return c;
  }, [questions]);

  function updateQuestion(next: Question) {
    setQuestions((prev) => prev.map((q) => (q.number === next.number ? next : q)));
    setEditing(null);
  }

  function confirm() {
    const answers: Record<number, string> = { ...(examData.answers || {}) };
    questions.forEach((q) => {
      if (q.correctAnswer) answers[q.number] = q.correctAnswer;
    });
    onConfirm({ ...examData, questions, answers });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Xem trước & chỉnh đề"
      size="modal-lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button className="btn btn-primary" onClick={confirm}>Dùng đề này</button>
        </>
      }
    >
      <div className="assignment-review-top">
        <div>
          <strong>{examData.title || 'Đề vừa import'}</strong>
          <p className="page-sub">
            {questions.length} câu · TN {counts.multiple_choice || 0} · Đ/S {counts.true_false || 0} · Ngắn {counts.short_answer || 0} · Tự luận {counts.writing || 0}
          </p>
        </div>
        <div className="form-row" style={{ marginBottom: 0, gap: 8 }}>
          <input
            className="form-control"
            style={{ minWidth: 220 }}
            placeholder="Tìm trong đề..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            className="form-select"
            style={{ minWidth: 190 }}
            value={filter}
            onChange={(e) => setFilter(e.target.value as QuestionType | 'all')}
          >
            <option value="all">Tất cả câu hỏi</option>
            <option value="multiple_choice">Trắc nghiệm</option>
            <option value="true_false">Đúng / Sai</option>
            <option value="short_answer">Trả lời ngắn</option>
            <option value="writing">Tự luận</option>
          </select>
        </div>
      </div>

      <div
        style={{
          padding: '0.75rem 1rem',
          marginBottom: 12,
          background: 'var(--bg-light)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          color: 'var(--primary-dark)',
          fontSize: '0.86rem',
          fontWeight: 600,
        }}
      >
        Chế độ xem hiển thị công thức trực quan bằng MathText/MathJax. Khi bấm <strong>Sửa</strong>, nội dung được chỉnh dưới dạng LaTeX thô như <code>$x^2$</code> hoặc <code>$$...$$</code>.
      </div>

      <div className="assignment-question-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <h3>Không có câu hỏi phù hợp</h3>
            <p>Thử đổi bộ lọc hoặc từ khóa tìm kiếm.</p>
          </div>
        ) : (
          filtered.map((q) => (
            <QuestionPreviewCard key={q.number} q={q} onEdit={() => setEditing(q)} />
          ))
        )}
      </div>

      <EditQuestionModal q={editing} onClose={() => setEditing(null)} onSave={updateQuestion} />
    </Modal>
  );
}

function QuestionPreviewCard({
  q,
  onEdit,
  showEdit = true,
}: {
  q: Question;
  onEdit: () => void;
  showEdit?: boolean;
}) {
  return (
    <div className="assignment-question-card">
      <div className="assignment-question-head">
        <div>
          <span className="badge badge-info">Câu {q.number}</span>{' '}
          <span className={`badge ${TYPE_BADGE[q.type] || ''}`}>{TYPE_LABEL[q.type] || q.type}</span>{' '}
          <span className="badge">{Number(q.points) || 1} điểm</span>
        </div>
        {showEdit && <button className="btn btn-secondary btn-sm" onClick={onEdit}>Sửa LaTeX</button>}
      </div>

      <div style={{ fontWeight: 600, lineHeight: 1.7 }}>
        <MathText html={q.text || ''} block />
      </div>

      {q.images?.length ? (
        <div className="question-images">
          {q.images.map((img, i) => {
            const src = imageSrc(img);
            return src ? <img key={i} src={src} alt={img.filename || `Hình ${i + 1}`} /> : null;
          })}
        </div>
      ) : null}

      {q.options?.length ? (
        <div className="option-list">
          {q.options.map((o) => (
            <div key={o.letter} style={{ lineHeight: 1.7 }}>
              <strong>{o.letter}.</strong> <MathText html={o.text || ''} />
            </div>
          ))}
        </div>
      ) : null}

      {q.correctAnswer ? (
        <div className="answer-key">
          {q.type === 'writing' ? 'Rubric / barem điểm: ' : 'Đáp án: '}
          <strong>{q.correctAnswer}</strong>
        </div>
      ) : null}
      {q.solution ? (
        <div style={{ marginTop: 8, padding: '0.75rem', background: 'var(--bg-light)', borderRadius: 'var(--radius-sm)' }}>
          <strong>{q.type === 'writing' ? 'Lời giải tham khảo:' : 'Hướng dẫn:'}</strong>
          <div style={{ marginTop: 4 }}><SolutionScoreTable content={q.solution} title="Ý / bước trong lời giải" /></div>
        </div>
      ) : null}
      {q.solutionImages?.length ? (
        <div style={{ marginTop: 8, padding: '0.75rem', background: 'var(--bg-light)', borderRadius: 'var(--radius-sm)' }}>
          <strong>Hình trong file đáp án:</strong>
          <div className="question-images" style={{ marginTop: 8 }}>
            {q.solutionImages.map((img, i) => {
              const src = imageSrc(img);
              return src ? <img key={i} src={src} alt={img.filename || `Hình đáp án ${i + 1}`} /> : null;
            })}
          </div>
          <small style={{ color: 'var(--text-muted)' }}>Các hình này chỉ để giáo viên đối chiếu, không gửi sang Gemini mặc định.</small>
        </div>
      ) : null}
    </div>
  );
}

function EditQuestionModal({
  q,
  onClose,
  onSave,
}: {
  q: Question | null;
  onClose: () => void;
  onSave: (q: Question) => void;
}) {
  const [draft, setDraft] = useState<Question | null>(q);
  const [preview, setPreview] = useState(true);

  useEffect(() => {
    if (!q) {
      setDraft(null);
      return;
    }
    const normalized: Question = {
      ...q,
      options: normalizeOptions(q.options),
      correctAnswer: q.correctAnswer || '',
      solution: q.solution || '',
      points: Number(q.points) || 1,
    };
    if ((normalized.type === 'multiple_choice' || normalized.type === 'true_false') && (!normalized.options || normalized.options.length === 0)) {
      normalized.options = makeDefaultOptions(normalized.type);
    }
    setDraft(normalized);
    setPreview(true);
  }, [q]);

  if (!q || !draft) return null;

  function updateType(type: QuestionType) {
    if (!draft) return;
    let nextOptions = draft.options || [];
    if (type === 'multiple_choice' && nextOptions.length === 0) nextOptions = makeDefaultOptions(type);
    if (type === 'true_false') {
      nextOptions = nextOptions.length ? nextOptions : makeDefaultOptions(type);
      nextOptions = nextOptions.map((o, idx) => ({ ...o, letter: TF_LETTERS[idx] || o.letter.toLowerCase() }));
    }
    if (type === 'short_answer' || type === 'writing') nextOptions = [];
    setDraft({ ...draft, type, options: nextOptions });
  }

  function updateOption(index: number, field: keyof QuestionOption, value: string | boolean) {
    if (!draft) return;
    const opts = [...(draft.options || [])];
    opts[index] = { ...opts[index], [field]: value } as QuestionOption;
    setDraft({ ...draft, options: opts });
  }

  function addOption() {
    if (!draft) return;
    const opts = [...(draft.options || [])];
    const letter = draft.type === 'true_false'
      ? TF_LETTERS[opts.length] || String.fromCharCode(97 + opts.length)
      : MC_LETTERS[opts.length] || String.fromCharCode(65 + opts.length);
    opts.push({ letter, text: '' });
    setDraft({ ...draft, options: opts });
  }

  function removeOption(index: number) {
    if (!draft) return;
    const opts = [...(draft.options || [])];
    opts.splice(index, 1);
    setDraft({ ...draft, options: opts });
  }

  return (
    <Modal
      open={!!q}
      onClose={onClose}
      title={`Sửa câu ${q.number}`}
      size="modal-lg"
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Hủy</button>
          <button className="btn btn-secondary" onClick={() => setPreview((v) => !v)}>
            {preview ? 'Ẩn xem trước' : 'Xem trực quan'}
          </button>
          <button className="btn btn-primary" onClick={() => onSave(cleanQuestion(draft))}>Lưu câu hỏi</button>
        </>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: preview ? 'minmax(0, 1.05fr) minmax(260px, 0.95fr)' : '1fr',
          gap: '1rem',
          alignItems: 'start',
        }}
      >
        <div>
          <div
            style={{
              marginBottom: 12,
              padding: '0.75rem 1rem',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              background: '#fff',
            }}
          >
            <strong style={{ color: 'var(--primary-dark)' }}>Chỉnh sửa LaTeX thô</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 4 }}>
              Gõ công thức dạng <code>$...$</code> hoặc <code>$$...$$</code>. Cột xem trước bên phải sẽ render công thức trực quan.
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Loại câu</label>
              <select className="form-select" value={draft.type} onChange={(e) => updateType(e.target.value as QuestionType)}>
                <option value="multiple_choice">Trắc nghiệm</option>
                <option value="true_false">Đúng / Sai</option>
                <option value="short_answer">Trả lời ngắn</option>
                <option value="writing">Tự luận</option>
                <option value="unknown">Khác</option>
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Điểm</label>
              <input
                className="form-control"
                type="number"
                step="0.25"
                value={draft.points || 1}
                onChange={(e) => setDraft({ ...draft, points: Number(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Nội dung câu hỏi — LaTeX</label>
            <textarea
              className="form-control"
              rows={6}
              value={draft.text || ''}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
              placeholder="VD: Giải phương trình $x^2-5x+6=0$"
            />
          </div>

          {(draft.type === 'multiple_choice' || draft.type === 'true_false') && (
            <div className="form-group">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>
                  {draft.type === 'true_false' ? 'Các mệnh đề — LaTeX' : 'Các phương án — LaTeX'}
                </label>
                <button className="btn btn-ghost btn-sm" type="button" onClick={addOption}>+ Thêm dòng</button>
              </div>

              {(draft.options || []).map((o, index) => (
                <div key={`${o.letter}_${index}`} style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 8, marginBottom: 8 }}>
                  <input
                    className="form-control"
                    value={o.letter}
                    onChange={(e) => updateOption(index, 'letter', e.target.value)}
                    aria-label="Ký hiệu phương án"
                  />
                  <textarea
                    className="form-control"
                    rows={2}
                    value={o.text || ''}
                    onChange={(e) => updateOption(index, 'text', e.target.value)}
                    placeholder={`Nội dung ${o.letter || index + 1}`}
                  />
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => removeOption(index)} style={{ color: 'var(--danger)' }}>
                    Xóa
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="form-group">
            <label className="form-label">
              {draft.type === 'writing' ? 'Rubric / hướng dẫn chấm' : 'Đáp án'}
            </label>
            <textarea
              className="form-control"
              rows={3}
              value={draft.correctAnswer || ''}
              onChange={(e) => setDraft({ ...draft, correctAnswer: e.target.value })}
              placeholder={
                draft.type === 'writing'
                  ? 'Nhập barem/rubric chấm tự luận. VD: Ý 1: 0.5đ, Ý 2: 1đ...'
                  : draft.type === 'true_false'
                  ? 'VD: a,c hoặc a:T,b:F,c:T,d:F'
                  : 'VD: A hoặc x=2'
              }
            />
            {draft.type === 'writing' && (
              <div style={{ marginTop: 6, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                Nội dung này sẽ được dùng làm rubric/barem điểm khi Gemini gợi ý chấm và khi giáo viên chấm thủ công.
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">
              {draft.type === 'writing' ? 'Lời giải tham khảo — LaTeX' : 'Lời giải / ghi chú — LaTeX'}
            </label>
            <textarea
              className="form-control"
              rows={4}
              value={draft.solution || ''}
              onChange={(e) => setDraft({ ...draft, solution: e.target.value })}
              placeholder={
                draft.type === 'writing'
                  ? 'Nhập lời giải tham khảo cho giáo viên/Gemini. Có thể dùng $...$'
                  : 'Nhập lời giải hoặc hướng dẫn chấm. Có thể dùng $...$'
              }
            />
          </div>
        </div>

        {preview && (
          <div className="card" style={{ position: 'sticky', top: 12 }}>
            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>Xem trực quan</span>
              <span style={{ fontSize: '0.76rem', opacity: 0.9 }}>MathText</span>
            </div>
            <div className="card-body">
              <QuestionPreviewCard q={draft} onEdit={() => undefined} showEdit={false} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function cleanQuestion(q: Question): Question {
  const next: Question = {
    ...q,
    text: q.text || '',
    points: Number(q.points) || 1,
    correctAnswer: q.correctAnswer || '',
    solution: q.solution || '',
  };

  if (next.type === 'multiple_choice' || next.type === 'true_false') {
    next.options = normalizeOptions(next.options).filter((o) => o.letter.trim() || o.text.trim());
  } else {
    delete next.options;
  }

  return next;
}
