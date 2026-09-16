import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_firebaseAdmin.js';

function iso(value: unknown) {
  if (!value) return null;
  const date = (value as { toDate?: () => Date }).toDate?.() || new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Chỉ hỗ trợ GET.' });
  }

  try {
    const token = String(req.query.token || '').trim();
    if (!/^[A-Za-z0-9_-]{24,120}$/.test(token)) return res.status(404).json({ error: 'Liên kết không hợp lệ.' });

    const ref = adminDb.doc(`publicEssayResults/${token}`);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'Không tìm thấy kết quả.' });
    const data = snap.data() || {};
    if (data.active !== true) return res.status(410).json({ error: 'Liên kết kết quả đã được thu hồi.' });

    const expiresAt = iso(data.expiresAt);
    if (expiresAt && new Date(expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'Liên kết kết quả đã hết hạn.' });
    }

    res.setHeader('Cache-Control', 'private, max-age=0, no-store');
    return res.status(200).json({
      result: {
        token,
        submissionId: String(data.submissionId || ''),
        assignmentId: String(data.assignmentId || ''),
        title: String(data.title || 'Kết quả chấm bài tự luận'),
        className: String(data.className || ''),
        studentName: String(data.studentName || 'Học sinh'),
        teacherName: data.teacherName ? String(data.teacherName) : undefined,
        finalScore: Number(data.finalScore) || 0,
        maxScore: Number(data.maxScore) || 0,
        finalFeedback: String(data.finalFeedback || ''),
        publishedAt: iso(data.publishedAt) || new Date().toISOString(),
        expiresAt,
        questions: Array.isArray(data.questions) ? data.questions : [],
      },
    });
  } catch (error) {
    console.error('[public-result]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Không đọc được kết quả.' });
  }
}
