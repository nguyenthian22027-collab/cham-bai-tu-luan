import { auth } from '../config/firebase';
import { EssayAiDetails, EssayStoredImage, EssayStepFeedback } from '../types';

export interface EssayAnswerData {
  text: string;
  images: EssayStoredImage[];
}

export interface EssayGradeResult extends EssayAiDetails {
  score: number;
  maxScore: number;
  pending?: boolean;
  error?: string;
}

interface LegacyEssayImage {
  data?: string;
  type?: string;
  name?: string;
  fileId?: string;
  url?: string;
  thumbnailUrl?: string;
  mimeType?: string;
  fileName?: string;
  size?: number;
}

function normalizeImage(raw: LegacyEssayImage): EssayStoredImage | null {
  if (!raw || !raw.fileId || !raw.url) return null;
  return {
    fileId: String(raw.fileId),
    url: String(raw.url),
    thumbnailUrl: raw.thumbnailUrl ? String(raw.thumbnailUrl) : undefined,
    mimeType: String(raw.mimeType || raw.type || 'image/jpeg'),
    fileName: String(raw.fileName || raw.name || 'bai-lam.jpg'),
    size: Number(raw.size) || undefined,
  };
}

export function parseEssayAnswer(raw: string): EssayAnswerData {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const images = Array.isArray(parsed.images)
        ? parsed.images.map((item: LegacyEssayImage) => normalizeImage(item)).filter(Boolean) as EssayStoredImage[]
        : [];
      return { text: String(parsed.text || ''), images };
    }
  } catch {
    // Dữ liệu cũ có thể chỉ là chuỗi văn bản.
  }
  return { text: raw || '', images: [] };
}

export function serializeEssayAnswer(data: EssayAnswerData): string {
  return JSON.stringify({ text: data.text || '', images: data.images || [] });
}

export function hasEssayAnswer(raw: string | undefined): boolean {
  if (!raw) return false;
  const parsed = parseEssayAnswer(raw);
  return parsed.text.trim().length > 0 || parsed.images.length > 0;
}

async function authorizedFetch<T>(url: string, init: RequestInit): Promise<T> {
  const current = auth.currentUser;
  if (!current) throw new Error('Phiên đăng nhập đã hết. Vui lòng đăng nhập lại.');
  const token = await current.getIdToken();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Lỗi máy chủ (${response.status}).`);
  return data as T;
}

export async function uploadEssayImage(input: {
  base64: string;
  mimeType: string;
  fileName: string;
  assignmentId: string;
  studentId: string;
  questionNumber: number;
}): Promise<EssayStoredImage> {
  const data = await authorizedFetch<{ image: EssayStoredImage }>('/api/essay-image', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.image;
}

export async function deleteEssayImage(fileId: string): Promise<void> {
  await authorizedFetch<{ deleted: boolean }>('/api/essay-image', {
    method: 'POST',
    body: JSON.stringify({ action: 'delete', fileId }),
  });
}

export async function gradeEssayWithGemini(input: {
  submissionId: string;
  questionNumber: number;
  maxScore: number;
}): Promise<EssayGradeResult> {
  const maxScore = Math.max(0.25, Number(input.maxScore) || 1);
  try {
    const data = await authorizedFetch<{ result: EssayGradeResult }>('/api/grade-essay', {
      method: 'POST',
      body: JSON.stringify({
        submissionId: input.submissionId,
        questionNumber: input.questionNumber,
      }),
    });
    return {
      score: Math.max(0, Math.min(Number(data.result.score) || 0, maxScore)),
      maxScore,
      summary: String(data.result.summary || ''),
      feedbackMarkdown: String(data.result.feedbackMarkdown || data.result.summary || ''),
      steps: Array.isArray(data.result.steps)
        ? data.result.steps.map((step: EssayStepFeedback) => ({
            studentText: String(step.studentText || ''),
            status: ['correct', 'partial', 'incorrect'].includes(step.status) ? step.status : 'partial',
            comment: String(step.comment || ''),
            correction: step.correction ? String(step.correction) : undefined,
            page: Number(step.page) || undefined,
            x: Number.isFinite(Number(step.x)) ? Number(step.x) : undefined,
            y: Number.isFinite(Number(step.y)) ? Number(step.y) : undefined,
            awardedPoints: Number.isFinite(Number(step.awardedPoints)) ? Number(step.awardedPoints) : undefined,
            maxPoints: Number.isFinite(Number(step.maxPoints)) ? Number(step.maxPoints) : undefined,
            source: step.source === 'manual' ? 'manual' : 'ai',
          }))
        : [],
    };
  } catch (error) {
    return {
      score: 0,
      maxScore,
      summary: '',
      feedbackMarkdown: '',
      steps: [],
      pending: true,
      error: error instanceof Error ? error.message : 'Không chấm được bài.',
    };
  }
}
