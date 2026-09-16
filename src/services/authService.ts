import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db, googleProvider } from '../config/firebase';
import { AppUser, Role } from '../types';

const toDate = (v: unknown): Date | undefined => {
  if (!v) return undefined;
  if (v instanceof Timestamp) return v.toDate();
  if (v instanceof Date) return v;
  return undefined;
};

const mapUser = (id: string, data: Record<string, unknown>): AppUser => ({
  id,
  name: (data.name as string) || '',
  email: data.email as string | undefined,
  avatar: data.avatar as string | undefined,
  role: (data.role as Role) || Role.TEACHER,
  isApproved: (data.isApproved as boolean) ?? false,
  createdAt: toDate(data.createdAt),
  studentId: data.studentId as string | undefined,
  classIds: Array.isArray(data.classIds) ? (data.classIds as string[]) : [],
});

/**
 * Sign in with Google. Tài khoản mới luôn là giáo viên chờ duyệt.
 * Quản trị viên đầu tiên phải được đặt role=ADMIN và isApproved=true
 * một lần trong Firebase Console; ứng dụng không tự cấp quyền admin.
 */
export const signInWithGoogle = async (): Promise<AppUser> => {
  const result = await signInWithPopup(auth, googleProvider);
  const fb = result.user;
  const userRef = doc(db, 'users', fb.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    const email = String(fb.email || '').trim().toLowerCase();
    if (email) {
      const studentMatch = await getDocs(
        query(collection(db, 'students'), where('studentEmail', '==', email)),
      );
      if (!studentMatch.empty) {
        await signOut(auth).catch(() => undefined);
        throw new Error('Email này thuộc hồ sơ học sinh. Hãy đăng nhập tại Cổng học sinh.');
      }
    }
    const newUser = {
      name: fb.displayName || 'Người dùng mới',
      email: fb.email || '',
      avatar: fb.photoURL || '',
      role: Role.TEACHER,
      isApproved: false,
      classIds: [],
      createdAt: serverTimestamp(),
    };
    await setDoc(userRef, newUser);
    return {
      id: fb.uid,
      ...newUser,
      createdAt: new Date(),
    } as AppUser;
  }

  return mapUser(userSnap.id, userSnap.data());
};



/**
 * Học sinh đăng nhập bằng Google và tự liên kết với hồ sơ students có
 * studentEmail trùng chính xác. Không có hồ sơ khớp thì không tạo tài khoản.
 */
export const signInStudentWithGoogle = async (): Promise<AppUser> => {
  const result = await signInWithPopup(auth, googleProvider);
  const fb = result.user;
  const email = String(fb.email || '').trim().toLowerCase();

  try {
    if (!email) throw new Error('Tài khoản Google không cung cấp email.');

    const existingProfile = await getUserProfile(fb.uid);
    if (existingProfile) {
      if (existingProfile.role !== Role.STUDENT) {
        throw new Error('Email này đang được dùng cho tài khoản giáo viên/quản trị.');
      }
      if (!existingProfile.isApproved || !existingProfile.studentId) {
        throw new Error('Tài khoản học sinh chưa được kích hoạt.');
      }

      // Không chỉ tin users/{uid}: mỗi lần đăng nhập đều đối chiếu lại hồ sơ
      // học sinh để việc đổi Gmail hoặc khóa hồ sơ có hiệu lực ngay.
      const linkedStudent = await getDoc(doc(db, 'students', existingProfile.studentId));
      if (!linkedStudent.exists()) {
        throw new Error('Không còn hồ sơ học sinh được liên kết. Hãy liên hệ giáo viên.');
      }
      const linkedData = linkedStudent.data() as Record<string, unknown>;
      const linkedEmail = String(linkedData.studentEmail || '').trim().toLowerCase();
      if (linkedData.status === 'INACTIVE') {
        throw new Error('Hồ sơ học sinh đã ngừng hoạt động.');
      }
      if (!linkedEmail || linkedEmail !== email) {
        throw new Error('Gmail hiện tại không còn trùng hồ sơ học sinh. Hãy liên hệ giáo viên.');
      }
      return existingProfile;
    }

    const studentSnap = await getDocs(
      query(collection(db, 'students'), where('studentEmail', '==', email)),
    );
    if (studentSnap.empty) {
      throw new Error('Gmail này chưa được khai báo trong hồ sơ học sinh. Hãy liên hệ giáo viên.');
    }
    if (studentSnap.size > 1) {
      throw new Error('Gmail đang bị trùng ở nhiều hồ sơ học sinh. Giáo viên cần sửa dữ liệu.');
    }

    const studentDoc = studentSnap.docs[0];
    const studentData = studentDoc.data() as Record<string, unknown>;
    if (studentData.status === 'INACTIVE') {
      throw new Error('Hồ sơ học sinh đã ngừng hoạt động.');
    }

    const newUser = {
      name: String(studentData.fullName || fb.displayName || 'Học sinh'),
      email,
      avatar: fb.photoURL || '',
      role: Role.STUDENT,
      isApproved: true,
      studentId: studentDoc.id,
      classIds: [],
      authProvider: 'google',
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'users', fb.uid), newUser);
    return {
      id: fb.uid,
      ...newUser,
      createdAt: new Date(),
    } as AppUser;
  } catch (error) {
    await signOut(auth).catch(() => undefined);
    throw error;
  }
};

export const signOutUser = () => signOut(auth);

/** Read the app profile for a Firebase user (or null if none exists yet). */
export const getUserProfile = async (uid: string): Promise<AppUser | null> => {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? mapUser(snap.id, snap.data()) : null;
};

export const subscribeToAuth = (cb: (fb: FirebaseUser | null) => void) =>
  onAuthStateChanged(auth, cb);

// ====== ADMIN USER MANAGEMENT ======
export const getAllUsers = async (): Promise<AppUser[]> => {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map((d) => mapUser(d.id, d.data()));
};

export const approveUser = (uid: string) =>
  updateDoc(doc(db, 'users', uid), { isApproved: true });

export const setUserRole = (uid: string, role: Role) =>
  updateDoc(doc(db, 'users', uid), { role });

export const setUserApproval = (uid: string, isApproved: boolean) =>
  updateDoc(doc(db, 'users', uid), { isApproved });

export const deleteUserProfile = (uid: string) =>
  deleteDoc(doc(db, 'users', uid));
