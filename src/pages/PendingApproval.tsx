import { Clock, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export default function PendingApproval() {
  const { user, logout } = useAuth();

  return (
    <div className="center-screen">
      <div className="info-card">
        <div
          className="info-icon"
          style={{ background: '#fef3c7', color: '#b45309' }}
        >
          <Clock size={30} />
        </div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text)' }}>
          Chờ phê duyệt
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: 6 }}>
          {user?.email || user?.name}
        </p>
        <p
          style={{
            color: 'var(--text)',
            fontSize: '0.9rem',
            lineHeight: 1.6,
            margin: '1.25rem 0',
          }}
        >
          Tài khoản của bạn đã được tạo và đang ở trạng thái{' '}
          <strong>chờ duyệt</strong>. Vui lòng liên hệ Quản trị viên để được cấp
          quyền truy cập.
        </p>
        <button
          className="btn btn-danger"
          style={{ width: '100%' }}
          onClick={logout}
        >
          <LogOut size={16} /> Đăng xuất
        </button>
      </div>
    </div>
  );
}
