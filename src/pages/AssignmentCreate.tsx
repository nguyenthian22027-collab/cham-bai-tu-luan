import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckSquare, FileCheck2, FileUp, Send, Settings, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import ExamReviewModal from '../components/ExamReviewModal';
import Modal from '../components/Modal';
import PointsConfigEditor from '../components/PointsConfigEditor';
import { createAssignmentExam, createAssignmentsForClasses } from '../services/assignmentService';
import { getClasses, getClassRoster } from '../services/dataService';
import {
  EssaySolutionImport,
  mergeEssaySolutions,
  parseEssayQuestionsFromWord,
  parseEssaySolutionsFromWord,
  validateExamData,
} from '../services/mathWordParserService';
import { createDefaultPointsConfig } from '../services/scoringService';
import { ClassItem, ExamData, ExamPointsConfig, Student } from '../types';

function fromInputDateTime(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function localQuestionNumber(number: number, index: number) {
  return number >= 400 ? number - 400 : index + 1;
}

function hasReusableSolution(solution?: string) {
  return Boolean(
    String(solution || '')
      .replace(/<br\s*\/?\s*>/gi, '')
      .replace(/<[^>]+>/g, '')
      .trim(),
  );
}

export default function AssignmentCreate() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [rostersByClass, setRostersByClass] = useState<Record<string, Student[]>>({});
  const [selectedStudentsByClass, setSelectedStudentsByClass] = useState<Record<string, string[]>>({});
  const [loadingRosters, setLoadingRosters] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [maxAttempts, setMaxAttempts] = useState(1);

  const [examData, setExamData] = useState<ExamData | null>(null);
  const [solutionImport, setSolutionImport] = useState<EssaySolutionImport | null>(null);
  const [questionFileName, setQuestionFileName] = useState('');
  const [answerFileName, setAnswerFileName] = useState('');
  const [pointsConfig, setPointsConfig] = useState<ExamPointsConfig | null>(null);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [parsingQuestion, setParsingQuestion] = useState(false);
  const [parsingAnswer, setParsingAnswer] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    getClasses(user).then(setClasses).catch((error) => toast(error.message, 'error'));
  }, [user, toast]);

  useEffect(() => {
    let cancelled = false;
    async function loadRosters() {
      if (selectedClassIds.length === 0) {
        setRostersByClass({});
        setSelectedStudentsByClass({});
        return;
      }
      setLoadingRosters(true);
      try {
        const entries = await Promise.all(
          selectedClassIds.map(async (classId) => [classId, await getClassRoster(classId)] as const),
        );
        if (cancelled) return;
        setRostersByClass(Object.fromEntries(entries) as Record<string, Student[]>);
        setSelectedStudentsByClass((previous) => {
          const next: Record<string, string[]> = {};
          entries.forEach(([classId, roster]) => {
            const validIds = new Set(roster.map((student) => student.id));
            const retained = (previous[classId] || []).filter((id) => validIds.has(id));
            next[classId] = retained.length ? retained : roster.map((student) => student.id);
          });
          return next;
        });
      } catch (error) {
        if (!cancelled) toast(error instanceof Error ? error.message : 'Lỗi tải danh sách lớp', 'error');
      } finally {
        if (!cancelled) setLoadingRosters(false);
      }
    }
    loadRosters();
    return () => { cancelled = true; };
  }, [selectedClassIds, toast]);

  const selectedClasses = useMemo(
    () => classes.filter((item) => selectedClassIds.includes(item.id)),
    [classes, selectedClassIds],
  );

  const totalSelectedStudents = useMemo(
    () => selectedClassIds.reduce(
      (sum, classId) => sum + (selectedStudentsByClass[classId]?.length || 0),
      0,
    ),
    [selectedClassIds, selectedStudentsByClass],
  );

  const matchedSolutions = useMemo(() => {
    if (!examData || !solutionImport) return 0;
    return examData.questions.filter((question, index) =>
      hasReusableSolution(solutionImport.items[localQuestionNumber(question.number, index)]?.solution),
    ).length;
  }, [examData, solutionImport]);

  async function handleQuestionFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      toast('Vui lòng chọn file đề Word .docx', 'warning');
      return;
    }

    setParsingQuestion(true);
    try {
      let parsed = await parseEssayQuestionsFromWord(file);
      if (solutionImport) parsed = mergeEssaySolutions(parsed, solutionImport);
      const checked = validateExamData(parsed);
      if (!checked.valid) toast(checked.errors.join('\n'), 'warning');

      setExamData(parsed);
      setQuestionFileName(file.name);
      setPointsConfig(createDefaultPointsConfig(parsed.questions));
      setTitle((current) => current || parsed.title || file.name.replace(/\.docx$/i, ''));
      setReviewOpen(true);
      toast(`Đã đọc ${parsed.questions.length} câu tự luận từ file đề. Không dùng Gemini để đọc file Word.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Lỗi đọc file đề Word', 'error');
    } finally {
      setParsingQuestion(false);
    }
  }

  async function handleAnswerFile(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.docx')) {
      toast('Vui lòng chọn file đáp án Word .docx', 'warning');
      return;
    }

    setParsingAnswer(true);
    try {
      const imported = await parseEssaySolutionsFromWord(file);
      setSolutionImport(imported);
      setAnswerFileName(file.name);
      if (examData) {
        const merged = mergeEssaySolutions(examData, imported);
        setExamData(merged);
        setReviewOpen(true);
        const matched = merged.questions.filter((question, index) =>
          hasReusableSolution(imported.items[localQuestionNumber(question.number, index)]?.solution),
        ).length;
        const missingText = merged.questions.length - matched;
        toast(
          `Đã ghép lời giải chữ/LaTeX cho ${matched}/${merged.questions.length} câu` +
          (missingText ? `. Còn ${missingText} câu chỉ có ảnh hoặc thiếu lời giải.` : '.') +
          ' MathType/OLE được chuyển sang LaTeX một lần khi upload.',
          missingText ? 'warning' : 'success',
        );
      } else {
        toast(
          `Đã đọc ${Object.keys(imported.items).length} mục đáp án, trong đó ${imported.reusableSolutionCount} mục có chữ/LaTeX. Hãy upload file đề để ghép theo số câu.`,
          imported.reusableSolutionCount < Object.keys(imported.items).length ? 'warning' : 'success',
        );
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Lỗi đọc file đáp án Word', 'error');
    } finally {
      setParsingAnswer(false);
    }
  }

  function toggleClass(classId: string) {
    setSelectedClassIds((current) =>
      current.includes(classId) ? current.filter((id) => id !== classId) : [...current, classId],
    );
  }

  function toggleStudent(classId: string, studentId: string) {
    setSelectedStudentsByClass((current) => {
      const selected = current[classId] || [];
      return {
        ...current,
        [classId]: selected.includes(studentId)
          ? selected.filter((id) => id !== studentId)
          : [...selected, studentId],
      };
    });
  }

  function selectAllInClass(classId: string, selected: boolean) {
    setSelectedStudentsByClass((current) => ({
      ...current,
      [classId]: selected ? (rostersByClass[classId] || []).map((student) => student.id) : [],
    }));
  }

  function reviewBeforeAssign() {
    if (!user) return;
    if (!examData || examData.questions.length === 0) {
      toast('Upload và xác nhận file đề Word trước', 'warning');
      return;
    }
    if (!solutionImport || matchedSolutions < examData.questions.length) {
      toast('Cần upload file đáp án Word và ghép đủ lời giải cho tất cả câu trước khi giao bài.', 'warning');
      return;
    }
    if (!title.trim()) {
      toast('Nhập tên bài giao', 'warning');
      return;
    }
    if (selectedClasses.length === 0) {
      toast('Chọn ít nhất một lớp cần giao bài', 'warning');
      return;
    }
    const emptyClass = selectedClasses.find(
      (item) => (selectedStudentsByClass[item.id] || []).length === 0,
    );
    if (emptyClass) {
      toast(`Lớp ${emptyClass.className} chưa chọn học sinh`, 'warning');
      return;
    }
    setConfirmOpen(true);
  }

  async function saveAssignment() {
    if (!user || !examData) return;
    setConfirmOpen(false);
    setSaving(true);
    try {
      const examId = await createAssignmentExam({
        title,
        subject: selectedClasses.map((item) => item.subject).filter(Boolean).join(', '),
        questions: examData.questions,
        sections: examData.sections,
        images: examData.images,
        sourceFileName: questionFileName,
        answerSourceFileName: answerFileName,
        createdBy: user,
        pointsConfig,
      });

      const assignmentIds = await createAssignmentsForClasses({
        examId,
        title,
        description,
        classItems: selectedClasses,
        mode: 'homework',
        opensAt: fromInputDateTime(opensAt),
        closesAt: fromInputDateTime(closesAt),
        timeLimit: 0,
        allowResubmit: maxAttempts > 1,
        maxAttempts,
        shuffleQuestions: false,
        shuffleOptions: false,
        antiCheat: false,
        assignedBy: user,
        selectedStudentIdsByClass: selectedStudentsByClass,
      });

      toast(`Đã giao đề Word và đáp án Word cho ${assignmentIds.length} lớp.`);
      navigate(assignmentIds.length === 1
        ? `/assignments/${assignmentIds[0]}/monitor`
        : '/assignments');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Lỗi giao bài', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fade-up assignment-page">
      <div className="page-header">
        <div>
          <h1 className="page-title"><FileUp size={26} /> <span>Tạo bài tự luận từ 2 file Word</span></h1>
          <p className="page-sub">File đề và file đáp án được phân tích một lần; Gemini chỉ dùng khi giáo viên bấm chấm bài.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/assignments')}>Quay lại</button>
      </div>

      <div className="assignment-create-grid">
        <div className="card">
          <div className="card-header"><FileUp size={16} /> 1. File đề Word</div>
          <div className="card-body">
            <label className="upload-drop">
              <input type="file" accept=".docx" hidden onChange={(event) => handleQuestionFile(event.target.files?.[0])} />
              <FileUp size={34} />
              <strong>{parsingQuestion ? 'Đang đọc đề và chuyển MathType...' : 'Chọn file đề .docx'}</strong>
              <span>Đọc câu tự luận, OMML, MathType OLE và hình minh họa. Không gọi Gemini.</span>
            </label>
            {examData && (
              <div className="payment-config-preview" style={{ marginTop: 12 }}>
                <div><span>File đề</span><br /><strong>{questionFileName}</strong></div>
                <div><span>Số câu</span><br /><strong>{examData.questions.length}</strong></div>
                <div><span>Thang điểm</span><br /><strong>{pointsConfig?.maxScore ?? 10} điểm</strong></div>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header"><FileCheck2 size={16} /> 2. File đáp án Word</div>
          <div className="card-body">
            <label className="upload-drop">
              <input type="file" accept=".docx" hidden onChange={(event) => handleAnswerFile(event.target.files?.[0])} />
              <FileCheck2 size={34} />
              <strong>{parsingAnswer ? 'Đang đọc đáp án và chuyển MathType...' : 'Chọn file đáp án .docx'}</strong>
              <span>Ghép lời giải theo “Câu 1, Câu 2...”. Công thức OLE được lưu thành LaTeX để tái sử dụng khi chấm.</span>
            </label>
            {solutionImport && (
              <div className="payment-config-preview" style={{ marginTop: 12 }}>
                <div><span>File đáp án</span><br /><strong>{answerFileName}</strong></div>
                <div><span>Đã đọc</span><br /><strong>{solutionImport.reusableSolutionCount}/{Object.keys(solutionImport.items).length} lời giải chữ/LaTeX</strong></div>
                <div><span>MathType</span><br /><strong>{solutionImport.formulaCount} công thức</strong></div>
                <div><span>Đã ghép</span><br /><strong>{matchedSolutions}/{examData?.questions.length || 0} câu</strong></div>
              </div>
            )}
          </div>
        </div>
      </div>

      {examData && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">3. Kiểm tra nội dung đã ghép</div>
          <div className="card-body">
            <div className="essay-only-note">
              Đề, lời giải và công thức đã được lưu ở dạng văn bản/LaTeX. Ảnh trong file đáp án chỉ để giáo viên đối chiếu, mặc định không gửi sang Gemini để tiết kiệm chi phí.
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-secondary" onClick={() => setReviewOpen(true)}>Xem đề + đáp án</button>
              <button className="btn btn-primary" onClick={() => setPointsOpen(true)}>Cấu hình điểm</button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><Settings size={16} /> 4. Cấu hình giao bài</div>
        <div className="card-body">
          <div className="form-group">
            <label className="form-label">Tên bài *</label>
            <input className="form-control" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="VD: Bài tự luận chương I" />
          </div>
          <div className="form-group">
            <label className="form-label">Mô tả / dặn dò</label>
            <textarea className="form-control" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Mở lúc</label>
              <input className="form-control" type="datetime-local" value={opensAt} onChange={(event) => setOpensAt(event.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Hạn / đóng lúc</label>
              <input className="form-control" type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Số lần nộp</label>
            <select className="form-select" value={maxAttempts} onChange={(event) => setMaxAttempts(Number(event.target.value))}>
              <option value={1}>1 lần (mặc định)</option>
              <option value={2}>2 lần</option>
              <option value={3}>3 lần</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header"><Users size={16} /> 5. Chọn một hoặc nhiều lớp</div>
        <div className="card-body">
          <div className="assignment-class-grid">
            {classes.map((item) => {
              const checked = selectedClassIds.includes(item.id);
              return (
                <label key={item.id} className={`assignment-class-card ${checked ? 'selected' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => toggleClass(item.id)} />
                  <span><strong>{item.className}</strong><small>{item.subject || `Khối ${item.grade}`}</small></span>
                  {checked && <CheckSquare size={18} />}
                </label>
              );
            })}
          </div>
          {classes.length === 0 && <div className="empty-state"><h3>Chưa có lớp để giao bài</h3></div>}
        </div>
      </div>

      {selectedClasses.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-header">6. Chọn học sinh theo từng lớp</div>
          <div className="card-body">
            {loadingRosters && <div className="loading-state"><div className="spinner" /><span>Đang tải danh sách học sinh...</span></div>}
            {!loadingRosters && selectedClasses.map((classInfo) => {
              const roster = rostersByClass[classInfo.id] || [];
              const selected = selectedStudentsByClass[classInfo.id] || [];
              return (
                <section className="assignment-roster-section" key={classInfo.id}>
                  <div className="assignment-roster-head">
                    <div><strong>{classInfo.className}</strong><span>{selected.length}/{roster.length} học sinh</span></div>
                    <div>
                      <button className="btn btn-secondary btn-sm" onClick={() => selectAllInClass(classInfo.id, true)}>Chọn tất cả</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => selectAllInClass(classInfo.id, false)}>Bỏ chọn</button>
                    </div>
                  </div>
                  <div className="student-pick-grid">
                    {roster.map((student) => (
                      <label className="student-pick" key={student.id}>
                        <input type="checkbox" checked={selected.includes(student.id)} onChange={() => toggleStudent(classInfo.id, student.id)} />
                        <span><strong>{student.fullName}</strong><small>{student.studentClass || classInfo.className}</small></span>
                      </label>
                    ))}
                  </div>
                  {roster.length === 0 && <div className="empty-state"><h3>Lớp chưa có học sinh</h3></div>}
                </section>
              );
            })}
          </div>
        </div>
      )}

      <div className="assignment-create-footer">
        <span className="page-sub">Đã chọn {selectedClasses.length} lớp · {totalSelectedStudents} lượt học sinh</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => navigate('/assignments')}>Hủy</button>
          <button className="btn btn-primary" onClick={reviewBeforeAssign} disabled={saving || parsingQuestion || parsingAnswer}>
            <Send size={16} /> {saving ? 'Đang giao...' : `Giao cho ${selectedClasses.length || 0} lớp`}
          </button>
        </div>
      </div>

      {examData && (
        <ExamReviewModal
          open={reviewOpen}
          examData={examData}
          onClose={() => setReviewOpen(false)}
          onConfirm={(data) => {
            const writingQuestions = data.questions.filter((question) => question.type === 'writing');
            if (writingQuestions.length === 0) {
              toast('Đề phải còn ít nhất một câu tự luận.', 'warning');
              return;
            }
            const byNumber = new Map(writingQuestions.map((question) => [question.number, question]));
            const filtered: ExamData = {
              ...data,
              questions: writingQuestions,
              sections: data.sections
                .map((section) => ({
                  ...section,
                  sectionType: 'writing' as const,
                  questions: section.questions
                    .map((question) => byNumber.get(question.number))
                    .filter(Boolean) as typeof writingQuestions,
                }))
                .filter((section) => section.questions.length > 0),
            };
            setExamData(filtered);
            setPointsConfig((previous) => createDefaultPointsConfig(filtered.questions, previous?.maxScore || 10));
            setReviewOpen(false);
            toast('Đã cập nhật đề và lời giải tự luận.');
          }}
        />
      )}

      {pointsConfig && (
        <Modal open={pointsOpen} onClose={() => setPointsOpen(false)} title="Cấu hình điểm số" size="modal-lg">
          <PointsConfigEditor
            config={pointsConfig}
            onChange={(config) => { setPointsConfig(config); toast('Đã lưu cấu hình điểm'); }}
            onClose={() => setPointsOpen(false)}
          />
        </Modal>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Xác nhận giao bài">
        <div className="assign-confirm">
          <p className="assign-confirm-lead">Bài này sẽ được giao cho:</p>
          <ul className="assign-confirm-classes">
            {selectedClasses.map((item) => (
              <li key={item.id}>
                <strong>{item.className}</strong>
                <span>{(selectedStudentsByClass[item.id] || []).length}/{(rostersByClass[item.id] || []).length} học sinh</span>
              </li>
            ))}
          </ul>
          <dl className="assign-confirm-meta">
            <div><dt>Tên bài</dt><dd>{title}</dd></div>
            <div><dt>File đề</dt><dd>{questionFileName}</dd></div>
            <div><dt>File đáp án</dt><dd>{answerFileName}</dd></div>
            <div><dt>Số câu</dt><dd>{examData?.questions.length ?? 0} câu · thang {pointsConfig?.maxScore ?? 10} điểm</dd></div>
            <div><dt>Số lần làm</dt><dd>{maxAttempts} lần</dd></div>
            <div><dt>Mở lúc</dt><dd>{opensAt ? new Date(opensAt).toLocaleString('vi-VN') : 'Mở ngay'}</dd></div>
            <div><dt>Hạn nộp</dt><dd>{closesAt ? new Date(closesAt).toLocaleString('vi-VN') : 'Không giới hạn'}</dd></div>
          </dl>
          <p className="assign-confirm-note">Gemini không được gọi ở bước tạo đề; chỉ được gọi khi giáo viên bấm “AI chấm gợi ý”.</p>
          <div className="assign-confirm-actions">
            <button className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>Kiểm tra lại</button>
            <button className="btn btn-primary" onClick={saveAssignment} disabled={saving}>
              <Send size={16} /> {saving ? 'Đang giao...' : `Giao cho ${selectedClasses.length} lớp`}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
