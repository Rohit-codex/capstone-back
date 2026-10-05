import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const FONT_CACHE_DIR = path.join(process.cwd(), 'cache', 'pdf-fonts');

const ensureDir = async (dir) => {
  await fs.mkdir(dir, { recursive: true });
};

const normalizeFontName = (raw = '') => {
  let name = String(raw || '').trim();
  if (!name) return '';
  // Remove subset prefixes like ABCDEF+
  name = name.replace(/^[A-Z]{6}\+/, '');
  name = name.replace(/[-_]/g, ' ').trim();
  return name;
};

const hashBytes = (buf) => crypto.createHash('sha1').update(buf).digest('hex').slice(0, 24);

const extractFontBytes = (fontObj) => {
  if (!fontObj) return null;
  const candidates = [
    fontObj?.data,
    fontObj?.font?.data,
    fontObj?.ttf?.data,
    fontObj?.cff?.data,
    fontObj?.fontFile?.data,
    fontObj?.file?.data,
    fontObj?.data?.data,
  ];
  for (const c of candidates) {
    if (!c) continue;
    if (c instanceof Uint8Array) return Buffer.from(c);
    if (c instanceof ArrayBuffer) return Buffer.from(new Uint8Array(c));
    if (Buffer.isBuffer(c)) return c;
  }
  return null;
};

const deriveFontMeta = (fontObj = {}) => {
  const family = normalizeFontName(fontObj?.fontFamily || fontObj?.name || fontObj?.loadedName || '');
  const isBold = !!fontObj?.bold || /bold/i.test(family);
  const isItalic = !!fontObj?.italic || /italic|oblique/i.test(family);
  const weight = isBold ? 700 : 400;
  const style = isItalic ? 'italic' : 'normal';
  const format = String(fontObj?.type || fontObj?.subtype || 'ttf').toLowerCase();
  return { family, weight, style, format };
};

export const getFontCacheDir = (sessionId) => path.join(FONT_CACHE_DIR, String(sessionId || 'default'));

export const loadFontIndex = async (sessionId) => {
  const dir = getFontCacheDir(sessionId);
  const indexPath = path.join(dir, 'index.json');
  try {
    const raw = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
};

export const saveFontIndex = async (sessionId, index) => {
  const dir = getFontCacheDir(sessionId);
  await ensureDir(dir);
  const indexPath = path.join(dir, 'index.json');
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2), 'utf-8');
};

export const extractPdfFonts = async (buffer, sessionId) => {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: false,
    disableFontFace: false,
  });
  const pdfDoc = await loadingTask.promise;
  const found = new Map(); // fontName -> meta

  for (let i = 1; i <= pdfDoc.numPages; i += 1) {
    const page = await pdfDoc.getPage(i);
    const opList = await page.getOperatorList();
    const { fnArray, argsArray } = opList || {};
    if (!Array.isArray(fnArray)) continue;
    for (let j = 0; j < fnArray.length; j += 1) {
      if (fnArray[j] !== pdfjsLib.OPS.setFont) continue;
      const fontName = argsArray?.[j]?.[0];
      if (!fontName || found.has(fontName)) continue;
      let fontObj = null;
      try {
        fontObj = page.commonObjs?.get(fontName);
      } catch (_) {
        fontObj = page.commonObjs?._objs?.[fontName] || null;
      }
      const bytes = extractFontBytes(fontObj);
      const meta = deriveFontMeta(fontObj || {});
      if (!meta.family || !bytes) continue;
      const id = hashBytes(bytes);
      found.set(fontName, { id, bytes, ...meta });
    }
  }

  const fonts = [];
  const dir = getFontCacheDir(sessionId);
  await ensureDir(dir);

  for (const f of found.values()) {
    const ext = f.format.includes('otf') ? 'otf' : 'ttf';
    const fileName = `${f.family.replace(/\s+/g, '_')}_${f.weight}_${f.style}_${f.id}.${ext}`;
    const filePath = path.join(dir, fileName);
    try {
      await fs.writeFile(filePath, f.bytes);
    } catch (_) {
      // skip if write fails
      continue;
    }
    fonts.push({
      id: f.id,
      family: f.family,
      weight: f.weight,
      style: f.style,
      format: ext,
      fileName,
    });
  }

  const index = { sessionId, extractedAt: Date.now(), fonts };
  await saveFontIndex(sessionId, index);
  return index;
};

export const getFontFilePath = (sessionId, fontId) => {
  const dir = getFontCacheDir(sessionId);
  return path.join(dir, `${fontId}`);
};

export const loadFontBytesById = async (sessionId, fontId) => {
  const index = await loadFontIndex(sessionId);
  if (!index?.fonts?.length) return null;
  const fontMeta = index.fonts.find((f) => f.id === fontId);
  if (!fontMeta) return null;
  const filePath = path.join(getFontCacheDir(sessionId), fontMeta.fileName);
  const bytes = await fs.readFile(filePath);
  return { meta: fontMeta, bytes };
};

export const loadFontBytesByFamily = async (sessionId, family) => {
  const index = await loadFontIndex(sessionId);
  if (!index?.fonts?.length) return null;
  const target = index.fonts.find((f) => String(f.family || '').toLowerCase() === String(family || '').toLowerCase());
  if (!target) return null;
  const filePath = path.join(getFontCacheDir(sessionId), target.fileName);
  const bytes = await fs.readFile(filePath);
  return { meta: target, bytes };
};
