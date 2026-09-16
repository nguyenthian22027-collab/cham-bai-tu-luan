import { useEffect, useMemo, useRef, useState } from 'react';
import { typesetMath } from '../utils/mathJax';

interface Props {
  markdown?: string;
  className?: string;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Gemini đôi khi vô tình bọc cả một đoạn tiếng Việt trong một cặp $...$.
 * Chỉ sửa trường hợp rất rõ: vùng math có tiếng Việt và có các biểu thức
 * đơn giản dạng x=5, x_2=-19, x>0. Math hợp lệ thông thường được giữ nguyên.
 */
function repairOverextendedInlineMath(value: string) {
  const proseHint = /(?:[ăâđêôơưĂÂĐÊÔƠƯáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]|\b(?:và|em|chưa|đối|chiếu|điều|kiện|để|ghi|nhận|loại|nên|chiều|rộng|dài|sau|khi|tính|ra|hai|nghiệm|là|cần|bị|viết)\b)/i;
  const simpleExpression = /[A-Za-z](?:_[A-Za-z0-9{}]+)?(?:\^\{?[-A-Za-z0-9]+\}?)?\s*(?:=|>|<|\\geq?|\\leq?|\\ne(?:q)?)\s*[-+]?(?:\d+(?:[.,]\d+)?|[A-Za-z](?:_[A-Za-z0-9{}]+)?)/g;

  return value.replace(/\$([^$\n]{1,600})\$/g, (whole, inner: string) => {
    if (!proseHint.test(inner) || /\\text\s*\{/.test(inner)) return whole;
    const matches = [...inner.matchAll(simpleExpression)];
    if (!matches.length) return whole;

    let cursor = 0;
    let rebuilt = '';
    for (const match of matches) {
      const index = match.index ?? 0;
      rebuilt += inner.slice(cursor, index);
      rebuilt += `$${match[0].trim()}$`;
      cursor = index + match[0].length;
    }
    rebuilt += inner.slice(cursor);
    return rebuilt;
  });
}

function normalizeReadableMarkdown(markdown: string) {
  return repairOverextendedInlineMath(String(markdown || ''))
    .replace(/\\n/g, '\n')
    .replace(/(^|\s)#{1,6}\s+/g, '$1')
    .replace(/\s+(?=\d+\.\s+\*\*)/g, '\n')
    .replace(/\s+-\s+(?=\*\*)/g, '\n- ')
    .replace(/(?<!-)(?<!\d\.)\s+(?=\*\*[^*\n]{2,80}(?:\*\*\s*:|:\*\*))/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MATH_RE = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$(?:\\.|[^$\n])+?\$)/g;

function protectMath(source: string) {
  const math: string[] = [];
  const nonce = Math.random().toString(36).slice(2, 10).toUpperCase();
  const prefix = `MATHPLACEHOLDER${nonce}X`;
  const protectedSource = source.replace(MATH_RE, (match) => {
    const index = math.push(match) - 1;
    return `${prefix}${index}Z`;
  });

  return {
    protectedSource,
    restore(html: string) {
      return html.replace(new RegExp(`${prefix}(\\d+)Z`, 'g'), (_full, rawIndex) => {
        const item = math[Number(rawIndex)] || '';
        // Restore dưới dạng text an toàn; browser decode entity trước khi MathJax đọc.
        return escapeHtml(item);
      });
    },
  };
}

function fallbackHtml(source: string) {
  return `<p>${escapeHtml(source).replace(/\n/g, '<br>')}</p>`;
}

function renderMarkdown(markdown: string) {
  const source = normalizeReadableMarkdown(markdown);
  const { protectedSource, restore } = protectMath(source);

  const converter = window.showdown
    ? new window.showdown.Converter({
        tables: true,
        strikethrough: true,
        tasklists: true,
        simpleLineBreaks: true,
        openLinksInNewWindow: true,
        ghCodeBlocks: true,
      })
    : null;

  if (!converter || !window.DOMPurify) return fallbackHtml(source);

  const converted = converter.makeHtml(protectedSource);
  const sanitized = window.DOMPurify.sanitize(converted, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'rel'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form'],
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'style'],
  });
  return restore(sanitized);
}

function waitForMarkdownLibraries(timeoutMs = 10_000): Promise<void> {
  if (window.showdown && window.DOMPurify) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if ((window.showdown && window.DOMPurify) || Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve();
      }
    }, 100);
  });
}

export default function MarkdownMath({ markdown = '', className = '' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const normalized = useMemo(() => normalizeReadableMarkdown(markdown), [markdown]);
  const [html, setHtml] = useState(() => fallbackHtml(normalized));

  useEffect(() => {
    let cancelled = false;
    // Hiện text ngay, sau đó nâng cấp sang Markdown khi CDN đã sẵn sàng.
    setHtml(fallbackHtml(normalized));
    waitForMarkdownLibraries().then(() => {
      if (!cancelled) setHtml(renderMarkdown(markdown));
    });
    return () => { cancelled = true; };
  }, [markdown, normalized]);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    typesetMath(node).catch((error) => {
      if (!cancelled) console.warn('MarkdownMath render error:', error);
    });
    return () => { cancelled = true; };
  }, [html]);

  return (
    <div
      ref={ref}
      className={`markdown-math ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
