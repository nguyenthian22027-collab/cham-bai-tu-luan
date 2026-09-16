const APPS_SCRIPT_URL = String(process.env.ESSAY_APPS_SCRIPT_URL || '').trim();
const APPS_SCRIPT_SECRET = String(process.env.ESSAY_APPS_SCRIPT_SECRET || '').trim();

export async function callEssayAppsScript<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  if (!APPS_SCRIPT_URL || !APPS_SCRIPT_SECRET) {
    throw Object.assign(
      new Error('Thiếu ESSAY_APPS_SCRIPT_URL hoặc ESSAY_APPS_SCRIPT_SECRET trên Vercel.'),
      { statusCode: 500 },
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret: APPS_SCRIPT_SECRET, ...payload }),
      signal: controller.signal,
      redirect: 'follow',
    });
    const text = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error(`Apps Script trả dữ liệu không hợp lệ: ${text.slice(0, 180)}`), { statusCode: 502 });
    }
    if (!response.ok || data.success !== true) {
      throw Object.assign(new Error(String(data.error || `Apps Script lỗi ${response.status}`)), { statusCode: 502 });
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw Object.assign(new Error('Apps Script/Gemini phản hồi quá chậm.'), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
