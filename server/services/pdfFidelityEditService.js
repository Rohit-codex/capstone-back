/**
 * PDF In-Place Fidelity Editing Service
 *
 * Uses pdf-lib to apply text replacements directly to the PDF content stream.
 * This eliminates the HTML-overlay positioning drift of the old approach and
 * achieves true fidelity (the PDF itself is the source of truth).
 *
 * Strategy:
 *   1. Load the original PDF with pdf-lib.
 *   2. For each fidelity edit: find the page, embed a replacement text box at
 *      the exact bounding-box coordinates, drawing an opaque white rectangle
 *      first to mask the original text, then drawing the new text on top.
 *   3. Return the modified PDF bytes for the caller to save/serve.
 *
 * Limitation: pdf-lib cannot remove or splice existing content-stream operators
 * (that would require a full PostScript parser).  Instead we COVER the original
 * text with a white rectangle and DRAW the replacement — same visual result, very
 * fast, no re-encoding of glyphs.
 */

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

// ── Helpers ──────────────────────────────────────────────────────────────────

const ptToPdfPt = (v) => Math.max(0, Number(v) || 0);

/**
 * Map a css/pixel colour string to pdf-lib rgb().
 * Falls back to black.
 */
const cssColorToRgb = (color = '') => {
  const c = String(color || '').trim().toLowerCase();
  if (!c || c === 'black' || c === '#000' || c === '#000000') return rgb(0, 0, 0);
  if (c === 'white' || c === '#fff' || c === '#ffffff') return rgb(1, 1, 1);
  const hex = c.startsWith('#') ? c.slice(1) : null;
  if (hex && hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return rgb(0, 0, 0);
};

const dataUrlToBytes = (dataUrl = '') => {
  const match = String(dataUrl || '').match(/^data:(.*?);base64,(.*)$/);
  if (!match) return null;
  const base64 = match[2];
  return Buffer.from(base64, 'base64');
};

const transformSvgPath = (path, pageHeight, scale, dx = 0, dy = 0, scaleX = 1, scaleY = 1) => {
  if (!path) return path;
  const tokens = String(path).match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g);
  if (!tokens) return path;
  const out = [];
  let i = 0;
  const cmdCoords = {
    M: 2, L: 2, C: 6, Q: 4, S: 4,
  };
  while (i < tokens.length) {
    const token = tokens[i];
    if (/^[a-zA-Z]$/.test(token)) {
      out.push(token);
      const upper = token.toUpperCase();
      const coordCount = cmdCoords[upper] || 0;
      i += 1;
      if (coordCount === 0) continue;
      const coords = tokens.slice(i, i + coordCount).map(Number);
      const transformed = [];
      for (let j = 0; j < coords.length; j += 2) {
        const xPx = (coords[j] + dx) * scaleX;
        const yPx = (coords[j + 1] + dy) * scaleY;
        const xPdf = xPx / scale;
        const yPdf = pageHeight - (yPx / scale);
        transformed.push(xPdf, yPdf);
      }
      out.push(...transformed.map((n) => Number.isFinite(n) ? n.toFixed(2) : '0'));
      i += coordCount;
    } else {
      // Stray number without command, keep as-is
      out.push(token);
      i += 1;
    }
  }
  return out.join(' ');
};

/**
 * Choose a standard font based on bold/italic flags.
 * pdf-lib only has the 14 standard PDF fonts built in; for custom fonts the
 * caller would need to embed a TTF — we keep it simple here.
 */
const resolveStandardFont = (fontFamily = '', bold = false, italic = false) => {
  const f = String(fontFamily || '').toLowerCase();
  const isTimes = /times/.test(f);
  const isCourier = /courier|mono/.test(f);
  if (isTimes) {
    if (bold && italic) return StandardFonts.TimesBoldItalic;
    if (bold) return StandardFonts.TimesBold;
    if (italic) return StandardFonts.TimesItalic;
    return StandardFonts.TimesRoman;
  }
  if (isCourier) {
    if (bold && italic) return StandardFonts.CourierBoldOblique;
    if (bold) return StandardFonts.CourierBold;
    if (italic) return StandardFonts.CourierOblique;
    return StandardFonts.Courier;
  }
  if (bold && italic) return StandardFonts.HelveticaBoldOblique;
  if (bold) return StandardFonts.HelveticaBold;
  if (italic) return StandardFonts.HelveticaOblique;
  return StandardFonts.Helvetica;
};

const wrapTextToWidth = (text, font, fontSize, maxWidth) => {
  const out = [];
  const paragraphs = String(text || '').split('\n');
  for (const para of paragraphs) {
    const words = String(para || '').split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    const fits = (s) => font.widthOfTextAtSize(s, fontSize) <= maxWidth;
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (fits(candidate)) {
        line = candidate;
        continue;
      }
      if (line) out.push(line);
      if (!fits(word)) {
        let chunk = '';
        for (const ch of word) {
          const next = chunk + ch;
          if (!fits(next) && chunk) {
            out.push(chunk);
            chunk = ch;
          } else {
            chunk = next;
          }
        }
        if (chunk) out.push(chunk);
        line = '';
      } else {
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
};

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Apply fidelity text edits to a PDF buffer.
 *
 * @param {Buffer|Uint8Array} pdfBytes   Original PDF bytes
 * @param {Array}             edits      Array of edit objects (see below)
 * @param {Object}            [opts]
 * @param {boolean}           [opts.maskOriginal=true]  Draw white rect over original
 *
 * Each edit object:
 * {
 *   pageNumber: 1,          // 1-based
 *   bbox: [x, y, right, bottom],  // in PDF user-space pts (origin bottom-left)
 *   newText: 'replacement',
 *   style: {
 *     fontSize: 11,
 *     bold: false,
 *     italic: false,
 *     color: '#000000',
 *     align: 'left' | 'center' | 'right',
 *   },
 * }
 *
 * @returns {Promise<Uint8Array>} Modified PDF bytes
 */
export const applyFidelityEditsToPdf = async (pdfBytes, edits = [], opts = {}) => {
  const maskOriginal = opts.maskOriginal !== false;
  const customFonts = Array.isArray(opts.fonts) ? opts.fonts : [];
  const objectEdits = opts.objectEdits || {};

  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  if (customFonts.length > 0) {
    try {
      pdfDoc.registerFontkit(fontkit);
    } catch (_) {
      // ignore if fontkit not available
    }
  }
  const pages = pdfDoc.getPages();

  // Pre-embed all needed font variants once
  const fontCache = {};
  const matchCustomFont = (fontFamily, bold, italic) => {
    if (!fontFamily || customFonts.length === 0) return null;
    const familyLower = String(fontFamily || '').toLowerCase();
    const targetWeight = bold ? 700 : 400;
    const targetStyle = italic ? 'italic' : 'normal';
    const exact = customFonts.find((f) => (
      String(f.family || '').toLowerCase() === familyLower &&
      Number(f.weight || 400) === targetWeight &&
      String(f.style || 'normal').toLowerCase() === targetStyle
    ));
    if (exact) return exact;
    return customFonts.find((f) => String(f.family || '').toLowerCase() === familyLower) || null;
  };

  const getFont = async (fontFamily, bold, italic) => {
    const key = `${fontFamily || 'n'}_${bold ? 'b' : ''}${italic ? 'i' : ''}` || 'n';
    if (!fontCache[key]) {
      const custom = matchCustomFont(fontFamily, bold, italic);
      if (custom?.bytes) {
        fontCache[key] = await pdfDoc.embedFont(custom.bytes);
      } else {
        fontCache[key] = await pdfDoc.embedFont(resolveStandardFont(fontFamily, bold, italic));
      }
    }
    return fontCache[key];
  };

  for (const edit of edits) {
    const pageIdx = Math.max(0, Number(edit.pageNumber || 1) - 1);
    const page = pages[pageIdx];
    if (!page) continue;

    const { width: pageW, height: pageH } = page.getSize();

    const bbox = Array.isArray(edit.bbox) ? edit.bbox : [0, 0, 100, 20];
    // bbox comes in as [x_px, y_px_from_top, right_px, bottom_px_from_top]
    // We need to convert to PDF coordinate space (origin bottom-left).
    // The frontend passes pixel coordinates relative to the rendered canvas.
    // We store a scale factor in the edit if available; otherwise estimate from pageW.
    const scale = Number(edit.scale || 1);
    const bxLeft   = ptToPdfPt(bbox[0] / scale);
    const bxTop    = ptToPdfPt(bbox[1] / scale);       // from top of page
    const bxRight  = ptToPdfPt(bbox[2] / scale);
    const bxBottom = ptToPdfPt(bbox[3] / scale);
    const bxWidth  = Math.max(4, bxRight - bxLeft);
    const bxHeight = Math.max(4, bxBottom - bxTop);

    // PDF coordinate origin is bottom-left
    const pdfY      = pageH - bxBottom;   // bottom of the bbox in PDF coords
    const pdfYTop   = pageH - bxTop;      // top of the bbox in PDF coords

    const style   = edit.style || {};
    const fontSize = Math.max(6, Math.min(36, Number(style.fontSize || 11)));
    const bold    = !!style.bold;
    const italic  = !!style.italic;
    const fontFamily = style.fontFamily || '';
    const color   = cssColorToRgb(style.color || '#000000');
    const align   = String(style.align || 'left');
    const font    = await getFont(fontFamily, bold, italic);

    // 1. Mask: draw a white filled rectangle over the original text
    if (maskOriginal) {
      const inset = edit?.type === 'tableCell' ? 1 : 0;
      page.drawRectangle({
        x: bxLeft + inset,
        y: pdfY + inset,
        width: Math.max(1, bxWidth - inset * 2),
        height: Math.max(1, bxHeight - inset * 2),
        color: rgb(1, 1, 1),
        borderWidth: 0,
      });
    }

    // 2. Draw replacement text
    const newText = String(edit.newText || '');
    if (!newText.trim()) continue;

    // For multi-line text: split on \n and stack lines
    const lines = wrapTextToWidth(newText, font, fontSize, Math.max(6, bxWidth - 4));
    const lineH  = Number(style.lineHeight || 0) || (fontSize * 1.3);
    let yOffset  = pdfYTop - fontSize; // start from top of bbox, descending

    for (const line of lines) {
      if (yOffset < pdfY - 2) break; // out of bbox — clip

      let xPos = bxLeft + 2;
      if (align === 'center') {
        const textW = font.widthOfTextAtSize(line, fontSize);
        xPos = bxLeft + (bxWidth - textW) / 2;
      } else if (align === 'right') {
        const textW = font.widthOfTextAtSize(line, fontSize);
        xPos = bxLeft + bxWidth - textW - 2;
      }

      page.drawText(line, {
        x: Math.max(bxLeft, xPos),
        y: yOffset,
        size: fontSize,
        font,
        color,
        maxWidth: bxWidth - 4,
      });

      yOffset -= lineH;
    }
  }

  // ── Apply object edits (images + vector paths) ───────────────────────────
  const objectEntries = Object.values(objectEdits || {}).filter(Boolean);
  if (objectEntries.length > 0) {
    for (const edit of objectEntries) {
      const obj = edit.object;
      if (!obj || !obj.bbox) continue;
      const pageIdx = Math.max(0, Number(obj.pageNumber || 1) - 1);
      const page = pages[pageIdx];
      if (!page) continue;
      const { width: pageW, height: pageH } = page.getSize();
      const scale = Number(obj.scale || edit.scale || 1);
      const bbox = Array.isArray(obj.bbox) ? obj.bbox : [0, 0, 0, 0];
      const dx = Number(edit.dx || 0);
      const dy = Number(edit.dy || 0);
      const scaleX = Number(edit.scaleX || 1);
      const scaleY = Number(edit.scaleY || 1);

      const bxLeft   = ptToPdfPt((bbox[0] + dx) / scale);
      const bxTop    = ptToPdfPt((bbox[1] + dy) / scale);
      const bxRight  = ptToPdfPt((bbox[2] + dx) / scale);
      const bxBottom = ptToPdfPt((bbox[3] + dy) / scale);
      const bxWidth  = Math.max(2, (bxRight - bxLeft) * scaleX);
      const bxHeight = Math.max(2, (bxBottom - bxTop) * scaleY);

      const pdfY = pageH - (bxTop + bxHeight);

      const canRedraw = (obj.type === 'image' && !!obj.dataUrl) || (obj.type === 'path' && !!obj.svgPath);

      // Mask original object area only if we can redraw
      if (maskOriginal && canRedraw) {
        page.drawRectangle({
          x: bxLeft,
          y: pageH - (ptToPdfPt(bbox[3] / scale)),
          width: Math.max(2, ptToPdfPt((bbox[2] - bbox[0]) / scale)),
          height: Math.max(2, ptToPdfPt((bbox[3] - bbox[1]) / scale)),
          color: rgb(1, 1, 1),
          borderWidth: 0,
        });
      }

      if (obj.type === 'image' && obj.dataUrl) {
        const bytes = dataUrlToBytes(obj.dataUrl);
        if (!bytes) continue;
        let embedded;
        if (/image\/png/i.test(obj.dataUrl)) embedded = await pdfDoc.embedPng(bytes);
        else embedded = await pdfDoc.embedJpg(bytes);
        page.drawImage(embedded, {
          x: bxLeft,
          y: pdfY,
          width: bxWidth,
          height: bxHeight,
        });
      } else if (obj.type === 'path' && obj.svgPath) {
        const strokeColor = obj.stroke ? cssColorToRgb(obj.stroke) : undefined;
        const fillColor = obj.fill ? cssColorToRgb(obj.fill) : undefined;
        const path = transformSvgPath(obj.svgPath, pageH, scale, dx, dy, scaleX, scaleY);
        page.drawSvgPath(path, {
          x: 0,
          y: 0,
          scale: 1,
          borderWidth: Number(obj.strokeWidth || 1),
          borderColor: strokeColor,
          color: fillColor,
        });
      }
    }
  }

  return pdfDoc.save();
};

/**
 * Convert fidelityEdits (frontend format) to the edit objects expected by
 * applyFidelityEditsToPdf.
 *
 * fidelityEdits: { [blockId]: { text, style, bbox, pageNumber, ... } }
 */
export const normalizeFidelityEdits = (fidelityEdits = {}, fidelityOffsets = {}) => {
  const edits = [];
  for (const [blockId, edit] of Object.entries(fidelityEdits)) {
    const normalized = typeof edit === 'string' ? { text: edit } : edit;
    if (!normalized || typeof normalized !== 'object') continue;
    const offset = fidelityOffsets[blockId] || { dx: 0, dy: 0 };
    const dx = Number(offset.dx ?? offset.x ?? 0) || 0;
    const dy = Number(offset.dy ?? offset.y ?? 0) || 0;
    const rawBbox = Array.isArray(normalized.bbox) ? normalized.bbox : [0, 0, 100, 20];
    const bbox = [
      rawBbox[0] + dx,
      rawBbox[1] + dy,
      rawBbox[2] + dx,
      rawBbox[3] + dy,
    ];
    const style = normalized.style || {};
    edits.push({
      pageNumber: Number(normalized.pageNumber || normalized.page || 1),
      bbox,
      newText: String(normalized.text || ''),
      scale: Number(normalized.scale || 1),
      type: normalized.type || null,
      table: normalized.table || null,
      border: normalized.border || null,
      style: {
        fontSize: Number(style.fontSize || normalized.fontSize || 11),
        lineHeight: Number(style.lineHeight || normalized.lineHeight || 0),
        fontFamily: style.fontFamilyRaw || style.fontFamily || normalized.fontFamily || normalized.fontFamilyRaw || '',
        bold: !!(style.bold || style.fontWeight >= 600),
        italic: !!(style.italic || style.fontStyle === 'italic'),
        color: style.color || '#000000',
        align: style.align || 'left',
      },
    });
  }
  return edits;
};
