/**
 * Merge Smart Scan + legal intelligence into counter affidavit fields
 * so fewer underscore / [INSERT FROM RECORD] placeholders remain after generate.
 */

export function isBlankCounterField(value) {
  const text = String(value ?? '').trim();
  if (!text) return true;
  if (/\[INSERT FROM RECORD\]/i.test(text)) return true;
  if (/^to be completed/i.test(text)) return true;
  if (/_{4,}/.test(text)) return true;
  if (/NO\.\s*_{2,}/i.test(text)) return true;
  if (/^MJC\s+NO\.\s*$/i.test(text)) return true;
  return false;
}

export function cleanPartyField(val) {
  if (val == null || val === '') return '';
  let cleaned = String(val)
    .replace(/_{3,}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,./;:-]+|[\s,./;:-]+$/g, '')
    .trim();
  if (/^(not available|n\/a|na|unknown|nil|null|—|-)$/i.test(cleaned)) return '';
  return cleaned.length > 2 ? cleaned : '';
}

/**
 * Rule-based caption extraction from first pages (writ / MJC / show cause).
 * Complements LLM Smart Scan when parties.jurisdiction are missed.
 */
function captionTextSlice(text = '') {
  const head = String(text || '').slice(0, 32000);
  const cutIndex = head.search(/Most\s+Respectfully\s+Sheweth|Sheweth\s*:-|^\s*That,\s*this\s+is\s+an\s+application|COUNTER\s+AFFIDAVIT\s+ON\s+BEHALF|PRELIMINARY\s+OBJECTIONS/i);
  if (cutIndex > 1500) {
    return head.slice(0, cutIndex).slice(0, 15000);
  }
  return head.slice(0, 15000);
}

/** First-page excerpt for focused party-name LLM (counter generation). */
export function getCaptionSnippetForLlm(text = '') {
  return captionTextSlice(text).slice(0, 15000);
}

export function extractCaptionPartiesFromText(text = '') {
  const head = captionTextSlice(text);
  const lines = head
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length > 0);

  const court = extractCourtLineFromText(head);
  let caseNumber = extractCaseNumberFromText(head);
  let jurisdictionLine = '';

  for (let i = 0; i < Math.min(lines.length, 80); i++) {
    const line = lines[i];
    if (/^\([^)]*(?:Jurisdiction|Appellate|Writ|Criminal)[^)]*\)$/i.test(line)) {
      jurisdictionLine = line;
    }
    if (!caseNumber && /\b(?:MJC|W\.?\s*P\.?|CR\.?\s*MISC)/i.test(line)) {
      caseNumber = extractCaseNumberFromText(line) || caseNumber;
    }
  }

  let petitioner = '';
  let respondent = '';
  let department = '';

  // Non-backtracking line-by-line scanning to prevent catastrophic regex backtracking on large slices
  for (const line of lines) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9\s.'()\-]{2,90}?)\s*(?:\.{2,}|[-—_]{2,}|\s{3,})\s*(?:Petitioner|Petitioners)\b/i);
    if (m) {
      petitioner = cleanPartyField(m[1]);
      break;
    }
  }

  if (!petitioner) {
    for (const line of lines) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9\s.'()\-]{2,90}?)\s+Versus\b/i);
      if (m) {
        petitioner = cleanPartyField(m[1]);
        break;
      }
    }
  }

  const stateOf = head.slice(0, 4000).match(
    /\b(The\s+State\s+of\s+[A-Za-z][A-Za-z\s]{2,40})(?:\s+\.{2,}|\s*,|\s+through|\s+and\s+|\n|\s+The\s+humble)/i
  );
  if (stateOf) {
    department = cleanPartyField(stateOf[1]);
    respondent = department;
  }

  if (!respondent) {
    for (const line of lines) {
      const m = line.match(/^([A-Za-z][A-Za-z0-9\s.'()\-&]{2,80}?)\s*(?:\.{2,}|[-—_]{2,}|\s{3,})\s*(?:Respondent|Respondents)\b/i);
      if (m) {
        respondent = sanitizePartyNameForCaption(m[1]);
        break;
      }
    }
  }

  // Fuzzy versus line index lookup
  const versusIdx = lines.findIndex((l) => /^(?:versus|vs\.?|vrs\.?|v\/s\.?)$/i.test(l) || /\b(?:versus|vs\.|v\/s)\b/i.test(l));
  const petLabelIdx = lines.findIndex((l) => /^petitioner\b/i.test(l));
  const resLabelIdx = lines.findIndex((l) => /^(?:respondent|opp\.?\s*parties)\b/i.test(l));

  if (!petitioner && petLabelIdx >= 0 && versusIdx > petLabelIdx) {
    const block = lines
      .slice(petLabelIdx + 1, versusIdx)
      .filter((l) => !/^petitioner/i.test(l) && !/\.{4,}/.test(l) && !/^\d+\.\s*$/.test(l) && l.length > 2);
    if (block.length) petitioner = cleanPartyField(block.join(' '));
  }

  if (!petitioner && versusIdx > 0) {
    for (let i = versusIdx - 1; i >= Math.max(0, versusIdx - 6); i--) {
      const line = lines[i];
      if (/^(?:in\s+the|mjc|w\.?\s*p|case\s+no|p\.?\s*s\.?\s*case)/i.test(line)) continue;
      if (/\.{4,}/.test(line)) {
        const name = line.split(/\.{2,}/)[0].trim();
        if (name.length > 3 && name.length < 100) {
          petitioner = sanitizePartyNameForCaption(name);
          break;
        }
      }
      if (line.length > 4 && line.length < 100 && !/^(versus|petitioner|respondent)/i.test(line)) {
        petitioner = sanitizePartyNameForCaption(line);
        break;
      }
    }
  }

  if (!respondent && versusIdx >= 0 && !department) {
    const end = resLabelIdx > versusIdx ? resLabelIdx : Math.min(lines.length, versusIdx + 3);
    const block = lines
      .slice(versusIdx + 1, end)
      .filter(
        (l) =>
          !/^(?:versus|respondent|in\s+the\s+matter|sub\s*:-|the\s+humble|that,)/i.test(l) &&
          !/^\(.*jurisdiction/i.test(l) &&
          l.length > 2 &&
          l.length < 120
      );
    if (block.length === 1) {
      respondent = sanitizePartyNameForCaption(block[0].split(/\.{2,}/)[0]);
    }
  }

  if (!respondent && department) respondent = department;

  const procedureKind = detectCounterProcedureKind(text, '');
  if (!jurisdictionLine && procedureKind === 'bail_application') {
    jurisdictionLine = '(Criminal Jurisdiction)';
  }

  const opMatch = head.match(/\b(?:OP\.?\s*NO\.?|Opposite\s+Party\s+No\.?)\s*(\d+)\b/i);

  return {
    petitioner: sanitizePartyNameForCaption(petitioner),
    respondent: sanitizePartyNameForCaption(respondent),
    court: sanitizePartyNameForCaption(court) || court,
    caseNumber,
    jurisdictionLine,
    department: sanitizePartyNameForCaption(department),
    oppositePartyNo: opMatch ? String(opMatch[1]).trim() : '',
    procedureKind,
  };
}

function shouldReplacePartyField(current, incoming) {
  const cur = String(current ?? '').trim();
  const inc = String(incoming ?? '').trim();
  if (!inc || isBlankCounterField(inc)) return false;
  if (!cur || isBlankCounterField(cur)) return true;
  const curValid = isValidCaptionPartyName(cur);
  const incValid = isValidCaptionPartyName(inc);
  if (incValid && !curValid) return true;
  if (incValid && curValid && cur.length > 100 && inc.length <= 90) return true;
  return false;
}

/** Merge LLM parties JSON with heuristic caption parse (prefer real values over blanks). */
export function mergePartiesRecords(llmParties = {}, heuristic = {}) {
  const out = { ...(llmParties && typeof llmParties === 'object' ? llmParties : {}) };
  const apply = (key, altKey) => {
    const hKey = altKey || key;
    const fromH = String(heuristic[hKey] ?? '').trim();
    if (shouldReplacePartyField(out[key], fromH)) out[key] = fromH;
  };
  apply('petitioner');
  apply('respondent');
  if (out.petitioner) out.petitioner = sanitizePartyNameForCaption(out.petitioner);
  if (out.respondent) out.respondent = sanitizePartyNameForCaption(out.respondent);
  if (!isValidCaptionPartyName(out.respondent) && heuristic.department) {
    out.respondent = sanitizePartyNameForCaption(heuristic.department);
  }
  apply('court');
  if (out.court) out.court = String(out.court).replace(/\s+/g, ' ').trim();
  apply('caseNumber');
  if (heuristic.jurisdictionLine && !String(out.jurisdictionLine || '').trim()) {
    out.jurisdictionLine = heuristic.jurisdictionLine;
  }
  if (heuristic.oppositePartyNo && !String(out.oppositePartyNo || out.opNo || '').trim()) {
    out.oppositePartyNo = heuristic.oppositePartyNo;
  }
  return out;
}

/** Drop petition body accidentally merged into party fields. */
export function sanitizePartyNameForCaption(name = '') {
  let s = String(name || '').replace(/[ \t\r]+/g, ' ').trim();
  if (!s) return '';
  if (s.length > 120) {
    s = s.split(/\.\s+(?:That,|The\s+humble|Most\s+Respectfully|In\s+the\s+matter|COUNTER\s+AFFIDAVIT)/i)[0].trim();
  }
  if (s.length > 120) s = `${s.slice(0, 117)}…`;
  if (/^(that|the\s+humble|most\s+respectfully|in\s+the\s+matter|counter\s+affidavit|preliminary|annexure)/i.test(s)) return '';
  if (/\bB\.?\s*N\.?\s*S\.?\b|section\s+\d+|F\.?\s*I\.?\s*R\.?\b|Sheweth/i.test(s) && s.length > 80) {
    s = s.split(/\b(?:B\.?\s*N\.?\s*S\.?\b|section\s+\d+|F\.?\s*I\.?\s*R\.?\b|Sheweth)/i)[0].trim();
  }
  if (/\.{4,}/.test(s) && s.replace(/\.+/g, '').trim().length < 4) return '';
  return cleanPartyField(s) || (s.length <= 80 && !isBlankCounterField(s) ? s : '');
}

export function detectCounterProcedureKind(text = '', documentType = '') {
  const blob = `${documentType} ${text}`.slice(0, 20000).toLowerCase();
  if (/regular\s+bail|anticipatory\s+bail|bail\s+application|grant\s+of\s+bail/i.test(blob)) {
    return 'bail_application';
  }
  if (/\bmjc\b|show\s*cause|miscellaneous\s*jurisdiction/i.test(blob)) return 'mjc_show_cause';
  if (/writ\s+petition|w\.?\s*p\.?\s*\(|habeas|mandamus/i.test(blob)) return 'writ_petition';
  return '';
}

export function extractCaseNumberFromText(text = '') {
  const s = String(text || '');
  const psCase = s.match(/([A-Za-z][A-Za-z0-9\s.]*?)\s*P\.?\s*S\.?\s*CASE\s*NO\.?\s*(\d+)\s+OF\s+(\d{4})/i);
  if (psCase) {
    const ps = psCase[1].replace(/\s+/g, ' ').trim();
    return `${ps.toUpperCase()} P.S. CASE NO. ${psCase[2]} OF ${psCase[3]}`;
  }
  const mjc = s.match(/\bMJC\s*(?:NO\.?)?\s*(\d+)\s+OF\s+(\d{2,4})\b/i);
  if (mjc) {
    let y = mjc[2];
    if (y.length === 2) y = `20${y}`;
    return `MJC NO. ${mjc[1]} OF ${y}`;
  }
  const wp = s.match(
    /\bW\.?\s*P\.?\s*(?:\(C\)|\(CRL\)|\(CRIMINAL\))?\s*(?:NO\.?)?\s*(\d+)\s*(?:\/\s*(\d{4})|OF\s+(\d{2,4}))/i
  );
  if (wp) {
    const yr = wp[2] || wp[3] || '';
    const y = yr.length === 2 ? `20${yr}` : yr;
    const prefix = /crl|criminal/i.test(s) ? 'W.P.(CRL.) NO.' : 'W.P.(C) NO.';
    return `${prefix} ${wp[1]}${y ? ` OF ${y}` : ''}`;
  }
  const crl = s.match(/\bCR\.?\s*MISC\.?\s*(?:APPLICATION|PETITION)?\s*(?:NO\.?)?\s*(\d+)\s+OF\s+(\d{2,4})/i);
  if (crl) {
    let y = crl[2];
    if (y.length === 2) y = `20${y}`;
    return `CR. MISC. NO. ${crl[1]} OF ${y}`;
  }
  return '';
}

export function extractCourtLineFromText(text = '') {
  const s = String(text || '').slice(0, 8000);
  const mFull = s.match(/IN\s+THE\s+COURT\s+OF\s+DISTRICT\s+AND\s+SESSIONS?\s+JUDGE[^\n,]{0,80}/i);
  if (mFull) return mFull[0].replace(/\s+/g, ' ').trim();
  const mHigh = s.match(
    /IN\s+THE\s+((?:HON'?BLE\s+)?(?:HIGH\s+)?SUPREME\s+COURT[^\n]{0,80}|(?:HIGH\s+)?COURT\s+OF\s+JUDICATURE\s+AT\s+[^\n,]{2,60})/i
  );
  if (mHigh) {
    const line = mHigh[0].replace(/\s+/g, ' ').trim();
    return /^IN\s+THE/i.test(line) ? line : `IN THE ${line}`;
  }
  const mSessions = s.match(/(?:IN\s+THE\s+)?COURT\s+OF\s+DISTRICT\s+AND\s+SESSIONS?\s+JUDGE[^\n,]{0,80}/i);
  if (mSessions) {
    const line = mSessions[0].replace(/\s+/g, ' ').trim();
    return /^IN\s+THE/i.test(line) ? line : `IN THE ${line}`;
  }
  return '';
}

export function isValidCaptionPartyName(value) {
  const s = sanitizePartyNameForCaption(value);
  return !!s && s.length >= 3 && !isBlankCounterField(s);
}

function firstNonBlank(...values) {
  for (const v of values) {
    if (isValidCaptionPartyName(v)) return sanitizePartyNameForCaption(v);
    const c = cleanPartyField(v);
    if (c) return c;
    const t = String(v ?? '').trim();
    if (t && !isBlankCounterField(t) && t.length <= 100) return t;
  }
  return '';
}

/** Prefer Smart Scan / short valid names over polluted grounds text. */
function pickPartyName(...values) {
  const scored = values
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      clean: sanitizePartyNameForCaption(raw),
      valid: isValidCaptionPartyName(raw),
      len: raw.length,
    }))
    .filter((x) => x.valid || (x.clean && x.len <= 100));
  if (!scored.length) return '';
  scored.sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1;
    return a.len - b.len;
  });
  return scored[0].clean || scored[0].raw;
}

/**
 * Best caption fields from petition extraction, Smart Scan parties, and legal intelligence.
 */
export function collectCaptionFromSources({
  groundsParsed = {},
  extractedParties = {},
  courtBody = '',
  legalIntelligence = null,
  scanResults = {},
  sessionText = '',
} = {}) {
  const ep = extractedParties && typeof extractedParties === 'object' ? extractedParties : {};
  const li = legalIntelligence && typeof legalIntelligence === 'object' ? legalIntelligence : {};
  const text = String(sessionText || '').slice(0, 120000);
  const heuristic = extractCaptionPartiesFromText(text);

  const petitionerName = pickPartyName(
    ep.petitioner,
    ep.petitioners,
    Array.isArray(ep.petitionerNames) ? ep.petitionerNames[0] : '',
    scanResults.petitionerName,
    li.parties?.petitioners?.[0]?.name,
    heuristic.petitioner,
    groundsParsed.petitionerName,
  );

  const respondentName = pickPartyName(
    ep.respondent,
    ep.respondents,
    ep.department,
    ep.agency,
    scanResults.respondentName,
    li.parties?.respondents?.[0]?.name,
    li.parties?.department,
    heuristic.respondent,
    heuristic.department,
    groundsParsed.respondentName,
    ep.oppositeParty,
    Array.isArray(ep.respondentNames) ? ep.respondentNames.join(' & ') : '',
  );

  const caseNumber = firstNonBlank(
    groundsParsed.caseNumber,
    heuristic.caseNumber,
    ep.caseNumber,
    li.caseMetadata?.caseNumber,
    scanResults.caseNumber,
    extractCaseNumberFromText(text),
  );

  const court = firstNonBlank(
    groundsParsed.court,
    heuristic.court,
    ep.court,
    courtBody,
    li.caseMetadata?.courtName,
    scanResults.court,
    extractCourtLineFromText(text),
  );

  const oppositePartyNo = firstNonBlank(
    heuristic.oppositePartyNo,
    ep.oppositePartyNo,
    ep.opNo,
    ep.opNumber,
    ep.opposite_party_no,
    scanResults.oppositePartyNo,
  );

  const jurisdictionLine = firstNonBlank(
    ep.jurisdictionLine,
    heuristic.jurisdictionLine,
    scanResults.jurisdictionLine,
  );

  return {
    petitionerName,
    respondentName,
    caseNumber,
    court,
    oppositePartyNo,
    jurisdictionLine,
  };
}

export function stripInsertFromRecord(text = '') {
  return String(text || '').replace(
    /\[INSERT FROM RECORD\]/gi,
    'the facts as borne out from the official record placed before the respondent',
  );
}

export function buildVerificationWithPlace(legalIntelligence, extractedParties, fallbackVerification) {
  const base = String(
    fallbackVerification ||
    'Verified at ____________ on this ______ day of ____________, 20____ that the contents of the above affidavit are true and correct to the best of my knowledge and belief and nothing material has been concealed therefrom.'
  ).trim();
  if (!isBlankCounterField(base) && !/_{4,}/.test(base)) return stripInsertFromRecord(base);

  const ep = extractedParties || {};
  const district = String(
    legalIntelligence?.caseMetadata?.district ||
    ep.district ||
    ''
  ).trim();
  let place = '';
  if (district) {
    place = district.replace(/\bdistrict\b/gi, '').trim();
  }
  if (!place) {
    const court = String(ep.court || legalIntelligence?.caseMetadata?.courtName || '').trim();
    const at = court.match(/AT\s+([A-Za-z][A-Za-z\s]{2,40})/i);
    if (at) place = at[1].trim();
  }
  if (place) {
    return stripInsertFromRecord(
      base.replace('Verified at ____________', `Verified at ${place}`)
    );
  }
  return stripInsertFromRecord(base);
}

function minimalReplyFromGround(item, groundsParsed, index) {
  const pNo = Number(item.petitionParaNo ?? item.paraNo ?? index + 1) || index + 1;
  const g = Array.isArray(groundsParsed?.grounds)
    ? groundsParsed.grounds.find((x) => Number(x.paraNo) === pNo)
    : null;
  const claim = String(g?.claim || '').trim();
  const lead = claim
    ? `In reply to paragraph ${pNo} of the petition, the respondent states that the allegation to the effect that "${claim.slice(0, 120)}${claim.length > 120 ? '…' : ''}" is not admitted except to the extent borne out by the record. `
    : `In reply to paragraph ${pNo} of the petition, the respondent states that `;
  return (
    lead +
    'The respondent relies upon the official record and the materials already placed before the authorities. The petitioner is put to strict proof of every allegation not specifically admitted herein.'
  );
}

/**
 * Apply scan/caption/reply autofill onto counter export payload.
 */
export function autofillCounterDataFromScan(counterData, options = {}) {
  const {
    scanSession = null,
    legalIntelligence = null,
    groundsParsed = null,
    mergedCaption = null,
  } = options;

  const cd = { ...(counterData || {}) };
  const ep = scanSession?.extractedParties || {};
  const scanResults = scanSession?.scanResults || {};
  const sessionText = String(scanSession?.currentText || scanSession?.originalText || '').trim();

  const caption =
    mergedCaption ||
    collectCaptionFromSources({
      groundsParsed: {
        petitionerName: cd.petitionerName,
        respondentName: cd.respondentName,
        caseNumber: cd.caseNumber,
        court: cd.court,
        ...groundsParsed,
      },
      extractedParties: ep,
      courtBody: cd.court,
      legalIntelligence: legalIntelligence || scanSession?.legalIntelligence,
      scanResults,
      sessionText,
    });

  const applyIfBlank = (key, value) => {
    if (value == null || value === '') return;
    if (isBlankCounterField(cd[key])) cd[key] = value;
  };

  applyIfBlank('petitionerName', caption.petitionerName);
  applyIfBlank('respondentName', caption.respondentName);
  applyIfBlank('caseNumber', caption.caseNumber);
  applyIfBlank('court', caption.court);
  applyIfBlank('oppositePartyNo', caption.oppositePartyNo);
  applyIfBlank('jurisdictionLine', caption.jurisdictionLine);

  const proc = detectCounterProcedureKind(
    sessionText,
    cd.sourceDocumentType || scanSession?.detectedDocType || ''
  );
  if (proc && !cd.procedureKind) cd.procedureKind = proc;
  if (proc === 'bail_application') {
    if (isBlankCounterField(cd.jurisdictionLine)) cd.jurisdictionLine = '(Criminal Jurisdiction)';
    if (isBlankCounterField(cd.documentTitle)) {
      cd.documentTitle = 'Counter Affidavit on behalf of the State';
    }
    cd.sourceDocumentType = cd.sourceDocumentType || 'Bail Application';
  }

  if (cd.petitionerName) cd.petitionerName = sanitizePartyNameForCaption(cd.petitionerName);
  if (cd.respondentName) cd.respondentName = sanitizePartyNameForCaption(cd.respondentName);

  if (isBlankCounterField(cd.documentTitle) && caption.caseNumber) {
    const op = caption.oppositePartyNo || '';
    if (/\bmjc\b|show\s*cause/i.test(`${cd.sourceDocumentType || ''} ${caption.caseNumber}`)) {
      cd.documentTitle = op
        ? `Show Cause on behalf of OP No. ${op}`
        : 'Show Cause on behalf of the Opposite Party';
    }
  }

  if (!cd.deponentDetails || (isBlankCounterField(cd.deponentDetails) && !/^I,.*_{3,}/i.test(cd.deponentDetails))) {
    const dept = cleanPartyField(ep.department) || cleanPartyField(caption.respondentName);
    cd.deponentDetails = dept
      ? `I, _________________, being duly authorized to swear this affidavit on behalf of ${dept}, do hereby solemnly affirm and state on oath that I am acquainted with the facts of the case from the official record.`
      : 'I, _________________, do hereby solemnly affirm and state on oath that I am duly authorized to swear this affidavit and am fully acquainted with the facts and records of the case.';
  } else {
    cd.deponentDetails = stripInsertFromRecord(cd.deponentDetails);
  }

  if (isBlankCounterField(cd.prayer)) {
    cd.prayer =
      'It is therefore respectfully prayed that this Hon\'ble Court may be pleased to dismiss the writ petition with costs and pass such further order(s) as may be deemed fit and proper in the facts and circumstances of the case.';
  } else {
    cd.prayer = stripInsertFromRecord(cd.prayer);
  }

  cd.verification = buildVerificationWithPlace(
    legalIntelligence || scanSession?.legalIntelligence,
    ep,
    cd.verification,
  );

  if (Array.isArray(cd.preliminaryObjections)) {
    cd.preliminaryObjections = cd.preliminaryObjections
      .map((o) => stripInsertFromRecord(typeof o === 'string' ? o : String(o?.text || o || '')))
      .filter((o) => String(o).trim().length > 0);
  }

  if (Array.isArray(cd.statementOfAdditionalFacts)) {
    cd.statementOfAdditionalFacts = cd.statementOfAdditionalFacts
      .map((f) => stripInsertFromRecord(typeof f === 'string' ? f : String(f || '')))
      .filter((f) => String(f).trim().length > 0);
  }

  if (Array.isArray(cd.counterDraft)) {
    cd.counterDraft = cd.counterDraft.map((item, index) => {
      let counterArgument = stripInsertFromRecord(String(item.counterArgument || '').trim());
      if (isBlankCounterField(counterArgument) || counterArgument.length < 48) {
        if (groundsParsed?.grounds?.length) {
          counterArgument = minimalReplyFromGround(item, groundsParsed, index);
        } else if (!isBlankCounterField(counterArgument)) {
          /* keep short LLM text */
        } else {
          counterArgument = minimalReplyFromGround(item, groundsParsed, index);
        }
      }
      let supportingLaw = stripInsertFromRecord(String(item.supportingLaw || '').trim());
      if (isBlankCounterField(supportingLaw)) supportingLaw = '';
      return { ...item, counterArgument, supportingLaw };
    });
  }

  return cd;
}
