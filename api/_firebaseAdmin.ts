import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

function serviceAccount() {
  const json = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (json) {
    try {
      const parsed = JSON.parse(json) as Record<string, string>;
      if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      return parsed;
    } catch {
      throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON không phải JSON hợp lệ.');
    }
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL || process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = String(process.env.FIREBASE_ADMIN_PRIVATE_KEY || process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Thiếu FIREBASE_SERVICE_ACCOUNT_JSON hoặc bộ FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.');
  }
  return { projectId, clientEmail, privateKey };
}

function initAdmin() {
  if (getApps().length) return getApps()[0];
  return initializeApp({ credential: cert(serviceAccount()) });
}

export const adminApp = initAdmin();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
