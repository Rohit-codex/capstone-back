import { loadCounterAffidavitDesign } from './counterAffidavitDesigns.js';
import { appendStandardCounterSections } from './counterAffidavitBodySections.js';
import { fillIndexEntryPages } from './counterIndexPageNumbers.js';

function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Ensures blank placeholders reserve visible space in court PDF/HTML preview. */
export const COUNTER_BLANK_CSS = `
.counter-blank{display:inline-block;min-width:10em;min-height:1.15em;border-bottom:1px solid #000;vertical-align:bottom;letter-spacing:0.06em;white-space:pre;padding:0 6px 2px;box-sizing:border-box;line-height:1.2}
.party-cell-name .counter-blank,.party-name .counter-blank{min-width:14em;display:inline-block;width:auto;max-width:100%}
.caption-case-no .counter-blank{min-width:4.5em}
.caption-line1 .counter-blank{min-width:8em}
.subject-line{margin:14px 0 8px;font-size:12.5pt;font-weight:700}
.subject-line .label{font-weight:700}
.subject-line .value{text-transform:uppercase}
.index-heading{margin:10px 0 6px;text-align:center;font-size:13pt;font-weight:700;letter-spacing:0.08em}
.index-table{width:100%;border-collapse:collapse;margin:0 0 10px 0;font-size:11.5pt}
.index-table th,.index-table td{border:1px solid #333;padding:6px 8px;vertical-align:top}
.index-table th{text-align:center;background:#f5f5f5;font-weight:700}
.index-table .col-sl{width:11%;text-align:center}
.index-table .col-page{width:14%;text-align:center}
.photostat-annexure-heading{font-size:12pt;font-weight:700;margin:18px 0 10px;text-transform:uppercase;page-break-before:always}
.photostat-more-note{font-size:10.5pt;margin:8px 0 16px;text-align:justify}
.photostat-page{page-break-after:always;page-break-inside:avoid;display:flex;flex-direction:column;align-items:center;margin-bottom:20px}
.photostat-page img{max-width:100%;max-height:240mm;object-fit:contain;border:1px solid #ddd}
`;

function isBlankFieldValue(value) {
  const t = String(value ?? '').trim();
  if (!t) return true;
  if (/_{3,}/.test(t)) return true;
  if (/\[INSERT FROM RECORD\]/i.test(t)) return true;
  if (/^to be completed/i.test(t)) return true;
  return false;
}

function htmlFieldValue(value, blankVisual = '_______________') {
  const t = String(value ?? '').trim();
  if (!isBlankFieldValue(t)) return escapeHtml(t);
  const visual = String(blankVisual || '_______________');
  return `<span class="counter-blank" aria-label="blank field">${escapeHtml(visual)}</span>`;
}

function wrapUnderscoreRunsInHtml(escapedFragment) {
  return String(escapedFragment || '').replace(/_{3,}/g, (m) =>
    `<span class="counter-blank" aria-label="blank field">${m}</span>`
  );
}

function verificationToParagraphs(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p)}</p>`)
    .join('');
}

/** Parse "IN THE HIGH COURT OF JUDICATURE AT ALLAHABAD"; Supreme Court; or return a single full caption line. */
function parseJudicatureLine(courtRaw) {
  const s = String(courtRaw || '').trim();
  if (!s) return { mode: 'parts', courtSeg: 'HIGH', city: '_______________' };

  const sup = /supreme\s+court/i.test(s);
  if (sup) {
    if (/^IN\s+THE\s+SUPREME\s+COURT/i.test(s) && /india/i.test(s)) {
      return { mode: 'full', full: s.replace(/\s+/g, ' ').trim() };
    }
    return { mode: 'full', full: 'IN THE SUPREME COURT OF INDIA' };
  }

  const reStandard = /^IN\s+THE\s+(.+?)\s+COURT\s+OF\s+JUDICATURE\s+AT\s+(.+)$/i;
  const reAlt = /^IN\s+THE\s+(.+?)\s+COURT\s+JUDICATURE\s+AT\s+(.+)$/i;
  let m = s.match(reStandard) || s.match(reAlt);
  if (m) {
    return { mode: 'parts', courtSeg: m[1].trim(), city: m[2].trim() };
  }

  const reCityOnly = /^IN\s+THE\s+HIGH\s+COURT\s+OF\s+JUDICATURE\s+AT\s+(.+)$/i;
  m = s.match(reCityOnly);
  if (m) return { mode: 'parts', courtSeg: 'HIGH', city: m[1].trim() };

  if (/judicature|hon'?ble|honorable/i.test(s) && s.length > 24) {
    return { mode: 'full', full: s };
  }

  if (/^IN\s+THE/i.test(s)) {
    return { mode: 'full', full: s.replace(/\s+/g, ' ').trim() };
  }

  if (/district\s+and\s+sessions?\s+judge|sessions?\s+judge|chief\s+judicial\s+magistrate|cjm\b|acjm\b/i.test(s)) {
    return { mode: 'full', full: `IN THE COURT OF ${s.replace(/\s+/g, ' ').trim()}` };
  }

  if (s.length <= 160 && !/\n/.test(s)) {
    return { mode: 'full', full: `IN THE HON'BLE ${s}` };
  }

  return { mode: 'full', full: s };
}

/** Extract standard High Court / writ case lines for caption. */
function parseMjcCase(caseNumberRaw) {
  const s = String(caseNumberRaw || '').trim();
  if (!s) return { display: '', mjcNo: '', year: '' };

  const reMjc = /MJC\s*(?:NO\.?)?\s*(\d+)\s+OF\s+(\d{2,4})/i;
  let m = s.match(reMjc);
  if (m) {
    let y = m[2];
    if (y.length === 2) y = `20${y}`;
    return { display: `MJC NO. ${m[1]} OF ${y}`, mjcNo: m[1], year: y };
  }

  const reWrit =
    /(?:W\.?\s*P\.?\s*(?:\(C\)|\(CRL\)|\(CRIMINAL\))?|WRIT\s+PETITION(?:\s*\(CRIMINAL\))?)\s*(?:NO\.?)?\s*(\d+)\s*(?:\/\s*(\d{4})|\s+OF\s+(\d{2,4}))/i;
  m = s.match(reWrit);
  if (m) {
    const yr = m[2] || m[3] || '';
    const y = yr.length === 2 ? `20${yr}` : yr;
    const prefix = /criminal|crl/i.test(s) ? 'W.P.(CRL.) NO.' : 'W.P.(C) NO.';
    return { display: `${prefix} ${m[1]}${y ? ` OF ${y}` : ''}`, mjcNo: m[1], year: y };
  }

  const reCrl = /(?:CRL\.?|CRIMINAL)\s*(?:APPEAL|REVISION|PETITION)?\s*(?:NO\.?)?\s*(\d+)\s+OF\s+(\d{2,4})/i;
  m = s.match(reCrl);
  if (m) {
    let y = m[2];
    if (y.length === 2) y = `20${y}`;
    return { display: s.toUpperCase().includes('REVISION') ? `CRL. REVISION NO. ${m[1]} OF ${y}` : `CRL. APPEAL NO. ${m[1]} OF ${y}`, mjcNo: m[1], year: y };
  }

  const rePs = /([A-Za-z][A-Za-z0-9\s.]*?)\s*P\.?\s*S\.?\s*CASE\s*NO\.?\s*(\d+)\s+OF\s+(\d{4})/i;
  m = s.match(rePs);
  if (m) {
    const ps = m[1].replace(/\s+/g, ' ').trim();
    return { display: `${ps.toUpperCase()} P.S. CASE NO. ${m[2]} OF ${m[3]}`, mjcNo: m[2], year: m[3] };
  }

  return { display: s.toUpperCase(), mjcNo: '', year: '' };
}

function listRespondentNames(cd) {
  if (Array.isArray(cd.respondentNames) && cd.respondentNames.length) {
    return cd.respondentNames.map((x) => String(x).trim()).filter(Boolean);
  }
  const r = String(cd.respondentName || '').trim();
  if (!r) return [];
  const parts = r.split(/\n+|\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [r];
}

function listPetitionerNames(cd) {
  if (Array.isArray(cd.petitionerNames) && cd.petitionerNames.length) {
    return cd.petitionerNames.map((x) => String(x).trim()).filter(Boolean);
  }
  const r = String(cd.petitionerName || '').trim();
  if (!r) return [];
  const parts = r.split(/\n+|\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [r];
}

function partyLineHtml(name, roleSuffix, extraClass = '') {
  const n = htmlFieldValue(name);
  const r = escapeHtml(roleSuffix);
  const field = String(roleSuffix || '').toLowerCase().includes('petitioner') ? 'petitionerName' : 'respondentName';
  return `<div class="party-line${extraClass}" data-edit-field="${field}" style="cursor:pointer;"><span class="party-name">${n}</span><span class="party-dots" aria-hidden="true"></span><span class="party-role">${r}</span></div>`;
}

function partyCaptionTableHtml(petitioners, respondents, L) {
  const rows = [];
  if (!petitioners.length) {
    rows.push(
      `<tr data-edit-field="petitionerName" style="cursor:pointer;"><td class="party-cell-name">${htmlFieldValue('')}</td><td class="party-cell-role">${escapeHtml(L.petitionerSuffix || '.... Petitioner')}</td></tr>`
    );
  } else {
    const baseNo = (L.petitionerSuffixNo || '.... Petitioner No.').trim();
    petitioners.forEach((name, i) => {
      const suf =
        i === 0
          ? (petitioners.length > 1 ? (L.petitionerSuffixPlural || L.petitionerSuffix || '.... Petitioners') : (L.petitionerSuffix || '.... Petitioner'))
          : `${baseNo} ${i + 1}`;
      const sub = i > 0 ? 'sub-party-row' : '';
      rows.push(
        `<tr class="${sub}" data-edit-field="petitionerName" style="cursor:pointer;"><td class="party-cell-name">${htmlFieldValue(name)}</td><td class="party-cell-role">${escapeHtml(suf)}</td></tr>`
      );
    });
  }
  rows.push(
    `<tr class="versus-row"><td colspan="2" class="versus-cell">${escapeHtml(L.versus || 'VERSUS')}</td></tr>`
  );
  if (!respondents.length) {
    rows.push(
      `<tr data-edit-field="respondentName" style="cursor:pointer;"><td class="party-cell-name">${htmlFieldValue('')}</td><td class="party-cell-role">${escapeHtml(L.respondentSuffix || '.... Respondent')}</td></tr>`
    );
  } else {
    const baseNo = (L.respondentSuffixNo || '.... Respondent No.').trim();
    respondents.forEach((name, i) => {
      const suf =
        i === 0
          ? (respondents.length > 1 ? (L.respondentSuffixPlural || L.respondentSuffix || '.... Respondents') : (L.respondentSuffix || '.... Respondent'))
          : `${baseNo} ${i + 1}`;
      const sub = i > 0 ? 'sub-party-row' : '';
      rows.push(
        `<tr class="${sub}" data-edit-field="respondentName" style="cursor:pointer;"><td class="party-cell-name">${htmlFieldValue(name)}</td><td class="party-cell-role">${escapeHtml(suf)}</td></tr>`
      );
    });
  }
  return `<table class="parties-table"><tbody>${rows.join('')}</tbody></table>`;
}

function isWritDocTypeHint(text = '') {
  return /writ|habeas|mandamus|certiorari|quo warranto|w\.?\s*p\.?\s*\(/i.test(String(text || ''));
}

function isCriminalDocTypeHint(text = '') {
  const s = String(text || '').toLowerCase();
  return /criminal|crim\.|(^|[^a-z])cr\.|crl\.?|slp\s*\(?\s*crl|special leave.*crim|fir\b|bail\b|prosecution|penal code|\bipc\b|crpc|cr\.\s*p\.\s*c|482|319\b|sessions\b/i.test(s);
}

function buildCaseNumberLine(cd, mjcParsed, meta = {}) {
  const { isSupreme = false, sourceDocumentType = '' } = meta;
  if (cd.mjcNo != null && String(cd.mjcNo).trim() !== '' && cd.caseYear != null && String(cd.caseYear).trim() !== '') {
    const no = escapeHtml(String(cd.mjcNo).trim());
    const yr = escapeHtml(String(cd.caseYear).trim());
    return `<div class="caption-case-no" data-edit-field="caseNumber" style="cursor:pointer;"><strong>MJC NO. ${no} OF ${yr}</strong></div>`;
  }
  if (mjcParsed.display) {
    return `<div class="caption-case-no" data-edit-field="caseNumber" style="cursor:pointer;"><strong>${escapeHtml(mjcParsed.display)}</strong></div>`;
  }
  if (isSupreme) {
    const raw = String(cd.caseNumber || '').trim();
    let line;
    if (/^\d{4}$/.test(raw)) {
      line = `CRIMINAL APPEAL / SLP (CRIMINAL) NO. _____________ OF ${raw}`;
    } else if (raw) {
      line = raw.toUpperCase();
    } else if (isCriminalDocTypeHint(sourceDocumentType)) {
      line = 'CRIMINAL APPEAL / SPECIAL LEAVE TO APPEAL (CRL.) NO. _____________ OF ______';
    } else {
      line = 'CIVIL / CRIMINAL APPEAL NO. _____________ OF ______';
    }
    return `<div class="caption-case-no" data-edit-field="caseNumber" style="cursor:pointer;"><strong>${wrapUnderscoreRunsInHtml(escapeHtml(line))}</strong></div>`;
  }
  if (isWritDocTypeHint(sourceDocumentType)) {
    const crim = isCriminalDocTypeHint(sourceDocumentType);
    const line = crim ? 'W.P.(CRL.) NO. ______ OF ______' : 'W.P.(C) NO. ______ OF ______';
    return `<div class="caption-case-no" data-edit-field="caseNumber" style="cursor:pointer;"><strong>${wrapUnderscoreRunsInHtml(escapeHtml(line))}</strong></div>`;
  }
  return `<div class="caption-case-no" data-edit-field="caseNumber" style="cursor:pointer;"><strong>${wrapUnderscoreRunsInHtml(escapeHtml('MJC NO. ______ OF ______'))}</strong></div>`;
}

function resolveCounterOnBehalfLine(counterData, L) {
  const title = String(counterData.documentTitle || '').trim();
  if (title) return title;
  const opNo = String(counterData.showCauseOnBehalfOfOpNo || counterData.oppositePartyNo || '').trim();
  if (opNo) return `Counter Affidavit on behalf of OP No. ${opNo}`;
  const respondent = String(counterData.respondentName || '').trim();
  if (respondent) return `Counter Affidavit on behalf of ${respondent}`;
  return L.counterFiledSub || 'Counter Affidavit on behalf of the Respondent(s)';
}

function collectIndexRowsForTable(counterData, L) {
  const custom = Array.isArray(counterData.indexEntries) ? counterData.indexEntries : [];
  if (custom.length > 0) {
    return custom.map((row, i) => ({
      slNo: String(row.slNo || i + 1),
      particulars: String(row.particulars || '').trim(),
      page: String(row.page ?? '').trim(),
    }));
  }
  const built = [
    {
      slNo: '1',
      particulars: resolveCounterOnBehalfLine(counterData, L),
      page: '',
    },
  ];
  const annexures = Array.isArray(counterData.annexureIndex) ? counterData.annexureIndex : [];
  annexures.forEach((a, i) => {
    const letter = String(a.letter || a.id || '').trim() || String.fromCharCode(65 + i);
    const desc = String(a.description || a.particulars || '').trim();
    const label = desc
      ? (desc.startsWith('A ') || /^Annexure/i.test(desc)
        ? desc
        : `${L.annexurePhotostatPrefix || 'A Photostat copy of'} ${desc}`)
      : `Annexure-${letter}`;
    built.push({
      slNo: String(i + 2),
      particulars: `Annexure-${letter}: ${label}`,
      page: '',
    });
  });
  return built;
}

function buildInitialIndexTable(counterData, L, layout = {}) {
  const filled = fillIndexEntryPages(collectIndexRowsForTable(counterData, L), counterData, layout);
  const rows = [];
  filled.forEach((row, i) => {
    const sl = escapeHtml(String(row.slNo || i + 1));
    const particulars = escapeHtml(String(row.particulars || '').trim());
    const page = escapeHtml(String(row.page ?? '').trim());
    rows.push(`<tr data-edit-field="captionSubject" style="cursor:pointer;"><td class="col-sl">${sl}</td><td>${particulars}</td><td class="col-page">${page}</td></tr>`);
  });

  return `<table class="index-table"><thead><tr>
    <th class="col-sl">${escapeHtml(L.indexColSlNo || 'Sl. No.')}</th>
    <th>${escapeHtml(L.indexColParticulars || 'Particulars')}</th>
    <th class="col-page">${escapeHtml(L.indexColPage || 'Page No.')}</th>
  </tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function buildFirstPageCaption(counterData, courtOverride, design, L) {
  const cd = { ...counterData };
  const fp = design.layout?.firstPageCaption || {};

  // Clean up repeating/merged header details (jurisdiction and case number) from the court name
  let rawCourt = String(cd.court || courtOverride || '').trim();
  let cleanedCourt = rawCourt;
  let extractedJur = '';
  let extractedCase = '';

  // 1. Extract and strip parenthetical jurisdiction lines (e.g. "(Civil Writ Jurisdiction)")
  const jurMatch = cleanedCourt.match(/\(([^)]*jurisdiction)\)/i);
  if (jurMatch) {
    extractedJur = `(${jurMatch[1].trim()})`;
    cleanedCourt = cleanedCourt.replace(/\(([^)]*jurisdiction)\)/i, '').trim();
  }

  // 2. Extract and strip case number lines (e.g. "C.W.J.C. No. of 2023")
  const caseMatch = cleanedCourt.match(/(?:c\.?w\.?j\.?c\.?|m\.?j\.?c\.?|w\.?p\.?|crl\.?\s*w\.?p\.?|writ\s+petition)\s*(?:no\.?)?\s*(?:of\s*)?\d*\s*(?:of\s*\d{4}|\/\s*\d{4})?/i);
  if (caseMatch && caseMatch[0].length > 4) {
    extractedCase = caseMatch[0].trim();
    cleanedCourt = cleanedCourt.replace(caseMatch[0], '').trim();
  }

  cd.court = cleanedCourt;

  if (!cd.jurisdictionLine && extractedJur) {
    cd.jurisdictionLine = extractedJur;
  }
  if ((!cd.caseNumber || cd.caseNumber.includes('__')) && extractedCase) {
    cd.caseNumber = extractedCase;
  }

  const courtHint = `${cd.court || ''} ${courtOverride || ''}`;
  const docTypeHint = String(cd.sourceDocumentType || '');
  const isSupreme = /supreme\s+court/i.test(courtHint);
  const criminalJurisdiction =
    isCriminalDocTypeHint(docTypeHint) || isCriminalDocTypeHint(courtHint);
  const isBail =
    cd.procedureKind === 'bail_application' ||
    /regular\s+bail|anticipatory\s+bail|bail\s+application/i.test(docTypeHint);
  const jurisdictionText = cd.jurisdictionLine
    || (isBail ? '(Criminal Jurisdiction)' : '')
    || (isSupreme && criminalJurisdiction && fp.defaultScCriminalJurisdictionLine)
    || (isSupreme && fp.defaultScJurisdictionLine)
    || fp.defaultJurisdictionLine
    || (isSupreme ? '(Civil Appellate Jurisdiction)' : '(Miscellaneous Jurisdiction Case)');
  const jurisdictionHtml = `<div class="caption-jurisdiction" data-edit-field="jurisdictionLine" style="cursor:pointer;">${escapeHtml(jurisdictionText)}</div>`;

  const capIn = String(L.captionInThe != null ? L.captionInThe : 'IN THE').trim();
  const courtMid = escapeHtml(L.captionCourtOf || 'COURT OF JUDICATURE AT');

  const explicitSeg = String(cd.captionCourtName || cd.courtSegment || '').trim();
  const explicitCity = String(cd.captionCity || cd.city || '').trim();

  const parsed = parseJudicatureLine(cd.court || courtOverride || '');

  let line1Html = '';
  const prefix = capIn ? `<span class="thin">${escapeHtml(capIn)} </span>` : '';

  if (explicitSeg && explicitCity) {
    line1Html = `<div class="caption-line1" data-edit-field="court" style="cursor:pointer;">${prefix}<strong>${escapeHtml(explicitSeg)}</strong> ${courtMid} <strong>${escapeHtml(explicitCity)}</strong></div>`;
  } else if (parsed.mode === 'parts') {
    const seg = escapeHtml(parsed.courtSeg || 'HIGH');
    const city = htmlFieldValue(parsed.city || '');
    line1Html = `<div class="caption-line1" data-edit-field="court" style="cursor:pointer;">${prefix}<strong>${seg}</strong> ${courtMid} <strong>${city}</strong></div>`;
  } else if (parsed.mode === 'full' && parsed.full) {
    const fullLine = parsed.full.replace(/\s+/g, ' ').trim();
    line1Html = /^IN\s+THE/i.test(fullLine)
      ? `<div class="caption-line1" data-edit-field="court" style="cursor:pointer;"><strong>${escapeHtml(fullLine)}</strong></div>`
      : `<div class="caption-line1" data-edit-field="court" style="cursor:pointer;">${prefix}<strong>${escapeHtml(fullLine)}</strong></div>`;
  } else {
    line1Html = `<div class="caption-line1" data-edit-field="court" style="cursor:pointer;">${prefix}<span class="thin">${wrapUnderscoreRunsInHtml(escapeHtml(L.courtFallback || 'IN THE HIGH COURT OF JUDICATURE AT ____________'))}</span></div>`;
  }

  const mjcParsed = parseMjcCase(cd.caseNumber || '');
  const caseLineHtml = buildCaseNumberLine(cd, mjcParsed, {
    isSupreme,
    sourceDocumentType: cd.sourceDocumentType || '',
  });

  const matterHtml = `<div class="matter-line">${escapeHtml(L.inTheMatterOf || 'In the matter of:')}</div>`;

  const petitioners = listPetitionerNames(cd);
  const respondents = listRespondentNames(cd);
  const usePartyTable = design.layout?.captionPartyStyle === 'table';
  let partiesInner = '';
  if (usePartyTable) {
    partiesInner = partyCaptionTableHtml(petitioners, respondents, L);
  } else {
    let petHtml = '';
    if (petitioners.length === 0) {
      petHtml = partyLineHtml('', L.petitionerSuffix || '.... Petitioner');
    } else if (petitioners.length === 1) {
      petHtml = partyLineHtml(petitioners[0], L.petitionerSuffix || '.... Petitioner');
    } else {
      const baseNo = (L.petitionerSuffixNo || '.... Petitioner No.').trim();
      petitioners.forEach((name, i) => {
        const suf =
          i === 0
            ? L.petitionerSuffixPlural || L.petitionerSuffix || '.... Petitioners'
            : `${baseNo} ${i + 1}`;
        petHtml += partyLineHtml(name, suf, i > 0 ? ' sub-party-row' : '');
      });
    }

    let respHtml = '';
    if (respondents.length === 0) {
      respHtml = partyLineHtml('', L.respondentSuffix || '.... Respondent');
    } else if (respondents.length === 1) {
      respHtml = partyLineHtml(respondents[0], L.respondentSuffix || '.... Respondent');
    } else {
      const baseNo = (L.respondentSuffixNo || '.... Respondent No.').trim();
      respondents.forEach((name, i) => {
        const suf =
          i === 0
            ? L.respondentSuffixPlural || L.respondentSuffix || '.... Respondents'
            : `${baseNo} ${i + 1}`;
        respHtml += partyLineHtml(name, suf, i > 0 ? ' sub-party-row' : '');
      });
    }
    const versusHtml = `<div class="versus-line">${escapeHtml(L.versus || 'VERSUS')}</div>`;
    partiesInner = `${petHtml}${versusHtml}${respHtml}`;
  }

  const subjectText = String(cd.captionSubject || L.counterAffidavitMain || 'Counter Affidavit').trim()
    || 'Counter Affidavit';
  const subjectHtml = `<div class="subject-line" data-edit-field="captionSubject" style="cursor:pointer;"><span class="label">Subject:</span> <span class="value">${escapeHtml(subjectText)}</span></div>`;
  const indexHeading = `<div class="index-heading">${escapeHtml(L.indexHeading || 'INDEX')}</div>`;
  const indexHtml = buildInitialIndexTable(cd, L, design.layout || {});

  return `<div class="page-first">${line1Html}${jurisdictionHtml}${caseLineHtml}${matterHtml}<div class="parties-caption-block">${partiesInner}</div>${subjectHtml}${indexHeading}${indexHtml}</div>`;
}

function partyCaptionTableOppParties(petitioners, respondents, L) {
  const rows = [];
  if (!petitioners.length) {
    rows.push(
      `<tr><td class="party-cell-name">${htmlFieldValue('')}</td><td class="party-cell-role">${escapeHtml(L.petitionerSuffix || '..........Petitioner')}</td></tr>`
    );
  } else {
    petitioners.forEach((name, i) => {
      rows.push(
        `<tr><td class="party-cell-name">${htmlFieldValue(name)}</td><td class="party-cell-role">${escapeHtml(L.petitionerSuffix || '..........Petitioner')}</td></tr>`
      );
    });
  }
  const vrs = escapeHtml(L.versus || 'Vrs');
  rows.push(`<tr class="versus-row"><td colspan="2" class="versus-cell">${vrs}.</td></tr>`);
  const oppSuf = L.oppPartiesSuffix || '........Opp. Parties';
  if (!respondents.length) {
    rows.push(
      `<tr><td class="party-cell-name">${htmlFieldValue('')}</td><td class="party-cell-role">${escapeHtml(oppSuf)}</td></tr>`
    );
  } else {
    respondents.forEach((name) => {
      rows.push(
        `<tr><td class="party-cell-name">${htmlFieldValue(name)}</td><td class="party-cell-role">${escapeHtml(oppSuf)}</td></tr>`
      );
    });
  }
  return `<table class="parties-table"><tbody>${rows.join('')}</tbody></table>`;
}

/** Patna-style MJC show cause cover + matter page (see sample MJC 1423/2021). */
function buildMjcShowCauseFirstPages(counterData, courtOverride, design, L) {
  const cover = buildFirstPageCaption(counterData, courtOverride, design, L);
  const sub = `<div class="sub-show-cause">${escapeHtml(L.subShowCause || 'Sub:- Show Cause.')}</div>`;
  const index = '';

  let matterBlock = '';
  if (design.layout?.showMjcMatterPage !== false) {
    const opNo = String(counterData.showCauseOnBehalfOfOpNo || counterData.oppositePartyNo || '___').trim();
    const showLine = String(counterData.documentTitle || '').trim()
      || `Show Cause on behalf of OP No. ${opNo}`;
    const shortCaption = buildFirstPageCaption(counterData, courtOverride, design, L)
      .replace('class="page-first"', 'class="page-first mjc-matter-inner"');
    const petitioners = listPetitionerNames(counterData);
    const respondents = listRespondentNames(counterData);
    const partiesMatter = partyCaptionTableOppParties(petitioners, respondents, L);
    matterBlock = `<div class="page-first mjc-matter">${shortCaption}
      <div class="matter-sc-line">${escapeHtml(L.matterShowCausePrefix || 'In the matter of')} ${escapeHtml(showLine)}.</div>
      <div class="matter-and-line">${escapeHtml(L.matterAnd || 'And')}</div>
      <div class="matter-line">${escapeHtml(L.matterInTheMatterOf || 'In the matter of')}</div>
      <div class="parties-caption-block">${partiesMatter}</div>
    </div>`;
  }

  const insertAt = cover.lastIndexOf('</div>');
  const withIndex = insertAt > 0
    ? `${cover.slice(0, insertAt)}${sub}${index}${cover.slice(insertAt)}`
    : `${cover}${sub}${index}`;
  return withIndex + matterBlock;
}

function appendSourcePageAnnexures(body, counterData, L = {}) {
  const blocks = Array.isArray(counterData.annexurePhotostats) ? counterData.annexurePhotostats : [];
  const prefix = L.annexurePhotostatPrefix || 'A Photostat copy of';

  if (blocks.length) {
    body += '<div class="annexure-section">';
    blocks.forEach((block) => {
      const letter = String(block.letter || '').trim();
      const desc = String(block.description || '').trim();
      const title = letter
        ? `Annexure-${letter}${desc ? `: ${desc}` : ''}`
        : (desc || 'Annexure');
      body += `<p class="photostat-annexure-heading">${escapeHtml(title)}</p>`;
      const images = Array.isArray(block.images) ? block.images : [];
      images.forEach((img) => {
        const page = Number(img.page) || '';
        const src = String(img.dataUrl || '').trim();
        if (!src) return;
        const pageNote = page ? ` (page ${page}${block.totalPages > images.length ? ` of ${block.totalPages}` : ''})` : '';
        body += `<div class="photostat-page"><p class="photostat-label">${escapeHtml(prefix)}${pageNote}</p><img src="${src}" alt="Annexure ${letter} page ${page}"/></div>`;
      });
      const shown = images.length;
      if (block.totalPages > shown) {
        body += `<p class="photostat-more-note"><em>${escapeHtml(`(${block.totalPages - shown} further page(s) of this annexure are filed; photostat excerpt shown above.)`)}</em></p>`;
      }
    });
    body += '</div>';
    return body;
  }

  const images = Array.isArray(counterData.sourcePageImages) ? counterData.sourcePageImages : [];
  if (!images.length) return body;
  body += '<div class="annexure-section">';
  images.forEach((img) => {
    const page = Number(img.page) || '';
    const src = String(img.dataUrl || '').trim();
    if (!src) return;
    body += `<div class="photostat-page"><p class="photostat-label">Photostat copy — source document${page ? ` (page ${page})` : ''}</p><img src="${src}" alt="Annexure page ${page}"/></div>`;
  });
  body += '</div>';
  return body;
}

/**
 * Builds HTML/PDF source for counter affidavit export using the single packaged design.
 * Future: resolve design from sourceDocumentType via registry.
 */
export function buildCounterAffidavitExportHtml(counterData, { language = 'en', court: courtOverride, designId } = {}) {
  const design = loadCounterAffidavitDesign(designId);
  const lang = language === 'hi' ? 'hi' : 'en';
  const L = design.labels?.[lang] || design.labels?.en || {};
  const layout = design.layout || {};

  let body = '';
  if (layout.variant === 'mjc_show_cause') {
    body += buildMjcShowCauseFirstPages(counterData, courtOverride, design, L);
  } else {
    body += buildFirstPageCaption(counterData, courtOverride, design, L);
  }
  body += '<div class="body-document">';
  body += appendStandardCounterSections(counterData, L, layout, 'html', counterData);
  body += '</div>';
  body = appendSourcePageAnnexures(body, counterData, L);

  // Removed draft notice from the document bottom per user request

  const title = escapeHtml(L.counterAffidavitMain || 'Counter Affidavit');
  const css = `${design.css || ''}${COUNTER_BLANK_CSS}`;

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>
<style>${css}</style></head><body>${body}</body></html>`;
}

function docxStyles() {
  return {
    body: 'font-family:Times New Roman, serif; font-size:14px; line-height:1.5; color:#000;',
    center: 'text-align:center;',
    heading: 'font-weight:700; text-transform:uppercase; text-align:center;',
    section: 'font-weight:700; text-transform:uppercase; text-decoration:underline; margin:18px 0 8px 0;',
  };
}

function buildDocxCaption(counterData, courtOverride, design, L) {
  const cd = counterData;
  const fp = design.layout?.firstPageCaption || {};
  const courtHint = `${cd.court || ''} ${courtOverride || ''}`;
  const docTypeHint = String(cd.sourceDocumentType || '');
  const isSupreme = /supreme\s+court/i.test(courtHint);
  const criminalJurisdiction =
    isCriminalDocTypeHint(docTypeHint) || isCriminalDocTypeHint(courtHint);
  const jurisdictionText = cd.jurisdictionLine
    || (isSupreme && criminalJurisdiction && fp.defaultScCriminalJurisdictionLine)
    || (isSupreme && fp.defaultScJurisdictionLine)
    || fp.defaultJurisdictionLine
    || (isSupreme ? '(Civil Appellate Jurisdiction)' : '(Miscellaneous Jurisdiction Case)');

  const parsed = parseJudicatureLine(cd.court || courtOverride || '');
  const mjcParsed = parseMjcCase(cd.caseNumber || '');
  const caseLine = buildCaseNumberLine(cd, mjcParsed, {
    isSupreme,
    sourceDocumentType: cd.sourceDocumentType || '',
  }).replace('class="caption-case-no"', 'style="text-align:center; font-weight:700; margin:12px 0 18px 0;"');

  const partyRows = [];
  const petitioner = htmlFieldValue(cd.petitionerName);
  partyRows.push(`
    <tr>
      <td style="width:76%; padding:4px 0; vertical-align:top;">${petitioner}</td>
      <td style="width:24%; padding:4px 0; text-align:right; font-weight:700; vertical-align:top;">${escapeHtml(L.petitionerSuffix || '.... Petitioner')}</td>
    </tr>
  `);

  const respondents = listRespondentNames(cd);
  if (!respondents.length) {
    partyRows.push(`
      <tr>
        <td style="width:76%; padding:4px 0; vertical-align:top;">${htmlFieldValue('')}</td>
        <td style="width:24%; padding:4px 0; text-align:right; font-weight:700; vertical-align:top;">${escapeHtml(L.respondentSuffix || '.... Respondent')}</td>
      </tr>
    `);
  } else if (respondents.length === 1) {
    partyRows.push(`
      <tr>
        <td style="width:76%; padding:4px 0; vertical-align:top;">${htmlFieldValue(respondents[0])}</td>
        <td style="width:24%; padding:4px 0; text-align:right; font-weight:700; vertical-align:top;">${escapeHtml(L.respondentSuffix || '.... Respondent')}</td>
      </tr>
    `);
  } else {
    const baseNo = (L.respondentSuffixNo || '.... Respondent No.').trim();
    respondents.forEach((name, i) => {
      const suffix = i === 0
        ? (L.respondentSuffixPlural || L.respondentSuffix || '.... Respondents')
        : `${baseNo} ${i + 1}`;
      partyRows.push(`
        <tr>
          <td style="width:76%; padding:4px 0 4px ${i > 0 ? '20' : '0'}px; vertical-align:top;">${htmlFieldValue(name)}</td>
          <td style="width:24%; padding:4px 0; text-align:right; font-weight:700; vertical-align:top;">${escapeHtml(suffix)}</td>
        </tr>
      `);
    });
  }

  const line1 = parsed.mode === 'parts'
    ? `IN THE <strong>${escapeHtml(parsed.courtSeg || 'HIGH')}</strong> COURT OF JUDICATURE AT <strong>${htmlFieldValue(parsed.city || '')}</strong>`
    : `<strong>${wrapUnderscoreRunsInHtml(escapeHtml(parsed.full || (L.courtFallback || 'IN THE HIGH COURT OF JUDICATURE AT ____________')))}</strong>`;

  return `
    <p style="text-align:center; font-weight:700; text-transform:uppercase; margin:0 0 6px 0;">${line1}</p>
    <p style="text-align:center; font-style:italic; margin:0 0 6px 0;">${escapeHtml(jurisdictionText)}</p>
    ${caseLine}
    <p style="text-align:center; font-weight:700; margin:0 0 12px 0;">${escapeHtml(L.inTheMatterOf || 'In the matter of:')}</p>
    <table style="width:100%; border-collapse:collapse; margin:0 0 8px 0;">
      ${partyRows[0]}
    </table>
    <p style="text-align:center; font-weight:700; letter-spacing:1px; margin:4px 0;">${escapeHtml(L.versus || 'VERSUS')}</p>
    <table style="width:100%; border-collapse:collapse; margin:0 0 22px 0;">
      ${partyRows.slice(1).join('')}
    </table>
  `;
}

/** Simple Word-like caption (no dotted leaders / writ first-page layout). */
function buildSimpleCaption(counterData, courtOverride, L) {
  const cd = counterData || {};
  const court = escapeHtml(String(cd.court || courtOverride || '').trim());
  const caseNo = escapeHtml(String(cd.caseNumber || '').trim());
  const pet = escapeHtml(String(cd.petitionerName || '').trim());
  const res = escapeHtml(String(cd.respondentName || '').trim());
  const title = escapeHtml(L.counterAffidavitMain || 'Counter Affidavit');

  let html = '';
  if (court) {
    html += `<p style="text-align:center; font-weight:bold; margin:0 0 8px 0;">${court}</p>`;
  }
  if (caseNo) {
    html += `<p style="text-align:center; margin:0 0 12px 0;">${caseNo}</p>`;
  }
  html += `<p style="text-align:center; font-weight:bold; margin:0 0 14px 0;">${title}</p>`;
  if (pet) {
    html += `<p style="margin:0 0 6px 0;">${pet} — Petitioner</p>`;
  }
  html += `<p style="text-align:center; margin:8px 0;">${escapeHtml(L.versus || 'Versus')}</p>`;
  if (res) {
    html += `<p style="margin:0 0 14px 0;">${res} — Respondent</p>`;
  }
  return html;
}

const SIMPLE_WORD_CSS = `
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.35; color: #000; margin: 2.54cm; }
  p { margin: 0 0 10px 0; text-align: justify; }
  ol { margin: 0 0 10px 0; padding-left: 24px; }
  li { margin: 0 0 6px 0; text-align: justify; }
`;

/**
 * Counter Studio / editable preview: plain document like a typical Word draft (not formal court letter CSS).
 */
export function buildCounterAffidavitSimpleHtml(counterData, { language = 'en', court: courtOverride, designId } = {}) {
  const design = loadCounterAffidavitDesign(designId);
  const lang = language === 'hi' ? 'hi' : 'en';
  const L = design.labels?.[lang] || design.labels?.en || {};
  const layout = {
    ...(design.layout || {}),
    showCounterFiledSubheading: false,
    showDocumentTitleSubheading: false,
    paraWiseReplyTable: false,
    numberedBodyParagraphs: true,
    deponentStyle: 'opening_paragraph',
    showDeponentSectionHeading: false,
    simpleWordMode: true,
  };
  const s = docxStyles();

  let body = `<div style="${s.body}">`;
  body += buildSimpleCaption(counterData, courtOverride, L);
  body += appendStandardCounterSections(counterData, L, layout, 'docx');
  body += '</div>';

  const title = escapeHtml(L.counterAffidavitMain || 'Counter Affidavit');
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${title}</title>
<style>${SIMPLE_WORD_CSS}${COUNTER_BLANK_CSS}</style></head><body>${body}</body></html>`;
}

/** DOCX-friendly HTML renderer for html-to-docx (avoids flex/dotted leader CSS unsupported in converters). */
export function buildCounterAffidavitDocxHtml(counterData, { language = 'en', court: courtOverride, designId } = {}) {
  const design = loadCounterAffidavitDesign(designId);
  const lang = language === 'hi' ? 'hi' : 'en';
  const L = design.labels?.[lang] || design.labels?.en || {};
  const layout = design.layout || {};
  const s = docxStyles();

  let body = `<div style="${s.body}">`;
  body += buildDocxCaption(counterData, courtOverride, design, L);
  body += appendStandardCounterSections(counterData, L, layout, 'docx');
  body += '</div>';

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>${escapeHtml(L.counterAffidavitMain || 'Counter Affidavit')}</title></head><body>${body}</body></html>`;
}
