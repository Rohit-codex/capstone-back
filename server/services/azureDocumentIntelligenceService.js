import fetch from 'node-fetch';
import crypto from 'crypto';
import { marked } from 'marked';

const parseIntSafe = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeEndpoint = (raw = '') => {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (s = '') => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Azure DI Markdown → clean HTML ───────────────────────────────────────────
// Azure DI result.content is structured Markdown: headings (#), bold (**),
// lists (-), tables (|).  Converting it directly gives far better HTML than
// reconstructing from bounding boxes, because Azure's own model produced it.
const markdownToEditableHtml = (mdContent = '') => {
  if (!mdContent || typeof mdContent !== 'string') return '';
  try {
    // Configure marked: synchronous, no async, GFM tables enabled
    marked.setOptions({ gfm: true, breaks: false });

    // Azure DI uses :selected: / :unselected: for checkboxes — strip them
    const cleaned = mdContent
      .replace(/:selected:/g, '[x]')
      .replace(/:unselected:/g, '[ ]')
      // Page break markers (<!-- PageBreak -->) → horizontal rule
      .replace(/<!--\s*PageBreak\s*-->/gi, '\n\n---\n\n')
      // Page header/footer markers → discard
      .replace(/<!--\s*Page(?:Header|Footer)[^>]*-->/gi, '');

    const rawHtml = marked.parse(cleaned);

    // Post-process: inject inline styles so Tiptap renders faithfully
    // (Tiptap strips bare tags but respects inline style)
    return rawHtml
      // Headings → keep tags, add weight/size so Tiptap doesn't strip them
      .replace(/<h1>/gi, '<h1 style="font-size:16pt;font-weight:700;margin:12px 0 4px 0;">')
      .replace(/<h2>/gi, '<h2 style="font-size:14pt;font-weight:700;margin:10px 0 4px 0;">')
      .replace(/<h3>/gi, '<h3 style="font-size:12pt;font-weight:700;margin:8px 0 4px 0;">')
      // Paragraphs → clean spacing
      .replace(/<p>/gi, '<p style="margin:0 0 6px 0;text-align:justify;line-height:1.5;">')
      // Tables → styled
      .replace(/<table>/gi, '<table style="border-collapse:collapse;width:100%;margin:8px 0;font-size:11pt;">')
      .replace(/<th>/gi, '<th style="border:1px solid #333;padding:4px 8px;background:#f0f0f0;">')
      .replace(/<td>/gi, '<td style="border:1px solid #333;padding:4px 8px;vertical-align:top;">')
      // Lists
      .replace(/<ul>/gi, '<ul style="padding-left:2em;margin:4px 0;">')
      .replace(/<ol>/gi, '<ol style="padding-left:2em;margin:4px 0;">')
      .replace(/<li>/gi, '<li style="margin-bottom:2px;">');
  } catch (err) {
    console.warn('[Azure DI] markdownToEditableHtml failed:', err.message);
    return '';
  }
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const isAzureDocumentIntelligenceConfigured = () => {
  const enabled = String(process.env.AZURE_DI_ENABLED || 'false').toLowerCase() === 'true';
  const endpoint = normalizeEndpoint(process.env.AZURE_DI_ENDPOINT || process.env.AZURE_OCR_ENDPOINT || '');
  const key = String(process.env.AZURE_DI_KEY || process.env.AZURE_OCR_KEY || '').trim();
  return enabled && !!endpoint && !!key;
};

const polygonToBBox = (polygon = []) => {
  const nums = Array.isArray(polygon) ? polygon.map((n) => Number(n)) : [];
  if (nums.length < 8) return null;
  const xs = [];
  const ys = [];
  for (let i = 0; i < nums.length; i += 2) {
    xs.push(nums[i]);
    ys.push(nums[i + 1]);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return [minX, minY, maxX, maxY];
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

const isStandalonePageMarker = (text = '') => {
  const t = String(text || '').trim();
  if (!t) return false;
  return /^(?:-+\s*)?\d+\s*(?:\/|of)\s*\d+(?:\s*-+)?$/i.test(t) || /^page\s*\d+\s*(?:of\s*\d+)?$/i.test(t);
};

const filterLikelyMetadataRows = (rows = [], opts = {}) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const keepFooterInBody = !!opts.keepFooterInBody;
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
    ranges.set(page, { minY, span: Math.max(1, maxY - minY) });
  }
  const repeatCounts = new Map();
  for (const row of rows) {
    const key = normalizeRepeatKey(row?.text || '');
    if (key.length < 8) continue;
    repeatCounts.set(key, (repeatCounts.get(key) || 0) + 1);
  }
  const removed = [];
  const kept = rows.filter((row) => {
    const text = String(row?.text || '').trim();
    if (!text) return false;
    if (isLegalAnchorLine(text)) return true;
    if (isStandalonePageMarker(text)) {
      removed.push({ page: row.page, text, reason: 'page_marker' });
      return false;
    }
    const page = Number(row?.page || 1);
    const r = ranges.get(page) || { minY: 0, span: 1 };
    const pos = (Number(row?.y || 0) - r.minY) / r.span;
    const isFooterBand = pos >= 0.92;
    const nearEdge = pos <= 0.08 || isFooterBand;
    if (keepFooterInBody && isFooterBand) return true;
    if (!nearEdge) return true;
    const key = normalizeRepeatKey(text);
    const repeated = (repeatCounts.get(key) || 0) >= 2;
    const maybeMetadata = repeated && (hasMetadataSignals(text) || text.length <= 120);
    if (maybeMetadata) {
      removed.push({ page: row.page, text, reason: pos <= 0.08 ? 'header_repeat' : 'footer_repeat' });
      return false;
    }
    return true;
  });
  return { kept, removed };
};

const convertToPx = (value, unit = 'pixel') => {
  const v = Number(value || 0);
  if (!Number.isFinite(v)) return 0;
  const u = String(unit || 'pixel').toLowerCase();
  if (u === 'inch' || u === 'inches') return v * 96;
  if (u === 'millimeter' || u === 'millimeters' || u === 'mm') return v * (96 / 25.4);
  if (u === 'centimeter' || u === 'cm') return v * (96 / 2.54);
  return v;
};

const inferAlign = (x, right, pageWidth) => {
  const leftRatio = x / pageWidth;
  const rightRatio = right / pageWidth;
  const mid = (leftRatio + rightRatio) / 2;
  if (mid > 0.42 && mid < 0.58 && rightRatio < 0.85) return 'center';
  if (leftRatio > 0.62) return 'right';
  return 'left';
};

const buildSpanStyleIndex = (styles = []) => {
  const index = [];
  for (const st of (Array.isArray(styles) ? styles : [])) {
    const spans = Array.isArray(st?.spans) ? st.spans : [];
    for (const sp of spans) {
      const offset = Number(sp?.offset || 0);
      const length = Number(sp?.length || 0);
      if (!Number.isFinite(offset) || !Number.isFinite(length) || length <= 0) continue;
      index.push({
        start: offset,
        end: offset + length,
        fontFamily: st?.fontFamily || st?.similarFontFamily || null,
        fontStyle: st?.fontStyle || null,
        fontWeight: Number(st?.fontWeight || 0) || null,
      });
    }
  }
  return index;
};

const resolveStyleForLine = (line, spanIndex = []) => {
  const spans = Array.isArray(line?.spans) ? line.spans : [];
  for (const sp of spans) {
    const start = Number(sp?.offset || 0);
    const end = start + Number(sp?.length || 0);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const hit = spanIndex.find((x) => !(x.end <= start || x.start >= end));
    if (hit) {
      return {
        fontFamily: hit.fontFamily || null,
        fontStyle: hit.fontStyle || null,
        fontWeight: hit.fontWeight || null,
      };
    }
  }
  return { fontFamily: null, fontStyle: null, fontWeight: null };
};

const buildStyledHtmlFromRows = (rows, pageWidth) => {
  if (!rows.length) return '';
  const html = [];
  let prev = null;
  for (const row of rows) {
    if (!row.text) continue;
    if (row.type === 'tableCell') {
      const fsTable = Math.max(9, Math.min(14, Math.round(row.fontSize || 10)));
      html.push(`<p style="margin:0 0 2px 0;line-height:1.2;font-size:${fsTable}pt;">${esc(row.text)}</p>`);
      prev = row;
      continue;
    }
    if (prev && row.page !== prev.page) html.push('<p><br></p>');
    const align = inferAlign(row.x, row.right, pageWidth);
    const indentPt = Math.max(0, Math.min(60, Math.round((row.x / pageWidth) * 72)));
    const fs = Math.max(9, Math.min(16, Math.round(row.fontSize || 11)));
    html.push(
      `<p style="text-align:${align};margin:0 0 2px 0;line-height:1.2;` +
      `font-size:${fs}pt;text-indent:${indentPt}pt;">${esc(row.text)}</p>`
    );
    prev = row;
  }
  return html.join('\n');
};

// ── Paragraph-level layout model ─────────────────────────────────────────────
// Uses Azure DI's pre-grouped `result.paragraphs` instead of raw lines.
// This gives us logically merged text blocks with role annotations (title,
// sectionHeading, footnote, etc.) — far better than individual OCR lines.
const extractParagraphRows = (result, pages, spanIndex) => {
  const paragraphs = Array.isArray(result?.paragraphs) ? result.paragraphs : [];
  if (paragraphs.length === 0) return null;

  const rows = [];
  let maxRight = 0;

  const ROLE_MAP = {
    title: 'title',
    sectionheading: 'heading',
    footnote: 'body',
    pageheader: 'pageHeader',
    pagefooter: 'pageFooter',
    pagenumber: 'pageFooter',
    formfield: 'body',
    formula: 'body',
    caption: 'body',
  };

  for (const para of paragraphs) {
    const paraRoleRaw = String(para?.role || '').toLowerCase();
    const regions = Array.isArray(para?.boundingRegions) ? para.boundingRegions : [];
    // Azure uses \n inside paragraph content to denote line breaks — collapse to spaces
    const paraContent = String(para?.content || '')
      .replace(/\r\n|\r/g, '\n')
      .replace(/\n+/g, ' ')
      .trim();
    if (!paraContent) continue;

    // Resolve dominant font style via span index
    const paraSpans = Array.isArray(para?.spans) ? para.spans : [];
    let domStyle = { fontFamily: null, fontStyle: null, fontWeight: null };
    for (const sp of paraSpans) {
      const start = Number(sp?.offset || 0);
      const end = start + Number(sp?.length || 0);
      const hit = spanIndex.find((s) => !(s.end <= start || s.start >= end));
      if (hit) {
        domStyle = {
          fontFamily: hit.fontFamily || domStyle.fontFamily,
          fontStyle: hit.fontStyle || domStyle.fontStyle,
          fontWeight: hit.fontWeight || domStyle.fontWeight,
        };
        if (domStyle.fontWeight) break; // stop at first styled span
      }
    }

    for (const region of regions) {
      const pageNo = Number(region?.pageNumber || 1);
      const polygon = Array.isArray(region?.polygon) ? region.polygon : [];
      const bboxRaw = polygonToBBox(polygon);
      if (!bboxRaw) continue;

      const page = pages.find((p) => Number(p?.pageNumber || 1) === pageNo) || {};
      const unit = String(page?.unit || 'pixel').toLowerCase();
      const pw = convertToPx(page?.width || 0, unit) || 600;
      const ph = convertToPx(page?.height || 0, unit) || 1200;

      const x = convertToPx(bboxRaw[0], unit);
      const y = convertToPx(bboxRaw[1], unit);
      const right = convertToPx(bboxRaw[2], unit);
      const bottom = convertToPx(bboxRaw[3], unit);
      const height = Math.max(8, bottom - y);
      if (right > maxRight) maxRight = right;

      const lineCount = Math.max(1, (para?.content || '').split('\n').length);
      const estimatedLineH = height / lineCount;
      const estimatedFontSize = Math.max(9, Math.min(22, Math.round(estimatedLineH / 1.25)));

      const yPos = ph > 0 ? (y / ph) : 0.5;
      const posRole = yPos <= 0.07 ? 'pageHeader' : yPos >= 0.93 ? 'pageFooter' : null;
      const mappedRole = posRole || ROLE_MAP[paraRoleRaw] || 'body';

      const align = inferAlign(x, right, pw);

      rows.push({
        page: pageNo,
        text: paraContent,
        x, right, y, bottom, pageHeight: ph,
        role: mappedRole,
        type: 'paragraph',
        fontSize: estimatedFontSize,
        lineHeight: Math.max(10, Math.round(estimatedLineH * 1.15)),
        fontFamily: domStyle.fontFamily,
        fontStyle: domStyle.fontStyle,
        fontWeight: domStyle.fontWeight,
        runs: [{
          text: paraContent,
          style: {
            fontFamily: domStyle.fontFamily,
            fontStyle: domStyle.fontStyle,
            fontWeight: domStyle.fontWeight,
            fontSize: estimatedFontSize,
            lineHeight: Math.max(10, Math.round(estimatedLineH * 1.15)),
          },
        }],
      });
    }
  }

  if (rows.length === 0) return null;
  rows.sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));
  return { rows, maxRight };
};

const buildLayoutModel = (rows, pageWidth) => {
  const pagesMap = new Map();
  for (const row of rows) {
    const pageNo = Number(row.page || 1);
    if (!pagesMap.has(pageNo)) {
      pagesMap.set(pageNo, { pageNumber: pageNo, width: pageWidth, height: row.pageHeight || null, blocks: [] });
    }
    const align = inferAlign(row.x, row.right, pageWidth);
    const blockId = crypto
      .createHash('sha1')
      .update(`${pageNo}|${row.type || 'line'}|${Math.round(row.x)}|${Math.round(row.y)}|${Math.round(row.right)}|${Math.round(row.bottom || 0)}|${row.text}`)
      .digest('hex')
      .slice(0, 20);
    pagesMap.get(pageNo).blocks.push({
      id: blockId,
      type: row.type || 'line',
      role: row.role || 'body',
      text: row.text,
      bbox: [row.x, row.y, row.right, row.bottom || (row.y + Math.max(10, row.fontSize * 1.2))],
      style: {
        align,
        fontSize: Math.max(9, Math.min(16, Math.round(row.fontSize || 11))),
        bold: Number(row.fontWeight || 0) >= 600,
        fontFamily: row.fontFamily || null,
        fontWeight: row.fontWeight || null,
        lineHeight: Math.max(10, Math.round(row.lineHeight || ((row.fontSize || 11) * 1.15))),
        fontStyle: row.fontStyle || null,
      },
      runs: Array.isArray(row.runs) ? row.runs : [],
      border: row.border || null,
      table: row.table || null,
    });
  }
  return {
    provider: 'azure_document_intelligence',
    unit: 'px',
    pages: Array.from(pagesMap.values()).sort((a, b) => a.pageNumber - b.pageNumber),
  };
};

const collectTableRows = (result, pages) => {
  const tables = Array.isArray(result?.tables) ? result.tables : [];
  const rows = [];
  for (let tableIdx = 0; tableIdx < tables.length; tableIdx += 1) {
    const table = tables[tableIdx];
    const cells = Array.isArray(table?.cells) ? table.cells : [];
    for (const cell of cells) {
      const text = String(cell?.content || '').trim();
      if (!text) continue;
      const region = Array.isArray(cell?.boundingRegions) ? cell.boundingRegions[0] : null;
      const polygon = region?.polygon || [];
      const pageNo = Number(region?.pageNumber || 1);
      const page = pages.find((p) => Number(p?.pageNumber || 1) === pageNo) || {};
      const unit = String(page?.unit || 'pixel').toLowerCase();
      const bboxRaw = polygonToBBox(polygon);
      if (!bboxRaw) continue;
      const x = convertToPx(bboxRaw[0], unit);
      const y = convertToPx(bboxRaw[1], unit);
      const right = convertToPx(bboxRaw[2], unit);
      const bottom = convertToPx(bboxRaw[3], unit);
      const pageHeight = convertToPx(page?.height || 0, unit);
      rows.push({
        type: 'tableCell',
        page: pageNo,
        role: 'body',
        text,
        x,
        y,
        right,
        bottom,
        pageHeight,
        fontSize: Math.max(9, Math.round(bottom - y)),
        lineHeight: Math.max(10, Math.round((bottom - y) * 1.15)),
        border: { top: true, right: true, bottom: true, left: true },
        runs: [
          {
            text,
            style: {
              fontSize: Math.max(9, Math.round(bottom - y)),
              lineHeight: Math.max(10, Math.round((bottom - y) * 1.15)),
              fontWeight: 400,
            },
          },
        ],
        table: {
          tableId: `table_${tableIdx + 1}`,
          row: Number(cell?.rowIndex || 0),
          col: Number(cell?.columnIndex || 0),
          rowSpan: Number(cell?.rowSpan || 1),
          colSpan: Number(cell?.columnSpan || 1),
        },
      });
    }
  }
  return rows;
};

export const extractPdfTextWithAzureDocumentIntelligence = async (buffer, options = {}) => {
  const endpoint = normalizeEndpoint(process.env.AZURE_DI_ENDPOINT || process.env.AZURE_OCR_ENDPOINT || '');
  const key = String(process.env.AZURE_DI_KEY || process.env.AZURE_OCR_KEY || '').trim();
  // Default to 2024-11-30 GA (supports markdown output, prebuilt-layout, paragraphs).
  // Override via AZURE_DI_API_VERSION env var if needed.
  const apiVersion = process.env.AZURE_DI_API_VERSION || '2024-11-30';
  // prebuilt-layout gives structural roles (title, sectionHeading) + table detection.
  // Override via AZURE_DI_MODEL_ID env var.
  const modelId = process.env.AZURE_DI_MODEL_ID || 'prebuilt-layout';

  if (!endpoint || !key) throw new Error('Azure Document Intelligence endpoint/key missing');

  const startedAt = Date.now();

  // outputContentFormat=markdown is supported from API version 2024-02-29-preview onwards.
  // It makes Azure DI return result.content as structured Markdown (# headings, **bold**,
  // - lists, | tables) instead of plain text — dramatically improves editable HTML quality.
  const supportsMarkdown = apiVersion >= '2024-02-29';
  const markdownParam = supportsMarkdown ? '&outputContentFormat=markdown' : '';

  const analyzeUrls = [
    `${endpoint}/documentintelligence/documentModels/${encodeURIComponent(modelId)}:analyze?api-version=${encodeURIComponent(apiVersion)}${markdownParam}`,
    `${endpoint}/formrecognizer/documentModels/${encodeURIComponent(modelId)}:analyze?api-version=${encodeURIComponent(apiVersion)}`,
  ];
  const submitTimeout = parseIntSafe(process.env.AZURE_DI_SUBMIT_TIMEOUT_MS, 25000);

  let submitRes = null;
  let analyzeUrlUsed = '';
  let lastSubmitError = '';
  for (const candidateUrl of analyzeUrls) {
    const res = await fetchWithTimeout(candidateUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Content-Type': 'application/pdf',
      },
      body: buffer,
    }, submitTimeout);

    if (res.status === 202 || res.status === 201) {
      submitRes = res;
      analyzeUrlUsed = candidateUrl;
      break;
    }

    const errText = await res.text().catch(() => '');
    lastSubmitError =
      `url=${candidateUrl} status=${res.status} body=${String(errText).substring(0, 250)}`;
  }

  if (!submitRes) {
    throw new Error(`Azure DI submit failed on all URL variants: ${lastSubmitError}`);
  }

  const operationUrl = submitRes.headers.get('operation-location');
  if (!operationUrl) throw new Error('Azure DI missing operation-location');

  const pollMax = parseIntSafe(process.env.AZURE_DI_POLL_MAX_ATTEMPTS, 30);
  const pollInterval = parseIntSafe(process.env.AZURE_DI_POLL_INTERVAL_MS, 1200);
  const pollTimeout = parseIntSafe(process.env.AZURE_DI_POLL_TIMEOUT_MS, 15000);

  for (let i = 0; i < pollMax; i++) {
    const pollRes = await fetchWithTimeout(operationUrl, {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': key },
    }, pollTimeout);

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => '');
      throw new Error(`Azure DI poll failed (${pollRes.status}): ${errText.substring(0, 300)}`);
    }

    const payload = await pollRes.json();
    const status = String(payload?.status || '').toLowerCase();
    if (status === 'succeeded') {
      const result = payload?.analyzeResult || {};
      const pages = Array.isArray(result?.pages) ? result.pages : [];
      const spanIndex = buildSpanStyleIndex(result?.styles || []);
      const rows = [];
      let maxRight = 0;
      let lineCount = 0;

      for (let pageIdx = 0; pageIdx < pages.length; pageIdx += 1) {
        const page = pages[pageIdx];
        const pageNo = Number(page?.pageNumber || pageIdx + 1);
        const pageUnit = String(page?.unit || 'pixel').toLowerCase();
        const pageWidth = convertToPx(page?.width || 0, pageUnit);
        const pageHeight = convertToPx(page?.height || 0, pageUnit);
        if (pageWidth > maxRight) maxRight = pageWidth;
        const pageLines = Array.isArray(page?.lines) ? page.lines : [];
        lineCount += pageLines.length;
        for (const line of pageLines) {
          const text = String(line?.content || '').trim();
          if (!text) continue;
          const bbox = polygonToBBox(line?.polygon || []);
          const left = bbox ? convertToPx(bbox[0], pageUnit) : 0;
          const top = bbox ? convertToPx(bbox[1], pageUnit) : 0;
          const right = bbox ? convertToPx(bbox[2], pageUnit) : Math.max(left + 100, pageWidth * 0.7);
          const bottom = bbox ? convertToPx(bbox[3], pageUnit) : (top + 11);
          const height = Math.max(8, bottom - top);
          if (right > maxRight) maxRight = right;
          const yPos = pageHeight > 0 ? (top / pageHeight) : 0.5;
          const role = yPos <= 0.08 ? 'pageHeader' : (yPos >= 0.92 ? 'pageFooter' : 'body');
          const lineStyle = resolveStyleForLine(line, spanIndex);
          rows.push({
            page: pageNo,
            text,
            x: left,
            right,
            y: top,
            bottom,
            pageHeight,
            role,
            fontSize: height,
            lineHeight: Math.max(10, Math.round(height * 1.15)),
            fontFamily: lineStyle.fontFamily,
            fontStyle: lineStyle.fontStyle,
            fontWeight: lineStyle.fontWeight || null,
            runs: [
              {
                text,
                style: {
                  fontFamily: lineStyle.fontFamily || null,
                  fontStyle: lineStyle.fontStyle || null,
                  fontWeight: lineStyle.fontWeight || null,
                  fontSize: Math.max(9, Math.min(16, Math.round(height || 11))),
                  lineHeight: Math.max(10, Math.round(height * 1.15)),
                },
              },
            ],
          });
        }
      }
      // ── Prefer paragraph-level grouping when Azure provides it ──────────────
      // Azure DI's result.paragraphs merges OCR lines into logical paragraphs
      // with role annotations (title, sectionHeading, etc.).  Using them as
      // the editable layout model is far superior to raw line-by-line rendering.
      const paraData = extractParagraphRows(result, pages, spanIndex);
      const tableRows = collectTableRows(result, pages);

      // Build the final row set: paragraphs (or lines) + table cells
      let primaryRows;
      if (paraData && paraData.rows.length >= Math.max(3, lineCount * 0.3)) {
        // Paragraph path: Azure pre-merged rows are the text source
        primaryRows = [...paraData.rows, ...tableRows];
        if (paraData.maxRight > maxRight) maxRight = paraData.maxRight;
      } else {
        // Fallback: raw lines + table cells (original behaviour)
        primaryRows = [...rows, ...tableRows];
      }
      primaryRows.sort((a, b) => (a.page - b.page) || (a.y - b.y) || (a.x - b.x));

      const keepFooterInBody = typeof options.keepFooterInBody === 'boolean'
        ? options.keepFooterInBody
        : (String(process.env.AZURE_DI_KEEP_FOOTER_IN_BODY || 'false').toLowerCase() === 'true');
      const filtered = filterLikelyMetadataRows(primaryRows, { keepFooterInBody });
      const filteredRows = filtered.kept;
      const pageWidth = maxRight > 0 ? maxRight : 600;
      const text = filteredRows.map((r) => r.text).join('\n').trim();
      const html = buildStyledHtmlFromRows(filteredRows, pageWidth);
      const layoutModel = buildLayoutModel(filteredRows, pageWidth);

      // ── Markdown → HTML (highest-quality editable source) ──────────────────
      // Azure DI result.content is structured Markdown produced directly by the
      // model — headings, bold, lists and tables are already correct.
      // We store this as markdownHtml and prefer it over the layout-based HTML.
      const rawMarkdown = String(result?.content || '');
      const markdownHtml = rawMarkdown.length > 20 ? markdownToEditableHtml(rawMarkdown) : '';
      const pageStats = pages.map((p) => {
        const pno = Number(p?.pageNumber || 1);
        const pRows = filteredRows.filter((r) => Number(r.page) === pno);
        const textRows = pRows.filter((r) => r.type !== 'tableCell').length;
        return { page: pno, textRows, totalRows: pRows.length };
      });
      const lowConfidencePages = pageStats.filter((p) => p.textRows < 8).map((p) => p.page);
      const repeatedEdgeClusters = filtered.removed.slice(0, 80);
      const layoutDiagnostics = {
        provider: 'azure_document_intelligence',
        confidenceLevel: filteredRows.length > 20 ? 'high' : 'medium',
        confidenceScore: filteredRows.length > 20 ? 0.8 : 0.72,
        detectedMode: layoutModel?.pages?.length ? 'fidelity' : 'editable',
        pages: pages.length,
        rows: filteredRows.length,
        lowConfidencePages,
        repeatedEdgeClusters,
        keepFooterInBody,
      };
      return {
        text,
        html,
        markdownHtml,
        layoutModel,
        layoutDiagnostics,
        diagnostics: {
          provider: 'azure_document_intelligence',
          analyzeUrlUsed,
          elapsedMs: Date.now() - startedAt,
          pages: pages.length,
          lines: filteredRows.length || lineCount,
          chars: text.length,
          droppedRows: Math.max(0, rows.length - filteredRows.length),
          lowConfidencePages,
          repeatedEdgeClusters,
          tableCells: tableRows.length,
          hasMarkdownHtml: markdownHtml.length > 50,
        },
      };
    }

    if (status === 'failed') {
      throw new Error(`Azure DI failed: ${JSON.stringify(payload).substring(0, 500)}`);
    }

    await sleep(pollInterval);
  }

  throw new Error('Azure DI timed out');
};

