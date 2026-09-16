import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { BarChart3, Eye, EyeOff, RefreshCcw } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { Assignment, AssignmentTarget } from '../types';
import { getAssignment, getAssignmentTargets, updateAssignmentAnswerVisibility } from '../services/assignmentService';

export default function AssignmentMonitor() {
  const { assignmentId } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [targets, setTargets] = useState<AssignmentTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [assignmentId]);

  async function load() {
    if (!assignmentId) return;
    setLoading(true);
    try {
      const [a, t] = await Promise.all([getAssignment(assignmentId), getAssignmentTargets(assignmentId)]);
      setAssignment(a);
      setTargets(t);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi tải tiến độ', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function toggleAnswers() {
    if (!assignment || !user) return;
    const visible = assignment.resultVisibility !== 'full_review';
    if (!window.confirm(visible
      ? 'Cho toàn bộ học sinh của lớp này xem đáp án, điểm từng câu và lời giải?'
      : 'Ẩn lại đáp án và lời giải khỏi học sinh?')) return;
    try {
      await updateAssignmentAnswerVisibility(assignment.id, visible, user);
      toast(visible ? 'Đã cho học sinh xem đáp án' : 'Đã ẩn đáp án');
      await load();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Lỗi cập nhật quyền xem đáp án', 'error');
    }
  }

  const stats = useMemo(() => ({
    total: targets.length,
    assigned: targets.filter((t) => t.status === 'assigned').length,
    inProgress: targets.filter((t) => t.status === 'in_progress').length,
    submitted: targets.filter((t) => t.status === 'submitted').length,
    graded: targets.filter((t) => t.status === 'graded').length,
  }), [targets]);

  const filtered = targets.filter((t) => t.studentName.toLowerCase().includes(q.toLowerCase()));

  if (loading) return <div className="loading-state"><div className="spinner" /><span>Đang tải...</span></div>;
  if (!assignment) return <div className="empty-state"><h3>Không tìm thấy bài giao</h3></div>;

  return (
    <div className="fade-up assignment-page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><BarChart3 size={26} /> <span>Theo dõi tiến độ</span></h1>
          <p className="page-sub">{assignment.title} · {assignment.className} · {assignment.resultVisibility === 'full_review' ? 'Học sinh đang được xem đáp án' : 'Học sinh chỉ thấy tổng điểm'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => nav('/assignments')}>Quay lại</button>
          <button className={assignment.resultVisibility === 'full_review' ? 'btn btn-outline' : 'btn btn-primary'} onClick={toggleAnswers}>{assignment.resultVisibility === 'full_review' ? <><EyeOff size={16} /> Ẩn đáp án</> : <><Eye size={16} /> Cho xem đáp án</>}</button>
          <button className="btn btn-secondary" onClick={() => nav(`/assignments/${assignment.id}/grading`)}>Chấm bài</button>
        </div>
      </div>

      <div className="stats-grid assignment-stats">
        <div className="stat-card"><span className="stat-icon">👥</span><span className="stat-value">{stats.total}</span><span className="stat-label">Được giao</span></div>
        <div className="stat-card"><span className="stat-icon">🕘</span><span className="stat-value">{stats.assigned}</span><span className="stat-label">Chưa mở</span></div>
        <div className="stat-card"><span className="stat-icon">✍️</span><span className="stat-value">{stats.inProgress}</span><span className="stat-label">Đang làm</span></div>
        <div className="stat-card"><span className="stat-icon">📩</span><span className="stat-value">{stats.submitted}</span><span className="stat-label">Đã nộp</span></div>
        <div className="stat-card"><span className="stat-icon">✅</span><span className="stat-value">{stats.graded}</span><span className="stat-label">Đã chấm</span></div>
      </div>

      <div className="filter-bar">
        <input className="search-box" placeholder="Tìm học sinh..." value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-ghost" onClick={load}><RefreshCcw size={16} /> Tải lại</button>
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Học sinh</th><th>Trạng thái</th><th>Bắt đầu</th><th>Nộp bài</th><th>Điểm cuối</th></tr></thead>
            <tbody>
              {filtered.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.studentName}</strong></td>
                  <td><StatusBadge status={t.status} /></td>
                  <td>{t.startedAt ? t.startedAt.toLocaleString('vi-VN') : '—'}</td>
                  <td>{t.submittedAt ? t.submittedAt.toLocaleString('vi-VN') : '—'}</td>
                  <td>{t.finalScore !== undefined ? <strong>{t.finalScore}/{t.maxScore}</strong> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    assigned: { cls: 'badge-warning', label: 'Chưa mở' },
    in_progress: { cls: 'badge-info', label: 'Đang làm' },
    submitted: { cls: 'badge-warning', label: 'Đã nộp' },
    graded: { cls: 'badge-success', label: 'Đã chấm' },
  };
  const m = map[status] || { cls: 'badge', label: status };
  return <span className={`badge ${m.cls}`}>{m.label}</span>;
}
