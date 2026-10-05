
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GENERATED_DIR = path.join(__dirname, '..', 'uploads', 'generated');


fs.mkdirSync(GENERATED_DIR, { recursive: true });


const SOFFICE_PATHS = [
  'soffice',
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/usr/bin/soffice',
  '/usr/local/bin/soffice',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
];

async function generatePdfViaLibreOffice(docxBuffer, outputPath) {
  const { execFile } = await import('child_process');
  const { promisify } = await import('util');
  const execFileAsync = promisify(execFile);

  const tmpDocx = path.join(os.tmpdir(), `draft_${Date.now()}.docx`);
  fs.writeFileSync(tmpDocx, docxBuffer);

  let lastErr;
  for (const soffice of SOFFICE_PATHS) {
    try {
      await execFileAsync(soffice, [
        '--headless', '--norestore', '--convert-to', 'pdf',
        '--outdir', os.tmpdir(), tmpDocx,
      ], { timeout: 60000 });

      const tmpPdf = tmpDocx.replace(/\.docx$/, '.pdf');
      if (fs.existsSync(tmpPdf)) {
        fs.renameSync(tmpPdf, outputPath);
        fs.unlinkSync(tmpDocx);
        console.log(`✅ PDF via LibreOffice (${soffice}): ${path.basename(outputPath)}`);
        return outputPath;
      }
    } catch (e) {
      lastErr = e;
    }
  }
  if (fs.existsSync(tmpDocx)) fs.unlinkSync(tmpDocx);
  throw new Error(`LibreOffice conversion failed: ${lastErr?.message || 'soffice not found'}`);
}


function docTextToEnhancedHtml(text, title, designConfig, skipTitle = false, structuredParagraphs = null) {
  const dc = designConfig || {};
  const fontFamily     = dc.fontFamily || 'Times New Roman';
  const fontSize       = Number(dc.fontSize || 12);
  const headingSize    = Number(dc.headingSize || fontSize + 4);
  const bodyAlign      = dc.bodyAlignment === 'justified' ? 'justify' : (dc.bodyAlignment || 'justify');
  
  const lineHeight     = Math.min(Number(dc.lineSpacing || 1.5), 1.8);
  const marginIn = {
    top:    ((dc.margins?.top    || 1440) / 1440).toFixed(2),
    right:  ((dc.margins?.right  || 1440) / 1440).toFixed(2),
    bottom: ((dc.margins?.bottom || 1440) / 1440).toFixed(2),
    left:   ((dc.margins?.left   || 1440) / 1440).toFixed(2),
  };
  const primaryColor  = dc.colorScheme?.primary || '#000000';
  
  const letterSpacingCss  = dc.letterSpacing && Number(dc.letterSpacing)   ? `letter-spacing:${Number(dc.letterSpacing)}px;`   : '';
  const textTransformCss  = dc.textTransform  && dc.textTransform !== 'none' ? `text-transform:${dc.textTransform};`           : '';
  const paraSpaceAfterPt  = dc.paragraphSpacing?.after  != null ? Number(dc.paragraphSpacing.after)  : 6;
  const paraSpaceBeforePt = dc.paragraphSpacing?.before != null ? Number(dc.paragraphSpacing.before) : 0;
  const firstIndentPt     = dc.firstLineIndent ? (Number(dc.firstLineIndent) / 20).toFixed(1) : null;

  
  const headingRegex = /^[A-Z][A-Z\s\d.:\-'\u2019\u2018'\/()&,;]{2,80}$/;

  
  const buildHeadingHtml = (trimmed) => {
    const tAlign    = dc.titleAlignment   || 'center';
    const tBold     = dc.titleBold !== false;
    const tUline    = dc.titleUnderline   ? 'text-decoration:underline;' : '';
    const tItalic   = dc.titleItalic      ? 'font-style:italic;'         : '';
    return `<h2 style="text-align:${tAlign};font-family:'${fontFamily}';font-size:${headingSize}pt;font-weight:${tBold ? 'bold' : 'normal'};${tUline}${tItalic}margin:${paraSpaceBeforePt ? paraSpaceBeforePt + 'pt' : '10pt'} 0 4pt;">${escHtml(trimmed)}</h2>`;
  };

  
  const buildParaHtml = (trimmed, align) => {
    const resolvedAlign = align || bodyAlign;
    const indentStyle   = firstIndentPt ? `text-indent:${firstIndentPt}pt;` : '';
    const marginBottom  = `${paraSpaceAfterPt}pt`;
    const marginTop     = paraSpaceBeforePt ? `${paraSpaceBeforePt}pt` : '0';
    return `<p style="text-align:${resolvedAlign};font-family:'${fontFamily}';font-size:${fontSize}pt;line-height:${lineHeight};margin:${marginTop} 0 ${marginBottom};color:${primaryColor};${letterSpacingCss}${textTransformCss}${indentStyle}">${escHtml(trimmed)}</p>`;
  };

  let bodyHtml;

  if (structuredParagraphs && Array.isArray(structuredParagraphs) && structuredParagraphs.length > 0) {
    
    bodyHtml = structuredParagraphs.map(({ text: lineText, align }) => {
      if (!lineText || !lineText.trim()) return '<p style="margin:0;height:0.5em;"></p>';
      const trimmed   = lineText.trim();
      const isHeading = headingRegex.test(trimmed) && !trimmed.endsWith(',');
      return isHeading ? buildHeadingHtml(trimmed) : buildParaHtml(trimmed, align);
    }).join('\n');
  } else {
    
    bodyHtml = (text || '').split('\n').map(line => {
      if (!line.trim()) return '<p style="margin:0;height:0.5em;"></p>';
      const trimmed   = line.trim();
      const isHeading = headingRegex.test(trimmed) && !trimmed.endsWith(',');
      return isHeading ? buildHeadingHtml(trimmed) : buildParaHtml(trimmed, null);
    }).join('\n');
  }

  const borderCss = (dc.borderStyle && dc.borderStyle !== 'none')
    ? `border: 2px ${dc.borderStyle} ${dc.borderColor || '#000'};`
    : '';

  
  
  let topStampHtml = '';
  
  let imagesHtml = '';
  if (dc.images && Array.isArray(dc.images) && dc.images.length > 0) {
    const posStyles = {
      'top-left':      'position:fixed;top:0.3in;left:0.5in;',
      'top-center':    'position:fixed;top:0.3in;left:50%;transform:translateX(-50%);',
      'top-right':     'position:fixed;top:0.3in;right:0.5in;',
      'bottom-left':   'position:fixed;bottom:0.3in;left:0.5in;',
      'bottom-center': 'position:fixed;bottom:0.3in;left:50%;transform:translateX(-50%);',
      'bottom-right':  'position:fixed;bottom:0.3in;right:0.5in;',
      'center':        'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);',
    };
    for (const img of dc.images) {
      if (!img.data) continue;
      const src = img.data.startsWith('data:') ? img.data : `data:image/png;base64,${img.data}`;
      const opacityStyle = (img.opacity != null && img.opacity < 1) ? `opacity:${img.opacity};` : '';

      
      if (img.placement === 'top-full-width') {
        const stampW   = `${img.stampWidth || 100}%`;
        const align    = img.stampAlign || 'center';
        const gapBelow = `${img.stampMarginBottom ?? 8}px`;
        topStampHtml += `<div style="width:100%;text-align:${align};margin-bottom:${gapBelow};page-break-inside:avoid;">` +
          `<img src="${src}" style="width:${stampW};max-height:2.5in;object-fit:contain;${opacityStyle}" /></div>`;
        continue;
      }

      
      if (img.isWatermark || img.placement === 'watermark') continue;

      
      const w = img.width || 80;
      const h = img.height || 80;
      const pos = img.position || 'bottom-right';
      const posStyle = posStyles[pos] || posStyles['bottom-right'];
      imagesHtml += `<img src="${src}" style="${posStyle}width:${w}px;height:${h}px;object-fit:contain;${opacityStyle}z-index:10;" />`;
    }
  }

  
  const watermarkHtml = dc.watermarkText
    ? `<div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-315deg);
                   font-size:72pt;font-weight:bold;color:rgba(0,0,0,${dc.watermarkOpacity||0.12});
                   white-space:nowrap;pointer-events:none;z-index:0;letter-spacing:4px;">
         ${escHtml(dc.watermarkText)}
       </div>`
    : '';

  
  const h1Bold   = dc.titleBold  !== false ? 'font-weight:bold;'          : 'font-weight:normal;';
  const h1Uline  = dc.titleUnderline       ? 'text-decoration:underline;' : '';
  const h1Italic = dc.titleItalic          ? 'font-style:italic;'         : '';
  const h1Align  = dc.titleAlignment       || 'center';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  @page { size: ${dc.pageSize || 'A4'} ${dc.pageOrientation === 'landscape' ? 'landscape' : 'portrait'}; margin: ${marginIn.top}in ${marginIn.right}in ${marginIn.bottom}in ${marginIn.left}in; }
  body { font-family:'${fontFamily}',serif; font-size:${fontSize}pt; color:${primaryColor}; ${borderCss}${letterSpacingCss}${textTransformCss} }
  h1 { text-align:${h1Align}; font-size:${headingSize}pt; margin-bottom:12pt; ${h1Bold}${h1Uline}${h1Italic} }
  h2 { font-size:${headingSize}pt; }
  table { border-collapse:collapse; }
  td { border:none; }
</style>
</head>
<body>
${topStampHtml}
${watermarkHtml}
${imagesHtml}
${dc.headerText ? `<div style="text-align:${dc.headerAlignment || 'center'};color:#888;font-size:${fontSize - 1}pt;border-bottom:1px solid #ccc;padding-bottom:4pt;margin-bottom:12pt;">${escHtml(dc.headerText)}</div>` : ''}
${!skipTitle && title ? `<h1>${escHtml(title)}</h1>` : ''}
${bodyHtml}
${dc.footerText ? `<div style="text-align:${dc.footerAlignment || 'center'};color:#888;font-size:${fontSize - 1}pt;border-top:1px solid #ccc;padding-top:4pt;margin-top:12pt;">${escHtml(dc.footerText)}</div>` : ''}
</body>
</html>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function generatePdfViaPuppeteer(text, title, outputPath, designConfig, skipTitle = false, structuredParagraphs = null) {
  const puppeteer = await import('puppeteer');
  const html = docTextToEnhancedHtml(text, title, designConfig, skipTitle, structuredParagraphs);

  const browser = await puppeteer.default.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const dc = designConfig || {};
    await page.pdf({
      path: outputPath,
      format: dc.pageSize || 'A4',
      landscape: dc.pageOrientation === 'landscape',
      printBackground: true,
    });
    console.log(`✅ PDF via Puppeteer: ${path.basename(outputPath)}`);
  } finally {
    await browser.close();
  }
  return outputPath;
}

/**
 * Generate PDF from TipTap editor HTML content using Puppeteer.
 * Wraps the editor HTML in a full document with proper styling.
 */
async function generatePdfFromHtmlContent(htmlContent, outputPath, designConfig) {
  const puppeteer = await import('puppeteer');
  const dc = designConfig || {};
  const fontFamily = dc.fontFamily || 'Times New Roman';
  const fontSize = Number(dc.fontSize || dc.bodyFontSize || 12);
  const lineSpacing = Number(dc.lineSpacing || 1.5);
  const marginIn = {
    top:    ((dc.margins?.top    || 1440) / 1440).toFixed(2),
    right:  ((dc.margins?.right  || 1440) / 1440).toFixed(2),
    bottom: ((dc.margins?.bottom || 1440) / 1440).toFixed(2),
    left:   ((dc.margins?.left   || 1440) / 1440).toFixed(2),
  };

  const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<style>
  @page { size: ${dc.pageSize || 'A4'} ${dc.pageOrientation === 'landscape' ? 'landscape' : 'portrait'}; margin: ${marginIn.top}in ${marginIn.right}in ${marginIn.bottom}in ${marginIn.left}in; }
  body { font-family: '${fontFamily}', serif; font-size: ${fontSize}pt; line-height: ${lineSpacing}; color: #1a1a1a; margin: 0; padding: 0; }
  h1, h2, h3, h4, h5, h6 { margin: 0.5em 0 0.3em; }
  h1 { font-size: 2em; }
  h2 { font-size: 1.5em; }
  h3 { font-size: 1.17em; }
  p { margin: 0 0 0.4em; }
  strong, b { font-weight: bold; }
  em, i { font-style: italic; }
  u { text-decoration: underline; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0; }
  td, th { border: 1px solid #ccc; padding: 4px 8px; }
</style>
</head>
<body>
${htmlContent}
</body>
</html>`;

  const browser = await puppeteer.default.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, { waitUntil: 'networkidle0' });
    await page.pdf({
      path: outputPath,
      format: dc.pageSize || 'A4',
      landscape: dc.pageOrientation === 'landscape',
      printBackground: true,
    });
    console.log(`✅ PDF via Puppeteer (HTML content): ${path.basename(outputPath)}`);
  } finally {
    await browser.close();
  }
  return outputPath;
}



export async function generatePdf({ docxBuffer, text, htmlContent, structuredParagraphs, title, baseName, designConfig, skipTitle = false }) {
  const timestamp = Date.now();
  const safeBase = (baseName || 'document').replace(/[^a-z0-9_-]/gi, '_').substring(0, 40);

  
  if (docxBuffer) {
    try {
      const outputFilename = `${safeBase}_${timestamp}.pdf`;
      const outputPath = path.join(GENERATED_DIR, outputFilename);
      await generatePdfViaLibreOffice(docxBuffer, outputPath);
      return {
        filename: outputFilename,
        path: outputPath,
        downloadUrl: `/api/files/download/${outputFilename}`,
        format: 'pdf',
        engine: 'libreoffice',
      };
    } catch (e) {
      console.warn('⚠️  LibreOffice PDF failed, trying Puppeteer:', e.message);
    }
  }

  // Puppeteer fallback: prefer editor HTML over raw text for better formatting
  if (htmlContent || text || structuredParagraphs) {
    try {
      const outputFilename = `${safeBase}_${timestamp}.pdf`;
      const outputPath = path.join(GENERATED_DIR, outputFilename);
      if (htmlContent) {
        // Use the actual TipTap editor HTML directly — preserves all formatting
        await generatePdfFromHtmlContent(htmlContent, outputPath, designConfig);
      } else {
        await generatePdfViaPuppeteer(text || '', title, outputPath, designConfig, skipTitle, structuredParagraphs);
      }
      return {
        filename: outputFilename,
        path: outputPath,
        downloadUrl: `/api/files/download/${outputFilename}`,
        format: 'pdf',
        engine: 'puppeteer',
      };
    } catch (e) {
      console.warn('⚠️  Puppeteer PDF failed, falling back to HTML:', e.message);
    }
  }

  
  const htmlFilename = `${safeBase}_${timestamp}.html`;
  const htmlPath = path.join(GENERATED_DIR, htmlFilename);
  const fallbackHtml = docTextToEnhancedHtml(text || '', title, designConfig, skipTitle, structuredParagraphs);
  fs.writeFileSync(htmlPath, fallbackHtml, 'utf-8');
  console.warn('ℹ️  PDF generation unavailable — HTML file saved instead');
  return {
    filename: htmlFilename,
    path: htmlPath,
    downloadUrl: `/api/files/download/${htmlFilename}`,
    format: 'html',
    engine: 'html-fallback',
    note: 'PDF generation unavailable, HTML provided instead',
  };
}

export default { generatePdf };
