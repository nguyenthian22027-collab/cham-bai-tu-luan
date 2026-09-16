function normalizeType(q) {
  if (['multiple_choice', 'true_false', 'short_answer', 'writing'].includes(q.type)) return q.type;
  if (q.tfStatements && Object.keys(q.tfStatements).length) return 'true_false';
  if (q.options && q.options.length) return 'multiple_choice';
  return 'short_answer';
}

function parseTFCorrectSet(answer) {
  return new Set(String(answer || '').toLowerCase().replace(/[^a-z,]/g, '').split(',').map((s) => s.trim()).filter(Boolean));
}

function parseTFAnswerStrict(answer, letters) {
  const map = {};
  if (!answer || !String(answer).trim()) return map;
  const text = String(answer);
  if (text.includes(':')) {
    for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
      const [letter, val] = part.split(':');
      if (letter && (val === 'T' || val === 'F')) map[letter.toLowerCase()] = val;
    }
    return map;
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      const trueLetters = new Set(Object.keys(parsed).filter((k) => parsed[k] === true).map((k) => k.toLowerCase()));
      for (const letter of letters) map[letter] = trueLetters.has(letter) ? 'T' : 'F';
      return map;
    }
  } catch {}
  const trueLetters = new Set(text.toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
  for (const letter of letters) map[letter] = trueLetters.has(letter) ? 'T' : 'F';
  return map;
}

function normalizeAnswer(answer) {
  if (!answer) return '';
  let norm = String(answer).toLowerCase().replace(/\s+/g, '').replace(/,/g, '.')
    .replace(/\\frac\{(-?[\d.]+)\}\{(-?[\d.]+)\}/g, (_m, a, b) => {
      const num = Number(a), den = Number(b);
      return den !== 0 && Number.isFinite(num / den) ? String(num / den) : `${a}/${b}`;
    }).replace(/[{}$\\]/g, '').trim();
  const frac = norm.match(/^(-?[\d.]+)\/(-?[\d.]+)$/);
  if (frac) {
    const num = Number(frac[1]), den = Number(frac[2]);
    if (den !== 0 && Number.isFinite(num / den)) norm = String(num / den);
  }
  const num = Number(norm);
  return !Number.isNaN(num) && norm !== '' ? num.toString() : norm;
}

function questionPoints(q, config) {
  const type = normalizeType(q);
  const section = config?.sections?.find((s) => s.sectionId === type);
  return {
    maxPoints: section ? Number(section.pointsPerQuestion) || 0 : (Number(q.points) > 0 ? Number(q.points) : 1),
    tfMode: section?.trueFalseMode || 'stepped',
  };
}

function trueFalsePoints(correctCount, maxPoints, mode, total) {
  if (correctCount <= 0) return 0;
  if (mode === 'equal') return Number(((maxPoints / Math.max(total, 1)) * correctCount).toFixed(4));
  if (correctCount >= total) return maxPoints;
  const ratio = ({ 1: 0.1, 2: 0.25, 3: 0.5 })[correctCount] ?? Math.min(1, correctCount / Math.max(total, 1));
  return Number((maxPoints * ratio).toFixed(4));
}

function scoreQuestion(q, userAnswer, config) {
  const type = normalizeType(q);
  const { maxPoints, tfMode } = questionPoints(q, config);
  if (type === 'writing') return { points: 0, maxPoints, status: 'pending' };
  const hasAnswer = Boolean(userAnswer && String(userAnswer).trim());

  if (type === 'true_false') {
    const letters = q.options?.length ? q.options.map((o) => String(o.letter).toLowerCase())
      : q.tfStatements && Object.keys(q.tfStatements).length ? Object.keys(q.tfStatements).map((x) => x.toLowerCase())
      : ['a', 'b', 'c', 'd'];
    if (!q.correctAnswer) return { points: 0, maxPoints, status: hasAnswer ? 'wrong' : 'unanswered', tfCorrectCount: 0, tfTotal: letters.length };
    const correct = parseTFCorrectSet(q.correctAnswer);
    const answers = parseTFAnswerStrict(userAnswer, letters);
    let correctCount = 0, answeredCount = 0;
    for (const letter of letters) {
      const val = answers[letter];
      if (val === undefined) continue;
      answeredCount++;
      if ((val === 'T') === correct.has(letter)) correctCount++;
    }
    const points = answeredCount ? trueFalsePoints(correctCount, maxPoints, tfMode, letters.length) : 0;
    const status = answeredCount === 0 ? 'unanswered'
      : correctCount === letters.length && answeredCount === letters.length ? 'correct'
      : correctCount > 0 ? 'partial' : 'wrong';
    return { points, maxPoints, status, tfCorrectCount: correctCount, tfTotal: letters.length };
  }

  if (type === 'multiple_choice') {
    if (!hasAnswer) return { points: 0, maxPoints, status: 'unanswered' };
    const correct = Boolean(q.correctAnswer) && String(userAnswer).trim().toUpperCase() === String(q.correctAnswer).trim().toUpperCase();
    return { points: correct ? maxPoints : 0, maxPoints, status: correct ? 'correct' : 'wrong' };
  }

  if (!hasAnswer) return { points: 0, maxPoints, status: 'unanswered' };
  const correct = Boolean(q.correctAnswer) && normalizeAnswer(userAnswer) === normalizeAnswer(q.correctAnswer);
  return { points: correct ? maxPoints : 0, maxPoints, status: correct ? 'correct' : 'wrong' };
}

export function calculateAutoScore(questions, answers, config) {
  const questionResults = {};
  let autoScore = 0, maxScore = 0, correctCount = 0, wrongCount = 0, pendingCount = 0;
  for (const q of questions || []) {
    const result = scoreQuestion(q, answers?.[String(q.number)], config);
    questionResults[String(q.number)] = result;
    autoScore += result.points;
    maxScore += result.maxPoints;
    if (result.status === 'pending') pendingCount++;
    else if (result.status === 'correct') correctCount++;
    else if (result.status === 'wrong' || result.status === 'unanswered') wrongCount++;
  }
  if (config?.maxScore) maxScore = Number(config.maxScore);
  return {
    autoScore: Number(autoScore.toFixed(2)),
    maxScore: Number(maxScore.toFixed(2)),
    correctCount,
    wrongCount,
    pendingCount,
    questionResults,
  };
}
