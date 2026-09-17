/**
 * EDUCENTER ESSAY BRIDGE
 * - uploadImage: lưu ảnh bài làm lên Google Drive
 * - gradeEssay: tải ảnh từ Drive và chấm bằng Gemini
 * - deleteImage/deleteImages: dọn ảnh khi học sinh xóa, làm lại hoặc giáo viên xóa bài giao
 *
 * Script Properties bắt buộc:
 *   API_SECRET
 *   GEMINI_API_KEY
 * Tùy chọn:
 *   GEMINI_MODEL       (mặc định gemini-3.6-flash)
 *   DRIVE_FOLDER_ID    (nếu bỏ trống sẽ tự tạo thư mục EduCenter Essay Images)
 */

const ESSAY_CONFIG = {
  DEFAULT_MODEL: 'gemini-3.6-flash',
  DEFAULT_FOLDER: 'EduCenter Essay Images',
  MAX_IMAGE_BYTES: 4 * 1024 * 1024,
  MAX_IMAGES_PER_GRADE: 8,
  ALLOWED_TYPES: ['image/jpeg', 'image/png', 'image/webp']
};

function doGet() {
  return jsonResponse_({ success: true, service: 'educenter-essay-bridge', version: '1.2.3' });
}

/**
 * Chạy thủ công một lần trong trình soạn thảo Apps Script để cấp quyền
 * Google Drive và UrlFetch trước khi deploy Web App.
 */
function authorizeEssayBridge() {
  const folder = getImageFolder_();
  const response = UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  return {
    success: true,
    folderId: folder.getId(),
    urlFetchStatus: response.getResponseCode()
  };
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    verifySecret_(body.secret);

    switch (String(body.action || '')) {
      case 'uploadImage':
        return jsonResponse_({ success: true, image: uploadImage_(body) });
      case 'gradeEssay':
        return jsonResponse_({ success: true, result: gradeEssay_(body) });
      case 'deleteImage':
        return jsonResponse_({ success: true, deleted: deleteImage_(body) });
      case 'deleteImages':
        return jsonResponse_({ success: true, cleanup: deleteImages_(body) });
      case 'health':
        return jsonResponse_({ success: true, service: 'educenter-essay-bridge' });
      default:
        throw new Error('Action không hợp lệ.');
    }
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({ success: false, error: String(error && error.message ? error.message : error) });
  }
}

function verifySecret_(incoming) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_SECRET');
  if (!expected) throw new Error('Chưa cấu hình Script Property API_SECRET.');
  if (!incoming || String(incoming) !== String(expected)) throw new Error('Sai API secret.');
}

function getImageFolder_() {
  const props = PropertiesService.getScriptProperties();
  const configuredId = props.getProperty('DRIVE_FOLDER_ID');
  if (configuredId) return DriveApp.getFolderById(configuredId);

  const existing = DriveApp.getFoldersByName(ESSAY_CONFIG.DEFAULT_FOLDER);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(ESSAY_CONFIG.DEFAULT_FOLDER);
  props.setProperty('DRIVE_FOLDER_ID', folder.getId());
  return folder;
}

function uploadImage_(body) {
  const base64 = String(body.base64 || '').replace(/^data:[^;]+;base64,/, '');
  const mimeType = String(body.mimeType || '').toLowerCase();
  const fileName = String(body.fileName || ('bai-lam-' + Date.now() + '.jpg')).replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!base64) throw new Error('Ảnh trống.');
  if (ESSAY_CONFIG.ALLOWED_TYPES.indexOf(mimeType) < 0) throw new Error('Định dạng ảnh không được hỗ trợ.');

  const bytes = Utilities.base64Decode(base64);
  if (bytes.length > ESSAY_CONFIG.MAX_IMAGE_BYTES) throw new Error('Ảnh vượt quá 4 MB sau khi nén.');

  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = getImageFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sharingError) {
    file.setTrashed(true);
    throw new Error('Google Workspace đang chặn chia sẻ Anyone with link. Hãy cho phép chia sẻ link hoặc dùng tài khoản Drive khác.');
  }

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    mimeType: mimeType,
    size: bytes.length,
    url: 'https://drive.google.com/uc?export=view&id=' + encodeURIComponent(file.getId()),
    thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(file.getId()) + '&sz=w900'
  };
}

function getOwnedEssayFile_(fileId) {
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(String(fileId || ''))) throw new Error('fileId không hợp lệ.');
  const file = DriveApp.getFileById(String(fileId));
  const folderId = getImageFolder_().getId();
  const parents = file.getParents();
  let belongsToFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === folderId) {
      belongsToFolder = true;
      break;
    }
  }
  if (!belongsToFolder) throw new Error('Ảnh không thuộc thư mục bài tự luận của hệ thống.');
  return file;
}

function deleteImage_(body) {
  const fileId = String(body.fileId || '').trim();
  const file = getOwnedEssayFile_(fileId);
  file.setTrashed(true);
  return { fileId: fileId };
}

function deleteImages_(body) {
  const ids = Array.isArray(body.fileIds) ? body.fileIds.slice(0, 40) : [];
  const deleted = [];
  const failed = [];
  ids.forEach(function (rawId) {
    const fileId = String(rawId || '').trim();
    try {
      const file = getOwnedEssayFile_(fileId);
      file.setTrashed(true);
      deleted.push(fileId);
    } catch (error) {
      failed.push({ fileId: fileId, error: String(error && error.message ? error.message : error) });
    }
  });
  return { deleted: deleted, failed: failed };
}

function getGeminiApiKeys_(props) {
  const allKeys = [];
  const raw = props.getProperty('GEMINI_API_KEYS') || props.getProperty('GEMINI_API_KEY') || '';
  if (raw) {
    raw.split(/[\n,;]+/).forEach(function (k) {
      const trimmed = k.trim();
      if (trimmed && allKeys.indexOf(trimmed) === -1) allKeys.push(trimmed);
    });
  }

  // Hỗ trợ thêm dạng đặt riêng từng dòng: GEMINI_API_KEY_1, GEMINI_API_KEY_2, GEMINI_API_KEY_3...
  try {
    const allProps = props.getProperties();
    Object.keys(allProps).forEach(function (propName) {
      if (/^GEMINI_API_KEY_\d+$/i.test(propName)) {
        const val = String(allProps[propName] || '').trim();
        if (val && allKeys.indexOf(val) === -1) allKeys.push(val);
      }
    });
  } catch (e) {
    // fallback nếu không đọc được getProperties
  }

  return allKeys;
}

function gradeEssay_(body) {
  const props = PropertiesService.getScriptProperties();
  const keys = getGeminiApiKeys_(props);
  const model = props.getProperty('GEMINI_MODEL') || ESSAY_CONFIG.DEFAULT_MODEL;
  if (!keys.length) throw new Error('Chưa cấu hình Script Property GEMINI_API_KEY (hoặc GEMINI_API_KEYS).');

  const maxScore = Math.max(0.25, Math.min(100, Number(body.maxScore) || 1));
  const answer = body.answer || {};
  const images = Array.isArray(answer.images) ? answer.images.slice(0, ESSAY_CONFIG.MAX_IMAGES_PER_GRADE) : [];
  const prompt = buildPrompt_(String(body.questionText || ''), String(body.rubric || ''), String(answer.text || ''), maxScore);
  const parts = [{ text: prompt }];

  images.forEach(function (image) {
    const fileId = String((image && image.fileId) || '');
    if (!fileId) return;
    const blob = getOwnedEssayFile_(fileId).getBlob();
    if (blob.getBytes().length > ESSAY_CONFIG.MAX_IMAGE_BYTES) throw new Error('Một ảnh bài làm vượt quá giới hạn chấm.');
    parts.push({
      inlineData: {
        mimeType: blob.getContentType() || 'image/jpeg',
        data: Utilities.base64Encode(blob.getBytes())
      }
    });
  });

  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json'
    }
  };

  // Chia đều tải (load-balancing) ngẫu nhiên giữa các key và tự động thử key tiếp theo nếu gặp giới hạn rate-limit (429/403)
  const startIndex = Math.floor(Math.random() * keys.length);
  let lastError = null;

  for (let attempt = 0; attempt < keys.length; attempt++) {
    const currentKey = keys[(startIndex + attempt) % keys.length];
    const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(currentKey);

    const response = UrlFetchApp.fetch(endpoint, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const status = response.getResponseCode();
    const raw = response.getContentText();

    // Nếu gặp rate-limit 429 hoặc lỗi quota 403, tự động chuyển sang API key tiếp theo
    if (status === 429 || (status === 403 && /quota|limit|exhausted/i.test(raw))) {
      console.warn('API key ' + (attempt + 1) + '/' + keys.length + ' bị giới hạn (' + status + '). Đang thử key tiếp theo...');
      lastError = new Error('Gemini key hết lượt (' + status + '): ' + raw.slice(0, 300));
      continue;
    }

    if (status < 200 || status >= 300) {
      throw new Error('Gemini lỗi ' + status + ': ' + raw.slice(0, 500));
    }

    const envelope = JSON.parse(raw);
    const text = envelope && envelope.candidates && envelope.candidates[0] && envelope.candidates[0].content && envelope.candidates[0].content.parts && envelope.candidates[0].content.parts[0] && envelope.candidates[0].content.parts[0].text;
    if (!text) throw new Error('Gemini không trả kết quả chấm.');

    const parsed = parseGeminiJson_(text);
    const score = Math.max(0, Math.min(maxScore, Number(parsed.score) || 0));
    const steps = Array.isArray(parsed.steps) ? parsed.steps.map(normalizeStep_) : [];
    return {
      score: score,
      maxScore: maxScore,
      summary: String(parsed.summary || ''),
      feedbackMarkdown: String(parsed.feedbackMarkdown || parsed.feedback || parsed.summary || ''),
      steps: steps
    };
  }

  throw lastError || new Error('Tất cả API key Gemini đều đã hết hạn mức (quota). Hãy thêm key mới vào GEMINI_API_KEY.');
}

function buildPrompt_(questionText, rubric, studentText, maxScore) {
  return [
    'Bạn là giáo viên chấm bài tự luận/toán học. Hãy đối chiếu bài làm với đề và rubric.',
    'Không tự suy diễn phần không nhìn rõ trong ảnh. Nêu rõ ý đúng, ý sai, ý thiếu và cách sửa.',
    'QUY TẮC ĐỊNH DẠNG BẮT BUỘC: chỉ bọc CHÍNH công thức toán bằng $...$ hoặc $$...$$; tuyệt đối không bọc cả câu tiếng Việt trong dấu $.',
    'Mỗi công thức inline phải có cặp $ mở/đóng riêng. Ví dụ đúng: "hai nghiệm $x_1 = 5$ và $x_2 = -19$, đối chiếu $x > 0$."',
    'Trong feedbackMarkdown, mỗi ý nhận xét dùng một dòng bullet bắt đầu bằng "- ". Không dùng tiêu đề # và không dùng HTML.',
    'Đơn vị thông thường nên viết ngoài math, ví dụ "$x = 5$ m"; chỉ dùng \\text{...} khi thật sự cần bên trong công thức.',
    '',
    '[ĐỀ BÀI]',
    stripHtml_(questionText),
    '',
    '[RUBRIC / ĐÁP ÁN THAM KHẢO]',
    stripHtml_(rubric) || '(Không có rubric riêng)',
    '',
    '[BÀI LÀM DẠNG VĂN BẢN]',
    studentText || '(Học sinh chỉ nộp ảnh)',
    '',
    'Điểm tối đa: ' + maxScore,
    '',
    'Chỉ trả về JSON hợp lệ theo đúng cấu trúc:',
    '{',
    '  "score": 0,',
    '  "summary": "nhận xét ngắn",',
    '  "feedbackMarkdown": "nhận xét tổng hợp dễ đọc, mỗi ý xuống dòng; không dùng ký hiệu #; công thức dùng $...$ hoặc $$...$$",',
    '  "steps": [',
    '    {',
    '      "studentText": "trích ngắn bước làm hoặc mô tả vị trí trên ảnh",',
    '      "status": "correct|partial|incorrect",',
    '      "comment": "vì sao đúng/sai",',
    '      "correction": "cách sửa, có thể dùng LaTeX",',
    '      "awardedPoints": 0.25,',
    '      "maxPoints": 0.5,',
    '      "page": 1,',
    '      "x": 0.5,',
    '      "y": 0.5',
    '    }',
    '  ]',
    '}',
    '',
    'Tổng awardedPoints của các bước nên gần bằng score và không vượt quá maxScore.',
    'Nếu bài làm có ảnh, hãy cố gắng gắn page, x, y cho mỗi lỗi/ý đúng đủ rõ để hệ thống tự đánh dấu lên ảnh. Chỉ bỏ page/x/y khi thật sự không xác định được.',
    'Ưu tiên tạo 2-8 bước quan trọng nhất, tránh quá vụn.',
    'x và y là tọa độ tương đối 0..1; page bắt đầu từ 1.'
  ].join('\n');
}

function normalizeStep_(step) {
  const allowed = ['correct', 'partial', 'incorrect'];
  const status = allowed.indexOf(String(step && step.status)) >= 0 ? String(step.status) : 'partial';
  const out = {
    studentText: String((step && step.studentText) || ''),
    status: status,
    comment: String((step && step.comment) || ''),
    correction: String((step && step.correction) || '')
  };
  const page = Number(step && step.page);
  const x = Number(step && step.x);
  const y = Number(step && step.y);
  const awardedPoints = Number(step && step.awardedPoints);
  const maxPoints = Number(step && step.maxPoints);
  if (page > 0) out.page = page;
  if (isFinite(x) && x >= 0 && x <= 1) out.x = x;
  if (isFinite(y) && y >= 0 && y <= 1) out.y = y;
  if (isFinite(awardedPoints) && awardedPoints >= 0) out.awardedPoints = awardedPoints;
  if (isFinite(maxPoints) && maxPoints >= 0) out.maxPoints = maxPoints;
  return out;
}

function parseGeminiJson_(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function stripHtml_(value) {
  return String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
