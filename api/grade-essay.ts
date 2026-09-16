import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireStaff } from './_auth.js';
import { adminDb } from './_firebaseAdmin.js';
import { callEssayAppsScript } from './_essayAppsScript.js';
import { readAssignmentExam } from '../server/examStore.js';

export const config = { maxDuration: 60 };

function stripDangerous(value: unknown, maxLength: number) {
  return String(value || '').replace(/\0/g, '').slice(0, maxLength);
}

function errorStatus(error: unknown) {
  const message = error instanceof Error ? error.message : 'Không chấm được bài.';
  if (message === 'UNAUTHORIZED') return { status: 401, message: 'Chưa đăng nhập.' };
  if (message === 'FORBIDDEN') return { status: 403, message: 'Tài khoản không có quyền chấm bài.' };
  return { status: Number((error as { statusCode?: number })?.statusCode) || 500, message };
}

type StoredEssayImage = {
  fileId: string;
  url?: string;
  mimeType?: string;
  fileName?: string;
};

function parseEssayAnswer(raw: unknown) {
  try {
    const parsed = JSON.parse(String(raw || ''));
    const images = Array.isArray(parsed?.images)
      ? parsed.images.slice(0, 8).map((image: Record<string, unknown>): StoredEssayImage => ({
          fileId: stripDangerous(image.fileId, 160),
          url: stripDangerous(image.url, 500),
          mimeType: stripDangerous(image.mimeType, 80) || 'image/jpeg',
          fileName: stripDangerous(image.fileName, 200),
        })).filter((image: StoredEssayImage) => Boolean(image.fileId))
      : [];
    return { text: stripDangerous(parsed?.text, 40_000), images };
  } catch {
    return { text: stripDangerous(raw, 40_000), images: [] as StoredEssayImage[] };
  }
}

function urlMatchesFileId(url: string | undefined, fileId: string) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (!['drive.google.com', 'www.googleapis.com'].includes(parsed.hostname)) return false;
    return parsed.searchParams.get('id') === fileId || parsed.pathname.includes(`/d/${fileId}/`);
  } catch {
    return false;
  }
}

async function validateImageOwnership(
  image: StoredEssayImage,
  context: { assignmentId: string; studentId: string; questionNumber: number },
) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(image.fileId)) {
    throw Object.assign(new Error('Bài làm chứa fileId ảnh không hợp lệ.'), { statusCode: 400 });
  }

  const metaSnap = await adminDb.doc(`essayImages/${image.fileId}`).get();
  if (metaSnap.exists) {
    const meta = metaSnap.data() || {};
    const ok = meta.active !== false
      && String(meta.assignmentId || '') === context.assignmentId
      && String(meta.studentId || '') === context.studentId
      && Number(meta.questionNumber) === context.questionNumber;
    if (!ok) throw Object.assign(new Error('Ảnh bài làm không thuộc đúng học sinh/câu hỏi.'), { statusCode: 403 });
    return;
  }

  // Tương thích ảnh tạo bởi bản cũ trước khi có collection essayImages.
  // Chỉ chấp nhận link Drive có fileId khớp và tên file mang assignment + Q.
  const legacyNameHint = `_${context.assignmentId}_Q${context.questionNumber}_`;
  if (!urlMatchesFileId(image.url, image.fileId) || !String(image.fileName || '').includes(legacyNameHint)) {
    throw Object.assign(new Error('Ảnh cũ không đủ thông tin để xác minh an toàn. Hãy tải lại ảnh trước khi chấm AI.'), { statusCode: 409 });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  try {
    await requireStaff(req);
    const submissionId = String(req.body?.submissionId || '').trim();
    const questionNumber = Number(req.body?.questionNumber);
    if (!submissionId || submissionId.length > 300 || !Number.isInteger(questionNumber) || questionNumber < 1) {
      return res.status(400).json({ error: 'Thiếu submissionId hoặc questionNumber.' });
    }

    const submissionSnap = await adminDb.doc(`submissions/${submissionId}`).get();
    if (!submissionSnap.exists) throw Object.assign(new Error('Không tìm thấy bài làm.'), { statusCode: 404 });
    const submission = submissionSnap.data() || {};
    if (!['submitted', 'graded'].includes(String(submission.status || ''))) {
      throw Object.assign(new Error('Học sinh chưa nộp bài để chấm.'), { statusCode: 409 });
    }

    const exam = await readAssignmentExam(String(submission.examId || ''));
    const question = (exam.questions || []).find((item: Record<string, unknown>) => Number(item.number) === questionNumber);
    if (!question || question.type !== 'writing') {
      throw Object.assign(new Error('Không tìm thấy câu tự luận cần chấm.'), { statusCode: 404 });
    }

    const answer = parseEssayAnswer((submission.answers || {})[String(questionNumber)]);
    const context = {
      assignmentId: String(submission.assignmentId || ''),
      studentId: String(submission.studentId || ''),
      questionNumber,
    };
    await Promise.all(answer.images.map((image) => validateImageOwnership(image, context)));

    const maxScore = Math.max(0.25, Math.min(100, Number(question.points) || 1));
    const rubric = [
      question.correctAnswer ? `RUBRIC / BAREM ĐIỂM:\n${String(question.correctAnswer)}` : '',
      question.solution ? `LỜI GIẢI THAM KHẢO:\n${String(question.solution)}` : '',
    ].filter(Boolean).join('\n\n');

    const data = await callEssayAppsScript<{ result: Record<string, unknown> }>('gradeEssay', {
      questionText: stripDangerous(question.text, 30_000),
      rubric: stripDangerous(rubric, 30_000),
      maxScore,
      answer: {
        text: answer.text,
        images: answer.images.map((image) => ({
          fileId: image.fileId,
          mimeType: image.mimeType || 'image/jpeg',
          fileName: image.fileName || 'bai-lam.jpg',
        })),
      },
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ result: data.result });
  } catch (error) {
    console.error('[grade-essay]', error);
    const result = errorStatus(error);
    return res.status(result.status).json({ error: result.message });
  }
}
