/** Estimate INDEX "Page No." cells when left blank (pages within the filed counter bundle). */

export function parsePageRangeSpan(pageStr) {
  const s = String(pageStr || '').trim();
  if (!s) return 0;
  const range = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b >= a) return b - a + 1;
  }
  const single = s.match(/(\d+)/);
  if (single) return 1;
  return 0;
}

function estimateBodyCharCount(counterData = {}) {
  const draft = Array.isArray(counterData.counterDraft) ? counterData.counterDraft : [];
  const parts = [
    counterData.deponentDetails,
    ...(counterData.preliminaryObjections || []),
    ...draft.map((x) => x?.counterArgument || x?.supportingLaw || ''),
    counterData.prayer,
    counterData.verification,
    ...(counterData.statementOfAdditionalFacts || []),
  ];
  return parts.map((p) => String(p || '')).join(' ').length;
}

export function bodyStartPageForLayout(layout = {}) {
  if (layout.variant === 'mjc_show_cause' && layout.showMjcMatterPage !== false) return 3;
  if (layout.variant === 'mjc_show_cause') return 2;
  return 2;
}

export function estimateBodyPageCount(counterData = {}) {
  const chars = estimateBodyCharCount(counterData);
  return Math.max(1, Math.ceil(chars / 2400));
}

export function formatPageSpan(start, count) {
  const s = Math.max(1, Number(start) || 1);
  const n = Math.max(1, Number(count) || 1);
  if (n <= 1) return String(s);
  return `${s}-${s + n - 1}`;
}

/**
 * Fill empty page cells on index rows. Preserves user-entered page numbers.
 */
export function fillIndexEntryPages(indexEntries, counterData = {}, layout = {}) {
  const rows = Array.isArray(indexEntries) ? indexEntries.map((r) => ({ ...r })) : [];
  if (!rows.length) return rows;

  const bodyStart = bodyStartPageForLayout(layout);
  const bodyPages = estimateBodyPageCount(counterData);
  const annexures = Array.isArray(counterData.annexureIndex) ? counterData.annexureIndex : [];
  const sourceImages = Array.isArray(counterData.sourcePageImages) ? counterData.sourcePageImages : [];
  let annexCursor = bodyStart + bodyPages;

  return rows.map((row, i) => {
    const existing = String(row.page ?? '').trim();
    if (existing) return row;

    if (i === 0) {
      return { ...row, page: formatPageSpan(bodyStart, bodyPages) };
    }

    const annexIdx = i - 1;
    const annex = annexures[annexIdx] || {};
    let count = parsePageRangeSpan(annex.pageRange || annex.page)
      || Number(annex.pageCount) || 0;
    if (!count && annexIdx === 0 && sourceImages.length) count = sourceImages.length;
    if (!count) count = 1;

    const page = formatPageSpan(annexCursor, count);
    annexCursor += count;
    return { ...row, page };
  });
}
