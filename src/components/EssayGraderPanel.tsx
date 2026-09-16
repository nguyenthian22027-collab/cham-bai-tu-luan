import { useState } from 'react';
import { Question, Submission } from '../types';
import {
  EssayGradeResult,
  gradeEssayWithGemini,
  parseEssayAnswer,
} from '../services/essayGradingService';
import MathText from './MathText';
import MarkdownMath from './MarkdownMath';
import SolutionScoreTable from './SolutionScoreTable';

interface Props {
  submission: Submission;
  questions: Question[];
  onSuggested?: (questionNumber: number, result: EssayGradeResult) => void;
}

function stepIcon(status: string) {
  if (status === 'correct') return '✓';
  if (status === 'incorrect') return '✕';
  return '△';
}

function embeddedImageSrc(image: { base64?: string; contentType?: string }) {
  return image.base64 ? `data:${image.contentType || 'image/png'};base64,${image.base64}` : '';
}

export default function EssayGraderPanel({ submission, questions, onSuggested }: Props) {
  const writing = questions.filter((question) => question.type === 'writing');
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [results, setResults] = useState<Record<number, EssayGradeResult>>({});

  if (writing.length === 0) {
    return <div className="empty-state"><h3>Không có câu tự luận</h3></div>;
  }

  async function gradeOne(question: Question) {
    const raw = submission.answers[String(question.number)] || '';
    if (!raw) return;
    setBusy((current) => ({ ...current, [question.number]: true }));
    try {
      const result = await gradeEssayWithGemini({
        submissionId: submission.id,
        questionNumber: question.number,
        maxScore: Number(question.points) || 1,
      });
      setResults((current) => ({ ...current, [question.number]: result }));
      if (!result.error && !result.pending) onSuggested?.(question.number, result);
    } finally {
      setBusy((current) => ({ ...current, [question.number]: false }));
    }
  }

  return (
    <div className="ai-grader-panel">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-header">AI gợi ý chấm tự luận</div>
        <div className="card-body">
          <div className="ai-security-note">
            Đề và đáp án Word đã được chuyển sẵn thành văn bản/LaTeX khi tạo bài. Gemini chỉ nhận dữ liệu đã lưu và bài học sinh khi bạn bấm chấm; không đọc lại file Word. AI chỉ gợi ý, giáo viên xác nhận điểm cuối.
          </div>
        </div>
      </div>

      {writing.map((question) => {
        const raw = submission.answers[String(question.number)] || '';
        const answer = parseEssayAnswer(raw);
        const result = results[question.number];
        return (
          <div className="card" style={{ marginBottom: 12 }} key={question.number}>
            <div className="card-body">
              <div className="essay-ai-head">
                <div>
                  <strong>Câu {question.number}</strong>
                  <div className="essay-ai-max">Tối đa {Number(question.points) || 1} điểm</div>
                </div>
                <button className="btn btn-primary btn-sm" disabled={busy[question.number] || !raw} onClick={() => gradeOne(question)}>
                  {busy[question.number] ? 'Đang đọc và chấm...' : 'AI chấm gợi ý'}
                </button>
              </div>

              <div className="question-preview" style={{ marginTop: 10 }}><MathText html={question.text} block /></div>
              {question.correctAnswer && (
                <details className="review-solution" open>
                  <summary>📌 Rubric / barem điểm</summary>
                  <SolutionScoreTable content={question.correctAnswer} title="Tiêu chí / yêu cầu cần đạt" />
                </details>
              )}
              {question.solution && (
                <details className="review-solution">
                  <summary>💡 Lời giải tham khảo</summary>
                  <SolutionScoreTable content={question.solution} title="Ý / bước trong lời giải" />
                </details>
              )}
              {question.solutionImages?.length ? (
                <details className="review-solution">
                  <summary>🖼️ Hình trong file đáp án (không gửi Gemini)</summary>
                  <div className="question-images" style={{ marginTop: 8 }}>
                    {question.solutionImages.map((image, index) => {
                      const src = embeddedImageSrc(image);
                      return src ? <img key={`${image.id}_${index}`} src={src} alt={image.filename || `Hình đáp án ${index + 1}`} /> : null;
                    })}
                  </div>
                </details>
              ) : null}

              <div className="student-answer-box">
                <strong>Bài làm:</strong>
                {answer.text ? <MarkdownMath markdown={answer.text} /> : <div style={{ marginTop: 6 }}>— Không có phần văn bản —</div>}
                {answer.images.length > 0 && (
                  <div className="essay-images" style={{ marginTop: 8 }}>
                    {answer.images.map((image) => (
                      <a className="essay-image" key={image.fileId} href={image.url} target="_blank" rel="noreferrer">
                        <img src={image.thumbnailUrl || image.url} alt={image.fileName} loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {result && (
                <div className="ai-result-box">
                  <div className="ai-result-score"><strong>AI gợi ý:</strong> {result.score}/{result.maxScore} điểm</div>
                  {result.summary && <MarkdownMath markdown={result.summary} />}
                  {result.steps.length > 0 && (
                    <div className="essay-step-list">
                      {result.steps.map((step, index) => (
                        <div className={`essay-step ${step.status}`} key={`${index}_${step.studentText}`}>
                          <span className="essay-step-icon">{stepIcon(step.status)}</span>
                          <div>
                            {step.studentText && <div className="essay-step-student"><MarkdownMath markdown={step.studentText} /></div>}
                            <MarkdownMath markdown={step.comment} />
                            {(step.awardedPoints !== undefined || step.maxPoints !== undefined) && (
                              <div className="essay-step-points">Điểm ý: {step.awardedPoints ?? '—'} / {step.maxPoints ?? '—'}</div>
                            )}
                            {step.correction && <div className="essay-step-correction"><strong>Sửa:</strong> <MarkdownMath markdown={step.correction} /></div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.feedbackMarkdown && <MarkdownMath markdown={result.feedbackMarkdown} className="ai-feedback-markdown" />}
                  {answer.images.length > 0 && <p className="essay-annotation-hint">Có thể chỉnh hoặc đặt dấu ✓ / ✕ / △ trực tiếp trên ảnh tại phần “Bài làm chi tiết” bên dưới, rồi xác nhận điểm câu.</p>}
                  {result.error && <p className="essay-upload-error">{result.error}</p>}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
