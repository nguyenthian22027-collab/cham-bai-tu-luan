import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Link2,
  Loader2,
  QrCode,
  RefreshCcw,
  Smartphone,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import {
  getZaloHealth,
  getZaloLoginState,
  startZaloLogin,
  type ZaloHealth,
  type ZaloLoginState,
} from '../services/zaloService';

const PHASE_LABEL: Record<string, string> = {
  idle: 'Chưa bắt đầu',
  waiting_scan: 'Đang chờ quét mã',
  scanned: 'Đã quét — bấm Đồng ý trên điện thoại',
  done: 'Đã kết nối',
  expired: 'Mã QR đã hết hạn',
  declined: 'Đã từ chối trên điện thoại',
  error: 'Không kết nối được',
};

const ZALO_LABEL: Record<string, string> = {
  ready: 'Đang hoạt động',
  connecting: 'Đang kết nối...',
  expired: 'Phiên đã hết hạn — cần đăng nhập lại',
  disconnected: 'Chưa kết nối',
};

function fmtTime(iso?: string | null) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
}

export default function ZaloConnection() {
  const toast = useToast();

  const [health, setHealth] = useState<ZaloHealth | null>(null);
  const [login, setLogin] = useState<ZaloLoginState>({ phase: 'idle' });
  const [starting, setStarting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  // Chỉ hỏi trạng thái đăng nhập khi đang có phiên chạy, tránh gọi API vô ích.
  const [polling, setPolling] = useState(false);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await getZaloHealth());
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không lấy được tình trạng Zalo', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    refreshHealth();
    const timer = setInterval(refreshHealth, 15_000);
    return () => clearInterval(timer);
  }, [refreshHealth]);

  useEffect(() => {
    if (!polling) return;

    const timer = setInterval(async () => {
      try {
        const state = await getZaloLoginState();
        setLogin(state);

        // Dừng hỏi khi phiên kết thúc, dù thành công hay không.
        if (['done', 'declined', 'error'].includes(state.phase)) {
          setPolling(false);
          if (state.phase === 'done') {
            refreshHealth();
            toast('Đã kết nối tài khoản Zalo', 'success');
          }
        }
      } catch {
        // Bỏ qua lỗi tạm thời, lượt sau thử lại.
      }
    }, 2_000);

    return () => clearInterval(timer);
  }, [polling, refreshHealth, toast]);

  async function start() {
    setStarting(true);
    try {
      await startZaloLogin();
      setPolling(true);
      setLogin({ phase: 'waiting_scan' });
      setCopied(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Không tạo được mã QR', 'error');
    } finally {
      setStarting(false);
    }
  }

  async function copySession() {
    if (!login.sessionB64) return;
    await navigator.clipboard?.writeText(login.sessionB64);
    setCopied(true);
    toast('Đã sao chép. Dán vào biến ZALO_SESSION trên Render.', 'success');
    setTimeout(() => setCopied(false), 3_000);
  }

  const connected = health?.zalo === 'ready';
  const scanning = ['waiting_scan', 'scanned'].includes(login.phase);

  return (
    <div className="fade-up">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Link2 size={26} /> <span>Kết nối Zalo</span>
          </h1>
          <p className="page-sub">
            Tài khoản Zalo dùng để gửi thông báo cho phụ huynh
          </p>
        </div>
      </div>

      {/* ── Tình trạng hiện tại ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Tình trạng</div>
        <div className="card-body">
          {loading ? (
            <div className="loading-state">
              <div className="spinner" />
              <span>Đang kiểm tra...</span>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 14,
                  fontWeight: 700,
                  color: connected ? 'var(--success)' : 'var(--danger)',
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'currentColor',
                    flex: 'none',
                  }}
                />
                {ZALO_LABEL[health?.zalo || ''] || health?.zalo || 'Không rõ'}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))',
                  gap: 10,
                }}
              >
                <div className="card" style={{ padding: 12 }}>
                  <div className="form-label">Kết nối lúc</div>
                  <strong style={{ fontSize: '0.9rem' }}>{fmtTime(health?.connectedAt)}</strong>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="form-label">Còn gửi được hôm nay</div>
                  <strong>{health?.quotaLeft ?? '—'} tin</strong>
                </div>
                <div className="card" style={{ padding: 12 }}>
                  <div className="form-label">Đang chờ trong hàng đợi</div>
                  <strong>{health?.queueDepth ?? 0} tin</strong>
                </div>
              </div>

              {health?.lastError && !connected && (
                <div className="payment-warning" style={{ marginTop: 12 }}>
                  <AlertTriangle size={16} /> {health.lastError}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Đăng nhập bằng QR ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">Đăng nhập tài khoản Zalo</div>
        <div className="card-body">
          {!scanning && login.phase !== 'done' && (
            <>
              <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
                Chuẩn bị điện thoại trước khi bấm: mở Zalo → <strong>Thêm</strong> (góc dưới
                phải) → biểu tượng <strong>QR</strong> ở góc trên. Mã chỉ sống khoảng một phút.
              </p>

              {connected && (
                <div className="payment-warning align-top" style={{ marginBottom: 12 }}>
                  <AlertTriangle size={16} />
                  <div>
                  Zalo đang hoạt động bình thường. Đăng nhập lại sẽ thay tài khoản mà cả trung
                  tâm đang dùng để nhắn phụ huynh — chỉ làm khi thực sự cần đổi số.
                  </div>
                </div>
              )}

              <button className="btn btn-primary" onClick={start} disabled={starting}>
                {starting ? <Loader2 size={16} className="spin" /> : <QrCode size={16} />}
                {starting
                  ? 'Đang tạo mã...'
                  : login.phase === 'idle'
                    ? 'Tạo mã QR'
                    : 'Tạo mã QR mới'}
              </button>

              {['expired', 'declined', 'error'].includes(login.phase) && (
                <div className="payment-warning" style={{ marginTop: 12 }}>
                  <AlertTriangle size={16} />
                  {PHASE_LABEL[login.phase]}
                  {login.error ? ` — ${login.error}` : ''}
                </div>
              )}
            </>
          )}

          {scanning && (
            <div className="zalo-qr-box">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontWeight: 600,
                  color: 'var(--primary)',
                }}
              >
                <Smartphone size={18} />
                {PHASE_LABEL[login.phase]}
                {login.name ? ` — ${login.name}` : ''}
              </div>

              {login.qrImage ? (
                <img
                  src={`data:image/png;base64,${login.qrImage}`}
                  alt="Mã QR đăng nhập Zalo"
                  width={260}
                  height={260}
                />
              ) : (
                <div className="loading-state">
                  <div className="spinner" />
                  <span>Đang tạo mã QR...</span>
                </div>
              )}

              <button className="btn btn-ghost btn-sm" onClick={start} disabled={starting}>
                <RefreshCcw size={14} /> Tạo mã khác
              </button>
            </div>
          )}

          {login.phase === 'done' && (
            <div className="payment-paid-box">
              <CheckCircle2 size={18} />
              Đã kết nối{login.name ? ` tài khoản ${login.name}` : ''}. Hệ thống dùng được ngay.
            </div>
          )}
        </div>
      </div>

      {/* ── Lưu phiên để khỏi quét lại ── */}
      {login.phase === 'done' && login.sessionB64 && (
        <div className="card">
          <div className="card-header">Còn một bước để khỏi quét lại</div>
          <div className="card-body">
            <div className="payment-warning align-top" style={{ marginBottom: 12 }}>
              <AlertTriangle size={16} />
              <div>
                Render xoá dữ liệu mỗi lần khởi động lại. Nếu bỏ qua bước này, vài ngày nữa bạn
                sẽ phải quét QR lại từ đầu.
              </div>
            </div>

            <ol style={{ paddingLeft: 20, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              <li>Bấm nút sao chép bên dưới</li>
              <li>
                Mở Render → chọn service → tab <strong>Environment</strong>
              </li>
              <li>
                Sửa biến <code>ZALO_SESSION</code>, dán giá trị vừa sao chép
              </li>
              <li>
                Bấm <strong>Save Changes</strong>
              </li>
            </ol>

            <textarea
              readOnly
              rows={4}
              value={login.sessionB64}
              onClick={(event) => event.currentTarget.select()}
              className="form-control zalo-session-text"
              style={{ marginBottom: 10 }}
            />

            <button className="btn btn-primary" onClick={copySession}>
              <Copy size={15} /> {copied ? 'Đã sao chép' : 'Sao chép chuỗi phiên'}
            </button>

            <p style={{ fontSize: '0.8rem', color: 'var(--danger)', marginTop: 12, marginBottom: 0 }}>
              Chuỗi này tương đương mật khẩu tài khoản Zalo. Đừng gửi qua chat, đừng lưu vào file
              dùng chung.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
