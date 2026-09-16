import { adminDb } from './firebaseAdmin.js';

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.keys(value).sort().map((key) => value[key]);
  return [];
}

export async function readAssignmentExam(examId) {
  const snap = await adminDb.doc(`assignmentExams/${examId}`).get();
  if (!snap.exists) throw Object.assign(new Error('Không tìm thấy đề thi.'), { statusCode: 404 });
  const d = snap.data() || {};

  let payload = null;
  if (d.payloadStorage === 'CHUNKS' || Number(d.payloadChunkCount) > 0) {
    const chunks = await adminDb.collection(`assignmentExams/${examId}/payloadChunks`).orderBy('index').get();
    const json = chunks.docs.map((doc) => String(doc.data().text || '')).join('');
    payload = parseJson(json, null);
  }

  const questions = (payload?.questions || parseJson(d.questionsJson, normalizeArray(d.questions)) || []).map((q, index) => ({
    ...q,
    number: Number(q.number) || index + 1,
    points: Number(q.points) > 0 ? Number(q.points) : 1,
  }));
  const sections = payload?.sections || parseJson(d.sectionsJson, normalizeArray(d.sections)) || [];
  const images = payload?.images || parseJson(d.imagesJson, normalizeArray(d.images)) || [];
  const pointsConfig = parseJson(d.pointsConfigJson, null);

  return {
    id: snap.id,
    title: String(d.title || ''),
    subject: String(d.subject || ''),
    questions,
    sections,
    images,
    totalQuestions: Number(d.totalQuestions) || questions.length,
    maxScore: Number(pointsConfig?.maxScore) || Number(d.maxScore) || questions.reduce((sum, q) => sum + (Number(q.points) || 1), 0),
    pointsConfig: pointsConfig || undefined,
    sourceFileName: d.sourceFileName || '',
    answerSourceFileName: d.answerSourceFileName || '',
    createdBy: d.createdBy || '',
    createdByName: d.createdByName || '',
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export function stripAnswerKey(exam) {
  return {
    ...exam,
    questions: (exam.questions || []).map((q) => ({
      ...q,
      correctAnswer: undefined,
      solution: undefined,
      solutionImages: undefined,
      options: (q.options || []).map(({ isCorrect: _isCorrect, ...option }) => option),
    })),
    sections: (exam.sections || []).map((section) => ({
      ...section,
      questions: (section.questions || []).map((q) => ({
        ...q,
        correctAnswer: undefined,
        solution: undefined,
        solutionImages: undefined,
        options: (q.options || []).map(({ isCorrect: _isCorrect, ...option }) => option),
      })),
    })),
  };
}

export function toMillis(value) {
  if (!value) return undefined;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.getTime();
}

export function plainAssignment(id, d) {
  return {
    id,
    examId: String(d.examId || ''),
    title: String(d.title || ''),
    description: String(d.description || ''),
    classId: String(d.classId || ''),
    className: String(d.className || ''),
    mode: d.mode === 'exam' ? 'exam' : 'homework',
    status: d.status || 'draft',
    opensAt: toMillis(d.opensAt),
    closesAt: toMillis(d.closesAt),
    timeLimit: Number(d.timeLimit) || 0,
    allowResubmit: d.allowResubmit !== false,
    shuffleQuestions: Boolean(d.shuffleQuestions),
    shuffleOptions: Boolean(d.shuffleOptions),
    antiCheat: Boolean(d.antiCheat),
    resultVisibility: d.resultVisibility === 'full_review' ? 'full_review' : 'score_only',
    batchId: d.batchId || undefined,
    answersReleasedAt: toMillis(d.answersReleasedAt),
    answersReleasedBy: d.answersReleasedBy || undefined,
    assignedBy: String(d.assignedBy || ''),
    assignedByName: d.assignedByName || undefined,
    assignedAt: toMillis(d.assignedAt),
    createdAt: toMillis(d.createdAt),
    updatedAt: toMillis(d.updatedAt),
  };
}

export function plainExam(exam) {
  return {
    ...exam,
    createdAt: toMillis(exam.createdAt),
    updatedAt: toMillis(exam.updatedAt),
  };
}

export function plainGrade(id, d) {
  return {
    id,
    submissionId: String(d.submissionId || ''),
    assignmentId: String(d.assignmentId || ''),
    studentId: String(d.studentId || ''),
    questionNumber: d.questionNumber ?? 'FINAL',
    score: Number(d.score) || 0,
    maxScore: Number(d.maxScore) || 0,
    feedback: String(d.feedback || ''),
    aiScore: d.aiScore === undefined ? undefined : Number(d.aiScore),
    aiFeedback: d.aiFeedback || undefined,
    status: d.status || 'NOT_GRADED',
    gradedBy: d.gradedBy || undefined,
    gradedByName: d.gradedByName || undefined,
    updatedAt: toMillis(d.updatedAt),
  };
}

export function plainSubmission(id, d, { includeAnswers = false, includeDetails = false, questionResults } = {}) {
  return {
    id,
    assignmentId: String(d.assignmentId || ''),
    examId: String(d.examId || ''),
    classId: String(d.classId || ''),
    studentId: String(d.studentId || ''),
    studentName: String(d.studentName || ''),
    answers: includeAnswers ? (d.answers || {}) : {},
    status: d.status || 'in_progress',
    autoScore: Number(d.autoScore) || 0,
    finalScore: d.finalScore === undefined ? undefined : Number(d.finalScore),
    maxScore: Number(d.maxScore) || 0,
    correctCount: includeDetails ? Number(d.correctCount) || 0 : 0,
    wrongCount: includeDetails ? Number(d.wrongCount) || 0 : 0,
    totalQuestions: includeDetails ? Number(d.totalQuestions) || 0 : 0,
    pendingCount: Math.max(0, Number(d.pendingCount) || 0),
    questionResults: questionResults || undefined,
    startedAt: toMillis(d.startedAt),
    updatedAt: toMillis(d.updatedAt),
    submittedAt: toMillis(d.submittedAt),
    gradedAt: toMillis(d.gradedAt),
    gradedBy: d.gradedBy || undefined,
    gradedByName: d.gradedByName || undefined,
    tabSwitchCount: Number(d.tabSwitchCount) || 0,
    tabSwitchWarnings: Array.isArray(d.tabSwitchWarnings) ? d.tabSwitchWarnings : [],
    autoSubmitted: Boolean(d.autoSubmitted),
    attemptCount: Math.max(0, Number(d.attemptCount) || 0),
  };
}
