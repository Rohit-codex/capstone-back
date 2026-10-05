// server/services/sofService.js
// Generates a structured Statement of Facts (SOF) from any legal document.
// Integrates with the existing fileController.js edit session pipeline.
// Follows the same AI call pattern as documentSummaryService.js

const GEMINI_DISABLED = process.env.GEMINI_DISABLE === 'true';

// ─── AI helpers (mirrors fileController.js pattern exactly) ──────────────────
async function callGemini(prompt) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function callOllama(prompt) {
  const axios = require('axios');
  const base = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const response = await axios.post(
    `${base}/api/generate`,
    { model: 'llama3.1:8b', prompt, stream: false },
    { timeout: 90000 }
  );
  return response.data.response;
}

async function callAI(prompt) {
  if (!GEMINI_DISABLED) {
    try {
      return await callGemini(prompt);
    } catch (err) {
      console.warn('[sofService] Gemini failed, falling back to Ollama:', err.message);
    }
  }
  try {
    return await callOllama(prompt);
  } catch (err) {
    console.error('[sofService] Both AI providers failed:', err.message);
    throw new Error('SOF generation failed — both Gemini and Ollama unavailable.');
  }
}

// ─── JSON recovery (same pattern as documentSummaryService.js) ────────────────
function recoverJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = raw.replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace !== -1) {
        const truncated = cleaned.slice(0, lastBrace + 1);
        let open = 0;
        for (const ch of truncated) {
          if (ch === '{' || ch === '[') open++;
          else if (ch === '}' || ch === ']') open--;
        }
        try {
          return JSON.parse(truncated + '}'.repeat(Math.max(open, 0)));
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

// ─── Text preparation ─────────────────────────────────────────────────────────
function prepareText(text, maxChars = 12000) {
  if (!text || text.trim().length === 0) return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const half = Math.floor(maxChars / 2);
  return (
    t.slice(0, half) +
    '\n\n[... middle section omitted ...]\n\n' +
    t.slice(t.length - half)
  );
}

// ─── SOF prompt builder ───────────────────────────────────────────────────────
function buildSOFPrompt(documentText, docType) {
  const docContext = docType && docType !== 'unknown'
    ? `This document is identified as: ${docType}.`
    : 'Determine the document type from the content.';

  return `You are a senior Indian litigation advocate with 20 years of experience drafting Statements of Facts for High Courts and the Supreme Court of India.

${docContext}

A Statement of Facts (SOF) is a formal legal document that presents the chronological, objective facts of a case or transaction in numbered paragraphs, as they would be presented before a court. It must be precise, neutral in tone, and reference specific clauses, dates, and parties from the source document.

SOURCE DOCUMENT:
---
${documentText}
---

Respond ONLY with a valid JSON object. No markdown, no preamble, no explanation outside the JSON. Match this exact schema:

{
  "title": "string — e.g. 'Statement of Facts in the matter of [Party A] vs [Party B]' or 'Statement of Facts — [Document Type]'",
  "caseReference": "string — case/agreement/document reference number if found, else 'Not specified'",
  "court": "string — court or forum if identifiable, else 'Not specified'",
  "preparedFor": "string — party for whom the SOF is prepared, e.g. 'Petitioner' or 'Respondent' or 'All parties'",
  "dateOfDocument": "string — execution/filing date of the source document, else 'Not specified'",
  "parties": [
    {
      "designation": "string — e.g. Plaintiff, Defendant, Petitioner, Lessor, Vendor",
      "name": "string",
      "description": "string — one sentence describing who this party is"
    }
  ],
  "backgroundFacts": [
    {
      "paraNumber": 1,
      "fact": "string — one complete, objective, court-ready factual statement. Begin each with 'That' as per Indian legal convention."
    }
  ],
  "chronology": [
    {
      "date": "string — specific date or period",
      "event": "string — what happened on this date, referencing specific clauses or amounts where applicable"
    }
  ],
  "documentsReliedUpon": [
    "string — each document, agreement, notice, or exhibit mentioned or referred to in the source"
  ],
  "admittedFacts": [
    "string — facts that are not in dispute and can be taken as admitted"
  ],
  "disputedFacts": [
    "string — facts that are contested or ambiguous based on the document"
  ],
  "legalIssuesArising": [
    "string — key legal questions that arise from these facts, framed as issues"
  ],
  "reliefSought": "string — relief or outcome sought based on the facts, or 'Not determinable from document alone'",
  "verification": "string — standard Indian court verification clause, e.g. 'I, [Name], do hereby verify that the contents of the above Statement of Facts are true and correct to the best of my knowledge and belief and nothing material has been concealed therefrom.'"
}

IMPORTANT RULES:
- backgroundFacts must have at minimum 8 numbered paragraphs, each starting with 'That'
- Every fact must be sourced from the document — do not invent facts
- chronology must be in ascending date order
- Use formal Indian legal language throughout
- legalIssuesArising should frame issues as questions e.g. 'Whether the respondent was in breach of Clause 4.2 of the Agreement?'
- Maximum 15 backgroundFacts paragraphs`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * generateSOF
 *
 * @param {string} extractedText  — raw text from the uploaded document
 * @param {string} docType        — from documentParserService.detectDocumentType()
 * @param {string} sessionId      — edit session ID for logging
 * @returns {Promise<Object>}     — structured SOF object
 *
 * Wire-up in fileController.js:
 *   const { generateSOF } = require('../services/sofService');
 *
 * In startEditSession(), after existing Smart Scan calls:
 *   const sof = await generateSOF(extractedText, docType, sessionId);
 *   sessionData.sof = sof;
 *
 * Also expose via a dedicated endpoint for on-demand generation:
 *   POST /api/files/edit/sof  →  sofController.js → generateSOFHandler()
 */
async function generateSOF(extractedText, docType = 'unknown', sessionId = '') {
  const start = Date.now();

  if (!extractedText || extractedText.trim().length < 50) {
    console.warn('[sofService] Text too short for SOF generation');
    return buildFallbackSOF('Document text too short or could not be extracted.');
  }

  const prepared = prepareText(extractedText);
  const prompt = buildSOFPrompt(prepared, docType);

  let raw;
  try {
    raw = await callAI(prompt);
  } catch (err) {
    console.error('[sofService] AI call failed:', err.message);
    return buildFallbackSOF(err.message);
  }

  const parsed = recoverJSON(raw);
  if (!parsed) {
    console.error('[sofService] JSON parse failed. Snippet:', raw?.slice(0, 200));
    return buildFallbackSOF('AI response could not be parsed. Please try regenerating.');
  }

  // Enforce para numbering is sequential
  if (Array.isArray(parsed.backgroundFacts)) {
    parsed.backgroundFacts = parsed.backgroundFacts.map((f, i) => ({
      ...f,
      paraNumber: i + 1,
    }));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[sofService] SOF generated in ${elapsed}s | session: ${sessionId} | docType: ${docType}`);

  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
    docType,
    generationTimeSeconds: parseFloat(elapsed),
    error: null,
  };
}

function buildFallbackSOF(reason) {
  return {
    title: 'Statement of Facts — Generation Failed',
    caseReference: 'Not specified',
    court: 'Not specified',
    preparedFor: 'Not specified',
    dateOfDocument: 'Not specified',
    parties: [],
    backgroundFacts: [],
    chronology: [],
    documentsReliedUpon: [],
    admittedFacts: [],
    disputedFacts: [],
    legalIssuesArising: [],
    reliefSought: 'Not determinable',
    verification: '',
    generatedAt: new Date().toISOString(),
    docType: 'unknown',
    generationTimeSeconds: 0,
    error: reason,
  };
}

module.exports = { generateSOF };
