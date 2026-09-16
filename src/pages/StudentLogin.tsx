import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { GraduationCap, Lock, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { loginStudent } from '../services/studentAuthService';
import { Role } from '../types';

export default function StudentLogin() {
  const { user, loading, refresh, loginStudentWithGoogle } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState('');

  if (loading) return <div className="center-screen"><div className="spinner" /></div>;
  if (user?.role === Role.STUDENT) return <Navigate to="/student" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await loginStudent(username, password);
      await refresh();
      window.location.href = '/student';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Đăng nhập thất bại');
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin() {
    setError('');
    setGoogleBusy(true);
    try {
      await loginStudentWithGoogle();
      window.location.href = '/student';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Không đăng nhập được bằng Google';
      if (!/popup-closed|cancelled/i.test(message)) setError(message);
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <div className="login-page student-login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-logo">
          <span className="icon"><GraduationCap size={30} /></span>
          <h1>Cổng học sinh</h1>
          <p>Đăng nhập Gmail hoặc dùng tài khoản giáo viên đã cấp</p>
        </div>

        {error && <div className="login-error">{error}</div>}

        <button
          className="btn-google"
          type="button"
          onClick={googleLogin}
          disabled={googleBusy || busy}
          style={{ width: '100%', marginTop: 16 }}
        >
          {googleBusy ? <><span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} /> Đang liên kết...</> : <><GoogleIcon /> Đăng nhập Gmail học sinh</>}
        </button>
        <p className="page-sub" style={{ marginTop: 10 }}>
          Gmail phải trùng chính xác trường “Email Gmail học sinh” trong hồ sơ do giáo viên khai báo.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '18px 0 10px' }}>
          <span style={{ height: 1, background: 'var(--border)', flex: 1 }} />
          <small style={{ color: 'var(--text-muted)' }}>hoặc tài khoản dự phòng</small>
          <span style={{ height: 1, background: 'var(--border)', flex: 1 }} />
        </div>

        <div className="form-group" style={{ textAlign: 'left' }}>
          <label className="form-label"><User size={14} /> Tên đăng nhập</label>
          <input className="form-control" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="VD: phuc_t8" />
        </div>
        <div className="form-group" style={{ textAlign: 'left' }}>
          <label className="form-label"><Lock size={14} /> Mật khẩu</label>
          <input className="form-control" type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mật khẩu được giáo viên cấp" />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} disabled={busy || googleBusy || !username || !password}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập bằng tên/mật khẩu'}
        </button>
      </form>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
