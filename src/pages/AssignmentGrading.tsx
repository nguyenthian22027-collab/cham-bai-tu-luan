import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, CheckCircle, Copy, ExternalLink, Link2, MessageCircle, Wand2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import MathText from '../components/MathText';
import MarkdownMath from '../components/MarkdownMath';
import EssayGraderPanel from '../components/EssayGraderPanel';
import EssayImageAnnotator from '../components/EssayImageAnnotator';
import SolutionScoreTable from '../components/SolutionScoreTable';
import { parseEssayAnswer } from '../services/essayGradingService';
import { getPublishedEssayLink, publishEssayResult, revokeEssayResult } from '../services/publicResultService';
import { isUsableZaloPhone, sendZaloMessage } from '../services/zaloService';
import {
  finalizeSubmissionGrade,
  getAssignmentTargets,
  getAssignmentWithExam,
  getSubmission,
  getSubmissionGrades,
  saveQuestionGrade,
  submissionIdOf,
} from '../services/assignmentService';
import {
  formatScore,
  parseTFAnswer,
  parseTFCorrectSet,
  scoreQuestion,
} from '../services/scoringService';
import {
  Assignment,
  EssayAiDetails,
  AssignmentExam,
  AssignmentTarget,
  Question,
  QuestionOption,
  QuestionResult,
  PublishedEssayLink,
  QuestionType,
  Submission,
  SubmissionGrade,
} from '../types';

// ─── Helpers (đồng bộ với StudentWorkRoom) ───────────────────────────────────

function normalizeQuestionType(q: Question): Exclude<QuestionType, 'unknown'> {
  if (q.type === 'multiple_choice' || q.type === 'true_false' || q.type === 'short_answer' || q.type === 'writing') {
    return q.type;
  }
  if (q.tfStatements && Object.keys(q.tfStatements).length > 0) return 'true_false';
  if (q.options && q.options.length > 0) return 'multiple_choice';
  return 'short_answer';
}

function getTrueFalseOptions(question: Question): QuestionOption[] {
  if (question.options?.length) return question.options;
  return Object.entries(question.tfStatements || {}).map(([letter, text]) => ({ letter, text }));
}

function mathify(v: string): string {
  const t = (v || '').trim();
  if (!t) return '';
  return t.includes('$') ? t : `$${t}$`;
}

const SECTION_ORDER: Exclude<QuestionType, 'unknown'>[] = [
  'multiple_choice', 'true_false', 'short_answer', 'writing',
];

const SECTION_META: Record<Exclude<QuestionType, 'unknown'>, { icon: string; title: string; cls: string }> = {
  multiple_choice: { icon: '📝', title: 'PHẦN 1. TRẮC NGHIỆM NHIỀU LỰA CHỌN', cls: 'section-mc' },
  true_false: { icon: '✅', title: 'PHẦN 2. TRẮC NGHIỆM ĐÚNG / SAI', cls: 'section-tf' },
  short_answer: { icon: '✏️', title: 'PHẦN 3. TRẢ LỜI NGẮN', cls: 'section-sa' },
  writing: { icon: '🖊️', title: 'PHẦN 4. TỰ LUẬN', cls: 'section-writing' },
};

// ─────────────────────────────────────────────────────────────────────────────

export default function AssignmentGrading() {
  const { assignmentId } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [exam, setExam] = useState<AssignmentExam | null>(null);
  const [targets, setTargets] = useState<AssignmentTarget[]>([]);
  const [selected, setSelected] = useState<AssignmentTarget | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [grades, setGrades] = useState<SubmissionGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [finalScore, setFinalScore] = useState('');
  const [finalFeedback, setFinalFeedback] = useState('');
  const [publication, setPublication] = useState<PublishedEssayLink | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [sendingZalo, setSendingZalo] = useState(false);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [assignmentId]);
  useEffect(() => { if (selected) loadSubmission(selected); /* eslint-disable-next-line */ }, [selected?.id]);

  async function load() {
    if (!assignmentId) return;
    setLoading(true);
    try {
      const [{ assignment: a, exam: e }, t] = await Promise.all([
        getAssignmentWithExam(assignmentId),
        getAssignmentTargets(assignmentId),
      ]);
      setAssignment(a);
      setExam(e);
      setTargets(t);
      setSelected(t.find((x) => x.status === 'submitted') || t[0] || null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tải chấm bài', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function loadSubmission(t: AssignmentTarget) {
    const sub = await getSubmission(submissionIdOf(t.assignmentId, t.studentId));
    setSubmission(sub);
    if (sub) {
      const gs = await getSubmissionGrades(sub.id);
      setGrades(gs);
      const final = gs.find((g) => g.questionNumber === 'FINAL');
      setFinalScore(String(final?.score ?? sub.finalScore ?? sub.autoScore ?? ''));
      setFinalFeedback(final?.feedback || '');
      try {
        setPublication(await getPublishedEssayLink(sub.id));
      } catch {
        setPublication(null);
      }
    } else {
      setGrades([]);
      setFinalScore('');
      setFinalFeedback('');
      setPublication(null);
    }
  }

  const writingQuestions = useMemo(() => exam?.questions.filter((q) => normalizeQuestionType(q) === 'writing') || [], [exam]);
  const submittedImageCount = useMemo(() => {
    if (!submission) return 0;
    return writingQuestions.reduce(
      (total, question) => total + parseEssayAnswer(submission.answers[String(question.number)] || '').images.length,
      0,
    );
  }, [submission, writingQuestions]);
  const submittedTargets = targets.filter((t) => t.status === 'submitted' || t.status === 'graded');

  // 🆕 Nhóm câu hỏi theo phần, đánh số hiển thị tuần tự — giống giao diện học sinh
  const questionSections = useMemo(() => {
    if (!exam) return [];
    const byType = new Map<Exclude<QuestionType, 'unknown'>, Question[]>();
    for (const q of exam.questions || []) {
      const type = normalizeQuestionType(q);
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(q);
    }
    let running = 0;
    return SECTION_ORDER
      .filter((type) => (byType.get(type) || []).length > 0)
      .map((type) => ({
        type,
        meta: SECTION_META[type],
        questions: (byType.get(type) || []).map((q) => ({ q, displayNum: ++running })),
      }));
  }, [exam]);

  // 🆕 Kết quả từng câu: ưu tiên bản lưu lúc nộp; submission cũ → tự tính lại
  const questionResults = useMemo<Record<string, QuestionResult>>(() => {
    if (!exam || !submission) return {};
    if (submission.questionResults && Object.keys(submission.questionResults).length > 0) {
      return submission.questionResults;
    }
    const computed: Record<string, QuestionResult> = {};
    for (const q of exam.questions) {
      computed[String(q.number)] = scoreQuestion(q, submission.answers[String(q.number)], exam.pointsConfig);
    }
    return computed;
  }, [exam, submission]);

  async function saveQ(
    q: Question,
    score: number,
    feedback: string,
    aiScore?: number,
    aiFeedback?: string,
    aiDetails?: EssayAiDetails,
    status: SubmissionGrade['status'] = 'GRADED',
  ) {
    if (!user || !submission) return;
    const maxScore = Number(q.points) || 1;
    if (!Number.isFinite(score) || score < 0 || score > maxScore) {
      toast(`Điểm câu ${q.number} phải từ 0 đến ${maxScore}.`, 'warning');
      return;
    }
    try {
      const existingGrade = grades.find((grade) => grade.questionNumber === q.number);
      await saveQuestionGrade({
        submission,
        questionNumber: q.number,
        score,
        maxScore,
        feedback,
        aiScore: aiScore ?? existingGrade?.aiScore,
        aiFeedback: aiFeedback ?? existingGrade?.aiFeedback,
        aiDetails: aiDetails ?? existingGrade?.aiDetails,
        status,
        gradedBy: user,
      });
      toast(status === 'AI_SUGGESTED' ? 'Đã lưu gợi ý AI. Hãy kiểm tra và bấm “Xác nhận điểm câu”.' : 'Đã xác nhận điểm câu.');
      await loadSubmission(selected!);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi lưu điểm câu', 'error');
    }
  }

  async function finalize() {
    if (!user || !submission) return;
    const unconfirmed = writingQuestions.filter((question) => !grades.some((grade) => grade.questionNumber === question.number && grade.status === 'GRADED'));
    if (unconfirmed.length > 0) {
      toast(`Còn ${unconfirmed.length} câu tự luận chưa được giáo viên xác nhận.`, 'warning');
      return;
    }
    const score = Number(finalScore);
    if (!Number.isFinite(score) || score < 0 || score > submission.maxScore) {
      toast(`Điểm cuối phải từ 0 đến ${submission.maxScore}.`, 'warning');
      return;
    }
    try {
      await finalizeSubmissionGrade({ submission, finalScore: score, feedback: finalFeedback, gradedBy: user });
      toast('Đã xác nhận điểm cuối');
      await loadSubmission(selected!);
      setTargets((current) => current.map((target) => target.id === selected?.id ? { ...target, status: 'graded', finalScore: score, maxScore: submission.maxScore } : target));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi xác nhận điểm', 'error');
    }
  }

  async function publishResult() {
    if (!submission) return;
    setPublishing(true);
    try {
      const next = await publishEssayResult(submission.id);
      setPublication(next);
      toast('Đã tạo/cập nhật đường link kết quả cho phụ huynh.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không công bố được kết quả.', 'error');
    } finally {
      setPublishing(false);
    }
  }

  async function revokeResult() {
    if (!submission || !publication?.active) return;
    if (!window.confirm('Thu hồi đường link này? Phụ huynh sẽ không mở lại được kết quả.')) return;
    setPublishing(true);
    try {
      setPublication(await revokeEssayResult(submission.id));
      toast('Đã thu hồi đường link kết quả.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không thu hồi được liên kết.', 'error');
    } finally {
      setPublishing(false);
    }
  }

  async function copyResultLink() {
    if (!publication?.url) return;
    await navigator.clipboard.writeText(publication.url);
    toast('Đã sao chép đường link kết quả.');
  }

  async function sendResultToZalo() {
    if (!submission || !assignment || !publication?.active) return;
    if (!isUsableZaloPhone(publication.parentPhone || '')) {
      toast('Học sinh chưa có số Zalo phụ huynh hợp lệ.', 'warning');
      return;
    }
    setSendingZalo(true);
    try {
      await sendZaloMessage({
        id: submission.studentId,
        name: publication.parentName || 'Phụ huynh',
        phone: publication.parentPhone || '',
        message: [
          `Kính gửi ${publication.parentName || 'phụ huynh'},`,
          `Kết quả chấm bài tự luận của em ${submission.studentName}: ${assignment.title}.`,
          `Điểm: ${finalScore || submission.finalScore || 0}/${submission.maxScore}.`,
          finalFeedback ? `Nhận xét: ${finalFeedback}` : '',
          `Xem bài làm và nhận xét chi tiết tại: ${publication.url}`,
        ].filter(Boolean).join('\n'),
      }, {
        kind: 'ESSAY_RESULT',
        classId: assignment.classId,
        periodKey: submission.id,
      });
      toast('Đã đưa tin nhắn kết quả vào hàng đợi Zalo.');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Không gửi được Zalo.', 'error');
    } finally {
      setSendingZalo(false);
    }
  }

  if (loading) return <div className="loading-state"><div className="spinner" /><span>Đang tải...</span></div>;
  if (!assignment || !exam) return <div className="empty-state"><h3>Không tìm thấy bài</h3></div>;

  return (
    <div className="fade-up assignment-page grading-page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><CheckCircle size={26} /> <span>Chấm bài</span></h1>
          <p className="page-sub">{assignment.title} · {assignment.className}</p>
        </div>
        <button className="btn btn-ghost" onClick={() => nav('/assignments')}>Quay lại</button>
      </div>

      <div className="grading-layout">
        <div className="card grading-sidebar">
          <div className="card-header">Bài đã nộp ({submittedTargets.length}/{targets.length})</div>
          <div className="grading-student-list">
            {targets.map((t) => (
              <button key={t.id} className={`grading-student ${selected?.id === t.id ? 'active' : ''}`} onClick={() => setSelected(t)}>
                <strong>{t.studentName}</strong>
                <span>{t.status === 'graded' ? 'Đã chấm' : t.status === 'submitted' ? 'Đã nộp' : t.status === 'in_progress' ? 'Đang làm' : 'Chưa làm'}</span>
                {t.finalScore !== undefined && <small>{t.finalScore}/{t.maxScore}</small>}
              </button>
            ))}
          </div>
        </div>

        <div className="grading-content">
          {!selected ? <div className="card"><div className="empty-state"><h3>Chưa có học sinh</h3></div></div> : !submission ? (
            <div className="card"><div className="empty-state"><h3>{selected.studentName} chưa nộp bài</h3></div></div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 14 }}>
                <div className="card-header">{selected.studentName}</div>
                <div className="card-body">
                  <div className="pay-summary-grid">
                    <div><span>Trạng thái</span><br /><strong>{submission.status === 'graded' ? 'Đã chấm' : 'Chờ giáo viên chấm'}</strong></div>
                    <div><span>Câu tự luận</span><br /><strong>{writingQuestions.length}</strong></div>
                    <div><span>Ảnh bài làm</span><br /><strong>{submittedImageCount}</strong></div>
                    <div><span>Nộp lúc</span><br /><strong>{submission.submittedAt ? submission.submittedAt.toLocaleString('vi-VN') : '—'}</strong></div>
                  </div>
                </div>
              </div>

              {writingQuestions.length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <EssayGraderPanel
                    submission={submission}
                    questions={exam.questions}
                    onSuggested={(qNum, result) => {
                      const q = exam.questions.find((x) => x.number === qNum);
                      if (q) saveQ(q, result.score, result.feedbackMarkdown, result.score, result.feedbackMarkdown, result, 'AI_SUGGESTED');
                    }}
                  />
                </div>
              )}

              {/* 🆕 Bài làm chi tiết — hiển thị đầy đủ câu hỏi, đáp án HS chọn
                  và đáp án đúng, giống giao diện học sinh sau khi nộp */}
              {questionSections.map((section) => (
                <div className="card" style={{ marginBottom: 14 }} key={section.type}>
                  <div className={`card-header grading-section-header ${section.meta.cls}`}>
                    {section.meta.icon} {section.meta.title}
                    <span className="grading-section-count">{section.questions.length} câu</span>
                  </div>
                  <div className="card-body">
                    {section.questions.map(({ q, displayNum }) => (
                      <QuestionGradeBlock
                        key={q.number}
                        q={q}
                        displayNum={displayNum}
                        answer={submission.answers[String(q.number)] || ''}
                        result={questionResults[String(q.number)]}
                        grade={grades.find((x) => x.questionNumber === q.number)}
                        onSave={saveQ}
                      />
                    ))}
                  </div>
                </div>
              ))}

              <div className="card">
                <div className="card-body">
                  <div className="final-grade-box">
                    <h3><Wand2 size={18} /> Xác nhận điểm cuối</h3>
                    <div className="form-row">
                      <div className="form-group">
                        <label className="form-label">Điểm cuối</label>
                        <input className="form-control" type="number" step="0.25" value={finalScore} onChange={(e) => setFinalScore(e.target.value)} />
                      </div>
                      <div className="form-group" style={{ flex: 3 }}>
                        <label className="form-label">Nhận xét cuối</label>
                        <textarea className="form-control" rows={4} value={finalFeedback} onChange={(e) => setFinalFeedback(e.target.value)} placeholder="Nhận xét tổng hợp gửi học sinh/phụ huynh; có thể dùng Markdown và công thức $...$" />
                        {finalFeedback.trim() && (
                          <div className="grading-feedback-preview">
                            <span className="grading-feedback-preview-label">Xem trước nhận xét</span>
                            <MarkdownMath markdown={finalFeedback} />
                          </div>
                        )}
                      </div>
                    </div>
                    <button className="btn btn-primary" onClick={finalize}>Lưu điểm cuối</button>
                  </div>

                  <div className="result-publish-box">
                    <div className="result-publish-head">
                      <div>
                        <h3><Link2 size={18} /> Công bố kết quả cho phụ huynh</h3>
                        <p>Trang công khai chỉ chứa bài tự luận đã chấm, ảnh bài làm và nhận xét đã xác nhận.</p>
                      </div>
                      <span className={`badge ${publication?.active ? 'badge-success' : 'badge-warning'}`}>
                        {publication?.active ? 'Link đang hoạt động' : 'Chưa công bố'}
                      </span>
                    </div>

                    {publication?.active && (
                      <div className="result-link-row">
                        <input className="form-control" readOnly value={publication.url} />
                        <button className="btn btn-ghost btn-sm" onClick={copyResultLink}><Copy size={15} /> Sao chép</button>
                        <a className="btn btn-ghost btn-sm" href={publication.url} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Mở</a>
                      </div>
                    )}

                    <div className="result-publish-actions">
                      <button className="btn btn-primary" disabled={publishing || submission.status !== 'graded'} onClick={publishResult}>
                        <Link2 size={16} /> {publishing ? 'Đang xử lý...' : publication?.active ? 'Cập nhật trang kết quả' : 'Tạo link kết quả'}
                      </button>
                      <button className="btn btn-secondary" disabled={!publication?.active || sendingZalo} onClick={sendResultToZalo}>
                        <MessageCircle size={16} /> {sendingZalo ? 'Đang gửi...' : 'Gửi Zalo phụ huynh'}
                      </button>
                      {publication?.active && <button className="btn btn-ghost" disabled={publishing} onClick={revokeResult}><Ban size={16} /> Thu hồi link</button>}
                    </div>
                    {submission.status !== 'graded' && <p className="result-publish-warning">Hãy lưu điểm cuối trước khi tạo link.</p>}
                    {publication?.active && !isUsableZaloPhone(publication.parentPhone || '') && <p className="result-publish-warning">Chưa có số điện thoại phụ huynh hợp lệ; vẫn có thể sao chép link để gửi thủ công.</p>}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 1 CÂU TRONG MÀN CHẤM — review đầy đủ như học sinh + ô chấm thủ công
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  multiple_choice: 'Trắc nghiệm',
  true_false: 'Đúng / Sai',
  short_answer: 'Trả lời ngắn',
  writing: 'Tự luận',
};

function QuestionGradeBlock({ q, displayNum, answer, result, grade, onSave }: {
  q: Question;
  displayNum: number;
  answer: string;
  result?: QuestionResult;
  grade?: SubmissionGrade;
  onSave: (
    q: Question,
    score: number,
    feedback: string,
    aiScore?: number,
    aiFeedback?: string,
    aiDetails?: EssayAiDetails,
    status?: SubmissionGrade['status'],
  ) => Promise<void>;
}) {
  const type = normalizeQuestionType(q);
  const [score, setScore] = useState(String(grade?.score ?? ''));
  const [feedback, setFeedback] = useState(grade?.feedback || '');
  const [details, setDetails] = useState<EssayAiDetails>(grade?.aiDetails || { summary: '', feedbackMarkdown: '', steps: [] });
  useEffect(() => {
    setScore(String(grade?.score ?? ''));
    setFeedback(grade?.feedback || '');
    setDetails(grade?.aiDetails || { summary: '', feedbackMarkdown: '', steps: [] });
  }, [grade]);
  const essayAnswer = type === 'writing' ? parseEssayAnswer(answer) : null;

  const essayGraded = type === 'writing' && grade && grade.status === 'GRADED';
  const reviewCls = !result
    ? ''
    : result.status === 'correct'
    ? 'review-correct'
    : result.status === 'partial' || essayGraded
    ? 'review-partial'
    : result.status === 'pending'
    ? 'review-pending'
    : 'review-wrong';

  const imageUrls = (q.images || [])
    .map((img) => {
      if (!img.base64) return null;
      const contentType = img.contentType || 'image/png';
      return img.base64.startsWith('data:') ? img.base64 : `data:${contentType};base64,${img.base64}`;
    })
    .filter(Boolean) as string[];

  return (
    <div className={`grade-question-block ${reviewCls}`}>
      <div className="work-question-head">
        <span className="badge badge-info">Câu {displayNum}</span>
        <span className="badge">{TYPE_LABEL[type]}</span>
        <span className="badge badge-warning">
          {result
            ? `${formatScore(essayGraded ? grade!.score : result.points)}/${formatScore(result.maxPoints)}đ`
            : `${Number(q.points) || 1}đ`}
        </span>
        {result && <ReviewStatusBadge result={result} grade={grade} type={type} />}
      </div>

      <MathText html={q.text} block />
      {imageUrls.length > 0 && (
        <div className="exam-question-images">
          {imageUrls.map((url, i) => <img key={i} src={url} alt={`Hình ${i + 1}`} />)}
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        {type === 'multiple_choice' && (
          <McReview options={q.options || []} answer={answer} correctAnswer={q.correctAnswer || ''} />
        )}
        {type === 'true_false' && (
          <TfReview options={getTrueFalseOptions(q)} answer={answer} correctAnswer={q.correctAnswer || ''} />
        )}
        {type === 'short_answer' && (
          <SaReview answer={answer} correctAnswer={q.correctAnswer || ''} result={result} />
        )}
        {type === 'writing' && <EssayReview answer={answer} />}
        {type === 'writing' && essayAnswer && essayAnswer.images.length > 0 && (
          <EssayImageAnnotator
            images={essayAnswer.images}
            steps={details.steps || []}
            onChange={(steps) => setDetails((current) => ({ ...current, steps }))}
          />
        )}
      </div>

      {type === 'writing' && q.correctAnswer && (
        <details className="review-solution" open>
          <summary>📌 Rubric / barem chấm</summary>
          <SolutionScoreTable content={q.correctAnswer} title="Tiêu chí / yêu cầu cần đạt" />
        </details>
      )}

      {q.solution && (
        <details className="review-solution">
          <summary>{type === 'writing' ? '💡 Lời giải tham khảo' : '💡 Lời giải / hướng dẫn chấm'}</summary>
          <SolutionScoreTable content={q.solution} title="Ý / bước trong lời giải" />
        </details>
      )}

      {(type === 'writing' || type === 'short_answer') && (
        <div className="manual-grade-inline">
          <input className="form-control" type="number" step="0.25" placeholder="Điểm" value={score} onChange={(e) => setScore(e.target.value)} />
          <div className="manual-grade-feedback">
            <textarea className="form-control" rows={3} placeholder="Nhận xét câu này; mỗi ý nên xuống dòng riêng" value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            {feedback.trim() && (
              <div className="grading-feedback-preview">
                <span className="grading-feedback-preview-label">Xem trước nhận xét</span>
                <MarkdownMath markdown={feedback} />
              </div>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => void onSave(
              q,
              Number(score) || 0,
              feedback,
              grade?.aiScore,
              grade?.aiFeedback,
              type === 'writing' ? details : grade?.aiDetails,
              'GRADED',
            )}
          >
            {type === 'writing' ? (grade?.status === 'AI_SUGGESTED' ? 'Xác nhận điểm & dấu ảnh' : 'Lưu điểm & dấu ảnh') : 'Lưu điểm câu'}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewStatusBadge({ result, grade, type }: { result: QuestionResult; grade?: SubmissionGrade; type: Exclude<QuestionType, 'unknown'> }) {
  if (type === 'writing') {
    if (grade && grade.status === 'GRADED') {
      return <span className="review-badge partial">🖊️ Đã xác nhận{grade.gradedByName ? ` · ${grade.gradedByName}` : ''}</span>;
    }
    if (grade && grade.status === 'AI_SUGGESTED') return <span className="review-badge pending">🤖 Gợi ý AI · chờ giáo viên</span>;
    return <span className="review-badge pending">⏳ Chưa chấm</span>;
  }
  if (result.status === 'correct') return <span className="review-badge correct">✓ Đúng</span>;
  if (result.status === 'partial') return <span className="review-badge partial">◐ Đúng {result.tfCorrectCount}/{result.tfTotal} ý</span>;
  if (result.status === 'unanswered') return <span className="review-badge wrong">— Bỏ trống</span>;
  return <span className="review-badge wrong">✕ Sai</span>;
}

// ── Trắc nghiệm: tô xanh đáp án đúng, đỏ đáp án HS chọn sai ──
function McReview({ options, answer, correctAnswer }: { options: QuestionOption[]; answer: string; correctAnswer: string }) {
  const correct = (correctAnswer || '').trim().toUpperCase();
  const picked = (answer || '').trim().toUpperCase();
  return (
    <div className="exam-mc-list">
      {options.map((o, idx) => {
        const displayLetter = String.fromCharCode(65 + idx);
        const isPicked = picked === o.letter.toUpperCase();
        const isCorrectOption = Boolean(correct) && o.letter.toUpperCase() === correct;
        const isWrongPick = isPicked && correct && !isCorrectOption;
        const cls = [
          'exam-mc-option',
          isPicked ? 'selected' : '',
          isCorrectOption ? 'review-right' : '',
          isWrongPick ? 'review-wrong-pick' : '',
        ].filter(Boolean).join(' ');
        return (
          <div key={`${o.letter}_${idx}`} className={cls} style={{ cursor: 'default' }}>
            <span className="exam-mc-letter">{displayLetter}</span>
            <MathText html={o.text} className="exam-option-text" />
            {isCorrectOption && <em className="exam-mc-check right">✓ Đáp án đúng{isPicked ? ' · HS chọn' : ''}</em>}
            {isWrongPick && <em className="exam-mc-check wrongpick">✕ HS chọn</em>}
          </div>
        );
      })}
      {!picked && <p className="grading-noanswer">— Học sinh chưa chọn đáp án —</p>}
    </div>
  );
}

// ── Đúng/Sai: bảng readonly, ✓/✕ từng mệnh đề, viền đứt = đáp án đúng ──
function TfReview({ options, answer, correctAnswer }: { options: QuestionOption[]; answer: string; correctAnswer: string }) {
  const map = parseTFAnswer(answer);
  const correctSet = parseTFCorrectSet(correctAnswer);
  return (
    <div className="exam-tf-wrap">
      <div className="exam-tf-table">
        <div className="exam-tf-header">
          <div className="exam-tf-head-statement">Mệnh đề</div>
          <div className="exam-tf-head-true"><span>Đúng</span></div>
          <div className="exam-tf-head-false"><span>Sai</span></div>
        </div>
        {options.map((o, idx) => {
          const key = o.letter.toLowerCase();
          const choseT = map[key] === 'T';
          const choseF = map[key] === 'F';
          const correctIsTrue = correctSet.has(key);
          const rowAnswered = choseT || choseF;
          const isRight = rowAnswered && ((choseT && correctIsTrue) || (choseF && !correctIsTrue));
          const isWrong = rowAnswered && !isRight;
          const displayLetter = String.fromCharCode(97 + idx);
          return (
            <div key={`${o.letter}_${idx}`} className={`exam-tf-row ${isRight ? 'true' : isWrong ? 'false' : idx % 2 === 1 ? 'alt' : ''}`}>
              <div className="exam-tf-statement">
                <span className={`exam-tf-letter ${isRight ? 'true' : isWrong ? 'false' : ''}`}>{displayLetter}</span>
                <MathText html={o.text} className="exam-option-text exam-tf-text" />
                <span className={`exam-tf-verdict ${isRight ? 'right' : isWrong ? 'wrong' : 'missed'}`}>
                  {isRight ? '✓' : isWrong ? '✕' : '—'}
                </span>
              </div>
              <div className={`exam-tf-cell exam-tf-cell-true ${choseT ? 'active' : ''} ${correctIsTrue ? 'is-answer' : ''}`} style={{ cursor: 'default' }}>
                {choseT ? <span className="exam-tf-mark">✓</span> : <span className="exam-tf-circle" />}
              </div>
              <div className={`exam-tf-cell exam-tf-cell-false ${choseF ? 'active' : ''} ${!correctIsTrue ? 'is-answer' : ''}`} style={{ cursor: 'default' }}>
                {choseF ? <span className="exam-tf-mark">✕</span> : <span className="exam-tf-circle" />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="exam-tf-legend">Ô có <span className="exam-tf-legend-ring" /> viền đứt là đáp án đúng của từng mệnh đề. Ô tô màu là lựa chọn của học sinh.</p>
    </div>
  );
}

// ── Trả lời ngắn: đáp án HS + đáp án đúng ──
function SaReview({ answer, correctAnswer, result }: { answer: string; correctAnswer: string; result?: QuestionResult }) {
  const isCorrect = result?.status === 'correct';
  const unanswered = !answer || !answer.trim();
  return (
    <div className={`exam-sa-box review ${isCorrect ? 'right' : 'wrong'}`}>
      <label className="exam-sa-label">Đáp án của học sinh</label>
      <div className={`review-sa-answer ${isCorrect ? 'right' : 'wrong'}`}>
        {unanswered ? <em>— Chưa trả lời —</em> : <MathText html={mathify(answer)} />}
        <span className="review-sa-mark">{isCorrect ? '✓' : '✕'}</span>
      </div>
      {!isCorrect && correctAnswer && (
        <div className="review-sa-correct">
          <span>Đáp án đúng:</span> <MathText html={mathify(correctAnswer)} />
        </div>
      )}
    </div>
  );
}

// ── Tự luận: hiện bài làm text + ảnh ──
function EssayReview({ answer }: { answer: string }) {
  const essay = parseEssayAnswer(answer);
  const empty = !essay.text.trim() && essay.images.length === 0;
  return (
    <div className="student-answer-box">
      <strong>Bài làm:</strong>
      {empty ? (
        <div style={{ marginTop: 6, color: 'var(--text-muted)' }}>— Học sinh chưa làm câu này —</div>
      ) : (
        <>
          {essay.text && <MarkdownMath markdown={essay.text} />}
          {essay.images?.length > 0 && (
            <div className="essay-images">
              {essay.images.map((img, i) => (
                <a className="essay-image" key={img.fileId || i} href={img.url} target="_blank" rel="noreferrer"><img src={img.thumbnailUrl || img.url} alt={img.fileName || 'Bài làm'} loading="lazy" /></a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
