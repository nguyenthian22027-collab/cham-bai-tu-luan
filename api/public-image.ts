import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminDb } from './_firebaseAdmin.js';

function parseIndex(value: unknown) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export const config = { maxDuration: 60 };
const MAX_PUBLIC_IMAGE_BYTES = 6 * 1024 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Chỉ hỗ trợ GET.' });
  }

  try {
    const token = String(req.query.token || '').trim();
    const questionNumber = Number(req.query.question);
    const imageIndex = parseIndex(req.query.image);
    if (!/^[A-Za-z0-9_-]{24,120}$/.test(token) || !Number.isFinite(questionNumber) || imageIndex === null) {
      return res.status(400).json({ error: 'Thiếu tham số ảnh công khai.' });
    }

    const snap = await adminDb.doc(`publicEssayResults/${token}`).get();
    if (!snap.exists) return res.status(404).json({ error: 'Không tìm thấy kết quả.' });
    const data = snap.data() || {};
    if (data.active !== true) return res.status(410).json({ error: 'Liên kết kết quả đã bị thu hồi.' });

    const questions = Array.isArray(data.questions) ? data.questions as Array<Record<string, unknown>> : [];
    const question = questions.find((item) => Number(item?.number) === questionNumber);
    if (!question) return res.status(404).json({ error: 'Không tìm thấy câu hỏi.' });
    const images = Array.isArray(question.images) ? question.images as Array<Record<string, unknown>> : [];
    const image = images[imageIndex];
    const fileId = String(image?.fileId || '').trim();
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return res.status(404).json({ error: 'Không tìm thấy ảnh hợp lệ.' });

    // Không fetch URL do dữ liệu lưu sẵn cung cấp (tránh biến endpoint thành open proxy/SSRF).
    // Chỉ dựng URL Google Drive từ fileId đã nằm trong snapshot công bố.
    const metaSnap = await adminDb.doc(`essayImages/${fileId}`).get();
    if (metaSnap.exists) {
      const meta = metaSnap.data() || {};
      if (meta.active === false || (data.assignmentId && String(meta.assignmentId || '') !== String(data.assignmentId))) {
        return res.status(403).json({ error: 'Ảnh không thuộc kết quả này.' });
      }
    }

    const driveUrl = `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
    const upstream = await fetch(driveUrl, { redirect: 'follow' });
    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: 'Không đọc được ảnh từ Google Drive.' });
    }

    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > MAX_PUBLIC_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Ảnh vượt giới hạn công khai.' });
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_PUBLIC_IMAGE_BYTES) {
      return res.status(413).json({ error: 'Ảnh vượt giới hạn công khai.' });
    }

    const contentType = String(upstream.headers.get('content-type') || image.mimeType || 'image/jpeg');
    if (!/^image\/(?:jpeg|png|webp)$/i.test(contentType.split(';')[0].trim())) {
      return res.status(502).json({ error: 'Nguồn ảnh trả về định dạng không hợp lệ.' });
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(String(image.fileName || `anh-${questionNumber}-${imageIndex + 1}.jpg`))}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    console.error('[public-image]', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Không đọc được ảnh.' });
  }
}
