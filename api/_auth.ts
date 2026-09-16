import type { VercelRequest } from '@vercel/node';
import { adminAuth, adminDb } from './_firebaseAdmin.js';

export async function requireAdmin(req: VercelRequest) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('UNAUTHORIZED');

  const decoded = await adminAuth.verifyIdToken(match[1]);
  const profile = await adminDb.collection('users').doc(decoded.uid).get();
  if (!profile.exists) throw new Error('UNAUTHORIZED');

  const data = profile.data() || {};
  if (data.isApproved !== true || data.role !== 'ADMIN') throw new Error('FORBIDDEN');

  return {
    uid: decoded.uid,
    name: String(data.name || decoded.name || 'Admin'),
  };
}


export async function requireStaff(req: VercelRequest) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('UNAUTHORIZED');

  const decoded = await adminAuth.verifyIdToken(match[1]);
  const profile = await adminDb.collection('users').doc(decoded.uid).get();
  if (!profile.exists) throw new Error('UNAUTHORIZED');

  const data = profile.data() || {};
  if (data.isApproved !== true || !['ADMIN', 'TEACHER', 'TA'].includes(String(data.role))) {
    throw new Error('FORBIDDEN');
  }

  return {
    uid: decoded.uid,
    name: String(data.name || decoded.name || 'Nhân sự'),
    role: String(data.role),
  };
}


export async function requireApprovedUser(req: VercelRequest) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('UNAUTHORIZED');

  const decoded = await adminAuth.verifyIdToken(match[1]);
  const profile = await adminDb.collection('users').doc(decoded.uid).get();
  if (!profile.exists) throw new Error('UNAUTHORIZED');

  const data = profile.data() || {};
  if (data.isApproved !== true || !['ADMIN', 'TEACHER', 'TA', 'STUDENT'].includes(String(data.role))) {
    throw new Error('FORBIDDEN');
  }

  return {
    uid: decoded.uid,
    name: String(data.name || decoded.name || 'Người dùng'),
    role: String(data.role),
    studentId: data.studentId ? String(data.studentId) : undefined,
  };
}
