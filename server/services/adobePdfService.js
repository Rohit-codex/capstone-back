import fetch from 'node-fetch';
import JSZip from 'jszip';
import { createRequire } from 'module';
import { Readable } from 'stream';
import crypto from 'crypto';
import { stampPdfUsingLayout } from './pdfOverlayService.js';

const ADOBE_AUTH_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';
const ADOBE_BASE_URL = 'https://pdf-services.adobe.io';
const _require = createRequire(import.meta.url);

const parseIntSafe = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const streamToBuffer = async (readable) => {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

export const isAdobePdfConfigured = () => {
  const enabled = (process.env.ADOBE_PDF_SERVICES_ENABLED || 'false').toLowerCase() === 'true';
  return enabled && !!process.env.ADOBE_PDF_CLIENT_ID && !!process.env.ADOBE_PDF_CLIENT_SECRET;
};

export const exportPdfToDocxWithAdobe = async (buffer, opts = {}) => {
  const sdk = _require('@adobe/pdfservices-node-sdk');
  const {
    ServicePrincipalCredentials,
    PDFServices,
    MimeType,
    ExportPDFParams,
    ExportPDFTargetFormat,
    ExportOCRLocale,
    ExportPDFJob,
    ExportPDFResult,
  } = sdk;

  const credentials = new ServicePrincipalCredentials({
    clientId: process.env.ADOBE_PDF_CLIENT_ID,
    clientSecret: process.env.ADOBE_PDF_CLIENT_SECRET,
  });
  const pdfServices = new PDFServices({ credentials });
  const readStream = Readable.from(buffer);
  const inputAsset = await pdfServices.upload({
    readStream,
    mimeType: MimeType.PDF,
  });

  const locale = String(opts.ocrLocale || process.env.ADOBE_PDF_EXPORT_OCR_LOCALE || 'EN_US').toUpperCase();
  // ExportPDFParams supports ocrLocale; using it enables OCR for scanned PDFs too.
  const params = new ExportPDFParams({
    targetFormat: ExportPDFTargetFormat.DOCX,
    ocrLocale: ExportOCRLocale[locale] || ExportOCRLocale.EN_US,
  });

  const job = new ExportPDFJob({ inputAsset, params });
  const pollingURL = await pdfServices.submit({ job });
  const pdfServicesResponse = await pdfServices.getJobResult({
    pollingURL,
    resultType: ExportPDFResult,
  });
  const resultAsset = pdfServicesResponse.result.asset;
  const streamAsset = await pdfServices.getContent({ asset: resultAsset });
  return streamToBuffer(streamAsset.readStream);
};

const extractViaAdobeSdk = async (buffer) => {
  const sdk = _require('@adobe/pdfservices-node-sdk');
  const {
    ServicePrincipalCredentials,
    PDFServices,
    MimeType,
    ExtractPDFParams,
    ExtractElementType,
    ExtractPDFJob,
    ExtractPDFResult,
  } = sdk;

  const credentials = new ServicePrincipalCredentials({
    clientId: process.env.ADOBE_PDF_CLIENT_ID,
    clientSecret: process.env.ADOBE_PDF_CLIENT_SECRET,
  });
  const pdfServices = new PDFServices({ credentials });
  const readStream = Readable.from(buffer);
  const inputAsset = await pdfServices.upload({
    readStream,
    mimeType: MimeType.PDF,
  });

  const params = new ExtractPDFParams({
    elementsToExtract: [ExtractElementType.TEXT, ExtractElementType.TABLES],
    getStylingInfo: true,
  });
  const job = new ExtractPDFJob({ inputAsset, params });
  const pollingURL = await pdfServices.submit({ job });
  const pdfServicesResponse = await pdfServices.getJobResult({
    pollingURL,
    resultType: ExtractPDFResult,
  });
  const resultAsset = pdfServicesResponse.result.resource;
  const streamAsset = await pdfServices.getContent({ asset: resultAsset });
  return streamToBuffer(streamAsset.readStream);
};

const getAdobeAccessToken = async () => {
  const clientId = process.env.ADOBE_PDF_CLIENT_ID || '';
  const clientSecret = process.env.ADOBE_PDF_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) {
    throw new Error('Adobe PDF credentials missing');
  }

  const scope = (process.env.ADOBE_PDF_SCOPE || 'openid,AdobeID,DCAPI').trim();
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope,
  });

  const response = await fetchWithTimeout(ADOBE_AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  }, parseIntSafe(process.env.ADOBE_PDF_AUTH_TIMEOUT_MS, 12000));

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Adobe auth failed (${response.status}): ${errText.substring(0, 250)}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error('Adobe auth response missing access_token');
  }
  return payload.access_token;
};

const createUploadAsset = async (token) => {
  const response = await fetchWithTimeout(`${ADOBE_BASE_URL}/assets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-api-key': process.env.ADOBE_PDF_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mediaType: 'application/pdf' }),
  }, parseIntSafe(process.env.ADOBE_PDF_CREATE_ASSET_TIMEOUT_MS, 15000));

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Adobe create asset failed (${response.status}): ${errText.substring(0, 250)}`);
  }

  const payload = await response.json();
  if (!payload?.uploadUri || !payload?.assetID) {
    throw new Error('Adobe create asset response missing uploadUri/assetID');
  }
  return payload;
};

const uploadPdfToAsset = async (uploadUri, buffer) => {
  const response = await fetchWithTimeout(uploadUri, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body: buffer,
  }, parseIntSafe(process.env.ADOBE_PDF_UPLOAD_TIMEOUT_MS, 25000));

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Adobe upload failed (${response.status}): ${errText.substring(0, 250)}`);
  }
};

const startExtractOperation = async (token, assetID) => {
  const headers = {
    Authorization: `Bearer ${token}`,
    'x-api-key': process.env.ADOBE_PDF_CLIENT_ID,
    'Content-Type': 'application/json',
  };
  const timeoutMs = parseIntSafe(process.env.ADOBE_PDF_START_OP_TIMEOUT_MS, 20000);
  const payloadVariants = [
    {
      assetID,
      elementsToExtract: ['text'],
      includeStylingInfo: true,
    },
    {
      assetID,
      elementsToExtract: ['text'],
      includeStylingInfo: true,
      elementsToExtractRenditions: [],
    },
    {
      assetID,
      elementsToExtract: ['text'],
    },
    {
      assetID,
      elementsToExtract: ['text', 'tables'],
      includeStylingInfo: true,
    },
  ];

  const errors = [];
  for (let i = 0; i < payloadVariants.length; i++) {
    const payload = payloadVariants[i];
    const response = await fetchWithTimeout(`${ADOBE_BASE_URL}/operation/extractpdf`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, timeoutMs);

    if (response.status === 202) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Adobe extract missing operation location header');
      return location;
    }

    const errText = await response.text().catch(() => '');
    errors.push({
      attempt: i + 1,
      status: response.status,
      payloadKeys: Object.keys(payload),
      message: errText.substring(0, 250),
    });
  }

  throw new Error(`Adobe extract start failed after ${payloadVariants.length} attempts: ${JSON.stringify(errors).substring(0, 900)}`);
};

const pollExtractOperation = async (token, location) => {
  const maxAttempts = parseIntSafe(process.env.ADOBE_PDF_POLL_MAX_ATTEMPTS, 20);
  const intervalMs = parseIntSafe(process.env.ADOBE_PDF_POLL_INTERVAL_MS, 1500);
  const pollTimeoutMs = parseIntSafe(process.env.ADOBE_PDF_POLL_TIMEOUT_MS, 12000);

  for (let i = 0; i < maxAttempts; i++) {
    const response = await fetchWithTimeout(location, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': process.env.ADOBE_PDF_CLIENT_ID,
      },
    }, pollTimeoutMs);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Adobe poll failed (${response.status}): ${errText.substring(0, 250)}`);
    }

    const payload = await response.json();
    const status = String(payload?.status || '').toLowerCase();
    if (status === 'done') {
      const downloadUri = payload?.asset?.downloadUri || payload?.resource?.downloadUri || '';
      if (!downloadUri) throw new Error('Adobe extract completed but downloadUri missing');
      return downloadUri;
    }
    if (status === 'failed') {
      throw new Error(`Adobe extract operation failed: ${JSON.stringify(payload?.error || payload).substring(0, 400)}`);
    }

    await sleep(intervalMs);
  }

  throw new Error('Adobe extract poll timed out');
};

const parseExtractZipPayload = async (zipBuffer) => {
  const zip = await JSZip.loadAsync(zipBuffer);
  const structuredName = Object.keys(zip.files).find((k) => /structuredData\.json$/i.test(k));
  if (!structuredName) throw new Error('Adobe extract zip missing structuredData.json');
  const jsonText = await zip.files[structuredName].async('text');
  const structured = JSON.parse(jsonText);
  const elements = Array.isArray(structured?.elements) ? structured.elements : [];
  const textChunks = elements
    .map((el) => (typeof el?.Text === 'string' ? el.Text : ''))
    .filter((t) => t.trim().length > 0);
  return {
    structured,
    text: textChunks.join('\n'),
  };
};

const inferPageFromPath = (path = '') => {
  const m = String(path).match(/Page\[(\d+)\]/i);
  if (!m) return 1;
  return Math.max(1, parseIntSafe(m[1], 1));
};

const inferLineY = (el) => {
  const b = Array.isArray(el?.Bounds) ? el.Bounds : null;
  // Adobe bounds are [left, bottom, right, top]
  if (b && b.length >= 4) return Number(b[3] || b[1] || 0);
  return 0;
};

const inferLineX = (el) => {
  const b = Array.isArray(el?.Bounds) ? el.Bounds : null;
  if (b && b.length >= 1) return Number(b[0] || 0);
  return 0;
};

const inferFontSize = (el) => {
  const fromAttrs = Number(el?.attributes?.TextSize || el?.TextSize || 0);
  if (fromAttrs > 0) return fromAttrs;
  const b = Array.isArray(el?.Bounds) ? el.Bounds : null;
  if (b && b.length >= 4) {
    const h = Math.abs(Number(b[3] || 0) - Number(b[1] || 0));
    if (h > 0) return h;
  }
  return 12;
};

const inferFontFamily = (el) => (
  String(el?.Font?.name || el?.attributes?.Font?.name || el?.FontName || '').trim() || null
);

const inferFontWeight = (el) => {
  const raw = String(el?.Font?.name || el?.attributes?.Font?.name || el?.FontName || '').toLowerCase();
  if (/bold|semibold|demibold|black/.test(raw)) return 700;
  return 400;
};

const groupElementsToStyledLines = (structured) => {
  const elements = Array.isArray(structured?.elements) ? structured.elements : [];
  const textEls = elements.filter((el) => typeof el?.Text === 'string' && el.Text.trim());
  const grouped = new Map();
  let maxRight = 0;

  for (const el of textEls) {
    const page = Number(el?.Page || inferPageFromPath(el?.Path));
    const y = inferLineY(el);
    const x = inferLineX(el);
    const b = Array.isArray(el?.Bounds) ? el.Bounds : null;
    const right = b && b.length >= 3 ? Number(b[2] || 0) : x;
    if (right > maxRight) maxRight = right;
    const lineBucket = Math.round(y / 3); // cluster nearby y into same line
    const key = `${page}:${lineBucket}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({
      text: String(el.Text || '').trim(),
      x,
      y,
      right,
      fontSize: inferFontSize(el),
      lineHeight: Math.max(10, inferFontSize(el) * 1.2),
      fontFamily: inferFontFamily(el),
      fontWeight: inferFontWeight(el),
      bold: /bold/i.test(String(el?.Font?.name || el?.attributes?.Font?.name || el?.FontName || '')),
    });
  }

  const rows = [];
  for (const [key, items] of grouped.entries()) {
    items.sort((a, b) => a.x - b.x);
    const [pageStr] = key.split(':');
    const page = parseIntSafe(pageStr, 1);
    const text = items.map((i) => i.text).join(' ').replace(/\s{2,}/g, ' ').trim();
    const x = items.length ? items[0].x : 0;
    const right = items.length ? items[items.length - 1].right : x;
    const y = items.length ? items[0].y : 0;
    const avgFont = items.length
      ? items.reduce((s, i) => s + (i.fontSize || 12), 0) / items.length
      : 12;
    const bold = items.filter((i) => i.bold).length >= Math.max(1, Math.round(items.length / 2));
    const avgLineHeight = items.length
      ? items.reduce((s, i) => s + (i.lineHeight || ((i.fontSize || 12) * 1.2)), 0) / items.length
      : (avgFont * 1.2);
    const families = items.map((i) => i.fontFamily).filter(Boolean);
    const primaryFamily = families.length ? families.sort((a, b) =>
      families.filter((x) => x === b).length - families.filter((x) => x === a).length
    )[0] : null;
    const avgWeight = items.length
      ? Math.round(items.reduce((s, i) => s + (i.fontWeight || 400), 0) / items.length)
      : (bold ? 700 : 400);
    const runs = items.map((i) => ({
      text: i.text,
      style: {
        fontFamily: i.fontFamily || primaryFamily || null,
        fontWeight: i.fontWeight || avgWeight || (bold ? 700 : 400),
        lineHeight: Math.max(10, Math.round(i.lineHeight || avgLineHeight)),
        fontSize: Math.max(9, Math.min(18, Math.round(i.fontSize || avgFont || 12))),
      },
    }));
    rows.push({ page, text, x, right, y, fontSize: avgFont, lineHeight: avgLineHeight, fontFamily: primaryFamily, fontWeight: avgWeight, bold, runs });
  }

  rows.sort((a, b) => (a.page - b.page) || (b.y - a.y) || (a.x - b.x));

  const pageWidth = maxRight > 0 ? maxRight : 600;
  return { rows, pageWidth };
};

const inferAlign = (x, right, pageWidth) => {
  const leftRatio = x / pageWidth;
  const rightRatio = right / pageWidth;
  const mid = (leftRatio + rightRatio) / 2;
  if (mid > 0.42 && mid < 0.58 && rightRatio < 0.85) return 'center';
  if (leftRatio > 0.62) return 'right';
  return 'left';
};

const normalizeRepeatKey = (text = '') => (
  String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\bpage\s*\d+\s*(?:of\s*\d+)?\b/g, 'page')
    .replace(/\b\d+\s*(?:\/|of)\s*\d+\b/g, 'n_of_n')
    .replace(/\b\d{1,4}\b/g, 'n')
    .trim()
);

const hasMetadataSignals = (text = '') => {
  const t = String(text || '').toLowerCase();
  return (
    /\b(page|downloaded|generated|web\s*copy|certified|digitally\s*signed)\b/.test(t) ||
    /\b(high\s*court|supreme\s*court|judicature|case\s*no|cwjc|dt\.?|dated)\b/.test(t)
  );
};

const isLegalAnchorLine = (text = '') => {
  const t = String(text || '').trim();
  return /^(?:versus|vs\.?|v\/s\.?|v\.)$/i.test(t) ||
    /\bpetitioner\/s?\b/i.test(t) ||
    /\brespondent\/s?\b/i.test(t) ||
    /\bcase\s*no\.?\b/i.test(t);
};

const filterLikelyMetadataRows = (rows = []) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const byPage = new Map();
  for (const row of rows) {
    const page = Number(row?.page || 1);
    if (!byPage.has(page)) byPage.set(page, []);
    byPage.get(page).push(row);
  }

  const ranges = new Map();
  for (const [page, pageRows] of byPage.entries()) {
    const ys = pageRows.map((r) => Number(r?.y || 0)).filter((n) => Number.isFinite(n));
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = ys.length ? Math.max(...ys) : 1;
    ranges.set(page, { minY, maxY, span: Math.max(1, maxY - minY) });
  }

  const repeatCounts = new Map();
  for (const row of rows) {
    const key = normalizeRepeatKey(row?.text || '');
    if (key.length < 8) continue;
    repeatCounts.set(key, (repeatCounts.get(key) || 0) + 1);
  }

  return rows.filter((row) => {
    const text = String(row?.text || '').trim();
    if (!text) return false;
    if (isLegalAnchorLine(text)) return true;

    const page = Number(row?.page || 1);
    const r = ranges.get(page) || { minY: 0, span: 1 };
    const pos = (Number(row?.y || 0) - r.minY) / r.span;
    const nearEdge = pos <= 0.08 || pos >= 0.92;
    if (!nearEdge) return true;

    const key = normalizeRepeatKey(text);
    const isRepeated = (repeatCounts.get(key) || 0) >= 2;
    const maybeMetadata = isRepeated && (hasMetadataSignals(text) || text.length <= 120);
    return !maybeMetadata;
  });
};

const buildStyledHtmlFromRows = (rows, pageWidth) => {
  if (!rows.length) return '';
  const html = [];
  let prev = null;
  for (const row of rows) {
    if (!row.text) continue;
    if (prev && row.page !== prev.page) html.push('<p><br></p>');
    const align = inferAlign(row.x, row.right, pageWidth);
    const indentPt = Math.max(0, Math.min(60, Math.round((row.x / pageWidth) * 72)));
    const fs = Math.max(9, Math.min(18, Math.round(row.fontSize || 12)));
    const fontWeight = row.bold ? '700' : '400';
    html.push(
      `<p style="text-align:${align};margin:0 0 2px 0;line-height:1.2;` +
      `font-size:${fs}pt;text-indent:${indentPt}pt;font-weight:${fontWeight};">${esc(row.text)}</p>`
    );
    prev = row;
  }
  return html.join('\n');
};

const buildLayoutDiagnostics = (rows, pageWidth) => {
  const pages = new Set(rows.map((r) => r.page)).size;
  const centerCount = rows.filter((r) => inferAlign(r.x, r.right, pageWidth) === 'center').length;
  const rightCount = rows.filter((r) => inferAlign(r.x, r.right, pageWidth) === 'right').length;
  const headingCount = rows.filter((r) => r.bold && (r.text || '').length < 100).length;
  const confidenceScore = rows.length > 20 ? 0.82 : rows.length > 8 ? 0.74 : 0.62;
  return {
    provider: 'adobe',
    confidenceLevel: confidenceScore >= 0.8 ? 'high' : (confidenceScore >= 0.7 ? 'medium' : 'low'),
    confidenceScore,
    detectedMode: 'editable',
    majorStructures: headingCount > 0 ? ['headings'] : [],
    pages,
    rows: rows.length,
    centerRows: centerCount,
    rightRows: rightCount,
  };
};

const buildLayoutModel = (rows, pageWidth) => {
  const pagesMap = new Map();
  for (const row of rows) {
    if (!row.text) continue;
    const pageNo = Number(row.page || 1);
    if (!pagesMap.has(pageNo)) {
      pagesMap.set(pageNo, { pageNumber: pageNo, width: pageWidth, blocks: [] });
    }
    const align = inferAlign(row.x, row.right, pageWidth);
    const width = Math.max(10, row.right - row.x);
    const height = Math.max(10, row.fontSize * 1.2);
    pagesMap.get(pageNo).blocks.push({
      id: crypto
        .createHash('sha1')
        .update(`${pageNo}|adobe|${Math.round(row.x)}|${Math.round(row.y)}|${Math.round(row.right)}|${row.text}`)
        .digest('hex')
        .slice(0, 20),
      type: 'line',
      text: row.text,
      bbox: [row.x, row.y - height, row.right, row.y],
      style: {
        align,
        fontSize: Math.max(9, Math.min(18, Math.round(row.fontSize || 12))),
        bold: !!row.bold,
        fontFamily: row.fontFamily || null,
        fontWeight: row.fontWeight || (row.bold ? 700 : 400),
        lineHeight: Math.max(10, Math.round(row.lineHeight || ((row.fontSize || 12) * 1.2))),
      },
      runs: Array.isArray(row.runs) ? row.runs : [],
    });
  }
  const pages = Array.from(pagesMap.values()).sort((a, b) => a.pageNumber - b.pageNumber);
  return { provider: 'adobe', pages };
};

export const extractPdfTextWithAdobe = async (buffer, fileName = 'document.pdf') => {
  const startedAt = Date.now();
  let zipBuffer;
  let mode = 'sdk';
  try {
    zipBuffer = await extractViaAdobeSdk(buffer);
  } catch (sdkErr) {
    mode = 'rest_fallback';
    const token = await getAdobeAccessToken();
    const asset = await createUploadAsset(token);
    await uploadPdfToAsset(asset.uploadUri, buffer);
    const location = await startExtractOperation(token, asset.assetID);
    const downloadUri = await pollExtractOperation(token, location);
    const zipRes = await fetchWithTimeout(downloadUri, { method: 'GET' }, parseIntSafe(process.env.ADOBE_PDF_DOWNLOAD_TIMEOUT_MS, 20000));
    if (!zipRes.ok) {
      const errText = await zipRes.text().catch(() => '');
      throw new Error(`Adobe download failed (${zipRes.status}): ${errText.substring(0, 250)} | sdkErr=${sdkErr.message}`);
    }
    zipBuffer = Buffer.from(await zipRes.arrayBuffer());
  }

  const parsed = await parseExtractZipPayload(zipBuffer);
  const { rows, pageWidth } = groupElementsToStyledLines(parsed.structured);
  const filteredRows = filterLikelyMetadataRows(rows);
  const html = buildStyledHtmlFromRows(filteredRows, pageWidth);
  const layoutDiagnostics = buildLayoutDiagnostics(filteredRows, pageWidth);
  const layoutModel = buildLayoutModel(filteredRows, pageWidth);
  const filteredText = filteredRows.map((r) => r.text).filter(Boolean).join('\n').trim();

  return {
    text: filteredText || parsed.text,
    html,
    layoutModel,
    layoutDiagnostics,
    diagnostics: {
      provider: 'adobe',
      mode,
      fileName,
      elapsedMs: Date.now() - startedAt,
      chars: (filteredText || parsed.text || '').length,
      rows: filteredRows.length,
      droppedRows: Math.max(0, rows.length - filteredRows.length),
    },
  };
};

// Template-stamp export path: keeps original PDF and overlays edited content by coordinates.
// Uses local overlay rendering while preserving Adobe extraction layout coordinates.
export const stampEditedPdfTemplate = async ({
  sourcePdfPath,
  layoutModel,
  editedText,
  fidelityEdits = null,
  outputDir,
  baseName,
}) => {
  return stampPdfUsingLayout({
    sourcePdfPath,
    layoutModel,
    editedText,
    fidelityEdits,
    outputDir,
    baseName,
  });
};

