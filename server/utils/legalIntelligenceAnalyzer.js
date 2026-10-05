const CLAIM_REPLIES = {
  DENIED: 'DENIED',
  NOT_ADMITTED: 'NOT_ADMITTED',
  MATTER_OF_RECORD: 'MATTER_OF_RECORD',
  NO_SPECIFIC_REPLY: 'NO_SPECIFIC_REPLY',
  PARTLY_ADMITTED: 'PARTLY_ADMITTED',
  PROCEDURAL_REBUTTAL: 'PROCEDURAL_REBUTTAL',
  COMPLIANCE_RESPONSE: 'COMPLIANCE_RESPONSE',
};

const CATEGORY_PATTERNS = [
  { category: 'memo_reference', patterns: [/\bmemo\s*(?:no\.?|no:|no)?\b/i, /\bletter\s*(?:no\.?|no:|no)?\b/i, /\bnotification\s*(?:no\.?|no:|no)?\b/i] },
  { category: 'annexure_reference', patterns: [/\bannexure\b/i, /\bann\.?\s*\d+/i, /photostat copy/i] },
  { category: 'compliance_statement', patterns: [/\bin compliance/i, /departmental level/i, /matter was examined/i, /records available in the department/i, /compliance of the order/i, /implemented/i, /action has already been initiated/i] },
  { category: 'departmental_action', patterns: [/\bissued\b/i, /\binitiated\b/i, /\bforwarded\b/i, /\bsent to\b/i, /\bsanctioned\b/i, /\bapproved\b/i, /\bprocessed\b/i, /\breferred\b/i] },
  { category: 'section_41a_argument', patterns: [/\b41a\b/i, /section\s*41a/i, /s\.?\s*41a/i] },
  { category: 'arnesh_kumar_argument', patterns: [/arnesh\s*kumar/i] },
  { category: 'clean_antecedent_claim', patterns: [/clean\s+antecedent/i, /clean\s+antecedents/i, /no\s+criminal\s+antecedent/i, /no\s+criminal\s+antecedents/i] },
  { category: 'false_implication_claim', patterns: [/false\s+implication/i, /falsely\s+implicated/i, /false\s+case/i] },
  { category: 'innocence_claim', patterns: [/innocent/i, /not\s+guilty/i, /wrongly\s+implicated/i, /malafide/i] },
  { category: 'procedural_claim', patterns: [/procedur/i, /notice/i, /hearing/i, /service\s+of\s+notice/i, /delay/i, /laches/i, /maintainability/i, /jurisdiction/i, /willing\s+to\s+cooperate/i, /cooperate/i] },
  { category: 'jurisdiction_point', patterns: [/jurisdiction/i, /maintainable/i, /territorial/i, /pecuniary/i, /alternative remedy/i] },
  { category: 'prayer', patterns: [/\bprayer\b/i, /it\s+is\s+therefore\s+prayed/i, /most\s+respectfully\s+prays?/i] },
  { category: 'allegation', patterns: [/alleg/i, /accus/i, /trespass/i, /forged/i, /intimidat/i, /threat/i, /illegal/i, /arrest/i, /custody/i, /investigation/i, /recovery/i] },
  { category: 'legal_argument', patterns: [/section\s*\d+/i, /act\b/i, /judgment/i, /citation/i, /authority/i, /held\s+in/i, /supreme\s+court/i, /high\s+court/i] },
];

const SPEAKER_PATTERNS = [
  { speaker: 'petitioners', patterns: [/\bpetitioner(s)?\b/i, /\bapplicant(s)?\b/i, /\baccused\b/i] },
  { speaker: 'respondents', patterns: [/\brespondent(s)?\b/i, /\bstate of\b/i, /\bopposite party\b/i] },
  { speaker: 'department', patterns: [/department/i, /education department/i, /district education officer/i, /director/i, /secretary/i] },
];

const normalizeWhitespace = (text = '') => String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

const splitParagraphs = (text = '') => {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  const numbered = [];
  for (const block of blocks) {
    const parts = block.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    if (parts.length === 1) {
      numbered.push(block);
      continue;
    }
    const looksLikeParaList = parts.every((line) => /^\(?\d+[\).:-]?\s+/.test(line) || /^[-•]/.test(line) || line.length > 40);
    if (looksLikeParaList) {
      numbered.push(...parts);
    } else {
      numbered.push(block.replace(/\n+/g, ' '));
    }
  }

  return numbered.map((textValue, index) => ({
    paraNo: String(index + 1),
    text: textValue.trim(),
  }));
};

const extractMemoRefs = (text = '') => {
  const source = String(text || '');
  if (!source.trim()) return [];
  const refs = [];
  const seen = new Set();
  const patterns = [
    /\bmemo\s*(?:no\.?|no:|no)?\s*[:\/-]?\s*([A-Za-z0-9\-/\\.]{2,80})(?:\s*(?:dated|dt\.?|dtd)\s*([0-3]?\d[.\/-][01]?\d[.\/-]\d{2,4}|\d{4}-\d{2}-\d{2}))?/gi,
    /\bletter\s*(?:no\.?|no:|no)?\s*[:\/-]?\s*([A-Za-z0-9\-/\\.]{2,80})(?:\s*(?:dated|dt\.?|dtd)\s*([0-3]?\d[.\/-][01]?\d[.\/-]\d{2,4}|\d{4}-\d{2}-\d{2}))?/gi,
    /\bnotification\s*(?:no\.?|no:|no)?\s*[:\/-]?\s*([A-Za-z0-9\-/\\.]{2,80})(?:\s*(?:dated|dt\.?|dtd)\s*([0-3]?\d[.\/-][01]?\d[.\/-]\d{2,4}|\d{4}-\d{2}-\d{2}))?/gi,
    /\bannexure\s*[-:]?\s*([A-Za-z0-9]{1,6})/gi,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(source)) !== null) {
      const memo = String(match[1] || '').trim();
      const date = String(match[2] || '').trim();
      const key = `${memo}::${date}`;
      if (!memo || seen.has(key)) continue;
      seen.add(key);
      refs.push({
        memo,
        date,
        context: source.substring(Math.max(0, match.index - 80), Math.min(source.length, match.index + 140)).replace(/\n/g, ' ').trim(),
      });
    }
  }
  return refs;
};

const extractLegalSections = (text = '') => {
  const source = String(text || '');
  const out = [];
  const seen = new Set();
  const re = /\b(?:section|sec\.?|s\.?\s*)\s*\d+[A-Za-z0-9\-()\/]*\b(?:\s*(?:of|under)\s*[A-Z][A-Za-z0-9,&\s\-.()\/]{2,80})?/gi;
  let match;
  while ((match = re.exec(source)) !== null) {
    const value = match[0].replace(/\s+/g, ' ').trim();
    if (!seen.has(value.toLowerCase())) {
      seen.add(value.toLowerCase());
      out.push(value);
    }
  }
  return out;
};

const extractPsCase = (text = '') => {
  const source = String(text || '');
  const match = source.match(/(?:P\.\s*S\.?|Police\s+Station)\s*Case\s*(?:No\.?|No:|No)?\s*([A-Za-z0-9\/-]+(?:\s*of\s*\d{4})?)/i);
  return match ? match[1].trim() : '';
};

const detectCourtName = (text = '', scanResults = {}, extractedParties = {}) => {
  const courtFromScan = String(extractedParties?.court || '').trim();
  if (courtFromScan) return courtFromScan;
  const source = String(text || '');
  const match = source.match(/IN\s+THE\s+(.{8,120}?COURT(?:\s+OF\s+JUDICATURE\s+AT|\s+AT)\s+.{2,60})/i);
  if (match) return match[1].replace(/\s+/g, ' ').trim();
  return String(scanResults?.documentType || '').includes('Court') ? String(scanResults.documentType).trim() : '';
};

const detectJudgeName = (text = '') => {
  const source = String(text || '');
  const match = source.match(/HON'?BLE\s+(?:MR\.?\s*JUSTICE|MRS\.?\s*JUSTICE|DR\.?\s*JUSTICE)\s+([A-Z][A-Za-z.\s]+?)(?:\n|,|\.|\))/i);
  return match ? match[1].trim() : '';
};

const detectDistrict = (text = '', extractedParties = {}) => {
  const court = String(extractedParties?.court || text || '');
  const match = court.match(/AT\s+([A-Z][A-Za-z\s]+)/i);
  return match ? match[1].trim() : '';
};

const detectFilingType = (text = '', scanResults = {}) => {
  const blob = `${scanResults?.documentType || ''} ${text || ''}`.toLowerCase();
  if (/cwjc|writ|habeas|mandamus|certiorari|quo warranto/.test(blob)) return 'writ';
  if (/mjc|miscellaneous jurisdiction|show cause/.test(blob)) return 'miscellaneous jurisdiction';
  if (/bail|anticipatory bail|regular bail/.test(blob)) return 'bail';
  if (/counter affidavit|counter|reply/.test(blob)) return 'counter-affidavit';
  if (/affidavit/.test(blob)) return 'affidavit';
  return '';
};

const classifyParagraph = (text = '') => {
  const source = String(text || '');
  const lower = source.toLowerCase();
  const categories = [];

  for (const rule of CATEGORY_PATTERNS) {
    if (rule.patterns.some((pattern) => pattern.test(source))) {
      categories.push(rule.category);
    }
  }

  if (!categories.length) {
    if (/^\(?\d+[\).:-]/.test(source)) categories.push('factual_narration');
    else if (/\bprayed|prayer|therefore\s+prayed/i.test(source)) categories.push('prayer');
    else if (/\balleg/i.test(source)) categories.push('allegation');
    else categories.push('factual_narration');
  }

  if (/clean\s+antecedent/i.test(source)) categories.push('clean_antecedent_claim');
  if (/false\s+implication|falsely\s+implicated|false\s+case/i.test(source)) categories.push('false_implication_claim');
  if (/cooperate/i.test(source)) categories.push('procedural_claim');

  return [...new Set(categories)];
};

const inferSpeaker = (text = '') => {
  const source = String(text || '');
  if (/\bdepartment|government|state|respondent|opposite party|answering opposite party\b/i.test(source)) return 'respondent';
  if (/\bpetitioner|applicant|accused|writ petitioner\b/i.test(source)) return 'petitioner';
  if (/\bfir\b|\bpolice\b|\binvestigation\b/i.test(source)) return 'police';
  return 'petitioner';
};

const inferClaimType = (categories = [], text = '') => {
  const categorySet = new Set(categories);
  if (categorySet.has('clean_antecedent_claim')) return 'CLEAN_ANTECEDENT';
  if (categorySet.has('false_implication_claim')) return 'FALSE_IMPLICATION';
  if (categorySet.has('section_41a_argument')) return 'SECTION_41A';
  if (categorySet.has('arnesh_kumar_argument')) return 'ARNESH_KUMAR';
  if (categorySet.has('procedural_claim') && /cooperate/i.test(text)) return 'COOPERATION';
  if (categorySet.has('jurisdiction_point')) return 'JURISDICTION';
  if (categorySet.has('compliance_statement')) return 'COMPLIANCE';
  if (categorySet.has('departmental_action')) return 'DEPARTMENTAL_ACTION';
  if (categorySet.has('annexure_reference')) return 'ANNEXURE';
  if (categorySet.has('memo_reference')) return 'MEMO';
  if (categorySet.has('allegation')) return 'ALLEGATION';
  if (categorySet.has('prayer')) return 'PRAYER';
  return 'FACTUAL';
};

const recommendedReply = (categories = [], claimType = '') => {
  const cat = new Set(categories);
  if (cat.has('memo_reference') || cat.has('annexure_reference') || cat.has('compliance_statement') || cat.has('departmental_action')) return CLAIM_REPLIES.MATTER_OF_RECORD;
  if (cat.has('prayer')) return CLAIM_REPLIES.NO_SPECIFIC_REPLY;
  if (cat.has('section_41a_argument') || cat.has('arnesh_kumar_argument') || cat.has('procedural_claim') || cat.has('jurisdiction_point')) return CLAIM_REPLIES.PROCEDURAL_REBUTTAL;
  if (cat.has('clean_antecedent_claim') || cat.has('false_implication_claim')) return CLAIM_REPLIES.NOT_ADMITTED;
  if (cat.has('innocence_claim')) return CLAIM_REPLIES.NOT_ADMITTED;
  if (cat.has('allegation')) return CLAIM_REPLIES.DENIED;
  if (claimType === 'COOPERATION') return CLAIM_REPLIES.PROCEDURAL_REBUTTAL;
  return CLAIM_REPLIES.MATTER_OF_RECORD;
};

const extractEntities = (text = '') => {
  const source = String(text || '');
  const entities = [];
  const push = (type, value) => {
    const v = String(value || '').trim();
    if (!v) return;
    if (!entities.some((e) => e.type === type && e.value.toLowerCase() === v.toLowerCase())) {
      entities.push({ type, value: v });
    }
  };

  const sectionRefs = extractLegalSections(source);
  sectionRefs.forEach((s) => push('legal_section', s));

  const psCase = extractPsCase(source);
  if (psCase) push('police_station_case', psCase);

  const memoRefs = extractMemoRefs(source);
  memoRefs.forEach((ref) => {
    push('memo_reference', ref.memo);
    if (ref.date) push('date', ref.date);
  });

  const annexureMatches = [...source.matchAll(/\bannexure\s*[-:]?\s*([A-Za-z0-9]{1,6})/gi)];
  annexureMatches.forEach((m) => push('annexure', `Annexure ${m[1]}`));

  return entities;
};

export function analyzeLegalIntelligence({
  text = '',
  fileName = '',
  scanResults = {},
  extractedParties = {},
  sourceDocument = 'document',
  pageHint = null,
} = {}) {
  const sourceText = normalizeWhitespace(text);
  const paragraphs = splitParagraphs(sourceText);
  const memoNumbers = extractMemoRefs(sourceText);
  const legalSections = extractLegalSections(sourceText);
  const pscase = extractPsCase(sourceText);
  const courtName = detectCourtName(sourceText, scanResults, extractedParties);
  const judgeName = detectJudgeName(sourceText);
  const district = detectDistrict(sourceText, extractedParties);
  const filingType = detectFilingType(sourceText, scanResults);
  const entities = extractEntities(sourceText);

  const caseMetadata = {
    caseType: String(scanResults?.caseType || '').trim() || '',
    courtName,
    caseNumber: String(extractedParties?.caseNumber || scanResults?.caseNumber || '').trim() || '',
    judgeName,
    district,
    filingType,
  };

  const parties = {
    petitioners: [],
    respondents: [],
    department: String(extractedParties?.department || extractedParties?.agency || '').trim() || '',
    officers: [],
  };

  const petitioner = String(extractedParties?.petitioner || extractedParties?.petitioners || '').trim();
  if (petitioner) parties.petitioners.push({ name: petitioner, source: 'extractedParties' });
  const respondent = String(extractedParties?.respondent || extractedParties?.respondents || '').trim();
  if (respondent) parties.respondents.push({ name: respondent, source: 'extractedParties' });

  const governmentReferences = {
    memoNumbers: memoNumbers.map((ref) => ({
      number: ref.memo,
      date: ref.date || '',
      context: ref.context,
    })),
    letters: memoNumbers.filter((ref) => /letter/i.test(ref.context)).map((ref) => ({ number: ref.memo, date: ref.date || '', context: ref.context })),
    notifications: memoNumbers.filter((ref) => /notification/i.test(ref.context)).map((ref) => ({ number: ref.memo, date: ref.date || '', context: ref.context })),
    annexures: [...new Map(memoNumbers.filter((ref) => /annexure/i.test(ref.context)).map((ref) => [ref.memo.toLowerCase(), { label: `Annexure ${ref.memo}`, context: ref.context }])).values()],
  };

  const claims = {
    petitionerClaims: [],
    proceduralClaims: [],
    complianceStatements: [],
    departmentalActions: [],
  };

  const criminalCase = {
    psCaseNumber: pscase,
    policeStation: '',
    legalSections,
    firAllegations: [],
  };

  const structuredParagraphs = paragraphs.map((para, index) => {
    const categories = classifyParagraph(para.text);
    const speaker = inferSpeaker(para.text);
    const claimType = inferClaimType(categories, para.text);
    const reply = recommendedReply(categories, claimType);
    const paragraphEntities = extractEntities(para.text);
    const sourceTrace = {
      document: sourceDocument || fileName || 'document',
      page: pageHint || null,
      paragraph: para.paraNo,
      confidence: categories.includes('factual_narration') ? 0.7 : 0.85,
    };

    const record = {
      paraNo: para.paraNo,
      text: para.text,
      category: categories[0] || 'factual_narration',
      speaker,
      entities: paragraphEntities,
      claimTypes: categories,
      recommendedReplyStrategy: reply,
      sourceTrace,
    };

    if (speaker === 'petitioner' && (categories.includes('allegation') || categories.includes('innocence_claim') || categories.includes('procedural_claim') || categories.includes('clean_antecedent_claim') || categories.includes('false_implication_claim'))) {
      claims.petitionerClaims.push({
        claimId: `claim_${index + 1}`,
        claimType,
        speaker: 'PETITIONER',
        claimText: para.text,
        sourceTrace,
        recommendedReply: reply,
        supportingFacts: [],
        riskLevel: categories.includes('allegation') ? 'high' : 'medium',
      });
    }

    if (categories.includes('procedural_claim') || categories.includes('section_41a_argument') || categories.includes('arnesh_kumar_argument')) {
      claims.proceduralClaims.push({
        claimId: `claim_${index + 1}_proc`,
        claimType,
        speaker,
        claimText: para.text,
        sourceTrace,
        recommendedReply: reply,
        supportingFacts: [],
        riskLevel: 'medium',
      });
    }

    if (categories.includes('compliance_statement')) {
      claims.complianceStatements.push({
        claimId: `claim_${index + 1}_comp`,
        claimType,
        speaker,
        claimText: para.text,
        sourceTrace,
        recommendedReply: reply,
        supportingFacts: [],
        riskLevel: 'low',
      });
    }

    if (categories.includes('departmental_action')) {
      claims.departmentalActions.push({
        claimId: `claim_${index + 1}_dept`,
        claimType: 'DEPARTMENTAL_ACTION',
        speaker,
        claimText: para.text,
        sourceTrace,
        recommendedReply: reply,
        supportingFacts: [],
        riskLevel: 'low',
      });
    }

    if (categories.includes('allegation') && /fir|police|intimidat|threat|assault|forged|illegal|trespass|recovery/i.test(para.text)) {
      criminalCase.firAllegations.push({
        text: para.text,
        sourceParagraph: para.paraNo,
        sourceDocument: sourceDocument || fileName || 'document',
      });
    }

    return record;
  });

  const statementOfFacts = String(scanResults?.summary || '').trim()
    ? [String(scanResults.summary).trim()]
    : structuredParagraphs
        .filter((p) => p.category === 'factual_narration')
        .map((p) => p.text);

  return {
    caseMetadata,
    parties,
    criminalCase,
    governmentReferences,
    claims,
    statementOfFacts,
    paragraphs: structuredParagraphs,
    claimGraph: [...claims.petitionerClaims, ...claims.proceduralClaims, ...claims.complianceStatements, ...claims.departmentalActions],
    sourceTraceability: {
      sourceDocument: sourceDocument || fileName || 'document',
      sourcePage: pageHint || null,
      sourceParagraphCount: structuredParagraphs.length,
      confidence: sourceText ? 0.9 : 0.0,
    },
  };
}

export { CLAIM_REPLIES, classifyParagraph, splitParagraphs, extractMemoRefs };

export default {
  analyzeLegalIntelligence,
  CLAIM_REPLIES,
  classifyParagraph,
  splitParagraphs,
  extractMemoRefs,
};