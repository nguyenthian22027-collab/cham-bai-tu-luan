import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function serviceAccount() {
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      return parsed;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ.');
    }
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY)?.replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Thiếu FIREBASE_SERVICE_ACCOUNT_JSON hoặc bộ FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.');
  }
  return { projectId, clientEmail, privateKey };
}

const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount()) });
export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);

export function bearerToken(req) {
  const value = String(req.headers?.authorization || '');
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
}

export async function requireStudent(req) {
  const token = bearerToken(req);
  if (!token) throw Object.assign(new Error('Thiếu phiên đăng nhập.'), { statusCode: 401 });
  const decoded = await adminAuth.verifyIdToken(token);
  const profileSnap = await adminDb.doc(`users/${decoded.uid}`).get();
  if (!profileSnap.exists) throw Object.assign(new Error('Không tìm thấy hồ sơ người dùng.'), { statusCode: 403 });
  const profile = profileSnap.data() || {};
  if (profile.isApproved !== true || profile.role !== 'STUDENT' || !profile.studentId) {
    throw Object.assign(new Error('Tài khoản không có quyền học sinh.'), { statusCode: 403 });
  }
  return { uid: decoded.uid, studentId: String(profile.studentId), profile };
}

export function sendError(res, error) {
  console.error(error);
  const status = Number(error?.statusCode) || 500;
  const message = status >= 500 ? (error?.message || 'Lỗi máy chủ.') : error.message;
  res.status(status).json({ error: message });
}
