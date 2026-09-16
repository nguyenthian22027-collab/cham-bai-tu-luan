import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import {
  AppUser,
  Assignment,
  AssignmentExam,
  AssignmentMode,
  AssignmentStatus,
  EssayAiDetails,
  AssignmentTarget,
  ClassItem,
  ExamPointsConfig,
  Question,
  QuestionResult,
  Submission,
  SubmissionGrade,
  Student,
  TargetStatus,
} from '../types';
import { Role } from '../types';
import { getClasses, getClassById, getClassRoster } from './dataService';

const toDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return undefined;
};

const clean = <T extends Record<string, unknown>>(obj: T): T => {
  const out: Record<string, unknown> = {};
  Object.entries(obj).forEach(([k, v]) => {
    out[k] = v === undefined ? null : v;
  });
  return out as T;
};

const safeJson = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null, (_key, v) => {
      if (v === undefined) return null;
      if (typeof v === 'number' && (!Number.isFinite(v) || Number.isNaN(v))) return 0;
      if (typeof v === 'function') return null;
      return v;
    });
  } catch {
    return 'null';
  }
};

const parseJson = <T,>(value: unknown, fallback: T): T => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const readArrayField = <T,>(jsonValue: unknown, legacyValue: unknown): T[] => {
  const fromJson = parseJson<T[]>(jsonValue, []);
  if (Array.isArray(fromJson) && fromJson.length > 0) return fromJson;
  if (Array.isArray(legacyValue)) return legacyValue as T[];
  if (legacyValue && typeof legacyValue === 'object') {
    return Object.entries(legacyValue as Record<string, T>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => v);
  }
  return [];
};

// Firestore document limit is ~1 MiB. A Word exam with formulas/images can be
// larger than that, so the heavy exam payload is stored in chunk documents:
// assignmentExams/{examId}/payloadChunks/{0000,0001,...}
const EXAM_PAYLOAD_CHUNK_SIZE = 450_000;

type ExamPayload = {
  questions: Question[];
  sections?: AssignmentExam['sections'];
  images?: AssignmentExam['images'];
};

const chunkArrayLocal = <T,>(arr: T[], size: number) => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
};

const chunkString = (value: string, size = EXAM_PAYLOAD_CHUNK_SIZE): string[] => {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += size) chunks.push(value.slice(i, i + size));
  return chunks.length ? chunks : [''];
};

const normalizeQuestions = (raw: Question[]): Question[] =>
  (raw || []).map((q, index) => ({
    ...q,
    number: Number(q.number) || index + 1,
    points: Number(q.points) > 0 ? Number(q.points) : 1,
  }));

const makeChunkDocId = (index: number) => String(index).padStart(4, '0');

async function writeExamPayloadChunks(examId: string, payload: ExamPayload) {
  const json = safeJson(payload);
  const chunks = chunkString(json);
  const chunkPayloads = chunks.map((text, index) => ({ index, text }));

  for (const part of chunkArrayLocal(chunkPayloads, 440)) {
    const batch = writeBatch(db);
    part.forEach((item) => {
      batch.set(
        doc(db, 'assignmentExams', examId, 'payloadChunks', makeChunkDocId(item.index)),
        {
          index: item.index,
          text: item.text,
          createdAt: serverTimestamp(),
        }
      );
    });
    await batch.commit();
  }
}

async function readExamPayloadChunks(
  examId: string,
  d: Record<string, unknown>
): Promise<ExamPayload | null> {
  const chunkCount = Number(d.payloadChunkCount) || 0;
  const isChunked = d.payloadStorage === 'CHUNKS' || chunkCount > 0;
  if (!isChunked) return null;

  const snap = await getDocs(collection(db, 'assignmentExams', examId, 'payloadChunks'));
  if (snap.empty) return null;

  const json = snap.docs
    .map((chunk) => {
      const cd = chunk.data() as Record<string, unknown>;
      return {
        index: Number(cd.index) || 0,
        text: (cd.text as string) || '',
      };
    })
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.text)
    .join('');

  return parseJson<ExamPayload>(json, { questions: [] });
}

export const assignmentTargetId = (assignmentId: string, studentId: string) =>
  `${assignmentId}__${studentId}`;

export const submissionIdOf = assignmentTargetId;

export function calcExamMaxScore(questions: Question[]) {
  return questions.reduce((sum, q) => sum + (Number(q.points) > 0 ? Number(q.points) : 1), 0);
}

const mapExam = (
  id: string,
  d: Record<string, unknown>,
  payload?: ExamPayload | null
): AssignmentExam => {
  const rawQuestions = Array.isArray(payload?.questions)
    ? payload!.questions
    : readArrayField<Question>(d.questionsJson, d.questions);
  const questions = normalizeQuestions(rawQuestions);

  const sections = Array.isArray(payload?.sections)
    ? payload!.sections || []
    : readArrayField<NonNullable<AssignmentExam['sections']>[number]>(d.sectionsJson, d.sections);

  const images = Array.isArray(payload?.images)
    ? payload!.images || []
    : readArrayField<NonNullable<AssignmentExam['images']>[number]>(d.imagesJson, d.images);

  const pointsConfig = parseJson<ExamPointsConfig | null>(d.pointsConfigJson, null);

  return {
    id,
    title: (d.title as string) || '',
    subject: (d.subject as string) || '',
    questions,
    sections,
    images,
    totalQuestions: Number(d.totalQuestions) || questions.length,
    maxScore: pointsConfig?.maxScore || Number(d.maxScore) || calcExamMaxScore(questions),
    pointsConfig: pointsConfig || undefined,
    sourceFileName: d.sourceFileName as string | undefined,
    answerSourceFileName: d.answerSourceFileName as string | undefined,
    createdBy: (d.createdBy as string) || '',
    createdByName: d.createdByName as string | undefined,
    createdAt: toDate(d.createdAt),
    updatedAt: toDate(d.updatedAt),
  };
};


const mapAssignment = (id: string, d: Record<string, unknown>): Assignment => ({
  id,
  examId: (d.examId as string) || '',
  title: (d.title as string) || '',
  description: (d.description as string) || '',
  classId: (d.classId as string) || '',
  className: (d.className as string) || '',
  mode: (d.mode as AssignmentMode) || 'homework',
  status: (d.status as AssignmentStatus) || 'draft',
  opensAt: toDate(d.opensAt),
  closesAt: toDate(d.closesAt),
  timeLimit: Number(d.timeLimit) || 0,
  allowResubmit: (d.allowResubmit as boolean) ?? true,
  maxAttempts: Math.min(3, Math.max(1, Number(d.maxAttempts) || 1)),
  shuffleQuestions: (d.shuffleQuestions as boolean) ?? false,
  shuffleOptions: (d.shuffleOptions as boolean) ?? false,
  antiCheat: (d.antiCheat as boolean) ?? false,
  resultVisibility: d.resultVisibility === 'full_review' ? 'full_review' : 'score_only',
  batchId: d.batchId as string | undefined,
  answersReleasedAt: toDate(d.answersReleasedAt),
  answersReleasedBy: d.answersReleasedBy as string | undefined,
  assignedBy: (d.assignedBy as string) || '',
  assignedByName: d.assignedByName as string | undefined,
  assignedAt: toDate(d.assignedAt),
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt),
});

const mapTarget = (id: string, d: Record<string, unknown>): AssignmentTarget => ({
  id,
  assignmentId: (d.assignmentId as string) || '',
  examId: (d.examId as string) || '',
  classId: (d.classId as string) || '',
  className: (d.className as string) || '',
  studentId: (d.studentId as string) || '',
  studentName: (d.studentName as string) || '',
  status: (d.status as TargetStatus) || 'assigned',
  openedAt: toDate(d.openedAt),
  startedAt: toDate(d.startedAt),
  submittedAt: toDate(d.submittedAt),
  gradedAt: toDate(d.gradedAt),
  autoScore: Number(d.autoScore) || 0,
  aiScore: d.aiScore === undefined ? undefined : Number(d.aiScore),
  finalScore: d.finalScore === undefined ? undefined : Number(d.finalScore),
  maxScore: d.maxScore === undefined ? undefined : Number(d.maxScore),
});

const mapSubmission = (id: string, d: Record<string, unknown>): Submission => ({
  id,
  assignmentId: (d.assignmentId as string) || '',
  examId: (d.examId as string) || '',
  classId: (d.classId as string) || '',
  studentId: (d.studentId as string) || '',
  studentName: (d.studentName as string) || '',
  answers: ((d.answers as Record<string, string>) || {}) ?? {},
  status: (d.status as Submission['status']) || 'in_progress',
  autoScore: Number(d.autoScore) || 0,
  finalScore: d.finalScore === undefined ? undefined : Number(d.finalScore),
  maxScore: Number(d.maxScore) || 0,
  correctCount: Number(d.correctCount) || 0,
  wrongCount: Number(d.wrongCount) || 0,
  totalQuestions: Number(d.totalQuestions) || 0,
  questionResults: parseJson<Record<string, QuestionResult> | undefined>(d.questionResultsJson, undefined),
  startedAt: toDate(d.startedAt),
  updatedAt: toDate(d.updatedAt),
  submittedAt: toDate(d.submittedAt),
  gradedAt: toDate(d.gradedAt),
  gradedBy: d.gradedBy as string | undefined,
  gradedByName: d.gradedByName as string | undefined,
  tabSwitchCount: Number(d.tabSwitchCount) || 0,
  tabSwitchWarnings: Array.isArray(d.tabSwitchWarnings) ? (d.tabSwitchWarnings as string[]) : [],
  autoSubmitted: Boolean(d.autoSubmitted),
  attemptCount: Number(d.attemptCount) || 0,
});

const mapGrade = (id: string, d: Record<string, unknown>): SubmissionGrade => ({
  id,
  submissionId: (d.submissionId as string) || '',
  assignmentId: (d.assignmentId as string) || '',
  studentId: (d.studentId as string) || '',
  questionNumber: (d.questionNumber as number | 'FINAL') || 'FINAL',
  score: Number(d.score) || 0,
  maxScore: Number(d.maxScore) || 0,
  feedback: (d.feedback as string) || '',
  aiScore: d.aiScore === undefined ? undefined : Number(d.aiScore),
  aiFeedback: d.aiFeedback as string | undefined,
  aiDetails: d.aiDetails && typeof d.aiDetails === 'object' ? (d.aiDetails as EssayAiDetails) : undefined,
  status: (d.status as SubmissionGrade['status']) || 'NOT_GRADED',
  gradedBy: d.gradedBy as string | undefined,
  gradedByName: d.gradedByName as string | undefined,
  updatedAt: toDate(d.updatedAt),
});


type ApiDate = number | string | null | undefined;
type ApiAssignment = Omit<Assignment, 'opensAt' | 'closesAt' | 'assignedAt' | 'createdAt' | 'updatedAt' | 'answersReleasedAt'> & {
  opensAt?: ApiDate;
  closesAt?: ApiDate;
  assignedAt?: ApiDate;
  createdAt?: ApiDate;
  updatedAt?: ApiDate;
  answersReleasedAt?: ApiDate;
};
type ApiExam = Omit<AssignmentExam, 'createdAt' | 'updatedAt'> & { createdAt?: ApiDate; updatedAt?: ApiDate };
type ApiSubmission = Omit<Submission, 'startedAt' | 'updatedAt' | 'submittedAt' | 'gradedAt'> & {
  startedAt?: ApiDate;
  updatedAt?: ApiDate;
  submittedAt?: ApiDate;
  gradedAt?: ApiDate;
};
type ApiGrade = Omit<SubmissionGrade, 'updatedAt'> & { updatedAt?: ApiDate };

const apiDate = (v: ApiDate): Date | undefined => {
  if (v === null || v === undefined || v === '') return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

const mapApiAssignment = (a: ApiAssignment): Assignment => ({
  ...a,
  opensAt: apiDate(a.opensAt),
  closesAt: apiDate(a.closesAt),
  assignedAt: apiDate(a.assignedAt),
  createdAt: apiDate(a.createdAt),
  updatedAt: apiDate(a.updatedAt),
  answersReleasedAt: apiDate(a.answersReleasedAt),
});

const mapApiExam = (e: ApiExam): AssignmentExam => ({
  ...e,
  createdAt: apiDate(e.createdAt),
  updatedAt: apiDate(e.updatedAt),
});

const mapApiSubmission = (sub: ApiSubmission): Submission => ({
  ...sub,
  startedAt: apiDate(sub.startedAt),
  updatedAt: apiDate(sub.updatedAt),
  submittedAt: apiDate(sub.submittedAt),
  gradedAt: apiDate(sub.gradedAt),
});

const mapApiGrade = (g: ApiGrade): SubmissionGrade => ({
  ...g,
  updatedAt: apiDate(g.updatedAt),
});

async function callStudentApi<T>(path: string, init?: RequestInit): Promise<T> {
  const current = auth.currentUser;
  if (!current) throw new Error('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.');
  const token = await current.getIdToken();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Lỗi máy chủ (${response.status})`);
  return data as T;
}

export async function getStudentAssignmentPackage(assignmentId: string): Promise<{
  assignment: Assignment;
  exam: AssignmentExam;
  submission: Submission | null;
  grades: SubmissionGrade[];
  canReview: boolean;
  attemptCount: number;       // 🆕 số lần đã nộp
  attemptsRemaining: number;  // 🆕 số lần còn được làm lại
}> {
  const data = await callStudentApi<{
    assignment: ApiAssignment;
    exam: ApiExam;
    submission: ApiSubmission | null;
    grades?: ApiGrade[];
    canReview: boolean;
    attemptCount?: number;
    attemptsRemaining?: number;
  }>(`/api/student-assignment?assignmentId=${encodeURIComponent(assignmentId)}`);
  return {
    assignment: mapApiAssignment(data.assignment),
    exam: mapApiExam(data.exam),
    submission: data.submission ? mapApiSubmission(data.submission) : null,
    grades: (data.grades || []).map(mapApiGrade),
    canReview: Boolean(data.canReview),
    attemptCount: Number(data.attemptCount) || 0,
    attemptsRemaining: Math.max(0, Number(data.attemptsRemaining) || 0),
  };
}

// 🆕 Xin máy chủ mở lại một lượt làm mới (sau khi đã nộp mà vẫn còn lượt).
// Máy chủ kiểm tra hạn nộp và số lượt còn lại rồi đưa bài về trạng thái
// in_progress; sau đó gọi lại getStudentAssignmentPackage sẽ có đủ câu hỏi.
export async function retryAssignment(assignmentId: string): Promise<Submission> {
  const payload = await callStudentApi<{ submission: ApiSubmission }>('/api/retry-assignment', {
    method: 'POST',
    body: JSON.stringify({ assignmentId }),
  });
  return mapApiSubmission(payload.submission);
}

export async function createAssignmentExam(params: {
  title: string;
  subject: string;
  questions: Question[];
  sections?: AssignmentExam['sections'];
  images?: AssignmentExam['images'];
  sourceFileName?: string;
  answerSourceFileName?: string;
  createdBy: AppUser;
  pointsConfig?: ExamPointsConfig | null; // 🆕 cấu hình điểm tùy chỉnh
}): Promise<string> {
  let questions = normalizeQuestions(params.questions);

  // 🆕 Nếu có cấu hình điểm → "đóng dấu" điểm mỗi câu theo config để mọi nơi
  // (chấm bài, hiển thị, EssayGraderPanel) dùng đúng điểm đã cấu hình.
  if (params.pointsConfig) {
    const cfg = params.pointsConfig;
    questions = questions.map((q) => {
      const type =
        q.type === 'true_false' || q.type === 'multiple_choice' || q.type === 'short_answer' || q.type === 'writing'
          ? q.type
          : q.tfStatements && Object.keys(q.tfStatements).length > 0
          ? 'true_false'
          : q.options && q.options.length > 0
          ? 'multiple_choice'
          : 'short_answer';
      const section = cfg.sections.find((s) => s.sectionId === type);
      return section ? { ...q, points: section.pointsPerQuestion } : q;
    });
  }

  const payload: ExamPayload = {
    questions,
    sections: params.sections || [],
    images: params.images || [],
  };
  const payloadJson = safeJson(payload);
  const chunks = chunkString(payloadJson);

  // Chỉ lưu metadata nhỏ ở document chính. Nội dung đề lớn lưu ở subcollection
  // payloadChunks để tránh lỗi Firestore document > 1 MiB:
  // "The value of property questionsJson is longer than 1048487 bytes".
  const ref = await addDoc(collection(db, 'assignmentExams'), clean({
    title: params.title.trim(),
    subject: params.subject || '',
    payloadStorage: 'CHUNKS',
    payloadChunkCount: chunks.length,
    totalQuestions: questions.length,
    maxScore: params.pointsConfig?.maxScore || calcExamMaxScore(questions),
    pointsConfigJson: params.pointsConfig ? safeJson(params.pointsConfig) : null, // 🆕
    sourceFileName: params.sourceFileName || '',
    answerSourceFileName: params.answerSourceFileName || '',
    createdBy: params.createdBy.id,
    createdByName: params.createdBy.name,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  await writeExamPayloadChunks(ref.id, payload);
  return ref.id;
}


export async function getAssignmentExam(examId: string): Promise<AssignmentExam | null> {
  const snap = await getDoc(doc(db, 'assignmentExams', examId));
  if (!snap.exists()) return null;
  const data = snap.data();
  const payload = await readExamPayloadChunks(snap.id, data);
  return mapExam(snap.id, data, payload);
}

export async function getAssignmentExams(user: AppUser): Promise<AssignmentExam[]> {
  const snap = user.role === Role.ADMIN
    ? await getDocs(collection(db, 'assignmentExams'))
    : await getDocs(query(collection(db, 'assignmentExams'), where('createdBy', '==', user.id)));
  return snap.docs.map((d) => mapExam(d.id, d.data())).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

export async function createAssignment(params: {
  examId: string;
  title: string;
  description: string;
  classInfo: ClassItem;
  mode: AssignmentMode;
  opensAt?: Date | null;
  closesAt?: Date | null;
  timeLimit: number;
  allowResubmit: boolean;
  maxAttempts?: number; // 🆕 số lần được làm (1–3)
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  antiCheat: boolean;
  assignedBy: AppUser;
  selectedStudentIds?: string[];
  batchId?: string;
  resultVisibility?: 'score_only' | 'full_review';
}): Promise<string> {
  const exam = await getAssignmentExam(params.examId);
  if (!exam) throw new Error('Không tìm thấy đề/bài tập.');
  const roster = await getClassRoster(params.classInfo.id);
  const targets = params.selectedStudentIds?.length
    ? roster.filter((s) => params.selectedStudentIds?.includes(s.id))
    : roster;
  if (targets.length === 0) throw new Error('Lớp chưa có học sinh hoặc chưa chọn học sinh.');

  const assignmentRef = await addDoc(collection(db, 'assignments'), clean({
    examId: params.examId,
    title: params.title.trim(),
    description: params.description || '',
    classId: params.classInfo.id,
    className: params.classInfo.className,
    mode: params.mode,
    status: 'published',
    opensAt: params.opensAt || null,
    closesAt: params.closesAt || null,
    timeLimit: Number(params.timeLimit) || 0,
    allowResubmit: params.allowResubmit,
    maxAttempts: Math.min(3, Math.max(1, Number(params.maxAttempts) || 1)),
    shuffleQuestions: params.shuffleQuestions,
    shuffleOptions: params.shuffleOptions,
    antiCheat: params.antiCheat,
    resultVisibility: params.resultVisibility || 'score_only',
    batchId: params.batchId || '',
    assignedBy: params.assignedBy.id,
    assignedByName: params.assignedBy.name,
    assignedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));

  const batch = writeBatch(db);
  targets.forEach((s: Student) => {
    const id = assignmentTargetId(assignmentRef.id, s.id);
    batch.set(doc(db, 'assignmentTargets', id), clean({
      assignmentId: assignmentRef.id,
      examId: params.examId,
      classId: params.classInfo.id,
      className: params.classInfo.className,
      studentId: s.id,
      studentName: s.fullName,
      status: 'assigned',
      maxScore: exam.maxScore,
      createdAt: serverTimestamp(),
    }));
  });
  await batch.commit();
  return assignmentRef.id;
}


export async function createAssignmentsForClasses(params: {
  examId: string;
  title: string;
  description: string;
  classItems: ClassItem[];
  mode: AssignmentMode;
  opensAt?: Date | null;
  closesAt?: Date | null;
  timeLimit: number;
  allowResubmit: boolean;
  maxAttempts?: number; // 🆕 số lần được làm (1–3)
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  antiCheat: boolean;
  assignedBy: AppUser;
  selectedStudentIdsByClass?: Record<string, string[]>;
}): Promise<string[]> {
  if (params.classItems.length === 0) throw new Error('Chưa chọn lớp cần giao bài.');
  const batchId = `batch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const ids: string[] = [];
  for (const classInfo of params.classItems) {
    const id = await createAssignment({
      examId: params.examId,
      title: params.title,
      description: params.description,
      classInfo,
      mode: params.mode,
      opensAt: params.opensAt,
      closesAt: params.closesAt,
      timeLimit: params.timeLimit,
      allowResubmit: params.allowResubmit,
      maxAttempts: params.maxAttempts,
      shuffleQuestions: params.shuffleQuestions,
      shuffleOptions: params.shuffleOptions,
      antiCheat: params.antiCheat,
      assignedBy: params.assignedBy,
      selectedStudentIds: params.selectedStudentIdsByClass?.[classInfo.id],
      batchId,
      resultVisibility: 'score_only',
    });
    ids.push(id);
  }
  return ids;
}

export async function updateAssignmentAnswerVisibility(
  id: string,
  visible: boolean,
  changedBy?: AppUser
) {
  await updateDoc(doc(db, 'assignments', id), {
    resultVisibility: visible ? 'full_review' : 'score_only',
    answersReleasedAt: visible ? serverTimestamp() : null,
    answersReleasedBy: visible ? changedBy?.id || '' : '',
    updatedAt: serverTimestamp(),
  });
}

export async function getAssignment(id: string): Promise<Assignment | null> {
  const snap = await getDoc(doc(db, 'assignments', id));
  return snap.exists() ? mapAssignment(snap.id, snap.data()) : null;
}

export async function getAssignments(user: AppUser): Promise<Assignment[]> {
  let snaps;
  if (user.role === Role.ADMIN) {
    snaps = await getDocs(collection(db, 'assignments'));
  } else {
    const classes = await getClasses(user);
    const ids = classes.map((c) => c.id);
    if (ids.length === 0) return [];
    const all: Assignment[] = [];
    for (const cid of ids) {
      const s = await getDocs(query(collection(db, 'assignments'), where('classId', '==', cid)));
      all.push(...s.docs.map((d) => mapAssignment(d.id, d.data())));
    }
    return all.sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }
  return snaps.docs.map((d) => mapAssignment(d.id, d.data())).sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
}

export async function updateAssignmentStatus(id: string, status: AssignmentStatus) {
  await updateDoc(doc(db, 'assignments', id), { status, updatedAt: serverTimestamp() });
}

type DeleteAssignmentResult = {
  success: boolean;
  assignmentId: string;
  deletedExam: boolean;
  counts: {
    targets: number;
    submissions: number;
    grades: number;
    publishedResults: number;
    images: number;
    driveImagesDeleted: number;
    driveImagesPending: number;
  };
  warning?: string;
};

/**
 * Xóa vĩnh viễn một bài đã giao bằng API Firebase Admin để dọn đồng bộ
 * targets, bài làm, điểm, link công bố và ảnh Drive. Không xóa assignmentExam
 * nếu đề đó vẫn đang được một bài giao khác sử dụng.
 */
export async function deleteAssignmentPermanently(assignmentId: string): Promise<DeleteAssignmentResult> {
  const current = auth.currentUser;
  if (!current) throw new Error('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.');
  const token = await current.getIdToken();
  const response = await fetch('/api/delete-assignment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ assignmentId }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Không xóa được bài (${response.status}).`);
  return data as DeleteAssignmentResult;
}

export async function getAssignmentTargets(assignmentId: string): Promise<AssignmentTarget[]> {
  const snap = await getDocs(query(collection(db, 'assignmentTargets'), where('assignmentId', '==', assignmentId)));
  return snap.docs.map((d) => mapTarget(d.id, d.data())).sort((a, b) => a.studentName.localeCompare(b.studentName));
}

export async function getSubmissionsForAssignment(assignmentId: string): Promise<Submission[]> {
  const snap = await getDocs(query(collection(db, 'submissions'), where('assignmentId', '==', assignmentId)));
  return snap.docs.map((d) => mapSubmission(d.id, d.data()));
}

export async function getStudentAssignmentTargets(studentId: string): Promise<AssignmentTarget[]> {
  const snap = await getDocs(query(collection(db, 'assignmentTargets'), where('studentId', '==', studentId)));
  return snap.docs.map((d) => mapTarget(d.id, d.data())).sort((a, b) => (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0));
}

export async function openAssignmentForStudent(assignmentId: string, studentId: string) {
  const id = assignmentTargetId(assignmentId, studentId);
  await setDoc(doc(db, 'assignmentTargets', id), { openedAt: serverTimestamp() }, { merge: true });
}

export async function startOrGetSubmission(params: {
  assignment: Assignment;
  exam: AssignmentExam;
  studentId: string;
  studentName: string;
}): Promise<Submission> {
  const id = submissionIdOf(params.assignment.id, params.studentId);
  const ref = doc(db, 'submissions', id);
  const snap = await getDoc(ref);
  if (snap.exists()) return mapSubmission(snap.id, snap.data());

  const payload = clean({
    assignmentId: params.assignment.id,
    examId: params.exam.id,
    classId: params.assignment.classId,
    studentId: params.studentId,
    studentName: params.studentName,
    answers: {},
    status: 'in_progress',
    autoScore: 0,
    maxScore: params.exam.maxScore,
    correctCount: 0,
    wrongCount: 0,
    totalQuestions: params.exam.totalQuestions,
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await setDoc(ref, payload);
  await setDoc(doc(db, 'assignmentTargets', assignmentTargetId(params.assignment.id, params.studentId)), {
    status: 'in_progress',
    startedAt: serverTimestamp(),
  }, { merge: true });
  return mapSubmission(id, { ...payload, startedAt: new Date(), updatedAt: new Date() });
}

export async function saveSubmissionDraft(submissionId: string, answers: Record<string, string>) {
  await updateDoc(doc(db, 'submissions', submissionId), clean({
    answers,
    updatedAt: serverTimestamp(),
  }));
}

export async function submitAssignment(params: {
  submissionId: string;
  answers: Record<string, string>;
  tabSwitchCount?: number;
  autoSubmitted?: boolean;
}): Promise<Submission> {
  const payload = await callStudentApi<{
    submission: ApiSubmission;
  }>('/api/submit-assignment', {
    method: 'POST',
    body: JSON.stringify({
      submissionId: params.submissionId,
      answers: params.answers,
      tabSwitchCount: params.tabSwitchCount || 0,
      autoSubmitted: Boolean(params.autoSubmitted),
    }),
  });
  return mapApiSubmission(payload.submission);
}

export async function getSubmission(submissionId: string): Promise<Submission | null> {
  const snap = await getDoc(doc(db, 'submissions', submissionId));
  return snap.exists() ? mapSubmission(snap.id, snap.data()) : null;
}

export async function getSubmissionGrades(submissionId: string): Promise<SubmissionGrade[]> {
  const snap = await getDocs(query(collection(db, 'submissionGrades'), where('submissionId', '==', submissionId)));
  return snap.docs.map((d) => mapGrade(d.id, d.data()));
}

export async function saveQuestionGrade(params: {
  submission: Submission;
  questionNumber: number;
  score: number;
  maxScore: number;
  feedback: string;
  aiScore?: number;
  aiFeedback?: string;
  aiDetails?: EssayAiDetails;
  status?: SubmissionGrade['status'];
  gradedBy: AppUser;
}) {
  const id = `${params.submission.id}__${params.questionNumber}`;
  await setDoc(doc(db, 'submissionGrades', id), clean({
    submissionId: params.submission.id,
    assignmentId: params.submission.assignmentId,
    studentId: params.submission.studentId,
    questionNumber: params.questionNumber,
    score: Number(params.score) || 0,
    maxScore: Number(params.maxScore) || 0,
    feedback: params.feedback || '',
    aiScore: params.aiScore,
    aiFeedback: params.aiFeedback || '',
    aiDetails: params.aiDetails ? JSON.parse(JSON.stringify(params.aiDetails)) : null,
    status: params.status || 'GRADED',
    gradedBy: params.gradedBy.id,
    gradedByName: params.gradedBy.name,
    updatedAt: serverTimestamp(),
  }), { merge: true });
}

export async function finalizeSubmissionGrade(params: {
  submission: Submission;
  finalScore: number;
  feedback: string;
  gradedBy: AppUser;
}) {
  await setDoc(doc(db, 'submissionGrades', `${params.submission.id}__FINAL`), clean({
    submissionId: params.submission.id,
    assignmentId: params.submission.assignmentId,
    studentId: params.submission.studentId,
    questionNumber: 'FINAL',
    score: Number(params.finalScore) || 0,
    maxScore: params.submission.maxScore,
    feedback: params.feedback || '',
    status: 'GRADED',
    gradedBy: params.gradedBy.id,
    gradedByName: params.gradedBy.name,
    updatedAt: serverTimestamp(),
  }), { merge: true });

  await updateDoc(doc(db, 'submissions', params.submission.id), clean({
    status: 'graded',
    finalScore: Number(params.finalScore) || 0,
    gradedAt: serverTimestamp(),
    gradedBy: params.gradedBy.id,
    gradedByName: params.gradedBy.name,
  }));

  await setDoc(doc(db, 'assignmentTargets', assignmentTargetId(params.submission.assignmentId, params.submission.studentId)), clean({
    status: 'graded',
    finalScore: Number(params.finalScore) || 0,
    maxScore: params.submission.maxScore,
    gradedAt: serverTimestamp(),
  }), { merge: true });
}

export async function getAssignmentWithExam(assignmentId: string) {
  const assignment = await getAssignment(assignmentId);
  if (!assignment) throw new Error('Không tìm thấy bài được giao.');
  const exam = await getAssignmentExam(assignment.examId);
  if (!exam) throw new Error('Không tìm thấy đề.');
  const classInfo = await getClassById(assignment.classId);
  return { assignment, exam, classInfo };
}
