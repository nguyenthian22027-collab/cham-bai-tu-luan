import type { VercelRequest, VercelResponse } from '@vercel/node';
import { FieldValue } from 'firebase-admin/firestore';
import { requireApprovedUser } from './_auth.js';
import { adminDb } from './_firebaseAdmin.js';
import { callEssayAppsScript } from './_essayAppsScript.js';

export const config = { maxDuration: 60 };

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_BASE64_CHARS = 3_300_000;

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : 'Không xử lý được ảnh.';
  if (message === 'UNAUTHORIZED') return { status: 401, message: 'Chưa đăng nhập.' };
  if (message === 'FORBIDDEN') return { status: 403, message: 'Tài khoản không có quyền xử lý ảnh.' };
  return { status: Number((error as { statusCode?: number })?.statusCode) || 500, message };
}

function validContext(body: Record<string, unknown>) {
  const assignmentId = String(body.assignmentId || '').trim();
  const studentId = String(body.studentId || '').trim();
  const questionNumber = Number(body.questionNumber);
  if (!assignmentId || assignmentId.length > 200 || !studentId || studentId.length > 200 || !Number.isInteger(questionNumber) || questionNumber < 1) {
    throw Object.assign(new Error('Thiếu thông tin bài tự luận cần xử lý ảnh.'), { statusCode: 400 });
  }
  return { assignmentId, studentId, questionNumber };
}

async function assertTargetAccess(actor: Awaited<ReturnType<typeof requireApprovedUser>>, assignmentId: string, studentId: string) {
  const target = await adminDb.doc(`assignmentTargets/${assignmentId}__${studentId}`).get();
  if (!target.exists || String(target.data()?.studentId || '') !== studentId) {
    throw Object.assign(new Error('Không tìm thấy lượt làm tương ứng.'), { statusCode: 403 });
  }
  if (actor.role === 'STUDENT') {
    if (!actor.studentId || actor.studentId !== studentId) {
      throw Object.assign(new Error('Không thể xử lý ảnh cho học sinh khác.'), { statusCode: 403 });
    }
    if (!['assigned', 'in_progress'].includes(String(target.data()?.status || ''))) {
      throw Object.assign(new Error('Bài này không còn ở trạng thái nhận bài.'), { statusCode: 403 });
    }
  }
}

async function uploadImage(req: VercelRequest, res: VercelResponse, actor: Awaited<ReturnType<typeof requireApprovedUser>>) {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const { assignmentId, studentId, questionNumber } = validContext(body);
  await assertTargetAccess(actor, assignmentId, studentId);

  const base64 = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '');
  const mimeType = String(body.mimeType || '').toLowerCase();
  const rawName = String(body.fileName || 'bai-lam.jpg');
  const fileName = rawName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'bai-lam.jpg';

  if (!ALLOWED_TYPES.has(mimeType)) return res.status(400).json({ error: 'Chỉ nhận ảnh JPG, PNG hoặc WebP.' });
  if (!base64 || base64.length > MAX_BASE64_CHARS) return res.status(413).json({ error: 'Ảnh quá lớn sau khi nén.' });

  const data = await callEssayAppsScript<{
    image: {
      fileId: string;
      url: string;
      thumbnailUrl?: string;
      mimeType: string;
      fileName: string;
      size?: number;
    };
  }>('uploadImage', {
    base64,
    mimeType,
    fileName: `${actor.role}_${actor.uid}_${assignmentId}_Q${questionNumber}_${Date.now()}_${fileName}`,
    assignmentId,
    studentId,
    questionNumber,
  });

  const image = data.image;
  if (!image?.fileId || !/^[A-Za-z0-9_-]{10,200}$/.test(image.fileId)) {
    throw Object.assign(new Error('Apps Script trả fileId ảnh không hợp lệ.'), { statusCode: 502 });
  }

  // Metadata server-side là nguồn tin cậy để chấm/xóa ảnh, không tin fileId do client tự ghi vào answers.
  await adminDb.doc(`essayImages/${image.fileId}`).set({
    fileId: image.fileId,
    assignmentId,
    studentId,
    questionNumber,
    ownerUid: actor.uid,
    mimeType: image.mimeType || mimeType,
    fileName: image.fileName || fileName,
    size: Number(image.size) || 0,
    active: true,
    createdAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ image });
}

async function deleteImage(req: VercelRequest, res: VercelResponse, actor: Awaited<ReturnType<typeof requireApprovedUser>>) {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const fileId = String(body.fileId || '').trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return res.status(400).json({ error: 'fileId ảnh không hợp lệ.' });

  const metaRef = adminDb.doc(`essayImages/${fileId}`);
  const metaSnap = await metaRef.get();
  if (!metaSnap.exists) {
    // Ảnh của phiên bản cũ chưa có metadata: không xóa Drive để tránh xóa nhầm file ngoài hệ thống.
    return res.status(409).json({ error: 'Ảnh cũ chưa có metadata an toàn; đã có thể gỡ khỏi bài nhưng không tự xóa file Drive.' });
  }
  const meta = metaSnap.data() || {};
  const staff = ['ADMIN', 'TEACHER', 'TA'].includes(actor.role);
  if (!staff && (actor.role !== 'STUDENT' || meta.ownerUid !== actor.uid || meta.studentId !== actor.studentId)) {
    return res.status(403).json({ error: 'Bạn không có quyền xóa ảnh này.' });
  }

  await callEssayAppsScript('deleteImage', { fileId });
  await metaRef.delete();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ deleted: true, fileId });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  try {
    const actor = await requireApprovedUser(req);
    const action = String(req.body?.action || 'upload');
    if (action === 'delete') return await deleteImage(req, res, actor);
    if (action !== 'upload') return res.status(400).json({ error: 'Action ảnh không hợp lệ.' });
    return await uploadImage(req, res, actor);
  } catch (error) {
    console.error('[essay-image]', error);
    const result = errorStatus(error);
    return res.status(result.status).json({ error: result.message });
  }
}
