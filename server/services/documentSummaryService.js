// server/services/documentSummaryService.js
//
// Generates a structured ~2-page summary for any uploaded document.
// Integrates with the existing Smart Scan pipeline inside startEditSession().
// Calls the same AI stack (Gemini primary, Ollama fallback) used in fileController.js
//
// Usage (inside fileController.js → startEditSession()):
//   const { generateDocumentSummary } = require('../services/documentSummaryService');
//   const summary = await generateDocumentSummary(extractedText, detectedDocType);
//   // attach to session: editSession.summary = summary;

import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

const GEMINI_DISABLED = process.env.GEMINI_DISABLE === 'true';

// ─── AI call helpers (mirrors the pattern in fileController.js) ───────────────

async function callGemini(prompt) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function callOllama(prompt) {
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
      console.warn('[documentSummaryService] Gemini failed, falling back to Ollama:', err.message);
    }
  }
  try {
    return await callOllama(prompt);
  } catch (err) {
    console.error('[documentSummaryService] Both AI providers failed:', err.message);
    throw new Error('AI summary generation failed — both Gemini and Ollama unavailable.');
  }
}

// ─── JSON recovery (same pattern as fileController.js Smart Scan) ─────────────
// If the LLM truncates the JSON, find the last complete top-level key and close it.
function recoverJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    // Strip markdown fences
    const cleaned = raw.replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      // Find last complete } and attempt to close the object
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace !== -1) {
        const truncated = cleaned.slice(0, lastBrace + 1);
        // Count unclosed braces/brackets and close them
        let open = 0;
        for (const ch of truncated) {
          if (ch === '{' || ch === '[') open++;
          else if (ch === '}' || ch === ']') open--;
        }
        const closing = '}'.repeat(Math.max(open, 0));
        try {
          return JSON.parse(truncated + closing);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}

// ─── Truncate document text safely ───────────────────────────────────────────
// Gemini 1.5 Flash has a large context window but we cap at ~12000 chars
// to stay fast and cost-effective. For longer docs the first+last strategy
// preserves both the header (parties, recitals) and the tail (signatures, schedules).
function prepareTextForSummary(text, maxChars = 12000) {
  if (!text || text.trim().length === 0) return '';
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const half = Math.floor(maxChars / 2);
  return (
    t.slice(0, half) +
    '\n\n[... middle section omitted for brevity ...]\n\n' +
    t.slice(t.length - half)
  );
}

// ─── Build the summary prompt ─────────────────────────────────────────────────
function buildSummaryPrompt(documentText, docType) {
  const docTypeContext = docType && docType !== 'unknown'
    ? `This document has been identified as: ${docType}.`
    : 'The document type is not yet determined — infer it from the content.';

  return `You are a senior Indian legal analyst with 20 years of experience reviewing legal documents for clients across litigation, corporate law, and compliance.

${docTypeContext}

Your task is to produce a structured, professional document summary that would fill approximately 2 printed pages (600–750 words). The summary must be readable by a non-lawyer yet precise enough for an advocate's review.

DOCUMENT TEXT:
---
${documentText}
---

Respond ONLY with a valid JSON object. No markdown, no preamble, no explanation. The JSON must match this exact schema:

{
  "documentTitle": "string — inferred title or document type",
  "documentType": "string — specific type: e.g. Rental Agreement, Sale Deed, Writ Petition, Affidavit, etc.",
  "jurisdiction": "string — state/court/authority if identifiable, else 'Not specified'",
  "parties": [
    { "role": "string e.g. Lessor / Petitioner / Vendor", "name": "string or 'Not specified'" }
  ],
  "effectiveDate": "string — date of execution or filing, or 'Not specified'",
  "expiryDate": "string — end date / validity period, or 'Not applicable'",
  "executiveSummary": "string — 3 to 4 sentences. What this document is, who the parties are, what it does, and why it matters. Write in plain English for a layperson.",
  "keyProvisions": [
    {
      "heading": "string — name of the clause or section",
      "summary": "string — 2 to 3 sentences explaining what this provision means in plain language"
    }
  ],
  "financialTerms": {
    "amounts": ["string — list every monetary figure with context, e.g. 'Rent: ₹25,000/month'"],
    "paymentSchedule": "string — when and how payments are due, or 'Not applicable'",
    "penalties": "string — late fees, damages, or 'None specified'"
  },
  "obligationsAndRights": {
    "partyA": ["string — key obligations of the first party"],
    "partyB": ["string — key obligations of the second party"]
  },
  "criticalDates": [
    { "event": "string", "date": "string" }
  ],
  "riskFlags": [
    {
      "severity": "critical | warning | info",
      "flag": "string — specific risk, ambiguity, or missing clause identified"
    }
  ],
  "missingClauses": ["string — important clauses that are absent and should be added"],
  "legalReferences": ["string — any Acts, Sections, Rules, or Case Law cited in the document"],
  "conclusion": "string — 2 to 3 sentences. Overall assessment: is this document well-drafted? What is the most important thing the reader should know or do?"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * generateDocumentSummary
 *
 * @param {string} extractedText  — raw text extracted from the uploaded document
 * @param {string} docType        — document type from documentParserService.detectDocumentType()
 * @returns {Promise<Object>}     — structured summary object (matches schema above)
 *
 * Called inside fileController.js → startEditSession() after OCR/text extraction.
 * The returned object is attached to the edit session and returned to the client.
 */
async function generateDocumentSummary(extractedText, docType = 'unknown') {
  const startTime = Date.now();

  if (!extractedText || extractedText.trim().length < 50) {
    console.warn('[documentSummaryService] Text too short to summarize');
    return buildFallbackSummary('Document text is too short or could not be extracted.');
  }

  const preparedText = prepareTextForSummary(extractedText);
  const prompt = buildSummaryPrompt(preparedText, docType);

  let rawResponse;
  try {
    rawResponse = await callAI(prompt);
  } catch (err) {
    console.error('[documentSummaryService] AI call failed:', err.message);
    return buildFallbackSummary(err.message);
  }

  const parsed = recoverJSON(rawResponse);

  if (!parsed) {
    console.error('[documentSummaryService] JSON parse failed. Raw response snippet:', rawResponse?.slice(0, 300));
    return buildFallbackSummary('AI response could not be parsed. Please try re-scanning the document.');
  }

  // Enforce severity enum on riskFlags (matches sanitizeSeverity in fileController.js)
  if (Array.isArray(parsed.riskFlags)) {
    parsed.riskFlags = parsed.riskFlags.map((rf) => ({
      ...rf,
      severity: sanitizeSeverity(rf.severity),
    }));
  }

  // Guarantee keyProvisions is capped at 10 items — prevents bloat on large contracts
  if (Array.isArray(parsed.keyProvisions) && parsed.keyProvisions.length > 10) {
    parsed.keyProvisions = parsed.keyProvisions.slice(0, 10);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[documentSummaryService] Summary generated in ${elapsed}s for docType: ${docType}`);

  return {
    ...parsed,
    generatedAt: new Date().toISOString(),
    docType,
    generationTimeSeconds: parseFloat(elapsed),
    error: null,
  };
}

// ─── Matches the existing sanitizeSeverity in fileController.js ───────────────
function sanitizeSeverity(val) {
  const valid = ['info', 'warning', 'critical'];
  if (valid.includes(val)) return val;
  if (val === 'medium') return 'warning';
  if (val === 'high' || val === 'error') return 'critical';
  if (val === 'low') return 'info';
  return 'info';
}

// ─── Fallback when AI is unavailable ─────────────────────────────────────────
function buildFallbackSummary(reason) {
  return {
    documentTitle: 'Summary Unavailable',
    documentType: 'Unknown',
    jurisdiction: 'Not specified',
    parties: [],
    effectiveDate: 'Not specified',
    expiryDate: 'Not applicable',
    executiveSummary: `Automated summary could not be generated. Reason: ${reason}`,
    keyProvisions: [],
    financialTerms: { amounts: [], paymentSchedule: 'Not applicable', penalties: 'None specified' },
    obligationsAndRights: { partyA: [], partyB: [] },
    criticalDates: [],
    riskFlags: [],
    missingClauses: [],
    legalReferences: [],
    conclusion: 'Please review the document manually or try re-uploading.',
    generatedAt: new Date().toISOString(),
    docType: 'unknown',
    generationTimeSeconds: 0,
    error: reason,
  };
}

export { generateDocumentSummary };
