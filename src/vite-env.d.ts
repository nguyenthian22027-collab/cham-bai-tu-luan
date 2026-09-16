/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CENTER_NAME?: string;
  readonly VITE_MATHTYPE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  MathJax?: {
    typesetPromise?: (elements?: Element[]) => Promise<void>;
    typesetClear?: (elements?: Element[]) => void;
    startup?: { promise?: Promise<void> };
  };
  showdown?: {
    Converter: new (options?: Record<string, unknown>) => {
      makeHtml(markdown: string): string;
    };
  };
  DOMPurify?: {
    sanitize(html: string, config?: Record<string, unknown>): string;
  };
}
