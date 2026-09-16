import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning';
interface ToastItem {
  id: number;
  msg: string;
  type: ToastType;
}
type ToastFn = (msg: string, type?: ToastType) => void;

const ToastCtx = createContext<ToastFn>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback<ToastFn>((msg, type = 'success') => {
    const id = Date.now() + Math.random();
    setToasts((p) => [...p, { id, msg, type }]);
    setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), 3500);
  }, []);

  const icon = (t: ToastType) => {
    if (t === 'success') return <Check size={16} />;
    if (t === 'error') return <X size={16} />;
    return <AlertTriangle size={16} />;
  };

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span className="toast-icon">{icon(t.type)}</span>
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
