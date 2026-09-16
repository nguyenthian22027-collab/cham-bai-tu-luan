import { useEffect, useState } from 'react';
import { ExternalLink, Maximize2, Minus, Plus, X } from 'lucide-react';

interface Props {
  open: boolean;
  src: string;
  alt?: string;
  title?: string;
  onClose: () => void;
}

export default function ImageLightbox({ open, src, alt = 'Ảnh bài làm', title = 'Ảnh bài làm của học sinh', onClose }: Props) {
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    if (!open) return;
    setZoom(1);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === '+' || event.key === '=') setZoom((value) => Math.min(4, value + 0.25));
      if (event.key === '-') setZoom((value) => Math.max(0.5, value - 0.25));
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = oldOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open || !src) return null;

  return (
    <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="image-lightbox-panel">
        <div className="image-lightbox-toolbar">
          <div className="image-lightbox-title"><Maximize2 size={17} /> <strong>{title}</strong></div>
          <div className="image-lightbox-actions">
            <button type="button" className="image-lightbox-btn" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} title="Thu nhỏ"><Minus size={17} /></button>
            <span className="image-lightbox-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" className="image-lightbox-btn" onClick={() => setZoom((value) => Math.min(4, value + 0.25))} title="Phóng to"><Plus size={17} /></button>
            <button type="button" className="image-lightbox-fit" onClick={() => setZoom(1)}>Vừa màn hình</button>
            <a className="image-lightbox-btn" href={src} target="_blank" rel="noreferrer" title="Mở ảnh gốc"><ExternalLink size={17} /></a>
            <button type="button" className="image-lightbox-btn close" onClick={onClose} title="Đóng"><X size={19} /></button>
          </div>
        </div>
        <div className="image-lightbox-stage">
          <img
            src={src}
            alt={alt}
            draggable={false}
            style={zoom === 1
              ? { maxWidth: '100%', maxHeight: 'calc(100vh - 118px)', width: 'auto', height: 'auto' }
              : { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none', height: 'auto' }}
          />
        </div>
      </div>
    </div>
  );
}
