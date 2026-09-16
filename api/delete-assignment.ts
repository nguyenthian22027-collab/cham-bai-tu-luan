import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue, type DocumentReference } from 'firebase-admin/firestore';
import { requireStaff } from './_auth.js';
import { adminDb } from './_firebaseAdmin.js';
import { callEssayAppsScript } from './_essayAppsScript.js';

export const config = { maxDuration: 60 };

const DRIVE_DELETE_BATCH = 40;

type DeleteImagesResponse = {
  cleanup?: {
    deleted?: string[];
    failed?: Array<{ fileId?: string; error?: string }>;
  };
};

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function collectEssayFileIds(answers: unknown): string[] {
  const ids = new Set<string>();
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return [];
  Object.values(answers as Record<string, unknown>).forEach((raw) => {
    if (typeof raw !== 'string' || !raw.trim().startsWith('{')) return;
    try {
      const parsed = JSON.parse(raw) as { images?: Array<{ fileId?: unknown }> };
      (Array.isArray(parsed.images) ? parsed.images : []).forEach((image) => {
        const fileId = String(image?.fileId || '').trim();
        if (/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) ids.add(fileId);
      });
    } catch {
      // Câu tự luận cũ có thể chỉ là text thuần.
    }
  });
  return [...ids];
}

function statusOf(error: unknown) {
  const message = error instanceof Error ? error.message : 'Không xóa được bài đã giao.';
  if (message === 'UNAUTHORIZED') return { status: 401, message: 'Chưa đăng nhập.' };
  if (message === 'FORBIDDEN') return { status: 403, message: 'Tài khoản không có quyền xóa bài.' };
  return { status: Number((error as { statusCode?: number })?.statusCode) || 500, message };
}

async function cleanupDriveImages(fileIds: string[]) {
  const deleted = new Set<string>();
  const failed = new Map<string, string>();
  if (!fileIds.length) return { deleted, failed };

  // Chia đúng giới hạn mà Apps Script chấp nhận. Các nhóm chạy song song để
  // không kéo dài thời gian của Vercel function khi một lớp có nhiều ảnh.
  const results = await Promise.allSettled(
    chunks(fileIds, DRIVE_DELETE_BATCH).map(async (fileIdsChunk) => {
      return callEssayAppsScript<DeleteImagesResponse>('deleteImages', { fileIds: fileIdsChunk });
    }),
  );

  results.forEach((result, index) => {
    const ids = chunks(fileIds, DRIVE_DELETE_BATCH)[index] || [];
    if (result.status === 'rejected') {
      ids.forEach((fileId) => failed.set(fileId, result.reason instanceof Error ? result.reason.message : String(result.reason)));
      return;
    }
    const cleanup = result.value.cleanup || {};
    (cleanup.deleted || []).map(String).forEach((fileId) => deleted.add(fileId));
    (cleanup.failed || []).forEach((item) => {
      const fileId = String(item.fileId || '');
      if (fileId) failed.set(fileId, String(item.error || 'Không xóa được file Drive.'));
    });
    ids.forEach((fileId) => {
      if (!deleted.has(fileId) && !failed.has(fileId)) failed.set(fileId, 'Apps Script không xác nhận đã xóa file.');
    });
  });

  return { deleted, failed };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  try {
    const staff = await requireStaff(req);
    if (!['ADMIN', 'TEACHER'].includes(staff.role)) throw new Error('FORBIDDEN');

    const assignmentId = String(req.body?.assignmentId || '').trim();
    if (!assignmentId || assignmentId.length > 220) {
      return res.status(400).json({ error: 'assignmentId không hợp lệ.' });
    }

    const assignmentRef = adminDb.doc(`assignments/${assignmentId}`);
    const assignmentSnap = await assignmentRef.get();
    if (!assignmentSnap.exists) return res.status(404).json({ error: 'Bài đã giao không còn tồn tại.' });
    const assignment = assignmentSnap.data() || {};
    const examId = String(assignment.examId || '').trim();

    const [targetsSnap, submissionsSnap, resultsSnap, gradesSnap, publicationsSnap, publicResultsSnap, imagesSnap, examUsersSnap] = await Promise.all([
      adminDb.collection('assignmentTargets').where('assignmentId', '==', assignmentId).get(),
      adminDb.collection('submissions').where('assignmentId', '==', assignmentId).get(),
      adminDb.collection('submissionResults').where('assignmentId', '==', assignmentId).get(),
      adminDb.collection('submissionGrades').where('assignmentId', '==', assignmentId).get(),
      adminDb.collection('essayResultPublications').where('assignmentId', '==', assignmentId).get(),
      adminDb.collection('publicEssayResults').where('assignmentId', '==', assignmentId).get(),
      adminDb.collection('essayImages').where('assignmentId', '==', assignmentId).get(),
      examId ? adminDb.collection('assignments').where('examId', '==', examId).get() : Promise.resolve(null),
    ]);

    // Lấy cả metadata mới lẫn fileId nằm trong answers của các submission cũ.
    // Apps Script còn kiểm tra file phải thuộc đúng thư mục hệ thống nên vẫn an toàn.
    const fileIdSet = new Set<string>();
    imagesSnap.docs
      .map((doc) => String(doc.data().fileId || doc.id || '').trim())
      .filter((fileId) => /^[A-Za-z0-9_-]{10,200}$/.test(fileId))
      .forEach((fileId) => fileIdSet.add(fileId));
    submissionsSnap.docs.forEach((doc) => {
      collectEssayFileIds(doc.data().answers).forEach((fileId) => fileIdSet.add(fileId));
    });
    const fileIds = [...fileIdSet];
    if (fileIds.length > 0) {
      try {
        // Kiểm tra capability trước, không xóa file nào. Nhờ vậy nếu người dùng
        // vẫn đang chạy Code.gs v1.0 cũ thì hệ thống dừng trước khi xóa Firestore.
        await callEssayAppsScript<DeleteImagesResponse>('deleteImages', { fileIds: [] });
      } catch {
        throw Object.assign(
          new Error('Code.gs trên Apps Script chưa hỗ trợ deleteImages. Hãy copy Code.gs v1.2.2 và deploy lại trước khi xóa bài có ảnh.'),
          { statusCode: 409 },
        );
      }
    }
    const driveCleanup = await cleanupDriveImages(fileIds);

    const writer = adminDb.bulkWriter();
    const deletedRefs = new Set<string>();
    const queueDelete = (ref: DocumentReference) => {
      if (deletedRefs.has(ref.path)) return;
      deletedRefs.add(ref.path);
      writer.delete(ref);
    };

    targetsSnap.docs.forEach((doc) => queueDelete(doc.ref));
    submissionsSnap.docs.forEach((doc) => {
      queueDelete(doc.ref);
      // Các bản cũ luôn dùng submissionId làm document id của submissionResults/publication.
      queueDelete(adminDb.doc(`submissionResults/${doc.id}`));
      queueDelete(adminDb.doc(`essayResultPublications/${doc.id}`));
    });
    resultsSnap.docs.forEach((doc) => queueDelete(doc.ref));
    gradesSnap.docs.forEach((doc) => queueDelete(doc.ref));
    publicationsSnap.docs.forEach((doc) => {
      const token = String(doc.data().token || '').trim();
      if (token) queueDelete(adminDb.doc(`publicEssayResults/${token}`));
      queueDelete(doc.ref);
    });
    publicResultsSnap.docs.forEach((doc) => queueDelete(doc.ref));

    // Metadata ảnh chỉ xóa khi Drive đã xóa thành công. Nếu Apps Script chưa
    // được cập nhật hoặc Drive lỗi, giữ metadata dạng orphan để còn truy vết/dọn sau.
    imagesSnap.docs.forEach((doc) => {
      const fileId = String(doc.data().fileId || doc.id || '').trim();
      if (driveCleanup.deleted.has(fileId)) {
        queueDelete(doc.ref);
      } else {
        writer.set(doc.ref, {
          active: false,
          orphanedAt: FieldValue.serverTimestamp(),
          orphanReason: 'assignment_deleted',
          driveDeleteError: driveCleanup.failed.get(fileId) || 'Không xác nhận được trạng thái file Drive.',
        }, { merge: true });
      }
    });

    queueDelete(assignmentRef);

    // Một đề có thể được giao cho nhiều lớp. Chỉ xóa assignmentExam khi đây là
    // bài giao cuối cùng còn tham chiếu tới đề đó; nhờ vậy xóa 1 lớp không làm
    // hỏng các lớp khác trong cùng đợt giao.
    let deletedExam = false;
    if (examId && examUsersSnap) {
      const otherAssignments = examUsersSnap.docs.filter((doc) => doc.id !== assignmentId);
      if (otherAssignments.length === 0) {
        const chunkSnap = await adminDb.collection(`assignmentExams/${examId}/payloadChunks`).get();
        chunkSnap.docs.forEach((doc) => queueDelete(doc.ref));
        queueDelete(adminDb.doc(`assignmentExams/${examId}`));
        deletedExam = true;
      }
    }

    await writer.close();

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      success: true,
      assignmentId,
      deletedExam,
      counts: {
        targets: targetsSnap.size,
        submissions: submissionsSnap.size,
        grades: gradesSnap.size,
        publishedResults: publicResultsSnap.size,
        images: fileIds.length,
        driveImagesDeleted: driveCleanup.deleted.size,
        driveImagesPending: driveCleanup.failed.size,
      },
      warning: driveCleanup.failed.size > 0
        ? `Đã xóa bài và dữ liệu chấm, nhưng còn ${driveCleanup.failed.size} ảnh Drive chưa dọn được. Hãy deploy Code.gs mới rồi dọn lại khi cần.`
        : '',
    });
  } catch (error) {
    console.error('[delete-assignment]', error);
    const result = statusOf(error);
    return res.status(result.status).json({ error: result.message });
  }
}
