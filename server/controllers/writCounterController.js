/**
 * writCounterController.js
 *
 * Scans an uploaded writ petition (PDF/DOCX/text) and generates a
 * court-ready counter affidavit specifically tailored to the writ type,
 * grounds, parties, and court — exactly matching the Patna HC style
 * seen in C.W.J.C. No. 5962/2023.
 *
 * Routes (add to draftRoutes.js):
 *   POST /api/drafts/writ-counter          — generate counter from fileId or pastedText
 *   POST /api/drafts/writ-counter/export   — export as DOCX / PDF / HTML
 *
 * Wire-up: see bottom of this file for the 2 lines to add to draftRoutes.js
 */

import File from '../models/File.js';
import { callLLM } from '../utils/llmUtils.js';
import { AppError } from '../utils/errors.js';
import EditSession from '../models/EditSession.js';
import { uploadToCloudinaryWithRetry } from '../utils/fileHandler.js';
import { docxToHtml } from '../utils/docxFormatExtractor.js';
import { buildCourtReadyDocx } from '../utils/courtReadyDocxBuilder.js';
import { buildCounterAffidavitExportHtml } from '../utils/counterAffidavitExportHtml.js';
import { generatePdf } from '../services/pdfGenerationService.js';
import mammoth from 'mammoth';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLOUDINARY_DISABLED = process.env.CLOUDINARY_DISABLE === 'true';
const require = createRequire(import.meta.url);

// ─── Writ type definitions ────────────────────────────────────────────────────
// Each writ type has specific constitutional basis, standard grounds,
// and standard counter arguments that apply generically.
const WRIT_TYPES = {
  habeas_corpus: {
    name: 'Habeas Corpus',
    articles: ['Article 21', 'Article 22', 'Article 226'],
    standardCounterGrounds: [
      'Detention is in accordance with procedure established by law',
      'Detenu has been produced before competent magistrate within 24 hours',
      'Grounds of detention have been duly communicated',
      'The detention order is based on sufficient material and is not arbitrary',
      'Alternative remedy by way of bail application has not been exhausted',
    ],
    standardPreliminaryObjections: [
      'The petition is not maintainable as the petitioner has an efficacious alternative remedy by way of regular bail application under Section 439 of the Bharatiya Nagarik Suraksha Sanhita, 2023 (erstwhile Section 439 CrPC)',
      'The petitioner has suppressed material facts regarding the nature of the offence and the evidence available',
    ],
  },
  mandamus: {
    name: 'Mandamus',
    articles: ['Article 226', 'Article 32'],
    standardCounterGrounds: [
      'No enforceable legal right exists in favour of the petitioner',
      'The authority has no corresponding legal duty to perform the act demanded',
      'The petitioner has not exhausted alternative remedies available under the statute',
      'The relief sought is discretionary and cannot be compelled by mandamus',
      'The authority has acted within its jurisdiction and in accordance with law',
    ],
    standardPreliminaryObjections: [
      'The petition is not maintainable as the petitioner has an efficacious alternative remedy under the relevant statute',
      'The petition is barred by delay and laches — the cause of action, if any, arose more than three years ago',
      'The petitioner lacks locus standi as no personal legal right has been infringed',
    ],
  },
  certiorari: {
    name: 'Certiorari',
    articles: ['Article 226', 'Article 32'],
    standardCounterGrounds: [
      'The impugned order has been passed by a competent authority with jurisdiction',
      'No error of law apparent on the face of the record exists',
      'Principles of natural justice have been fully complied with',
      'The order is based on relevant material and consideration of all facts',
      'Scope of judicial review is limited and does not extend to merits',
    ],
    standardPreliminaryObjections: [
      'The scope of certiorari is limited to jurisdictional errors and errors of law apparent on the face of record — re-appreciation of evidence is not permissible',
      'The petitioner has not availed of the statutory appellate remedy available',
      'The petition is barred by limitation — filed beyond the period prescribed',
    ],
  },
  prohibition: {
    name: 'Prohibition',
    articles: ['Article 226'],
    standardCounterGrounds: [
      'The tribunal/authority is acting within its jurisdiction',
      'No excess of jurisdiction is apparent',
      'The proceedings before the lower authority are valid and lawful',
      'Prohibition does not lie where no jurisdictional error is made out',
    ],
    standardPreliminaryObjections: [
      'The writ of prohibition does not lie as the authority is acting within its jurisdiction',
      'The petitioner has an adequate remedy by way of appeal/revision under the statute',
    ],
  },
  quo_warranto: {
    name: 'Quo Warranto',
    articles: ['Article 226'],
    standardCounterGrounds: [
      'The respondent holds office under valid and lawful authority',
      'The appointment was made in strict compliance with the relevant statute/rules',
      'All eligibility conditions prescribed by law were fulfilled at time of appointment',
      'The petitioner lacks locus standi — quo warranto is a public remedy and not available to a private litigant with no public interest',
    ],
    standardPreliminaryObjections: [
      'The petitioner has no locus standi to maintain quo warranto proceedings — no public interest is demonstrated',
      'The challenge to appointment is barred by delay and laches',
    ],
  },
  service_matter: {
    name: 'Service Matter / Writ of Mandamus',
    articles: ['Article 226', 'Article 14', 'Article 16'],
    standardCounterGrounds: [
      'The impugned order/action is based on documentary evidence and applicable service rules',
      'The authority has followed due process as prescribed under the relevant service rules',
      'Seniority has been determined in accordance with the applicable rules and government orders',
      'The petitioner has no vested right to a particular post or position',
      'The relief of mandamus cannot be granted to compel the government to alter a lawfully determined seniority',
    ],
    standardPreliminaryObjections: [
      'The petition is not maintainable as the petitioner has an efficacious alternative remedy before the appropriate service tribunal/administrative forum',
      'The petition is barred by delay and laches — the impugned order was passed years ago and has been acted upon',
      'The petitioner has suppressed material facts regarding the seniority dispute and the proceedings before the competent authority',
    ],
  },
  general_writ: {
    name: 'Writ Petition',
    articles: ['Article 226'],
    standardCounterGrounds: [
      'The impugned order/action is lawful and within jurisdiction',
      'All statutory requirements and procedures have been followed',
      'No fundamental right of the petitioner has been infringed',
      'The petitioner has an efficacious alternative remedy',
    ],
    standardPreliminaryObjections: [
      'The petition is not maintainable as the petitioner has an efficacious alternative remedy',
      'The petition is barred by delay and laches',
      'The petitioner has not made out a case for exercise of extraordinary writ jurisdiction',
    ],
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// TEXT EXTRACTION
// ═════════════════════════════════════════════════════════════════════════════

async function extractTextFromFile(file) {
  if (file.extractedText) return file.extractedText;

  const fileUrl = String(file.fileUrl || '').trim();
  const filePath = file.localPath
    || (!/^https?:\/\//i.test(fileUrl) && fileUrl
      ? (() => {
          const resolved = path.resolve(__dirname, '..', fileUrl.replace(/^\/+/, ''));
          const base = path.resolve(__dirname, '..');
          if (!resolved.startsWith(base + path.sep)) {
            throw new AppError('Invalid file path', 400);
          }
          return resolved;
        })()
      : null);
  let buffer = null;
  if (filePath && fs.existsSync(filePath)) {
    buffer = fs.readFileSync(filePath);
  } else if (/^https?:\/\//i.test(fileUrl)) {
    const response = await fetch(fileUrl);
    if (!response.ok) throw new AppError(`Failed to fetch file (${response.status})`, 404);
    buffer = Buffer.from(await response.arrayBuffer());
  }
  if (!buffer) throw new AppError('File not found or no text available', 404);

  const ext = path.extname(file.fileName || filePath || '').toLowerCase();
  if (ext === '.txt') return buffer.toString('utf-8');
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer })).value;
  if (ext === '.pdf') {
    const pdfModule = require('pdf-parse');
    const PDFParse = pdfModule?.PDFParse;
    if (typeof PDFParse !== 'function') throw new AppError('PDF extraction unavailable', 500);
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try { return String((await parser.getText())?.text || '').trim(); }
    finally { await parser.destroy().catch(() => {}); }
  }
  throw new AppError('Unsupported file format', 400);
}

// ═════════════════════════════════════════════════════════════════════════════
// JSON RECOVERY
// ═════════════════════════════════════════════════════════════════════════════

function recoverJSON(rawStr) {
  if (!rawStr || typeof rawStr !== 'string') return null;
  let s = rawStr.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  const start = (() => {
    const o = s.indexOf('{'); const a = s.indexOf('[');
    return o !== -1 && (a === -1 || o < a) ? o : a;
  })();
  if (start === -1) return null;
  if (start > 0) s = s.substring(start);
  try { return JSON.parse(s); } catch (_) {
    const last = s.lastIndexOf('}');
    if (last > 0) {
      let c = s.substring(0, last + 1);
      if (s.startsWith('[')) c += ']';
      try { return JSON.parse(c); } catch (__) {
        c = c.replace(/,\s*([}\]])/g, '$1');
        try { return JSON.parse(c); } catch (___) { return null; }
      }
    }
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 1: SCAN AND CLASSIFY THE WRIT
// ═════════════════════════════════════════════════════════════════════════════

async function scanWritPetition(petitionText) {
  const snippet = petitionText.length > 7000
    ? petitionText.substring(0, 4500) + '\n\n[...middle omitted...]\n\n' + petitionText.substring(petitionText.length - 2500)
    : petitionText;

  const prompt = `You are a senior Indian litigation lawyer with 25 years of experience at the Supreme Court and all High Courts. ${''/* no lang instruction — always English for scan */}

Read this writ petition carefully and extract all information with absolute precision.

DOCUMENT:
${snippet}

Return ONLY a valid JSON object, no markdown:
{
  "court": "string — full court name exactly as it appears e.g. 'High Court of Judicature at Patna'",
  "caseNumber": "string — full case number e.g. 'C.W.J.C. No. 5962 of 2023'",
  "jurisdiction": "string — e.g. 'Civil Writ Jurisdiction', 'Criminal Writ Jurisdiction'",
  "filingYear": "string — year of filing",
  "petitionerName": "string — full name(s) of petitioner(s) exactly as in cause title",
  "respondentName": "string — full name(s) of respondent(s) exactly as in cause title",
  "writType": "one of: habeas_corpus | mandamus | certiorari | prohibition | quo_warranto | service_matter | general_writ",
  "writTypeName": "string — human readable e.g. 'Writ of Mandamus under Article 226'",
  "articlesInvoked": ["string — each Constitutional Article e.g. 'Article 226', 'Article 14'"],
  "subjectMatter": "string — one sentence describing what the case is about",
  "impugnedOrder": "string — the specific order/action/omission being challenged including date and authority",
  "reliefSought": "string — the specific relief/direction sought by petitioner",
  "grounds": [
    {
      "paraNo": number,
      "claim": "string — precise statement of what petitioner asserts",
      "provision": "string — legal provision cited if any",
      "admissibility": "strong | moderate | weak"
    }
  ],
  "keyDates": ["string — each key date with event e.g. '20/02/2013 — impugned memo issued'"],
  "keyFacts": ["string — each critical undisputed or disputed fact"],
  "exhibitsReferenced": ["string — each annexure/exhibit mentioned"],
  "statutes": ["string — each statute/act cited by petitioner"],
  "petitionerArguments": "string — summary of petitioner's core argument in 3-4 sentences",
  "weaknessesInPetition": ["string — each identifiable weakness or vulnerability in the petition"],
  "deponentInfo": {
    "name": "string — name of person who should swear the counter affidavit (if inferable)",
    "designation": "string — designation e.g. 'District Programme Officer'",
    "district": "string — district name",
    "state": "string — state name"
  }
}`;

  const raw = await callLLM(prompt, { temperature: 0, maxTokens: 3000 });
  const parsed = recoverJSON(raw);

  if (!parsed || !parsed.court) {
    throw new AppError('Could not extract petition details. Please provide clearer petition text.', 422);
  }

  // Enrich with writ-specific data
  const writConfig = WRIT_TYPES[parsed.writType] || WRIT_TYPES.general_writ;
  parsed.writConfig = writConfig;

  return parsed;
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 2: DRAFT THE COUNTER AFFIDAVIT
// ═════════════════════════════════════════════════════════════════════════════

async function draftWritCounter(scanResult, language = 'en') {
  const wc = scanResult.writConfig;
  const langInstruction = language === 'hi'
    ? 'Respond in Hindi (Devanagari script).'
    : 'Respond in English.';

  const groundsSummary = (scanResult.grounds || [])
    .slice(0, 15)
    .map((g) => `Para ${g.paraNo}: ${g.claim} [Provision: ${g.provision || 'None'}] [Strength: ${g.admissibility || 'unknown'}]`)
    .join('\n');

  const weaknesses = (scanResult.weaknessesInPetition || []).join('\n');

  const prompt = `You are a senior Indian litigation lawyer with 25 years of experience drafting counter affidavits before Indian High Courts and the Supreme Court. You are filing this counter on behalf of the Respondent. ${langInstruction}

CASE DETAILS:
- Court: ${scanResult.court}
- Case No.: ${scanResult.caseNumber} (${scanResult.jurisdiction || 'Civil Writ Jurisdiction'})
- Petitioner(s): ${scanResult.petitionerName}
- Respondent(s): ${scanResult.respondentName}
- Writ type: ${wc.name}
- Constitutional Articles invoked: ${(scanResult.articlesInvoked || wc.articles).join(', ')}
- Subject: ${scanResult.subjectMatter}
- Impugned order/action: ${scanResult.impugnedOrder}
- Relief sought by petitioner: ${scanResult.reliefSought}

KEY FACTS FROM PETITION:
${(scanResult.keyFacts || []).join('\n')}

KEY DATES:
${(scanResult.keyDates || []).join('\n')}

PETITIONER'S ARGUMENTS:
${scanResult.petitionerArguments}

WEAKNESSES IN PETITION (exploit these):
${weaknesses}

GROUNDS RAISED BY PETITIONER (rebut each one):
${groundsSummary}

WRIT-SPECIFIC STANDARD COUNTER GROUNDS FOR ${wc.name.toUpperCase()}:
${wc.standardCounterGrounds.join('\n')}

DEPONENT INFORMATION:
Name: ${scanResult.deponentInfo?.name || 'Authorised Officer'}
Designation: ${scanResult.deponentInfo?.designation || 'Authorised Officer'}
District: ${scanResult.deponentInfo?.district || 'As per record'}
State: ${scanResult.deponentInfo?.state || 'As per record'}

DRAFTING RULES — STRICTLY FOLLOW:

1. OPENING PARAGRAPHS (paras 1-3, mandatory):
   Para 1: "That I am presently posted as [designation], [district] and am well acquainted with the facts and circumstances of the instant case."
   Para 2: "That I have been duly authorised by the competent authority to swear this instant counter affidavit on behalf of Respondent No. ___."
   Para 3: "That I have gone through the contents of the present writ petition/application and have fully understood the same."
   Para 4 (general denial): "That without prejudice to the generality of the statements made herein, each and every statement of fact made in the instant writ petition under reply is hereby denied except those which are expressly admitted hereinafter."

2. MAINTAINABILITY (mandatory para):
   "That the present writ petition filed by the petitioner(s) is not maintainable in law as well as on facts and as such the same is fit to be dismissed by this Hon'ble Court."
   Cite specific reason: ${wc.standardPreliminaryObjections[0]}

3. STATEMENT OF FACTS (5-8 numbered paras):
   - Facts from RESPONDENT's perspective only
   - Include specific dates, document numbers, and verifiable facts
   - Format: "That from perusal of the writ petition it transpires that..."
   - Reference the specific impugned order with its exact memo number and date
   - Explain WHY the action taken was lawful

4. PRELIMINARY OBJECTIONS (as separate numbered section, 3-5 objections):
   Use these standard objections for ${wc.name}:
   ${wc.standardPreliminaryObjections.join('\n   ')}
   Add any additional objections warranted by the specific facts.
   Each must cite a specific legal provision or case law.

5. REPLY ON MERITS (para-wise reply to each ground):
   - Begin EACH with: "That the averments contained in Para ___ of the writ petition are denied and disputed as stated."
   - Follow with respondent's version of that specific fact
   - Cite specific case law — use these where applicable:
     * Seniority/service: Direct Recruit Class II Engg Officers' Association v State of Maharashtra (1990) 2 SCC 715
     * Natural justice: Union of India v Tulsiram Patel (1985) 3 SCC 398
     * Judicial review: Tata Cellular v Union of India (1994) 6 SCC 651
     * Article 226 limitations: Whirlpool Corporation v Registrar of Trade Marks (1998) 8 SCC 1
     * Locus standi: S.P. Gupta v Union of India AIR 1982 SC 149
     * Delay and laches: State of Maharashtra v Digambar (1995) 4 SCC 683
     * Alternative remedy: Harbanslal Sahnia v Indian Oil Corporation (2003) 2 SCC 107
     * Seniority from training completion: State of Bihar v Akhouri Sachindra Nath (1991) Supp 1 SCC 334
   - Conclude each para with: "Hence the averments in Para ___ are false, misleading and fit to be rejected."

6. PRAYER (mandatory):
   "It is therefore most respectfully prayed that this Hon'ble Court may be pleased to:
   (a) Dismiss the instant writ petition with costs;
   (b) In the alternative, if any interim order is subsisting, the same may be vacated;
   (c) Pass any other order(s) as this Hon'ble Court may deem fit and proper in the facts and circumstances of the case."

7. VERIFICATION (mandatory, affidavit style):
   "That the statement made in paragraph no. ___ to ___ are true to the best of my knowledge and those made in paragraph no. ___ to ___ are true to the best of my information derived from the records of the case and rest are by way of submission made before this Hon'ble Court."
   Sign off: "[Deponent Name], [Date]"
   "Solemnly Affirmed before me [Advocate Oath Commissioner, [Court Name]]"

Return ONLY a valid JSON object:
{
  "openingParas": ["string — para 1 text", "string — para 2 text", "string — para 3 text", "string — para 4 general denial"],
  "maintainabilityPara": "string — complete para on non-maintainability",
  "statementOfFacts": ["string — each numbered fact para"],
  "preliminaryObjections": ["string — each objection with legal basis and case citation"],
  "counterDraft": [
    {
      "paraNo": number,
      "counterArgument": "string — complete formal rebuttal in court language",
      "supportingLaw": "string — specific Act/Section AND case name with citation"
    }
  ],
  "prayer": "string — complete formal prayer clause with sub-items (a)(b)(c)",
  "verification": "string — complete verification paragraph in affidavit style",
  "deponentBlock": "string — deponent name, designation, signature line",
  "advocateBlock": "string — Solemnly Affirmed before me... line"
}`;

  const raw = await callLLM(prompt, { temperature: 0.1, maxTokens: 8000 });
  const parsed = recoverJSON(raw);

  if (!parsed || !Array.isArray(parsed.counterDraft) || !parsed.counterDraft.length) {
    // Repair attempt
    const repairPrompt = `Convert this to valid JSON matching the schema. Output ONLY the JSON:
{
  "openingParas": ["string"],
  "maintainabilityPara": "string",
  "statementOfFacts": ["string"],
  "preliminaryObjections": ["string"],
  "counterDraft": [{ "paraNo": number, "counterArgument": "string", "supportingLaw": "string" }],
  "prayer": "string",
  "verification": "string",
  "deponentBlock": "string",
  "advocateBlock": "string"
}

Input:
${String(raw || '').substring(0, 10000)}`;
    const repairRaw = await callLLM(repairPrompt, { temperature: 0, maxTokens: 5000 });
    const repaired = recoverJSON(repairRaw);
    if (!repaired?.counterDraft?.length) {
      throw new AppError('Counter draft generation failed. Please try again.', 422);
    }
    return repaired;
  }

  return parsed;
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 3: BUILD FINAL DOCX DATA OBJECT
// ═════════════════════════════════════════════════════════════════════════════

function buildCounterDataForDocx(scanResult, draftResult) {
  // Merge opening paras into statementOfFacts for DOCX builder
  const allFacts = [
    ...(draftResult.openingParas || []),
    draftResult.maintainabilityPara || '',
    ...(draftResult.statementOfFacts || []),
  ].filter(Boolean);

  return {
    court: scanResult.court || '',
    caseNumber: scanResult.caseNumber || '',
    petitionerName: scanResult.petitionerName || '',
    respondentName: scanResult.respondentName || '',
    sourceDocumentType: `${scanResult.writTypeName || scanResult.writConfig?.name || 'Writ Petition'} — ${scanResult.jurisdiction || 'Civil Writ Jurisdiction'}`,
    jurisdictionLine: `(${scanResult.jurisdiction || 'Civil Writ Jurisdiction'})`,
    statementOfFacts: allFacts,
    preliminaryObjections: draftResult.preliminaryObjections || [],
    counterDraft: draftResult.counterDraft || [],
    prayer: draftResult.prayer || '',
    verification: [
      draftResult.verification || '',
      draftResult.deponentBlock || '',
      draftResult.advocateBlock || '',
    ].filter(Boolean).join('\n\n'),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 4: SAVE EDIT SESSION
// ═════════════════════════════════════════════════════════════════════════════

async function saveEditSession(userId, sourceFileId, title, counterData, docxBuffer, mode, scanResult) {
  const uploadPayload = {
    originalname: `${title.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_').toLowerCase().substring(0, 60)}_${Date.now()}.docx`,
    mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: docxBuffer,
    size: docxBuffer.length,
  };
  let uploadResult = { secure_url: '', public_id: '' };
  if (!CLOUDINARY_DISABLED) {
    uploadResult = await uploadToCloudinaryWithRetry(uploadPayload, 'chat-files');
  } else {
    // Local-only mode: use file path as URL
    uploadResult = { secure_url: `/uploads/generated/${uploadPayload.originalname}`, public_id: '' };
  }

  const generatedFile = new File({
    fileName: uploadPayload.originalname,
    fileType: uploadPayload.mimetype,
    fileSize: docxBuffer.length,
    fileUrl: uploadResult.secure_url,
    publicId: uploadResult.public_id || '',
    uploadedBy: userId,
  });
  });
  await generatedFile.save();
  const docxHtml = await docxToHtml(docxBuffer);
  const extracted = docxHtml
    ? docxHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';

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
    detectedDocType: 'Writ Counter Affidavit',
    scanResults: {
      documentType: 'Writ Counter Affidavit',
      sourceDocumentType: scanResult.writTypeName || 'Writ Petition',
      sourceFileId: String(sourceFileId || ''),
      writType: scanResult.writType,
      court: scanResult.court,
      caseNumber: scanResult.caseNumber,
      title,
      generatedFrom: 'writ-counter',
      counterDocxMode: mode,
    },
    docxStatus: 'ready',
    docxFileUrl: generatedFile.fileUrl,
    docxHtml: docxHtml || '',
    docxError: '',
    docxUpdatedAt: new Date(),
    originalDocxPath: generatedFile.fileUrl,
  });
  await session.save();

  return { generatedFile, session };
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER: generateWritCounter
// POST /api/drafts/writ-counter
// Body: { fileId?, petitionText?, language?, createEditableDocument? }
// ═════════════════════════════════════════════════════════════════════════════

export const generateWritCounter = async (req, res) => {
  const { fileId, petitionText, language = 'en', createEditableDocument = false } = req.body;

  let text = '';

  if (fileId) {
    const sourceFile = await File.findOne({ _id: fileId, uploadedBy: req.user.id });
    if (!sourceFile) throw new AppError('File not found', 404);
    text = await extractTextFromFile(sourceFile);
  } else if (petitionText && petitionText.trim().length > 50) {
    text = petitionText.trim();
  } else {
    throw new AppError('Provide either fileId or petitionText (minimum 50 characters)', 400);
  }

  // ── Stage 1: Scan the writ ────────────────────────────────────────────────
  console.log('[WritCounter] Stage 1: Scanning writ petition...');
  const scanResult = await scanWritPetition(text);
  console.log(`[WritCounter] Detected: ${scanResult.writType} | Court: ${scanResult.court} | Case: ${scanResult.caseNumber}`);

  // ── Stage 2: Draft the counter ────────────────────────────────────────────
  console.log('[WritCounter] Stage 2: Drafting counter affidavit...');
  const draftResult = await draftWritCounter(scanResult, language);
  console.log(`[WritCounter] Counter drafted: ${draftResult.counterDraft?.length || 0} paras`);

  // ── Stage 3: Build DOCX data ──────────────────────────────────────────────
  const counterData = buildCounterDataForDocx(scanResult, draftResult);

  const title = [
    'Writ Counter Affidavit',
    scanResult.caseNumber || '',
    scanResult.petitionerName || '',
  ].filter(Boolean).join(' - ').substring(0, 120);

  // ── Stage 4: Build DOCX if requested ──────────────────────────────────────
  let editableDocument = null;
  if (createEditableDocument) {
    try {
      const outDir = path.join(__dirname, '..', 'uploads', 'generated');
      const { filePath, fileName } = await buildCourtReadyDocx(counterData, {
        language,
        court: scanResult.court || '',
        outDir,
        draftMode: true,
      });
      const docxBuffer = fs.readFileSync(filePath);

      if (fileId) {
        const { generatedFile, session } = await saveEditSession(
          req.user.id, fileId, title, counterData, docxBuffer, 'court-ready', scanResult
        );
        editableDocument = { generatedFile, session };
      }
    } catch (docxErr) {
      console.warn('[WritCounter] DOCX build failed (non-fatal):', docxErr.message);
    }
  }

  // ── Respond ───────────────────────────────────────────────────────────────
  res.json({
    success: true,

    // Scan metadata
    writType: scanResult.writType,
    writTypeName: scanResult.writConfig?.name || scanResult.writTypeName,
    court: scanResult.court,
    caseNumber: scanResult.caseNumber,
    jurisdiction: scanResult.jurisdiction,
    petitionerName: scanResult.petitionerName,
    respondentName: scanResult.respondentName,
    articlesInvoked: scanResult.articlesInvoked || [],
    subjectMatter: scanResult.subjectMatter,
    impugnedOrder: scanResult.impugnedOrder,
    reliefSought: scanResult.reliefSought,
    keyDates: scanResult.keyDates || [],
    weaknessesInPetition: scanResult.weaknessesInPetition || [],
    deponentInfo: scanResult.deponentInfo || {},

    // Counter draft
    openingParas: draftResult.openingParas || [],
    maintainabilityPara: draftResult.maintainabilityPara || '',
    statementOfFacts: draftResult.statementOfFacts || [],
    preliminaryObjections: draftResult.preliminaryObjections || [],
    counterDraft: draftResult.counterDraft || [],
    prayer: draftResult.prayer || '',
    verification: draftResult.verification || '',
    deponentBlock: draftResult.deponentBlock || '',
    advocateBlock: draftResult.advocateBlock || '',

    // Editable document
    editorFileId: editableDocument?.generatedFile?._id || null,
    editorFileName: editableDocument?.generatedFile?.fileName || null,
    editorSessionId: editableDocument?.session?._id || null,
    editorFileUrl: editableDocument?.generatedFile?.fileUrl || null,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// EXPORT HANDLER: exportWritCounter
// POST /api/drafts/writ-counter/export
// Body: { counterData, scanResult, format: 'docx'|'pdf'|'html', language? }
// ═════════════════════════════════════════════════════════════════════════════

export const exportWritCounter = async (req, res) => {
  const { counterData, scanResult, format = 'docx', language = 'en' } = req.body;
  if (!counterData) throw new AppError('No counter data provided', 400);

  // ── DOCX export ───────────────────────────────────────────────────────────
  if (format === 'docx') {
    const outDir = path.join(__dirname, '..', 'uploads', 'temp');
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('[WritCounter] DOCX stream error:', err.message);
      try { fs.unlinkSync(filePath); } catch (_) {}
      if (!res.headersSent) res.status(500).json({ error: 'File read failed' });
    });
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(filePath); } catch (_) {} });      language,
      court: counterData.court || scanResult?.court || '',
      outDir,
      draftMode: false,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
    stream.on('end', () => { try { fs.unlinkSync(filePath); } catch (_) {} });
    return;
  }

  // ── PDF / HTML export ─────────────────────────────────────────────────────
  let html;
  try {
    html = buildCounterAffidavitExportHtml(counterData, {
      language,
      court: counterData.court || scanResult?.court || '',
    });
  } catch (e) {
    throw new AppError('Export template unavailable', 500);
  }

  if (format === 'pdf') {
    try {
      const tmpDir = path.join(__dirname, '..', 'uploads', 'temp');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const htmlPath = path.join(tmpDir, `writ_counter_${Date.now()}.html`);
      fs.writeFileSync(htmlPath, html);
      const pdfResult = await generatePdf(htmlPath, { pageSize: 'A4' });
      if (pdfResult?.path && fs.existsSync(pdfResult.path)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="writ_counter_affidavit.pdf"');
        const stream = fs.createReadStream(pdfResult.path);
        stream.pipe(res);
        stream.on('end', () => {
          try { fs.unlinkSync(pdfResult.path); fs.unlinkSync(htmlPath); } catch (_) {}
        });
        return;
      }
    } catch (pdfErr) {
      console.warn('[WritCounter] PDF failed, falling back to HTML:', pdfErr.message);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="writ_counter_affidavit.html"');
  res.send(html);
};

/*
─────────────────────────────────────────────────────────────────────────────
WIRE-UP: Add these 4 lines to server/routes/draftRoutes.js

IMPORT (at the top with other imports):
  import { generateWritCounter, exportWritCounter } from '../controllers/writCounterController.js';

ROUTES (after existing counter-affidavit routes):
  router.post('/writ-counter', authenticateJWT, asyncHandler(generateWritCounter));
  router.post('/writ-counter/export', authenticateJWT, asyncHandler(exportWritCounter));
─────────────────────────────────────────────────────────────────────────────
*/
