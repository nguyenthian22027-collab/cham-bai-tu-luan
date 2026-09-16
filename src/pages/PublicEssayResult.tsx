import { useEffect, useState } from 'react';
import { ExternalLink, Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import MarkdownMath from '../components/MarkdownMath';
import SolutionScoreTable from '../components/SolutionScoreTable';
import { getPublicEssayResult } from '../services/publicResultService';
import { EssayStepFeedback, PublicEssayResult, PublicEssayResultQuestion } from '../types';

function fmt(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function markerText(status: EssayStepFeedback['status']) {
  if (status === 'correct') return '✓';
  if (status === 'incorrect') return '✕';
  return '△';
}

function buildPublicImageUrl(token: string, questionNumber: number, imageIndex: number) {
  const params = new URLSearchParams({ token, question: String(questionNumber), image: String(imageIndex) });
  return `/api/public-image?${params.toString()}`;
}

function AnnotatedImage({ token, question, imageIndex }: { token: string; question: PublicEssayResultQuestion; imageIndex: number }) {
  const image = question.images[imageIndex];
  const proxyUrl = buildPublicImageUrl(token, question.number, imageIndex);
  const markers = (question.aiDetails?.steps || []).filter((step) =>
    Number(step.page) === imageIndex + 1 && Number.isFinite(step.x) && Number.isFinite(step.y),
  );
  return (
    <figure className="public-answer-image">
      <div className="public-answer-image-canvas">
        <a className="public-answer-image-link" href={proxyUrl} target="_blank" rel="noreferrer" title="Mở ảnh gốc">
          <img src={proxyUrl} alt={`${image.fileName} - trang ${imageIndex + 1}`} loading="lazy" />
        </a>
        {markers.map((step, index) => (
          <span
            key={`${index}_${step.studentText}`}
            className={`public-image-marker ${step.status}`}
            style={{ left: `${Math.max(0, Math.min(1, Number(step.x))) * 100}%`, top: `${Math.max(0, Math.min(1, Number(step.y))) * 100}%` }}
            title={`${step.comment}${step.correction ? ` — Sửa: ${step.correction}` : ''}`}
          >
            {markerText(step.status)}
          </span>
        ))}
      </div>
      <figcaption>Trang {imageIndex + 1} · Ảnh được tải qua máy chủ để mở ổn định trên Zalo</figcaption>
      <a className="public-answer-image-open" href={proxyUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Mở ảnh gốc</a>
    </figure>
  );
}

function QuestionResult({ token, question }: { token: string; question: PublicEssayResultQuestion }) {
  return (
    <section className="public-question-card">
      <header className="public-question-head">
        <div>
          <span className="public-question-number">Câu {question.number}</span>
          <div className="public-question-title"><MarkdownMath markdown={question.text} /></div>
        </div>
        <div className="public-question-score">{fmt(question.score)} / {fmt(question.maxScore)} điểm</div>
      </header>

      <div className="public-answer-section">
        <h3>Bài làm của học sinh</h3>
        {question.answerText ? <MarkdownMath markdown={question.answerText} className="public-student-text" /> : <p className="public-muted">Học sinh nộp bài bằng ảnh.</p>}
        {question.images.length > 0 && (
          <div className="public-answer-images">
            {question.images.map((_image, index) => <AnnotatedImage key={question.images[index].fileId} token={token} question={question} imageIndex={index} />)}
          </div>
        )}
      </div>

      {(question.aiDetails?.steps || []).length > 0 && (
        <div className="public-step-section">
          <h3>Đối chiếu từng bước</h3>
          <div className="public-step-list">
            {question.aiDetails!.steps.map((step, index) => (
              <article className={`public-step ${step.status}`} key={`${index}_${step.studentText}`}>
                <div className="public-step-icon">{markerText(step.status)}</div>
                <div>
                  {step.studentText && <MarkdownMath markdown={`**Bài làm:** ${step.studentText}`} />}
                  <MarkdownMath markdown={step.comment} />
                  {step.correction && <MarkdownMath markdown={`**Cách sửa:** ${step.correction}`} className="public-correction" />}
                  {(step.awardedPoints !== undefined || step.maxPoints !== undefined) && (
                    <div className="public-step-points">Điểm ý: {step.awardedPoints ?? '—'} / {step.maxPoints ?? '—'}</div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      <div className="public-feedback-section">
        <h3>Nhận xét câu này</h3>
        <MarkdownMath markdown={question.feedback || question.aiDetails?.feedbackMarkdown || 'Giáo viên chưa nhập nhận xét riêng cho câu này.'} />
      </div>

      {question.solution && (
        <details className="public-solution">
          <summary>Xem lời giải tham khảo</summary>
          <SolutionScoreTable content={question.solution} title="Ý / bước trong lời giải" />
        </details>
      )}
    </section>
  );
}

export default function PublicEssayResultPage() {
  const { token = '' } = useParams();
  const [result, setResult] = useState<PublicEssayResult | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getPublicEssayResult(token)
      .then((data) => {
        if (!active) return;
        setResult(data);
        document.title = `${data.studentName} - Kết quả chấm bài`;
      })
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : 'Không mở được kết quả.'));
    return () => { active = false; };
  }, [token]);

  if (error) {
    return <div className="public-result-shell"><div className="public-result-error"><h1>Không mở được kết quả</h1><p>{error}</p></div></div>;
  }
  if (!result) {
    return <div className="public-result-shell"><div className="public-result-loading"><div className="spinner" /><p>Đang tải kết quả chấm bài...</p></div></div>;
  }

  const percent = result.maxScore > 0 ? Math.round((result.finalScore / result.maxScore) * 100) : 0;
  return (
    <div className="public-result-shell">
      <main className="public-result-page">
        <header className="public-result-hero">
          <div className="public-result-brand">KẾT QUẢ CHẤM BÀI TỰ LUẬN</div>
          <h1>{result.title}</h1>
          <div className="public-student-meta">
            <strong>{result.studentName}</strong>
            {result.className && <span>{result.className}</span>}
            <span>Công bố {new Date(result.publishedAt).toLocaleString('vi-VN')}</span>
          </div>
          <div className="public-score-wrap">
            <div className="public-score-circle">
              <strong>{fmt(result.finalScore)}</strong>
              <span>/ {fmt(result.maxScore)}</span>
            </div>
            <div>
              <div className="public-percent">{percent}%</div>
              <p>{result.teacherName ? `Giáo viên chấm: ${result.teacherName}` : 'Kết quả đã được giáo viên xác nhận'}</p>
            </div>
          </div>
          <button className="public-print-button" onClick={() => window.print()}><Printer size={17} /> In / lưu PDF</button>
        </header>

        {result.finalFeedback && (
          <section className="public-final-feedback">
            <h2>Nhận xét tổng hợp</h2>
            <MarkdownMath markdown={result.finalFeedback} />
          </section>
        )}

        <div className="public-question-list">
          {result.questions.map((question) => <QuestionResult key={question.number} token={token} question={question} />)}
        </div>

        <footer className="public-result-footer">
          <p>Kết quả được tạo từ bài làm gốc và đã được giáo viên xác nhận trước khi công bố.</p>
          <span><ExternalLink size={14} /> Ảnh bài làm gốc luôn được giữ nguyên; các dấu ✓ ✕ △ chỉ là lớp chú thích trên trang HTML.</span>
        </footer>
      </main>
    </div>
  );
}
