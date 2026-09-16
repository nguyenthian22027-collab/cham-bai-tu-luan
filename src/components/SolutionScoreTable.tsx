import MathText from './MathText';

interface Props {
  content?: string;
  title?: string;
  className?: string;
}

interface ScoreRow {
  content: string;
  points: number | null;
}

function decodeBasicEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function plainText(value: string) {
  return decodeBasicEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parsePointOnly(value: string): number | null {
  const text = plainText(value)
    .replace(/^[-–—•]+\s*/, '')
    .replace(/[()[\]]/g, '')
    .trim();
  const match = text.match(/^(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:điểm|đ|pts?)?\s*[:.]?$/i);
  if (!match) return null;
  const parsed = Number(match[1].replace(',', '.'));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function splitLines(content: string) {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<div\b[^>]*>/gi, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => plainText(line).length > 0);
}

function parseTrailingPoint(line: string): { content: string; points: number } | null {
  const text = plainText(line);
  const match = text.match(/^(.*?)(?:\s{2,}|\s*[|;]\s*|\s*\()\s*(\d{1,3}(?:[.,]\d{1,3})?)\s*(?:điểm|đ|pts?)?\s*\)?\s*$/i);
  if (!match || !match[1].trim()) return null;
  const points = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(points) || points < 0 || points > 100) return null;
  const index = line.toLowerCase().lastIndexOf(match[2].toLowerCase());
  return { content: index > 0 ? line.slice(0, index).replace(/[\s|;(]+$/, '').trim() : match[1].trim(), points };
}

export function parseSolutionScoreRows(content: string): ScoreRow[] {
  const lines = splitLines(content);
  const rows: ScoreRow[] = [];
  let buffer: string[] = [];

  const flush = (points: number | null) => {
    if (!buffer.length) return;
    rows.push({ content: buffer.join('<br>'), points });
    buffer = [];
  };

  lines.forEach((line) => {
    const pointOnly = parsePointOnly(line);
    if (pointOnly !== null) {
      flush(pointOnly);
      return;
    }
    const trailing = parseTrailingPoint(line);
    if (trailing) {
      buffer.push(trailing.content);
      flush(trailing.points);
      return;
    }
    buffer.push(line);
  });
  flush(null);
  return rows;
}

function fmt(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

export default function SolutionScoreTable({ content = '', title = 'Hướng dẫn chấm', className = '' }: Props) {
  const rows = parseSolutionScoreRows(content);
  const scoredRows = rows.filter((row) => row.points !== null);
  if (!content.trim()) return null;
  if (scoredRows.length === 0) return <MathText html={content} block />;
  const total = scoredRows.reduce((sum, row) => sum + Number(row.points || 0), 0);

  return (
    <div className={`solution-score-wrap ${className}`.trim()}>
      <table className="solution-score-table">
        <thead>
          <tr><th style={{ width: 54 }}>STT</th><th>{title}</th><th style={{ width: 110 }}>Điểm</th></tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}_${plainText(row.content).slice(0, 40)}`}>
              <td className="solution-score-index">{index + 1}</td>
              <td><MathText html={row.content} block /></td>
              <td className="solution-score-points">{row.points === null ? '—' : fmt(row.points)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr><td colSpan={2}>Tổng điểm nhận dạng từ đáp án</td><td className="solution-score-points">{fmt(total)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}
