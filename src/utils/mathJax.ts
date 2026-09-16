let mathJaxReady: Promise<void> | null = null;

/**
 * Chờ MathJax v3 sẵn sàng. index.html đặt startup.typeset=false nên mọi
 * component phải chủ động gọi typesetPromise sau khi script CDN khởi tạo.
 */
export function whenMathJaxReady(timeoutMs = 20_000): Promise<void> {
  if (mathJaxReady) return mathJaxReady;

  mathJaxReady = new Promise<void>((resolve) => {
    if (window.MathJax?.typesetPromise) {
      (window.MathJax.startup?.promise ?? Promise.resolve())
        .then(() => resolve())
        .catch(() => resolve());
      return;
    }

    const started = Date.now();
    const timer = window.setInterval(() => {
      if (window.MathJax?.typesetPromise) {
        window.clearInterval(timer);
        (window.MathJax.startup?.promise ?? Promise.resolve())
          .then(() => resolve())
          .catch(() => resolve());
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        console.warn(`MathJax không tải được sau ${Math.round(timeoutMs / 1000)}s.`);
        resolve();
      }
    }, 100);
  });

  return mathJaxReady;
}

export async function typesetMath(node: HTMLElement): Promise<void> {
  await whenMathJaxReady();
  if (!window.MathJax?.typesetPromise) return;
  window.MathJax.typesetClear?.([node]);
  await window.MathJax.typesetPromise([node]);
}
