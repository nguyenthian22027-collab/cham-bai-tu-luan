import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { AppUser } from '../types';
import {
  signInWithGoogle,
  signInStudentWithGoogle,
  signOutUser,
  getUserProfile,
  subscribeToAuth,
} from '../services/authService';

interface AuthCtx {
  user: AppUser | null;
  loading: boolean;
  login: () => Promise<AppUser>;
  loginStudentWithGoogle: () => Promise<AppUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeToAuth(async (fb) => {
      if (fb) {
        const profile = await getUserProfile(fb.uid);
        setUser(profile);
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const login = async () => {
    const u = await signInWithGoogle();
    setUser(u);
    return u;
  };

  const loginStudentWithGoogle = async () => {
    const student = await signInStudentWithGoogle();
    setUser(student);
    return student;
  };

  const logout = async () => {
    await signOutUser();
    setUser(null);
  };

  const refresh = async () => {
    if (user) setUser(await getUserProfile(user.id));
  };

  return (
    <Ctx.Provider value={{ user, loading, login, loginStudentWithGoogle, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
