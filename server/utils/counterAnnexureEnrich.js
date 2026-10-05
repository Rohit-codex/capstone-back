import File from '../models/File.js';
import { getPdfPageCount, renderPdfPagesAsDataUrls } from './counterAffidavitPdfAnnexures.js';

const MAX_PHOTOSTAT_PAGES_PER_ANNEXURE = 10;

export function nextAnnexureLetter(annexureIndex = []) {
  const used = new Set(
    (annexureIndex || []).map((a) => String(a?.letter || a?.id || '').trim().toUpperCase()).filter(Boolean)
  );
  for (let i = 0; i < 26; i += 1) {
    const letter = String.fromCharCode(65 + i);
    if (!used.has(letter)) return letter;
  }
  return 'Z';
}

export function pageRangeFromCount(total) {
  const n = Math.max(0, Number(total) || 0);
  if (n <= 0) return '';
  if (n === 1) return '1';
  return `1-${n}`;
}

/**
 * Load user-uploaded annexure files, set pageRange/pageCount, build photostat blocks for export HTML.
 */
export async function enrichAnnexuresFromUploads(counterData, userId, readSourceFileBytes) {
  const cd = { ...counterData };
  const annexures = Array.isArray(cd.annexureIndex) ? cd.annexureIndex.map((a) => ({ ...a })) : [];
  const photostats = [];

  for (let i = 0; i < annexures.length; i += 1) {
    const annex = annexures[i];
    const fid = String(annex.fileId || annex.annexureFileId || '').trim();
    if (!fid || !userId) continue;

    try {
      const file = await File.findOne({ _id: fid, uploadedBy: userId }).lean();
      if (!file) continue;

      const { buffer, ext } = await readSourceFileBytes(file);
      const letter = String(annex.letter || annex.id || nextAnnexureLetter(annexures.slice(0, i))).trim()
        || String.fromCharCode(65 + i);
      annex.letter = letter;

      let images = [];
      let totalPages = 0;

      if (ext === '.pdf' && buffer?.length) {
        totalPages = await getPdfPageCount(buffer);
        const renderCount = Math.min(MAX_PHOTOSTAT_PAGES_PER_ANNEXURE, Math.max(1, totalPages || 1));
        const pageNums = Array.from({ length: renderCount }, (_, j) => j + 1);
        images = await renderPdfPagesAsDataUrls(buffer, pageNums);
      } else if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext) && buffer?.length) {
        totalPages = 1;
        const mime = ext === '.png' ? 'png' : ext === '.webp' ? 'webp' : ext === '.gif' ? 'gif' : 'jpeg';
        images = [{ page: 1, dataUrl: `data:image/${mime};base64,${buffer.toString('base64')}` }];
      }

      if (totalPages > 0 && !String(annex.pageRange || '').trim()) {
        annex.pageRange = pageRangeFromCount(totalPages);
        annex.page = annex.pageRange;
      }
      if (totalPages > 0) annex.pageCount = totalPages;

      if (images.length) {
        photostats.push({
          letter,
          description: String(annex.description || '').trim(),
          images,
          totalPages: totalPages || images.length,
        });
      }
    } catch (err) {
      console.warn('[CounterAnnex] User annexure load skipped:', err?.message || err);
    }
  }

  cd.annexureIndex = annexures;

  const legacySource = Array.isArray(cd.sourcePageImages) ? cd.sourcePageImages : [];
  const hasLetterA = photostats.some((p) => /^a$/i.test(String(p.letter)));
  if (legacySource.length && !hasLetterA) {
    const annexA = annexures.find((a) => /^a$/i.test(String(a.letter || '')));
    photostats.unshift({
      letter: 'A',
      description: String(annexA?.description || 'Case document / show cause record').trim(),
      images: legacySource,
      totalPages: annexA?.pageCount || legacySource.length,
    });
  }

  cd.annexurePhotostats = photostats.length ? photostats : cd.annexurePhotostats;
  return cd;
}
