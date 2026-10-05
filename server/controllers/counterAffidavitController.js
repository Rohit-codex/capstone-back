import File from '../models/File.js';
import { callLLM } from '../utils/llmUtils.js';
import { AppError } from '../utils/errors.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import { generatePdf } from '../services/pdfGenerationService.js';
import EditSession from '../models/EditSession.js';
import { writeDocxFromText } from '../utils/docxWriter.js';
import { uploadToCloudinaryWithRetry } from '../utils/fileHandler.js';
import { docxToHtml } from '../utils/docxFormatExtractor.js';
import {
  buildCounterAffidavitDocxHtml,
  buildCounterAffidavitExportHtml,
  buildCounterAffidavitSimpleHtml,
} from '../utils/counterAffidavitExportHtml.js';
import {
  getPdfPageCount,
  renderPdfPagesAsDataUrls,
} from '../utils/counterAffidavitPdfAnnexures.js';
import {
  autofillCounterDataFromScan,
  collectCaptionFromSources,
  extractCaseNumberFromText,
  extractCaptionPartiesFromText,
  detectCounterProcedureKind,
  isBlankCounterField,
  mergePartiesRecords,
  sanitizePartyNameForCaption,
  isValidCaptionPartyName,
  getCaptionSnippetForLlm,
} from '../utils/counterAffidavitAutofill.js';
import {
  listCounterAffidavitDesigns,
  resolveCounterDesignId,
  suggestCounterDesignId,
} from '../utils/counterAffidavitDesigns.js';
import { analyzeLegalIntelligence } from '../utils/legalIntelligenceAnalyzer.js';
import {
  enrichAnnexuresFromUploads,
  nextAnnexureLetter,
  pageRangeFromCount,
} from '../utils/counterAnnexureEnrich.js';
import HTMLtoDOCX from 'html-to-docx';
import fetch from 'node-fetch';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLOUDINARY_DISABLED = process.env.CLOUDINARY_DISABLE === 'true';
const require = createRequire(import.meta.url);

const readSourceFileBytes = async (file) => {
  const fileUrl = String(file.fileUrl || '').trim();
  const filePath = file.localPath
    || (!/^https?:\/\//i.test(fileUrl) && fileUrl
      ? path.join(__dirname, '..', fileUrl.replace(/^\/+/, ''))
      : null);

  let buffer = null;
  if (filePath && fs.existsSync(filePath)) {
    buffer = fs.readFileSync(filePath);
  } else if (/^https?:\/\//i.test(fileUrl)) {
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new AppError(`Failed to fetch source file (${response.status})`, 404);
    }
    const arr = await response.arrayBuffer();
    buffer = Buffer.from(arr);
  }

  if (!buffer) {
    throw new AppError('File not found or no text available', 404);
  }

  const ext = path.extname(file.fileName || filePath || '').toLowerCase();
  return { buffer, ext, filePath };
};

const extractTextFromFile = async (file) => {
  if (file.extractedText) return file.extractedText;
  const { buffer, ext } = await readSourceFileBytes(file);
  if (ext === '.txt') return buffer.toString('utf-8');
  if (ext === '.docx') {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }
  if (ext === '.pdf') {
    const pdfModule = require('pdf-parse');
    const PDFParse = pdfModule?.PDFParse;
    if (typeof PDFParse !== 'function') {
      throw new AppError('PDF text extraction is unavailable', 500);
    }
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const data = await parser.getText();
      return String(data?.text || '').trim();
    } finally {
      await parser.destroy().catch(() => {});
    }
  }
  throw new AppError('Unsupported file format for text extraction', 400);
};

const buildGroundsFromLegalIntelligence = (legalIntelligence = {}, fallback = {}) => {
  const claimSource = Array.isArray(legalIntelligence?.claimGraph) && legalIntelligence.claimGraph.length > 0
    ? legalIntelligence.claimGraph
    : Array.isArray(legalIntelligence?.paragraphs)
      ? legalIntelligence.paragraphs
      : [];

  const grounds = claimSource
    .map((item, index) => {
      const paraNo = Number(item?.sourceTrace?.paragraph || item?.paraNo || index + 1) || index + 1;
      const claim = String(item?.claimText || item?.text || '').trim();
      if (!claim) return null;
      return {
        paraNo,
        claim,
        provision: String(item?.claimType || (Array.isArray(item?.claimTypes) ? item.claimTypes.join(', ') : '') || '').trim(),
        relief: String(item?.relief || item?.requestedRelief || '').trim(),
        sourceTrace: item?.sourceTrace || null,
        recommendedReply: item?.recommendedReply || item?.recommendedReplyStrategy || null,
      };
    })
    .filter(Boolean)
    .slice(0, 40);

  return {
    petitionerName: String(fallback.petitionerName || legalIntelligence?.parties?.petitioners?.[0]?.name || '').trim(),
    respondentName: String(fallback.respondentName || legalIntelligence?.parties?.respondents?.[0]?.name || legalIntelligence?.parties?.department || '').trim(),
    caseNumber: String(fallback.caseNumber || legalIntelligence?.caseMetadata?.caseNumber || '').trim(),
    court: String(fallback.court || legalIntelligence?.caseMetadata?.courtName || '').trim(),
    grounds,
  };
};

const buildGroundsFromRawText = (rawText = '', fallback = {}) => {
  const paragraphs = String(rawText || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 60);

  return {
    petitionerName: String(fallback.petitionerName || '').trim(),
    respondentName: String(fallback.respondentName || '').trim(),
    caseNumber: String(fallback.caseNumber || '').trim(),
    court: String(fallback.court || '').trim(),
    grounds: paragraphs.map((text, index) => ({
      paraNo: index + 1,
      claim: text,
      provision: '',
      relief: '',
      sourceTrace: { source: 'raw-text-fallback', paragraph: index + 1 },
      recommendedReply: 'MATTER_OF_RECORD',
    })),
  };
};

const isMjcProcedure = (documentType = '', caseNumber = '') => {
  const blob = `${documentType} ${caseNumber}`.toLowerCase();
  return /\bmjc\b|miscellaneous\s*jurisdiction\s*case|show\s*cause/i.test(blob);
};

const applyCounterFilingSemantics = (counterData, { documentType, scanSession, counterParsed, mergedCaption }) => {
  const cd = { ...counterData };
  const ep = scanSession?.extractedParties && typeof scanSession.extractedParties === 'object'
    ? scanSession.extractedParties
    : {};
  const opNo = String(
    counterParsed?.oppositePartyNo ||
    counterParsed?.counterFilingParty?.oppositePartyNo ||
    ep.oppositePartyNo ||
    ep.opNo ||
    ep.opNumber ||
    ''
  ).trim();

  cd.counterFilingSide = 'opposite_party';
  if (opNo) {
    cd.showCauseOnBehalfOfOpNo = opNo;
    cd.oppositePartyNo = opNo;
  }

  const bailKind = detectCounterProcedureKind(
    `${documentType} ${cd.caseNumber || ''}`,
    documentType
  );
  if (bailKind === 'bail_application') {
    cd.procedureKind = 'bail_application';
    cd.jurisdictionLine = cd.jurisdictionLine || '(Criminal Jurisdiction)';
    if (!String(cd.documentTitle || '').trim() || isBlankCounterField(cd.documentTitle)) {
      cd.documentTitle = 'Counter Affidavit on behalf of the State';
    }
  } else if (isMjcProcedure(documentType, cd.caseNumber)) {
    cd.procedureKind = 'mjc_show_cause';
    cd.jurisdictionLine = cd.jurisdictionLine || '(Miscellaneous Jurisdiction Case)';
    const opLabel = opNo || '___';
    if (!String(cd.documentTitle || '').trim()) {
      cd.documentTitle = `Show Cause on behalf of OP No. ${opLabel}`;
    }
  }

  const resp = String(cd.respondentName || mergedCaption?.respondentName || '').trim();
  if (resp && !Array.isArray(cd.respondentNames)) {
    const parts = resp.split(/\s*&\s*|\s*;\s*/).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) cd.respondentNames = parts;
  }

  return cd;
};

const attachSourceAnnexures = async (counterData, buffer, ext) => {
  const cd = { ...counterData };
  if (!buffer || ext !== '.pdf') return cd;

  const total = await getPdfPageCount(buffer);
  const embedCount = Math.min(4, Math.max(1, total || 1));
  const pages = Array.from({ length: embedCount }, (_, i) => i + 1);
  const images = await renderPdfPagesAsDataUrls(buffer, pages);

  if (images.length) {
    cd.sourcePageImages = images;
  }

  const annexures = Array.isArray(cd.annexureIndex) ? [...cd.annexureIndex] : [];
  const hasCaseCopy = annexures.some((a) => /^a$/i.test(String(a.letter || a.id || '')));
  if (!hasCaseCopy) {
    const range = embedCount > 1 ? `1-${embedCount}` : '1';
    annexures.unshift({
      letter: 'A',
      description: `the case document / show cause record (${cd.caseNumber || 'as filed'})`,
      pageRange: total > embedCount ? `${range} (excerpt; full record ${total} pages)` : range,
    });
  }
  cd.annexureIndex = annexures;
  return cd;
};

const recoverJSON = (rawStr) => {
  if (!rawStr || typeof rawStr !== 'string') return null;
  let s = rawStr.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const objStart = s.indexOf('{');
  const arrStart = s.indexOf('[');
  const start = objStart !== -1 && (arrStart === -1 || objStart < arrStart) ? objStart : arrStart;
  if (start === -1) return null;
  if (start > 0) s = s.substring(start);
  try { return JSON.parse(s); } catch (_) {
    const lastBrace = s.lastIndexOf('}');
    if (lastBrace > 0) {
      let candidate = s.substring(0, lastBrace + 1);
      if (s.startsWith('[')) candidate += ']';
      try { return JSON.parse(candidate); } catch (__) {
        candidate = candidate.replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(candidate); } catch (___) { return null; }
      }
    }
    return null;
  }
};

const normalizeCounterDraft = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;
  const draft = Array.isArray(parsed.counterDraft)
    ? parsed.counterDraft
        .filter((item) => item && (item.counterArgument || item.supportingLaw))
        .map((item, index) => ({
          paraNo: Number(item.paraNo) || index + 1,
          petitionParaNo: Number(item.petitionParaNo ?? item.paraNo) || index + 1,
          stance: String(item.stance || 'deny').trim().toLowerCase(),
          counterArgument: String(item.counterArgument || '').trim(),
          supportingLaw: String(item.supportingLaw || '').trim(),
        }))
        .filter((item) => item.counterArgument)
    : [];

  let statementOfFacts = [];
  if (Array.isArray(parsed.statementOfFacts)) {
    statementOfFacts = parsed.statementOfFacts.map((item) => String(item || '').trim()).filter(Boolean);
  } else if (parsed.statementOfFacts != null && String(parsed.statementOfFacts).trim()) {
    statementOfFacts = String(parsed.statementOfFacts)
      .split(/\n+/)
      .map((line) => line.replace(/^\d+[\).\s]+/, '').trim())
      .filter(Boolean);
  }

  let statementOfAdditionalFacts = [];
  if (Array.isArray(parsed.statementOfAdditionalFacts)) {
    statementOfAdditionalFacts = parsed.statementOfAdditionalFacts.map((item) => String(item || '').trim()).filter(Boolean);
  }

  const annexureIndex = Array.isArray(parsed.annexureIndex)
    ? parsed.annexureIndex
      .map((a) => ({
        letter: String(a?.letter || a?.id || 'A').trim(),
        description: String(a?.description || a?.particulars || '').trim(),
        pageRange: String(a?.pageRange || a?.page || '').trim(),
      }))
      .filter((a) => a.description || a.pageRange)
    : [];

  let defenceSection = [];
  if (Array.isArray(parsed.defenceSection)) {
    defenceSection = parsed.defenceSection.map((item) => String(item || '').trim()).filter(Boolean);
  } else if (parsed.defenceSection != null && String(parsed.defenceSection).trim()) {
    defenceSection = String(parsed.defenceSection)
      .split(/\n{2,}|\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } else if (parsed.defence != null && String(parsed.defence).trim()) {
    defenceSection = String(parsed.defence)
      .split(/\n{2,}|\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  let introductoryParagraphs = [];
  if (Array.isArray(parsed.introductoryParagraphs)) {
    introductoryParagraphs = parsed.introductoryParagraphs.map((item) => String(item || '').trim()).filter(Boolean);
  }

  let closingParagraphs = [];
  if (Array.isArray(parsed.closingParagraphs)) {
    closingParagraphs = parsed.closingParagraphs.map((item) => String(item || '').trim()).filter(Boolean);
  }

  return {
    documentTitle: String(parsed.documentTitle || '').trim(),
    oppositePartyNo: String(
      parsed.oppositePartyNo ||
      parsed.counterFilingParty?.oppositePartyNo ||
      ''
    ).trim(),
    annexureIndex,
    defenceSection,
    deponentDetails: String(parsed.deponentDetails || '').trim(),
    preliminaryObjections: Array.isArray(parsed.preliminaryObjections)
      ? parsed.preliminaryObjections.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    statementOfFacts,
    statementOfAdditionalFacts,
    counterDraft: draft,
    prayer: String(parsed.prayer || '').trim(),
    verification: String(parsed.verification || '').trim(),
    draftText: String(parsed.draftText || '').trim(),
    introductoryParagraphs,
    closingParagraphs,
  };
};

const normalizeGroundsDraft = (parsed) => {
  if (!parsed || typeof parsed !== 'object') return null;
  const grounds = Array.isArray(parsed.grounds)
    ? parsed.grounds
        .map((item, index) => ({
          paraNo: Number(item?.paraNo) || index + 1,
          claim: String(item?.claim || '').trim(),
          provision: String(item?.provision || '').trim(),
          relief: String(item?.relief || '').trim(),
        }))
        .filter((item) => item.claim)
    : [];

  return {
    petitionerName: String(parsed.petitionerName || '').trim(),
    respondentName: String(parsed.respondentName || '').trim(),
    caseNumber: String(parsed.caseNumber || '').trim(),
    court: String(parsed.court || '').trim(),
    grounds,
  };
};

const parseGroundsResponse = async (rawResponse, context = {}) => {
  const direct = normalizeGroundsDraft(recoverJSON(rawResponse));
  if (direct?.grounds?.length) return direct;

  const cleanedRaw = String(rawResponse || '').trim();
  if (!cleanedRaw) return null;

  const repairPrompt = `Convert the following model output into ONE valid JSON object only.
Do not add explanation, markdown, or code fences.

Required shape:
{
  "petitionerName": "string",
  "respondentName": "string",
  "caseNumber": "string",
  "court": "string",
  "grounds": [
    { "paraNo": number, "claim": "string", "provision": "string", "relief": "string" }
  ]
}

Model output:
${cleanedRaw.substring(0, 12000)}
`;

  try {
    const repairedRaw = await callLLM(repairPrompt, { temperature: 0, maxTokens: 3500 });
    const repaired = normalizeGroundsDraft(recoverJSON(repairedRaw));
    if (repaired?.grounds?.length) return repaired;
  } catch (repairErr) {
    console.warn('[CounterAffidavit] Grounds repair failed:', repairErr?.message || repairErr, context);
  }

  return null;
};

const parseCounterResponse = async (rawResponse, context = {}) => {
  const direct = normalizeCounterDraft(recoverJSON(rawResponse));
  if (direct && (direct.counterDraft?.length || direct.introductoryParagraphs?.length || direct.defenceSection?.length)) return direct;

  const cleanedRaw = String(rawResponse || '').trim();
  if (!cleanedRaw) return null;

  const repairPrompt = `Convert the following model output into ONE valid JSON object only.
Do not add explanation, markdown, or code fences.

Required shape:
{
  "documentTitle": "string – e.g. Counter Affidavit on behalf of Respondent No. 1",
  "deponentDetails": "string – who is deposing, authority, familiarity with facts",
  "introductoryParagraphs": ["string - Unheaded numbered paragraphs before defence"],
  "preliminaryObjections": ["string"],
  "defenceSection": ["string"],
  "counterDraft": [
    { "paraNo": number, "petitionParaNo": number, "stance": "admit|deny|partly", "counterArgument": "string", "supportingLaw": "string" }
  ],
  "statementOfAdditionalFacts": ["string"],
  "closingParagraphs": ["string"],
  "prayer": "string",
  "verification": "string",
  "draftText": "string"
}

If any field is missing, infer it conservatively from the content.

Model output:
${cleanedRaw.substring(0, 12000)}
`;

  try {
    const repairedRaw = await callLLM(repairPrompt, { temperature: 0, maxTokens: 5000 });
    const repaired = normalizeCounterDraft(recoverJSON(repairedRaw));
    if (repaired && (repaired.counterDraft?.length || repaired.introductoryParagraphs?.length || repaired.defenceSection?.length)) return repaired;
  } catch (repairErr) {
    console.warn('[CounterAffidavit] Repair parse failed:', repairErr?.message || repairErr, context);
  }

  return null;
};

/**
 * Build a single string of available source text (petition grounds, scan summary, statutes, precedents)
 * used to conservatively verify whether an assertion in generated output is traceable to the record.
 */
const buildSourceCorpus = (groundsParsed, scanSession = {}, statutesContext = '', precedentsContext = '', sourceSummary = '') => {
  const parts = [];
  if (groundsParsed && Array.isArray(groundsParsed.grounds)) {
    parts.push(groundsParsed.grounds.map(g => String(g.claim || '')).join('\n'));
  }
  if (scanSession) {
    if (scanSession.extractedParties) parts.push(JSON.stringify(scanSession.extractedParties));
    if (scanSession.extractedDocumentFields) parts.push(JSON.stringify(scanSession.extractedDocumentFields));
    if (scanSession.scanResults && scanSession.scanResults.summary) parts.push(String(scanSession.scanResults.summary));
  }
  if (statutesContext) parts.push(String(statutesContext));
  if (precedentsContext) parts.push(String(precedentsContext));
  if (sourceSummary) parts.push(String(sourceSummary));
  return parts.join('\n').toLowerCase();
};

/**
 * Extract memo numbers, letter dates, annexure labels and simple admin refs from plain text.
 * Returns array of { memo, date, context } where memo is the memo/letter reference found.
 */
const extractMemoRefs = (plainText = '') => {
  if (!plainText || typeof plainText !== 'string') return [];
  const out = [];
  // Patterns: Memo No. 871 dated 03.08.2022 ; Memo No: 871/EDU/2022 dated 03-08-2022
  const memoRe = /memo\s*(?:no\.?|no:|no)\s*[:\/-]?\s*([A-Za-z0-9\-/\\.]{2,80})(?:[,\s]*dated\s*([0-3]?\d[\.\/\-][01]?\d[\.\/\-]\d{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2}))?/gi;
  let m;
  while ((m = memoRe.exec(plainText)) !== null) {
    out.push({ memo: (m[1] || '').trim(), date: (m[2] || '').trim(), context: plainText.substring(Math.max(0, m.index - 80), Math.min(plainText.length, m.index + 120)).replace(/\n/g, ' ').trim() });
  }
  // Letter dated 24.03.2020 patterns
  const letterRe = /(letter\s*(?:no\.?\s*[:\-]?\s*[A-Za-z0-9\-/\\.]{1,60})?\s*(?:dated|dt\.|dtd)\s*([0-3]?\d[\.\/\-][01]?\d[\.\/\-]\d{2,4}|[0-9]{4}-[0-9]{2}-[0-9]{2}))/gi;
  while ((m = letterRe.exec(plainText)) !== null) {
    out.push({ memo: (m[1] || '').trim(), date: (m[2] || '').trim(), context: plainText.substring(Math.max(0, m.index - 80), Math.min(plainText.length, m.index + 120)).replace(/\n/g, ' ').trim() });
  }
  // Annexure labels: Annexure A/B, Annexure-1 etc.
  const annexRe = /(annexure\s*[-:]?\s*[A-Za-z0-9]{1,6})/gi;
  while ((m = annexRe.exec(plainText)) !== null) {
    out.push({ memo: (m[1] || '').trim(), date: '', context: plainText.substring(Math.max(0, m.index - 80), Math.min(plainText.length, m.index + 120)).replace(/\n/g, ' ').trim() });
  }
  // Deduplicate by memo+date
  const seen = new Set();
  return out.filter((r) => {
    const k = `${r.memo}::${r.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

const buildProsecutionRebuttal = (petitionClaim = '', paraNo = null) => {
  const claim = String(petitionClaim || '').trim().toLowerCase();
  const paraText = paraNo ? ` in paragraph ${paraNo}` : '';

  const rules = [
    {
      test: /clean antecedent|clean antecedents|no criminal antecedent|no criminal antecedents/,
      text: `The submissions regarding clean antecedents are not admitted and are subject to the record available before the department${paraText}.`,
    },
    {
      test: /willing to cooperate|cooperate|cooperation/,
      text: `The submissions regarding cooperation are matters for consideration during the course of investigation and further proceedings${paraText}.`,
    },
    {
      test: /false implication|falsely implicated|false case/,
      text: `The allegation of false implication is denied and the matter requires appreciation of the record and departmental materials${paraText}.`,
    },
    {
      test: /\bcustody\s+period\b|\bin\s+custody\b/i,
      text: `The custody period, if any, is a matter of record and is to be considered on the basis of the case diary and available materials${paraText}.`,
    },
    {
      test: /no evidence|lack of evidence|nothing on record/,
      text: `The assertion that there is no evidence is not admitted. The record, as available, is required to be considered by this Hon'ble Court${paraText}.`,
    },
    {
      test: /arnesh kumar|41a|section 41a|s\.? 41a/,
      text: `The submissions with respect to procedural compliance are matters for the Court to consider on the basis of the record and the applicable legal position${paraText}.`,
    },
    {
      test: /cooperate with investigation|join investigation|investigation/,
      text: `The aspect of joining investigation, if relevant, is to be assessed in light of the materials on record and the progress noted by the department${paraText}.`,
    },
  ];

  for (const rule of rules) {
    if (rule.test.test(claim)) return rule.text;
  }

  if (!claim) {
    return `The contents of the paragraph are denied to the extent they are inconsistent with the record${paraText}.`;
  }

  return `The submissions made in paragraph${paraText ? paraText : ''} are not admitted in the manner stated and are required to be read in conjunction with the record and the departmental materials available on file.`;
};

/**
 * Sanitize and ground parsed counter output:
 * - Ground each para-wise reply to the petition claim (prepend short excerpt)
 * - Remove supportingLaw entries not found in precedents/context
 * - Redact dangerous/unverified assertions (criminal antecedents, convictions, absconding, tampering, recoveries)
 */
const sanitizeCounterParsed = (counterParsed, groundsParsed, { scanSession = null, statutesContext = '', precedentsContext = '', sourceSummary = '' } = {}) => {
  if (!counterParsed || typeof counterParsed !== 'object') return counterParsed;

  const corpus = buildSourceCorpus(groundsParsed, scanSession, statutesContext, precedentsContext, sourceSummary);

  const bannedPhrases = [
    'habitual offender', 'convicted', 'conviction', 'abscond', 'absconding', 'non-cooperation',
    'tamper', 'tampering', 'witness tamper', 'witnesses tamper', 'recovery', 'police found', 'police recovered'
  ];

  const containsInCorpus = (text) => {
    if (!text) return false;
    try {
      return corpus.indexOf(String(text).toLowerCase()) !== -1;
    } catch {
      return false;
    }
  };

  const safeCounter = { ...counterParsed };

  // Ground para-wise replies to the petition claim where possible
  if (Array.isArray(safeCounter.counterDraft)) {
    safeCounter.counterDraft = safeCounter.counterDraft.map((item) => {
      const pNo = Number(item.petitionParaNo ?? item.paraNo) || null;
      let petitionClaim = '';
      if (groundsParsed && Array.isArray(groundsParsed.grounds) && pNo) {
        const match = groundsParsed.grounds.find((g) => Number(g.paraNo) === Number(pNo));
        petitionClaim = String(match?.claim || '').trim();
      }

      let counterArgument = String(item.counterArgument || '').trim();
      const rebuttalLead = buildProsecutionRebuttal(petitionClaim, pNo);
      const lowerCounter = counterArgument.toLowerCase();
      const lowerClaim = String(petitionClaim || '').toLowerCase();

      // Replace any direct echo of the petition claim with a transformed rebuttal.
      if (!counterArgument) {
        counterArgument = rebuttalLead;
      } else if (lowerClaim && lowerCounter.includes(lowerClaim)) {
        counterArgument = rebuttalLead;
      } else {
        const sentence = counterArgument.replace(/\s+/g, ' ').trim();
        counterArgument = `${rebuttalLead} ${sentence}`.trim();
      }

      let supportingLaw = String(item.supportingLaw || '').trim();
      if (supportingLaw && !containsInCorpus(supportingLaw)) {
        supportingLaw = ''; // avoid inventing citations
      }

      // redact banned phrases not present in corpus
      bannedPhrases.forEach((ph) => {
        const re = new RegExp(ph, 'gi');
        if (!containsInCorpus(ph) && re.test(counterArgument)) {
          counterArgument = counterArgument.replace(re, '[ASSERTION REMOVED - NOT IN RECORD]');
        }
        if (!containsInCorpus(ph) && re.test(supportingLaw)) {
          supportingLaw = supportingLaw.replace(re, '');
        }
      });

      return {
        ...item,
        paraNo: Number(item.paraNo) || pNo || null,
        petitionParaNo: pNo,
        counterArgument: counterArgument.trim(),
        supportingLaw: supportingLaw.trim(),
      };
    });
  }

  // Sanitize other arrays/text fields to remove unverified criminal-type assertions
  const sanitizeArrayField = (arr) => {
    if (!Array.isArray(arr)) return arr || [];
    return arr.map((s) => {
      let t = String(s || '').trim();
      bannedPhrases.forEach((ph) => {
        const re = new RegExp(ph, 'gi');
        if (!containsInCorpus(ph) && re.test(t)) {
          t = t.replace(re, '[ASSERTION REMOVED - NOT IN RECORD]');
        }
      });
      return t;
    }).filter(Boolean);
  };

  safeCounter.preliminaryObjections = sanitizeArrayField(safeCounter.preliminaryObjections);
  safeCounter.statementOfAdditionalFacts = sanitizeArrayField(safeCounter.statementOfAdditionalFacts);
  safeCounter.annexureIndex = Array.isArray(safeCounter.annexureIndex) ? safeCounter.annexureIndex : [];
  safeCounter.deponentDetails = String(safeCounter.deponentDetails || '').trim();
  bannedPhrases.forEach((ph) => {
    const re = new RegExp(ph, 'gi');
    if (!containsInCorpus(ph) && re.test(safeCounter.deponentDetails)) {
      safeCounter.deponentDetails = safeCounter.deponentDetails.replace(re, '[ASSERTION REMOVED - NOT IN RECORD]');
    }
  });

  // If draftText contains banned assertions, redact similarly
  let dt = String(safeCounter.draftText || '').trim();
  bannedPhrases.forEach((ph) => {
    const re = new RegExp(ph, 'gi');
    if (!containsInCorpus(ph) && re.test(dt)) {
      dt = dt.replace(re, '[ASSERTION REMOVED - NOT IN RECORD]');
    }
  });
  safeCounter.draftText = dt;

  return safeCounter;
};

const stripHtmlToText = (html = '') => {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
};

const listToBullets = (items = [], fallback = 'Nil') => {
  if (!Array.isArray(items) || items.length === 0) return fallback;
  return items.map((item) => `- ${String(item || '').trim()}`).join('\n');
};

const cleanPartyField = (val) => {
  if (val == null || val === '') return '';
  const cleaned = String(val)
    .replace(/_{3,}/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,./;:-]+|[\s,./;:-]+$/g, '')
    .trim();
  return cleaned.length > 2 ? cleaned : '';
};

/** Prefer petition extraction; fill caption from Smart Scan + legal intelligence + document text. */
const mergeCaptionFromScan = (groundsParsed, extractedParties, courtBody = '', extras = {}) =>
  collectCaptionFromSources({
    groundsParsed,
    extractedParties,
    courtBody,
    legalIntelligence: extras.legalIntelligence,
    scanResults: extras.scanResults,
    sessionText: extras.sessionText,
  });

/** Second-pass AI on caption only when Smart Scan / heuristics left party names empty or invalid. */
const enrichCaptionPartiesWithLlm = async (documentText, scanParties, mergedCaption, extras = {}) => {
  const needPet = !isValidCaptionPartyName(mergedCaption?.petitionerName);
  const needRes = !isValidCaptionPartyName(mergedCaption?.respondentName);
  if (!needPet && !needRes) {
    return { parties: scanParties || {}, caption: mergedCaption };
  }

  const snippet = getCaptionSnippetForLlm(documentText);
  if (snippet.length < 80) {
    return { parties: scanParties || {}, caption: mergedCaption };
  }

  const prompt = {
    system: 'You extract Indian court caption metadata. Return ONLY one valid JSON object. No markdown.',
    user: `From this document CAPTION / first page excerpt, extract:
{
  "petitioner": "full name of petitioner / applicant / accused seeking relief (NOT the police informant unless they are the petitioner)",
  "respondent": "State (e.g. The State of Bihar) or main opposite party",
  "court": "full court line starting with IN THE if present",
  "caseNumber": "exact case number as written",
  "jurisdictionLine": "parenthetical jurisdiction e.g. (Criminal Jurisdiction) or empty"
}

Rules:
- Copy EXACT party names from the caption; never return ".....Petitioner" or body/FIR text.
- For bail applications: petitioner is usually the accused applicant; respondent is usually The State of Bihar.
- If only dots before "Petitioner", look in the next 2 paragraphs for the named applicant/accused.
- Use "" for unknown fields.

EXCERPT:
${snippet}`,
  };

  const raw = await callLLM(prompt, { temperature: 0, maxTokens: 900 });
  const parsed = recoverJSON(raw);
  if (!parsed || typeof parsed !== 'object') {
    return { parties: scanParties || {}, caption: mergedCaption };
  }

  const parties = mergePartiesRecords(scanParties || {}, {
    petitioner: parsed.petitioner || parsed.petitionerName,
    respondent: parsed.respondent || parsed.respondentName,
    court: parsed.court,
    caseNumber: parsed.caseNumber,
    jurisdictionLine: parsed.jurisdictionLine,
  });

  const caption = collectCaptionFromSources({
    groundsParsed: mergedCaption,
    extractedParties: parties,
    courtBody: extras.court || mergedCaption?.court || '',
    legalIntelligence: extras.legalIntelligence,
    scanResults: extras.scanResults || {},
    sessionText: documentText,
  });

  console.log('[CounterAffidavit] Caption LLM enrich:', {
    petitioner: caption.petitionerName || '(empty)',
    respondent: caption.respondentName || '(empty)',
  });

  return { parties, caption };
};

const buildCounterDraftText = ({
  court = '',
  caseNumber = '',
  petitionerName = '',
  respondentName = '',
  documentType = '',
  documentTitle = '',
  deponentDetails = '',
  preliminaryObjections = [],
  counterDraft = [],
  statementOfAdditionalFacts = [],
  prayer = '',
  verification = '',
}) => {
  const paraWise = Array.isArray(counterDraft) && counterDraft.length > 0
    ? counterDraft
      .map((item) => {
        const pNo = item?.petitionParaNo ?? item?.paraNo ?? '';
        const stance = String(item?.stance || '').trim();
        const argument = String(item?.counterArgument || '').trim();
        const law = String(item?.supportingLaw || '').trim();
        return [
          `Reply to Petition Para ${pNo}${stance ? ` [${stance}]` : ''}`,
          argument,
          law ? `Supporting law: ${law}` : '',
        ].filter(Boolean).join('\n');
      })
      .join('\n\n')
    : 'Paragraph-wise reply will be added after review.';

  const additionalBlock =
    Array.isArray(statementOfAdditionalFacts) && statementOfAdditionalFacts.length > 0
      ? [
        'STATEMENT OF ADDITIONAL FACTS',
        statementOfAdditionalFacts.map((f, i) => `${i + 1}. ${String(f || '').trim()}`).join('\n'),
      ]
      : [];

  return [
    (court || 'IN THE HONOURABLE COURT').toUpperCase(),
    caseNumber || '',
    '',
    documentTitle || 'COUNTER AFFIDAVIT / COUNTER REPLY',
    documentType ? `In response to: ${documentType}` : '',
    '',
    petitionerName ? `${petitionerName} ... Petitioner` : 'Petitioner',
    'Versus',
    respondentName ? `${respondentName} ... Respondent(s)` : 'Respondent(s)',
    '',
    'DETAILS OF THE DEPONENT',
    deponentDetails || 'To be completed by counsel.',
    '',
    'PRELIMINARY OBJECTIONS',
    listToBullets(preliminaryObjections),
    '',
    'PARA-WISE REPLY',
    paraWise,
    '',
    ...additionalBlock,
    ...(additionalBlock.length ? [''] : []),
    'PRAYER',
    prayer || 'It is therefore respectfully prayed that the petition be dismissed, and such other order be passed as this Hon\'ble Court may deem fit and proper in the facts and circumstances of the case.',
    '',
    'VERIFICATION',
    verification || 'Verified at the place and date mentioned in the affidavit that the contents above are true and correct to the best of my knowledge and belief.',
  ].filter(Boolean).join('\n');
};

const isPlaceholderText = (value) => isBlankCounterField(value);

const defaultCounterText = {
  documentTitle: 'Counter Affidavit on behalf of the Respondent(s)',
  deponentDetails: 'I, the deponent named below, do hereby solemnly affirm and state on oath that I am duly authorized to swear this affidavit and am fully acquainted with the facts and records of the case.',
  prayer: 'It is therefore respectfully prayed that this Hon\'ble Court may be pleased to dismiss the writ petition with costs and pass such further order(s) as may be deemed fit and proper in the facts and circumstances of the case.',
  verification: 'Verified at ____________ on this ______ day of ____________, 20____ that the contents of the above affidavit are true and correct to the best of my knowledge and belief and nothing material has been concealed therefrom.',
};

const buildExpandedReplyArgument = (item = {}, groundsParsed = null, index = 0) => {
  if (item.counterArgument && typeof item.counterArgument === 'string' && item.counterArgument.trim().length > 10) {
    return item.counterArgument.trim();
  }

  const petitionParaNo = Number(item.petitionParaNo ?? item.paraNo ?? index + 1) || index + 1;
  const petitionClaim = String(
    groundsParsed?.grounds?.find((g) => Number(g.paraNo) === petitionParaNo)?.claim ||
    item.petitionClaim ||
    item.claim ||
    ''
  ).trim();
  const leadIn = buildProsecutionRebuttal(petitionClaim, petitionParaNo);

  return [
    leadIn,
    `The respondent submits that the allegations in paragraph ${petitionParaNo} are not admitted except to the extent specifically and expressly stated in the record.`,
    `The petitioner has not demonstrated any legal or factual basis for drawing the broad inference suggested in that paragraph, and the said assertion is therefore denied.`,
    `The matter must be decided on the basis of the official record, the departmental materials, and the legal position applicable to the present case, and not on selective reading of isolated assertions.`,
    `The petitioner is put to strict proof of every allegation not specifically admitted herein, and the respondent reserves the right to rely upon the record and such further materials as may be permitted at the time of hearing.`,
  ].join(' ');
};

const buildStandardPreliminaryObjections = (counterParsed = {}, groundsParsed = null, meta = {}) => {
  return Array.isArray(counterParsed.preliminaryObjections) ? counterParsed.preliminaryObjections.filter(Boolean) : [];
};

const buildStandardAdditionalFacts = (counterParsed = {}, legalIntelligence = {}, sourceSummary = '') => {
  return Array.isArray(counterParsed.statementOfAdditionalFacts) ? counterParsed.statementOfAdditionalFacts.filter(Boolean) : [];
};

const normalizeForLength = (counterParsed = {}, groundsParsed = null, legalIntelligence = null, sourceSummary = '') => {
  const draft = Array.isArray(counterParsed.counterDraft) ? counterParsed.counterDraft : [];
  const grounds = Array.isArray(groundsParsed?.grounds) ? groundsParsed.grounds : [];
  const draftMap = new Map(draft.map((item) => [Number(item.petitionParaNo ?? item.paraNo), item]));

  const expandedDraftRaw = grounds.length
    ? grounds.map((g, index) => {
      const key = Number(g.paraNo) || index + 1;
      const existing = draftMap.get(key) || {};
      return {
        paraNo: Number(existing.paraNo) || key,
        petitionParaNo: key,
        stance: String(existing.stance || 'deny').trim() || 'deny',
        counterArgument: buildExpandedReplyArgument({ ...existing, petitionParaNo: key, claim: g.claim }, groundsParsed, index),
        supportingLaw: String(existing.supportingLaw || '').trim(),
      };
    })
    : draft.map((item, index) => ({
      ...item,
      paraNo: Number(item.paraNo) || Number(item.petitionParaNo) || index + 1,
      petitionParaNo: Number(item.petitionParaNo) || Number(item.paraNo) || index + 1,
      counterArgument: buildExpandedReplyArgument(item, groundsParsed, index),
    }));

  const seenPara = new Set();
  const expandedDraft = expandedDraftRaw.filter((item) => {
    const k = Number(item.petitionParaNo ?? item.paraNo);
    if (!k || seenPara.has(k)) return false;
    seenPara.add(k);
    return true;
  });

  const procedureMeta = {
    procedureKind: counterParsed.procedureKind || groundsParsed?.procedureKind || '',
    sourceDocumentType: counterParsed.sourceDocumentType || '',
  };

  const normalized = {
    ...counterParsed,
    counterDraft: expandedDraft.length ? expandedDraft : draft,
    preliminaryObjections: buildStandardPreliminaryObjections(counterParsed, groundsParsed, procedureMeta),
    statementOfAdditionalFacts: buildStandardAdditionalFacts(counterParsed, legalIntelligence || {}, sourceSummary),
  };

  return normalized;
};

const buildCounterDocxBuffer = async ({
  title,
  counterDraftText,
  counterData,
  language = 'en',
  court = '',
  designId,
}) => {
  try {
    const html = buildCounterAffidavitDocxHtml(counterData, { language, court, designId });
    const docxBuffer = await HTMLtoDOCX(
      html,
      null,
      {
        orientation: 'portrait',
        pageSize: { width: 11906, height: 16838 }, // A4
        margins: { top: 1200, right: 900, bottom: 1200, left: 900 },
        title: title || 'Counter Affidavit',
        font: 'Times New Roman',
        fontSize: 24,
        decodeUnicode: true,
      },
      null
    );
    if (Buffer.isBuffer(docxBuffer) && docxBuffer.length > 0) {
      return { buffer: docxBuffer, mode: 'html-design' };
    }
  } catch (err) {
    console.warn('[CounterAffidavit] HTML->DOCX conversion failed, using text fallback:', err?.message || err);
  }

  const { filePath } = await writeDocxFromText(
    counterDraftText,
    title,
    'uploads/generated',
    null,
    true
  );
  const fallbackBuffer = fs.readFileSync(filePath);
  return { buffer: fallbackBuffer, mode: 'plain-text' };
};

const primeGeneratedCounterDoc = async ({
  userId,
  sourceFileId,
  title,
  counterDraftText,
  counterData,
  language,
  court,
  scanResults,
  designId,
}) => {
  const { buffer: docxBuffer, mode } = await buildCounterDocxBuffer({
    title,
    counterDraftText,
    counterData,
    language,
    court,
    designId,
  });
  const fileNameSafe = String(title || 'Counter Affidavit')
    .replace(/[^\w\s.-]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .toLowerCase()
    .substring(0, 80) || 'counter_affidavit';
  const generatedDir = path.join(__dirname, '..', 'uploads', 'generated');
  if (!fs.existsSync(generatedDir)) fs.mkdirSync(generatedDir, { recursive: true });
  const filePath = path.join(generatedDir, `${fileNameSafe}_${Date.now()}.docx`);
  fs.writeFileSync(filePath, docxBuffer);
  const fileSize = fs.statSync(filePath).size;
  const uploadPayload = {
    originalname: path.basename(filePath),
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxBuffer,
    size: fileSize,
  };
  const uploadResult = await uploadToCloudinaryWithRetry(uploadPayload, 'chat-files');

  const generatedFile = new File({
    fileName: path.basename(filePath),
    fileType: uploadPayload.mimetype,
    fileSize,
    fileUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id,
    uploadedBy: userId,
  });
  await generatedFile.save();

  const docxHtml = await docxToHtml(docxBuffer);
  const extracted = stripHtmlToText(docxHtml) || counterDraftText;
  const session = new EditSession({
    userId,
    fileId: generatedFile._id,
    fileName: generatedFile.fileName,
    fileType: uploadPayload.mimetype,
    originalText: extracted,
    currentText: extracted,
    htmlContent: docxHtml || '',
    scanStatus: 'scanned',
    status: 'active',
    changes: [],
    undoPosition: -1,
    detectedDocType: 'Counter Affidavit',
    scanResults: {
      documentType: 'Counter Affidavit',
      sourceDocumentType: scanResults?.documentType || '',
      sourceFileId: String(sourceFileId || ''),
      title,
      generatedFrom: 'counter-affidavit',
      counterDocxMode: mode,
      counterDesignId: designId || '',
    },
    docxStatus: 'ready',
    docxFileUrl: generatedFile.fileUrl,
    docxHtml: docxHtml || '',
    docxError: '',
    docxUpdatedAt: new Date(),
    originalDocxPath: generatedFile.fileUrl,
  });
  await session.save();

  return {
    generatedFile,
    session,
    storageMode: CLOUDINARY_DISABLED ? 'local' : 'cloudinary',
  };
};

export const listCounterAffidavitDesignsEndpoint = async (req, res) => {
  try {
    const payload = listCounterAffidavitDesigns();
    res.json({ success: true, ...payload });
  } catch (err) {
    throw new AppError(err?.message || 'Counter designs unavailable', 500);
  }
};

export const generateCounterAffidavit = async (req, res) => {
  const {
    fileId,
    petitionText,
    court,
    language,
    createEditableDocument = false,
    designId: requestedDesignId,
    simplePreview = false,
    counterMaker,
    defenceText,
    petitionSummary,
  } = req.body;

  let text = '';
  let sourceFile = null;
  let scanSession = null;

  if (fileId) {
    sourceFile = await File.findOne({ _id: fileId, uploadedBy: req.user.id });
    if (!sourceFile) throw new AppError('File not found', 404);
    text = await extractTextFromFile(sourceFile);
    scanSession = await EditSession.findOne({ fileId, userId: req.user.id, status: 'active' })
      .sort({ updatedAt: -1 })
      .lean();
    if (scanSession && text.length > 100) {
      const captionHeuristic = extractCaptionPartiesFromText(text);
      const mergedEp = mergePartiesRecords(scanSession.extractedParties || {}, captionHeuristic);
      scanSession = { ...scanSession, extractedParties: mergedEp };
    }
  } else if (petitionText && petitionText.trim().length > 20) {
    text = petitionText.trim();
  } else {
    throw new AppError('Provide either a fileId or petitionText', 400);
  }

  const langInstruction = language === 'hi'
    ? 'Respond in Hindi (Devanagari script).'
    : 'Respond in English.';

  const scanResults = scanSession?.scanResults || {};
  const documentType =
    scanResults?.documentType ||
    scanSession?.detectedDocType ||
    'Petition';
  let sourceBuffer = null;
  let sourceExt = '';
  if (sourceFile) {
    try {
      const loaded = await readSourceFileBytes(sourceFile);
      sourceBuffer = loaded.buffer;
      sourceExt = loaded.ext;
    } catch (loadErr) {
      console.warn('[CounterAffidavit] Source file bytes not loaded for annexures:', loadErr?.message || loadErr);
    }
  }

  const partiesContext = scanSession?.extractedParties
    ? JSON.stringify(scanSession.extractedParties, null, 2)
    : 'Not available';
  const extractedFieldsContext = Array.isArray(scanSession?.extractedDocumentFields)
    ? scanSession.extractedDocumentFields
      .slice(0, 20)
      .map((field) => `${field.label || field.key}: ${field.value || ''}`)
      .join('\n')
    : 'Not available';
  const statutesContext = Array.isArray(scanSession?.statutesReferenced)
    ? scanSession.statutesReferenced
      .slice(0, 10)
      .map((item) => `${item.name || ''} ${item.sections || ''}`.trim())
      .filter(Boolean)
      .join('\n')
    : 'Not available';
  const precedentsContext = [
    ...(Array.isArray(scanSession?.precedenceAnalysis) ? scanSession.precedenceAnalysis : []),
    ...(Array.isArray(scanSession?.aiSuggestedPrecedents) ? scanSession.aiSuggestedPrecedents : []),
  ]
    .slice(0, 8)
    .map((item) => `${item.caseName || ''} ${item.citation ? `(${item.citation})` : ''}`.trim())
    .filter(Boolean)
    .join('\n') || 'Not available';
  const sourceSummary = String(scanResults?.summary || '').trim() || 'Not available';

  const legalIntelligence = scanSession?.legalIntelligence && Object.keys(scanSession.legalIntelligence || {}).length > 0
    ? scanSession.legalIntelligence
    : analyzeLegalIntelligence({
      text,
      fileName: sourceFile?.fileName || 'petition text',
      scanResults,
      extractedParties: scanSession?.extractedParties || {},
      sourceDocument: sourceFile?.fileName || 'petition text',
    });

  const ep = scanSession?.extractedParties || {};
  const baseFallback = collectCaptionFromSources({
    groundsParsed: {},
    extractedParties: ep,
    courtBody: court,
    legalIntelligence,
    scanResults,
    sessionText: text,
  });
  if (!baseFallback.caseNumber) {
    baseFallback.caseNumber = extractCaseNumberFromText(text) || ep.caseNumber || '';
  }

  let groundsParsed = buildGroundsFromLegalIntelligence(legalIntelligence, baseFallback);

  if (!groundsParsed || !Array.isArray(groundsParsed.grounds) || groundsParsed.grounds.length === 0) {
    const sessionText = String(scanSession?.currentText || scanSession?.originalText || '').trim();
    const fallbackText = sessionText.length > 20 ? sessionText : text;
    groundsParsed = buildGroundsFromRawText(fallbackText, baseFallback);
  }

  if (!groundsParsed || !Array.isArray(groundsParsed.grounds) || groundsParsed.grounds.length === 0) {
    console.warn('[CounterAffidavit] Failed to build grounds from legal intelligence.');
    throw new AppError('Failed to extract petition grounds from structured analysis.', 422);
  }

  let scanParties = scanSession?.extractedParties || {};
  let mergedCaption = mergeCaptionFromScan(groundsParsed, scanParties, court, {
    legalIntelligence,
    scanResults,
    sessionText: text,
  });

  if (
    text.length > 200 &&
    (!isValidCaptionPartyName(mergedCaption.petitionerName) ||
      !isValidCaptionPartyName(mergedCaption.respondentName))
  ) {
    try {
      const enriched = await enrichCaptionPartiesWithLlm(text, scanParties, mergedCaption, {
        legalIntelligence,
        scanResults,
        court,
      });
      scanParties = enriched.parties;
      mergedCaption = enriched.caption;
      groundsParsed = {
        ...groundsParsed,
        petitionerName: mergedCaption.petitionerName || groundsParsed.petitionerName,
        respondentName: mergedCaption.respondentName || groundsParsed.respondentName,
        caseNumber: mergedCaption.caseNumber || groundsParsed.caseNumber,
        court: mergedCaption.court || groundsParsed.court,
      };
    } catch (capErr) {
      console.warn('[CounterAffidavit] Caption LLM enrich failed:', capErr?.message || capErr);
    }
  }

  const procedureKindEarly = detectCounterProcedureKind(text, documentType);

  const designId = resolveCounterDesignId(
    requestedDesignId ||
    suggestCounterDesignId(`${documentType} ${procedureKindEarly} ${mergedCaption.caseNumber || groundsParsed?.caseNumber || ''} ${text.slice(0, 500)}`)
  );

  const groundsSummary = groundsParsed.grounds
    .slice(0, 8)
    .map(g => `Para ${g.paraNo}: ${g.claim} [Strategy: ${g.recommendedReply || g.provision || 'None'}]`)
    .join('\n');

  const memoContext = Array.isArray(legalIntelligence?.governmentReferences?.memoNumbers) && legalIntelligence.governmentReferences.memoNumbers.length > 0
    ? legalIntelligence.governmentReferences.memoNumbers.map((r) => `${r.number}${r.date ? ` dated ${r.date}` : ''} — ${r.context || ''}`.trim()).join('\n')
    : 'Not available';

  const structuredIntelligenceContext = JSON.stringify({
    caseMetadata: legalIntelligence?.caseMetadata || {},
    parties: legalIntelligence?.parties || {},
    criminalCase: legalIntelligence?.criminalCase || {},
    governmentReferences: legalIntelligence?.governmentReferences || {},
    claimGraph: Array.isArray(legalIntelligence?.claimGraph) ? legalIntelligence.claimGraph.slice(0, 30) : [],
    sourceTraceability: legalIntelligence?.sourceTraceability || {},
  }, null, 2);
  // New strict SYSTEM_PROMPT + structured INPUT_JSON approach to reduce hallucination
  const SYSTEM_PROMPT = `You are a senior litigation draftsperson adopting the persona of counsel for the Patna High Court (Bihar). YOU MUST NEVER HALLUCINATE. All factual assertions (dates, memo numbers, names, recoveries, convictions, officer statements, citations) must be taken ONLY from the supplied INPUT_JSON. If a factual field is missing, insert the exact placeholder: [INSERT FROM RECORD]. Do NOT invent legal citations or departmental records. Do NOT copy petitioner prose verbatim into rebuttal paragraphs; convert petitioner text into a restrained, traceable reply and place any petitioner text only in the trace/source fields. Do not produce or request any tabular/parawise tables (no markdown tables, no CSV). Output MUST be exactly one valid JSON object and NOTHING else (no preamble, no explanation, no code fences). The JSON must match the required schema below exactly. Use short, formal, court-appropriate sentences; tone is restrained, administrative, and suitable for a Government Department respondent. Use English unless \`langInstruction\` says Hindi.`;

  const structuredPayload = {
    meta: {
      caseNumber: mergedCaption.caseNumber || groundsParsed.caseNumber || '',
      court: mergedCaption.court || court || '',
      petitionerName: mergedCaption.petitionerName || groundsParsed.petitionerName || '',
      respondentName: mergedCaption.respondentName || groundsParsed.respondentName || '',
      documentType,
      language: language || 'en',
    },
    Writ_Claims: Array.isArray(groundsParsed?.grounds)
      ? groundsParsed.grounds.map((g) => ({
          paraNo: Number(g.paraNo) || null,
          claimText: String(g.claim || '').trim(),
          provision: String(g.provision || '').trim(),
          relief: String(g.relief || '').trim(),
          sourceTrace: g.sourceTrace || null,
        }))
      : [],
    State_Defense_Facts: {
      caseMetadata: legalIntelligence?.caseMetadata || {},
      parties: legalIntelligence?.parties || {},
      claimGraph: Array.isArray(legalIntelligence?.claimGraph) ? legalIntelligence.claimGraph.slice(0, 50) : [],
      governmentReferences: legalIntelligence?.governmentReferences || {},
    },
    Counter_Maker_Details: counterMaker || '',
    Defence_Arguments_Provided_By_User: defenceText || '',
    Petition_Summary_Provided_By_User: petitionSummary || '',
    statutesContext: statutesContext || '',
    precedentsContext: precedentsContext || '',
    sourceSummary: sourceSummary || '',
    structuredIntelligenceContext,
    memoContext,
  };

  const promptObject = {
    system: SYSTEM_PROMPT,
    user: `INPUT_JSON:\n${JSON.stringify(structuredPayload, null, 2)}\n\nINSTRUCTIONS:\n- Use ONLY fields inside INPUT_JSON to support factual statements.\n- You MUST generate "deponentDetails" dynamically based ONLY on the details provided in Counter_Maker_Details. Start with "I, ". If only a name is provided, output exactly: "I, ${counterMaker || "_______"}, do hereby solemnly affirm and state as follows :-". Do NOT add blank lines or placeholders (like _____) for missing information. If age, gender, father's name, or address are provided in Counter_Maker_Details, format them properly. For example: "I, Rahul Kumar, Gender- Male, aged about 28 years, son of Manger Ram, Resident of Patna, do hereby solemnly affirm and state as follows :-". Counter_Maker_Details provided: "${counterMaker || "_______"}"\n- CRITICAL: Do NOT manually number any of your paragraphs (do not write "1.", "2.", "Para 1:", etc.). The system will automatically number them. Start every paragraph directly with the text, usually "That...".\n- You MUST generate "introductoryParagraphs" as an array of strings modeled on the following structure. Adapt the text naturally based on the provided inputs to sound like a professional High Court Counter Affidavit:\n  Para 1: "That presently I am posted as _________ [LEAVE THIS EXACTLY AS _________ for the designation, DO NOT put the person's name here] and as such I am well acquainted with the facts and circumstances of the case."\n  Para 2: "That I have been duly authorized by the competent authority to swear this instant counter affidavit on behalf of the respondent _________."\n  Para 3: "That I have gone through the contents of the present writ application and have fully understood the same."\n  Para 4: "That the petitioners have filed the present writ application under reply for a direction upon the Respondent authorities to _________________________." (CRITICAL: You MUST STRIP AWAY the initial generic legal fluff like "issue an appropriate writ/writs, order/orders, direction/directions for". Start EXACTLY at the core relief, e.g., "fixation of pension in revised rate...". However, you MUST copy the entire remainder of the relief exactly as provided by the user until the very end. Do NOT remove anything from the end, do NOT summarize, and do NOT cut it short. Extract this relief dynamically from Petition_Summary_Provided_By_User or Writ_Claims in INPUT_JSON. Do NOT use brackets).\n  Para 5: "That instead of giving a parawise reply to the instant writ application, the humble deponent is submitting a consolidated reply and craves leave to file a comprehensive affidavit if and when required or directed by the Hon'ble Court."\n  Para 6 (General Denial): "That without prejudice of generality of the statements made in this counter affidavit, each and every statements of fact made in the instant writ petition under reply is hereby denied except those which are expressly admitted hereinafter."\n  Para 7: "That the present writ application filed by the petitioner is not maintainable in the eyes of law as well as on fact and such the same is fit to be dismissed by this Hon'ble court."\n  Para 8: "That from the perusal of the writ petition it transpires that the petitioners have filed the present writ application mainly for _________________________." (Replace the underscore by writing a professional, legally appealing, and rigorous summary of the core issue and main defense based ONLY on Defence_Arguments_Provided_By_User).\n- CRITICAL: For "preliminaryObjections" and "statementOfAdditionalFacts", ONLY generate content if explicitly provided or strongly implied by Defence_Arguments_Provided_By_User. If there are no specific preliminary objections or additional facts, return empty arrays []. NEVER invent generic, repetitive filler paragraphs (e.g., "failed to establish prima facie case", "not produced material evidence").\n- CRITICAL: Draft a proper, clean, and chronologically clear factual narrative (Statement of Facts) based on sourceSummary and Petition_Summary_Provided_By_User. Do NOT just copy-paste the raw summary. Do NOT include the petitioner's prayer or relief sought in the Statement of Facts. Specifically, NEVER start the Statement of Facts with phrases like "That this writ petition is being filed for issuance of order/orders..." as that is petitioner language and belongs in Para 4. Rewrite the factual background into clear, professional, unnumbered paragraphs and place it in "statementOfFacts" as an array of strings.\n- Draft a proper factual narrative for defense based on Defence_Arguments_Provided_By_User and place it in "statementOfAdditionalFacts" as an array of paragraphs. Do NOT number them.\n- Generate the core defence and rebuttal points from Defence_Arguments_Provided_By_User and State_Defense_Facts into "defenceSection" as an array of paragraphs. Do NOT just copy the user input as is. Instead, enhance the sentences, making them highly formal, legally rigorous, and well-structured, as expected in a High Court counter affidavit. Do NOT number them.\n- You MUST generate "closingParagraphs" as an array of 3 strings modeled on the following structure. Do NOT number them:\n  Closing Para 1: "That I have gone through the contents of this counter affidavit and have fully understood the same."\n  Closing Para 2: "That the statement made in paragraph no. ______ are true to the best of my knowledge and those made in paragraph no. ______ are true to the best of my information derived from the records of the case and rest are by way of submission made before this Hon'ble court."\n  Closing Para 3: "That the annexure is the photo/true copy of it's original."\n- Do NOT invent facts, dates, memo numbers or citations.\n- Do not include petitioner raw paragraphs verbatim; transform into a traceable rebuttal.\n- Do NOT produce tables; return ONLY the single valid JSON object following the exact schema below.\n\nREQUIRED OUTPUT SCHEMA:\n{\n  "documentTitle": "string",\n  "oppositePartyNo": "string",\n  "annexureIndex": [],\n  "deponentDetails": "string",\n  "introductoryParagraphs": ["string"],\n  "preliminaryObjections": ["string"],\n  "defenceSection": ["string"],\n  "counterDraft": [\n    { "paraNo": 1, "petitionParaNo": 1, "stance": "deny", "counterArgument": "string", "supportingLaw": "string" }\n  ],\n  "statementOfFacts": ["string"],\n  "statementOfAdditionalFacts": ["string"],\n  "closingParagraphs": ["string"],\n  "prayer": "string",\n  "verification": "string",\n  "draftText": "string"\n}`,
  };

  const counterRaw = await callLLM(promptObject, { temperature: 0.0, maxTokens: 7000 });
  let counterParsed = await parseCounterResponse(counterRaw, { fileId, stage: 'counter' });

  // Sanitize and ground generated output — do not allow invented facts or citations.
  try {
    counterParsed = sanitizeCounterParsed(counterParsed, groundsParsed, { scanSession, statutesContext, precedentsContext, sourceSummary });
  } catch (sanErr) {
    console.warn('[CounterAffidavit] Sanitization failed:', sanErr?.message || sanErr);
  }

  counterParsed = {
    ...counterParsed,
    documentTitle: isPlaceholderText(counterParsed?.documentTitle) ? defaultCounterText.documentTitle : String(counterParsed.documentTitle || '').trim(),
    deponentDetails: isPlaceholderText(counterParsed?.deponentDetails) ? defaultCounterText.deponentDetails : String(counterParsed.deponentDetails || '').trim(),
    prayer: isPlaceholderText(counterParsed?.prayer) ? defaultCounterText.prayer : String(counterParsed.prayer || '').trim(),
    verification: isPlaceholderText(counterParsed?.verification) ? defaultCounterText.verification : String(counterParsed.verification || '').trim(),
  };

  counterParsed = {
    ...counterParsed,
    procedureKind: procedureKindEarly || counterParsed.procedureKind || '',
    sourceDocumentType: documentType,
  };
  counterParsed = normalizeForLength(counterParsed, groundsParsed, legalIntelligence, sourceSummary);

  if (!counterParsed || (!counterParsed.counterDraft?.length && !counterParsed.introductoryParagraphs?.length && !counterParsed.defenceSection?.length)) {
    console.warn('[CounterAffidavit] Failed to parse counter. Raw:', counterRaw?.substring(0, 300));
    throw new AppError('Failed to generate counter affidavit. Try again.', 422);
  }

  const draftTitle = [
    'Counter Affidavit',
    groundsParsed.caseNumber || '',
    groundsParsed.petitionerName || '',
  ].filter(Boolean).join(' - ').substring(0, 120);
  let counterDataForDesign = {
    petitionerName: mergedCaption.petitionerName || '',
    respondentName: mergedCaption.respondentName || '',
    caseNumber: mergedCaption.caseNumber || '',
    court: mergedCaption.court || court || '',
    sourceDocumentType: documentType,
    documentTitle: counterParsed.documentTitle || '',
    deponentDetails: counterParsed.deponentDetails || '',
    introductoryParagraphs: counterParsed.introductoryParagraphs || [],
    defenceSection: counterParsed.defenceSection || [],
    preliminaryObjections: counterParsed.preliminaryObjections || [],
    statementOfFacts: (counterParsed.statementOfFacts && counterParsed.statementOfFacts.length > 0)
      ? counterParsed.statementOfFacts
      : (sourceSummary && sourceSummary !== 'Not available' ? sourceSummary.split(/\n+/).map(s=>s.trim()).filter(Boolean) : []),
    statementOfAdditionalFacts: counterParsed.statementOfAdditionalFacts || [],
    counterDraft: counterParsed.counterDraft || [],
    prayer: counterParsed.prayer || '',
    verification: counterParsed.verification || '',
    closingParagraphs: counterParsed.closingParagraphs || [],
    oppositePartyNo: counterParsed.oppositePartyNo || '',
    annexureIndex: (counterParsed.annexureIndex || []).map(a => ({ ...a, page: '' })),
    jurisdictionLine: mergedCaption.jurisdictionLine || '',
    procedureKind: procedureKindEarly || '',
  };
  counterDataForDesign = applyCounterFilingSemantics(counterDataForDesign, {
    documentType,
    scanSession,
    counterParsed,
    mergedCaption,
  });
  counterDataForDesign = autofillCounterDataFromScan(counterDataForDesign, {
    scanSession,
    legalIntelligence,
    groundsParsed,
    mergedCaption,
  });
  counterDataForDesign = await attachSourceAnnexures(counterDataForDesign, sourceBuffer, sourceExt);
  const draftText = String(
    counterParsed.draftText ||
    buildCounterDraftText({
      court: mergedCaption.court || court || '',
      caseNumber: mergedCaption.caseNumber || '',
      petitionerName: mergedCaption.petitionerName || '',
      respondentName: mergedCaption.respondentName || '',
      documentType,
      documentTitle: counterParsed.documentTitle || '',
      deponentDetails: counterParsed.deponentDetails || '',
      preliminaryObjections: counterParsed.preliminaryObjections || [],
      counterDraft: counterParsed.counterDraft || [],
      statementOfAdditionalFacts: counterParsed.statementOfAdditionalFacts || [],
      prayer: counterParsed.prayer || '',
      verification: counterParsed.verification || '',
    })
  ).trim();

  let editableDocument = null;
  let previewHtml = '';
  const previewOpts = {
    language,
    court: mergedCaption.court || court || '',
    designId,
  };
  try {
    previewHtml = simplePreview !== false
      ? buildCounterAffidavitSimpleHtml(counterDataForDesign, previewOpts)
      : buildCounterAffidavitExportHtml(counterDataForDesign, previewOpts);
  } catch (previewErr) {
    console.warn('[CounterAffidavit] Preview HTML skipped:', previewErr?.message || previewErr);
  }

  if (createEditableDocument && fileId) {
    editableDocument = await primeGeneratedCounterDoc({
      userId: req.user.id,
      sourceFileId: fileId,
      title: draftTitle || 'Counter Affidavit',
      counterDraftText: draftText,
      counterData: counterDataForDesign,
      language,
      court: mergedCaption.court || court || '',
      scanResults: { documentType },
      designId,
    });
  }

  res.json({
    success: true,
    designId,
    designs: listCounterAffidavitDesigns().designs,
    previewHtml,
    petitionerName: counterDataForDesign.petitionerName || mergedCaption.petitionerName || '',
    respondentName: counterDataForDesign.respondentName || mergedCaption.respondentName || '',
    caseNumber: counterDataForDesign.caseNumber || mergedCaption.caseNumber || '',
    court: counterDataForDesign.court || mergedCaption.court || court || '',
    grounds: groundsParsed.grounds,
    documentTitle: counterDataForDesign.documentTitle || counterParsed.documentTitle || '',
    deponentDetails: counterDataForDesign.deponentDetails || counterParsed.deponentDetails || '',
    introductoryParagraphs: counterDataForDesign.introductoryParagraphs || counterParsed.introductoryParagraphs || [],
    defenceSection: counterDataForDesign.defenceSection || counterParsed.defenceSection || [],
    statementOfFacts: counterParsed.statementOfFacts || [],
    statementOfAdditionalFacts: counterParsed.statementOfAdditionalFacts || [],
    preliminaryObjections: counterDataForDesign.preliminaryObjections || counterParsed.preliminaryObjections || [],
    counterDraft: counterDataForDesign.counterDraft || counterParsed.counterDraft || [],
    prayer: counterDataForDesign.prayer || counterParsed.prayer || '',
    verification: counterDataForDesign.verification || counterParsed.verification || '',
    closingParagraphs: counterDataForDesign.closingParagraphs || counterParsed.closingParagraphs || [],
    draftText,
    sourceDocumentType: documentType,
    editorFileId: editableDocument?.generatedFile?._id || null,
    editorFileName: editableDocument?.generatedFile?.fileName || null,
    editorSessionId: editableDocument?.session?._id || null,
    editorFileUrl: editableDocument?.generatedFile?.fileUrl || null,
    oppositePartyNo: counterDataForDesign.oppositePartyNo || '',
    showCauseOnBehalfOfOpNo: counterDataForDesign.showCauseOnBehalfOfOpNo || '',
    annexureIndex: counterDataForDesign.annexureIndex || [],
    procedureKind: counterDataForDesign.procedureKind || '',
    jurisdictionLine: counterDataForDesign.jurisdictionLine || mergedCaption.jurisdictionLine || '',
  });
};

const enrichCounterDataWithSourceFile = async (counterData, fileId, userId) => {
  if (!counterData) return counterData;
  let data = { ...counterData };

  if (fileId && userId) {
    try {
      const scanSession = await EditSession.findOne({ fileId, userId, status: 'active' })
        .sort({ updatedAt: -1 })
        .lean();
      if (scanSession) {
        const mergedCaption = collectCaptionFromSources({
          groundsParsed: {
            petitionerName: data.petitionerName,
            respondentName: data.respondentName,
            caseNumber: data.caseNumber,
            court: data.court,
          },
          extractedParties: scanSession.extractedParties,
          courtBody: data.court,
          legalIntelligence: scanSession.legalIntelligence,
          scanResults: scanSession.scanResults,
          sessionText: scanSession.currentText || scanSession.originalText,
        });
        data = autofillCounterDataFromScan(data, {
          scanSession,
          legalIntelligence: scanSession.legalIntelligence,
          mergedCaption,
        });
      }
    } catch (scanErr) {
      console.warn('[CounterAffidavit] Scan autofill skipped:', scanErr?.message || scanErr);
    }
  }

  if (fileId && userId) {
    const sourceFile = await File.findOne({ _id: fileId, uploadedBy: userId });
    if (sourceFile) {
      try {
        const { buffer, ext } = await readSourceFileBytes(sourceFile);
        data = await attachSourceAnnexures(data, buffer, ext);
      } catch (err) {
        console.warn('[CounterAffidavit] Annexure attach skipped:', err?.message || err);
      }
    }
  }

  try {
    data = await enrichAnnexuresFromUploads(data, userId, readSourceFileBytes);
  } catch (err) {
    console.warn('[CounterAffidavit] User annexure enrich skipped:', err?.message || err);
  }
  return data;
};

/** Register an uploaded file as a counter annexure (description + page count for INDEX). */
export const registerCounterAnnexure = async (req, res) => {
  const fileId = String(req.body?.fileId || '').trim();
  const description = String(req.body?.description || '').trim();
  const existingRaw = req.body?.annexureIndex;

  if (!fileId) throw new AppError('fileId is required', 400);
  if (!description) throw new AppError('Please describe what this annexure is (for the INDEX table).', 400);

  const userId = req.user?.id;
  const file = await File.findOne({ _id: fileId, uploadedBy: userId });
  if (!file) throw new AppError('Uploaded file not found', 404);

  const existing = Array.isArray(existingRaw) ? existingRaw : [];
  const letter = nextAnnexureLetter(existing);
  const entry = {
    letter,
    description,
    fileId,
    fileName: file.fileName || '',
    userUploaded: true,
  };

  const tempData = { annexureIndex: [...existing, entry] };
  const enriched = await enrichAnnexuresFromUploads(tempData, userId, readSourceFileBytes);
  const annexureIndex = enriched.annexureIndex || [];
  const annexure = annexureIndex.find((a) => String(a.fileId) === fileId && String(a.letter) === letter)
    || annexureIndex[annexureIndex.length - 1]
    || entry;

  if (!annexure.pageRange) {
    const { buffer, ext } = await readSourceFileBytes(file);
    if (ext === '.pdf' && buffer?.length) {
      const total = await getPdfPageCount(buffer);
      if (total > 0) {
        annexure.pageRange = pageRangeFromCount(total);
        annexure.pageCount = total;
      }
    } else if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(ext)) {
      annexure.pageRange = '1';
      annexure.pageCount = 1;
    }
  }

  res.json({
    success: true,
    annexure,
    annexureIndex,
  });
};

export const previewCounterAffidavit = async (req, res) => {
  const {
    counterData,
    court,
    language,
    designId: requestedDesignId,
    simpleLayout = false,
    fileId,
  } = req.body;

  if (!counterData || typeof counterData !== 'object') {
    throw new AppError('counterData is required', 400);
  }

  let data = await enrichCounterDataWithSourceFile(counterData, fileId, req.user?.id);

  const designId = resolveCounterDesignId(
    requestedDesignId ||
    suggestCounterDesignId(`${data?.sourceDocumentType || ''} ${data?.caseNumber || ''}`)
  );
  const opts = {
    language,
    court: court || counterData.court || '',
    designId,
  };

  let previewHtml;
  try {
    previewHtml = simpleLayout === true
      ? buildCounterAffidavitSimpleHtml(data, opts)
      : buildCounterAffidavitExportHtml(data, opts);
  } catch (err) {
    console.error('[CounterAffidavit] Preview failed:', err?.message || err);
    throw new AppError('Counter affidavit preview template is unavailable.', 500);
  }

  res.json({ success: true, previewHtml, designId });
};

export const exportCounterAffidavit = async (req, res) => {
  const {
    counterData,
    format,
    court,
    language,
    designId: requestedDesignId,
    editedHtml,
    simpleLayout = true,
    fileId,
  } = req.body;

  const edited = String(editedHtml || '').trim();
  const wrapEditedFragment = (fragment) => {
    const inner = String(fragment || '').trim();
    if (!inner) return '';
    if (/^<!DOCTYPE/i.test(inner) || /<html[\s>]/i.test(inner)) return inner;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><style>
body{font-family:'Times New Roman',Times,serif;font-size:12pt;line-height:1.35;margin:2cm 2cm 6.35cm 2cm;}
.page-break,[data-type="page-break"]{page-break-after:always;break-after:page;height:0;margin:0;padding:0;border:0;}
</style></head><body>${inner}</body></html>`;
  };

  /** Client-edited HTML from TipTap (Counter Studio) — skip template rebuild. */
  if (edited.length > 80) {
    let html = wrapEditedFragment(edited);
    if (format === 'pdf') {
      try {
        const tmpDir = path.join(__dirname, '..', 'uploads', 'temp');
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
        const htmlPath = path.join(tmpDir, `counter_edited_${Date.now()}.html`);
        fs.writeFileSync(htmlPath, html);
        const pdfResult = await generatePdf({ htmlContent: html, designConfig: { pageSize: 'A4', margins: { top: 1440, right: 1440, bottom: 3600, left: 1440 } } });
        if (pdfResult && pdfResult.path && fs.existsSync(pdfResult.path)) {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'attachment; filename="counter_affidavit.pdf"');
          const stream = fs.createReadStream(pdfResult.path);
          stream.pipe(res);
          stream.on('end', () => {
            try { fs.unlinkSync(pdfResult.path); } catch (_) {}
          });
          return;
        }
      } catch (pdfErr) {
        console.warn('PDF generation failed for edited HTML, falling back to HTML:', pdfErr.message);
      }
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="counter_affidavit.html"');
    res.send(html);
    return;
  }

  if (!counterData || typeof counterData !== 'object') {
    throw new AppError('No counter affidavit data provided', 400);
  }

  const data = await enrichCounterDataWithSourceFile(counterData, fileId, req.user?.id);

  const designId = resolveCounterDesignId(
    requestedDesignId ||
    suggestCounterDesignId(`${data?.sourceDocumentType || ''} ${data?.caseNumber || ''}`)
  );

  let html;
  try {
    html = simpleLayout !== false
      ? buildCounterAffidavitSimpleHtml(data, { language, court, designId })
      : buildCounterAffidavitExportHtml(data, { language, court, designId });
  } catch (designErr) {
    console.error('[CounterAffidavit] Design load failed:', designErr?.message || designErr);
    throw new AppError('Counter affidavit export template is unavailable.', 500);
  }

  if (format === 'pdf') {
    try {
      const pdfResult = await generatePdf({ htmlContent: html, designConfig: { pageSize: 'A4', margins: { top: 1440, right: 1440, bottom: 3600, left: 1440 } } });
      if (pdfResult && pdfResult.path && fs.existsSync(pdfResult.path)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="counter_affidavit.pdf"');
        const stream = fs.createReadStream(pdfResult.path);
        stream.pipe(res);
        stream.on('end', () => {
          try { fs.unlinkSync(pdfResult.path); } catch (_) {}
        });
        return;
      }
    } catch (pdfErr) {
      console.warn('PDF generation failed, falling back to HTML:', pdfErr.message);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="counter_affidavit.html"');
  res.send(html);
};

export const chatEditCounterAffidavit = async (req, res) => {
  const { counterData, prompt } = req.body;
  if (!counterData || !prompt) {
    throw new AppError('counterData and prompt are required', 400);
  }
  const systemPrompt = `You are an AI legal assistant editing a Counter Affidavit JSON structure.
The user has provided a prompt to modify the document.
Apply the user's requested changes directly into the JSON and return ONLY the updated JSON.
Do not include any markdown formatting, just the raw JSON.

Current JSON:
${JSON.stringify(counterData)}
`;
  
  const response = await callLLM([{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], { temperature: 0.2 });
  
  let updatedData;
  try {
    const jsonStr = response.replace(/^[\s\S]*?(?=\{|\[)/, '').replace(/(?<=\}|\])[\s\S]*$/, '');
    updatedData = JSON.parse(jsonStr);
  } catch (err) {
    console.error('Failed to parse LLM response for chat edit:', err);
    throw new AppError('Failed to apply edits due to AI output format error.', 500);
  }
  
  res.json({ success: true, updatedData });
};
