import { auth } from '../config/firebase';
import { PublishedEssayLink, PublicEssayResult } from '../types';

async function staffFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const current = auth.currentUser;
  if (!current) throw new Error('Phiên đăng nhập đã hết.');
  const token = await current.getIdToken();
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Lỗi máy chủ (${response.status}).`);
  return data as T;
}

export async function getPublishedEssayLink(submissionId: string): Promise<PublishedEssayLink | null> {
  const data = await staffFetch<{ publication: PublishedEssayLink | null }>(
    `/api/publish-result?submissionId=${encodeURIComponent(submissionId)}`,
  );
  return data.publication;
}

export async function publishEssayResult(submissionId: string): Promise<PublishedEssayLink> {
  const data = await staffFetch<{ publication: PublishedEssayLink }>('/api/publish-result', {
    method: 'POST',
    body: JSON.stringify({ action: 'publish', submissionId }),
  });
  return data.publication;
}

export async function revokeEssayResult(submissionId: string): Promise<PublishedEssayLink | null> {
  const data = await staffFetch<{ publication: PublishedEssayLink | null }>('/api/publish-result', {
    method: 'POST',
    body: JSON.stringify({ action: 'revoke', submissionId }),
  });
  return data.publication;
}

export async function getPublicEssayResult(token: string): Promise<PublicEssayResult> {
  const response = await fetch(`/api/public-result?token=${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || 'Không mở được kết quả chấm bài.');
  return data.result as PublicEssayResult;
}
