import React, { useEffect, useRef, memo } from 'react';
import { typesetMath } from '../utils/mathJax';

interface MathTextProps {
  html: string;
  className?: string;
  block?: boolean;
}

/**
 * Renderer nhẹ cho nội dung HTML/LaTeX đã được hệ thống sinh sẵn.
 * Với nhận xét Markdown + LaTeX hãy dùng MarkdownMath thay vì component này.
 */
const MathText: React.FC<MathTextProps> = ({ html, className = '', block = false }) => {
  const ref = useRef<HTMLElement>(null);
  const renderedRef = useRef<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const next = html || '';
    if (renderedRef.current === next) return;

    el.innerHTML = next;
    renderedRef.current = next;
    let cancelled = false;

    typesetMath(el).catch((err) => {
      if (!cancelled) console.error('MathText typeset error:', err);
    });

    return () => {
      cancelled = true;
    };
  }, [html]);

  const Tag = block ? 'div' : 'span';
  return <Tag ref={ref as never} className={className} />;
};

export default memo(MathText);
