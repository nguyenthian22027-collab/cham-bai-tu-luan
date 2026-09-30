import { useEffect, useMemo, useState } from 'react';
import { Download, KeyRound, Plus, ShieldCheck, ShieldX, Sparkles, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import { getClasses, getClassRoster, getStudents } from '../services/dataService';
import {
  batchCreateStudentAccounts,
  BatchCreateStudentResult,
  createStudentLoginAccount,
  exportStudentAccountsToExcel,
  getStudentAccounts,
  setStudentAccountActive,
} from '../services/studentAuthService';
import { ClassItem, Role, Student, StudentAccount } from '../types';

interface FormState {
  studentId: string;
  classId: string;
  username: string;
  password: string;
}

export default function StudentAccounts() {
  const { user } = useAuth();
  const toast = useToast();
  const [accounts, setAccounts] = useState<StudentAccount[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<FormState>({ studentId: '', classId: '', username: '', password: '' });
  const [saving, setSaving] = useState(false);

  // Batch states
  const [showBatch, setShowBatch] = useState(false);
  const [batchClassId, setBatchClassId] = useState('');
  const [batchRoster, setBatchRoster] = useState<Student[]>([]);
  const [batchLoadingRoster, setBatchLoadingRoster] = useState(false);
  const [batchPassword, setBatchPassword] = useState('123456');
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
    percent: number;
  } | null>(null);
  const [batchResult, setBatchResult] = useState<BatchCreateStudentResult | null>(null);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function load() {
    if (!user) return;
    setLoading(true);
    try {
      const [acc, stu, cls] = await Promise.all([
        getStudentAccounts(),
        getStudents(),
        getClasses(user),
      ]);
      setAccounts(acc);
      setStudents(stu);
      setClasses(cls);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tải tài khoản học sinh', 'error');
    } finally {
      setLoading(false);
    }
  }

  const existingAccountStudentIds = useMemo(
    () => new Set(accounts.map((a) => a.studentId)),
    [accounts]
  );

  const batchStudentsWithoutAccount = useMemo(
    () => batchRoster.filter((s) => !existingAccountStudentIds.has(s.id)),
    [batchRoster, existingAccountStudentIds]
  );

  async function handleBatchClassChange(classId: string) {
    setBatchClassId(classId);
    setBatchResult(null);
    setBatchProgress(null);
    if (!classId) {
      setBatchRoster([]);
      return;
    }
    setBatchLoadingRoster(true);
    try {
      const r = await getClassRoster(classId);
      setBatchRoster(r);
    } catch {
      toast('Lỗi tải danh sách học sinh của lớp', 'error');
    } finally {
      setBatchLoadingRoster(false);
    }
  }

  async function runBatchCreate() {
    if (!batchClassId) {
      toast('Vui lòng chọn lớp học', 'warning');
      return;
    }
    if (batchStudentsWithoutAccount.length === 0) {
      toast('Tất cả học sinh trong lớp này đã có tài khoản!', 'warning');
      return;
    }
    if (!batchPassword || batchPassword.length < 6) {
      toast('Mật khẩu cần tối thiểu 6 ký tự', 'warning');
      return;
    }

    const cls = classes.find((c) => c.id === batchClassId);
    const className = cls?.className || 'Lop';

    setBatchRunning(true);
    setBatchProgress(null);
    setBatchResult(null);

    try {
      const res = await batchCreateStudentAccounts({
        students: batchStudentsWithoutAccount,
        classId: batchClassId,
        className,
        defaultPassword: batchPassword,
        createdBy: user?.id,
        onProgress: (p) => setBatchProgress(p),
      });

      setBatchResult(res);

      if (res.success.length > 0) {
        toast(`Đã tạo thành công ${res.success.length} tài khoản cho lớp ${className}`, 'success');
        // Tự động tải file Excel
        exportStudentAccountsToExcel(
          res.success.map((item) => ({
            studentName: item.studentName,
            className: item.className,
            username: item.username,
            password: item.password,
            status: 'Đã kích hoạt',
          })),
          `tai_khoan_${className.replace(/\s+/g, '_')}.xlsx`
        );
      } else if (res.errors.length > 0) {
        toast('Có lỗi trong quá trình tạo tài khoản', 'error');
      }

      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi tạo tài khoản hàng loạt', 'error');
    } finally {
      setBatchRunning(false);
    }
  }

  function exportFilteredAccounts() {
    if (filtered.length === 0) {
      toast('Không có tài khoản nào để xuất', 'warning');
      return;
    }
    exportStudentAccountsToExcel(
      filtered.map((a) => ({
        studentName: a.studentName,
        className: a.className,
        username: a.username,
        password: 'Đã kích hoạt',
        status: a.isActive ? 'Đang hoạt động' : 'Đã khóa',
      })),
      `danh_sach_tai_khoan_hoc_sinh.xlsx`
    );
    toast('Đã xuất file Excel danh sách tài khoản', 'success');
  }

  const filtered = accounts.filter((a) =>
    a.username.includes(q.toLowerCase()) ||
    a.studentName.toLowerCase().includes(q.toLowerCase()) ||
    (a.className || '').toLowerCase().includes(q.toLowerCase())
  );

  const selectedStudent = useMemo(() => students.find((s) => s.id === form.studentId), [students, form.studentId]);
  const selectedClass = useMemo(() => classes.find((c) => c.id === form.classId), [classes, form.classId]);

  function suggestUsername(s: Student) {
    const noTone = s.fullName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
    const parts = noTone.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/);
    const last = parts[parts.length - 1] || 'hs';
    const firstLetters = parts.slice(0, -1).map((p) => p[0]).join('');
    return `${last}${firstLetters}_${Date.now().toString().slice(-4)}`;
  }

  async function save() {
    if (!user || !selectedStudent || !selectedClass) {
      toast('Chọn học sinh và lớp', 'warning');
      return;
    }
    setSaving(true);
    try {
      await createStudentLoginAccount({
        username: form.username,
        password: form.password,
        studentId: selectedStudent.id,
        studentName: selectedStudent.fullName,
        classIds: [selectedClass.id],
        className: selectedClass.className,
        createdBy: user.id,
      });
      toast('Đã tạo tài khoản học sinh');
      setShow(false);
      setForm({ studentId: '', classId: '', username: '', password: '' });
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tạo tài khoản', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggle(a: StudentAccount) {
    if (!window.confirm(`${a.isActive ? 'Vô hiệu hóa' : 'Kích hoạt'} tài khoản ${a.username}?`)) return;
    try {
      await setStudentAccountActive(a.username, !a.isActive);
      toast('Đã cập nhật trạng thái tài khoản');
      load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi cập nhật', 'error');
    }
  }

  if (loading) return <div className="loading-state"><div className="spinner" /><span>Đang tải...</span></div>;

  return (
    <div className="fade-up assignment-page">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 className="page-title"><KeyRound size={26} /> <span>Tài khoản học sinh</span></h1>
          <p className="page-sub">Cấp tài khoản đăng nhập làm bài cho học sinh chưa có Gmail</p>
        </div>
        {(user?.role === Role.ADMIN || user?.role === Role.TEACHER) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn-secondary"
              onClick={exportFilteredAccounts}
              disabled={filtered.length === 0}
              title="Xuất file Excel danh sách tài khoản hiện tại"
            >
              <Download size={16} /> Xuất Excel
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShow(true)}
            >
              <Plus size={16} /> Tạo tài khoản lẻ
            </button>
            <button
              className="btn btn-primary"
              style={{
                background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                color: '#fff',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(99, 102, 241, 0.35)',
              }}
              onClick={() => {
                setShowBatch(true);
                setBatchResult(null);
                setBatchProgress(null);
              }}
            >
              <Zap size={16} /> Tạo tài khoản cả lớp
            </button>
          </div>
        )}
      </div>

      <div className="filter-bar">
        <input className="search-box" placeholder="Tìm học sinh, username, lớp..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <h3>Chưa có tài khoản học sinh</h3>
            <p>Nhấn "Tạo tài khoản cả lớp" để cấp hàng loạt và xuất file Excel gửi học sinh/phụ huynh.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Học sinh</th><th>Username</th><th>Lớp</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id}>
                    <td><strong>{a.studentName}</strong><div className="student-subline">Mã HS: {a.studentId.slice(0, 8)}</div></td>
                    <td><code>{a.username}</code></td>
                    <td>{a.className || a.classIds.join(', ')}</td>
                    <td><span className={`badge ${a.isActive ? 'badge-success' : 'badge-danger'}`}>{a.isActive ? 'Đang hoạt động' : 'Đã khóa'}</span></td>
                    <td>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggle(a)}>
                        {a.isActive ? <ShieldX size={14} /> : <ShieldCheck size={14} />} {a.isActive ? 'Khóa' : 'Mở'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Tạo tài khoản lẻ */}
      <Modal open={show} onClose={() => setShow(false)} title="Tạo tài khoản học sinh lẻ" footer={<><button className="btn btn-ghost" onClick={() => setShow(false)}>Hủy</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Đang tạo...' : 'Tạo tài khoản'}</button></>}>
        <div className="form-group">
          <label className="form-label">Học sinh</label>
          <select className="form-select" value={form.studentId} onChange={(e) => {
            const s = students.find((x) => x.id === e.target.value);
            setForm((f) => ({ ...f, studentId: e.target.value, username: s ? suggestUsername(s) : f.username }));
          }}>
            <option value="">-- Chọn học sinh --</option>
            {students.map((s) => <option key={s.id} value={s.id}>{s.fullName} {s.studentClass ? `(${s.studentClass})` : ''}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Lớp đăng nhập/làm bài</label>
          <select className="form-select" value={form.classId} onChange={(e) => setForm((f) => ({ ...f, classId: e.target.value }))}>
            <option value="">-- Chọn lớp --</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.className}</option>)}
          </select>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tên đăng nhập</label>
            <input className="form-control" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="form-label">Mật khẩu ban đầu</label>
            <input className="form-control" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="Tối thiểu 6 ký tự" />
          </div>
        </div>
        <div className="payment-warning" style={{ margin: 0 }}>
          Học sinh đăng nhập tại <strong>/student-login</strong>. Hãy gửi username và mật khẩu cho học sinh sau khi tạo.
        </div>
      </Modal>

      {/* Modal Tạo tài khoản hàng loạt cho cả lớp */}
      <Modal
        open={showBatch}
        onClose={() => !batchRunning && setShowBatch(false)}
        title="⚡ Tạo tài khoản tự động cho cả lớp"
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setShowBatch(false)}
              disabled={batchRunning}
            >
              Đóng
            </button>
            <button
              className="btn btn-primary"
              onClick={runBatchCreate}
              disabled={batchRunning || !batchClassId || batchStudentsWithoutAccount.length === 0}
            >
              {batchRunning ? (
                <>Đang tạo ({batchProgress?.percent || 0}%)...</>
              ) : (
                `Tạo tài khoản (${batchStudentsWithoutAccount.length} em)`
              )}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">Chọn lớp học cần cấp tài khoản</label>
          <select
            className="form-select"
            value={batchClassId}
            disabled={batchRunning}
            onChange={(e) => handleBatchClassChange(e.target.value)}
          >
            <option value="">-- Chọn lớp học --</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.className}
              </option>
            ))}
          </select>
        </div>

        {batchLoadingRoster && (
          <div style={{ padding: 12, textAlign: 'center', color: 'var(--text-muted)' }}>
            <div className="spinner" style={{ margin: '0 auto 8px', width: 20, height: 20 }} />
            Đang kiểm tra danh sách học sinh của lớp...
          </div>
        )}

        {batchClassId && !batchLoadingRoster && (
          <div
            style={{
              padding: 12,
              background: 'var(--bg-muted, #f8fafc)',
              borderRadius: 'var(--radius-sm)',
              marginBottom: 16,
              border: '1px solid var(--border)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span>Tổng học sinh trong lớp:</span>
              <strong>{batchRoster.length} em</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#10b981' }}>
              <span>Đã có tài khoản:</span>
              <strong>{batchRoster.length - batchStudentsWithoutAccount.length} em</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6366f1', fontWeight: 600 }}>
              <span>Chưa có tài khoản (cần tạo):</span>
              <strong>{batchStudentsWithoutAccount.length} em</strong>
            </div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Mật khẩu ban đầu mặc định cho học sinh</label>
          <input
            className="form-control"
            value={batchPassword}
            disabled={batchRunning}
            onChange={(e) => setBatchPassword(e.target.value)}
            placeholder="Ví dụ: 123456"
          />
          <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
            Hệ thống sẽ tự động đặt mật khẩu này cho các em. Học sinh có thể đổi mật khẩu sau khi đăng nhập.
          </small>
        </div>

        {batchRunning && batchProgress && (
          <div style={{ margin: '16px 0', padding: 12, background: 'rgba(99, 102, 241, 0.08)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.875rem' }}>
              <span>Đang tạo cho: <strong>{batchProgress.currentName}</strong></span>
              <span>{batchProgress.current}/{batchProgress.total} ({batchProgress.percent}%)</span>
            </div>
            <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${batchProgress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                  transition: 'width 0.2s',
                }}
              />
            </div>
          </div>
        )}

        {batchResult && (
          <div style={{ margin: '14px 0', padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <strong style={{ color: '#166534', display: 'block', marginBottom: 6 }}>
              ✓ Đã tạo thành công {batchResult.success.length} tài khoản!
            </strong>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#15803d' }}>
              File Excel danh sách tài khoản đã được tự động tải về máy của bạn.
            </p>
            {batchResult.success.length > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => {
                  const cls = classes.find((c) => c.id === batchClassId);
                  exportStudentAccountsToExcel(
                    batchResult.success.map((item) => ({
                      studentName: item.studentName,
                      className: item.className,
                      username: item.username,
                      password: item.password,
                      status: 'Đã kích hoạt',
                    })),
                    `tai_khoan_${(cls?.className || 'lop').replace(/\s+/g, '_')}.xlsx`
                  );
                }}
              >
                <Download size={14} /> Tải lại file Excel
              </button>
            )}
          </div>
        )}

        <div className="payment-warning" style={{ margin: 0 }}>
          💡 <strong>Quy tắc sinh Username tự động</strong>: Tên học sinh không dấu + mã lớp (Ví dụ: <code>annv_11a1</code>). Nếu trùng tên, hệ thống tự động đánh số 1, 2, 3...
        </div>
      </Modal>
    </div>
  );
}

