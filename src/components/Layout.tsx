import { ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BookOpenCheck,
  GraduationCap,
  KeyRound,
  Link2,
  LogOut,
  Menu,
  School,
  UserCog,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Role, ROLE_LABEL } from '../types';

interface NavLink {
  icon: ReactNode;
  label: string;
  path: string;
}

const iconProps = { size: 18 };

const NAV: Record<Role, NavLink[]> = {
  [Role.ADMIN]: [
    { icon: <BookOpenCheck {...iconProps} />, label: 'Bài tự luận & chấm bài', path: '/assignments' },
    { icon: <School {...iconProps} />, label: 'Lớp học', path: '/classes' },
    { icon: <Users {...iconProps} />, label: 'Học sinh', path: '/students' },
    { icon: <KeyRound {...iconProps} />, label: 'Tài khoản học sinh', path: '/student-accounts' },
    { icon: <Link2 {...iconProps} />, label: 'Kết nối Zalo', path: '/zalo-connection' },
    { icon: <UserCog {...iconProps} />, label: 'Người dùng', path: '/users' },
  ],
  [Role.TEACHER]: [
    { icon: <BookOpenCheck {...iconProps} />, label: 'Bài tự luận & chấm bài', path: '/assignments' },
    { icon: <School {...iconProps} />, label: 'Lớp của tôi', path: '/classes' },
    { icon: <Users {...iconProps} />, label: 'Học sinh & Gmail', path: '/students' },
    { icon: <KeyRound {...iconProps} />, label: 'Tài khoản dự phòng', path: '/student-accounts' },
  ],
  [Role.TA]: [
    { icon: <BookOpenCheck {...iconProps} />, label: 'Bài tự luận & chấm bài', path: '/assignments' },
    { icon: <School {...iconProps} />, label: 'Lớp của tôi', path: '/classes' },
  ],
  [Role.STUDENT]: [],
};

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const items = NAV[user.role] || [];

  return (
    <div className="app-layout">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <h2><GraduationCap size={22} /> Chấm bài tự luận</h2>
          <p>AI gợi ý · Giáo viên xác nhận · Gửi Zalo</p>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Chức năng</div>
          {items.map((item) => (
            <button
              key={item.path}
              className={`nav-item ${location.pathname === item.path || location.pathname.startsWith(`${item.path}/`) ? 'active' : ''}`}
              onClick={() => { navigate(item.path); setOpen(false); }}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-card">
            <div className="user-avatar">
              {user.avatar ? <img src={user.avatar} alt="" /> : (user.name || 'U')[0].toUpperCase()}
            </div>
            <div className="user-card-info">
              <div className="user-card-name">{user.name}</div>
              <div className="user-card-role">{ROLE_LABEL[user.role]}</div>
            </div>
          </div>
          <button className="btn-logout" onClick={logout}><LogOut size={16} /> Đăng xuất</button>
        </div>
      </aside>

      <div className={`sidebar-overlay ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <main className="main-content">
        <div className="mobile-header">
          <button className="menu-btn" onClick={() => setOpen(true)}><Menu size={22} /></button>
          <span className="mobile-title"><GraduationCap size={18} /> Chấm tự luận</span>
          <div style={{ width: 22 }} />
        </div>
        {children}
      </main>
    </div>
  );
}
