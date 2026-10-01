/**
 * wordTemplateService.ts
 * Tạo file Word mẫu (.docx) cho file đề và file đáp án,
 * giúp giáo viên soạn đúng cấu trúc parser mong đợi.
 */

import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Minimal OOXML scaffolding
// ---------------------------------------------------------------------------
const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"/>
</Relationships>`;

const WORD_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:rPr><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>
  </w:style>
</w:styles>`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function para(text: string, bold = false, size = 24): string {
  const runProps = `<w:rPr>${bold ? '<w:b/>' : ''}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>`;
  return `<w:p>
    <w:pPr><w:spacing w:after="160"/></w:pPr>
    <w:r>${runProps}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>
  </w:p>`;
}

function blankLine(): string {
  return `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr></w:p>`;
}

function buildDocumentXml(bodyContent: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas">
  <w:body>
${bodyContent}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080"/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

// ---------------------------------------------------------------------------
// Template: File đề
// ---------------------------------------------------------------------------
function buildQuestionBody(numQuestions: number): string {
  const lines: string[] = [];

  // Header
  lines.push(para('ĐỀ KIỂM TRA TỰ LUẬN – MẪU', true, 28));
  lines.push(para('(Dùng làm template — thay nội dung thực tế vào)'));
  lines.push(blankLine());

  for (let i = 1; i <= numQuestions; i++) {
    lines.push(para(`Câu ${i}: [Nội dung câu hỏi ${i} — nhập ở đây]`, true));
    lines.push(para('   a) [Ý a — xóa nếu không cần]'));
    lines.push(para('   b) [Ý b]'));
    if (i === 1) {
      lines.push(para('   (Ảnh minh họa chèn thẳng bằng Insert → Pictures; công thức dùng Insert → Equation)'));
    }
    lines.push(blankLine());
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Template: File đáp án
// ---------------------------------------------------------------------------
function buildAnswerBody(numQuestions: number): string {
  const lines: string[] = [];

  lines.push(para('ĐÁP ÁN / HƯỚNG DẪN CHẤM – MẪU', true, 28));
  lines.push(para('(Số câu phải khớp với file đề; lời giải viết dưới mỗi câu)'));
  lines.push(blankLine());

  for (let i = 1; i <= numQuestions; i++) {
    lines.push(para(`Câu ${i}:`, true));
    lines.push(para('Lời giải:', true));
    lines.push(para('   a) [Lời giải ý a — dùng Insert → Equation cho công thức]'));
    lines.push(para('   b) [Lời giải ý b]'));
    lines.push(blankLine());
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
async function buildDocx(bodyContent: string): Promise<Blob> {
  const zip = new JSZip();

  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file('_rels/.rels', RELS);
  zip.file('word/_rels/document.xml.rels', WORD_RELS);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/document.xml', buildDocumentXml(bodyContent));

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}

export async function downloadQuestionTemplate(numQuestions = 4): Promise<void> {
  const blob = await buildDocx(buildQuestionBody(numQuestions));
  triggerDownload(blob, `mau-de-tu-luan-${numQuestions}cau.docx`);
}

export async function downloadAnswerTemplate(numQuestions = 4): Promise<void> {
  const blob = await buildDocx(buildAnswerBody(numQuestions));
  triggerDownload(blob, `mau-dap-an-${numQuestions}cau.docx`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
