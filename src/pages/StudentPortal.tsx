import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, KeyRound, LogOut, RefreshCcw, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { signOutUser } from '../services/authService';
import { auth } from '../config/firebase';
import { getAssignment, getStudentAssignmentTargets } from '../services/assignmentService';
import { changeCurrentStudentPassword } from '../services/studentAuthService';
import { Assignment, AssignmentTarget, Role } from '../types';

interface Row { target: AssignmentTarget; assignment: Assignment | null }

export default function StudentPortal() {
  const { user } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const canChangePassword = Boolean(auth.currentUser?.providerData.some((provider) => provider.providerId === 'password'));

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.studentId]);

  async function load() {
    if (!user?.studentId) return;
    setLoading(true);
    try {
      const targets = await getStudentAssignmentTargets(user.studentId);
      const loaded = await Promise.all(targets.map(async (t) => ({ target: t, assignment: await getAssignment(t.assignmentId) })));
      setRows(loaded.filter((r) => r.assignment?.status === 'published' || r.target.status !== 'assigned'));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tải bài học sinh', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await signOutUser();
    window.location.href = '/student-login';
  }

  function closePasswordModal() {
    setPasswordOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswords(false);
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast('Mật khẩu xác nhận không khớp', 'warning');
      return;
    }
    setChangingPassword(true);
    try {
      await changeCurrentStudentPassword(currentPassword, newPassword);
      toast('Đã đổi mật khẩu thành công');
      closePasswordModal();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Không đổi được mật khẩu';
      if (/invalid-credential|wrong-password|credential/i.test(message)) {
        toast('Mật khẩu hiện tại không đúng', 'error');
      } else {
        toast(message, 'error');
      }
    } finally {
      setChangingPassword(false);
    }
  }

  if (!user || user.role !== Role.STUDENT) return null;
  if (loading) return <div className="center-screen"><div className="spinner" /></div>;

  return (
    <div className="student-portal-page">
      <div className="student-topbar">
        <div><strong>{user.name}</strong><span>Cổng học sinh</span></div>
        <div className="student-topbar-actions">
          {canChangePassword && <button className="btn btn-ghost btn-sm" onClick={() => setPasswordOpen(true)}><KeyRound size={14} /> Đổi mật khẩu</button>}
          <button className="btn btn-ghost btn-sm" onClick={logout}><LogOut size={14} /> Đăng xuất</button>
        </div>
      </div>
      <main className="student-main fade-up">
        <div className="page-header">
          <div>
            <h1 className="page-title"><BookOpen size={26} /> <span>Bài được giao</span></h1>
            <p className="page-sub">Nộp bài tự luận bằng văn bản hoặc ảnh. Kết quả chỉ có sau khi giáo viên xác nhận.</p>
          </div>
          <button className="btn btn-ghost" onClick={load}><RefreshCcw size={16} /> Tải lại</button>
        </div>

        {rows.length === 0 ? (
          <div className="card"><div className="empty-state"><h3>Chưa có bài nào được giao</h3><p>Hãy kiểm tra lại sau hoặc liên hệ giáo viên.</p></div></div>
        ) : (
          <div className="student-assignment-grid">
            {rows.map(({ target, assignment }) => assignment && (
              <div className="card student-assignment-card" key={target.id}>
                <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <span>{assignment.title}</span>
                  <span className="badge" style={{ background: 'rgba(255,255,255,.25)', color: '#fff' }}>Bài tự luận</span>
                </div>
                <div className="card-body">
                  <p style={{ color: 'var(--text-muted)', minHeight: 34 }}>{assignment.description || 'Không có dặn dò.'}</p>
                  <div className="student-assignment-meta">
                    <div><span>Lớp</span><strong>{assignment.className}</strong></div>
                    <div><span>Trạng thái</span><StatusBadge status={target.status} /></div>
                    <div><span>Hạn nộp</span><strong>{assignment.closesAt ? assignment.closesAt.toLocaleString('vi-VN') : 'Không hạn'}</strong></div>
                    <div><span>Điểm</span><strong>{target.finalScore !== undefined ? `${target.finalScore}/${target.maxScore}` : target.autoScore !== undefined ? `${target.autoScore}/${target.maxScore || ''}` : '—'}</strong></div>
                  </div>
                  {target.status === 'submitted' || target.status === 'graded' ? (
                    <div className={`student-review-status ${assignment.resultVisibility === 'full_review' ? 'open' : 'locked'}`}>
                      {assignment.resultVisibility === 'full_review' ? <Eye size={15} /> : <EyeOff size={15} />}
                      {assignment.resultVisibility === 'full_review' ? 'Giáo viên đã cho xem đáp án' : 'Đáp án đang được giáo viên ẩn'}
                    </div>
                  ) : null}
                  <button className="btn btn-primary" style={{ width: '100%', marginTop: 14 }} onClick={() => nav(`/student/assignment/${assignment.id}`)}>
                    {target.status === 'graded' || target.status === 'submitted'
                      ? assignment.resultVisibility === 'full_review' ? 'Xem chi tiết bài làm' : 'Xem kết quả'
                      : 'Vào làm bài'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {canChangePassword && passwordOpen && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && closePasswordModal()}>
          <form className="modal student-password-modal" onSubmit={changePassword}>
            <div className="modal-header">
              <h3><KeyRound size={18} /> Đổi mật khẩu đăng nhập</h3>
              <button type="button" className="modal-close" onClick={closePasswordModal}><X size={19} /></button>
            </div>
            <div className="modal-body">
              <div className="password-security-note">Mật khẩu hiện tại được xác thực lại trước khi đổi để bảo vệ tài khoản.</div>
              <PasswordField label="Mật khẩu hiện tại" value={currentPassword} onChange={setCurrentPassword} visible={showPasswords} autoComplete="current-password" />
              <PasswordField label="Mật khẩu mới" value={newPassword} onChange={setNewPassword} visible={showPasswords} autoComplete="new-password" />
              <PasswordField label="Nhập lại mật khẩu mới" value={confirmPassword} onChange={setConfirmPassword} visible={showPasswords} autoComplete="new-password" />
              <label className="radio-line"><input type="checkbox" checked={showPasswords} onChange={(e) => setShowPasswords(e.target.checked)} /> Hiện mật khẩu</label>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={closePasswordModal}>Hủy</button>
              <button className="btn btn-primary" disabled={changingPassword || !currentPassword || newPassword.length < 6 || !confirmPassword}>
                {changingPassword ? 'Đang đổi...' : 'Đổi mật khẩu'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PasswordField({ label, value, onChange, visible, autoComplete }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  autoComplete: string;
}) {
  return (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input
        className="form-control"
        type={visible ? 'text' : 'password'}
        value={value}
        minLength={6}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        required
      />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    assigned: { cls: 'badge-warning', label: 'Chưa làm' },
    in_progress: { cls: 'badge-info', label: 'Đang làm' },
    submitted: { cls: 'badge-warning', label: 'Đã nộp' },
    graded: { cls: 'badge-success', label: 'Đã chấm' },
  };
  const m = map[status] || { cls: 'badge-info', label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
