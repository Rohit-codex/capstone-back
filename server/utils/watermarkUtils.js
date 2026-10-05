// server/utils/watermarkUtils.js
// Applies a diagonal "DASTAVEZAI - DEMO" watermark to DOCX and PDF outputs
// Called by controllers when req.shouldWatermark === true

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import {
  Paragraph, TextRun, AlignmentType, Document, Packer,
  Header, ImageRun, ShadingType
} from 'docx';

const WATERMARK_TEXT = 'DASTAVEZAI — FREE TIER';
const WATERMARK_COLOR = 'C0C0C0'; // light gray for DOCX
const WATERMARK_OPACITY = 0.15;

// ─── Apply watermark to a PDF Buffer ─────────────────────────────────────────
export async function applyPdfWatermark(pdfBuffer) {
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pages = pdfDoc.getPages();

  for (const page of pages) {
    const { width, height } = page.getSize();
    const fontSize = Math.min(width, height) * 0.07;
    const textWidth = font.widthOfTextAtSize(WATERMARK_TEXT, fontSize);

    // Draw multiple diagonal watermarks across the page
    const rows = 3;
    const cols = 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        page.drawText(WATERMARK_TEXT, {
          x: (width / cols) * c + 40,
          y: (height / rows) * r + height / (rows * 2),
          size: fontSize,
          font,
          color: rgb(0.75, 0.75, 0.75),
          opacity: WATERMARK_OPACITY,
          rotate: degrees(45),
        });
      }
    }

    // Footer watermark strip
    page.drawText(
      'Generated on Free Tier — Upgrade to Dastavezai Basic to remove watermark',
      {
        x: 40,
        y: 18,
        size: 7,
        font,
        color: rgb(0.6, 0.6, 0.6),
        opacity: 0.7,
      }
    );
  }

  return Buffer.from(await pdfDoc.save());
}

// ─── Apply watermark to a DOCX Buffer ────────────────────────────────────────
// Strategy: inject a visible watermark paragraph at top of each section
// and add a footer with the upgrade notice.
// (True background watermarks in DOCX require VML which docx library supports
// via custom XML — using visible paragraph approach for reliability)
export async function applyDocxWatermark(docxBuffer) {
  // We manipulate the raw docx XML to inject a watermark header
  // For simplicity and reliability, we prepend a styled watermark paragraph
  // via post-processing the document object. Since we receive a Buffer,
  // we return a new Buffer with injected content.

  // Note: If your controllers use buildCourtReadyDocx (which returns a docx
  // Document object before packing), pass the Document object instead for
  // cleaner watermark injection. This Buffer-level approach works as a
  // universal fallback.

  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(docxBuffer);
  const documentXmlFile = zip.file('word/document.xml');

  if (!documentXmlFile) return docxBuffer; // passthrough if can't parse

  let xml = await documentXmlFile.async('string');

  // Inject watermark paragraph right after <w:body>
  const watermarkPara = `
<w:p>
  <w:pPr>
    <w:jc w:val="center"/>
    <w:shd w:val="clear" w:color="auto" w:fill="F3F3F3"/>
  </w:pPr>
  <w:r>
    <w:rPr>
      <w:color w:val="BBBBBB"/>
      <w:sz w:val="20"/>
      <w:szCs w:val="20"/>
      <w:b/>
      <w:spacing w:val="300"/>
    </w:rPr>
    <w:t xml:space="preserve">⚠ ${WATERMARK_TEXT} — UPGRADE TO REMOVE WATERMARK ⚠</w:t>
  </w:r>
</w:p>`;

  xml = xml.replace('<w:body>', `<w:body>${watermarkPara}`);

  // Also inject before </w:body>
  xml = xml.replace('</w:body>', `${watermarkPara}</w:body>`);

  zip.file('word/document.xml', xml);
  const newBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return newBuffer;
}

// ─── Universal: detect type and apply appropriate watermark ──────────────────
export async function applyWatermark(buffer, fileType = 'pdf') {
  try {
    if (fileType === 'pdf') return await applyPdfWatermark(buffer);
    if (fileType === 'docx') return await applyDocxWatermark(buffer);
    return buffer; // unknown type, passthrough
  } catch (err) {
    console.error('[Watermark] Failed to apply watermark:', err.message);
    return buffer; // never break the download
  }
}
