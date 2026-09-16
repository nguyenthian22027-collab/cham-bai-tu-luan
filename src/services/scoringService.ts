/**
 * Scoring Service — Hệ thống chấm điểm cho Bài tập & Kiểm tra online
 *
 * ✅ Hỗ trợ cấu hình điểm tùy chỉnh theo từng phần (ExamPointsConfig)
 * ✅ Đúng/Sai: 2 chế độ chấm — 'equal' (chia đều theo ý) / 'stepped' (thang bậc BGD)
 * ✅ Trả về kết quả chi tiết từng câu (QuestionResult) để học sinh xem lại ngay sau khi nộp
 * ✅ Tự luận (writing): KHÔNG chấm tự động → status 'pending', chờ GV/AI chấm
 *
 * Giữ backward-compat: calculateAutoScore(questions, answers) không cần config
 * vẫn hoạt động như cũ (dùng q.points của từng câu).
 */

import {
  ExamPointsConfig,
  Question,
  QuestionResult,
  QuestionType,
  SectionPointsConfig,
  TrueFalseMode,
} from '../types';

export type { TrueFalseMode };

// ─────────────────────────────────────────────────────────────────────────────
// TRUE / FALSE — parse & serialize câu trả lời
//
// Format MỚI : "a:T,b:F,c:T,d:F"   — mỗi mệnh đề có nhãn T/F rõ ràng
// Format CŨ  : "a,c"                — letter đơn = TRUE (backward-compat)
// Format JSON: {"a":true,"c":true}  — backward-compat
// ─────────────────────────────────────────────────────────────────────────────

/** Parse cho mục đích HIỂN THỊ: letter không xuất hiện = chưa trả lời. */
export function parseTFAnswer(answer?: string): Record<string, 'T' | 'F'> {
  const map: Record<string, 'T' | 'F'> = {};
  if (!answer || !answer.trim()) return map;

  try {
    const parsed = JSON.parse(answer);
    if (typeof parsed === 'object' && parsed !== null) {
      for (const [key, val] of Object.entries(parsed)) {
        map[key.toLowerCase()] = val === true ? 'T' : 'F';
      }
      return map;
    }
  } catch {
    // không phải JSON
  }

  for (const part of answer.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part.includes(':')) {
      const [letter, val] = part.split(':');
      if (letter && (val === 'T' || val === 'F')) {
        map[letter.toLowerCase()] = val as 'T' | 'F';
      }
    } else {
      map[part.toLowerCase()] = 'T'; // format cũ: letter đơn = TRUE
    }
  }
  return map;
}

export function serializeTFAnswer(map: Record<string, 'T' | 'F'>): string {
  return Object.entries(map)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([letter, val]) => `${letter}:${val}`)
    .join(',');
}

/**
 * Parse cho mục đích CHẤM ĐIỂM (strict):
 * - Format mới "a:T,b:F"  → ý không có = chưa trả lời (bỏ qua khi chấm)
 * - Format cũ  "a,c"/JSON → điền đủ tất cả letters (không có = FALSE) để giữ
 *   nguyên cách chấm của submission cũ.
 */
function parseTFAnswerStrict(
  answer: string | undefined,
  allLetters: string[]
): Record<string, 'T' | 'F'> {
  const map: Record<string, 'T' | 'F'> = {};
  if (!answer || !answer.trim()) return map;

  if (answer.includes(':')) {
    for (const part of answer.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (part.includes(':')) {
        const [letter, val] = part.split(':');
        if (letter && (val === 'T' || val === 'F')) {
          map[letter.toLowerCase()] = val;
        }
      }
    }
    return map;
  }

  try {
    const parsed = JSON.parse(answer);
    if (typeof parsed === 'object' && parsed !== null) {
      const trueLetters = new Set(
        Object.keys(parsed).filter((k) => parsed[k] === true).map((k) => k.toLowerCase())
      );
      for (const letter of allLetters) {
        map[letter] = trueLetters.has(letter) ? 'T' : 'F';
      }
      return map;
    }
  } catch {
    // không phải JSON
  }

  const trueLetters = new Set(
    answer.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
  );
  for (const letter of allLetters) {
    map[letter] = trueLetters.has(letter) ? 'T' : 'F';
  }
  return map;
}

/** Đáp án đúng của câu Đúng/Sai trong đề lưu dạng "a,c" (các ý TRUE). */
export function parseTFCorrectSet(correctAnswer?: string | null): Set<string> {
  return new Set(
    (correctAnswer || '')
      .toLowerCase()
      .replace(/[^a-z,]/g, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TRẢ LỜI NGẮN — chuẩn hóa đáp án để so sánh
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeAnswer(answer: string): string {
  if (!answer) return '';
  // Xóa khoảng trắng, chữ thường, phẩy → chấm; bỏ \ và {} của LaTeX đơn giản
  let norm = answer
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/,/g, '.')
    .replace(/\\frac\{(-?[\d.]+)\}\{(-?[\d.]+)\}/g, (_m, a, b) => {
      const num = Number(a), den = Number(b);
      return den !== 0 && Number.isFinite(num / den) ? String(num / den) : `${a}/${b}`;
    })
    .replace(/[{}$\\]/g, '')
    .trim();

  // "a/b" dạng phân số thuần → đổi ra số thập phân để so sánh
  const frac = norm.match(/^(-?[\d.]+)\/(-?[\d.]+)$/);
  if (frac) {
    const num = Number(frac[1]), den = Number(frac[2]);
    if (den !== 0 && Number.isFinite(num / den)) norm = String(num / den);
  }

  const numValue = Number(norm);
  if (!isNaN(numValue) && norm !== '') {
    return numValue.toString(); // "0.10"→"0.1", ".5"→"0.5"
  }
  return norm;
}

// ─────────────────────────────────────────────────────────────────────────────
// CẤU HÌNH ĐIỂM
// ─────────────────────────────────────────────────────────────────────────────

function normalizeType(q: Question): Exclude<QuestionType, 'unknown'> {
  if (q.type === 'multiple_choice' || q.type === 'true_false' || q.type === 'short_answer' || q.type === 'writing') {
    return q.type;
  }
  if (q.tfStatements && Object.keys(q.tfStatements).length > 0) return 'true_false';
  if (q.options && q.options.length > 0) return 'multiple_choice';
  return 'short_answer';
}

const SECTION_NAME: Record<Exclude<QuestionType, 'unknown'>, string> = {
  multiple_choice: 'PHẦN 1. TRẮC NGHIỆM NHIỀU LỰA CHỌN',
  true_false: 'PHẦN 2. TRẮC NGHIỆM ĐÚNG / SAI',
  short_answer: 'PHẦN 3. TRẢ LỜI NGẮN',
  writing: 'PHẦN 4. TỰ LUẬN',
};

const SECTION_ORDER: Exclude<QuestionType, 'unknown'>[] = [
  'multiple_choice', 'true_false', 'short_answer', 'writing',
];

/**
 * Phát hiện các phần của đề theo LOẠI câu hỏi.
 * (Project này đánh số câu tuần tự 1..N nên gom phần theo type, không theo number.)
 */
export function detectSections(questions: Question[]): SectionPointsConfig[] {
  const countByType = new Map<Exclude<QuestionType, 'unknown'>, number>();
  questions.forEach((q) => {
    const t = normalizeType(q);
    countByType.set(t, (countByType.get(t) || 0) + 1);
  });

  const sections: SectionPointsConfig[] = [];
  for (const type of SECTION_ORDER) {
    const count = countByType.get(type) || 0;
    if (count === 0) continue;
    sections.push({
      sectionId: type,
      sectionName: SECTION_NAME[type],
      questionType: type,
      totalQuestions: count,
      totalPoints: 0,
      pointsPerQuestion: 0,
      trueFalseMode: type === 'true_false' ? 'stepped' : undefined,
    });
  }
  return sections;
}

/** Tạo cấu hình điểm mặc định (thang 10, chia theo tỷ lệ số câu). */
export function createDefaultPointsConfig(questions: Question[], maxScore = 10): ExamPointsConfig {
  const sections = detectSections(questions);
  const totalQuestions = Math.max(questions.length, 1);

  sections.forEach((section) => {
    const ratio = section.totalQuestions / totalQuestions;
    section.totalPoints = parseFloat((maxScore * ratio).toFixed(2));
    section.pointsPerQuestion = parseFloat((section.totalPoints / section.totalQuestions).toFixed(4));
  });

  rebalanceLastSection(sections, maxScore);
  return { maxScore, sections, autoBalance: false };
}

/** Điều chỉnh phần cuối để tổng đúng bằng thang điểm (khử sai số làm tròn). */
export function rebalanceLastSection(sections: SectionPointsConfig[], maxScore: number) {
  const currentTotal = sections.reduce((sum, s) => sum + s.totalPoints, 0);
  if (sections.length > 0 && Math.abs(currentTotal - maxScore) > 0.01) {
    const diff = maxScore - currentTotal;
    const last = sections.length - 1;
    sections[last].totalPoints = parseFloat((sections[last].totalPoints + diff).toFixed(2));
    sections[last].pointsPerQuestion = parseFloat(
      (sections[last].totalPoints / sections[last].totalQuestions).toFixed(4)
    );
  }
}

export function updateSectionPoints(
  config: ExamPointsConfig,
  sectionId: string,
  newTotalPoints: number
): ExamPointsConfig {
  const sections = config.sections.map((s) =>
    s.sectionId === sectionId
      ? {
          ...s,
          totalPoints: newTotalPoints,
          pointsPerQuestion: parseFloat((newTotalPoints / s.totalQuestions).toFixed(4)),
        }
      : s
  );
  return { ...config, sections };
}

export function validatePointsConfig(config: ExamPointsConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (config.maxScore <= 0) errors.push('Thang điểm phải lớn hơn 0');

  const totalPoints = config.sections.reduce((sum, s) => sum + s.totalPoints, 0);
  if (Math.abs(totalPoints - config.maxScore) > 0.01) {
    errors.push(`Tổng điểm các phần (${totalPoints.toFixed(2)}) phải bằng thang điểm (${config.maxScore})`);
  }
  config.sections.forEach((section) => {
    if (section.totalPoints < 0) errors.push(`Điểm phần "${section.sectionName}" không được âm`);
    if (section.totalQuestions <= 0) errors.push(`Số câu hỏi phần "${section.sectionName}" phải lớn hơn 0`);
  });
  return { valid: errors.length === 0, errors };
}

/** Lấy điểm tối đa + chế độ chấm Đ/S cho 1 câu (theo config; fallback q.points). */
export function getQuestionPoints(
  q: Question,
  config?: ExamPointsConfig | null
): { maxPoints: number; tfMode: TrueFalseMode } {
  const type = normalizeType(q);
  if (config) {
    const section = config.sections.find((s) => s.sectionId === type);
    if (section) {
      return {
        maxPoints: section.pointsPerQuestion || 0,
        tfMode: section.trueFalseMode ?? 'stepped',
      };
    }
  }
  return { maxPoints: Number(q.points) > 0 ? Number(q.points) : 1, tfMode: 'stepped' };
}

// ─────────────────────────────────────────────────────────────────────────────
// TÍNH ĐIỂM ĐÚNG/SAI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mode = 'equal'   → mỗi ý đúng = maxPoints / tổng số ý (chia đều)
 * mode = 'stepped' → thang bậc BGD (chuẩn với câu 4 ý):
 *   1 ý đúng → 10% · 2 ý → 25% · 3 ý → 50% · đúng hết → 100% · 0 ý → 0%
 */
export function calculateTrueFalsePoints(
  correctCount: number,
  maxPoints: number,
  mode: TrueFalseMode = 'stepped',
  totalStatements = 4
): number {
  if (correctCount <= 0) return 0;

  if (mode === 'equal') {
    const per = maxPoints / Math.max(totalStatements, 1);
    return parseFloat((per * correctCount).toFixed(4));
  }

  // stepped — thang bậc BGD
  if (correctCount >= totalStatements) return maxPoints;
  const ratios: Record<number, number> = { 1: 0.1, 2: 0.25, 3: 0.5 };
  const ratio = ratios[correctCount] ?? Math.min(1, correctCount / Math.max(totalStatements, 1));
  return parseFloat((maxPoints * ratio).toFixed(4));
}

// ─────────────────────────────────────────────────────────────────────────────
// CHẤM 1 CÂU — dùng chung cho lúc nộp bài (server-side logic) và xem lại
// ─────────────────────────────────────────────────────────────────────────────

export function scoreQuestion(
  q: Question,
  userAnswer: string | undefined,
  config?: ExamPointsConfig | null
): QuestionResult {
  const type = normalizeType(q);
  const { maxPoints, tfMode } = getQuestionPoints(q, config);

  // Tự luận: không chấm tự động
  if (type === 'writing') {
    return { points: 0, maxPoints, status: 'pending' };
  }

  const hasUserAnswer = Boolean(userAnswer && userAnswer.trim());

  // ── ĐÚNG / SAI ──
  if (type === 'true_false') {
    const letters =
      q.options && q.options.length > 0
        ? q.options.map((o) => o.letter.toLowerCase())
        : q.tfStatements && Object.keys(q.tfStatements).length > 0
        ? Object.keys(q.tfStatements).map((l) => l.toLowerCase())
        : ['a', 'b', 'c', 'd'];

    if (!q.correctAnswer) {
      return { points: 0, maxPoints, status: hasUserAnswer ? 'wrong' : 'unanswered', tfCorrectCount: 0, tfTotal: letters.length };
    }

    const correctTrueSet = parseTFCorrectSet(q.correctAnswer);
    const tfMap = parseTFAnswerStrict(userAnswer, letters);

    let correctCount = 0;
    let answeredCount = 0;
    for (const letter of letters) {
      const studentVal = tfMap[letter];
      if (studentVal === undefined) continue; // chưa trả lời ý này
      answeredCount++;
      const studentSaidTrue = studentVal === 'T';
      if (studentSaidTrue === correctTrueSet.has(letter)) correctCount++;
    }

    const points =
      answeredCount === 0 ? 0 : calculateTrueFalsePoints(correctCount, maxPoints, tfMode, letters.length);

    const status =
      answeredCount === 0
        ? 'unanswered'
        : correctCount === letters.length && answeredCount === letters.length
        ? 'correct'
        : correctCount > 0
        ? 'partial'
        : 'wrong';

    return { points, maxPoints, status, tfCorrectCount: correctCount, tfTotal: letters.length };
  }

  // ── TRẮC NGHIỆM ──
  if (type === 'multiple_choice') {
    if (!hasUserAnswer) return { points: 0, maxPoints, status: 'unanswered' };
    const isCorrect =
      Boolean(q.correctAnswer) &&
      userAnswer!.trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase();
    return { points: isCorrect ? maxPoints : 0, maxPoints, status: isCorrect ? 'correct' : 'wrong' };
  }

  // ── TRẢ LỜI NGẮN ──
  if (!hasUserAnswer) return { points: 0, maxPoints, status: 'unanswered' };
  const isCorrect =
    Boolean(q.correctAnswer) &&
    normalizeAnswer(userAnswer!) === normalizeAnswer(String(q.correctAnswer));
  return { points: isCorrect ? maxPoints : 0, maxPoints, status: isCorrect ? 'correct' : 'wrong' };
}

// ─────────────────────────────────────────────────────────────────────────────
// CHẤM TOÀN BÀI — gọi từ assignmentService.submitAssignment
// ─────────────────────────────────────────────────────────────────────────────

export interface AutoScoreResult {
  autoScore: number;
  maxScore: number;             // gồm cả điểm tự luận (tối đa của toàn đề)
  autoGradableMax: number;      // tối đa của phần chấm tự động (không gồm tự luận)
  correctCount: number;
  wrongCount: number;
  pendingCount: number;         // số câu tự luận chờ chấm
  questionResults: Record<string, QuestionResult>;
}

export function calculateAutoScore(
  questions: Question[],
  answers: Record<string, string>,
  config?: ExamPointsConfig | null
): AutoScoreResult {
  const questionResults: Record<string, QuestionResult> = {};
  let autoScore = 0;
  let maxScore = 0;
  let autoGradableMax = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let pendingCount = 0;

  for (const q of questions) {
    const result = scoreQuestion(q, answers[String(q.number)], config);
    questionResults[String(q.number)] = result;

    maxScore += result.maxPoints;
    autoScore += result.points;

    if (result.status === 'pending') {
      pendingCount++;
      continue;
    }
    autoGradableMax += result.maxPoints;
    if (result.status === 'correct') correctCount++;
    else if (result.status === 'wrong' || result.status === 'unanswered') wrongCount++;
    // 'partial' (Đ/S đúng một phần) không tính vào correct lẫn wrong
  }

  // Nếu có config → thang điểm chuẩn là config.maxScore (khử sai số cộng dồn)
  if (config?.maxScore) maxScore = config.maxScore;

  return {
    autoScore: parseFloat(autoScore.toFixed(2)),
    maxScore: parseFloat(maxScore.toFixed(2)),
    autoGradableMax: parseFloat(autoGradableMax.toFixed(2)),
    correctCount,
    wrongCount,
    pendingCount,
    questionResults,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HIỂN THỊ
// ─────────────────────────────────────────────────────────────────────────────

export function formatScore(score: number): string {
  const rounded = Math.round(score * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

export function getGrade(percentage: number): { grade: string; emoji: string; label: string; color: string } {
  if (percentage >= 90) return { grade: 'A+', emoji: '🏆', label: 'Xuất sắc', color: '#059669' };
  if (percentage >= 80) return { grade: 'A', emoji: '🌟', label: 'Giỏi', color: '#059669' };
  if (percentage >= 70) return { grade: 'B+', emoji: '👍', label: 'Khá', color: '#2563eb' };
  if (percentage >= 60) return { grade: 'B', emoji: '📚', label: 'Trung bình khá', color: '#2563eb' };
  if (percentage >= 50) return { grade: 'C', emoji: '💪', label: 'Trung bình', color: '#d97706' };
  if (percentage >= 40) return { grade: 'D', emoji: '📖', label: 'Yếu', color: '#ea580c' };
  return { grade: 'F', emoji: '😞', label: 'Cần cố gắng', color: '#dc2626' };
}
