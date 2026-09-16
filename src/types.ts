// ====== ROLES ======
export enum Role {
  ADMIN = 'ADMIN',
  TEACHER = 'TEACHER',
  TA = 'TA',
  STUDENT = 'STUDENT',
}

export const ROLE_LABEL: Record<Role, string> = {
  [Role.ADMIN]: 'Quản trị viên',
  [Role.TEACHER]: 'Giáo viên',
  [Role.TA]: 'Trợ giảng',
  [Role.STUDENT]: 'Học sinh',
};

// ====== USER ======
export interface AppUser {
  id: string; // Firebase UID
  name: string;
  email?: string;
  avatar?: string;
  role: Role;
  isApproved: boolean;
  createdAt?: Date;
  studentId?: string;
  classIds?: string[];
}

// ====== CLASS ======
export type Status = 'ACTIVE' | 'INACTIVE';

export interface ClassItem {
  id: string;
  className: string;
  subject: string;
  grade: string;
  feePerSession: number;
  startDate: string; // YYYY-MM-DD
  status: Status;
  createdAt?: Date;
}

// ====== STUDENT ======
export interface Student {
  id: string;
  fullName: string;
  studentClass: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  studentEmail: string; // Gmail học sinh dùng để tự liên kết đăng nhập Google
  note: string;
  status: Status;
  createdAt?: Date;
}

// ====== ENROLLMENT (student <-> class) ======
export interface Enrollment {
  id: string;
  studentId: string;
  classId: string;
}

// ====== CLASS TEACHER (user <-> class) ======
export interface ClassTeacher {
  id: string;
  teacherId: string;
  classId: string;
}

// ====== ATTENDANCE ======
export interface AttendanceRecord {
  id: string;
  classId: string;
  studentId: string;
  date: string; // YYYY-MM-DD
  present: boolean;
  note: string;
}

// ====== SCORE - LEGACY ======
// Giữ lại để trang phụ huynh / dữ liệu cũ vẫn hoạt động.
export interface ScoreRecord {
  id: string;
  classId: string;
  studentId: string;
  examName: string;
  score: number;
  maxScore: number;
  date: string;
  note: string;
}

// ====== GRADEBOOK - NEW EXCEL-LIKE SCORE ENTRY ======
export type GradeColumnType = 'REGULAR' | 'MIDTERM' | 'FINAL' | 'OTHER';

export const GRADE_COLUMN_TYPE_LABEL: Record<GradeColumnType, string> = {
  REGULAR: 'Thường xuyên',
  MIDTERM: 'Giữa kỳ',
  FINAL: 'Cuối kỳ',
  OTHER: 'Khác',
};

export interface Gradebook {
  id: string;
  classId: string;
  className: string;
  subject: string;
  grade: string;
  semester: string;
  schoolYear: string;
  createdBy?: string;
  legacyMigrated?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface GradeColumn {
  id: string;
  name: string;
  type: GradeColumnType;
  maxScore: number;
  weight: number;
  order: number;
  examDate: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface GradeRow {
  id: string; // = studentId
  studentId: string;
  fullName: string;
  studentClass: string;
  scores: Record<string, number>; // { [columnId]: score }
  average10: number | null;
  updatedAt?: Date;
  updatedBy?: string;
}

// ====== PAYMENT / VIETQR ======
export type PaymentMode = 'GLOBAL' | 'CLASS';
export type TuitionPaymentStatus = 'UNPAID' | 'PAID';

export interface PaymentConfig {
  bankId: string;
  bankAccount: string;
  bankAccountName: string;
  centerName: string;
  qrTemplate: string;
  notePattern: string;
}

export interface ClassPaymentConfig {
  classId: string;
  mode: PaymentMode; // GLOBAL = dùng tài khoản chung; CLASS = dùng tài khoản riêng của lớp
  bankId: string;
  bankAccount: string;
  bankAccountName: string;
  qrTemplate: string;
  notePattern: string;
  isEnabled: boolean;
  updatedAt?: Date;
  updatedBy?: string;
}

export interface TuitionPaymentRecord {
  id: string;
  classId: string;
  studentId: string;
  monthKey: string; // YYYY-MM
  amount: number;
  transferNote: string;
  status: TuitionPaymentStatus;
  confirmedAt?: Date;
  confirmedBy?: string;
  confirmedByName?: string;
  note?: string;
  updatedAt?: Date;
}

// ====== DASHBOARD ======
export interface DashboardStats {
  totalStudents: number;
  totalClasses: number;
  totalTeachers: number;
  totalTAs: number;
  presentToday: number;
  totalAttToday: number;
}

// ====== TUITION ======
export interface TuitionStudentRow {
  studentId: string;
  fullName: string;
  sessionsTotal: number;
  sessionsAttended: number;
  sessionsAbsent: number;
  feePerSession: number;
  tuition: number;
  paymentStatus?: TuitionPaymentStatus;
  paidAt?: Date;
  transferNote?: string;
}

export interface TuitionData {
  classInfo: ClassItem;
  students: TuitionStudentRow[];
}

// ====== PARENT REPORT ======
export interface ParentClassReport {
  classId: string;
  className: string;
  subject: string;
  grade: string;
  feePerSession: number;
  sessionsTotal: number;
  sessionsAttended: number;
  tuition: number;
  scores: ScoreRecord[];
  attendance: AttendanceRecord[];
  average10?: number | null;
}

export interface ParentReport {
  student: Student;
  classes: ParentClassReport[];
}

// ============================================================
//  ASSIGNMENTS / ONLINE HOMEWORK & EXAMS
// ============================================================
export type QuestionType = 'multiple_choice' | 'true_false' | 'short_answer' | 'writing' | 'unknown';
export type AssignmentMode = 'homework' | 'exam';
export type AssignmentStatus = 'draft' | 'published' | 'closed';
export type TargetStatus = 'assigned' | 'in_progress' | 'submitted' | 'graded';
export type SubmissionStatus = 'in_progress' | 'submitted' | 'graded';
export type GradingStatus = 'NOT_GRADED' | 'AI_SUGGESTED' | 'GRADED';
export type EssayStepStatus = 'correct' | 'partial' | 'incorrect';

// ====== CẤU HÌNH ĐIỂM TÙY CHỈNH ======
export type TrueFalseMode = 'equal' | 'stepped';

export interface SectionPointsConfig {
  sectionId: string; // 'multiple_choice' | 'true_false' | 'short_answer' | 'writing'
  sectionName: string;
  questionType: Exclude<QuestionType, 'unknown'>;
  totalQuestions: number;
  totalPoints: number;
  pointsPerQuestion: number;
  trueFalseMode?: TrueFalseMode; // chỉ dùng cho Đúng/Sai
}

export interface ExamPointsConfig {
  maxScore: number;
  sections: SectionPointsConfig[];
  autoBalance?: boolean;
}

// ====== KẾT QUẢ TỪNG CÂU (lưu khi nộp để học sinh xem lại) ======
export type QuestionResultStatus = 'correct' | 'partial' | 'wrong' | 'unanswered' | 'pending';

export interface QuestionResult {
  points: number;      // điểm đạt được
  maxPoints: number;   // điểm tối đa của câu
  status: QuestionResultStatus; // pending = tự luận chờ chấm
  tfCorrectCount?: number;      // Đúng/Sai: số ý đúng
  tfTotal?: number;             // Đúng/Sai: tổng số ý
}

export interface ImageData {
  id: string;
  rId?: string;
  filename: string;
  base64?: string;
  contentType: string;
}

export interface QuestionOption {
  letter: string;
  text: string;
  isCorrect?: boolean;
}

export interface Question {
  number: number;
  text: string;
  type: QuestionType;
  options?: QuestionOption[];
  tfStatements?: Record<string, string>;
  correctAnswer?: string | null;
  solution?: string;
  solutionImages?: ImageData[]; // hình trong file Word đáp án, chỉ để giáo viên đối chiếu
  images?: ImageData[];
  points?: number;
  part?: string;
  section?: {
    letter?: string;
    name?: string;
    points?: string;
  };
}

export interface ExamSection {
  name: string;
  description?: string;
  points?: string;
  questions: Question[];
  sectionType?: QuestionType;
}

export interface ExamData {
  title: string;
  timeLimit?: number;
  sections: ExamSection[];
  questions: Question[];
  answers?: Record<number, string>;
  images?: ImageData[];
}

export interface AssignmentExam {
  id: string;
  title: string;
  subject: string;
  questions: Question[];
  sections?: ExamSection[];
  images?: ImageData[];
  totalQuestions: number;
  maxScore: number;
  pointsConfig?: ExamPointsConfig; // cấu hình điểm tùy chỉnh (nếu có)
  sourceFileName?: string;
  answerSourceFileName?: string;
  createdBy: string;
  createdByName?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface Assignment {
  id: string;
  examId: string;
  title: string;
  description: string;
  classId: string;
  className: string;
  mode: AssignmentMode;
  status: AssignmentStatus;
  opensAt?: Date;
  closesAt?: Date;
  timeLimit: number; // minutes; 0 = không giới hạn với bài tập
  allowResubmit: boolean;
  maxAttempts: number; // 🆕 số lần học sinh được vào làm (1–3). 1 = chỉ làm một lần
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  antiCheat: boolean;
  resultVisibility: 'score_only' | 'full_review'; // 🆕 score_only = chỉ thấy điểm; full_review = cho xem đáp án
  answersReleasedAt?: Date;   // 🆕 thời điểm giáo viên cho xem đáp án
  answersReleasedBy?: string; // 🆕 người cho xem đáp án
  batchId?: string;           // 🆕 gom nhóm khi giao 1 đề cho nhiều lớp
  assignedBy: string;
  assignedByName?: string;
  assignedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AssignmentTarget {
  id: string; // assignmentId__studentId
  assignmentId: string;
  examId: string;
  classId: string;
  className: string;
  studentId: string;
  studentName: string;
  status: TargetStatus;
  openedAt?: Date;
  startedAt?: Date;
  submittedAt?: Date;
  gradedAt?: Date;
  autoScore?: number;
  aiScore?: number;
  finalScore?: number;
  maxScore?: number;
}

export interface Submission {
  id: string; // assignmentId__studentId
  assignmentId: string;
  examId: string;
  classId: string;
  studentId: string;
  studentName: string;
  answers: Record<string, string>; // key = question.number
  status: SubmissionStatus;
  autoScore: number;
  finalScore?: number;
  maxScore: number;
  correctCount: number;
  wrongCount: number;
  totalQuestions: number;
  pendingCount?: number; // số câu tự luận đang chờ giáo viên xác nhận điểm
  questionResults?: Record<string, QuestionResult>; // kết quả từng câu, lưu khi nộp
  startedAt?: Date;
  updatedAt?: Date;
  submittedAt?: Date;
  gradedAt?: Date;
  gradedBy?: string;
  gradedByName?: string;
  tabSwitchCount?: number;
  tabSwitchWarnings?: string[];
  autoSubmitted?: boolean;
  attemptCount?: number; // 🆕 số lần đã nộp (mỗi lần "làm lại" +1)
}

export interface EssayStoredImage {
  fileId: string;
  url: string;
  thumbnailUrl?: string;
  mimeType: string;
  fileName: string;
  size?: number;
}

export interface EssayStepFeedback {
  studentText: string;
  status: EssayStepStatus;
  comment: string;
  correction?: string;
  page?: number;
  x?: number;
  y?: number;
  awardedPoints?: number;
  maxPoints?: number;
  source?: 'ai' | 'manual';
}

export interface EssayAiDetails {
  summary: string;
  feedbackMarkdown: string;
  steps: EssayStepFeedback[];
}

export interface SubmissionGrade {
  id: string; // submissionId__questionNumber or submissionId__FINAL
  submissionId: string;
  assignmentId: string;
  studentId: string;
  questionNumber: number | 'FINAL';
  score: number;
  maxScore: number;
  feedback: string;
  aiScore?: number;
  aiFeedback?: string;
  aiDetails?: EssayAiDetails;
  status: GradingStatus;
  gradedBy?: string;
  gradedByName?: string;
  updatedAt?: Date;
}

export interface PublicEssayResultQuestion {
  number: number;
  text: string;
  points: number;
  solution?: string;
  answerText: string;
  images: EssayStoredImage[];
  score: number;
  maxScore: number;
  feedback: string;
  aiDetails?: EssayAiDetails;
}

export interface PublicEssayResult {
  token: string;
  submissionId: string;
  assignmentId: string;
  title: string;
  className: string;
  studentName: string;
  teacherName?: string;
  finalScore: number;
  maxScore: number;
  finalFeedback: string;
  publishedAt: string;
  expiresAt?: string | null;
  questions: PublicEssayResultQuestion[];
}

export interface PublishedEssayLink {
  token: string;
  url: string;
  active: boolean;
  parentName?: string;
  parentPhone?: string;
  publishedAt?: string;
}

export interface StudentAccount {
  id: string; // username
  username: string;
  email: string;
  uid: string;
  studentId: string;
  studentName: string;
  classIds: string[];
  className?: string;
  isActive: boolean;
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface CreateStudentAccountInput {
  username: string;
  password: string;
  studentId: string;
  studentName: string;
  classIds: string[];
  className?: string;
  createdBy?: string;
}

// ============================================================
//  STAFF / ATTENDANCE / PAYROLL
// ============================================================
export type StaffPosition = 'TEACHER' | 'TA';
export type EmploymentStatus = 'ACTIVE' | 'INACTIVE';
export type PayrollMode =
  | 'MONTHLY'
  | 'DAILY'
  | 'SESSION'
  | 'HOURLY'
  | 'CLASS_SESSION'
  | 'HYBRID';
export type MonthlyProrationMode = 'FIXED' | 'PRORATE_BY_DAY' | 'PRORATE_BY_HOUR';
export type StaffDutyType = 'TEACHING' | 'ASSISTING' | 'OFFICE' | 'ADMIN' | 'OTHER';
export type StaffAttendanceStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'PAID_LEAVE'
  | 'UNPAID_LEAVE'
  | 'HOLIDAY'
  | 'CANCELLED';
export type AttendanceApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'LOCKED';
export type PayrollStatementStatus = 'DRAFT' | 'REVIEWED' | 'LOCKED' | 'PAID';
export type SalaryPaymentStatus = 'UNPAID' | 'PAID' | 'CANCELLED';
export type PayrollAdjustmentType = 'ALLOWANCE' | 'BONUS' | 'DEDUCTION' | 'ADVANCE' | 'OTHER';

export interface StaffProfile {
  id: string; // Firebase UID
  staffCode: string;
  fullName: string;
  position: StaffPosition;
  phone: string;
  email: string;
  employmentStatus: EmploymentStatus;
  joinedDate: string;
  leftDate?: string;
  bankId: string;
  bankAccount: string;
  bankAccountName: string;
  defaultPayrollPolicyId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  bankUpdatedAt?: Date;
}

export interface StaffAssignment {
  id: string;
  staffId: string;
  staffName: string;
  classId?: string;
  className?: string;
  dutyType: StaffDutyType;
  startDate: string;
  endDate?: string;
  daysOfWeek: number[]; // 1 = Thứ Hai ... 7 = Chủ nhật
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  breakMinutes: number;
  payModeOverride?: PayrollMode;
  rateOverride?: number;
  status: Status;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
}

export interface StaffShift {
  id: string;
  assignmentId?: string;
  staffId: string;
  staffName: string;
  classId?: string;
  className?: string;
  dutyType: StaffDutyType;
  dateKey: string;
  monthKey: string;
  plannedStart: Date;
  plannedEnd: Date;
  breakMinutes: number;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED';
  createdAt?: Date;
  createdBy?: string;
}

export interface StaffCheckEvent {
  id: string;
  staffId: string;
  shiftId?: string;
  assignmentId?: string;
  type: 'CHECK_IN' | 'CHECK_OUT';
  dateKey: string;
  monthKey: string;
  createdAt: Date;
  deviceId?: string;
  qrTokenId?: string;
  note?: string;
}

export interface StaffAttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  shiftId?: string;
  assignmentId?: string;
  classId?: string;
  className?: string;
  dutyType?: StaffDutyType;
  dateKey: string;
  monthKey: string;
  plannedStart?: Date;
  plannedEnd?: Date;
  actualCheckIn?: Date;
  actualCheckOut?: Date;
  plannedMinutes: number;
  actualMinutes: number;
  payableMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  overtimeMinutes: number;
  unpaidBreakMinutes: number;
  sessions: number;
  dayUnits: number;
  status: StaffAttendanceStatus;
  approvalStatus: AttendanceApprovalStatus;
  multiplier: number;
  payModeOverride?: PayrollMode;
  rateOverride?: number;
  note?: string;
  approvedBy?: string;
  approvedAt?: Date;
  updatedAt?: Date;
}

export interface StaffAttendanceCorrection {
  id: string;
  staffId: string;
  attendanceId?: string;
  dateKey: string;
  reason: string;
  requestedCheckIn?: Date;
  requestedCheckOut?: Date;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  adminNote?: string;
  createdAt?: Date;
  reviewedAt?: Date;
  reviewedBy?: string;
}

export interface HolidayConfig {
  id: string; // YYYY-MM-DD
  date: string;
  name: string;
  multiplier: number;
  appliesTo: 'ALL' | 'TEACHER' | 'TA' | 'SELECTED_STAFF';
  selectedStaffIds?: string[];
  stackable: boolean;
  note?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface PayrollPolicy {
  id: string;
  name: string;
  staffId?: string; // bỏ trống nếu là chính sách mẫu dùng chung
  mode: PayrollMode;
  monthlyProration: MonthlyProrationMode;
  monthlySalary: number;
  dailyRate: number;
  sessionRate: number;
  hourlyRate: number;
  classSessionRates: Record<string, number>;
  standardWorkDays: number;
  standardMonthlyMinutes: number;
  graceLateMinutes: number;
  graceEarlyMinutes: number;
  roundingMinutes: 0 | 5 | 10 | 15 | 30;
  minimumPayableMinutes: number;
  maximumPayableMinutes?: number;
  defaultBreakMinutes: number;
  countLateAsDeduction: boolean;
  countEarlyLeaveAsDeduction: boolean;
  allowOvertime: boolean;
  overtimeMultiplier: number;
  holidayMultiplierFallback: number;
  active: boolean;
  version: number;
  createdAt?: Date;
  updatedAt?: Date;
  updatedBy?: string;
}

export interface PayrollAdjustment {
  id: string;
  staffId: string;
  monthKey: string;
  type: PayrollAdjustmentType;
  amount: number;
  description: string;
  createdAt?: Date;
  createdBy?: string;
}

export interface PayrollPeriod {
  id: string; // YYYY-MM
  monthKey: string;
  status: 'OPEN' | 'CALCULATED' | 'REVIEWED' | 'LOCKED' | 'PAID';
  calculatedAt?: Date;
  reviewedAt?: Date;
  lockedAt?: Date;
  paidAt?: Date;
  updatedBy?: string;
}

export interface PayrollBreakdown {
  fixedSalary: number;
  daySalary: number;
  sessionSalary: number;
  hourlySalary: number;
  classSessionSalary: number;
  overtimeSalary: number;
  holidayPremium: number;
  allowances: number;
  bonuses: number;
  deductions: number;
  advances: number;
  otherAdjustments: number;
  workingDays: number;
  sessions: number;
  regularMinutes: number;
  overtimeMinutes: number;
  holidayMinutes: number;
  absentDays: number;
}

export interface PayrollStatement {
  id: string; // YYYY-MM__staffId
  monthKey: string;
  staffId: string;
  staffName: string;
  staffCode: string;
  position: StaffPosition;
  policyId: string;
  policyName: string;
  policyVersion: number;
  breakdown: PayrollBreakdown;
  grossSalary: number;
  netSalary: number;
  bankSnapshot: {
    bankId: string;
    bankAccount: string;
    bankAccountName: string;
  };
  transferNote: string;
  status: PayrollStatementStatus;
  calculatedAt?: Date;
  calculatedBy?: string;
  reviewedAt?: Date;
  reviewedBy?: string;
  lockedAt?: Date;
  lockedBy?: string;
  paidAt?: Date;
  paidBy?: string;
  transactionReference?: string;
}

export interface SalaryPayment {
  id: string;
  statementId: string;
  staffId: string;
  monthKey: string;
  amount: number;
  transferNote: string;
  status: SalaryPaymentStatus;
  transactionReference?: string;
  paidAt?: Date;
  paidBy?: string;
  note?: string;
  updatedAt?: Date;
}
