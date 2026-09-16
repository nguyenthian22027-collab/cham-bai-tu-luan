import { useMemo, useState, type MouseEvent } from 'react';
import { Maximize2 } from 'lucide-react';
import ImageLightbox from './ImageLightbox';
import type { EssayStepFeedback, EssayStepStatus, EssayStoredImage } from '../types';

interface Props {
  images: EssayStoredImage[];
  steps: EssayStepFeedback[];
  onChange: (steps: EssayStepFeedback[]) => void;
}

const STATUS_OPTIONS: Array<{ value: EssayStepStatus; icon: string; label: string; defaultComment: string }> = [
  { value: 'correct', icon: '✓', label: 'Đúng', defaultComment: 'Ý làm đúng.' },
  { value: 'incorrect', icon: '✕', label: 'Sai', defaultComment: 'Ý làm sai, cần sửa.' },
  { value: 'partial', icon: '△', label: 'Một phần', defaultComment: 'Ý làm đúng một phần hoặc còn thiếu.' },
];

function iconOf(status: EssayStepStatus) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.icon || '△';
}

function labelOf(status: EssayStepStatus) {
  return STATUS_OPTIONS.find((item) => item.value === status)?.label || 'Một phần';
}

function hasPosition(step: EssayStepFeedback) {
  return Number(step.page) > 0 && Number.isFinite(Number(step.x)) && Number.isFinite(Number(step.y));
}

export default function EssayImageAnnotator({ images, steps, onChange }: Props) {
  const [status, setStatus] = useState<EssayStepStatus>('correct');
  const [comment, setComment] = useState('');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const positioned = useMemo(() => steps.map((step, index) => ({ step, index })).filter(({ step }) => hasPosition(step)), [steps]);

  function addMarker(event: MouseEvent<HTMLDivElement>, page: number) {
    if ((event.target as HTMLElement).closest('.essay-marker-button')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const option = STATUS_OPTIONS.find((item) => item.value === status)!;
    onChange([
      ...steps,
      {
        studentText: '',
        status,
        comment: comment.trim() || option.defaultComment,
        page,
        x: Number(x.toFixed(5)),
        y: Number(y.toFixed(5)),
        source: 'manual',
      },
    ]);
  }

  function removeMarker(index: number) {
    onChange(steps.filter((_step, stepIndex) => stepIndex !== index));
  }

  function updateMarker(index: number, patch: Partial<EssayStepFeedback>) {
    onChange(steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function clearAiMarkers() {
    onChange(steps.filter((step) => step.source === 'manual'));
  }

  if (!images.length) return null;
  const aiCount = positioned.filter(({ step }) => step.source !== 'manual').length;
  const manualCount = positioned.filter(({ step }) => step.source === 'manual').length;
  return (
    <div className="essay-annotator">
      <div className="essay-annotator-toolbar">
        <strong>Đánh dấu trực tiếp lên ảnh</strong>
        <div className="essay-marker-tools">
          {STATUS_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.value}
              className={`essay-marker-tool ${option.value} ${status === option.value ? 'active' : ''}`}
              onClick={() => setStatus(option.value)}
            >
              <span>{option.icon}</span>{option.label}
            </button>
          ))}
        </div>
        <input
          className="form-control essay-marker-comment"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Nhận xét cho dấu sắp đặt, có thể để trống"
        />
        <div className="essay-marker-meta">
          <span>AI đã gợi ý: <strong>{aiCount}</strong> dấu</span>
          <span>Giáo viên thêm tay: <strong>{manualCount}</strong> dấu</span>
          {aiCount > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={clearAiMarkers}>Xóa toàn bộ dấu AI</button>}
        </div>
        <p>Nếu AI đã trả tọa độ, các dấu sẽ tự hiện lên ảnh. Giáo viên có thể xóa, sửa nội dung, đổi loại đúng/sai/một phần hoặc thêm dấu mới rồi bấm “Lưu điểm & dấu ảnh”.</p>
      </div>

      <div className="essay-annotator-pages">
        {images.map((image, imageIndex) => (
          <figure className="essay-annotator-page" key={image.fileId || imageIndex}>
            <div className="essay-annotator-canvas" onClick={(event) => addMarker(event, imageIndex + 1)}>
              <img src={image.url} alt={`${image.fileName || 'Bài làm'} - trang ${imageIndex + 1}`} loading="lazy" />
              {positioned.filter(({ step }) => Number(step.page) === imageIndex + 1).map(({ step, index }) => (
                <button
                  type="button"
                  key={`${index}_${step.x}_${step.y}`}
                  className={`essay-marker-button ${step.status}`}
                  style={{ left: `${Number(step.x) * 100}%`, top: `${Number(step.y) * 100}%` }}
                  title={`${labelOf(step.status)}: ${step.comment} — Bấm để xóa`}
                  onClick={(event) => { event.stopPropagation(); removeMarker(index); }}
                >
                  {iconOf(step.status)}
                </button>
              ))}
            </div>
            <div className="essay-annotator-caption">
              <figcaption>Trang {imageIndex + 1} · {image.fileName || 'Ảnh bài làm'}</figcaption>
              <button type="button" className="btn btn-ghost btn-sm essay-image-zoom-btn" onClick={() => setPreviewIndex(imageIndex)}>
                <Maximize2 size={15} /> Phóng to ảnh
              </button>
            </div>
          </figure>
        ))}
      </div>

      <ImageLightbox
        open={previewIndex !== null}
        src={previewIndex !== null ? (images[previewIndex]?.url || '') : ''}
        alt={previewIndex !== null ? `${images[previewIndex]?.fileName || 'Bài làm'} - trang ${previewIndex + 1}` : 'Ảnh bài làm'}
        title={previewIndex !== null ? `Bài làm học sinh · Trang ${previewIndex + 1}` : 'Ảnh bài làm học sinh'}
        onClose={() => setPreviewIndex(null)}
      />

      {positioned.length > 0 && (
        <div className="essay-marker-list">
          {positioned.map(({ step, index }) => (
            <div className={`essay-marker-list-item ${step.status}`} key={`${index}_${step.page}`}>
              <span className="essay-marker-list-icon">{iconOf(step.status)}</span>
              <div className="essay-marker-editor">
                <div className="essay-marker-editor-head">
                  <strong>Trang {step.page}</strong>
                  <span className={`essay-marker-source ${step.source === 'manual' ? 'manual' : 'ai'}`}>{step.source === 'manual' ? 'Tự đặt' : 'AI gợi ý'}</span>
                </div>
                <div className="essay-marker-editor-controls">
                  <select className="form-control" value={step.status} onChange={(event) => updateMarker(index, { status: event.target.value as EssayStepStatus })}>
                    {STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <input className="form-control" value={step.comment} onChange={(event) => updateMarker(index, { comment: event.target.value })} placeholder="Nội dung nhận xét tại dấu này" />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeMarker(index)}>Xóa</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
