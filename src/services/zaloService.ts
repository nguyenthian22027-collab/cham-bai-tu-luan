import { auth } from '../config/firebase';

export interface ZaloFilePayload {
  filename: string;
  /** Nội dung file dạng base64 (không kèm tiền tố data:). Dùng cho file nhỏ. */
  base64?: string;
  /** Link để backend tự tải file về. Dùng cho file lớn (Drive, Apps Script). */
  url?: string;
}

export interface ZaloRecipient {
  id: string;
  name: string;
  phone: string;
  message: string;
  /** Ảnh hoặc file gửi kèm. Có file thì message được phép để trống. */
  files?: ZaloFilePayload[];
}

/** Loại thông báo, dùng làm khoá nhật ký đã gửi. */
export type ZaloLogKind = 'ESSAY_RESULT';

/**
 * Tham chiếu nhật ký đã gửi.
 * periodKey: monthKey cho học phí, ngày cho điểm danh, id cột điểm cho điểm số.
 */
export interface ZaloLogRef {
  kind: ZaloLogKind;
  classId: string;
  periodKey: string;
}

export interface ZaloSentEntry {
  at: string;
  byUid: string;
  byRole: string;
  jobId?: string;
  name?: string;
  phone?: string;
}

/** studentId -> lần gửi gần nhất */
export type ZaloSentMap = Record<string, ZaloSentEntry>;

export interface ZaloJob {
  jobId: string;
  total: number;
  sent: number;
  failed: number;
  status: 'running' | 'done';
  results?: Array<{
    to: string;
    ok: boolean;
    threadId?: string;
    error?: string;
  }>;
}

interface ZaloResponse {
  ok: boolean;
  error?: string;
  jobId?: string;
  students?: ZaloSentMap;
  total?: number;
  sent?: number;
  failed?: number;
  status?: 'running' | 'done';
  results?: ZaloJob['results'];
}

export function normalizeZaloPhone(value: string) {
  let phone = String(value || '').replace(/\D/g, '');
  if (phone.startsWith('84') && phone.length >= 11) phone = `0${phone.slice(2)}`;
  return phone;
}

export function isUsableZaloPhone(value: string) {
  const phone = normalizeZaloPhone(value);
  return /^0\d{8,10}$/.test(phone);
}

/** Bỏ các field chỉ dùng cho giao diện, chỉ giữ đúng thứ backend cần. */
function cleanFiles(files?: ZaloFilePayload[]): ZaloFilePayload[] | undefined {
  if (!files?.length) return undefined;
  return files.map(({ filename, base64, url }) => ({ filename, base64, url }));
}

async function callZalo(
  path: string,
  payload?: unknown,
  log?: ZaloLogRef & { students?: Array<{ id: string; name?: string; phone?: string }> }
): Promise<ZaloResponse> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Phiên đăng nhập đã hết hạn.');

  const token = await currentUser.getIdToken();
  const response = await fetch('/api/zalo', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, payload, ...(log ? { log } : {}) }),
  });

  const data = (await response.json().catch(() => ({}))) as ZaloResponse;
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `Không gọi được dịch vụ Zalo (${response.status}).`);
  }
  return data;
}

/** Gói thông tin người nhận vào tham chiếu nhật ký. */
function withStudents(log: ZaloLogRef | undefined, recipients: ZaloRecipient[]) {
  if (!log) return undefined;
  return {
    ...log,
    students: recipients.map((recipient) => ({
      id: recipient.id,
      name: recipient.name,
      phone: normalizeZaloPhone(recipient.phone),
    })),
  };
}

/** Đọc nhật ký đã gửi của một lớp trong một kỳ. */
export async function fetchZaloSentLog(log: ZaloLogRef): Promise<ZaloSentMap> {
  const data = await callZalo('sent-log', log);
  return data.students || {};
}

export async function sendZaloMessage(recipient: ZaloRecipient, log?: ZaloLogRef) {
  const data = await callZalo(
    'send',
    {
      phone: normalizeZaloPhone(recipient.phone),
      message: recipient.message.trim(),
      name: recipient.name,
    },
    withStudents(log, [recipient])
  );
  if (!data.jobId) throw new Error('Dịch vụ Zalo không trả về mã gửi.');
  return data.jobId;
}

/** Gửi một tin nhắn có kèm ảnh hoặc file. */
export async function sendZaloFiles(recipient: ZaloRecipient, log?: ZaloLogRef) {
  const files = cleanFiles(recipient.files);
  if (!files) throw new Error('Không có file để gửi.');

  const data = await callZalo(
    'send-file',
    {
      phone: normalizeZaloPhone(recipient.phone),
      // Có file thì nội dung được phép rỗng, nó trở thành chú thích dưới ảnh.
      message: (recipient.message || '').trim(),
      name: recipient.name,
      files,
    },
    withStudents(log, [recipient])
  );

  if (!data.jobId) throw new Error('Dịch vụ Zalo không trả về mã gửi.');
  return data.jobId;
}

export async function sendZaloBulk(recipients: ZaloRecipient[], log?: ZaloLogRef) {
  const data = await callZalo(
    'send-bulk',
    {
      items: recipients.map((recipient) => {
        const files = cleanFiles(recipient.files);
        return {
          phone: normalizeZaloPhone(recipient.phone),
          message: (recipient.message || '').trim(),
          name: recipient.name,
          // Chỉ gửi field files khi thực sự có, để backend không phải xử lý mảng rỗng.
          ...(files ? { files } : {}),
        };
      }),
    },
    withStudents(log, recipients)
  );

  if (!data.jobId) throw new Error('Dịch vụ Zalo không trả về mã gửi.');
  return data.jobId;
}

/* ------------------------------------------------------------------ *
 * Kết nối tài khoản Zalo (chỉ ADMIN)
 * ------------------------------------------------------------------ */

export interface ZaloHealth {
  ok: boolean;
  zalo: string;
  ownId?: string | null;
  connectedAt?: string | null;
  lastError?: string | null;
  quotaLeft?: number;
  queueDepth?: number;
}

export type ZaloLoginPhase =
  | 'idle'
  | 'waiting_scan'
  | 'scanned'
  | 'done'
  | 'expired'
  | 'declined'
  | 'error';

export interface ZaloLoginState {
  phase: ZaloLoginPhase;
  /** Ảnh QR dạng base64 PNG, chưa có tiền tố data:. */
  qrImage?: string | null;
  /** Tên tài khoản Zalo sau khi quét. */
  name?: string | null;
  error?: string | null;
  /** Chuỗi cần dán vào biến ZALO_SESSION trên Render. */
  sessionB64?: string | null;
}

/**
 * Tình trạng kết nối Zalo của backend.
 * Không dùng callZalo vì khi Zalo chưa kết nối, backend trả HTTP 503 —
 * đó là thông tin hợp lệ cần hiển thị, không phải lỗi cần ném ra.
 */
export async function getZaloHealth(): Promise<ZaloHealth> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error('Phiên đăng nhập đã hết hạn.');

  const token = await currentUser.getIdToken();
  const response = await fetch('/api/zalo', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path: 'health' }),
  });

  const data = (await response.json().catch(() => ({}))) as ZaloHealth & { error?: string };

  // 401/403 là lỗi quyền thật sự, vẫn phải ném.
  if (response.status === 401 || response.status === 403) {
    throw new Error(data.error || 'Không có quyền xem tình trạng Zalo.');
  }

  return {
    ok: Boolean(data.ok),
    zalo: String(data.zalo || 'unknown'),
    ownId: data.ownId ?? null,
    connectedAt: data.connectedAt ?? null,
    lastError: data.lastError ?? null,
    quotaLeft: data.quotaLeft,
    queueDepth: data.queueDepth,
  };
}

/** Bắt đầu một phiên đăng nhập QR mới. */
export async function startZaloLogin() {
  await callZalo('login/start');
}

/** Trạng thái phiên đăng nhập đang chạy. */
export async function getZaloLoginState(): Promise<ZaloLoginState> {
  const data = (await callZalo('login/state')) as unknown as ZaloLoginState;
  return data;
}

/** Tạo lại mã QR khi mã cũ hết hạn. */
export async function retryZaloQr() {
  await callZalo('login/retry');
}

export async function getZaloJob(jobId: string): Promise<ZaloJob> {
  const data = await callZalo(`job/${encodeURIComponent(jobId)}`);
  return {
    jobId,
    total: Number(data.total) || 0,
    sent: Number(data.sent) || 0,
    failed: Number(data.failed) || 0,
    status: data.status === 'done' ? 'done' : 'running',
    results: data.results || [],
  };
}

export async function waitForZaloJob(
  jobId: string,
  onProgress?: (job: ZaloJob) => void,
  maxWaitMs?: number
) {
  // Backend nghỉ 8–15 giây giữa mỗi tin, cộng thời gian upload file. Một lô 30
  // phụ huynh kèm ảnh có thể mất hơn 6 phút, nên 90 giây là quá ngắn — hàng đợi
  // vẫn chạy tiếp ở backend, nhưng giao diện sẽ không thấy được lúc hoàn tất.
  const limit = maxWaitMs ?? 6 * 60_000;

  const startedAt = Date.now();
  let latest: ZaloJob | null = null;

  while (Date.now() - startedAt < limit) {
    latest = await getZaloJob(jobId);
    onProgress?.(latest);
    if (latest.status === 'done') return latest;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }

  return latest;
}
