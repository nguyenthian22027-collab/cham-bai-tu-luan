import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import * as XLSX from 'xlsx';
import { Users, Pencil, Trash2, Upload, FileDown } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import {
  getClasses,
  getStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  deleteStudents,
  importStudents,
} from '../services/dataService';
import { ClassItem, Student, Status } from '../types';
import Modal from '../components/Modal';

interface FormState {
  fullName: string;
  studentClass: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  studentEmail: string;
  note: string;
  status: Status;
}

const EMPTY: FormState = {
  fullName: '',
  studentClass: '',
  parentName: '',
  parentPhone: '',
  parentEmail: '',
  studentEmail: '',
  note: '',
  status: 'ACTIVE',
};

const TEMPLATE_HEADERS = [
  'Họ tên học sinh *',
  'Lớp hành chính',
  'Tên phụ huynh',
  'SĐT phụ huynh',
  'Email phụ huynh',
  'Email Google học sinh',
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

async function parseStudentExcel(file: File): Promise<FormState[]> {
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
      parentEmail: getCell(row, ['Email phụ huynh', 'parentEmail']),
      studentEmail: getCell(row, ['Email Google học sinh', 'Email học sinh', 'studentEmail']).toLowerCase(),
      note: getCell(row, ['Ghi chú', 'note']),
      status: parseStatus(getCell(row, ['Trạng thái', 'status'])),
    }));
}

function downloadStudentTemplate() {
  const rows = [
    TEMPLATE_HEADERS,
    ['Nguyễn Văn A', '8A', 'Nguyễn Văn B', '0901234567', 'phuhuynh1@gmail.com', 'hocsinh1@gmail.com', 'Học thử', 'ACTIVE'],
    ['Trần Thị C', '8A', 'Trần Văn D', '0912345678', 'phuhuynh2@gmail.com', 'hocsinh2@gmail.com', '', 'ACTIVE'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 16 },
    { wch: 22 },
    { wch: 18 },
    { wch: 28 },
    { wch: 28 },
    { wch: 24 },
    { wch: 14 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'HocSinh');
  XLSX.writeFile(wb, 'mau_import_hoc_sinh.xlsx');
}

export default function Students() {
  const { user } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [students, setStudents] = useState<Student[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importClassId, setImportClassId] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function loadData() {
    try {
      const stu = await getStudents();
      setStudents(stu);

      if (user) {
        const cls = await getClasses(user);
        setClasses(cls);
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tải dữ liệu', 'error');
    } finally {
      setLoading(false);
    }
  }

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setShowModal(true);
  };

  const openEdit = (s: Student) => {
    setEditing(s);
    setForm({
      fullName: s.fullName,
      studentClass: s.studentClass,
      parentName: s.parentName,
      parentPhone: s.parentPhone,
      parentEmail: s.parentEmail,
      studentEmail: s.studentEmail || '',
      note: s.note,
      status: s.status,
    });
    setShowModal(true);
  };

  const handleDelete = async (s: Student) => {
    if (
      !window.confirm(
        `Xóa học sinh "${s.fullName}"? Các bài được giao và kết quả chấm liên quan có thể không còn tra cứu thuận tiện. Thao tác này không thể hoàn tác.`
      )
    )
      return;
    try {
      await deleteStudent(s.id);
      toast('Đã xóa học sinh', 'success');
      setStudents((prev) => prev.filter((x) => x.id !== s.id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(s.id);
        return next;
      });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi xóa', 'error');
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) {
      toast('Chưa chọn học sinh nào', 'warning');
      return;
    }

    if (
      !window.confirm(
        `Xóa ${ids.length} học sinh đã chọn? Liên kết lớp và dữ liệu bài làm liên quan có thể bị ảnh hưởng. Thao tác này không thể hoàn tác.`
      )
    )
      return;

    try {
      await deleteStudents(ids);
      toast(`Đã xóa ${ids.length} học sinh`, 'success');
      setStudents((prev) => prev.filter((s) => !selectedIds.has(s.id)));
      setSelectedIds(new Set());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi xóa nhiều học sinh', 'error');
    }
  };

  const save = async () => {
    if (!form.fullName.trim()) {
      toast('Vui lòng nhập tên học sinh', 'warning');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await updateStudent(editing.id, form);
        toast('Đã cập nhật học sinh');
        setStudents((prev) =>
          prev.map((s) => (s.id === editing.id ? { ...s, ...form } : s))
        );
      } else {
        const ref = await addStudent(form);
        toast('Đã thêm học sinh mới');
        setStudents((prev) =>
          [...prev, { id: ref.id, ...form }].sort((a, b) =>
            a.fullName.localeCompare(b.fullName)
          )
        );
      }
      setShowModal(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi lưu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleImportExcel = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      const rows = await parseStudentExcel(file);
      if (rows.length === 0) {
        toast('File Excel không có dữ liệu học sinh', 'warning');
        return;
      }

      const result = await importStudents(rows, importClassId || undefined);
      const latest = await getStudents();
      setStudents(latest);

      const targetClass = classes.find((c) => c.id === importClassId);
      const classText = targetClass ? `, đã đưa vào lớp ${targetClass.className}` : '';

      toast(
        `Import xong: tạo mới ${result.created}, đã có sẵn ${result.existed}, bỏ qua ${result.skipped}${classText}`,
        result.errors.length ? 'warning' : 'success'
      );

      if (result.errors.length) {
        console.warn('Import học sinh có cảnh báo:', result.errors);
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Lỗi import Excel', 'error');
    } finally {
      setImporting(false);
    }
  };

  const filtered = students.filter(
    (s) =>
      s.fullName.toLowerCase().includes(q.toLowerCase()) ||
      s.studentClass.toLowerCase().includes(q.toLowerCase()) ||
      s.parentPhone.includes(q) ||
      (s.studentEmail || '').toLowerCase().includes(q.toLowerCase()) ||
      s.id.includes(q)
  );

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filtered.forEach((s) => next.delete(s.id));
      else filtered.forEach((s) => next.add(s.id));
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
            <Users size={26} /> <span>Học sinh</span>
          </h1>
          <p className="page-sub">{students.length} học sinh đã đăng ký</p>
        </div>
      </div>

      <div className="filter-bar" style={{ flexWrap: 'wrap' }}>
        <input
          className="search-box"
          placeholder="Tìm theo tên, lớp, SĐT, email Google, mã..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <select
          className="form-select"
          style={{ maxWidth: 260 }}
          value={importClassId}
          onChange={(e) => setImportClassId(e.target.value)}
          title="Chọn lớp nếu muốn import và xếp lớp luôn"
        >
          <option value="">Import: chỉ thêm học sinh</option>
          {classes.map((c) => (
            <option key={c.id} value={c.id}>
              Import vào lớp {c.className}
            </option>
          ))}
        </select>

        <button className="btn btn-secondary" onClick={downloadStudentTemplate}>
          <FileDown size={16} /> Tải file mẫu
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          hidden
          onChange={handleImportExcel}
        />

        <button
          className="btn btn-primary"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          <Upload size={16} /> {importing ? 'Đang import...' : 'Import Excel'}
        </button>

        <button className="btn btn-primary" onClick={openAdd}>
          + Thêm học sinh
        </button>
      </div>

      {selectedIds.size > 0 && (
        <div
          className="card"
          style={{
            marginBottom: 12,
            borderColor: 'rgba(239,68,68,0.25)',
          }}
        >
          <div
            className="card-body"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <strong>Đã chọn {selectedIds.size} học sinh</strong>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelectedIds(new Set())}>
                Bỏ chọn
              </button>
              <button className="btn btn-danger btn-sm" onClick={handleBulkDelete}>
                <Trash2 size={14} /> Xóa học sinh đã chọn
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        {filtered.length === 0 ? (
          <div className="card-body">
            <div className="empty-state">
              <div className="empty-icon">
                <Users size={40} />
              </div>
              <h3>{q ? 'Không tìm thấy' : 'Chưa có học sinh'}</h3>
              <p>{!q && 'Nhấn "+ Thêm học sinh" hoặc "Import Excel" để bắt đầu'}</p>
            </div>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 42 }}>
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleAllFiltered}
                      title="Chọn tất cả học sinh đang lọc"
                    />
                  </th>
                  <th>Mã</th>
                  <th>Họ tên</th>
                  <th>Lớp</th>
                  <th>Phụ huynh</th>
                  <th>SĐT</th>
                  <th>Email Google học sinh</th>
                  <th>Trạng thái</th>
                  <th>Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(s.id)}
                        onChange={() => toggleOne(s.id)}
                      />
                    </td>
                    <td>
                      <span
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '0.78rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        {s.id.slice(0, 8)}
                      </span>
                    </td>
                    <td>
                      <strong>{s.fullName}</strong>
                      {s.note && (
                        <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)' }}>
                          {s.note}
                        </div>
                      )}
                    </td>
                    <td>
                      <span
                        className="badge"
                        style={{ background: 'var(--bg-light)', color: 'var(--text)' }}
                      >
                        {s.studentClass || '—'}
                      </span>
                    </td>
                    <td>{s.parentName || '—'}</td>
                    <td>{s.parentPhone || '—'}</td>
                    <td>{s.studentEmail || <span style={{ color: 'var(--danger)', fontSize: '0.78rem' }}>Chưa khai báo</span>}</td>
                    <td>
                      <span
                        className={`badge ${
                          s.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'
                        }`}
                      >
                        {s.status === 'ACTIVE' ? 'Đang học' : 'Nghỉ'}
                      </span>
                    </td>
                    <td className="actions">
                      <button className="btn btn-secondary btn-sm" onClick={() => openEdit(s)}>
                        <Pencil size={14} /> Sửa
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)', marginLeft: 4 }}
                        onClick={() => handleDelete(s)}
                      >
                        <Trash2 size={14} /> Xóa
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Sửa thông tin học sinh' : 'Thêm học sinh mới'}
        footer={
          <>
            <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
              Hủy
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Đang lưu...' : 'Lưu'}
            </button>
          </>
        }
      >
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label className="form-label">Họ tên học sinh *</label>
            <input
              className="form-control"
              value={form.fullName}
              onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))}
              placeholder="Nguyễn Văn A"
              autoFocus
            />
          </div>
          <div className="form-group" style={{ flex: 1 }}>
            <label className="form-label">Lớp</label>
            <input
              className="form-control"
              value={form.studentClass}
              onChange={(e) => setForm((f) => ({ ...f, studentClass: e.target.value }))}
              placeholder="12A1"
            />
          </div>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Tên phụ huynh</label>
            <input
              className="form-control"
              value={form.parentName}
              onChange={(e) => setForm((f) => ({ ...f, parentName: e.target.value }))}
              placeholder="Nguyễn Văn B"
            />
          </div>
          <div className="form-group">
            <label className="form-label">SĐT phụ huynh</label>
            <input
              className="form-control"
              type="tel"
              value={form.parentPhone}
              onChange={(e) => setForm((f) => ({ ...f, parentPhone: e.target.value }))}
              placeholder="0901..."
            />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Email Google học sinh</label>
          <input
            className="form-control"
            type="email"
            value={form.studentEmail}
            onChange={(e) => setForm((f) => ({ ...f, studentEmail: e.target.value.trim().toLowerCase() }))}
            placeholder="hocsinh@gmail.com"
          />
          <small style={{ color: 'var(--text-muted)' }}>Dùng để học sinh đăng nhập Google. Mỗi Gmail chỉ được gán cho một học sinh.</small>
        </div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">Email phụ huynh</label>
            <input
              className="form-control"
              type="email"
              value={form.parentEmail}
              onChange={(e) => setForm((f) => ({ ...f, parentEmail: e.target.value }))}
              placeholder="email@gmail.com"
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
                <option value="INACTIVE">Nghỉ học</option>
              </select>
            </div>
          )}
        </div>
        <div className="form-group">
          <label className="form-label">Ghi chú</label>
          <input
            className="form-control"
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Ghi chú thêm..."
          />
        </div>
      </Modal>
    </div>
  );
}
