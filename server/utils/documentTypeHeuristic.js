/**
 * Fallback document-type guess when LLM Call A fails or returns empty.
 * Uses filename + early document text (Indian court filings).
 */
export function inferDocumentTypeHeuristic(fileName = '', text = '') {
  const hay = `${fileName || ''}\n${String(text || '').slice(0, 12000)}`.toLowerCase();

  if (/counter\s+affidavit|counter\s+reply|reply\s+to\s+writ/i.test(hay)) {
    return 'Affidavit';
  }
  if (/criminal\s+writ|w\.?\s*p\.?\s*\(\s*crl|wp\s*\(\s*crl|habeas/i.test(hay)) {
    return 'Criminal Writ Petition';
  }
  if (/writ\s+petition|w\.?\s*p\.?\s*\(\s*c\)|civil\s+writ|mjc\s+no/i.test(hay)) {
    return 'Civil Writ Petition';
  }
  if (/special\s+leave|slp\s*\(|civil\s+appeal\s+no/i.test(hay)) {
    return 'Special Leave Petition';
  }
  if (/bail\s+application|anticipatory\s+bail|regular\s+bail/i.test(hay)) {
    return 'Bail Application';
  }
  if (/written\s+statement|counter\s+claim/i.test(hay)) {
    return 'Written Statement';
  }
  if (/plaint|original\s+suit/i.test(hay)) {
    return 'Plaint';
  }
  if (/legal\s+notice|demand\s+notice/i.test(hay)) {
    return 'Legal Notice';
  }
  if (/sale\s+deed|conveyance\s+deed/i.test(hay)) {
    return 'Sale Deed';
  }
  if (/rental\s+agreement|lease\s+deed|leave\s+and\s+license/i.test(hay)) {
    return 'Rental Agreement';
  }
  if (/power\s+of\s+attorney|vakalatnama/i.test(hay)) {
    return 'Power of Attorney';
  }
  if (/judgment|order\s+dated|in\s+the\s+court\s+of.*order/i.test(hay)) {
    return 'Court Judgment/Order';
  }
  if (/affidavit/i.test(hay)) {
    return 'Affidavit';
  }

  const fn = String(fileName || '').toLowerCase();
  if (/writ|wp-?c|wpc/i.test(fn)) return 'Civil Writ Petition';
  if (/bail|crl/i.test(fn)) return 'Bail Application';
  if (/affidavit|aff/i.test(fn)) return 'Affidavit';
  if (/notice/i.test(fn)) return 'Legal Notice';

  return '';
}
