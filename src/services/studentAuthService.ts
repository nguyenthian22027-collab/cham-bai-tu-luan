import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, studentCreatorAuth } from '../config/firebase';
import { AppUser, CreateStudentAccountInput, Role, StudentAccount } from '../types';
import { getUserProfile } from './authService';

const STUDENT_EMAIL_DOMAIN = 'student.local';

const toDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return undefined;
};

export function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export function isValidStudentUsername(username: string) {
  return /^[a-zA-Z0-9_]{3,30}$/.test(username.trim());
}

export function usernameToStudentEmail(username: string) {
  return `${normalizeUsername(username)}@${STUDENT_EMAIL_DOMAIN}`;
}

const mapStudentAccount = (id: string, d: Record<string, unknown>): StudentAccount => ({
  id,
  username: (d.username as string) || id,
  email: (d.email as string) || usernameToStudentEmail(id),
  uid: (d.uid as string) || '',
  studentId: (d.studentId as string) || '',
  studentName: (d.studentName as string) || '',
  classIds: Array.isArray(d.classIds) ? (d.classIds as string[]) : [],
  className: d.className as string | undefined,
  isActive: (d.isActive as boolean) ?? true,
  createdBy: d.createdBy as string | undefined,
  createdAt: toDate(d.createdAt),
  updatedAt: toDate(d.updatedAt),
});

export async function createStudentLoginAccount(
  input: CreateStudentAccountInput
): Promise<StudentAccount> {
  const username = normalizeUsername(input.username);
  if (!isValidStudentUsername(username)) {
    throw new Error('Tên đăng nhập chỉ dùng chữ cái, số, dấu _, độ dài 3–30 ký tự.');
  }
  if (!input.password || input.password.length < 6) {
    throw new Error('Mật khẩu học sinh nên có ít nhất 6 ký tự.');
  }
  if (!input.studentId) throw new Error('Chưa chọn học sinh.');
  if (!input.classIds.length) throw new Error('Chưa chọn lớp cho tài khoản học sinh.');

  const accountRef = doc(db, 'studentAccounts', username);
  const existing = await getDoc(accountRef);
  if (existing.exists()) throw new Error(`Tên đăng nhập "${username}" đã tồn tại.`);

  const email = usernameToStudentEmail(username);
  const credential = await createUserWithEmailAndPassword(studentCreatorAuth, email, input.password);
  const uid = credential.user.uid;

  await setDoc(doc(db, 'users', uid), {
    name: input.studentName,
    email,
    role: Role.STUDENT,
    isApproved: true,
    studentId: input.studentId,
    classIds: input.classIds,
    createdAt: serverTimestamp(),
  });

  const payload = {
    username,
    email,
    uid,
    studentId: input.studentId,
    studentName: input.studentName,
    classIds: input.classIds,
    className: input.className || '',
    isActive: true,
    createdBy: input.createdBy || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  await setDoc(accountRef, payload);
  await signOut(studentCreatorAuth).catch(() => undefined);

  return mapStudentAccount(username, payload);
}

export async function loginStudent(username: string, password: string): Promise<AppUser> {
  const uname = normalizeUsername(username);

  if (!isValidStudentUsername(uname)) {
    throw new Error('Tên đăng nhập không hợp lệ.');
  }

  // Quan trọng:
  // Không đọc studentAccounts trước khi đăng nhập.
  // Khi chưa có request.auth, Firestore Rules sẽ từ chối và báo
  // "Missing or insufficient permissions".
  const email = usernameToStudentEmail(uname);
  const cred = await signInWithEmailAndPassword(auth, email, password);

  const profile = await getUserProfile(cred.user.uid);
  if (!profile) {
    await signOut(auth).catch(() => undefined);
    throw new Error('Tài khoản chưa có hồ sơ học sinh. Liên hệ giáo viên.');
  }

  if (profile.role !== Role.STUDENT) {
    await signOut(auth).catch(() => undefined);
    throw new Error('Tài khoản này không phải tài khoản học sinh.');
  }

  if (!profile.isApproved) {
    await signOut(auth).catch(() => undefined);
    throw new Error('Tài khoản đã bị vô hiệu hóa hoặc chưa được duyệt.');
  }

  return profile;
}

export async function getStudentAccount(username: string): Promise<StudentAccount | null> {
  const snap = await getDoc(doc(db, 'studentAccounts', normalizeUsername(username)));
  return snap.exists() ? mapStudentAccount(snap.id, snap.data()) : null;
}

export async function getStudentAccountByStudentId(studentId: string): Promise<StudentAccount | null> {
  const snap = await getDocs(
    query(collection(db, 'studentAccounts'), where('studentId', '==', studentId))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return mapStudentAccount(d.id, d.data());
}

export async function getStudentAccounts(): Promise<StudentAccount[]> {
  const snap = await getDocs(collection(db, 'studentAccounts'));
  return snap.docs
    .map((d) => mapStudentAccount(d.id, d.data()))
    .sort((a, b) => a.studentName.localeCompare(b.studentName));
}

export async function setStudentAccountActive(username: string, active: boolean) {
  const uname = normalizeUsername(username);
  const account = await getStudentAccount(uname);
  if (!account) throw new Error('Không tìm thấy tài khoản học sinh.');

  await updateDoc(doc(db, 'studentAccounts', uname), {
    isActive: active,
    updatedAt: serverTimestamp(),
  });
  if (account.uid) {
    await updateDoc(doc(db, 'users', account.uid), {
      isApproved: active,
    });
  }
}

export async function changeCurrentStudentPassword(currentPassword: string, newPassword: string) {
  const current = auth.currentUser;
  if (!current || !current.email) throw new Error('Chưa đăng nhập.');
  if (!currentPassword) throw new Error('Nhập mật khẩu hiện tại.');
  if (newPassword.length < 6) throw new Error('Mật khẩu mới cần ít nhất 6 ký tự.');
  if (currentPassword === newPassword) throw new Error('Mật khẩu mới phải khác mật khẩu hiện tại.');

  const credential = EmailAuthProvider.credential(current.email, currentPassword);
  await reauthenticateWithCredential(current, credential);
  await updatePassword(current, newPassword);
}
