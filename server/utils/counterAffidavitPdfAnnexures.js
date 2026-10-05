import fs from 'fs';
import path from 'path';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export async function getPdfPageCount(buffer) {
  if (!buffer?.length) return 0;
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    const n = Number(data?.numpages || 0);
    if (n > 0) return n;
    const text = String(data?.text || '');
    const markers = text.match(/--\s*\d+\s+of\s+\d+\s*--/gi);
    if (markers?.length) {
      const last = markers[markers.length - 1].match(/\d+\s*$/);
      return last ? Number(last[0]) : markers.length;
    }
    return text.trim() ? 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * Render PDF pages as PNG data URLs for photostat annexures (Counter Studio export).
 */
export async function renderPdfPagesAsDataUrls(buffer, pageNumbers = [1]) {
  const pages = [...new Set(pageNumbers.map((p) => Number(p)).filter((p) => p >= 1))].sort((a, b) => a - b);
  if (!buffer?.length || !pages.length) return [];

  try {
    const { fromBuffer } = await import('pdf2pic');
    const converter = fromBuffer(buffer, {
      density: 150,
      format: 'png',
      width: 850,
      preserveAspectRatio: true,
    });
    const out = [];
    for (const page of pages) {
      try {
        const res = await converter(page, { responseType: 'base64' });
        const b64 = res?.base64 || res?.buffer?.toString?.('base64');
        if (b64) {
          out.push({ page, dataUrl: `data:image/png;base64,${b64}` });
        }
      } catch (pageErr) {
        console.warn(`[CounterAnnex] pdf2pic page ${page}:`, pageErr?.message || pageErr);
      }
    }
    if (out.length) return out;
  } catch (err) {
    console.warn('[CounterAnnex] pdf2pic unavailable:', err?.message || err);
  }

  return renderPdfPagesViaPuppeteer(buffer, pages);
}

async function renderPdfPagesViaPuppeteer(buffer, pages) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-annex-'));
  const pdfPath = path.join(tmpDir, 'source.pdf');
  fs.writeFileSync(pdfPath, buffer);
  const fileUrl = pathToFileURL(pdfPath).toString();
  let browser;
  const out = [];
  try {
    const puppeteer = await import('puppeteer');
    browser = await puppeteer.default.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const tab = await browser.newPage();
    await tab.setViewport({ width: 850, height: 1100, deviceScaleFactor: 1.5 });
    await tab.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 90000 });
    for (const pageNum of pages) {
      try {
        // Navigate to page number programmatically instead of using PageDown
        await tab.evaluate((page) => {
          if (window.PDFViewerApplication) {
            window.PDFViewerApplication.page = page;
          }
        }, pageNum);
        // Wait for page to render
        await new Promise((r) => setTimeout(r, 400));
        const shot = await tab.screenshot({ type: 'png', encoding: 'base64', fullPage: false });
        out.push({ page: pageNum, dataUrl: `data:image/png;base64,${shot}` });
      } catch (shotErr) {
        console.warn(`[CounterAnnex] puppeteer page ${pageNum}:`, shotErr?.message || shotErr);
      }
    }
  } catch (err) {
    console.warn('[CounterAnnex] puppeteer fallback failed:', err?.message || err);
  } finally {
    try {
      if (browser) await browser.close();
    } catch (_) {}
    try {
      fs.unlinkSync(pdfPath);
      fs.rmdirSync(tmpDir);
    } catch (_) {}
  }
  return out;
}
