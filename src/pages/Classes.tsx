import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import {
  School,
  Users,
  GraduationCap,
  Pencil,
  Calendar,
  Tag,
  BookOpen,
  Upload,
  FileDown,
  Trash2,
  Download,
  KeyRound,
  Zap,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  getClasses,
  getStudents,
  getClassRoster,
  getClassTeachers,
  addClass,
  updateClass,
  enrollStudent,
  removeEnrollment,
  removeEnrollments,
  importStudents,
  assignTeacher,
  removeTeacherFromClass,
  fmtDate,
} from '../services/dataService';
import { getAllUsers } from '../services/authService';
import {
  batchCreateStudentAccounts,
  BatchCreateStudentResult,
  exportStudentAccountsToExcel,
  getStudentAccounts,
} from '../services/studentAuthService';
import { AppUser, ClassItem, Role, Status, Student, StudentAccount } from '../types';
import Modal from '../components/Modal';

interface ClassForm {
  className: string;
  subject: string;
  grade: string;
  startDate: string;
  status: Status;
}

const EMPTY_FORM: ClassForm = {
  className: '',
  subject: '',
  grade: '',
  startDate: '',
  status: 'ACTIVE',
};

const TEMPLATE_HEADERS = [
  'Họ tên học sinh *',
  'Lớp hành chính',
  'Tên phụ huynh',
  'SĐT phụ huynh',
  'Email phụ huynh',
  'Ghi chú',
  'Trạng thái',
];

const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');

const cellText = (v: unknown) => String(v ?? '').trim();

function getCell(row: Record<string, unknown>, aliases: string[]) {
  const map = new Map<string, unknown>();
  Object.entries(row).forEach(([key, value]) => map.set(normalizeHeader(key), value));

  for (const alias of aliases) {
    const value = map.get(normalizeHeader(alias));
    if (value !== undefined) return cellText(value);
  }

  return '';
}

function parseStatus(value: string): Status {
  const v = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (v.includes('nghi') || v.includes('inactive') || v.includes('off')) return 'INACTIVE';
  return 'ACTIVE';
}

async function parseStudentExcel(file: File) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('File Excel không có sheet dữ liệu');

  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return rawRows
    .filter((row) => Object.values(row).some((v) => cellText(v)))
    .map((row) => ({
      fullName: getCell(row, ['Họ tên học sinh *', 'Họ tên học sinh', 'fullName', 'Tên học sinh']),
      studentClass: getCell(row, ['Lớp hành chính', 'Lớp', 'studentClass']),
      parentName: getCell(row, ['Tên phụ huynh', 'Phụ huynh', 'parentName']),
      parentPhone: getCell(row, ['SĐT phụ huynh', 'Số điện thoại phụ huynh', 'Điện thoại', 'parentPhone']),
      parentEmail: getCell(row, ['Email phụ huynh', 'Email', 'parentEmail']),
      note: getCell(row, ['Ghi chú', 'note']),
      status: parseStatus(getCell(row, ['Trạng thái', 'status'])),
    }));
}

function downloadStudentTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ['Nguyễn Văn A', '8A', 'Nguyễn Văn B', '0901234567', 'phuhuynh1@gmail.com', 'Học thử', 'ACTIVE'],
    ['Trần Thị C', '8A', 'Trần Văn D', '0912345678', 'phuhuynh2@gmail.com', '', 'ACTIVE'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 28 },
    { wch: 24 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HocSinh');
  XLSX.writeFile(wb, 'mau_import_hoc_sinh.xlsx');
}

export default function Classes() {
  const { user } = useAuth();
  const toast = useToast();
  const rosterFileInputRef = useRef<HTMLInputElement | null>(null);
  const isAdmin = user?.role === Role.ADMIN;
  const canManage = isAdmin || user?.role === Role.TEACHER;

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [teachers, setTeachers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ClassItem | null>(null);
  const [form, setForm] = useState<ClassForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [detail, setDetail] = useState<ClassItem | null>(null);
  const [detailTab, setDetailTab] = useState<'roster' | 'teachers'>('roster');
  const [roster, setRoster] = useState<Student[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [selectedRosterIds, setSelectedRosterIds] = useState<Set<string>>(new Set());
  const [importingRoster, setImportingRoster] = useState(false);
  const [assignedTeachers, setAssignedTeachers] = useState<AppUser[]>([]);

  const [enrollStudentId, setEnrollStudentId] = useState('');
  const [enrolling, setEnrolling] = useState(false);
  const [assignTeacherId, setAssignTeacherId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [q, setQ] = useState('');

  // Batch accounts for current class
  const [showClassAccountModal, setShowClassAccountModal] = useState(false);
  const [classBatchPassword, setClassBatchPassword] = useState('123456');
  const [classBatchRunning, setClassBatchRunning] = useState(false);
  const [classBatchProgress, setClassBatchProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
    percent: number;
  } | null>(null);
  const [classExistingAccountIds, setClassExistingAccountIds] = useState<Set<string>>(new Set());
  const [classBatchResult, setClassBatchResult] = useState<BatchCreateStudentResult | null>(null);

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAll() {
    if (!user) return;
    try {
      const [cls, stu, allUsers] = await Promise.all([
        getClasses(user),
        isAdmin || user.role === Role.TEACHER
          ? getStudents()
          : Promise.resolve([]),
        isAdmin ? getAllUsers() : Promise.resolve([]),
      ]);
      setClasses(cls);
      setStudents(stu);
      setTeachers(
        allUsers.filter(
          (u) => (u.role === Role.TEACHER || u.role === Role.TA) && u.isApproved
        )
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tải', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(cls: ClassItem) {
    setDetail(cls);
    setDetailTab('roster');
    setSelectedRosterIds(new Set());
    setRosterLoading(true);
    try {
      const r = await getClassRoster(cls.id);
      setRoster(r);
      if (isAdmin) setAssignedTeachers(await getClassTeachers(cls.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi', 'error');
    } finally {
      setRosterLoading(false);
    }
  }

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(cls: ClassItem, e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(cls);
    setForm({
      className: cls.className,
      subject: cls.subject,
      grade: cls.grade,
      startDate: cls.startDate,
      status: cls.status,
    });
    setShowForm(true);
  }

  async function saveClass() {
    if (!form.className.trim()) {
      toast('Vui lòng nhập tên lớp', 'warning');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        className: form.className,
        subject: form.subject,
        grade: form.grade,
        feePerSession: 0,
        startDate: form.startDate,
        status: form.status,
      };
      if (editing) {
        await updateClass(editing.id, payload);
        toast('Đã cập nhật lớp học');
      } else {
        await addClass(payload);
        toast('Đã tạo lớp học mới');
      }
      setShowForm(false);
      loadAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi lưu', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function doEnroll() {
    if (!enrollStudentId || !detail) {
      toast('Chọn học sinh cần thêm', 'warning');
      return;
    }
    setEnrolling(true);
    try {
      await enrollStudent(enrollStudentId, detail.id);
      toast('Đã thêm học sinh vào lớp');
      setEnrollStudentId('');
      setRoster(await getClassRoster(detail.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi', 'error');
    } finally {
      setEnrolling(false);
    }
  }

  async function doRemoveStudent(studentId: string) {
    if (!detail || !window.confirm('Xóa học sinh khỏi lớp? Học sinh vẫn còn trong danh sách học sinh.')) return;
    try {
      await removeEnrollment(studentId, detail.id);
      toast('Đã xóa học sinh khỏi lớp');
      setRoster((r) => r.filter((s) => s.id !== studentId));
      setSelectedRosterIds((prev) => {
        const next = new Set(prev);
        next.delete(studentId);
        return next;
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi', 'error');
    }
  }

  async function doRemoveSelectedStudentsFromClass() {
    if (!detail) return;
    const ids = [...selectedRosterIds];
    if (ids.length === 0) {
      toast('Chưa chọn học sinh nào', 'warning');
      return;
    }

    if (
      !window.confirm(
        `Xóa ${ids.length} học sinh đã chọn khỏi lớp "${detail.className}"? Học sinh vẫn còn trong danh sách học sinh chung.`
      )
    )
      return;

    try {
      await removeEnrollments(ids, detail.id);
      toast(`Đã xóa ${ids.length} học sinh khỏi lớp`);
      setRoster((r) => r.filter((s) => !selectedRosterIds.has(s.id)));
      setSelectedRosterIds(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi xóa nhiều học sinh khỏi lớp', 'error');
    }
  }

  async function doImportStudentsToClass(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !detail) return;

    setImportingRoster(true);
    try {
      const rows = await parseStudentExcel(file);
      if (rows.length === 0) {
        toast('File Excel không có dữ liệu học sinh', 'warning');
        return;
      }

      const result = await importStudents(rows, detail.id);
      const [newRoster, allStudents] = await Promise.all([
        getClassRoster(detail.id),
        getStudents(),
      ]);

      setRoster(newRoster);
      setStudents(allStudents);

      toast(
        `Import vào lớp xong: tạo mới ${result.created}, đã có sẵn ${result.existed}, đã xếp lớp ${result.enrolled}, bỏ qua ${result.skipped}`,
        result.errors.length ? 'warning' : 'success'
      );

      if (result.errors.length) {
        console.warn('Import học sinh vào lớp có cảnh báo:', result.errors);
      }

      // Nếu có học sinh mới, gợi ý mở modal cấp tài khoản ngay
      if (result.created > 0 || result.enrolled > 0) {
        setTimeout(() => {
          handleOpenClassAccountModal();
        }, 400);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi import Excel', 'error');
    } finally {
      setImportingRoster(false);
    }
  }

  async function handleOpenClassAccountModal() {
    if (!detail) return;
    setShowClassAccountModal(true);
    setClassBatchProgress(null);
    setClassBatchResult(null);
    try {
      const allAccs = await getStudentAccounts();
      setClassExistingAccountIds(new Set(allAccs.map((a) => a.studentId)));
    } catch {
      // ignore
    }
  }

  async function handleExportClassAccounts() {
    if (!detail) return;
    try {
      const allAccs = await getStudentAccounts();
      const rosterIds = new Set(roster.map((s) => s.id));
      const classAccs = allAccs.filter((a) => rosterIds.has(a.studentId));

      if (classAccs.length === 0) {
        toast(`Lớp "${detail.className}" chưa có tài khoản nào. Hãy bấm "Cấp tài khoản lớp" trước.`, 'warning');
        return;
      }

      exportStudentAccountsToExcel(
        classAccs.map((a) => ({
          studentName: a.studentName,
          className: detail.className,
          username: a.username,
          password: 'Đã kích hoạt',
          status: a.isActive ? 'Đang hoạt động' : 'Đã khóa',
        })),
        `tai_khoan_lop_${detail.className.replace(/\s+/g, '_')}.xlsx`
      );
      toast(`Đã xuất danh sách ${classAccs.length} tài khoản của lớp ${detail.className}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi xuất file Excel', 'error');
    }
  }

  async function runClassBatchCreate() {
    if (!detail) return;
    const studentsWithoutAccount = roster.filter((s) => !classExistingAccountIds.has(s.id));
    if (studentsWithoutAccount.length === 0) {
      toast('Tất cả học sinh trong lớp này đã có tài khoản!', 'warning');
      return;
    }
    if (!classBatchPassword || classBatchPassword.length < 6) {
      toast('Mật khẩu cần tối thiểu 6 ký tự', 'warning');
      return;
    }

    setClassBatchRunning(true);
    setClassBatchProgress(null);
    setClassBatchResult(null);

    try {
      const res = await batchCreateStudentAccounts({
        students: studentsWithoutAccount,
        classId: detail.id,
        className: detail.className,
        defaultPassword: classBatchPassword,
        createdBy: user?.id,
        onProgress: (p) => setClassBatchProgress(p),
      });

      setClassBatchResult(res);

      if (res.success.length > 0) {
        toast(`Đã tạo thành công ${res.success.length} tài khoản cho lớp ${detail.className}`, 'success');
        exportStudentAccountsToExcel(
          res.success.map((item) => ({
            studentName: item.studentName,
            className: item.className,
            username: item.username,
            password: item.password,
            status: 'Đã kích hoạt',
          })),
          `tai_khoan_lop_${detail.className.replace(/\s+/g, '_')}.xlsx`
        );
        const allAccs = await getStudentAccounts();
        setClassExistingAccountIds(new Set(allAccs.map((a) => a.studentId)));
      } else if (res.errors.length > 0) {
        toast('Có lỗi trong quá trình tạo tài khoản', 'error');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi tạo tài khoản', 'error');
    } finally {
      setClassBatchRunning(false);
    }
  }

  async function doAssignTeacher() {
    if (!assignTeacherId || !detail) {
      toast('Chọn giáo viên/trợ giảng', 'warning');
      return;
    }
    setAssigning(true);
    try {
      await assignTeacher(assignTeacherId, detail.id);
      toast('Đã phân công giáo viên');
      setAssignTeacherId('');
      setAssignedTeachers(await getClassTeachers(detail.id));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi', 'error');
    } finally {
      setAssigning(false);
    }
  }

  async function doRemoveTeacher(teacherId: string) {
    if (!detail || !window.confirm('Hủy phân công giáo viên?')) return;
    try {
      await removeTeacherFromClass(teacherId, detail.id);
      toast('Đã hủy phân công');
      setAssignedTeachers((t) => t.filter((x) => x.id !== teacherId));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi', 'error');
    }
  }

  const filtered = classes.filter(
    (c) =>
      c.className.toLowerCase().includes(q.toLowerCase()) ||
      c.subject.toLowerCase().includes(q.toLowerCase())
  );
  const unenrolled = students.filter((s) => !roster.find((r) => r.id === s.id));
  const unassigned = teachers.filter(
    (t) => !assignedTeachers.find((a) => a.id === t.id)
  );

  const allRosterSelected =
    roster.length > 0 && roster.every((s) => selectedRosterIds.has(s.id));

  const toggleRosterOne = (studentId: string) => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleAllRoster = () => {
    setSelectedRosterIds((prev) => {
      const next = new Set(prev);
      if (allRosterSelected) roster.forEach((s) => next.delete(s.id));
      else roster.forEach((s) => next.add(s.id));
      return next;
    });
  };

  if (loading)
    return (
      <div className="loading-state">
        <div className="spinner" />
        <span>Đang tải...</span>
      </div>
    );

  return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <School size={26} /> <span>Lớp học</span>
          </h1>
          <p className="page-sub">
            {canManage
              ? `Quản lý ${classes.length} lớp học`
              : `${classes.length} lớp được phân công`}
          </p>
        </div>
      </div>

      <div className="filter-bar">
        <input
          className="search-box"
          placeholder="Tìm lớp học..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {canManage && (
          <button className="btn btn-primary" onClick={openAdd}>
            + Tạo lớp mới
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-icon">
                <School size={40} />
              </div>
              <h3>Chưa có lớp học nào</h3>
              <p>
                {canManage
                  ? 'Nhấn "+ Tạo lớp mới" ở trên để bắt đầu'
                  : 'Chưa có lớp nào được phân công cho bạn'}
              </p>
              {canManage && (
                <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={openAdd}>
                  + Tạo lớp mới
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {filtered.map((cls) => (
            <div
              key={cls.id}
              className="card"
              style={{ cursor: 'pointer' }}
              onClick={() => openDetail(cls)}
            >
              <div
                className="card-header"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span>{cls.className}</span>
                <span
                  className="badge"
                  style={{
                    fontSize: '0.7rem',
                    background: 'rgba(255,255,255,0.25)',
                    color: '#fff',
                  }}
                >
                  {cls.status === 'ACTIVE' ? 'Đang học' : 'Dừng'}
                </span>
              </div>
              <div className="card-body" style={{ fontSize: '0.875rem' }}>
                <div style={{ marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {cls.subject && <span className="badge badge-info">{cls.subject}</span>}
                  {cls.grade && <span className="badge badge-warning">Khối {cls.grade}</span>}
                </div>
                <div style={{ color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={14} /> {cls.startDate ? fmtDate(cls.startDate) : 'Chưa rõ ngày'}
                </div>
                {canManage && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={(e) => openEdit(cls, e)}
                    >
                      <Pencil size={14} /> Sửa
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title={editing ? 'Sửa lớp học' : 'Tạo lớp mới'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowForm(false)}>
              Hủy
            </button>
            <button className="btn btn-primary" onClick={saveClass} disabled={saving}>
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tên lớp *</label>
            <input
              className="form-control"
              value={form.className}
              onChange={(e) => setForm((f) => ({ ...f, className: e.target.value }))}
              placeholder="VD: Toán 8A"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Môn học</label>
            <input
              className="form-control"
              value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
              placeholder="VD: Toán, Văn, Anh..."
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Khối lớp</label>
            <input
              className="form-control"
              value={form.grade}
              onChange={(e) => setForm((f) => ({ ...f, grade: e.target.value }))}
              placeholder="VD: 8"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Ngày bắt đầu</label>
            <input
              className="form-control"
              type="date"
              value={form.startDate}
              onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))}
            />
          </div>
          {editing && (
            <div className="form-group">
              <label className="form-label">Trạng thái</label>
              <select
                className="form-select"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({ ...f, status: e.target.value as Status }))
                }
              >
                <option value="ACTIVE">Đang học</option>
                <option value="INACTIVE">Dừng</option>
              </select>
            </div>
          )}
        </div>
      </Modal>

      {/* Detail Modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.className || ''}
        size="modal-lg"
      >
        {detail && (
          <>
            <div
              style={{
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
                marginBottom: 16,
                padding: '10px 14px',
                background: 'var(--bg-light)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.875rem',
              }}
            >
              {detail.subject && (
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <BookOpen size={14} /> {detail.subject}
                </span>
              )}
              {detail.grade && (
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <Tag size={14} /> Khối {detail.grade}
                </span>
              )}
              {detail.startDate && (
                <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <Calendar size={14} /> {fmtDate(detail.startDate)}
                </span>
              )}
            </div>

            <div className="tabs">
              <button
                className={`tab ${detailTab === 'roster' ? 'active' : ''}`}
                onClick={() => setDetailTab('roster')}
              >
                Danh sách ({roster.length})
              </button>
              {isAdmin && (
                <button
                  className={`tab ${detailTab === 'teachers' ? 'active' : ''}`}
                  onClick={() => setDetailTab('teachers')}
                >
                  Giáo viên ({assignedTeachers.length})
                </button>
              )}
            </div>

            {rosterLoading ? (
              <div className="loading-state">
                <div className="spinner" />
                <span>Đang tải...</span>
              </div>
            ) : detailTab === 'roster' ? (
              <>
                {(isAdmin || user?.role === Role.TEACHER) && (
                  <>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        marginBottom: 14,
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      <select
                        className="form-select"
                        style={{ flex: 1, minWidth: 220 }}
                        value={enrollStudentId}
                        onChange={(e) => setEnrollStudentId(e.target.value)}
                      >
                        <option value="">-- Chọn học sinh để thêm vào lớp --</option>
                        {unenrolled.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.fullName}
                            {s.studentClass ? ` (${s.studentClass})` : ''}
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={doEnroll}
                        disabled={enrolling}
                      >
                        {enrolling ? '...' : '+ Thêm'}
                      </button>

                      <button className="btn btn-secondary btn-sm" onClick={downloadStudentTemplate}>
                        <FileDown size={14} /> File mẫu
                      </button>

                      <input
                        ref={rosterFileInputRef}
                        type="file"
                        accept=".xlsx,.xls"
                        hidden
                        onChange={doImportStudentsToClass}
                      />

                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => rosterFileInputRef.current?.click()}
                        disabled={importingRoster}
                      >
                        <Upload size={14} /> {importingRoster ? 'Đang import...' : 'Import vào lớp'}
                      </button>

                      <button
                        className="btn btn-primary btn-sm"
                        style={{
                          background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                          color: '#fff',
                          fontWeight: 600,
                        }}
                        onClick={handleOpenClassAccountModal}
                        title="Tự động tạo tài khoản đăng nhập cho toàn bộ học sinh lớp"
                      >
                        <Zap size={14} /> Cấp tài khoản lớp
                      </button>

                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={handleExportClassAccounts}
                        title="Xuất file Excel danh sách tài khoản học sinh lớp"
                      >
                        <Download size={14} /> Xuất tài khoản
                      </button>
                    </div>

                    {selectedRosterIds.size > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: 12,
                          padding: '8px 10px',
                          background: 'rgba(239,68,68,0.08)',
                          borderRadius: 'var(--radius-sm)',
                          flexWrap: 'wrap',
                        }}
                      >
                        <strong>Đã chọn {selectedRosterIds.size} học sinh trong lớp</strong>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => setSelectedRosterIds(new Set())}
                          >
                            Bỏ chọn
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={doRemoveSelectedStudentsFromClass}
                          >
                            <Trash2 size={14} /> Xóa khỏi lớp
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                )}
                {roster.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Users size={40} />
                    </div>
                    <h3>Chưa có học sinh</h3>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {(isAdmin || user?.role === Role.TEACHER) && (
                            <th style={{ width: 42 }}>
                              <input
                                type="checkbox"
                                checked={allRosterSelected}
                                onChange={toggleAllRoster}
                                title="Chọn tất cả học sinh trong lớp"
                              />
                            </th>
                          )}
                          <th>Học sinh</th>
                          <th>SĐT phụ huynh</th>
                          {(isAdmin || user?.role === Role.TEACHER) && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {roster.map((s) => (
                          <tr key={s.id}>
                            {(isAdmin || user?.role === Role.TEACHER) && (
                              <td>
                                <input
                                  type="checkbox"
                                  checked={selectedRosterIds.has(s.id)}
                                  onChange={() => toggleRosterOne(s.id)}
                                />
                              </td>
                            )}
                            <td>
                              <strong>{s.fullName}</strong>
                            </td>
                            <td>{s.parentPhone || '—'}</td>
                            {(isAdmin || user?.role === Role.TEACHER) && (
                              <td>
                                <button
                                  className="btn btn-danger btn-sm"
                                  onClick={() => doRemoveStudent(s.id)}
                                >
                                  Xóa
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <select
                    className="form-select"
                    style={{ flex: 1 }}
                    value={assignTeacherId}
                    onChange={(e) => setAssignTeacherId(e.target.value)}
                  >
                    <option value="">-- Chọn giáo viên / trợ giảng --</option>
                    {unassigned.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.role === Role.TEACHER ? 'GV' : 'TG'}) - {t.email}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={doAssignTeacher}
                    disabled={assigning}
                  >
                    {assigning ? '...' : '+ Phân công'}
                  </button>
                </div>
                {assignedTeachers.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <GraduationCap size={40} />
                    </div>
                    <h3>Chưa phân công giáo viên</h3>
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Giáo viên</th>
                          <th>Vai trò</th>
                          <th>Email</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {assignedTeachers.map((t) => (
                          <tr key={t.id}>
                            <td>
                              <strong>{t.name}</strong>
                            </td>
                            <td>
                              <span
                                className={`badge ${
                                  t.role === Role.TEACHER ? 'badge-teacher' : 'badge-warning'
                                }`}
                              >
                                {t.role === Role.TEACHER ? 'Giáo viên' : 'Trợ giảng'}
                              </span>
                            </td>
                            <td style={{ fontSize: '0.83rem' }}>{t.email}</td>
                            <td>
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => doRemoveTeacher(t.id)}
                              >
                                Hủy
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Modal>

      {/* Modal Cấp tài khoản cho lớp */}
      <Modal
        open={showClassAccountModal}
        onClose={() => !classBatchRunning && setShowClassAccountModal(false)}
        title={`⚡ Cấp tài khoản học sinh — Lớp ${detail?.className || ''}`}
        footer={
          <>
            <button
              className="btn btn-ghost"
              onClick={() => setShowClassAccountModal(false)}
              disabled={classBatchRunning}
            >
              Đóng
            </button>
            <button
              className="btn btn-primary"
              onClick={runClassBatchCreate}
              disabled={
                classBatchRunning ||
                !detail ||
                roster.filter((s) => !classExistingAccountIds.has(s.id)).length === 0
              }
            >
              {classBatchRunning ? (
                <>Đang tạo ({classBatchProgress?.percent || 0}%)...</>
              ) : (
                `Tạo tài khoản (${
                  roster.filter((s) => !classExistingAccountIds.has(s.id)).length
                } em)`
              )}
            </button>
          </>
        }
      >
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
            <span>Học sinh trong lớp:</span>
            <strong>{roster.length} em</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, color: '#10b981' }}>
            <span>Đã có tài khoản:</span>
            <strong>{roster.filter((s) => classExistingAccountIds.has(s.id)).length} em</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6366f1', fontWeight: 600 }}>
            <span>Chưa có tài khoản (cần tạo):</span>
            <strong>{roster.filter((s) => !classExistingAccountIds.has(s.id)).length} em</strong>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">Mật khẩu ban đầu mặc định cho học sinh</label>
          <input
            className="form-control"
            value={classBatchPassword}
            disabled={classBatchRunning}
            onChange={(e) => setClassBatchPassword(e.target.value)}
            placeholder="Ví dụ: 123456"
          />
          <small style={{ color: 'var(--text-muted)', display: 'block', marginTop: 4 }}>
            Học sinh đăng nhập tại <strong>/student-login</strong> bằng Tên đăng nhập và Mật khẩu này.
          </small>
        </div>

        {classBatchRunning && classBatchProgress && (
          <div style={{ margin: '16px 0', padding: 12, background: 'rgba(99, 102, 241, 0.08)', borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.875rem' }}>
              <span>Đang tạo: <strong>{classBatchProgress.currentName}</strong></span>
              <span>{classBatchProgress.current}/{classBatchProgress.total} ({classBatchProgress.percent}%)</span>
            </div>
            <div style={{ width: '100%', height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${classBatchProgress.percent}%`,
                  height: '100%',
                  background: 'linear-gradient(90deg, #6366f1, #a855f7)',
                  transition: 'width 0.2s',
                }}
              />
            </div>
          </div>
        )}

        {classBatchResult && (
          <div style={{ margin: '14px 0', padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8 }}>
            <strong style={{ color: '#166534', display: 'block', marginBottom: 6 }}>
              ✓ Đã tạo thành công {classBatchResult.success.length} tài khoản!
            </strong>
            <p style={{ margin: 0, fontSize: '0.875rem', color: '#15803d' }}>
              File Excel danh sách tài khoản đã được tự động tải về máy của bạn.
            </p>
            {classBatchResult.success.length > 0 && (
              <button
                className="btn btn-secondary btn-sm"
                style={{ marginTop: 10 }}
                onClick={() => {
                  if (!detail) return;
                  exportStudentAccountsToExcel(
                    classBatchResult.success.map((item) => ({
                      studentName: item.studentName,
                      className: item.className,
                      username: item.username,
                      password: item.password,
                      status: 'Đã kích hoạt',
                    })),
                    `tai_khoan_lop_${detail.className.replace(/\s+/g, '_')}.xlsx`
                  );
                }}
              >
                <Download size={14} /> Tải lại file Excel
              </button>
            )}
          </div>
        )}

        <div className="payment-warning" style={{ margin: 0 }}>
          💡 <strong>Quy tắc sinh Username</strong>: Tên học sinh không dấu + tên lớp (Ví dụ: <code>annv_11a1</code>). Nếu trùng tên, hệ thống tự động đánh số phân biệt.
        </div>
      </Modal>
    </div>
  );
}
