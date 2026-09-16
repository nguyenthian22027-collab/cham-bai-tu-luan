import { initializeApp, getApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

/**
 * Firebase Web config là thông tin nhận diện public của ứng dụng, không phải
 * Firebase Admin private key. Dán nguyên 6 giá trị từ Firebase Console >
 * Project settings > Your apps > SDK setup and configuration vào đây.
 */
const firebaseConfig = {
  apiKey: "AIzaSyD4WmF9ZfZ8peVY7WHJCLANGYqW2XxtEoU",
  authDomain: "cham-bai-tu-luan-59d0e.firebaseapp.com",
  projectId: "cham-bai-tu-luan-59d0e",
  storageBucket: "cham-bai-tu-luan-59d0e.firebasestorage.app",
  messagingSenderId: "533002337439",
  appId: "1:533002337439:web:0a0800405924ac698776aa",
  measurementId: "G-N2E4G0P2P7"
} as const;

const missingFirebaseKeys = Object.entries(firebaseConfig)
  .filter(([, value]) => !value || value.startsWith('PASTE_'))
  .map(([key]) => key);

if (missingFirebaseKeys.length > 0) {
  throw new Error(
    `Chưa hardcode Firebase config trong src/config/firebase.ts: ${missingFirebaseKeys.join(', ')}`,
  );
}

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// App phụ dùng khi giáo viên tạo tài khoản học sinh bằng Email/Password mà
// không làm tài khoản giáo viên hiện tại bị đăng xuất.
const studentCreatorApp = getApps().find((a) => a.name === 'studentCreator') ||
  initializeApp(firebaseConfig, 'studentCreator');

export const auth = getAuth(app);
export const studentCreatorAuth = getAuth(studentCreatorApp);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });
