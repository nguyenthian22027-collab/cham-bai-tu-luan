import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, requireStudent, sendError } from '../server/firebaseAdmin.js';
import { plainSubmission, readAssignmentExam, toMillis } from '../server/examStore.js';
import { calculateAutoScore } from '../server/scoring.js';

function cleanAnswers(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^\d+$/.test(String(key))) continue;
    if (typeof raw !== 'string') continue;
    out[String(key)] = raw;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  try {
    const { studentId } = await requireStudent(req);
    const submissionId = String(req.body?.submissionId || '').trim();
    if (!submissionId || !submissionId.endsWith(`__${studentId}`)) {
      throw Object.assign(new Error('Bài làm không thuộc tài khoản của bạn.'), { statusCode: 403 });
    }

    const submissionRef = adminDb.doc(`submissions/${submissionId}`);
    const submissionSnap = await submissionRef.get();
    if (!submissionSnap.exists) throw Object.assign(new Error('Không tìm thấy bài làm.'), { statusCode: 404 });
    const old = submissionSnap.data() || {};
    if (String(old.studentId || '') !== studentId) {
      throw Object.assign(new Error('Bạn không có quyền nộp bài này.'), { statusCode: 403 });
    }
    if (old.status !== 'in_progress') {
      throw Object.assign(new Error('Bài đã được nộp trước đó.'), { statusCode: 409 });
    }

    const assignmentId = String(old.assignmentId || '');
    const assignmentSnap = await adminDb.doc(`assignments/${assignmentId}`).get();
    if (!assignmentSnap.exists) throw Object.assign(new Error('Không tìm thấy bài được giao.'), { statusCode: 404 });
    const assignment = assignmentSnap.data() || {};
    const now = Date.now();
    const closesAt = toMillis(assignment.closesAt);
    if (assignment.status !== 'published') {
      throw Object.assign(new Error('Bài đã đóng, không thể nộp thêm.'), { statusCode: 409 });
    }
    if (closesAt && now > closesAt + 60_000) {
      throw Object.assign(new Error('Bài đã hết hạn nộp.'), { statusCode: 409 });
    }

    const exam = await readAssignmentExam(String(old.examId || assignment.examId || ''));
    const answers = cleanAnswers(req.body?.answers);
    const score = calculateAutoScore(exam.questions, answers, exam.pointsConfig);
    const serverTime = FieldValue.serverTimestamp();

    // 🆕 Đếm số lần đã nộp. Lần nộp đầu tiên -> 1, mỗi lần "làm lại" rồi nộp +1.
    const attemptCount = (Number(old.attemptCount) || 0) + 1;

    const batch = adminDb.batch();
    batch.update(submissionRef, {
      answers,
      status: 'submitted',
      autoScore: score.autoScore,
      maxScore: score.maxScore,
      correctCount: score.correctCount,
      wrongCount: score.wrongCount,
      totalQuestions: exam.questions.length,
      pendingCount: score.pendingCount,
      submittedAt: serverTime,
      updatedAt: serverTime,
      attemptCount,
      tabSwitchCount: Number(req.body?.tabSwitchCount) || 0,
      autoSubmitted: Boolean(req.body?.autoSubmitted),
      // Dọn dữ liệu chi tiết cũ nếu submission từng được tạo bằng phiên bản trước.
      questionResultsJson: FieldValue.delete(),
      questionResults: FieldValue.delete(),
    });

    batch.set(adminDb.doc(`submissionResults/${submissionId}`), {
      submissionId,
      assignmentId,
      studentId,
      questionResults: score.questionResults,
      pendingCount: score.pendingCount,
      updatedAt: serverTime,
    }, { merge: true });

    batch.set(adminDb.doc(`assignmentTargets/${assignmentId}__${studentId}`), {
      status: 'submitted',
      submittedAt: serverTime,
      autoScore: score.autoScore,
      maxScore: score.maxScore,
    }, { merge: true });

    await batch.commit();
    const latest = await submissionRef.get();
    return res.status(200).json({
      submission: plainSubmission(latest.id, latest.data() || {}, { includeAnswers: false }),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
