import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, ShieldCheck, ShieldX } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Modal from '../components/Modal';
import { getClasses, getStudents } from '../services/dataService';
import { createStudentLoginAccount, getStudentAccounts, setStudentAccountActive } from '../services/studentAuthService';
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
      <div className="page-header">
        <div>
          <h1 className="page-title"><KeyRound size={26} /> <span>Tài khoản học sinh</span></h1>
          <p className="page-sub">Tạo tài khoản để học sinh đăng nhập làm bài</p>
        </div>
        {(user?.role === Role.ADMIN || user?.role === Role.TEACHER) && (
          <button className="btn btn-primary" onClick={() => setShow(true)}><Plus size={16} /> Tạo tài khoản</button>
        )}
      </div>

      <div className="filter-bar">
        <input className="search-box" placeholder="Tìm học sinh, username, lớp..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card">
        {filtered.length === 0 ? <div className="empty-state"><h3>Chưa có tài khoản học sinh</h3><p>Nhấn tạo tài khoản để cấp quyền đăng nhập cho học sinh.</p></div> : (
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

      <Modal open={show} onClose={() => setShow(false)} title="Tạo tài khoản học sinh" footer={<><button className="btn btn-ghost" onClick={() => setShow(false)}>Hủy</button><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Đang tạo...' : 'Tạo tài khoản'}</button></>}>
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
    </div>
  );
}
