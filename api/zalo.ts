import type { VercelRequest, VercelResponse } from '@vercel/node';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const BACKEND_URL = String(process.env.ZALO_BACKEND_URL || '').replace(/\/+$/, '');
const BACKEND_API_KEY = String(process.env.ZALO_BACKEND_API_KEY || '');

/* ------------------------------------------------------------------ *
 * Biến môi trường
 * Nhận cả hai kiểu tên biến Firebase: có và không có tiền tố ADMIN_,
 * để không phải đổi tên biến đang dùng ở chỗ khác trong web quản lý.
 * ------------------------------------------------------------------ */
function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value;
  }
  return '';
}

function getAdminApp(): App {
  if (getApps().length) return getApps()[0];

  const serviceAccountJson = env(
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON',
  );

  if (serviceAccountJson) {
    const serviceAccount = JSON.parse(serviceAccountJson);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = String(serviceAccount.private_key).replace(/\\n/g, '\n');
    }
    return initializeApp({ credential: cert(serviceAccount) });
  }

  const projectId = env('FIREBASE_PROJECT_ID', 'FIREBASE_ADMIN_PROJECT_ID');
  const clientEmail = env('FIREBASE_CLIENT_EMAIL', 'FIREBASE_ADMIN_CLIENT_EMAIL');
  const privateKey = env('FIREBASE_PRIVATE_KEY', 'FIREBASE_ADMIN_PRIVATE_KEY')
    .replace(/\\n/g, '\n')
    .replace(/^["']|["']$/g, ''); // bỏ dấu ngoặc kép nếu dán kèm từ file JSON

  if (!projectId || !clientEmail || !privateKey) {
    const missing = [
      !projectId && 'PROJECT_ID',
      !clientEmail && 'CLIENT_EMAIL',
      !privateKey && 'PRIVATE_KEY',
    ]
      .filter(Boolean)
      .join(', ');

    throw new Error(
      `Thiếu biến Firebase: ${missing}. ` +
        'Chấp nhận cả FIREBASE_* và FIREBASE_ADMIN_*, hoặc một biến FIREBASE_SERVICE_ACCOUNT_JSON.',
    );
  }

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

/* ------------------------------------------------------------------ *
 * Xác thực và phân quyền
 * ------------------------------------------------------------------ */
type Staff = { uid: string; role: string };

const CAN_MESSAGE = ['ADMIN', 'TEACHER', 'TA'];
const CAN_ADMIN = ['ADMIN'];

async function requireStaff(req: VercelRequest): Promise<Staff> {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('UNAUTHORIZED');

  const app = getAdminApp();
  const decoded = await getAuth(app).verifyIdToken(match[1]);
  const profile = await getFirestore(app).collection('users').doc(decoded.uid).get();
  if (!profile.exists) throw new Error('UNAUTHORIZED');

  const data = profile.data() || {};
  const role = String(data.role || '');

  if (data.isApproved !== true || !CAN_MESSAGE.includes(role)) {
    throw new Error('FORBIDDEN');
  }

  return { uid: decoded.uid, role };
}

/* ------------------------------------------------------------------ *
 * Nhật ký đã gửi — lưu ở Firestore
 *
 * Không lưu ở Render vì ổ đĩa ephemeral, deploy lại là mất sạch.
 * Mỗi (loại, lớp, kỳ) là MỘT document chứa map theo studentId — đọc một lần,
 * không cần composite index, và hai nhân viên gửi cùng lúc cho hai em khác nhau
 * vẫn merge được vào cùng doc.
 * ------------------------------------------------------------------ */
const LOG_COLLECTION = 'zaloSendLogs';
const LOG_KINDS = ['ESSAY_RESULT'] as const;

type LogKind = (typeof LOG_KINDS)[number];

interface LogRef {
  kind: LogKind;
  classId: string;
  periodKey: string;
  students?: Array<{ id: string; name?: string; phone?: string }>;
}

function parseLogRef(raw: unknown): LogRef | null {
  if (!raw || typeof raw !== 'object') return null;

  const value = raw as Record<string, unknown>;
  const kind = String(value.kind || '') as LogKind;
  const classId = String(value.classId || '').trim();
  const periodKey = String(value.periodKey || '').trim();

  if (!LOG_KINDS.includes(kind) || !classId || !periodKey) return null;

  const students = Array.isArray(value.students)
    ? value.students
        .map((s) => {
          const item = (s ?? {}) as Record<string, unknown>;
          return {
            id: String(item.id || '').trim(),
            name: item.name ? String(item.name) : undefined,
            phone: item.phone ? String(item.phone) : undefined,
          };
        })
        .filter((s) => s.id)
    : [];

  return { kind, classId, periodKey, students };
}

// Dấu gạch chéo không dùng được trong document id.
function logDocId(ref: LogRef) {
  const safe = (v: string) => v.replace(/[/\\]/g, '_');
  return `${ref.kind}__${safe(ref.classId)}__${safe(ref.periodKey)}`;
}

async function readSentLog(app: App, ref: LogRef) {
  const snap = await getFirestore(app).collection(LOG_COLLECTION).doc(logDocId(ref)).get();
  if (!snap.exists) return {};
  return (snap.data()?.students ?? {}) as Record<string, unknown>;
}

async function writeSentLog(app: App, ref: LogRef, staff: Staff, jobId: string) {
  if (!ref.students?.length) return;

  const now = new Date().toISOString();
  const students: Record<string, unknown> = {};

  for (const student of ref.students) {
    students[student.id] = {
      at: now,
      byUid: staff.uid,
      byRole: staff.role,
      jobId,
      ...(student.name ? { name: student.name } : {}),
      ...(student.phone ? { phone: student.phone } : {}),
    };
  }

  await getFirestore(app)
    .collection(LOG_COLLECTION)
    .doc(logDocId(ref))
    .set(
      {
        kind: ref.kind,
        classId: ref.classId,
        periodKey: ref.periodKey,
        updatedAt: now,
        students,
      },
      { merge: true },
    );
}

/* ------------------------------------------------------------------ *
 * Danh sách đường dẫn được phép gọi sang backend Zalo
 * ------------------------------------------------------------------ */
type Upstream = { path: string; method: 'GET' | 'POST'; adminOnly?: boolean };

const ID = '[A-Za-z0-9_-]+';

const ROUTES: Array<{ test: RegExp; method: 'GET' | 'POST'; adminOnly?: boolean }> = [
  // Đọc
  { test: /^health$/, method: 'GET' },
  { test: /^threads$/, method: 'GET' },
  { test: new RegExp(`^messages/${ID}$`), method: 'GET' },
  { test: /^updates$/, method: 'GET' },
  { test: new RegExp(`^job/${ID}$`), method: 'GET' },

  // Gửi và cập nhật
  { test: /^send$/, method: 'POST' },
  { test: /^send-bulk$/, method: 'POST' },
  { test: /^send-file$/, method: 'POST' },
  { test: /^resolve$/, method: 'POST' },
  { test: new RegExp(`^read/${ID}$`), method: 'POST' },
  { test: new RegExp(`^threads/${ID}/name$`), method: 'POST' },

  // Kết nối lại tài khoản Zalo — chỉ ADMIN, vì việc này đổi tài khoản
  // mà cả trung tâm đang dùng để nhắn phụ huynh.
  { test: /^login\/state$/, method: 'GET', adminOnly: true },
  { test: /^login\/start$/, method: 'POST', adminOnly: true },
  { test: /^login\/retry$/, method: 'POST', adminOnly: true },
];

function badRequest(message: string) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function resolveUpstream(pathValue: unknown): Upstream {
  const path = String(pathValue || '')
    .replace(/^\/+/, '')
    .trim();

  if (!path) throw badRequest('Thiếu đường dẫn Zalo.');

  const route = ROUTES.find((r) => r.test.test(path));
  if (!route) throw badRequest(`Đường dẫn Zalo không hợp lệ: ${path}`);

  return { path, method: route.method, adminOnly: route.adminOnly };
}

/* ------------------------------------------------------------------ *
 * Kiểm tra dữ liệu gửi lên
 * ------------------------------------------------------------------ */
/** Trần base64 an toàn: Vercel giới hạn body 4.5MB, base64 phình ~33%. */
const MAX_BASE64_CHARS = 3_000_000;
const MAX_FILES = 5;

function validateFiles(files: unknown, where: string) {
  if (!Array.isArray(files) || files.length === 0) {
    throw badRequest(`${where}: danh sách files rỗng.`);
  }
  if (files.length > MAX_FILES) {
    throw badRequest(`${where}: tối đa ${MAX_FILES} file mỗi tin.`);
  }

  files.forEach((raw, index) => {
    const file = (raw ?? {}) as Record<string, unknown>;

    if (!file.base64 && !file.url) {
      throw badRequest(`${where}, file ${index + 1}: cần base64 hoặc url.`);
    }
    if (!file.url && !String(file.filename || '').includes('.')) {
      throw badRequest(`${where}, file ${index + 1}: filename phải có phần mở rộng.`);
    }
    if (typeof file.base64 === 'string' && file.base64.length > MAX_BASE64_CHARS) {
      throw badRequest(
        `${where}, file ${index + 1} quá lớn để gửi trực tiếp. ` +
          'Hãy nén ảnh, hoặc tải lên Drive rồi truyền "url".',
      );
    }
  });
}

function validatePayload(path: string, payload: unknown) {
  const body = (payload ?? {}) as Record<string, unknown>;

  if (path === 'send') {
    if (!String(body.message || '').trim() || (!body.phone && !body.userId)) {
      throw badRequest('Tin nhắn cần có nội dung và số điện thoại hoặc userId.');
    }
    return;
  }

  if (path === 'send-bulk') {
    const items = body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
      throw badRequest('Danh sách gửi phải có từ 1 đến 200 người.');
    }

    // Tổng dung lượng của cả lô cũng phải nằm trong giới hạn body của Vercel.
    let totalBase64 = 0;

    items.forEach((raw, index) => {
      const item = (raw ?? {}) as Record<string, unknown>;
      const where = `Dòng thứ ${index + 1}`;

      if (!item.phone && !item.userId) {
        throw badRequest(`${where} thiếu số điện thoại.`);
      }

      const hasFiles = Array.isArray(item.files) && item.files.length > 0;

      // Tin chỉ có file thì message được phép rỗng.
      if (!String(item.message || '').trim() && !hasFiles) {
        throw badRequest(`${where} thiếu nội dung và cũng không có file.`);
      }

      if (hasFiles) {
        validateFiles(item.files, where);
        for (const f of item.files as Array<Record<string, unknown>>) {
          if (typeof f.base64 === 'string') totalBase64 += f.base64.length;
        }
      }
    });

    if (totalBase64 > MAX_BASE64_CHARS) {
      throw badRequest(
        'Tổng dung lượng file của cả lô vượt giới hạn. Gửi ít người hơn mỗi lượt, ' +
          'hoặc tải file lên Drive rồi truyền "url".',
      );
    }
    return;
  }

  if (path === 'send-file') {
    if (!body.phone && !body.userId) {
      throw badRequest('Cần số điện thoại hoặc userId.');
    }
    validateFiles(body.files, 'Tin nhắn');
    return;
  }

  if (path === 'resolve') {
    if (!String(body.phone || '').trim()) throw badRequest('Thiếu số điện thoại.');
    return;
  }

  // read/:id, threads/:id/name, login/* không cần payload bắt buộc
}

/* ------------------------------------------------------------------ *
 * Xây URL kèm query (dùng cho updates?since=... )
 * ------------------------------------------------------------------ */
const ALLOWED_QUERY = new Set(['since']);

function buildUrl(path: string, query: unknown): string {
  const url = new URL(`${BACKEND_URL}/${path}`);

  if (query && typeof query === 'object') {
    for (const [key, value] of Object.entries(query as Record<string, unknown>)) {
      if (ALLOWED_QUERY.has(key) && value != null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }
  }

  return url.toString();
}

/* ------------------------------------------------------------------ *
 * Handler
 * ------------------------------------------------------------------ */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Chỉ hỗ trợ POST.' });
  }

  try {
    const staff = await requireStaff(req);

    // 'sent-log' xử lý ngay tại đây, không chuyển tiếp sang Render —
    // nhật ký nằm ở Firestore, backend Zalo không biết gì về nó.
    if (String(req.body?.path || '') === 'sent-log') {
      const ref = parseLogRef(req.body?.payload);
      if (!ref) {
        return res
          .status(400)
          .json({ ok: false, error: 'Cần kind, classId và periodKey hợp lệ.' });
      }

      const students = await readSentLog(getAdminApp(), ref);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ ok: true, students });
    }

    if (!BACKEND_URL || !BACKEND_API_KEY) {
      const missing = [!BACKEND_URL && 'ZALO_BACKEND_URL', !BACKEND_API_KEY && 'ZALO_BACKEND_API_KEY']
        .filter(Boolean)
        .join(', ');
      return res.status(500).json({ ok: false, error: `Thiếu ${missing} trên Vercel.` });
    }

    const upstream = resolveUpstream(req.body?.path);

    if (upstream.adminOnly && !CAN_ADMIN.includes(staff.role)) {
      return res
        .status(403)
        .json({ ok: false, error: 'Chỉ quản trị viên được kết nối lại tài khoản Zalo.' });
    }

    const payload = req.body?.payload;
    if (upstream.method === 'POST') validatePayload(upstream.path, payload);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const upstreamResponse = await fetch(buildUrl(upstream.path, req.body?.query), {
        method: upstream.method,
        headers: {
          'x-api-key': BACKEND_API_KEY,
          'Content-Type': 'application/json',
        },
        ...(upstream.method === 'POST' ? { body: JSON.stringify(payload ?? {}) } : {}),
        signal: controller.signal,
      });

      const text = await upstreamResponse.text();

      if (['send', 'send-bulk', 'send-file'].includes(upstream.path)) {
        console.log(
          `[api/zalo] ${staff.role} ${staff.uid} → ${upstream.path} (${upstreamResponse.status})`,
        );

        // Ghi nhật ký đã gửi. Chỉ ghi khi backend nhận vào hàng đợi thành công.
        // Lưu ý: đây là mốc "đã đưa vào hàng đợi", chưa phải "Zalo đã nhận" —
        // nên giao diện dùng nó để CẢNH BÁO, không chặn cứng việc gửi lại.
        if (upstreamResponse.ok) {
          const ref = parseLogRef(req.body?.log);

          if (ref) {
            let jobId = '';
            try {
              jobId = String(JSON.parse(text)?.jobId || '');
            } catch { /* không có jobId thì vẫn ghi log */ }

            // Ghi log thất bại không được làm hỏng việc gửi — tin đã đi rồi.
            try {
              await writeSentLog(getAdminApp(), ref, staff, jobId);
            } catch (logError) {
              console.error('[api/zalo] Không ghi được nhật ký:', logError);
            }
          }
        }
      }

      res.status(upstreamResponse.status);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(text);
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không gọi được dịch vụ Zalo.';

    if (message === 'UNAUTHORIZED') {
      return res.status(401).json({ ok: false, error: 'Chưa đăng nhập.' });
    }
    if (message === 'FORBIDDEN') {
      return res.status(403).json({ ok: false, error: 'Tài khoản không có quyền gửi Zalo.' });
    }
    if (error instanceof Error && error.name === 'AbortError') {
      return res.status(504).json({ ok: false, error: 'Dịch vụ Zalo phản hồi quá chậm.' });
    }

    console.error('[api/zalo]', error);
    return res
      .status(Number((error as { statusCode?: number })?.statusCode) || 502)
      .json({ ok: false, error: message });
  }
}
