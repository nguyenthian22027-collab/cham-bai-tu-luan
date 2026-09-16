import { useEffect, useMemo, useState } from 'react';
import { ExamPointsConfig, SectionPointsConfig, TrueFalseMode } from '../types';
import { rebalanceLastSection, validatePointsConfig } from '../services/scoringService';

interface PointsConfigEditorProps {
  config: ExamPointsConfig;
  onChange: (newConfig: ExamPointsConfig) => void | Promise<void>;
  onClose?: () => void;
  isSaving?: boolean;
}

const SECTION_ICON: Record<string, string> = {
  multiple_choice: '📝',
  true_false: '✅',
  short_answer: '✏️',
  writing: '🖊️',
};

const SECTION_TYPE_LABEL: Record<string, string> = {
  multiple_choice: 'Trắc nghiệm nhiều lựa chọn',
  true_false: 'Trắc nghiệm Đúng / Sai',
  short_answer: 'Trả lời ngắn',
  writing: 'Tự luận (giáo viên / AI chấm)',
};

export default function PointsConfigEditor({ config, onChange, onClose, isSaving = false }: PointsConfigEditorProps) {
  const [localConfig, setLocalConfig] = useState<ExamPointsConfig>(config);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const totalPoints = useMemo(
    () => localConfig.sections.reduce((sum, s) => sum + s.totalPoints, 0),
    [localConfig.sections]
  );
  const isBalanced = Math.abs(totalPoints - localConfig.maxScore) < 0.01;

  // ===== Đổi thang điểm max — scale tỷ lệ các phần theo =====
  function handleMaxScoreChange(newMaxScore: number) {
    const safeOld = localConfig.maxScore || 10;
    const ratio = safeOld > 0 ? newMaxScore / safeOld : 1;

    const sections = localConfig.sections.map((s) => {
      const newTotal = parseFloat((s.totalPoints * ratio).toFixed(2));
      return {
        ...s,
        totalPoints: newTotal,
        pointsPerQuestion: parseFloat((newTotal / s.totalQuestions).toFixed(4)),
      };
    });
    rebalanceLastSection(sections, newMaxScore);
    setLocalConfig({ ...localConfig, maxScore: newMaxScore, sections });
  }

  // ===== Đổi điểm 1 phần =====
  function handleSectionPointsChange(sectionId: string, newPoints: number) {
    const sections = localConfig.sections.map((s) =>
      s.sectionId === sectionId
        ? {
            ...s,
            totalPoints: newPoints,
            pointsPerQuestion: parseFloat((newPoints / s.totalQuestions).toFixed(4)),
          }
        : s
    );
    setLocalConfig({ ...localConfig, sections });
  }

  // ===== Đổi chế độ chấm Đúng/Sai =====
  function handleModeChange(sectionId: string, mode: TrueFalseMode) {
    const sections = localConfig.sections.map((s) =>
      s.sectionId === sectionId ? { ...s, trueFalseMode: mode } : s
    );
    setLocalConfig({ ...localConfig, sections });
  }

  // ===== Tự động cân bằng theo tỷ lệ số câu =====
  function handleAutoBalance() {
    const totalQ = localConfig.sections.reduce((sum, s) => sum + s.totalQuestions, 0);
    const sections = localConfig.sections.map((s) => {
      const ratio = totalQ > 0 ? s.totalQuestions / totalQ : 0;
      const totalPts = parseFloat((localConfig.maxScore * ratio).toFixed(2));
      return {
        ...s,
        totalPoints: totalPts,
        pointsPerQuestion: parseFloat((totalPts / s.totalQuestions).toFixed(4)),
      };
    });
    rebalanceLastSection(sections, localConfig.maxScore);
    setLocalConfig({ ...localConfig, sections, autoBalance: true });
  }

  async function handleSave() {
    const validation = validatePointsConfig(localConfig);
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    await onChange(localConfig);
    if (onClose) onClose();
  }

  return (
    <div className="pce-wrap">
      {/* Thang điểm */}
      <div className="pce-maxscore-box">
        <label className="form-label">📊 Thang điểm tối đa</label>
        <div className="pce-maxscore-row">
          <input
            className="form-control pce-maxscore-input"
            type="number"
            min={1}
            max={100}
            step={0.5}
            value={localConfig.maxScore}
            disabled={isSaving}
            onChange={(e) => handleMaxScoreChange(parseFloat(e.target.value) || 0)}
          />
          <button type="button" className="btn btn-secondary" disabled={isSaving} onClick={handleAutoBalance}>
            🔄 Tự động cân bằng
          </button>
        </div>
        <p className="pce-hint">💡 Tự động cân bằng chia điểm theo tỷ lệ số câu của từng phần</p>
      </div>

      {/* Tổng hiện tại */}
      <div className={`pce-total-box ${isBalanced ? 'ok' : 'error'}`}>
        <span>Tổng điểm các phần:</span>
        <strong>{totalPoints.toFixed(2)} / {localConfig.maxScore}</strong>
        {!isBalanced && (
          <p>⚠️ Tổng chưa bằng thang điểm — chênh lệch {(totalPoints - localConfig.maxScore).toFixed(2)}. Sửa điểm từng phần hoặc bấm "Tự động cân bằng".</p>
        )}
      </div>

      {/* Lỗi validate */}
      {errors.length > 0 && (
        <div className="pce-errors">
          {errors.map((err, i) => <p key={i}>❌ {err}</p>)}
        </div>
      )}

      {/* Từng phần */}
      <div className="pce-sections">
        {localConfig.sections.map((section) => (
          <SectionCard
            key={section.sectionId}
            section={section}
            disabled={isSaving}
            onPointsChange={(pts) => handleSectionPointsChange(section.sectionId, pts)}
            onModeChange={(mode) => handleModeChange(section.sectionId, mode)}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="pce-actions">
        {onClose && (
          <button type="button" className="btn btn-ghost" disabled={isSaving} onClick={onClose}>
            Hủy
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={isSaving || !isBalanced} onClick={handleSave}>
          {isSaving ? 'Đang lưu...' : '💾 Lưu cấu hình điểm'}
        </button>
      </div>
    </div>
  );
}

function SectionCard({ section, disabled, onPointsChange, onModeChange }: {
  section: SectionPointsConfig;
  disabled: boolean;
  onPointsChange: (pts: number) => void;
  onModeChange: (mode: TrueFalseMode) => void;
}) {
  const tfMode: TrueFalseMode = section.trueFalseMode ?? 'stepped';
  const equalRatios = [0.25, 0.5, 0.75, 1.0];
  const steppedRatios = [0.1, 0.25, 0.5, 1.0];
  const ratios = tfMode === 'stepped' ? steppedRatios : equalRatios;

  return (
    <div className={`pce-section-card pce-${section.sectionId}`}>
      <div className="pce-section-head">
        <span className="pce-section-icon">{SECTION_ICON[section.sectionId] || '📄'}</span>
        <div>
          <h4>{section.sectionName}</h4>
          <p>{SECTION_TYPE_LABEL[section.questionType] || section.questionType}</p>
        </div>
        <span className="pce-section-count">{section.totalQuestions} câu</span>
      </div>

      <div className="pce-section-body">
        <div className="pce-section-grid">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Tổng điểm phần này</label>
            <input
              className="form-control"
              type="number"
              min={0}
              step={0.25}
              value={section.totalPoints}
              disabled={disabled}
              onChange={(e) => onPointsChange(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Điểm mỗi câu</label>
            <div className="pce-per-question">{section.pointsPerQuestion.toFixed(4)}</div>
          </div>
        </div>

        {section.questionType === 'writing' && (
          <p className="pce-hint" style={{ marginTop: 8 }}>
            🖊️ Phần tự luận không chấm tự động — điểm mỗi câu ở trên là điểm tối đa khi giáo viên / AI chấm.
          </p>
        )}

        {/* Chế độ chấm Đúng/Sai */}
        {section.questionType === 'true_false' && (
          <div className="pce-tf-config">
            <p className="pce-tf-config-title">⚙️ Cách tính điểm Đúng/Sai:</p>
            <div className="pce-tf-modes">
              <button
                type="button"
                disabled={disabled}
                className={`pce-tf-mode ${tfMode === 'equal' ? 'active equal' : ''}`}
                onClick={() => onModeChange('equal')}
              >
                <span className="pce-radio">{tfMode === 'equal' && <span />}</span>
                <span>
                  <strong>Chia đều</strong>
                  <small>Mỗi ý đúng = điểm/câu ÷ số ý</small>
                </span>
              </button>
              <button
                type="button"
                disabled={disabled}
                className={`pce-tf-mode ${tfMode === 'stepped' ? 'active stepped' : ''}`}
                onClick={() => onModeChange('stepped')}
              >
                <span className="pce-radio">{tfMode === 'stepped' && <span />}</span>
                <span>
                  <strong>Thang bậc BGD</strong>
                  <small>1ý→10% · 2ý→25% · 3ý→50% · 4ý→100%</small>
                </span>
              </button>
            </div>

            <div className="pce-tf-preview">
              <p>📌 Quy tắc chấm {tfMode === 'stepped' ? '(Thang bậc BGD)' : '(Chia đều)'} — câu 4 ý:</p>
              <div className="pce-tf-preview-grid">
                {ratios.map((ratio, i) => (
                  <div key={i} className={i === 3 ? 'max' : ''}>
                    <strong>{i + 1}/4 ý</strong>
                    <span>{(section.pointsPerQuestion * ratio).toFixed(3)}đ</span>
                    {tfMode === 'stepped' && <small>{(ratio * 100).toFixed(0)}%</small>}
                  </div>
                ))}
              </div>
              {tfMode === 'stepped' && <p className="pce-note">✨ Theo quy định BGD: đúng 0 ý → 0 điểm</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
