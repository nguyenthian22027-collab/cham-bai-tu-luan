import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, requireStudent, sendError } from '../server/firebaseAdmin.js';
import { plainSubmission, toMillis } from '../server/examStore.js';

export const config = { maxDuration: 30 };

function collectEssayFileIds(answers) {
  const ids = new Set();
  Object.values(answers || {}).forEach((raw) => {
    if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return;
    try {
      const parsed = JSON.parse(raw);
      (Array.isArray(parsed?.images) ? parsed.images : []).forEach((image) => {
        const fileId = String(image?.fileId || '').trim();
        if (/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) ids.add(fileId);
      });
    } catch {
      // Câu cũ dạng text thuần: bỏ qua.
    }
  });
  return [...ids];
}

async function cleanupDriveImages(fileIds) {
  if (!fileIds.length) return new Set();
  const url = String(process.env.ESSAY_APPS_SCRIPT_URL || '').trim();
  const secret = String(process.env.ESSAY_APPS_SCRIPT_SECRET || '').trim();
  if (!url || !secret) return new Set();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'deleteImages', secret, fileIds }),
      signal: controller.signal,
      redirect: 'follow',
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.success !== true) return new Set();
    return new Set(Array.isArray(data.cleanup?.deleted) ? data.cleanup.deleted.map(String) : []);
  } catch (error) {
    console.warn('[retry-assignment] Không dọn được ảnh Drive lượt cũ:', error?.message || error);
    return new Set();
  } finally {
    clearTimeout(timer);
  }
}

// 🆕 Mở lại MỘT lượt làm mới cho học sinh sau khi đã nộp, nếu vẫn còn lượt.
// Đây là chỗ duy nhất được phép đưa bài đã nộp về trạng thái in_progress —
// phía học sinh không được tự làm việc này. Mỗi lần mở lại là làm lại từ đầu
// (xoá đáp án cũ, đồng hồ chạy lại) nên với bài Kiểm tra có giới hạn giờ thì
// mỗi lượt được tính giờ mới.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  try {
    const { studentId } = await requireStudent(req);
    const assignmentId = String(req.body?.assignmentId || '').trim();
    if (!assignmentId) throw Object.assign(new Error('Thiếu assignmentId.'), { statusCode: 400 });

    const submissionId = `${assignmentId}__${studentId}`;
    const submissionRef = adminDb.doc(`submissions/${submissionId}`);
    const submissionSnap = await submissionRef.get();
    if (!submissionSnap.exists) {
      throw Object.assign(new Error('Chưa có bài làm nào để làm lại.'), { statusCode: 404 });
    }
    const old = submissionSnap.data() || {};
    if (String(old.studentId || '') !== studentId) {
      throw Object.assign(new Error('Bài làm không thuộc tài khoản của bạn.'), { statusCode: 403 });
    }

    // Đang làm dở thì không cần mở lại — cứ tiếp tục lượt hiện tại.
    if (old.status === 'in_progress') {
      return res.status(200).json({
        submission: plainSubmission(submissionSnap.id, old, { includeAnswers: true }),
      });
    }
    // Bài đã được giáo viên chấm/khoá điểm thì không cho làm lại.
    if (old.status === 'graded') {
      throw Object.assign(new Error('Bài đã được chấm, không thể làm lại.'), { statusCode: 409 });
    }

    const assignmentSnap = await adminDb.doc(`assignments/${assignmentId}`).get();
    if (!assignmentSnap.exists) {
      throw Object.assign(new Error('Không tìm thấy bài được giao.'), { statusCode: 404 });
    }
    const assignment = assignmentSnap.data() || {};
    if (assignment.status !== 'published') {
      throw Object.assign(new Error('Bài đã đóng, không thể làm lại.'), { statusCode: 409 });
    }
    if (assignment.allowResubmit === false) {
      throw Object.assign(new Error('Giáo viên không cho phép làm lại bài này.'), { statusCode: 409 });
    }
    const now = Date.now();
    const closesAt = toMillis(assignment.closesAt);
    if (closesAt && now > closesAt + 60_000) {
      throw Object.assign(new Error('Bài đã hết hạn, không thể làm lại.'), { statusCode: 409 });
    }

    const maxAttempts = Math.min(3, Math.max(1, Number(assignment.maxAttempts) || 1));
    const attemptCount = Number(old.attemptCount) || 0;
    if (attemptCount >= maxAttempts) {
      throw Object.assign(
        new Error(`Bạn đã dùng hết ${maxAttempts} lần làm cho bài này.`),
        { statusCode: 409 }
      );
    }

    // Lấy toàn bộ điểm/nhận xét của lượt cũ trước khi mở lượt mới. Nếu không
    // xóa, câu tự luận ở lượt mới có thể bị hiểu nhầm là đã được chấm từ lượt trước.
    const previousGrades = await adminDb.collection('submissionGrades').where('submissionId', '==', submissionId).get();
    const oldImageIds = collectEssayFileIds(old.answers || {});
    const deletedDriveIds = await cleanupDriveImages(oldImageIds);

    const serverTime = FieldValue.serverTimestamp();
    const batch = adminDb.batch();

    // Đưa bài về trạng thái làm mới. Giữ nguyên attemptCount (chỉ tăng khi NỘP).
    batch.update(submissionRef, {
      status: 'in_progress',
      answers: {},
      autoScore: 0,
      correctCount: 0,
      wrongCount: 0,
      pendingCount: 0,
      autoSubmitted: false,
      startedAt: serverTime,   // đồng hồ chạy lại cho bài Kiểm tra
      submittedAt: FieldValue.delete(),
      updatedAt: serverTime,
      questionResultsJson: FieldValue.delete(),
      questionResults: FieldValue.delete(),
      finalScore: FieldValue.delete(),
      gradedAt: FieldValue.delete(),
      gradedBy: FieldValue.delete(),
      gradedByName: FieldValue.delete(),
    });

    // Xoá bảng kết quả chi tiết + mọi điểm/nhận xét câu của lượt trước.
    batch.delete(adminDb.doc(`submissionResults/${submissionId}`));
    previousGrades.docs.forEach((gradeDoc) => batch.delete(gradeDoc.ref));
    oldImageIds.forEach((fileId) => {
      batch.set(adminDb.doc(`essayImages/${fileId}`), {
        active: false,
        orphanedAt: serverTime,
        orphanReason: 'retry',
        driveDeleted: deletedDriveIds.has(fileId),
      }, { merge: true });
    });

    // Đưa dòng theo dõi của học sinh về "đang làm".
    batch.set(adminDb.doc(`assignmentTargets/${assignmentId}__${studentId}`), {
      status: 'in_progress',
      startedAt: serverTime,
      submittedAt: FieldValue.delete(),
      autoScore: FieldValue.delete(),
      finalScore: FieldValue.delete(),
      gradedAt: FieldValue.delete(),
    }, { merge: true });

    await batch.commit();

    const latest = await submissionRef.get();
    return res.status(200).json({
      submission: plainSubmission(latest.id, latest.data() || {}, { includeAnswers: true }),
    });
  } catch (error) {
    return sendError(res, error);
  }
}
