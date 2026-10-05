import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PX_TO_PT = 72 / 96;

const normalizeText = (text = '') => String(text || '').replace(/\r/g, '').trim();

const tokenizePreserveSpaces = (text = '') => {
  return String(text || '').split(/(\s+)/).filter((t) => t.length > 0);
};

const drawWrappedRunTokens = ({
  page,
  tokens,
  styleAlign,
  baseX,
  baseY,
  maxWidth,
  lineHeight,
  getMetrics,
}) => {
  const lines = [];
  let current = [];
  let currentWidth = 0;
  const pushLine = () => {
    if (!current.length) return;
    lines.push({ runs: current, width: currentWidth });
    current = [];
    currentWidth = 0;
  };

  for (const tk of tokens) {
    const tkW = getMetrics(tk).width;
    const nextTooWide = current.length > 0 && (currentWidth + tkW) > maxWidth;
    if (nextTooWide) pushLine();
    if (tkW > maxWidth && tk.text.length > 1) {
      // Hard wrap long token char-by-char.
      let chunk = '';
      for (const ch of tk.text) {
        const probe = { ...tk, text: chunk + ch };
        const probeW = getMetrics(probe).width;
        if (chunk && probeW > maxWidth) {
          const finalTk = { ...tk, text: chunk };
          const finalW = getMetrics(finalTk).width;
          current.push(finalTk);
          currentWidth += finalW;
          pushLine();
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      if (chunk) {
        const finalTk = { ...tk, text: chunk };
        const finalW = getMetrics(finalTk).width;
        current.push(finalTk);
        currentWidth += finalW;
      }
      continue;
    }
    current.push(tk);
    currentWidth += tkW;
  }
  pushLine();

  lines.forEach((line, idx) => {
    let drawX = baseX;
    if (styleAlign === 'center') drawX = Math.max(8, baseX + Math.max(0, (maxWidth - line.width) / 2));
    else if (styleAlign === 'right') drawX = Math.max(8, baseX + Math.max(0, maxWidth - line.width));
    const drawY = baseY - (idx * lineHeight);
    for (const run of line.runs) {
      const { font, size, width } = getMetrics(run);
      page.drawText(run.text, {
        x: drawX,
        y: drawY,
        size,
        font,
        color: rgb(0, 0, 0),
        lineHeight,
      });
      drawX += width;
    }
  });
  return lines.length;
};

const flattenLayoutBlocks = (layoutModel) => {
  if (!layoutModel || !Array.isArray(layoutModel.pages)) return [];
  const rows = [];
  for (const page of layoutModel.pages) {
    const pageNumber = Number(page?.pageNumber || 1);
    const pageWidthPx = Number(page?.width || 0) || null;
    const pageHeightPx = Number(page?.height || 0) || null;
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    for (let blockIdx = 0; blockIdx < blocks.length; blockIdx += 1) {
      const block = blocks[blockIdx];
      const bbox = Array.isArray(block?.bbox) ? block.bbox : [0, 0, 0, 0];
      rows.push({
        blockId: String(block?.id || ''),
        fallbackKey: `${pageNumber}:${blockIdx}`,
        pageNumber,
        text: normalizeText(block?.text || ''),
        x: Number(bbox[0] || 0),
        y: Number(bbox[1] || 0),
        right: Number(bbox[2] || 0),
        bottom: Number(bbox[3] || 0),
        align: block?.style?.align || 'left',
        fontSize: Number(block?.style?.fontSize || 11),
        bold: !!block?.style?.bold,
        fontFamily: block?.style?.fontFamily || null,
        fontWeight: Number(block?.style?.fontWeight || 0) || null,
        fontStyle: block?.style?.fontStyle || null,
        lineHeight: Number(block?.style?.lineHeight || 0) || null,
        type: block?.type || 'line',
        table: block?.table || null,
        border: block?.border || null,
        runs: Array.isArray(block?.runs) ? block.runs : [],
        role: block?.role || 'body',
        pageWidthPx,
        pageHeightPx,
      });
    }
  }
  return rows
    .filter((r) => r.text.length > 0)
    .sort((a, b) => (a.pageNumber - b.pageNumber) || (a.y - b.y) || (a.x - b.x));
};

export const stampPdfUsingLayout = async ({
  sourcePdfPath,
  layoutModel,
  editedText,
  fidelityEdits = null,
  outputDir = 'uploads/generated',
  baseName = 'document',
}) => {
  if (!sourcePdfPath || !fs.existsSync(sourcePdfPath)) {
    throw new Error('Source PDF not found for stamping');
  }
  const layoutRows = flattenLayoutBlocks(layoutModel);
  if (!layoutRows.length) throw new Error('Layout model missing rows for stamping');

  const srcBytes = fs.readFileSync(sourcePdfPath);
  const pdfDoc = await PDFDocument.load(srcBytes);
  const pages = pdfDoc.getPages();
  const fontTimesRegular = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const fontTimesBold = await pdfDoc.embedFont(StandardFonts.TimesBold);
  const fontHelveticaRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontHelveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontCourierRegular = await pdfDoc.embedFont(StandardFonts.Courier);
  const fontCourierBold = await pdfDoc.embedFont(StandardFonts.CourierBold);

  const byBlockId = {};
  if (fidelityEdits && typeof fidelityEdits === 'object') {
    Object.keys(fidelityEdits).forEach((k) => {
      const val = fidelityEdits[k];
      if (typeof val === 'string') byBlockId[k] = val;
      else if (val && typeof val.text === 'string') byBlockId[k] = val.text;
    });
  }

  // STRICT selective stamp mode:
  // only stamp rows explicitly edited in fidelity mode (blockId/fallbackKey map).
  // This avoids full reflow overlay that destroys headers/alignment.
  const rowsToStamp = layoutRows
    .map((r) => ({ ...r, edited: byBlockId[r.blockId] ?? byBlockId[r.fallbackKey] }))
    .filter((r) => typeof r.edited === 'string' && normalizeText(r.edited) !== normalizeText(r.text));
  const changedBlockIds = rowsToStamp.map((r) => r.blockId || r.fallbackKey);
  const pageCalibrations = {};
  const sourcePageCount = pages.length;
  const layoutPageCount = new Set(layoutRows.map((r) => r.pageNumber)).size;

  const getCalibration = (row, page) => {
    const pageNo = row.pageNumber;
    if (pageCalibrations[pageNo]) return pageCalibrations[pageNo];
    const pageWidthPt = page.getWidth();
    const pageHeightPt = page.getHeight();
    const widthFromLayout = Number(row.pageWidthPx || 0);
    const heightFromLayout = Number(row.pageHeightPx || 0);
    const scaleX = widthFromLayout > 100 ? (pageWidthPt / widthFromLayout) : PX_TO_PT;
    const scaleY = heightFromLayout > 100 ? (pageHeightPt / heightFromLayout) : PX_TO_PT;
    pageCalibrations[pageNo] = {
      pageWidthPt,
      pageHeightPt,
      widthFromLayout,
      heightFromLayout,
      scaleX,
      scaleY,
      baselineShiftPt: 0,
    };
    return pageCalibrations[pageNo];
  };

  for (const row of rowsToStamp) {
    const text = normalizeText(row.edited || '');
    if (!text) continue;
    const page = pages[row.pageNumber - 1];
    if (!page) continue;
    const cal = getCalibration(row, page);
    const pageHeightPt = cal.pageHeightPt;
    const fontSizePt = Math.max(8, Math.min(16, Math.round(row.fontSize * PX_TO_PT)));
    const xPt = Math.max(8, row.x * cal.scaleX);
    const yTopPt = row.y * cal.scaleY;
    const yPt = Math.max(8, pageHeightPt - yTopPt - fontSizePt + cal.baselineShiftPt);
    const maxWidthPt = Math.max(40, (row.right - row.x) * cal.scaleX);

    const styleAlign = String(row.align || 'left').toLowerCase();
    // Strict mode: never infer style from text content.
    // We only trust structured style signals from layout extraction.
    const isBold = !!row.bold || Number(row.fontWeight || 0) >= 600;
    const family = String(row.fontFamily || '').toLowerCase();
    const isMono = /courier|mono/.test(family);
    const isSans = /helvetica|arial|sans/.test(family);
    const drawFont = isMono
      ? (isBold ? fontCourierBold : fontCourierRegular)
      : isSans
        ? (isBold ? fontHelveticaBold : fontHelveticaRegular)
        : (isBold ? fontTimesBold : fontTimesRegular);
    let drawXPt = xPt;
    const textWidthPt = drawFont.widthOfTextAtSize(text, fontSizePt);
    if (styleAlign === 'center') {
      drawXPt = Math.max(8, xPt + Math.max(0, (maxWidthPt - textWidthPt) / 2));
    } else if (styleAlign === 'right') {
      drawXPt = Math.max(8, xPt + Math.max(0, maxWidthPt - textWidthPt));
    }

    const rowLineHeightPt = Math.max(
      10,
      Math.round(
        row.lineHeight
          ? (Number(row.lineHeight) * PX_TO_PT)
          : (fontSizePt * 1.15)
      )
    );
    const sourceRuns = Array.isArray(row.runs) ? row.runs.filter((r) => String(r?.text || '').length > 0) : [];
    const tokens = [];
    if (sourceRuns.length > 0) {
      for (const run of sourceRuns) {
        const runStyle = run.style || {};
        const runWeight = Number(runStyle.fontWeight || row.fontWeight || 400);
        const runBold = runWeight >= 600 || isBold;
        const runFamily = String(runStyle.fontFamily || row.fontFamily || '').toLowerCase();
        const runMono = /courier|mono/.test(runFamily);
        const runSans = /helvetica|arial|sans/.test(runFamily);
        const runFont = runMono
          ? (runBold ? fontCourierBold : fontCourierRegular)
          : runSans
            ? (runBold ? fontHelveticaBold : fontHelveticaRegular)
            : (runBold ? fontTimesBold : fontTimesRegular);
        const runSizePt = Math.max(8, Math.min(16, Math.round((Number(runStyle.fontSize || row.fontSize || 11)) * PX_TO_PT)));
        const runTokens = tokenizePreserveSpaces(String(run.text || ''));
        runTokens.forEach((t) => tokens.push({
          text: t,
          font: runFont,
          size: runSizePt,
          lineHeight: Math.max(10, Math.round((Number(runStyle.lineHeight || row.lineHeight || row.fontSize || 11)) * PX_TO_PT)),
        }));
      }
    } else {
      tokenizePreserveSpaces(text).forEach((t) => tokens.push({
        text: t,
        font: drawFont,
        size: fontSizePt,
        lineHeight: rowLineHeightPt,
      }));
    }

    drawWrappedRunTokens({
      page,
      tokens,
      styleAlign,
      baseX: drawXPt,
      baseY: yPt,
      maxWidth: maxWidthPt,
      lineHeight: rowLineHeightPt,
      getMetrics: (tk) => {
        const font = tk.font || drawFont;
        const size = Number(tk.size || fontSizePt);
        return {
          font,
          size,
          width: font.widthOfTextAtSize(String(tk.text || ''), size),
        };
      },
    });

    if (row.type === 'tableCell' && row.border && typeof row.border === 'object') {
      const rectY = Math.max(8, pageHeightPt - (row.bottom * cal.scaleY));
      const rectH = Math.max(10, (row.bottom - row.y) * cal.scaleY);
      const top = row.border?.top !== false;
      const right = row.border?.right !== false;
      const bottom = row.border?.bottom !== false;
      const left = row.border?.left !== false;
      const bw = Number(row.border?.width || 0.8);
      if (top) {
        page.drawLine({ start: { x: xPt, y: rectY + rectH }, end: { x: xPt + maxWidthPt, y: rectY + rectH }, thickness: bw, color: rgb(0, 0, 0) });
      }
      if (right) {
        page.drawLine({ start: { x: xPt + maxWidthPt, y: rectY }, end: { x: xPt + maxWidthPt, y: rectY + rectH }, thickness: bw, color: rgb(0, 0, 0) });
      }
      if (bottom) {
        page.drawLine({ start: { x: xPt, y: rectY }, end: { x: xPt + maxWidthPt, y: rectY }, thickness: bw, color: rgb(0, 0, 0) });
      }
      if (left) {
        page.drawLine({ start: { x: xPt, y: rectY }, end: { x: xPt, y: rectY + rectH }, thickness: bw, color: rgb(0, 0, 0) });
      }
    }

  }

  const outDirAbs = path.isAbsolute(outputDir) ? outputDir : path.join(process.cwd(), outputDir);
  if (!fs.existsSync(outDirAbs)) fs.mkdirSync(outDirAbs, { recursive: true });
  const filename = `${baseName}_stamped_${Date.now()}.pdf`;
  const outPath = path.join(outDirAbs, filename);
  const outBytes = await pdfDoc.save();
  fs.writeFileSync(outPath, outBytes);
  const styleCoverage = layoutRows.length
    ? (layoutRows.filter((r) => !!r.fontFamily || !!r.fontWeight || !!r.lineHeight).length / layoutRows.length)
    : 0;
  const pageCoverage = sourcePageCount > 0 ? Math.min(1, layoutPageCount / sourcePageCount) : 0;
  const selectiveRatio = layoutRows.length > 0 ? Math.min(1, changedBlockIds.length / layoutRows.length) : 0;
  const fidelityScore = Number(
    (
      (pageCoverage * 0.5) +
      (styleCoverage * 0.3) +
      ((changedBlockIds.length === 0 ? 1 : selectiveRatio) * 0.2)
    ).toFixed(4)
  );
  return {
    path: outPath,
    filename,
    audit: {
      changedBlocks: changedBlockIds.length,
      changedBlockIds,
      selectiveStamp: true,
      skippedBecauseNoFidelityEdits: Object.keys(byBlockId).length === 0,
      sourcePageCount,
      layoutPageCount,
      pageCoverage,
      styleCoverage,
      calibrations: pageCalibrations,
      fidelityScore,
      stampedAt: new Date().toISOString(),
    },
  };
};

