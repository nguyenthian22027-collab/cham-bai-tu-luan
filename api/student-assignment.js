import { adminDb, requireStudent, sendError } from '../server/firebaseAdmin.js';
import {
  plainAssignment,
  plainExam,
  plainGrade,
  plainSubmission,
  readAssignmentExam,
  stripAnswerKey,
  toMillis,
} from '../server/examStore.js';
import { calculateAutoScore } from '../server/scoring.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Chỉ hỗ trợ GET.' });
  }

  try {
    const { studentId } = await requireStudent(req);
    const assignmentId = String(req.query?.assignmentId || '').trim();
    if (!assignmentId) throw Object.assign(new Error('Thiếu assignmentId.'), { statusCode: 400 });

    const targetId = `${assignmentId}__${studentId}`;
    const [assignmentSnap, targetSnap] = await Promise.all([
      adminDb.doc(`assignments/${assignmentId}`).get(),
      adminDb.doc(`assignmentTargets/${targetId}`).get(),
    ]);

    if (!assignmentSnap.exists) throw Object.assign(new Error('Không tìm thấy bài được giao.'), { statusCode: 404 });
    if (!targetSnap.exists || String(targetSnap.data()?.studentId || '') !== studentId) {
      throw Object.assign(new Error('Bài này không được giao cho tài khoản của bạn.'), { statusCode: 403 });
    }

    const assignmentData = assignmentSnap.data() || {};
    // 🆕 Bảo đảm maxAttempts luôn có mặt (1–3), kể cả khi plainAssignment lọc field.
    const maxAttempts = Math.min(3, Math.max(1, Number(assignmentData.maxAttempts) || 1));
    const assignment = { ...plainAssignment(assignmentSnap.id, assignmentData), maxAttempts };
    const submissionId = targetId;
    const submissionSnap = await adminDb.doc(`submissions/${submissionId}`).get();
    const submissionData = submissionSnap.exists ? submissionSnap.data() || {} : null;
    const hasSubmitted = Boolean(submissionData && submissionData.status !== 'in_progress');

    // 🆕 Số lần đã nộp và số lần còn được làm lại.
    const attemptCount = Number(submissionData?.attemptCount) || 0;
    const rawAttemptsRemaining = Math.max(0, maxAttempts - attemptCount);
    const closesAt = toMillis(assignmentData.closesAt);
    const retryWindowOpen = Boolean(
      hasSubmitted
      && submissionData?.status !== 'graded'
      && assignment.status === 'published'
      && assignment.allowResubmit !== false
      && rawAttemptsRemaining > 0
      && (!closesAt || Date.now() <= closesAt + 60_000)
    );
    // Không bao giờ đưa đáp án/lời giải về client nếu học sinh vẫn còn quyền làm lại.
    // Khi đã hết lượt, hết hạn, bài đóng hoặc đã chấm thì mới cho review đầy đủ.
    const attemptsRemaining = retryWindowOpen ? rawAttemptsRemaining : 0;
    const canReview = hasSubmitted && assignment.resultVisibility === 'full_review' && !retryWindowOpen;

    const originalExam = await readAssignmentExam(String(assignmentData.examId || ''));

    // Bài tự luận cũ có thể chưa lưu pendingCount. Tính lại trên server để
    // giao diện học sinh không hiểu nhầm autoScore = 0 là điểm cuối 0/10.
    let effectivePendingCount = 0;
    if (hasSubmitted && submissionData) {
      const storedPending = Number(submissionData.pendingCount);
      effectivePendingCount = Number.isFinite(storedPending)
        ? Math.max(0, storedPending)
        : calculateAutoScore(
            originalExam.questions,
            submissionData.answers || {},
            originalExam.pointsConfig
          ).pendingCount;
    }

    const exam = canReview
      ? originalExam
      : hasSubmitted
      ? { ...stripAnswerKey(originalExam), questions: [], sections: [], images: [] }
      : stripAnswerKey(originalExam);

    let questionResults;
    let grades = [];
    if (submissionSnap.exists && canReview) {
      const resultSnap = await adminDb.doc(`submissionResults/${submissionId}`).get();
      questionResults = resultSnap.exists ? resultSnap.data()?.questionResults || undefined : undefined;
      // Tương thích bài đã nộp bằng phiên bản cũ: tính lại trên server nếu chưa có submissionResults.
      if (!questionResults) {
        questionResults = calculateAutoScore(
          originalExam.questions,
          submissionData.answers || {},
          originalExam.pointsConfig
        ).questionResults;
      }
      const gradeSnap = await adminDb.collection('submissionGrades').where('submissionId', '==', submissionId).get();
      grades = gradeSnap.docs.map((d) => plainGrade(d.id, d.data()));
    } else if (submissionSnap.exists) {
      // Tổng nhận xét cuối vẫn được phép hiển thị, nhưng không trả điểm từng câu.
      const finalSnap = await adminDb.doc(`submissionGrades/${submissionId}__FINAL`).get();
      if (finalSnap.exists) grades = [plainGrade(finalSnap.id, finalSnap.data())];
    }

    const submission = submissionSnap.exists
      ? plainSubmission(submissionSnap.id, {
          ...submissionData,
          pendingCount: effectivePendingCount,
        }, {
          includeAnswers: submissionData.status === 'in_progress' || canReview,
          includeDetails: canReview,
          questionResults: canReview ? questionResults : undefined,
        })
      : null;

    return res.status(200).json({
      assignment,
      exam: plainExam(exam),
      submission,
      grades,
      canReview,
      attemptCount,
      attemptsRemaining,
    });
  } catch (error) {
    return sendError(res, error);
  }
}
