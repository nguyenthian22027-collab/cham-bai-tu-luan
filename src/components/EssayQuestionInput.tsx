import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteEssayImage,
  parseEssayAnswer,
  serializeEssayAnswer,
  uploadEssayImage,
} from '../services/essayGradingService';
import { EssayStoredImage } from '../types';

interface EssayQuestionInputProps {
  value?: string;
  onChange: (val: string) => void;
  placeholder?: string;
  maxImages?: number;
  disabled?: boolean;
  assignmentId: string;
  studentId: string;
  questionNumber: number;
}

const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1800;
const JPEG_QUALITY = 0.82;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Không đọc được ảnh.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Ảnh không hợp lệ.'));
    image.src = src;
  });
}

async function compressImage(file: File) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} không phải ảnh.`);
  if (file.size > MAX_SOURCE_BYTES) throw new Error(`${file.name} vượt quá 12 MB.`);

  const source = await readAsDataUrl(file);
  const image = await loadImage(source);
  const ratio = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * ratio));
  const height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Trình duyệt không hỗ trợ xử lý ảnh.');
  context.drawImage(image, 0, 0, width, height);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return {
    base64: dataUrl.split(',')[1] || '',
    mimeType: 'image/jpeg',
    fileName: `${file.name.replace(/\.[^.]+$/, '') || 'bai-lam'}.jpg`,
  };
}

export default function EssayQuestionInput({
  value,
  onChange,
  placeholder = 'Nhập bài làm, công thức LaTeX hoặc đính kèm ảnh...',
  maxImages = 3,
  disabled = false,
  assignmentId,
  studentId,
  questionNumber,
}: EssayQuestionInputProps) {
  const parsed = useMemo(() => parseEssayAnswer(value || ''), [value]);
  const [text, setText] = useState(parsed.text || '');
  const [images, setImages] = useState<EssayStoredImage[]>(parsed.images || []);
  const [formula, setFormula] = useState('');
  const [showFormula, setShowFormula] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [deletingImageId, setDeletingImageId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const mathRef = useRef<HTMLElement>(null);
  const [mathReady, setMathReady] = useState(false);

  useEffect(() => {
    setText(parsed.text || '');
    setImages(parsed.images || []);
  }, [value]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.customElements?.get('math-field')) {
      setMathReady(true);
      return;
    }
    const id = 'mathlive-cdn-script';
    if (!document.getElementById(id)) {
      const script = document.createElement('script');
      script.id = id;
      script.src = 'https://unpkg.com/mathlive';
      script.defer = true;
      script.onload = () => setMathReady(true);
      document.body.appendChild(script);
    }
    const timer = window.setInterval(() => {
      if (window.customElements?.get('math-field')) {
        setMathReady(true);
        window.clearInterval(timer);
      }
    }, 300);
    return () => window.clearInterval(timer);
  }, []);

  function emit(nextText: string, nextImages: EssayStoredImage[]) {
    onChange(serializeEssayAnswer({ text: nextText, images: nextImages }));
  }

  function updateText(nextText: string) {
    setText(nextText);
    emit(nextText, images);
  }

  async function addImages(files: FileList | null) {
    if (!files || disabled || uploading) return;
    const remaining = Math.max(0, maxImages - images.length);
    const selected = Array.from(files).slice(0, remaining);
    if (!selected.length) return;

    setUploading(true);
    setUploadError('');
    const uploaded: EssayStoredImage[] = [];
    try {
      for (const file of selected) {
        const prepared = await compressImage(file);
        uploaded.push(await uploadEssayImage({ ...prepared, assignmentId, studentId, questionNumber }));
      }
      const next = [...images, ...uploaded];
      setImages(next);
      emit(text, next);
    } catch (error) {
      if (uploaded.length > 0) {
        const next = [...images, ...uploaded];
        setImages(next);
        emit(text, next);
      }
      setUploadError(`${uploaded.length ? `Đã tải ${uploaded.length} ảnh. ` : ''}${error instanceof Error ? error.message : 'Không tải được ảnh.'}`);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function removeImage(index: number) {
    const image = images[index];
    if (!image || deletingImageId) return;
    setDeletingImageId(image.fileId);
    setUploadError('');
    try {
      await deleteEssayImage(image.fileId);
    } catch (error) {
      // Ảnh cũ có thể chưa có metadata server. Vẫn gỡ khỏi bài làm để HS không bị kẹt,
      // nhưng báo rõ file Drive cũ có thể cần dọn thủ công.
      setUploadError(error instanceof Error ? error.message : 'Không xóa được file ảnh trên Drive.');
    } finally {
      const next = images.filter((_, current) => current !== index);
      setImages(next);
      emit(text, next);
      setDeletingImageId('');
    }
  }

  function insertFormula() {
    const latex = formula.trim();
    if (!latex) return;
    updateText(`${text}${text ? '\n' : ''}$${latex}$`);
    setFormula('');
    setShowFormula(false);
  }

  useEffect(() => {
    const node = mathRef.current;
    if (!node) return;
    const onInput = () => setFormula((node as HTMLElement & { value?: string }).value || '');
    node.addEventListener('input', onInput);
    return () => node.removeEventListener('input', onInput);
  }, [showFormula, mathReady]);

  return (
    <div className="essay-input">
      <textarea
        className="form-control essay-textarea"
        value={text}
        onChange={(event) => updateText(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={5}
      />

      <div className="essay-toolbar">
        <button type="button" className="btn btn-secondary btn-sm" disabled={disabled} onClick={() => setShowFormula((open) => !open)}>
          + Công thức
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={disabled || uploading || images.length >= maxImages}
          onClick={() => fileRef.current?.click()}
        >
          {uploading ? 'Đang tải ảnh...' : `+ Ảnh bài làm (${images.length}/${maxImages})`}
        </button>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => addImages(event.target.files)} />
      </div>

      {uploadError && <div className="essay-upload-error">{uploadError}</div>}
      <div className="essay-upload-note">Ảnh được nén và lưu trên Google Drive; Firestore chỉ lưu đường dẫn ảnh.</div>

      {showFormula && (
        <div className="formula-box">
          <label className="form-label">Nhập công thức</label>
          {mathReady ? (
            React.createElement('math-field' as any, {
              ref: mathRef,
              className: 'mathlive-field',
              value: formula,
            })
          ) : (
            <input className="form-control" value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="VD: x^2+1=0" />
          )}
          <div style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={insertFormula}>Chèn vào bài làm</button>
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div className="essay-images">
          {images.map((image, index) => (
            <div className="essay-image" key={image.fileId}>
              <img src={image.thumbnailUrl || image.url} alt={image.fileName || 'Ảnh bài làm'} loading="lazy" />
              {!disabled && (
                <button type="button" className="essay-image-remove" disabled={Boolean(deletingImageId)} onClick={() => void removeImage(index)} aria-label="Xóa ảnh">{deletingImageId === image.fileId ? '…' : '×'}</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
