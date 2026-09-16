import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from './_firebaseAdmin.js';
import { requireStaff } from './_auth.js';

export const config = { maxDuration: 60 };


function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { return (JSON.parse(value) ?? fallback) as T; } catch { return fallback; }
}

type StoredExamQuestion = Record<string, unknown> & {
  number: number;
  points: number;
};

async function readExam(examId: string): Promise<StoredExamQuestion[]> {
  const snap = await adminDb.doc(`assignmentExams/${examId}`).get();
  if (!snap.exists) throw Object.assign(new Error('Không tìm thấy đề bài.'), { statusCode: 404 });
  const data = snap.data() || {};
  let payload: Record<string, unknown> | null = null;

  if (data.payloadStorage === 'CHUNKS' || Number(data.payloadChunkCount) > 0) {
    const chunks = await adminDb.collection(`assignmentExams/${examId}/payloadChunks`).orderBy('index').get();
    payload = parseJson<Record<string, unknown> | null>(chunks.docs.map((doc) => String(doc.data().text || '')).join(''), null);
  }

  const questions = Array.isArray(payload?.questions)
    ? payload?.questions as Array<Record<string, unknown>>
    : parseJson<Array<Record<string, unknown>>>(data.questionsJson, []);
  return questions.map((question, index): StoredExamQuestion => ({
    ...question,
    number: Number(question.number) || index + 1,
    points: Number(question.points) || 1,
  }));
}

function parseEssayAnswer(raw: unknown) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    const images = Array.isArray(parsed?.images)
      ? parsed.images.map((image: Record<string, unknown>) => ({
          fileId: String(image.fileId || ''),
          url: String(image.url || ''),
          thumbnailUrl: image.thumbnailUrl ? String(image.thumbnailUrl) : undefined,
          mimeType: String(image.mimeType || 'image/jpeg'),
          fileName: String(image.fileName || 'bai-lam.jpg'),
          size: Number(image.size) || undefined,
        })).filter((image: { fileId: string; url: string }) => image.fileId && image.url)
      : [];
    return { text: String(parsed?.text || ''), images };
  } catch {
    return { text: String(raw || ''), images: [] };
  }
}

function appOrigin(req: VercelRequest) {
  const configured = String(process.env.PUBLIC_APP_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0];
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '').split(',')[0];
  return host ? `${proto}://${host}` : '';
}

function publicMeta(token: string, data: Record<string, unknown>, req: VercelRequest) {
  const origin = appOrigin(req);
  return {
    token,
    url: `${origin}/result/${encodeURIComponent(token)}`,
    active: data.active === true,
    parentName: data.parentName ? String(data.parentName) : undefined,
    parentPhone: data.parentPhone ? String(data.parentPhone) : undefined,
    publishedAt: (() => {
      const value = data.publishedAt as { toDate?: () => Date } | string | undefined;
      if (!value) return undefined;
      const date = typeof value === 'string' ? new Date(value) : value.toDate?.();
      return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
    })(),
  };
}

function statusOf(error: unknown) {
  const message = error instanceof Error ? error.message : 'Không công bố được kết quả.';
  if (message === 'UNAUTHORIZED') return { status: 401, message: 'Chưa đăng nhập.' };
  if (message === 'FORBIDDEN') return { status: 403, message: 'Tài khoản không có quyền.' };
  return { status: Number((error as { statusCode?: number })?.statusCode) || 500, message };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const staff = await requireStaff(req);
    const submissionId = String(req.method === 'GET' ? req.query.submissionId : req.body?.submissionId || '').trim();
    if (!submissionId || submissionId.length > 300) return res.status(400).json({ error: 'Thiếu submissionId.' });

    const publicationRef = adminDb.doc(`essayResultPublications/${submissionId}`);

    if (req.method === 'GET') {
      const snap = await publicationRef.get();
      res.setHeader('Cache-Control', 'no-store');
      if (!snap.exists) return res.status(200).json({ publication: null });
      const data = snap.data() || {};
      return res.status(200).json({ publication: publicMeta(String(data.token || ''), data, req) });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Chỉ hỗ trợ GET hoặc POST.' });
    }

    const action = String(req.body?.action || 'publish');
    const oldPublication = await publicationRef.get();
    const oldData = oldPublication.data() || {};

    if (action === 'revoke') {
      const token = String(oldData.token || '');
      if (token) {
        const batch = adminDb.batch();
        batch.set(publicationRef, { active: false, revokedAt: FieldValue.serverTimestamp(), revokedBy: staff.uid }, { merge: true });
        batch.set(adminDb.doc(`publicEssayResults/${token}`), { active: false, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
        await batch.commit();
      }
      return res.status(200).json({ publication: token ? publicMeta(token, { ...oldData, active: false }, req) : null });
    }

    if (action !== 'publish') return res.status(400).json({ error: 'Action không hợp lệ.' });

    const submissionSnap = await adminDb.doc(`submissions/${submissionId}`).get();
    if (!submissionSnap.exists) throw Object.assign(new Error('Không tìm thấy bài làm.'), { statusCode: 404 });
    const submission = submissionSnap.data() || {};
    if (submission.status !== 'graded') {
      throw Object.assign(new Error('Hãy lưu điểm cuối trước khi công bố cho phụ huynh.'), { statusCode: 409 });
    }

    const assignmentId = String(submission.assignmentId || '');
    const assignmentSnap = await adminDb.doc(`assignments/${assignmentId}`).get();
    if (!assignmentSnap.exists) throw Object.assign(new Error('Không tìm thấy bài được giao.'), { statusCode: 404 });
    const assignment = assignmentSnap.data() || {};
    const questions = await readExam(String(submission.examId || assignment.examId || ''));

    const gradeSnap = await adminDb.collection('submissionGrades').where('submissionId', '==', submissionId).get();
    const grades = gradeSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const gradeByQuestion = new Map<number, Record<string, unknown>>();
    let finalGrade: Record<string, unknown> | undefined;
    grades.forEach((grade) => {
      if (grade.questionNumber === 'FINAL') finalGrade = grade;
      else if (Number.isFinite(Number(grade.questionNumber))) gradeByQuestion.set(Number(grade.questionNumber), grade);
    });

    const writingQuestions = questions.filter((question) => question.type === 'writing');
    const unconfirmedQuestions = writingQuestions.filter((question) => {
      const grade = gradeByQuestion.get(Number(question.number));
      return !grade || grade.status !== 'GRADED';
    });
    if (unconfirmedQuestions.length > 0 || finalGrade?.status !== 'GRADED') {
      throw Object.assign(new Error('Kết quả còn câu chưa được giáo viên xác nhận.'), { statusCode: 409 });
    }

    const resultQuestions = jsonSafe(writingQuestions
      .map((question) => {
        const grade = gradeByQuestion.get(Number(question.number)) || {};
        const answer = parseEssayAnswer((submission.answers || {})[String(question.number)]);
        return {
          number: Number(question.number),
          text: String(question.text || ''),
          points: Number(question.points) || 1,
          solution: question.solution ? String(question.solution) : '',
          answerText: answer.text,
          images: answer.images,
          score: Number(grade.score) || 0,
          maxScore: Number(grade.maxScore) || Number(question.points) || 1,
          feedback: String(grade.feedback || grade.aiFeedback || ''),
          aiDetails: grade.aiDetails && typeof grade.aiDetails === 'object' ? grade.aiDetails : null,
        };
      }));

    if (!resultQuestions.length) throw Object.assign(new Error('Bài này không có câu tự luận để công bố.'), { statusCode: 409 });

    const studentId = String(submission.studentId || '');
    const studentSnap = studentId ? await adminDb.doc(`students/${studentId}`).get() : null;
    const student = studentSnap?.data() || {};
    const token = String(oldData.token || randomBytes(24).toString('base64url'));
    const publishedAt = FieldValue.serverTimestamp();
    const parentName = String(student.parentName || 'Phụ huynh');
    const parentPhone = String(student.parentPhone || '');
    const finalScore = Number(submission.finalScore ?? finalGrade?.score ?? 0) || 0;
    const maxScore = Number(submission.maxScore) || resultQuestions.reduce((sum, question) => sum + question.maxScore, 0);

    const publicPayload = {
      token,
      active: true,
      submissionId,
      assignmentId,
      title: String(assignment.title || 'Kết quả chấm bài tự luận'),
      className: String(assignment.className || ''),
      studentName: String(submission.studentName || student.fullName || 'Học sinh'),
      teacherName: String(submission.gradedByName || finalGrade?.gradedByName || staff.name || ''),
      finalScore,
      maxScore,
      finalFeedback: String(finalGrade?.feedback || ''),
      questions: resultQuestions,
      publishedAt,
      updatedAt: publishedAt,
      viewCount: Number((oldData.viewCount as number) || 0),
    };

    const batch = adminDb.batch();
    batch.set(adminDb.doc(`publicEssayResults/${token}`), publicPayload, { merge: true });
    batch.set(publicationRef, {
      token,
      active: true,
      submissionId,
      assignmentId,
      studentId,
      parentName,
      parentPhone,
      publishedAt,
      publishedBy: staff.uid,
      publishedByName: staff.name,
    }, { merge: true });
    await batch.commit();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ publication: publicMeta(token, { active: true, parentName, parentPhone, publishedAt: new Date().toISOString() }, req) });
  } catch (error) {
    console.error('[publish-result]', error);
    const result = statusOf(error);
    return res.status(result.status).json({ error: result.message });
  }
}
