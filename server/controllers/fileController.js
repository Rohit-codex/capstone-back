import File from '../models/File.js';
import { validateFile, uploadToCloudinaryWithRetry, deleteFromCloudinaryWithRetry, getCloudinaryBuffer } from '../utils/fileHandler.js';
import { callLLM, callLocalLLM, callLLMWithRetry } from '../utils/llmUtils.js';
import fetch from 'node-fetch';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import MessageCount from '../models/MessageCount.js';
import { getMessageLimitForTier, getRemainingMessages } from '../models/SubscriptionPrice.js';
import { AppError } from '../utils/errors.js';
import redis from '../utils/redisClient.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { PDFDocument as PdfLibDocument } from 'pdf-lib';
import { extractPdfFonts, loadFontIndex, loadFontBytesById, loadFontBytesByFamily } from '../services/pdfFontService.js';
const _require = createRequire(import.meta.url);
import * as XLSX from 'xlsx';
import Tesseract from 'tesseract.js';
import { extractDocxStructure, extractDocxText as extractDocxTextStructured, docxStructureToHtml } from '../utils/docxStructureExtractor.js';
import {
  createEditSession,
  getEditSession,
  applyEdit,
  generateDocx,
  generatePdf,
  generateRtf,
  generateMarkdown,
  generateHtml,
  clearEditSession,
  getDocumentAnalysis,
  undoEdit,
  redoEdit,
  getUndoRedoState as getUndoRedoStateService,
  autosave,
  commitAutosave,
  getDiffBetweenVersions as getDiffService,
  getUserSessions,
  loadSession,
  fillTemplateVariables as fillVariablesService,
  splitIntoChunks,
  reassembleChunks
} from '../services/documentEditService.js';
import { writeDocxFromText } from '../utils/docxWriter.js';
import { writeDocxFromHtml } from '../utils/htmlToDocx.js';
import { generatePdf as generatePdfFromDocx } from '../services/pdfGenerationService.js';
import { extractPdfTextWithAdobe, isAdobePdfConfigured, stampEditedPdfTemplate, exportPdfToDocxWithAdobe } from '../services/adobePdfService.js';
import { extractTextWithAzureOcr, isAzureOcrConfigured } from '../services/azureOcrService.js';
import { extractPdfTextWithAzureDocumentIntelligence, isAzureDocumentIntelligenceConfigured } from '../services/azureDocumentIntelligenceService.js';
import { extractDocxFormatting, docxToHtml } from '../utils/docxFormatExtractor.js';
import { extractPdfFormatting } from '../utils/pdfFormatExtractor.js';
import EditSession from '../models/EditSession.js';
import { matchTemplateByDocType } from '../utils/templateIndex.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { generateDocumentSummary } from '../services/documentSummaryService.js';

const CLOUDINARY_DISABLED = process.env.CLOUDINARY_DISABLE === 'true';


const SUBSCRIPTION_DISABLED = process.env.SUBSCRIPTION_DISABLE === 'true';


const GEMINI_DISABLED = process.env.GEMINI_DISABLED === 'true';
const PYTHON_SERVICE_ENABLED = (process.env.PYTHON_SERVICE_ENABLED || 'false').toLowerCase() === 'true';

const normalizePythonServiceUrl = (rawUrl) => {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    // Railway public HTTPS routes should not use container port 8080.
    if (url.protocol === 'https:' && url.port === '8080' && /\.up\.railway\.app$/i.test(url.hostname)) {
      url.port = '';
    }
    return url.toString().replace(/\/+$/, '');
  } catch (_) {
    return withProtocol.replace(/\/+$/, '');
  }
};

const isAbsoluteHttpUrl = (url) => /^https?:\/\/[^/\s]+/i.test(url || '');

const SMART_SCAN_BUDGET_MS = parseInt(process.env.SMART_SCAN_BUDGET_MS || '90000', 10);

const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const withTimeout = async (promiseFactory, timeoutMs = 20000, label = 'operation') => {
  let timer = null;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    });
    return await Promise.race([promiseFactory(), timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};


function getLanguageInstruction(lang) {
  if (lang === 'hi') {
    return `

IMPORTANT LANGUAGE INSTRUCTION:
You MUST respond ONLY in Hindi (हिंदी) language using Devanagari script.
- Use simple, easy-to-understand Hindi
- Legal terms can be in English with Hindi explanation in parentheses
- Do NOT use English sentences, only Hindi
- Example: "आपको पुलिस स्टेशन जाकर FIR (प्राथमिकी) दर्ज करानी चाहिए।"
`;
  }
  return '';
}

const enhancePdfText = (rawText) => {
  if (!rawText) return '';

  let text = rawText;

  // Remove repeated running headers/footers and standalone page markers.
  // This is generic (non-hardcoded) and works across different courts/doc formats.
  const stripRunningArtifacts = (input) => {
    const lines = input.split('\n');
    const counts = new Map();
    const normalizedCounts = new Map();

    const normalizeForRepeat = (s) => (
      (s || '')
        .replace(/\s+/g, ' ')
        // Ignore changing page counters while matching repeated headers.
        .replace(/\b\d+\s*\/\s*\d+\b/g, '')
        .trim()
    );

    for (const raw of lines) {
      const t = (raw || '').trim();
      if (!t) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
      const n = normalizeForRepeat(t);
      if (n.length >= 20) normalizedCounts.set(n, (normalizedCounts.get(n) || 0) + 1);
    }

    const looksLikeRunningHeaderFooter = (line) => {
      const t = (line || '').trim();
      if (!t) return false;
      const n = normalizeForRepeat(t);
      const repeated = (counts.get(t) || 0) >= 2 || (normalizedCounts.get(n) || 0) >= 2;
      if (!repeated) return false;

      // Prefer dropping repeated legal headers/footers, not normal paragraph lines.
      const hasHeaderSignals =
        /\b(high\s*court|supreme\s*court|district\s*court|jurisdiction|case\s*no|cwjc|cr\.?\s*w\.?|dt\.?|dated|judicature|order|judgment)\b/i.test(n);
      const hasDigits = /\d/.test(n);
      return (hasHeaderSignals && hasDigits) || n.length > 45;
    };

    const isStandalonePageMarker = (line) => {
      const t = (line || '').trim();
      if (!t) return false;
      // -- 1 of 7 -- / 2/7 / Page 3 of 10
      if (/^(?:-+\s*)?\d+\s*(?:\/|of)\s*\d+(?:\s*-+)?$/i.test(t)) return true;
      if (/^page\s*\d+\s*(?:of\s*\d+)?$/i.test(t)) return true;
      return false;
    };

    const out = [];
    for (const raw of lines) {
      const t = (raw || '').trim();
      if (!t) {
        out.push('');
        continue;
      }
      if (isStandalonePageMarker(t)) continue;
      if (looksLikeRunningHeaderFooter(t)) continue;
      out.push(raw);
    }
    return out.join('\n');
  };

  text = stripRunningArtifacts(text);

  // Strip fallback pdf2json explicit page breaks
  text = text.replace(/-+Page \(\d+\) Break-+/gi, '');

  // Remove common OCR artifacts like stray pipes or vertical bars used for alignment
  // but keep them if they look like table structures (more than 2 in a line)
  const artifactLines = text.split('\n');
  text = artifactLines.map(line => {
    const pipeCount = (line.match(/\|/g) || []).length;
    if (pipeCount > 0 && pipeCount < 3) {
      // Likely a stray artifact from a scanned border or column line
      return line.replace(/\|/g, ' ').replace(/\s{2,}/g, ' ').trim();
    }
    return line;
  }).join('\n');

  // Merge hyphenated words split across lines: "exam-\nple" -> "example"
  text = text.replace(/(\w)-\n(\w)/g, '$1$2');

  // Collapse very large blank regions early
  text = text.replace(/\n{4,}/g, '\n\n\n');
  text = text.replace(/\n{3}/g, '\n\n');

  // OCR for party blocks (Petitioner/Respondent) often inserts:
  // - blank lines between every wrapped line (creates extra <p><br/></p> in HTML)
  // - standalone numbering lines like "1." / "2." repeated without content
  // We normalize only the region around "Versus" → "Respondent/s" to keep
  // each numbered respondent on a single line (and remove blank lines inside).
  const normalizePartyBlocks = (input) => {
    if (!input) return input;
    let lines = input.split('\n');

    const findIndex = (re, start = 0) => {
      for (let i = start; i < lines.length; i++) {
        if (re.test((lines[i] || '').trim())) return i;
      }
      return -1;
    };

    const ellipsisOnly = (s) => /^\.+$/.test(s) || /^(\.\.\.\s+)+\.\.\.$/.test(s);

    const normalizeRespondentsRegion = (idxVersus, idxRespondent) => {
      const out = [];
      let pendingNum = null; // handles OCR where "1." is on its own line
      let currentNum = null;
      let currentText = '';

      const pushCurrent = () => {
        if (currentNum !== null) {
          out.push(`${currentNum}. ${currentText.trim()}`);
          currentNum = null;
          currentText = '';
        }
      };

      for (let i = idxVersus + 1; i < idxRespondent; i++) {
        const s = (lines[i] || '').trim();
        if (!s) continue;
        if (ellipsisOnly(s)) continue;

        // "1." on its own line
        const standaloneNum = s.match(/^(\d+)\.\s*$/);
        if (standaloneNum) {
          pendingNum = standaloneNum[1];
          continue;
        }

        // "1. The State ..." start
        const fullStart = s.match(/^(\d+)\.\s*(.+)$/);
        if (fullStart) {
          pushCurrent();
          currentNum = fullStart[1];
          currentText = fullStart[2].trim();
          pendingNum = null;
          continue;
        }

        // Continuation after a standalone number
        if (pendingNum !== null) {
          pushCurrent();
          currentNum = pendingNum;
          currentText = s;
          pendingNum = null;
          continue;
        }

        // Continuation for the current numbered item
        if (currentNum !== null) {
          currentText = `${currentText} ${s}`.replace(/\s+/g, ' ').trim();
        } else {
          // Keep any unnumbered lines (rare), but without blank lines
          out.push(s);
        }
      }

      pushCurrent();
      return out;
    };

    const normalizePetitionerToVersus = (idxPetitioner, idxVersus) => {
      const out = [];
      for (let i = idxPetitioner + 1; i < idxVersus; i++) {
        const s = (lines[i] || '').trim();
        if (!s) continue;
        if (ellipsisOnly(s)) continue;
        if (/^\d+\.\s*$/.test(s) || /^\d+\s*$/.test(s)) continue; // drop standalone "1."
        out.push(s);
      }
      return out;
    };

    // Normalize respondent block first.
    let idxPetitioner = findIndex(/petitioner\/s?/i);
    let idxVersus = findIndex(/^(?:versus|vs\.?|v\/s\.?|v\.)$/i);
    let idxRespondent = findIndex(/respondent\/s?/i);

    if (idxVersus !== -1 && idxRespondent !== -1 && idxRespondent > idxVersus) {
      const normalizedRespondents = normalizeRespondentsRegion(idxVersus, idxRespondent);
      const before = lines.slice(0, idxVersus + 1);
      const after = lines.slice(idxRespondent);
      lines = [...before, ...normalizedRespondents, ...after];
    }

    // Recompute indices (because we changed line counts).
    idxPetitioner = findIndex(/petitioner\/s?/i);
    idxVersus = findIndex(/^(?:versus|vs\.?|v\/s\.?|v\.)$/i);

    if (idxPetitioner !== -1 && idxVersus !== -1 && idxVersus > idxPetitioner) {
      const normalizedPetitioners = normalizePetitionerToVersus(idxPetitioner, idxVersus);
      const before = lines.slice(0, idxPetitioner + 1);
      const after = lines.slice(idxVersus);
      lines = [...before, ...normalizedPetitioners, ...after];
    }

    return lines.join('\n');
  };

  text = normalizePartyBlocks(text);

  const lines = text.split('\n');
  const processedLines = [];
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const hasMultipleColumns = /\s{3,}|\t/.test(line);
    const hasTablePatterns = /\||\+[-+]+\+|[-]{3,}/.test(line);

    if (hasTablePatterns || (hasMultipleColumns && line.trim().length > 10)) {
      if (!inTable) {
        processedLines.push('');
        inTable = true;
      }

      let tableLine = line
        .replace(/\t+/g, ' | ')
        .replace(/\s{4,}/g, ' | ')
        .replace(/\s{2,}/g, ' ');

      // Clean up alignment artifacts in table lines
      tableLine = tableLine.replace(/^[\s|]+|[\s|]+$/g, ''); // Trim leading/trailing pipes/spaces

      processedLines.push(tableLine);
    } else {
      if (inTable && line.trim()) {
        processedLines.push('');
        inTable = false;
      }
      processedLines.push(line);
    }
  }

  text = processedLines.join('\n');

  // Second pass: merge lines that are likely part of the same paragraph.
  // Heuristic: previous line does not end with strong punctuation, and
  // current line starts with lowercase and is not a bullet/number/heading.
  const paragraphLines = text.split('\n');
  const merged = [];

  const isBulletOrNumber = (s) =>
    /^(\d+[\).\]]\s+|[•●○◦▪▫-]\s+)/.test(s);
  const endsWithPunctuation = (s) =>
    /[.!?:;]\s*$/.test(s);

  for (let i = 0; i < paragraphLines.length; i++) {
    const current = paragraphLines[i];
    const curTrim = current.trim();

    if (!curTrim) {
      // Blank line: explicit paragraph break
      merged.push('');
      continue;
    }

    const prevIndex = merged.length - 1;
    const prev = prevIndex >= 0 ? merged[prevIndex] : null;
    const prevTrim = prev ? prev.trim() : '';

    if (
      prev &&
      prevTrim &&
      !endsWithPunctuation(prevTrim) &&
      !isBulletOrNumber(curTrim) &&
      /^[a-z]/.test(curTrim)
    ) {
      // Soft wrap inside the same paragraph
      merged[prevIndex] = `${prevTrim} ${curTrim}`;
    } else {
      merged.push(curTrim);
    }
  }

  text = merged.join('\n');

  // Third pass: remove OCR-introduced blank lines that split a wrapped sentence.
  // Keep true paragraph breaks (headings, numbered clauses, anchors like Versus/Petitioner).
  const collapseSoftBlankLines = (input) => {
    const src = input.split('\n');
    const out = [];
    const isAnchor = (s) => /^(?:versus|vs\.?|v\/s\.?|v\.|petitioner\/s?|respondent\/s?|order|judgment|judgement)$/i.test((s || '').trim());
    const isHeadingLike = (s) => {
      const t = (s || '').trim();
      if (!t) return false;
      if (/^(IN\s+THE\s+|Civil\s+Writ|Criminal\s+Writ|Case\s+No\.?|No\.?\s*\d+)/i.test(t)) return true;
      const letters = t.replace(/[^A-Za-z]/g, '');
      return letters.length > 5 && letters === letters.toUpperCase() && t.length < 90;
    };
    const isListStart = (s) => /^(\d+[\).\]]\s+|[•●○◦▪▫-]\s+)/.test((s || '').trim());
    const endsStrong = (s) => /[.!?:;]\s*$/.test((s || '').trim());

    for (let i = 0; i < src.length; i++) {
      const cur = src[i];
      const curTrim = (cur || '').trim();

      if (curTrim) {
        out.push(curTrim);
        continue;
      }

      // blank line: look at previous kept line and next non-empty source line
      const prev = out.length ? out[out.length - 1] : '';
      let next = '';
      for (let j = i + 1; j < src.length; j++) {
        const t = (src[j] || '').trim();
        if (t) {
          next = t;
          break;
        }
      }

      const shouldMergeAcrossBlank =
        !!prev &&
        !!next &&
        !endsStrong(prev) &&
        !isAnchor(prev) &&
        !isAnchor(next) &&
        !isHeadingLike(next) &&
        !isListStart(next);

      if (shouldMergeAcrossBlank) {
        // Drop this blank line so wrapped sentence stays in one paragraph.
        continue;
      }

      // Keep only one explicit blank separator.
      if (out.length && out[out.length - 1] !== '') out.push('');
    }

    while (out.length && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  };

  text = collapseSoftBlankLines(text);

  // Normalize multiple spaces
  text = text.replace(/[ ]{2,}/g, ' ');

  // Strip control characters / nulls
  text = text
    .replace(/\u0000/g, '')
    .replace(/\ufffd/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

  // Ensure inline list markers get a line break only when they are not already
  // at start-of-line. Avoid inserting extra blank lines before each numbered item.
  text = text.replace(/([^\n])\s+(\d+\.\s+)/g, '$1\n$2');
  text = text.replace(/([^\n])\s+([•●○◦▪▫]\s+)/g, '$1\n$2');

  // Final cleanup: remove any remaining stray vertical bars that aren't part of a table
  text = text.replace(/(?<![|])\|(?![|])/g, ' ');

  // Final collapse of excessive blank lines
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
};

/**
 * Convert PDF extracted text to formatted HTML using legal document heuristics.
 * Detects headings (ALL CAPS, short centered-like lines), court names, party blocks,
 * versus lines, and order/judgment headings common in Indian legal documents.
 */
const convertPdfTextToHtml = (text) => {
  if (!text) return '';
  const lines = text.split('\n');
  const htmlParts = [];
  const totalLines = lines.length;
  let lastWasBlank = true;

  // Heuristic patterns for Indian legal documents
  const courtPattern = /^(IN\s+THE\s+(HIGH\s+COURT|SUPREME\s+COURT|DISTRICT\s+COURT|SESSIONS\s+COURT|COURT\s+OF|NATIONAL\s+COMPANY|CONSUMER))/i;
  const caseNoPattern = /^(Criminal|Civil|Writ|SLP|Appeal|Petition|Misc|CMP|CRM|WP|CA|SLP|BAIL|Crl\.?\s*M|C\.?\s*M|O\.?\s*A|R\.?\s*P|M\.?\s*A|R\.?\s*A|S\.?\s*A)\b.*\bN?o\.?\s*\d/i;
  const versusPattern = /^\s*(?:versus|vs\.?|v\/s\.?|v\.)\s*$/i;
  const orderJudgmentPattern = /^\s*(?:ORDER|JUDGMENT|JUDGEMENT|DECREE|O\s*R\s*D\s*E\s*R|J\s*U\s*D\s*G\s*M\s*E\s*N\s*T)\s*$/i;
  const dateSignPattern = /^\(?(?:Patna|New Delhi|Delhi|Mumbai|Kolkata|Chennai|Lucknow|Allahabad|Chandigarh|Jodhpur|Jaipur|Hyderabad|Bangalore|Bengaluru)\s*[,;]?\s*(?:the|dated|dt\.?)?\s*\d/i;
  const separatorPattern = /^\.{3,}\s*\.{3,}|^-{3,}$|^_{3,}$/;

  // Check if a line is ALL CAPS with meaningful length
  const isAllCaps = (s) => {
    const letters = s.replace(/[^A-Za-z]/g, '');
    return letters.length > 3 && letters === letters.toUpperCase();
  };

  for (let i = 0; i < totalLines; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      // Keep at most a single visual blank separator between content blocks.
      if (!lastWasBlank && htmlParts.length > 0) {
        htmlParts.push('<p><br></p>');
        lastWasBlank = true;
      }
      continue;
    }

    // Skip pure separator lines (dotted separators)
    if (separatorPattern.test(trimmed)) {
      htmlParts.push(`<p style="text-align: center;">${trimmed}</p>`);
      lastWasBlank = false;
      continue;
    }

    // Court name heading (centered, bold, heading)
    if (courtPattern.test(trimmed)) {
      htmlParts.push(`<h2 style="text-align: center;"><strong>${trimmed}</strong></h2>`);
      lastWasBlank = false;
      continue;
    }

    // Case number line (centered)
    if (caseNoPattern.test(trimmed)) {
      htmlParts.push(`<p style="text-align: center;"><strong>${trimmed}</strong></p>`);
      lastWasBlank = false;
      continue;
    }

    // Versus line (centered, bold)
    if (versusPattern.test(trimmed)) {
      htmlParts.push(`<p style="text-align: center;"><strong>${trimmed}</strong></p>`);
      lastWasBlank = false;
      continue;
    }

    // ORDER / JUDGMENT heading (centered, bold, heading)
    if (orderJudgmentPattern.test(trimmed)) {
      htmlParts.push(`<h2 style="text-align: center;"><strong>${trimmed}</strong></h2>`);
      lastWasBlank = false;
      continue;
    }

    // Lines in the first 20 lines that are ALL CAPS and short (<80 chars) → likely headings
    if (i < 20 && isAllCaps(trimmed) && trimmed.length < 80) {
      htmlParts.push(`<p style="text-align: center;"><strong>${trimmed}</strong></p>`);
      lastWasBlank = false;
      continue;
    }

    // Date & place signature lines (right-aligned)
    if (dateSignPattern.test(trimmed) && i > totalLines * 0.7) {
      htmlParts.push(`<p style="text-align: right;">${trimmed}</p>`);
      lastWasBlank = false;
      continue;
    }

    // Party lines ending with "... Petitioner" / "... Respondent" etc. (right-aligned)
    if (/\.{2,}\s*(Petitioner|Respondent|Appellant|Opposite\s*Party|Applicant|Complainant|Accused|Defendant|Plaintiff)/i.test(trimmed)) {
      htmlParts.push(`<p style="text-align: right;">${trimmed}</p>`);
      lastWasBlank = false;
      continue;
    }

    // Numbered paragraphs (body text, left-aligned)
    // Default: regular paragraph
    htmlParts.push(`<p>${trimmed}</p>`);
    lastWasBlank = false;
  }

  // Avoid trailing visual blank lines.
  while (htmlParts.length > 0 && htmlParts[htmlParts.length - 1] === '<p><br></p>') {
    htmlParts.pop();
  }
  return htmlParts.join('\n');
};


export const getFileContent = async (file) => {
  try {
    let buffer;


    const cloudinaryDisabled = process.env.CLOUDINARY_DISABLE === 'true';


    const isLocalFile = file.fileUrl.startsWith('/uploads/') || !file.fileUrl.startsWith('http');

    console.log('📖 File analysis:', {
      fileUrl: file.fileUrl,
      fileType: file.fileType,
      cloudinaryDisabled,
      isLocalFile
    });

    if (cloudinaryDisabled || isLocalFile) {

      const localPath = path.join(__dirname, '..', file.fileUrl);
      console.log('📖 Reading local file:', localPath);

      if (fs.existsSync(localPath)) {
        buffer = fs.readFileSync(localPath);
        console.log('📖 File read successfully, size:', buffer.length);
      } else {
        throw new Error(`Local file not found: ${localPath}`);
      }
    } else {
      console.log('☁️ Fetching from Cloudinary:', file.fileUrl);
      buffer = await getCloudinaryBuffer(file);
    }





    if (file.fileType === 'application/pdf') {
      console.log('📄 Parsing PDF file...');
      try {
        let extractedText = '';
        let numpages = 1;

        try {
          if (isAdobePdfConfigured()) {
            console.log('📄 Forwarding PDF to Adobe PDF Services for OCR extraction...');
            const adobeResult = await extractPdfTextWithAdobe(buffer, file.fileName || 'document.pdf');
            extractedText = adobeResult.text || '';
            numpages = adobeResult.layoutDiagnostics?.pages || 1;
            console.log(`📄 PDF parsed by Adobe OCR: ${numpages} pages, ${extractedText.length} chars extracted`);
          }
        } catch (adobeErr) {
          console.warn('⚠️ Adobe PDF extraction failed, falling back:', adobeErr.message);
        }

        if (!extractedText) {
          try {
          if (!PYTHON_SERVICE_ENABLED) throw new Error('Python extractor disabled by config');
          console.log('📄 Forwarding PDF to python microservice for hybrid extraction...');
          const formData = new FormData();
          const fileBlob = new Blob([buffer], { type: 'application/pdf' });
          formData.append('file', fileBlob, file.fileName || 'document.pdf');

          const rawPythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
          const pythonServiceUrl = normalizePythonServiceUrl(rawPythonServiceUrl);
          const extractEndpoint = `${pythonServiceUrl}/api/extract`;
          console.log('🧪 [ALIGN-QA] getFileContent python endpoint debug:', {
            rawPythonServiceUrl,
            normalizedPythonServiceUrl: pythonServiceUrl,
            extractEndpoint,
            isAbsolute: isAbsoluteHttpUrl(extractEndpoint),
          });
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

          const response = await fetch(extractEndpoint, {
            method: 'POST',
            body: formData,
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (!response.ok) {
            throw new Error(`Python service responded with status ${response.status}`);
          }

          const data = await response.json();
          extractedText = data.text || '';
          numpages = data.pages || 1;

          console.log(`📄 PDF parsed by microservice: ${numpages} pages, ${extractedText.length} chars extracted`);
        } catch (microserviceError) {
          console.warn('⚠️ Python microservice extraction failed, falling back to pdf2json:', microserviceError.message);

          const { default: PDFParser } = await import('pdf2json');
          await new Promise((resolve, reject) => {
            const pdfParser = new PDFParser(this, 1); // 1 = text only

            pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
            pdfParser.on("pdfParser_dataReady", pdfData => {
              extractedText = pdfParser.getRawTextContent();
              if (pdfData && pdfData.Pages) {
                numpages = pdfData.Pages.length;
              }
              resolve();
            });

            pdfParser.parseBuffer(buffer);
          });
          console.log(`📄 PDF parsed (fallback): ${numpages} pages, ${extractedText.length} chars extracted`);
        }
        } // Close if (!extractedText)

        if (extractedText && extractedText.trim().length > 100) {
          extractedText = enhancePdfText(extractedText);

          if (!GEMINI_DISABLED) {
            console.log('🤖 AI Reconstructing PDF formatting (numbering/bullets)...');
            try {
              const prompt = `You are an expert document structural parser. Your task is to restore the structure (bullet points, numbering, lists) to the following text extracted from a PDF. 
Original PDF parsers often wipe out numbering (e.g., "1.", "a)", "i.", etc.) and bullet points.
Carefully review the text and restore its chronological, logical numbering and bulleting.
Do NOT summarize or omit ANY text. ONLY restore missing punctuation, formatting, lists, and numbers.
Return the complete text with formatting restored.

RAW TEXT:
${extractedText}
`;
              const reconstructed = await callLLMWithRetry(prompt, { maxTokens: 8192 }, 1);
              if (reconstructed && reconstructed.trim().length > extractedText.length * 0.5) {
                extractedText = reconstructed;
                console.log('✅ AI Reconstructed PDF formatting successfully.');
              }
            } catch (aiErr) {
              console.warn('⚠️ AI PDF reconstruction failed, falling back to raw text:', aiErr.message);
            }
          }

          return { text: extractedText, type: 'pdf', pages: numpages, method: 'text-extraction' };
        }

        console.log('📸 PDF appears scanned — text-based OCR not available for PDF buffers directly.');
        return {
          text: `[Scanned PDF: ${file.fileName}] - limited text extracted. Pages: ${numpages}`,
          type: 'pdf',
          pages: numpages,
          method: 'scanned',
          isScanned: true
        };
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError.message);
        return {
          text: `[PDF Error: ${file.fileName}] - ${pdfError.message}`,
          type: 'pdf',
          error: pdfError.message
        };
      }
    }





    if (file.fileType === 'text/plain' || file.fileName.endsWith('.txt')) {
      const text = buffer.toString('utf-8');
      console.log(`📝 Text file: ${text.length} chars`);
      return { text, type: 'text', method: 'direct' };
    }

    // ── RTF ──────────────────────────────────────────────────────────────
    if (
      file.fileType === 'application/rtf' ||
      file.fileType === 'text/rtf' ||
      file.fileType === 'text/richtext' ||
      file.fileType === 'application/x-rtf' ||
      file.fileName.toLowerCase().endsWith('.rtf')
    ) {
      console.log('📄 Parsing RTF file...');
      try {
        // Try rtf-parser package first (already in dependencies)
        const rtfParser = await import('rtf-parser');
        const parser = rtfParser.default || rtfParser;
        const rtfString = buffer.toString('binary');

        const text = await new Promise((resolve, reject) => {
          parser.string(rtfString, (err, doc) => {
            if (err) { reject(err); return; }

            // Recursively extract text from the parsed RTF AST
            const extractText = (node) => {
              if (!node) return '';
              if (node.type === 'text') return node.value || '';
              if (node.type === 'control') {
                if (node.word === 'par' || node.word === 'pard' || node.word === 'line') return '\n';
                if (node.word === 'tab') return '\t';
                return '';
              }
              if (Array.isArray(node.content)) {
                return node.content.map(extractText).join('');
              }
              return '';
            };

            resolve(extractText(doc).replace(/\n{3,}/g, '\n\n').trim());
          });
        });

        console.log(`📄 RTF parsed (rtf-parser): ${text.length} chars`);
        return { text, type: 'rtf', method: 'rtf-parser' };
      } catch (rtfErr) {
        console.warn('📄 rtf-parser failed, using regex strip fallback:', rtfErr.message);
        // Regex-based fallback: strip RTF control codes
        try {
          let text = buffer.toString('latin1');
          // Decode hex-encoded characters \'XX
          text = text.replace(/\\\'([0-9a-fA-F]{2})/g, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          );
          text = text.replace(/\\par\b\s*/g, '\n');
          text = text.replace(/\\pard\b\s*/g, '\n');
          text = text.replace(/\\line\b\s*/g, '\n');
          text = text.replace(/\\tab\b\s*/g, '\t');
          text = text.replace(/\\[a-zA-Z]+[-]?\d*[ ]?/g, '');
          text = text.replace(/[{}\\]/g, '');
          text = text.replace(/\n{3,}/g, '\n\n').trim();
          console.log(`📄 RTF parsed (regex fallback): ${text.length} chars`);
          return { text, type: 'rtf', method: 'regex-strip' };
        } catch (fallbackErr) {
          return {
            text: `[RTF Error: ${file.fileName}] - Could not extract text from RTF file.`,
            type: 'rtf',
            error: fallbackErr.message,
          };
        }
      }
    }

    if (file.fileType === 'text/markdown' || file.fileName.endsWith('.md')) {
      const text = buffer.toString('utf-8');
      console.log(`📝 Markdown file: ${text.length} chars`);
      return { text, type: 'markdown', method: 'direct' };
    }




    if (file.fileType === 'application/json' || file.fileName.endsWith('.json')) {
      const text = buffer.toString('utf-8');
      try {
        const parsed = JSON.parse(text);
        const formatted = JSON.stringify(parsed, null, 2);
        console.log(`📋 JSON file parsed`);
        return { text: formatted, type: 'json', method: 'parsed' };
      } catch {
        return { text, type: 'json', method: 'raw' };
      }
    }




    if (file.fileType === 'text/csv' || file.fileName.endsWith('.csv')) {
      const text = buffer.toString('utf-8');
      console.log(`📊 CSV file: ${text.length} chars`);
      return { text, type: 'csv', method: 'direct' };
    }




    if (file.fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
      file.fileType === 'application/vnd.ms-excel' ||
      file.fileName.endsWith('.xlsx') ||
      file.fileName.endsWith('.xls')) {
      console.log('📊 Parsing Excel file...');
      try {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        let allText = '';

        for (const sheetName of workbook.SheetNames) {
          const sheet = workbook.Sheets[sheetName];
          const csv = XLSX.utils.sheet_to_csv(sheet);
          allText += `\n=== Sheet: ${sheetName} ===\n${csv}\n`;
        }

        console.log(`📊 Excel parsed: ${workbook.SheetNames.length} sheets, ${allText.length} chars`);
        return {
          text: allText.trim(),
          type: 'excel',
          sheets: workbook.SheetNames,
          method: 'xlsx-parse'
        };
      } catch (xlsError) {
        console.error('Excel parsing error:', xlsError.message);
        return { text: `[Excel Error: ${file.fileName}] - ${xlsError.message}`, type: 'excel', error: xlsError.message };
      }
    }




    if (file.fileType === 'application/msword' ||
      file.fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.fileName.endsWith('.docx') ||
      file.fileName.endsWith('.doc')) {
      console.log('📄 Parsing Word document...');
      try {

        const text = await extractDocxTextStructured(buffer);
        console.log(`📄 Word doc parsed: ${text.length} chars (structure-aware)`);
        return { text, type: 'docx', method: 'docxStructureExtractor' };
      } catch (docError) {
        console.log('📄 Structure extractor failed, falling back to mammoth...');
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.default.extractRawText({ buffer });
          const text = result.value;
          console.log(`📄 Word doc parsed (mammoth fallback): ${text.length} chars`);
          return { text, type: 'docx', method: 'mammoth' };
        } catch (fallbackError) {
          const text = buffer.toString('utf-8');
          const cleanText = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
          return { text: cleanText, type: 'docx', method: 'basic-xml' };
        }
      }
    }




    if (file.fileType.startsWith('image/') ||
      file.fileName.match(/\.(jpg|jpeg|png|gif|bmp|webp)$/i)) {
      console.log('🖼️ Processing image file:', {
        fileName: file.fileName,
        mimeType: file.fileType,
        size: buffer.length
      });

      try {
        let text = '';
        let confidence = 0;
        if (isAzureOcrConfigured()) {
          console.log('🖼️ Attempting Azure OCR...');
          const azure = await extractTextWithAzureOcr(buffer, file.fileType || 'application/octet-stream');
          text = azure?.text || '';
          confidence = azure?.confidence || 0;
          console.log(`🖼️ Azure OCR complete: ${text.length} chars extracted, confidence: ${confidence}`);
        } else {
          console.log('🖼️ Attempting Tesseract OCR (fallback)...');
          const result = await Tesseract.recognize(buffer, 'eng', {
            logger: m => {
              if (m.status === 'recognizing text') {
                console.log(`🖼️ OCR progress: ${Math.round(m.progress * 100)}%`);
              }
            },
            tessedit_pageseg_mode: '3',
            tessedit_ocr_engine_mode: '1',
            preserve_interword_spaces: '1',
          });
          text = result.data.text;
          confidence = result.data.confidence || 0;
          console.log(`🖼️ Tesseract OCR complete: ${text.length} chars extracted, confidence: ${confidence}`);
        }

        if (text.trim().length < 20) {
          return {
            text: `[Image: ${file.fileName}] - Minimal text detected. The image may not contain readable text or is primarily visual.`,
            type: 'image',
            method: 'ocr-minimal',
            confidence,
            isLowConfidence: true
          };
        }

        return {
          text,
          type: 'image',
          method: 'ocr',
          confidence
        };
      } catch (ocrError) {
        console.error('🖼️ OCR error (will use fallback):', {
          message: ocrError.message,
          code: ocrError.code,
          fileName: file.fileName
        });


        return {
          text: `[Image File: ${file.fileName}]\n\nThis is an image file. OCR (Optical Character Recognition) attempted but encountered issues. The image may contain:\n• Text that wasn't clearly detected\n• Only visual content without readable text\n• Complex formatting that OCR couldn't parse\n\nYou can still discuss this image with me - describe what you see, ask questions about it, or provide additional context.`,
          type: 'image',
          method: 'ocr-fallback',
          confidence: 0,
          ocrFailed: true,
          originalError: ocrError.message
        };
      }
    }




    console.log(`❓ Unknown file type, attempting generic extraction:`, {
      fileType: file.fileType,
      fileName: file.fileName,
      size: buffer.length
    });


    try {
      const text = buffer.toString('utf-8').trim();
      if (text.length > 50) {
        console.log(`✅ Generic extraction successful: ${text.length} chars`);
        return {
          text,
          type: 'text',
          method: 'generic-text',
          warning: `File type '${file.fileType}' is not explicitly supported, but content was extracted as text.`
        };
      }
    } catch (e) {

    }


    return {
      text: `[File: ${file.fileName}]\n\nFile type: ${file.fileType}\nSize: ${buffer.length} bytes\n\nThis appears to be a binary file that cannot be processed as text. Supported formats:\n• Documents: PDF, Word (.doc/.docx), RTF (.rtf), Excel (.xls/.xlsx)\n• Text: TXT (.txt), CSV, JSON, Markdown\n• Images: JPG, PNG, GIF, WebP (with OCR)\n\nPlease upload one of the supported file types.`,
      type: 'unsupported',
      method: 'none',
      fileType: file.fileType
    };

  } catch (error) {
    console.error('Error getting file content:', error);
    return { text: null, error: error.message };
  }
};


export const uploadFile = async (req, res) => {
  try {
    const { file } = req;
    
    if (file && file.originalname) {
      // Fix multer latin1 filename mangling for UTF-8 filenames
      try {
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
      } catch (e) {
        console.warn('Failed to decode filename', e);
      }
    }


    console.log('📤 uploadFile called', {
      userId: req.user?.id,
      file: file ? {
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        encoding: file.encoding
      } : null
    });

    if (!file) {
      throw new AppError('No file uploaded', 400);
    }


    validateFile(file);

    if (!req.user || !req.user.id) {
      throw new AppError('User not authenticated', 401);
    }


    const user = await User.findById(req.user.id).select('subscriptionStatus remainingMessages').lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }


    if (!SUBSCRIPTION_DISABLED) {
      const remaining = await getRemainingMessages(req.user.id, user.subscriptionStatus);
      if (remaining !== null && remaining <= 0) {
        throw new AppError('No remaining messages. Please upgrade to premium for unlimited access.', 403);
      }
    }


    console.log('📤 Uploading file...', { fileName: file.originalname });
    const uploadResult = await uploadToCloudinaryWithRetry(file, 'chat-files');
    console.log('✅ Upload successful:', { url: uploadResult.secure_url, publicId: uploadResult.public_id });


    const newFile = new File({
      fileName: file.originalname,
      fileType: file.mimetype,
      fileSize: file.size,
      fileUrl: uploadResult.secure_url,
      publicId: uploadResult.public_id,
      uploadedBy: req.user.id
    });

    await newFile.save();

    // Run file conversion and priming in the background to avoid blocking the client upload response
    (async () => {
      try {
        const lowerType = String(file.mimetype || '').toLowerCase();
        const lowerName = String(file.originalname || '').toLowerCase();
        const isPdfUpload = lowerType.includes('pdf') || lowerName.endsWith('.pdf');
        const isDocxUpload = lowerType.includes('wordprocessingml.document') || lowerName.endsWith('.docx');

        if (isPdfUpload && isDocxConversionEnabled() && isAdobePdfConfigured()) {
          console.log('🧾 [DOCX-Pipeline] Upload-time PDF→DOCX conversion start', { fileId: String(newFile._id) });
          const docxBuffer = await exportPdfToDocxWithAdobe(file.buffer, {});
          const stored = writeDocxToLocal({ fileId: newFile._id, sessionId: newFile._id, docxBuffer });
          const docxHtml = await docxToHtml(docxBuffer);
          const extracted = stripHtmlToText(docxHtml);
          let session = await EditSession.findOne({ userId: req.user.id, fileId: newFile._id, status: 'active' });
          if (!session) {
            session = new EditSession({
              userId: req.user.id,
              fileId: newFile._id,
              fileName: file.originalname,
              fileType: file.mimetype,
              originalText: extracted || '[DOCX content pending]',
              currentText: extracted || '[DOCX content pending]',
              htmlContent: docxHtml || '',
              status: 'active',
              changes: [],
              undoPosition: -1,
            });
          }
          session.docxStatus = isDocxReadyPayload({ docxStatus: 'ready', docxHtml, docxFileUrl: stored.fileUrl }) ? 'ready' : 'failed';
          session.docxFileUrl = stored.fileUrl;
          session.docxHtml = docxHtml || '';
          session.docxError = session.docxStatus === 'ready' ? '' : 'Upload conversion produced incomplete payload';
          session.docxUpdatedAt = new Date();
          await session.save();
          console.log('✅ [DOCX-Pipeline] Upload-time PDF→DOCX conversion done', {
            fileId: String(newFile._id),
            docxStatus: session.docxStatus,
            docxFileUrl: session.docxFileUrl,
          });
        } else if (isDocxUpload) {
          const docxHtml = await docxToHtml(file.buffer);
          const extracted = stripHtmlToText(docxHtml);
          let session = await EditSession.findOne({ userId: req.user.id, fileId: newFile._id, status: 'active' });
          if (!session) {
            session = new EditSession({
              userId: req.user.id,
              fileId: newFile._id,
              fileName: file.originalname,
              fileType: file.mimetype,
              originalText: extracted || '[DOCX content pending]',
              currentText: extracted || '[DOCX content pending]',
              htmlContent: docxHtml || '',
              status: 'active',
              changes: [],
              undoPosition: -1,
            });
          }
          session.docxStatus = 'ready';
          session.docxFileUrl = newFile.fileUrl;
          session.docxHtml = docxHtml || '';
          session.docxError = '';
          session.docxUpdatedAt = new Date();
          await session.save();
          console.log('✅ [DOCX-Pipeline] Upload-time DOCX session primed', { fileId: String(newFile._id) });
        }
      } catch (primeErr) {
        console.warn('⚠️ [DOCX-Pipeline] Upload-time conversion/prime failed (non-fatal):', primeErr?.message || primeErr);
      }
    })();


    await newFile.populate('uploadedBy', 'firstName lastName email');


    await redis.del('files:all');


    const fileObj = await File.findById(newFile._id)
      .select('fileName fileType fileSize fileUrl uploadedBy createdAt')
      .populate('uploadedBy', 'firstName lastName email')
      .lean();

    console.log('✅ File record created:', { fileId: newFile._id, fileName: file.originalname });
    console.log('🧾 [DOCX-Pipeline] Upload stored. Next step: smart-scan will run PDF→DOCX if enabled.', {
      fileId: String(newFile._id),
      docxEnabled: (process.env.DOCX_CONVERSION_ENABLED || 'false').toLowerCase() === 'true',
      adobeEnabled: (process.env.ADOBE_PDF_SERVICES_ENABLED || 'false').toLowerCase() === 'true',
    });

    res.status(201).json({
      message: 'File uploaded successfully',
      file: fileObj,
      remainingMessages: ['premium', 'pro', 'departmental', 'standard'].includes(user.subscriptionStatus) ? null : user.remainingMessages,
      subscriptionStatus: user.subscriptionStatus
    });
  } catch (error) {
    console.error('❌ File upload error:', { message: error.message, stack: error.stack });



    if (error.statusCode !== 400) {

    }
    if (error.message.includes('Error uploading file') && req.file) {
      try {
        await deleteFromCloudinaryWithRetry(req.file.publicId);
      } catch (deleteError) {
        console.error('Failed to delete file after upload error:', deleteError);
      }
    }
    throw new AppError(error.message || 'Error uploading file', 500);
  }
};


export const analyzeFile = async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const { question, intentOverride, language } = req.body;

    req.preferredLanguage = language || 'en';
    const file = await File.findById(fileId).lean();

    console.log('📖 File analysis request:', {
      fileId,
      fileName: file?.fileName,
      fileType: file?.fileType,
      intentOverride,
      question: question?.substring(0, 50)
    });

    if (!file) {
      throw new AppError('File not found', 404);
    }


    if (file.uploadedBy.toString() !== req.user.id && !req.user.isAdmin) {
      throw new AppError('Unauthorized to analyze this file', 403);
    }


    console.log('📖 Extracting file content...');
    const contentResult = await getFileContent(file);
    if (!contentResult || !contentResult.text) {
      console.error('❌ File content extraction failed:', contentResult);
      throw new AppError('Could not read file content', 400);
    }

    const content = contentResult.text;
    const extractionInfo = {
      type: contentResult.type,
      method: contentResult.method,
      pages: contentResult.pages,
      sheets: contentResult.sheets,
      confidence: contentResult.confidence,
      isScanned: contentResult.isScanned,
      ocrFailed: contentResult.ocrFailed,
      warning: contentResult.warning
    };

    console.log('✅ Extraction result:', extractionInfo);


    const user = await User.findById(req.user.id).select('subscriptionStatus remainingMessages').lean();
    if (!user) {
      throw new AppError('User not found', 404);
    }


    if (!SUBSCRIPTION_DISABLED) {
      const remaining = await getRemainingMessages(req.user.id, user.subscriptionStatus);
      if (remaining !== null && remaining <= 0) {
        throw new AppError('No remaining messages. Please upgrade to premium for unlimited access.', 403);
      }

      const limit = await getMessageLimitForTier(user.subscriptionStatus);
      if (limit !== -1) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        await MessageCount.findOneAndUpdate(
          { userId: new mongoose.Types.ObjectId(req.user.id), date: today },
          { $inc: { count: 1 } },
          { upsert: true, new: true }
        );
      }
    }


    const maxContentLength = 8000;
    const truncatedContent = content.length > maxContentLength
      ? content.substring(0, maxContentLength) + '\n\n[Content truncated due to length...]'
      : content;

    console.log('📖 Content prepared for analysis:', {
      originalLength: content.length,
      truncatedLength: truncatedContent.length,
      wasTruncated: content.length > maxContentLength
    });



    let analysisPrompt;

    if (question) {

      analysisPrompt = `You are a legal document analyst. Answer the following question about this document.

Question: ${question}

Document Content:
${truncatedContent}

Provide a clear, helpful answer based on the document content. Use plain text formatting - use → for key points, • for lists, and avoid using asterisks or markdown.`;

      analysisPrompt += getLanguageInstruction(req.preferredLanguage);
    } else if (intentOverride === 'draft') {

      analysisPrompt = `You are a legal document analyst helping to draft legal documents. Extract key information from this document that would be useful for creating a new legal document.

Focus on extracting:
→ Parties Information: Names, addresses, designations of all parties
→ Key Terms: Important terms, conditions, and obligations
→ Dates & Timelines: All dates, deadlines, and time periods mentioned
→ Amounts & Consideration: Any monetary amounts, payments, or consideration
→ Specific Clauses: Notable clauses that might be reused or referenced
→ Legal References: Any acts, sections, or legal provisions cited

Document Content:
${truncatedContent}

Extract the above information in a structured format. Use → for headers, • for list items. Do NOT use asterisks or markdown formatting.`;

      analysisPrompt += getLanguageInstruction(req.preferredLanguage);
    } else if (intentOverride === 'legal' || intentOverride === null) {

      analysisPrompt = `You are a legal document analyst. Analyze this document and provide:

→ Document Type: What kind of legal document is this?
→ Key Parties: Who are the parties involved?
→ Main Terms: What are the key terms and conditions?
→ Important Dates: Any deadlines or important dates mentioned?
→ Potential Issues: Any clauses that might be concerning?
→ Summary: Brief summary of the document's purpose.

Document Content:
${truncatedContent}

Provide a structured analysis using → for section headers and • for bullet points. Do NOT use asterisks or markdown formatting.`;

      analysisPrompt += getLanguageInstruction(req.preferredLanguage);
    } else {

      analysisPrompt = `You are a helpful assistant. The user has shared a document with you. Please provide a friendly, easy-to-understand summary of what this document is about.

Document Content:
${truncatedContent}

Provide a helpful summary in plain language. Use simple formatting - no asterisks or markdown.`;

      analysisPrompt += getLanguageInstruction(req.preferredLanguage);
    }

    let analysis;


    if (GEMINI_DISABLED) {
      console.log('🤖 Analyzing with local LLaMA...', { intent: intentOverride || 'default' });
      analysis = await callLocalLLM(analysisPrompt);
    } else {

      console.log('🔮 Analyzing with Google Gemini...', { intent: intentOverride || 'default' });
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
      const result = await model.generateContent(analysisPrompt);
      analysis = result.response.text();
    }

    console.log('✅ Analysis complete:', { length: analysis.length });


    const updatedUser = await User.findById(req.user.id).select('remainingMessages subscriptionStatus').lean();

    res.json({
      success: true,
      fileName: file.fileName,
      analysis,
      extractionInfo,
      remainingMessages: ['premium', 'pro', 'departmental', 'standard'].includes(updatedUser.subscriptionStatus) ? null : updatedUser.remainingMessages,
      subscriptionStatus: updatedUser.subscriptionStatus
    });
  } catch (error) {
    console.error('❌ File analysis error:', { message: error.message, fileId: req.params.fileId });
    throw new AppError(error.message || 'Error analyzing file', 500);
  }
};


export const getUserFiles = async (req, res) => {
  try {
    const files = await File.find({ uploadedBy: req.user.id })
      .select('fileName fileType fileSize fileUrl uploadedBy createdAt')
      .sort({ createdAt: -1 })
      .lean();
    res.json(files);
  } catch (error) {
    throw new AppError(error.message || 'Error fetching user files', 500);
  }
};


export const getAllFiles = async (req, res) => {
  try {

    const cached = await redis.get('files:all');
    if (cached) {
      return res.json(JSON.parse(cached));
    }





    const files = await File.find()
      .select('fileName fileType fileSize fileUrl uploadedBy createdAt')
      .populate('uploadedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })


      .lean();


    await redis.set('files:all', JSON.stringify(files), 'EX', 120);
    res.json(files);
  } catch (error) {
    throw new AppError(error.message || 'Error fetching files', 500);
  }
};


export const deleteFile = async (req, res) => {
  try {
    const file = await File.findById(req.params.id).lean();
    if (!file) {
      throw new AppError('File not found', 404);
    }


    if (file.uploadedBy.toString() !== req.user.id && !req.user.isAdmin) {
      throw new AppError('Unauthorized to delete this file', 403);
    }


    const deleted = await deleteFromCloudinaryWithRetry(file.publicId);
    if (!deleted) {
      console.error('Failed to delete file from Cloudinary:', file.publicId);
    }


    await File.deleteOne({ _id: req.params.id });


    await redis.del('files:all');

    res.json({ message: 'File deleted successfully' });
  } catch (error) {
    throw new AppError(error.message || 'Error deleting file', 500);
  }
};


export const downloadFile = async (req, res) => {
  try {
    const filename = req.params.filename;
    if (!filename) throw new AppError('Filename required', 400);

    const path = await import('path');
    const fs = await import('fs/promises');


    const candidates = [
      path.resolve(process.cwd(), 'generated_docs', filename),
      path.resolve(process.cwd(), 'uploads', 'drafts', filename),
      path.resolve(process.cwd(), 'uploads', 'generated', filename),
      path.resolve(process.cwd(), 'uploads', filename)
    ];

    let found = null;
    for (const p of candidates) {
      try {
        const stat = await fs.stat(p);
        if (stat && stat.isFile()) { found = p; break; }
      } catch (_) { }
    }

    if (!found) {
      throw new AppError('File not found', 404);
    }


    const ext = path.extname(found).toLowerCase();
    if (ext === '.docx') {
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    } else if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(found)}"`);
    return res.sendFile(found);
  } catch (error) {
    throw new AppError(error.message || 'Error serving file', 500);
  }
};



export const startEditSession = async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const file = await File.findById(fileId).lean();

    if (!file) {
      throw new AppError('File not found', 404);
    }


    if (file.uploadedBy.toString() !== req.user.id && !req.user.isAdmin) {
      throw new AppError('Unauthorized', 403);
    }


    const contentResult = await getFileContent(file);
    if (!contentResult || !contentResult.text) {
      throw new AppError('Could not extract text from file', 400);
    }



    let docxStructure = null;
    const isDocx = (
      file.fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.fileName?.endsWith('.docx')
    );
    if (isDocx) {
      try {

        const cloudinaryBuffer = await fetch(file.fileUrl).then(r => r.arrayBuffer()).then(ab => Buffer.from(ab));
        docxStructure = await extractDocxStructure(cloudinaryBuffer);

        if (docxStructure) delete docxStructure.rawDocumentXml;
        console.log(`📄 DOCX structure extracted: ${docxStructure?.paragraphs?.length || 0} paragraphs`);
      } catch (structErr) {
        console.warn('⚠️  Could not extract DOCX structure (formatting will not be preserved on download):', structErr.message);
      }
    }

    // Generate rich HTML from DOCX structure for editor formatting preservation
    let structureHtml = '';
    if (docxStructure) {
      try {
        structureHtml = docxStructureToHtml(docxStructure);
        console.log(`📄 DOCX structure → HTML: ${structureHtml.length} chars`);
      } catch (htmlErr) {
        console.warn('⚠️  Could not convert DOCX structure to HTML:', htmlErr.message);
      }
    }

    const session = await createEditSession(
      req.user.id,
      fileId,
      contentResult.text,
      file.fileName,
      docxStructure,
      structureHtml
    );

    const sessionData = {
      extractedText: contentResult.text,
      docType: session.structure?.metadata?.type,
      risks: session.riskAnalysis?.risks || [],
      suggestions: session.riskAnalysis?.suggestions || [],
      summary: session.summary
    };

    res.json({
      success: true,
      message: 'Edit session started',
      fileName: file.fileName,
      textLength: contentResult.text.length,
      extractionMethod: contentResult.method,
      fileType: contentResult.type,

      sessionId: session.id,
      session: {
        id: session.id,
        fileName: session.fileName,
        originalText: session.originalText,
        currentText: session.currentText,
        htmlContent: session.htmlContent || '',
        changes: session.changes || [],
        createdAt: session.createdAt
      },

      documentAnalysis: {
        type: session.structure?.metadata?.type,
        title: session.structure?.metadata?.title,
        sectionCount: session.structure?.summary?.sectionCount,
        clauseCount: session.structure?.summary?.clauseCount,
        clauseTypes: session.structure?.summary?.clauseTypes,
        risks: session.riskAnalysis?.risks || [],
        suggestions: session.riskAnalysis?.suggestions || []
      }
    });


  } catch (error) {
    throw new AppError(error.message || 'Error starting edit session', 500);
  }
};

export const applyDocumentEdit = async (req, res) => {
  try {
    const { editInstruction } = req.body;

    if (!editInstruction) {
      throw new AppError('Edit instruction required', 400);
    }


    const session = await getEditSession(req.user.id);
    if (!session) {
      throw new AppError('No active edit session. Please upload a file and start editing.', 400);
    }


    const editPrompt = `You are a precise document editor. Your job is to apply ONLY the specific edit requested while preserving the ENTIRE document.

CURRENT DOCUMENT (${session.currentText.length} characters - YOU MUST PRESERVE ALL CONTENT):
${session.currentText}

EDIT INSTRUCTION:
${editInstruction}

CRITICAL RULES - FOLLOW EXACTLY:
1. PRESERVE THE ENTIRE DOCUMENT - Do NOT summarize, shorten, or remove any content
2. Apply ONLY the specific change requested (grammar, formatting, tone, etc.)
3. The output document MUST be approximately the same length as the input (within 10%)
4. Return the COMPLETE document from start to finish - every paragraph, every section
5. Do NOT skip sections with "..." or "[rest of document]"
6. If the instruction says "make formal" - only change word choice, do NOT delete content
7. If the instruction says "fix grammar" - only fix errors, do NOT rewrite or remove text
8. After the COMPLETE document, add "---CHANGE_SUMMARY---" with a brief summary

WARNING: If your output is significantly shorter than the input, you have failed. The document length must be preserved.

OUTPUT FORMAT:
[The COMPLETE edited document - every single paragraph and section]
---CHANGE_SUMMARY---
[One sentence describing what specific changes were made]`;

    let aiResponse;
    if (GEMINI_DISABLED) {
      aiResponse = await callLocalLLM(editPrompt);
    } else {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
      const result = await model.generateContent(editPrompt);
      aiResponse = result.response.text();
    }


    const parts = aiResponse.split('---CHANGE_SUMMARY---');
    let editedText = parts[0].trim();
    let changeSummary = parts[1]?.trim() || 'Changes applied';


    const originalLength = session.currentText.length;
    const newLength = editedText.length;
    const lengthRatio = newLength / originalLength;


    if (lengthRatio < 0.5 && originalLength > 500) {
      console.warn(`⚠️ AI truncated document from ${originalLength} to ${newLength} chars (${Math.round(lengthRatio * 100)}%)`);


      const simpleEdits = ['grammar', 'spelling', 'formal', 'professional'];
      const isSimpleEdit = simpleEdits.some(term => editInstruction.toLowerCase().includes(term));

      if (isSimpleEdit) {

        editedText = session.currentText;
        changeSummary = 'Edit could not be applied - AI attempted to truncate document. Please try a more specific instruction.';

        return res.json({
          success: false,
          message: 'The AI attempted to significantly shorten your document. For edits like grammar fixes or making text formal, the document length should remain similar. Please try again or use a more specific instruction.',
          originalLength,
          attemptedLength: newLength
        });
      }
    }


    const updatedSession = await applyEdit(req.user.id, editInstruction, {
      editedText,
      changeSummary
    });

    res.json({
      success: true,
      changeSummary,
      session: {
        changes: updatedSession.changes,
        changesCount: updatedSession.changes.length
      },
      textPreview: editedText.substring(0, 500) + (editedText.length > 500 ? '...' : ''),
      lengthInfo: {
        original: originalLength,
        edited: newLength,
        ratio: Math.round(lengthRatio * 100)
      }
    });
  } catch (error) {
    throw new AppError(error.message || 'Error applying edit', 500);
  }
};

export const applyManualDocumentEdit = async (req, res) => {
  try {
    const { newText, description } = req.body;

    if (!newText) {
      throw new AppError('New text is required', 400);
    }


    const session = await getEditSession(req.user.id);
    if (!session) {
      throw new AppError('No active edit session. Please upload a file and start editing.', 400);
    }


    const updatedSession = await applyEdit(req.user.id, description || 'Manual edit', {
      editedText: newText,
      changeSummary: description || 'Manual text edit'
    });

    res.json({
      success: true,
      changeSummary: description || 'Manual edit applied',
      session: {
        changes: updatedSession.changes,
        changesCount: updatedSession.changes.length
      },
      textPreview: newText.substring(0, 500) + (newText.length > 500 ? '...' : ''),
      lengthInfo: {
        original: session.currentText.length,
        edited: newText.length
      }
    });
  } catch (error) {
    throw new AppError(error.message || 'Error applying manual edit', 500);
  }
};

export const getEditStatus = async (req, res) => {
  try {
    const session = await getEditSession(req.user.id);

    if (!session) {
      return res.json({
        hasSession: false,
        message: 'No active edit session'
      });
    }

    res.json({
      hasSession: true,
      fileName: session.fileName,
      fileId: session.fileId,
      changesCount: session.changes.length,
      textLength: session.currentText.length,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    });
  } catch (error) {
    throw new AppError(error.message || 'Error getting edit status', 500);
  }
};

// Maps the extracted formatMetadata into the designConfig format expected by writeDocxFromHtml
const buildDesignConfigFromFormat = (fmt) => {
  if (!fmt) return null;

  // PDF formatMetadata may store fonts in fmt.fonts array OR fmt.defaultFont string
  const fontFamily = fmt.defaultFont ||
    (Array.isArray(fmt.fonts) && fmt.fonts[0]?.fontName) ||
    'Times New Roman';

  // Font size: PDF stores in pt, DOCX stores in pt too. Safe default: 12pt.
  const bodyFontSize = fmt.defaultFontSize || fmt.fontSize || 12;

  // Line spacing: DOCX stores as multiplier (1.0, 1.15, 1.5, 2.0). PDF may store differently.
  const lineSpacing = fmt.lineSpacing || 1.15;

  // Margins: DOCX formatMetadata stores in twips (720 = 0.5 inch).
  // PDF formatMetadata may store in points (72pt = 1 inch) or as an object with top/right/bottom/left.
  const margins = (() => {
    if (!fmt.margins) return {};
    const m = fmt.margins;
    // If values are small (< 200), they're likely in inches or points — convert to twips
    const toTwips = (val) => {
      const v = Number(val);
      if (!v || isNaN(v)) return undefined;
      if (v > 200) return v;           // ~0.13 inches (already in twips)
      if (v > 5.0) return Math.round(v * 20);      // > 5 is almost certainly points (e.g. 72pt = 1 inch -> 1440 twips)
      return Math.round(v * 1440);     // <= 5 is likely inches (e.g. 1.5in -> 2160 twips)
    };
    return {
      topTwips:    toTwips(m.top),
      rightTwips:  toTwips(m.right),
      bottomTwips: toTwips(m.bottom),
      leftTwips:   toTwips(m.left),
    };
  })();

  return {
    fontFamily,
    bodyFontSize,
    lineSpacing,
    margins,
    pageSize: fmt.pageSize?.name || 'A4',
    pageOrientation: fmt.pageSize?.orientation || 'portrait',
    bodyAlignment: fmt.bodyAlignment || 'justify',
    borderStyle: fmt.hasBorders ? fmt.borderStyle : undefined,
    borderColor: (fmt.colors?.textColor || fmt.colors?.primaryTextColor || '000000').replace('#', ''),
    headerText: fmt.headerText || undefined,
    footerText: fmt.footerText || undefined,
    headingSize: fmt.headingStyles?.Heading1?.fontSize || undefined,
    paragraphSpacing: fmt.paragraphSpacing || undefined,
  };
};


const normalizeHtmlForComparison = (html = '') =>
  String(html || '').replace(/\s+/g, ' ').trim();

export const downloadEditedDocument = async (req, res) => {
  try {
    const format = req.query.format || req.body?.format || 'docx';
    const designConfig = req.body?.designConfig || null;
    const requestedExportMode = req.query.exportMode || req.body?.exportMode || null;
    const forceRegenerateDocx = String(req.query.forceRegenerateDocx || req.body?.forceRegenerateDocx || '').toLowerCase() === 'true';

    const fileId = req.body?.fileId || req.query.fileId || null;
    console.log(`📥 Download request: format=${format}, user=${req.user.id}, hasDesign=${!!designConfig}, fileId=${fileId}, exportMode=${requestedExportMode || 'auto'}`);

    let result;

    try {

      const session = await getEditSession(req.user.id, fileId);
      if (!session || (!session.currentText && !session.htmlContent)) {
        throw new Error('No active edit session found');
      }


      const rawTitle = session.fileName?.replace(/\.[^/.]+$/, '') || 'Document';
      let title = rawTitle.replace(/_\d{10,}$/, '').replace(/_/g, ' ');


      if (session.htmlContent) {
        const h1Match = session.htmlContent.match(/<h1[^>]*>(.*?)<\/h1>/i);
        if (h1Match) {
          const cleanTitle = h1Match[1].replace(/<[^>]+>/g, '').trim();
          if (cleanTitle.length > 2 && cleanTitle.length < 120) title = cleanTitle;
        }
      } else if (session.currentText) {
        const firstLine = session.currentText.split('\n').find(l => l.trim().length > 2);
        if (firstLine && firstLine.trim().length < 120) title = firstLine.trim();
      }
      const hasHtml = session.htmlContent && session.htmlContent.trim().length > 10;
      const htmlDerivedText = hasHtml ? stripHtmlToText(session.htmlContent) : '';
      const currentText = session.currentText || '';
      const shouldPreferHtmlText = !!(htmlDerivedText && (!currentText || htmlDerivedText.length > currentText.length * 1.15));
      const effectiveText = shouldPreferHtmlText ? htmlDerivedText : currentText;
      const exportMode = requestedExportMode || session.exportMode || 'fidelity';
      const layoutPages = Array.isArray(session.layoutModel?.pages) ? session.layoutModel.pages.length : 0;
      const diag = session.scanResults?.layoutDiagnostics || null;
      let sourceLooksPdf = String(session?.fileType || '').toLowerCase().includes('pdf')
        || String(session?.fileName || '').toLowerCase().endsWith('.pdf');
      if (!sourceLooksPdf && session?.fileId) {
        try {
          const fileMeta = await File.findById(session.fileId).lean();
          sourceLooksPdf = String(fileMeta?.fileType || '').toLowerCase().includes('pdf')
            || String(fileMeta?.fileName || '').toLowerCase().endsWith('.pdf')
            || String(fileMeta?.fileUrl || '').toLowerCase().includes('.pdf');
        } catch (_) {}
      }
      const hasRawDocxReady = session.docxStatus === 'ready'
        && String(session.docxFileUrl || '').trim().length > 0
        && String(session.docxHtml || '').trim().length > 30;
      const changesCount = Array.isArray(session.changes) ? session.changes.length : 0;
      const htmlMatchesRawDocx = normalizeHtmlForComparison(session.htmlContent || '')
        === normalizeHtmlForComparison(session.docxHtml || '');
      const hasUserEdits = changesCount > 0 || !htmlMatchesRawDocx;
      console.log('🧪 [ALIGN-QA] Download mode decision:', {
        fileId,
        format,
        requestedExportMode: requestedExportMode || null,
        resolvedExportMode: exportMode,
        hasHtml,
        hasLayoutModel: !!session.layoutModel,
        layoutPages,
        confidenceLevel: diag?.confidenceLevel || 'na',
        confidenceScore: diag?.confidenceScore ?? null,
        currentTextChars: currentText.length,
        htmlDerivedTextChars: htmlDerivedText.length,
        exportTextSource: shouldPreferHtmlText ? 'htmlDerivedText' : 'currentText',
        hasRawDocxReady,
        sourceLooksPdf,
        changesCount,
        htmlMatchesRawDocx,
        hasUserEdits,
        forceRegenerateDocx,
      });

      const safeBase = title.replace(/[^a-z0-9_\s-]/gi, '').replace(/\s+/g, '_').substring(0, 40) || 'document';

      if (session.exportMode !== exportMode) {
        try { await EditSession.updateOne({ _id: session.id }, { $set: { exportMode } }); } catch (_) {}
      }

      // For PDF-origin documents, default to returning the raw converted DOCX
      // so export is byte-consistent with converter output (no generated footer/stamp/page-number drift).
      if (!result && format === 'docx' && hasRawDocxReady && sourceLooksPdf && !forceRegenerateDocx) {
        const rawDocxPath = path.join(__dirname, '..', session.docxFileUrl);
        if (fs.existsSync(rawDocxPath)) {
          result = {
            path: rawDocxPath,
            filename: path.basename(session.docxFileUrl),
          };
          console.log('✅ [DOCX-Pipeline] Returning raw converted DOCX (PDF source default)', {
            fileId,
            rawDocxPath,
            filename: result.filename,
            hasUserEdits,
          });
        } else {
          console.warn('⚠️ [DOCX-Pipeline] Raw DOCX path missing; falling back to generated export', {
            fileId,
            rawDocxPath,
          });
        }
      }

      if ((format === 'pdf') && exportMode === 'fidelity' && session.layoutModel && session.fileId) {
        try {
          const sourceFile = await File.findById(session.fileId).lean();
          const sourceUrl = String(sourceFile?.fileUrl || '');
          const looksLikePdfSource = /\.pdf(?:$|\?)/i.test(String(sourceFile?.fileName || '')) || /\.pdf(?:$|\?)/i.test(sourceUrl);
          if (sourceUrl && looksLikePdfSource) {
            const localPdfPath = sourceUrl.startsWith('/uploads/')
              ? path.join(process.cwd(), sourceUrl.replace(/^\//, ''))
              : null;
            if (localPdfPath && fs.existsSync(localPdfPath)) {
              console.log('🧪 [ALIGN-QA] Fidelity template-stamp path selected:', {
                source: sourceUrl,
                localPdfPath,
                layoutPages,
              });
              const stamped = await stampEditedPdfTemplate({
                sourcePdfPath: localPdfPath,
                layoutModel: session.layoutModel,
                editedText: effectiveText,
                fidelityEdits: session.fidelityEdits || null,
                outputDir: 'uploads/generated',
                baseName: safeBase,
              });
              if (stamped?.audit) {
                console.log('🧪 [ALIGN-QA] Selective stamp audit:', stamped.audit);
                const minFidelityScore = Number(process.env.FIDELITY_MIN_SCORE || 0.78);
                const actualScore = Number(stamped.audit?.fidelityScore || 0);
                if (Number.isFinite(minFidelityScore) && actualScore < minFidelityScore) {
                  throw new Error(
                    `Fidelity score below threshold: ${actualScore} < ${minFidelityScore} ` +
                    `(pageCoverage=${stamped.audit?.pageCoverage}, styleCoverage=${stamped.audit?.styleCoverage})`
                  );
                }
              }
              result = { path: stamped.path, filename: stamped.filename };
            }
          }
        } catch (stampErr) {
          console.warn('⚠️ Template-stamp export failed, falling back to generator path:', {
            message: stampErr.message,
            stackTop: stampErr.stack?.split('\n')?.[0] || null,
          });
        }
      }

      if (
        !result &&
        PYTHON_SERVICE_ENABLED &&
        (format === 'docx' || format === 'pdf') &&
        exportMode === 'fidelity' &&
        session.layoutModel
      ) {
        try {
          const rawPythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
          const pythonServiceUrl = normalizePythonServiceUrl(rawPythonServiceUrl);
          const generateEndpoint = `${pythonServiceUrl}/api/generate`;
          const healthEndpoint = `${pythonServiceUrl}/health`;
          console.log('🧪 [ALIGN-QA] Python fidelity endpoint debug:', {
            rawPythonServiceUrl,
            normalizedPythonServiceUrl: pythonServiceUrl,
            generateEndpoint,
            healthEndpoint,
            isGenerateAbsolute: isAbsoluteHttpUrl(generateEndpoint),
          });

          try {
            const healthRes = await fetch(healthEndpoint, { method: 'GET' });
            console.log('🧪 [ALIGN-QA] Python fidelity health:', { status: healthRes.status, ok: healthRes.ok });
          } catch (healthErr) {
            console.warn('🧪 [ALIGN-QA] Python fidelity health check failed:', {
              message: healthErr.message,
              stackTop: healthErr.stack?.split('\n')?.[0] || null,
            });
          }

          console.log('🧪 [ALIGN-QA] Python fidelity request:', {
            endpoint: generateEndpoint,
            textChars: effectiveText.length,
            htmlChars: hasHtml ? (session.htmlContent || '').length : 0,
            metadataKeys: Object.keys(session.formatMetadata || {}),
            layoutPages,
            exportMode,
          });
          const pyRes = await fetch(generateEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: effectiveText || '',
              html: hasHtml ? session.htmlContent : null,
              metadata: session.formatMetadata || null,
              preserve_layout: true,
              layout: session.layoutModel || null,
              export_mode: exportMode,
            }),
          });
          if (!pyRes.ok) throw new Error(`Python generate failed: ${pyRes.status}`);
          console.log('🧪 [ALIGN-QA] Python fidelity response headers:', {
            status: pyRes.status,
            layoutMode: pyRes.headers.get('X-Layout-Mode') || 'na',
            layoutConfidence: pyRes.headers.get('X-Layout-Confidence') || 'na',
            layoutParagraphs: pyRes.headers.get('X-Layout-Paragraphs') || 'na',
            layoutTables: pyRes.headers.get('X-Layout-Tables') || 'na',
          });
          const docxBuffer = Buffer.from(await pyRes.arrayBuffer());
          if (format === 'docx') {
            const genDir = path.join(process.cwd(), 'uploads', 'generated');
            if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
            const filename = `${safeBase}_edited_${Date.now()}.docx`;
            const outPath = path.join(genDir, filename);
            fs.writeFileSync(outPath, docxBuffer);
            result = { path: outPath, filename };
          } else {
            const pdfResult = await generatePdfFromDocx({
              docxBuffer,
              text: effectiveText,
              htmlContent: session.htmlContent,
              title,
              baseName: safeBase,
              designConfig: designConfig || (session.formatMetadata ? buildDesignConfigFromFormat(session.formatMetadata) : null),
              skipTitle: true,
            });
            result = { path: pdfResult.path, filename: pdfResult.filename };
          }
        } catch (pyErr) {
          console.warn('⚠️ Python fidelity generation failed, using existing generator:', {
            message: pyErr.message,
            stackTop: pyErr.stack?.split('\n')?.[0] || null,
            exportMode,
            format,
            hasLayoutModel: !!session.layoutModel,
            layoutPages,
          });
        }
      }


      if (!result && format === 'docx' && hasHtml && exportMode === 'fidelity') {
        console.log('🧪 [ALIGN-QA] Fallback path: html->docx fidelity generator');
        console.log('📄 Generating DOCX from TipTap HTML...');
        const fmtFallback = session.formatMetadata ? buildDesignConfigFromFormat(session.formatMetadata) : null;
        const { filePath: genPath, filename: genName } = await writeDocxFromHtml(
          session.htmlContent,
          title,
          'uploads/generated',
          designConfig || fmtFallback
        );
        result = { path: genPath, filename: genName };
      }

      else if (!result && format === 'docx' && (designConfig || exportMode === 'editable')) {
        console.log('🧪 [ALIGN-QA] Fallback path: text->docx editable generator');
        console.log('📄 Generating styled DOCX with design config...');
        const editableDesign = exportMode === 'editable' ? { ...(designConfig || {}), paragraphSpacing: { before: 0, after: 60 } } : designConfig;
        const { filePath, fileSize } = await writeDocxFromText(
          effectiveText,
          title,
          'uploads/generated',
          editableDesign,
          true
        );
        result = { path: filePath, filename: path.basename(filePath) };
      }

      else if (!result && format === 'pdf' && hasHtml && exportMode === 'editable') {
        console.log(`🧪 [ALIGN-QA] Fallback path: html->docx->pdf ${exportMode} generator`);
        console.log('📄 Generating PDF from TipTap HTML (HTML → DOCX → PDF)...');
        const pdfFmtFallback = session.formatMetadata ? buildDesignConfigFromFormat(session.formatMetadata) : null;
        const editableDesign = exportMode === 'editable'
          ? { ...(designConfig || pdfFmtFallback || {}), paragraphSpacing: { before: 0, after: 60 } }
          : (designConfig || pdfFmtFallback);
        const pdfDesignConfig = editableDesign;
        const { filePath: docxPath } = await writeDocxFromHtml(
          session.htmlContent,
          title,
          'uploads/generated',
          pdfDesignConfig
        );
        const docxBuffer = fs.readFileSync(docxPath);
        const pdfResult = await generatePdfFromDocx({
          docxBuffer,
          text: effectiveText,
          htmlContent: session.htmlContent,
          title,
          baseName: safeBase,
          designConfig: pdfDesignConfig,
          skipTitle: true,
        });

        try { fs.unlinkSync(docxPath); } catch (_) { }
        result = { path: pdfResult.path, filename: pdfResult.filename };
      }

      else if (!result && format === 'pdf' && exportMode === 'editable' && (designConfig || exportMode === 'editable')) {
        console.log('🧪 [ALIGN-QA] Fallback path: text->docx->pdf editable generator');
        console.log('📄 Generating styled PDF with design config (text → DOCX → PDF)...');
        const editableDesign = exportMode === 'editable' ? { ...(designConfig || {}), paragraphSpacing: { before: 0, after: 60 } } : designConfig;
        const { filePath: docxPath } = await writeDocxFromText(
          effectiveText,
          title,
          'uploads/generated',
          editableDesign,
          true
        );
        const docxBuffer = fs.readFileSync(docxPath);
        const pdfResult = await generatePdfFromDocx({
          docxBuffer,
          text: effectiveText,
          htmlContent: session.htmlContent,
          title,
          baseName: safeBase,
          designConfig: editableDesign,
          skipTitle: true,
        });
        result = { path: pdfResult.path, filename: pdfResult.filename };
      } else if (!result) {
        if (format === 'pdf' && exportMode === 'fidelity') {
          throw new AppError(
            'Fidelity PDF export requires template-stamp pipeline. Missing layout/source prevented safe fidelity export.',
            400
          );
        }
        switch (format) {
          case 'pdf':
            console.log('📄 Generating PDF...');
            result = await generatePdf(req.user.id);
            break;
          case 'rtf':
            console.log('📄 Generating RTF...');
            result = await generateRtf(req.user.id);
            break;
          case 'md':
          case 'markdown':
            console.log('📄 Generating Markdown...');
            result = await generateMarkdown(req.user.id);
            break;
          case 'html':
            console.log('📄 Generating HTML...');
            result = await generateHtml(req.user.id);
            break;
          default:
            console.log('📄 Generating DOCX...');
            result = await generateDocx(req.user.id);
        }
      }
    } catch (genError) {
      console.error('❌ Document generation failed:', genError.message);
      return res.status(500).json({
        success: false,
        message: genError.message || 'Failed to generate document'
      });
    }

    console.log(`📄 Generated: ${result.filename}, path: ${result.path}`);


    if (!fs.existsSync(result.path)) {
      console.error('❌ Generated file not found:', result.path);
      return res.status(500).json({
        success: false,
        message: 'Generated file not found'
      });
    }


    const fileBuffer = fs.readFileSync(result.path);
    console.log(`📄 File size: ${fileBuffer.length} bytes`);

    if (fileBuffer.length === 0) {
      console.error('❌ Generated file is empty');
      return res.status(500).json({
        success: false,
        message: 'Generated file is empty'
      });
    }


    const contentTypes = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      rtf: 'application/rtf',
      html: 'text/html',
      md: 'text/markdown',
      markdown: 'text/markdown'
    };
    const contentType = contentTypes[format] || contentTypes.docx;


    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`);
    res.setHeader('Content-Length', fileBuffer.length);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    res.setHeader('X-Content-Type-Options', 'nosniff');

    console.log(`✅ Sending file: ${result.filename} (${fileBuffer.length} bytes, ${contentType})`);


    return res.send(fileBuffer);
  } catch (error) {
    console.error('❌ Download error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Error generating document'
    });
  }
};

export const getDocumentStructure = async (req, res) => {
  try {
    const analysis = await getDocumentAnalysis(req.user.id);

    if (!analysis) {
      return res.json({
        hasSession: false,
        message: 'No active edit session'
      });
    }

    res.json({
      success: true,
      ...analysis
    });
  } catch (error) {
    throw new AppError(error.message || 'Error getting document analysis', 500);
  }
};

export const clearDocumentEditSession = async (req, res) => {
  try {
    await clearEditSession(req.user.id);

    res.json({
      success: true,
      message: 'Edit session cleared'
    });
  } catch (error) {
    throw new AppError(error.message || 'Error clearing session', 500);
  }
};



export const undoDocumentEdit = async (req, res) => {
  try {
    const result = await undoEdit(req.user.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Undo successful',
      session: result.session,
      canUndo: result.canUndo,
      canRedo: result.canRedo
    });
  } catch (error) {
    throw new AppError(error.message || 'Error undoing edit', 500);
  }
};

export const redoDocumentEdit = async (req, res) => {
  try {
    const result = await redoEdit(req.user.id);

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json({
      success: true,
      message: 'Redo successful',
      session: result.session,
      canUndo: result.canUndo,
      canRedo: result.canRedo
    });
  } catch (error) {
    throw new AppError(error.message || 'Error redoing edit', 500);
  }
};

export const getUndoRedoState = async (req, res) => {
  try {
    const state = await getUndoRedoStateService(req.user.id);
    res.json(state);
  } catch (error) {
    throw new AppError(error.message || 'Error getting undo/redo state', 500);
  }
};

export const autosaveDocument = async (req, res) => {
  try {
    const { text, commit } = req.body;

    if (!text) {
      return res.status(400).json({ success: false, message: 'Text required' });
    }

    let result;
    if (commit) {

      await autosave(req.user.id, text);
      result = await commitAutosave(req.user.id, 'Manual edits');
    } else {

      result = await autosave(req.user.id, text);
    }

    if (!result) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    res.json({
      success: true,
      message: commit ? 'Changes committed' : 'Autosaved',
      lastAutosave: result.lastAutosave
    });
  } catch (error) {
    throw new AppError(error.message || 'Error autosaving', 500);
  }
};

export const getDiffBetweenVersions = async (req, res) => {
  try {
    const from = parseInt(req.query.from) || 0;
    const to = parseInt(req.query.to) || -1;

    const diff = await getDiffService(req.user.id, from, to);

    if (!diff) {
      return res.status(400).json({ success: false, message: 'No active session' });
    }

    res.json({
      success: true,
      ...diff
    });
  } catch (error) {
    throw new AppError(error.message || 'Error getting diff', 500);
  }
};

export const getUserEditSessions = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const sessions = await getUserSessions(req.user.id, limit);

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    throw new AppError(error.message || 'Error getting sessions', 500);
  }
};

export const loadEditSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await loadSession(req.user.id, sessionId);

    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }

    res.json({
      success: true,
      session
    });
  } catch (error) {
    throw new AppError(error.message || 'Error loading session', 500);
  }
};

export const fillTemplateVariables = async (req, res) => {
  try {
    const { variables } = req.body;

    if (!variables || typeof variables !== 'object') {
      return res.status(400).json({ success: false, message: 'Variables object required' });
    }

    const session = await fillVariablesService(req.user.id, variables);

    res.json({
      success: true,
      message: 'Variables filled',
      session
    });
  } catch (error) {
    throw new AppError(error.message || 'Error filling variables', 500);
  }
};

export const saveFilledFieldValues = async (req, res) => {
  try {
    const { fileId, filledValues } = req.body;
    if (!filledValues || typeof filledValues !== 'object') {
      return res.status(400).json({ success: false, message: 'filledValues object required' });
    }
    const userId = req.user.id;
    const query = fileId
      ? { userId, fileId, status: 'active' }
      : { userId, status: 'active' };
    const session = await EditSession.findOne(query).sort({ updatedAt: -1 });
    if (!session) {
      return res.status(404).json({ success: false, message: 'No active session found' });
    }
    session.filledFieldValues = filledValues;
    await session.save();
    res.json({ success: true, message: 'Field values saved' });
  } catch (error) {
    throw new AppError(error.message || 'Error saving field values', 500);
  }
};

export const applyChunkedDocumentEdit = async (req, res) => {
  try {
    const { editInstruction } = req.body;

    if (!editInstruction) {
      throw new AppError('Edit instruction required', 400);
    }

    const session = await getEditSession(req.user.id);
    if (!session) {
      throw new AppError('No active edit session', 400);
    }


    const CHUNK_THRESHOLD = 3000;

    if (session.currentText.length < CHUNK_THRESHOLD) {

      return applyDocumentEdit(req, res);
    }


    const chunks = splitIntoChunks(session.currentText, 2000);
    console.log(`📝 Processing ${chunks.length} chunks for large document edit`);

    const processedChunks = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`   → Processing chunk ${i + 1}/${chunks.length}`);

      const chunkPrompt = `You are editing PART ${i + 1} of ${chunks.length} of a larger document.
Apply this edit instruction to ONLY this section, preserving all content:

EDIT INSTRUCTION: ${editInstruction}

SECTION TO EDIT:
${chunk.text}

Return ONLY the edited section. Do NOT summarize or shorten. Preserve length.`;

      let editedChunk;
      if (GEMINI_DISABLED) {
        editedChunk = await callLocalLLM(chunkPrompt);
      } else {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
        const result = await model.generateContent(chunkPrompt);
        editedChunk = result.response.text();
      }

      processedChunks.push({
        index: chunk.index,
        text: editedChunk.trim()
      });
    }


    const editedText = reassembleChunks(processedChunks);


    const updatedSession = await applyEdit(req.user.id, editInstruction, {
      editedText,
      changeSummary: `${editInstruction} (processed in ${chunks.length} chunks)`
    }, 'ai_edit');

    res.json({
      success: true,
      changeSummary: `Applied edit across ${chunks.length} sections`,
      session: {
        changes: updatedSession.changes,
        changesCount: updatedSession.changes.length
      },
      chunksProcessed: chunks.length
    });
  } catch (error) {
    throw new AppError(error.message || 'Error applying chunked edit', 500);
  }
};

const detectBlanksFromText = (text) => {
  const fields = [];
  const seen = new Set();
  // Pattern 1: label before underscores — "Name ____" or "S/o ____" or "D/o. ____"
  const labelPattern = /([A-Za-z][A-Za-z0-9\s,./\-'()]{1,50}?)\s*_{3,}/g;
  let m;
  while ((m = labelPattern.exec(text)) !== null) {
    const raw = m[1].trim().split(/\s+/).filter(Boolean).slice(-4).join(' ');
    if (!raw || raw.length < 2) continue;
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!seen.has(key) && key.length > 1) {
      seen.add(key);
      fields.push({ key, label: raw, type: 'text', required: true });
    }
  }
  // Pattern 2: label before dotted blanks — "Name ......" or "Address .\.\.\.\."
  const dottedPattern = /([A-Za-z][A-Za-z0-9\s,./\-'()]{1,50}?)\s*\.{4,}/g;
  while ((m = dottedPattern.exec(text)) !== null) {
    const raw = m[1].trim().split(/\s+/).filter(Boolean).slice(-4).join(' ');
    if (!raw || raw.length < 2) continue;
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!seen.has(key) && key.length > 1) {
      seen.add(key);
      fields.push({ key, label: raw, type: 'text', required: true });
    }
  }
  // Pattern 3: standalone underscores (no preceding label)
  const standalonePattern = /(?<![A-Za-z0-9])_{4,}(?![A-Za-z0-9_])/g;
  while ((m = standalonePattern.exec(text)) !== null) {
    const key = `blank_${fields.length + 1}`;
    if (!seen.has(key)) {
      seen.add(key);
      fields.push({ key, label: `Field ${fields.length + 1}`, type: 'text', required: false });
    }
  }
  // Pattern 4: standalone dotted lines
  const standaloneDots = /(?<![A-Za-z0-9])\.{6,}(?![A-Za-z0-9])/g;
  while ((m = standaloneDots.exec(text)) !== null) {
    const key = `blank_${fields.length + 1}`;
    if (!seen.has(key)) {
      seen.add(key);
      fields.push({ key, label: `Field ${fields.length + 1}`, type: 'text', required: false });
    }
  }
  return fields;
};

// Detect blank fields from HTML — handles Word's underline-formatted blanks rendered as <u>   </u>
const detectBlanksFromHtml = (html) => {
  const fields = [];
  const seen = new Set();
  // Convert <u> tags containing only whitespace/&nbsp; into ___BLANK___ markers
  const marked = html.replace(/<u>([^<]*)<\/u>/gi, (full, inner) => {
    const stripped = inner.replace(/&nbsp;/g, ' ').replace(/\s/g, '');
    return stripped.length === 0 ? ' ___BLANK___ ' : full;
  });
  // Strip remaining HTML tags to get plain text with ___BLANK___ markers
  const text = marked.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  // Pattern: label immediately before a ___BLANK___ marker
  const underlinePattern = /([A-Za-z][A-Za-z0-9\s,./\-'()]{1,50}?)\s*___BLANK___/g;
  let m;
  while ((m = underlinePattern.exec(text)) !== null) {
    const raw = m[1].trim().split(/\s+/).filter(Boolean).slice(-4).join(' ');
    if (!raw || raw.length < 2) continue;
    const key = raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!seen.has(key) && key.length > 1) {
      seen.add(key);
      fields.push({ key, label: raw, type: 'text', required: true });
    }
  }
  // Standalone blanks without a label
  const blanks = (text.match(/___BLANK___/g) || []).length;
  for (let i = fields.length; i < blanks; i++) {
    const key = `blank_${i + 1}`;
    if (!seen.has(key)) {
      seen.add(key);
      fields.push({ key, label: `Field ${i + 1}`, type: 'text', required: false });
    }
  }
  return fields;
};


// ── Smart Field Extraction for Complete Documents ─────────────────────────────
// When a document has no blanks (complete/filled), use LLM to identify all
// existing field values so the user can review and modify them before editing.
const extractDocumentFields = async (plainText, docType) => {
  const snippet = plainText.length > 6000
    ? plainText.substring(0, 3000) + '\n\n[...]\n\n' + plainText.substring(plainText.length - 2000)
    : plainText;

  const prompt = `You are an expert Indian legal document analyst. This is a COMPLETE legal document (no blank fields). Your task is to extract ALL identifiable data fields from it so the user can review and modify them.

Document type: ${docType || 'Legal Document'}

Extract every identifiable field and return a JSON array. Group fields into these categories:
- "parties" — petitioner/plaintiff name, respondent/defendant name, advocate names, father/husband name, represented-through details
- "court_details" — court name, bench, case number, case type, filing date, next hearing date
- "personal_details" — addresses, occupations, ages, nationalities, ID numbers, phone/email
- "financial_property" — amounts, property descriptions, survey numbers, consideration amounts
- "dates" — all significant dates (filing, incident, hearing, execution, birth dates)
- "sections_acts" — cited sections and act references (for context, not usually edited)

Return ONLY a JSON array:
[
  { "key": "petitioner_name", "label": "Petitioner Name", "value": "exact text from document", "category": "parties", "type": "text" },
  { "key": "court_name", "label": "Court Name", "value": "exact text from document", "category": "court_details", "type": "text" },
  ...
]

STRICT RULES:
1. The "value" field MUST be the EXACT text as it appears in the document — verbatim, no paraphrasing.
2. Only extract fields whose values actually appear in the document text.
3. Use "type": "date" for date fields, "text" for everything else.
4. Use snake_case keys (e.g., "petitioner_name", "case_number", "filing_date").
5. Extract at least party names, court details, and case numbers if present.
6. For litigation documents (petitions, plaints, appeals): focus heavily on parties, advocates, court, case details.
7. For transactional documents (deeds, agreements): focus on parties, property details, amounts, dates.
8. Do NOT include fields from the "sections_acts" category unless they are specific section citations with numbers.
9. Return [] if you cannot identify any fields.
10. Return ONLY the JSON array — no markdown, no explanation.

DOCUMENT:
${snippet}`;

  try {
    const raw = await callLLMWithRetry(prompt, { temperature: 0, maxTokens: 4000 });
    const arrIdx = (raw || '').indexOf('[');
    if (arrIdx < 0) return [];
    const parsed = JSON.parse(raw.substring(arrIdx, raw.lastIndexOf(']') + 1));
    if (!Array.isArray(parsed)) return [];

    const validCategories = ['parties', 'court_details', 'personal_details', 'financial_property', 'dates', 'sections_acts'];
    const textLower = plainText.toLowerCase();

    // Anti-hallucination: each value must appear verbatim in the document
    return parsed
      .filter(f => f && f.key && f.value && typeof f.value === 'string' && f.value.trim().length > 1)
      .filter(f => {
        const valueLower = f.value.trim().toLowerCase();
        // Check exact presence in document (allow minor whitespace differences)
        const normalized = valueLower.replace(/\s+/g, ' ');
        return textLower.includes(normalized) || textLower.includes(valueLower);
      })
      .map(f => ({
        key: String(f.key).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
        label: String(f.label || f.key),
        value: String(f.value).trim(),
        category: validCategories.includes(f.category) ? f.category : 'personal_details',
        type: f.type === 'date' ? 'date' : 'text',
      }))
      .slice(0, 30); // cap at 30 fields
  } catch (err) {
    console.warn('[extractDocumentFields] LLM field extraction failed:', err.message);
    return [];
  }
};

// ── AI Discover Precedents ────────────────────────────────────────────────────
const discoverPrecedentsForDocument = async (docType, extractedParties, statutesReferenced, docSnippet) => {
  const statuteList = (statutesReferenced || []).map(s => `${s.name}${s.sections ? ` (${s.sections})` : ''}`).join('; ');
  const courtName = extractedParties?.court || '';
  const prompt = `You are a senior Indian legal advocate. Given:
- Document type: "${docType || 'legal document'}"
- Court: "${courtName}"
- Statutes involved: ${statuteList || 'Not specified'}
${docSnippet ? `- Document excerpt: "${docSnippet.substring(0, 500)}"` : ''}

List 5-8 REAL landmark Indian Supreme Court or High Court cases that are commonly cited and directly relevant to this type of document and the legal issues involved.

Return ONLY a JSON array (no markdown fences, no text outside):
[{"caseName":"Full Case Name v. Respondent","citation":"(Year) Volume SCC Page or AIR citation, or empty string if unknown","relevance":"Why this case is relevant","summary":"One sentence summary of the holding","court":"Supreme Court of India / specific High Court","principle":"Key legal principle established"}]

STRICT RULES:
1. Only include REAL cases that actually exist — no fabricated case names or citations.
2. The cases must be RELEVANT to this specific document type and legal issues.
3. Include a mix: some directly on-point, some on procedural aspects.
4. Prefer landmark/frequently-cited cases.
5. If citation is unknown, use empty string — NEVER invent a citation.`;

  try {
    const raw = await callLLMWithRetry(prompt, { temperature: 0.1, maxTokens: 3000 });
    const match = (raw || '').match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 8).map(c => ({
      caseName: String(c.caseName || ''),
      citation: String(c.citation || ''),
      relevance: String(c.relevance || ''),
      summary: String(c.summary || ''),
      court: String(c.court || ''),
      principle: String(c.principle || ''),
    })).filter(c => c.caseName.length > 5);
  } catch (err) {
    console.warn('[discoverPrecedents] Failed:', err.message);
    return [];
  }
};


const isDocxConversionEnabled = () => (process.env.DOCX_CONVERSION_ENABLED || 'false').toLowerCase() === 'true';

const ensureConvertedDir = () => {
  const dir = path.join(__dirname, '..', 'uploads', 'converted');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const writeDocxToLocal = ({ fileId, sessionId, docxBuffer }) => {
  const dir = ensureConvertedDir();
  const safeFileId = String(fileId || 'file').replace(/[^\w-]/g, '');
  const safeSessionId = String(sessionId || 'session').replace(/[^\w-]/g, '');
  const fileName = `${safeFileId}_${safeSessionId}.docx`;
  const diskPath = path.join(dir, fileName);
  fs.writeFileSync(diskPath, docxBuffer);
  return { fileUrl: `/uploads/converted/${fileName}`, diskPath };
};

const isDocxReadyPayload = ({ docxStatus, docxHtml, docxFileUrl }) => (
  String(docxStatus || '') === 'ready' &&
  String(docxFileUrl || '').trim().length > 0
);

const isDocxUsableForOnlyOffice = (sessionLike = {}) => (
  String(sessionLike?.docxFileUrl || '').trim().length > 0
);

const getPublicBaseUrl = (req) => {
  const fromEnv = String(process.env.BACKEND_PUBLIC_URL || process.env.PUBLIC_BASE_URL || '').trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http');
  const host = String(req.headers['x-forwarded-host'] || req.get('host') || 'localhost:5000');
  return `${proto}://${host}`.replace(/\/+$/, '');
};

const toPublicUrl = (req, maybeRelativeUrl = '') => {
  const u = String(maybeRelativeUrl || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return `${getPublicBaseUrl(req)}${u.startsWith('/') ? u : `/${u}`}`;
};

// ─────────────────────────────────────────────────────────────────────────────

export const smartScan = async (req, res) => {
  try {
    const scanStartedAt = Date.now();
    const elapsedMs = () => Date.now() - scanStartedAt;
    const remainingMs = () => Math.max(0, SMART_SCAN_BUDGET_MS - elapsedMs());
    const canRunOptional = (reserveMs = 12000) => remainingMs() > reserveMs;
    const stepTimeout = (preferredMs, minMs = 5000) => {
      const r = remainingMs() - 1500;
      if (r <= minMs) return minMs;
      return Math.max(minMs, Math.min(preferredMs, r));
    };
    const completedSteps = [];
    let skippedOptionalDueToBudget = false;
    console.log('🧪 [ALIGN-QA] SmartScan budget:', { budgetMs: SMART_SCAN_BUDGET_MS });

    const { fileId } = req.params;
    const userId = req.user.id;


    const file = await File.findById(fileId);
    if (!file) {
      throw new AppError('File not found', 404);
    }


    if (file.uploadedBy.toString() !== userId && !req.user.isAdmin) {
      throw new AppError('Unauthorized', 403);
    }


    let session = await EditSession.findOne({ userId, fileId, status: 'active' });


    if (session && session.scanLocked && session.scanStatus === 'scanned') {
      console.log('[SmartScan] Scan is locked — returning cached results for', file.fileName);
      return res.json({
        success: true,
        scanStatus: 'scanned',
        scanLocked: true,
        fileName: file.fileName,
        fileType: session.fileType,
        formatMetadata: session.formatMetadata,
        htmlContent: session.htmlContent,
        markdownHtml: session.markdownHtml || null,
        geminiHtml: session.geminiHtml || null,
        docxStatus: session.docxStatus || 'none',
        docxHtml: session.docxHtml || '',
        docxFileUrl: session.docxFileUrl || '',
        fontCache: session.fontCache || null,
        scanResults: session.scanResults,
        smartSuggestions: session.smartSuggestions || [],
        ocrText: session.ocrText || undefined,
        ocrConfidence: session.ocrConfidence || undefined,
        layoutModel: session.layoutModel || null,
        documentGraph: session.documentGraph || null,
        fidelityEdits: session.fidelityEdits || null,
        fidelityOffsets: session.fidelityOffsets || null,
        fidelityObjectEdits: session.fidelityObjectEdits || null,
        exportMode: session.exportMode || 'fidelity',
        textLength: (session.originalText || '').length,
        sessionId: session._id,
        detectedDocType: session.detectedDocType || '',
        extractedParties: session.extractedParties || null,
        precedenceAnalysis: session.precedenceAnalysis || [],
        statutesReferenced: session.statutesReferenced || [],
        complianceIssues: session.complianceIssues || [],
        clauseFlaws: session.clauseFlaws || [],
        missingClauses: session.missingClauses || [],
        chronologicalIssues: session.chronologicalIssues || [],
        outdatedReferences: session.outdatedReferences || [],
        internalContradictions: session.internalContradictions || [],
        governmentCompliance: session.governmentCompliance || null,
        matchedTemplateId: session.matchedTemplateId || '',
        matchedTemplateFields: session.matchedTemplateFields || null,
        matchedTemplateConfidence: session.matchedTemplateConfidence || '',
        detectedBlankFields: session.detectedBlankFields || null,
        extractedDocumentFields: session.extractedDocumentFields || null,
        isCompleteDocument: session.isCompleteDocument || false,
        aiSuggestedPrecedents: session.aiSuggestedPrecedents || [],
      });
    }


    if (session) {
      session.scanStatus = 'scanning';
      await session.save();
    }


    let buffer;
    const cloudinaryDisabled = process.env.CLOUDINARY_DISABLE === 'true';
    const isLocalFile = file.fileUrl.startsWith('/uploads/') || !file.fileUrl.startsWith('http');

    if (cloudinaryDisabled || isLocalFile) {
      const localPath = path.join(__dirname, '..', file.fileUrl);
      if (fs.existsSync(localPath)) {
        buffer = fs.readFileSync(localPath);
      } else {
        throw new AppError(`File not found on disk: ${file.fileName}`, 404);
      }
    } else {
      try {
        console.log('☁️ SmartScan: Fetching from Cloudinary:', file.fileUrl);
        buffer = await getCloudinaryBuffer(file);
        console.log(`☁️ SmartScan: Fetched ${buffer.length} bytes`);
      } catch (fetchErr) {
        const status = fetchErr.response?.status;
        console.error('☁️ Cloudinary fetch failed:', { status, url: file.fileUrl, msg: fetchErr.message });
        throw new AppError(`Failed to fetch file from cloud (HTTP ${status || 'ERR'}: ${file.fileName})`, 500);
      }
    }


    let formatMetadata = null;
    let htmlContent = '';
    let markdownHtml = '';
    let geminiHtml = '';
    let extractedText = '';
    let ocrText = '';
    let ocrConfidence = 0;
    let layoutModel = null;
    let documentGraph = null;
    let layoutDiagnostics = null;
    let exportMode = 'editable';
    let sourcePdfPages = null;
    let docxStatus = 'none';
    let docxHtml = '';
    let docxFileUrl = '';
    let docxError = '';

    const fileType = file.fileType?.toLowerCase() || '';
    const fileName = file.fileName?.toLowerCase() || '';

    // ── PDF→DOCX (primary editable source) ──────────────────────────────────
    // If enabled, convert PDF to DOCX first and use DOCX→HTML for the editable window.
    if (fileType === 'application/pdf' && isDocxConversionEnabled() && isAdobePdfConfigured()) {
      try {
        console.log('🧾 [DOCX-Pipeline] Starting PDF→DOCX conversion (SmartScan)', {
          fileId,
          fileName: file.fileName,
          ocrLocale: process.env.ADOBE_PDF_EXPORT_OCR_LOCALE || 'EN_US',
        });
        const startedAt = Date.now();
        docxStatus = 'pending';
        if (session) {
          session.docxStatus = 'pending';
          session.docxError = '';
          session.docxUpdatedAt = new Date();
          await session.save();
        }

        const docxBuffer = await withTimeout(
          () => exportPdfToDocxWithAdobe(buffer, {}),
          stepTimeout(60000, 20000),
          'exportPdfToDocxWithAdobe'
        );

        const stored = writeDocxToLocal({ fileId, sessionId: session?._id || 'new', docxBuffer });
        docxFileUrl = stored.fileUrl;
        docxStatus = 'ready';

        // DOCX → HTML (best editable fidelity)
        formatMetadata = await extractDocxFormatting(docxBuffer);
        try {
          const structure = await extractDocxStructure(docxBuffer);
          if (structure) {
            docxHtml = docxStructureToHtml(structure);
            extractedText = structure.plainText || extractedText;
          }
        } catch (_) {}
        if (!docxHtml) docxHtml = await docxToHtml(docxBuffer);
        if (docxHtml) htmlContent = docxHtml;
        if (!isDocxReadyPayload({ docxStatus: 'ready', docxHtml, docxFileUrl })) {
          docxStatus = 'failed';
          docxError = 'DOCX conversion finished but html/fileUrl missing';
        }
        console.log('✅ [DOCX-Pipeline] PDF→DOCX ready', {
          fileId,
          docxFileUrl,
          htmlChars: docxHtml?.length || 0,
          elapsedMs: Date.now() - startedAt,
        });

        // Text extraction for downstream analysis
        try {
          const mammoth = await import('mammoth');
          const textResult = await mammoth.extractRawText({ buffer: docxBuffer });
          extractedText = textResult.value || extractedText;
        } catch (_) {}
      } catch (e) {
        docxStatus = 'failed';
        docxError = e?.message || String(e);
        console.warn('❌ [DOCX-Pipeline] PDF→DOCX failed (non-fatal)', { fileId, error: docxError });
      }
    }


    if ((fileType.includes('word') || fileName.endsWith('.docx') || fileName.endsWith('.doc')) && !fileName.endsWith('.rtf')) {
      console.log('🔍 Smart Scan: Extracting DOCX formatting...');
      formatMetadata = await extractDocxFormatting(buffer);

      // Use structure-based HTML conversion for richer formatting preservation
      try {
        const structure = await extractDocxStructure(buffer);
        if (structure) {
          htmlContent = docxStructureToHtml(structure);
          extractedText = structure.plainText || '';
          console.log(`🔍 Smart Scan: Structure-based HTML generated (${htmlContent.length} chars)`);
        }
      } catch (structErr) {
        console.warn('⚠️ Structure extraction failed, falling back to mammoth:', structErr.message);
      }

      // Fallback to mammoth if structure extraction failed
      if (!htmlContent) {
        htmlContent = await docxToHtml(buffer);
      }
      if (!extractedText) {
        const mammoth = await import('mammoth');
        const textResult = await mammoth.extractRawText({ buffer });
        extractedText = textResult.value || '';
      }
    }

    else if (fileName.endsWith('.rtf') || fileType === 'application/rtf' || fileType === 'text/rtf') {
      console.log('🔍 Smart Scan: Extracting RTF content...');
      try {
        const { default: rtfParser } = await import('rtf-parser');
        const rtfString = buffer.toString('utf-8');


        const parseRTF = (input) => new Promise((resolve, reject) => {
          rtfParser.string(input, (err, doc) => {
            if (err) reject(err);
            else resolve(doc);
          });
        });

        const rtfDocument = await parseRTF(rtfString);


        if (rtfDocument && rtfDocument.content && Array.isArray(rtfDocument.content)) {
          extractedText = rtfDocument.content
            .map(node => {
              if (node && node.value) {
                return node.value;
              }
              return '';
            })
            .join('\n')
            .trim();
        }

        if (!extractedText || extractedText.trim().length === 0) {
          throw new Error('No text extracted from RTF');
        }

        htmlContent = convertPdfTextToHtml(extractedText);

        console.log(`✅ RTF parsed: ${extractedText.length} chars extracted`);
      } catch (rtfError) {
        console.warn('RTF parsing failed:', rtfError.message);

        try {
          const rtfText = buffer.toString('utf-8');
          extractedText = rtfText
            .replace(/\\[a-z]+\d*/g, ' ')
            .replace(/[{}]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
          htmlContent = extractedText.split('\n').map(line => {
            const trimmed = line.trim();
            if (!trimmed) return '<p><br></p>';
            return `<p>${trimmed}</p>`;
          }).join('\n');
          console.log(`✅ RTF fallback: ${extractedText.length} chars extracted`);
        } catch (fallbackError) {
          throw new AppError('Failed to extract text from RTF file', 500);
        }
      }
    }

    else if ((fileType === 'application/pdf' || fileName.endsWith('.pdf')) && isDocxConversionEnabled() && !isAdobePdfConfigured()) {
      throw new AppError('DOCX conversion is enabled but Adobe PDF Services is not configured. PDF direct reading is bypassed.', 500);
    }

    else if ((fileType === 'application/pdf' || fileName.endsWith('.pdf')) && !(isDocxConversionEnabled() && isAdobePdfConfigured())) {
      console.log('🔍 Smart Scan: Extracting PDF formatting...');
      formatMetadata = await extractPdfFormatting(buffer);
      sourcePdfPages = await getPdfPageCountFromBuffer(buffer);
      console.log('🧪 [ALIGN-QA] SmartScan PDF input:', {
        fileName: file.fileName,
        fileType,
        bufferBytes: buffer?.length || 0,
        hasFormatMetadata: !!formatMetadata,
        sourcePdfPages,
      });

      if (isAzureDocumentIntelligenceConfigured()) {
        try {
          const keepFooterInBody =
            req?.body?.keepFooterInBody === true ||
            String(req?.query?.keepFooterInBody || '').toLowerCase() === 'true';
          const azureDi = await withTimeout(
            () => extractPdfTextWithAzureDocumentIntelligence(buffer, { keepFooterInBody }),
            stepTimeout(45000, 15000),
            'Azure DI PDF extract'
          );
          const azureText = enhancePdfText(azureDi?.text || '');
          const minChars = parseInt(process.env.AZURE_DI_MIN_TEXT_CHARS || '1200', 10);
          const minLines = parseInt(process.env.AZURE_DI_MIN_LINES || '25', 10);
          const gotLines = azureDi?.diagnostics?.lines || 0;
          console.log('🧪 [ALIGN-QA] Azure DI extract summary:', {
            chars: azureText.length,
            lines: gotLines,
            pages: azureDi?.diagnostics?.pages || 0,
            elapsedMs: azureDi?.diagnostics?.elapsedMs || null,
            minCharsGate: minChars,
            minLinesGate: minLines,
          });

          const azureLooksComplete =
            !!azureText &&
            azureText.trim().length >= minChars &&
            gotLines >= minLines;
          if (!azureLooksComplete) {
            throw new Error(
              `Azure DI extract incomplete (chars=${azureText.length}, lines=${gotLines})` +
              ` below gates (chars>=${minChars}, lines>=${minLines})`
            );
          }

          extractedText = azureText;
          htmlContent = azureDi?.html || convertPdfTextToHtml(extractedText);
          layoutModel = azureDi?.layoutModel || layoutModel;
          layoutDiagnostics = azureDi?.layoutDiagnostics || layoutDiagnostics;
          if (azureDi?.markdownHtml) markdownHtml = azureDi.markdownHtml;
          exportMode = layoutDiagnostics?.detectedMode || (layoutModel?.pages?.length ? 'fidelity' : 'editable');
          completedSteps.push('azure_di_extract');

          // Gemini PDF structure/alignment enhancement intentionally disabled.

          // Confidence-gated hybrid extraction:
          // If Azure flags some pages as low-confidence, try Adobe and swap only those pages.
          const lowConfidencePages = Array.isArray(layoutDiagnostics?.lowConfidencePages)
            ? layoutDiagnostics.lowConfidencePages
            : [];
          if (lowConfidencePages.length > 0 && isAdobePdfConfigured()) {
            try {
              const adobeForMerge = await withTimeout(
                () => extractPdfTextWithAdobe(buffer, file.fileName || 'document.pdf'),
                stepTimeout(22000, 9000),
                'Adobe low-confidence page merge'
              );
              if (adobeForMerge?.layoutModel?.pages?.length) {
                const mergedLayout = mergeLayoutModels(layoutModel, adobeForMerge.layoutModel, lowConfidencePages);
                if (mergedLayout?.pages?.length) {
                  layoutModel = mergedLayout;
                  htmlContent = layoutModelToHtml(layoutModel) || htmlContent;
                  extractedText = layoutModelToText(layoutModel) || extractedText;
                  layoutDiagnostics = {
                    ...(layoutDiagnostics || {}),
                    hybridMerge: {
                      providerPrimary: 'azure_document_intelligence',
                      providerSecondary: 'adobe',
                      mergedPages: lowConfidencePages,
                    },
                  };
                  completedSteps.push('hybrid_page_merge');
                }
              }
            } catch (hybridErr) {
              console.warn('Hybrid page merge skipped:', {
                message: hybridErr.message,
                stackTop: hybridErr.stack?.split('\n')?.[0] || null,
              });
            }
          }

          // Page coverage gate + missing-page backfill
          if (layoutModel?.pages?.length && sourcePdfPages && isAdobePdfConfigured()) {
            const minCoverage = Number(process.env.LAYOUT_MIN_PAGE_COVERAGE || 0.95);
            const initialMissing = getMissingPageNumbers(layoutModel, sourcePdfPages);
            const initialCoverage = (sourcePdfPages - initialMissing.length) / sourcePdfPages;
            console.log('🧪 [ALIGN-QA] Layout page coverage check (azure primary):', {
              sourcePdfPages,
              layoutPages: layoutModel.pages.length,
              initialCoverage,
              missingPages: initialMissing,
              minCoverage,
            });
            if (initialMissing.length > 0 && initialCoverage < minCoverage) {
              try {
                const adobeBackfill = await withTimeout(
                  () => extractPdfTextWithAdobe(buffer, file.fileName || 'document.pdf'),
                  stepTimeout(26000, 9000),
                  'Adobe missing-page backfill'
                );
                if (adobeBackfill?.layoutModel?.pages?.length) {
                  layoutModel = mergeLayoutModels(layoutModel, adobeBackfill.layoutModel, initialMissing);
                  htmlContent = layoutModelToHtml(layoutModel) || htmlContent;
                  extractedText = layoutModelToText(layoutModel) || extractedText;
                  const remainingMissing = getMissingPageNumbers(layoutModel, sourcePdfPages);
                  const finalCoverage = (sourcePdfPages - remainingMissing.length) / sourcePdfPages;
                  layoutDiagnostics = {
                    ...(layoutDiagnostics || {}),
                    pageCoverage: finalCoverage,
                    sourcePdfPages,
                    missingPages: remainingMissing,
                    backfilledPages: initialMissing.filter((p) => !remainingMissing.includes(p)),
                  };
                  completedSteps.push('missing_page_backfill');
                  if (finalCoverage < minCoverage) {
                    exportMode = 'editable';
                    layoutDiagnostics.detectedMode = 'editable';
                    (layoutDiagnostics.warnings || (layoutDiagnostics.warnings = [])).push(
                      `Layout coverage ${finalCoverage} below threshold ${minCoverage}; fidelity downgraded`
                    );
                  }
                }
              } catch (backfillErr) {
                console.warn('Missing-page backfill failed:', {
                  message: backfillErr.message,
                  stackTop: backfillErr.stack?.split('\n')?.[0] || null,
                });
              }
            }
          }
        } catch (azureDiErr) {
          console.warn('Azure DI extraction failed, falling back to Adobe/Python/pdf2json:', {
            message: azureDiErr.message,
            stackTop: azureDiErr.stack?.split('\n')?.[0] || null,
          });
        }
      }

      if (!extractedText && isAdobePdfConfigured()) {
        try {
          const adobeExtract = await withTimeout(
            () => extractPdfTextWithAdobe(buffer, file.fileName || 'document.pdf'),
            stepTimeout(35000, 12000),
            'Adobe PDF extract'
          );
          const adobeText = enhancePdfText(adobeExtract?.text || '');
          const adobeRows = adobeExtract?.diagnostics?.rows || 0;
          const adobeMinChars = parseInt(process.env.ADOBE_MIN_TEXT_CHARS || '1800', 10);
          const adobeMinRows = parseInt(process.env.ADOBE_MIN_ROWS || '40', 10);
          console.log('🧪 [ALIGN-QA] Adobe extract payload summary:', {
            chars: adobeText.length,
            elapsedMs: adobeExtract?.diagnostics?.elapsedMs || null,
            provider: adobeExtract?.diagnostics?.provider || 'adobe',
            rows: adobeRows,
            minCharsGate: adobeMinChars,
            minRowsGate: adobeMinRows,
          });

          // Adobe can occasionally return partial extraction (for example, only first page).
          // Accept Adobe only when output passes minimum completeness gates.
          const adobeLooksComplete = (
            adobeText &&
            adobeText.trim().length >= adobeMinChars &&
            adobeRows >= adobeMinRows
          );
          if (!adobeLooksComplete) {
            throw new Error(
              `Adobe extract incomplete (chars=${adobeText.length}, rows=${adobeRows})` +
              ` below gates (chars>=${adobeMinChars}, rows>=${adobeMinRows})`
            );
          }

          extractedText = adobeText;
          htmlContent = adobeExtract?.html || convertPdfTextToHtml(extractedText);
          layoutModel = adobeExtract?.layoutModel || layoutModel;
          layoutDiagnostics = adobeExtract?.layoutDiagnostics || layoutDiagnostics;
          exportMode = layoutDiagnostics?.detectedMode || (layoutModel?.pages?.length ? 'fidelity' : 'editable');
          completedSteps.push('adobe_extract');

          // If Adobe is primary but page coverage is incomplete, try Azure backfill
          if (layoutModel?.pages?.length && sourcePdfPages && isAzureDocumentIntelligenceConfigured()) {
            const minCoverage = Number(process.env.LAYOUT_MIN_PAGE_COVERAGE || 0.95);
            const initialMissing = getMissingPageNumbers(layoutModel, sourcePdfPages);
            const initialCoverage = (sourcePdfPages - initialMissing.length) / sourcePdfPages;
            console.log('🧪 [ALIGN-QA] Layout page coverage check (adobe primary):', {
              sourcePdfPages,
              layoutPages: layoutModel.pages.length,
              initialCoverage,
              missingPages: initialMissing,
              minCoverage,
            });
            if (initialMissing.length > 0 && initialCoverage < minCoverage) {
              try {
                const azureBackfill = await withTimeout(
                  () => extractPdfTextWithAzureDocumentIntelligence(buffer),
                  stepTimeout(32000, 10000),
                  'Azure missing-page backfill'
                );
                if (azureBackfill?.layoutModel?.pages?.length) {
                  layoutModel = mergeLayoutModels(layoutModel, azureBackfill.layoutModel, initialMissing);
                  htmlContent = layoutModelToHtml(layoutModel) || htmlContent;
                  extractedText = layoutModelToText(layoutModel) || extractedText;
                  const remainingMissing = getMissingPageNumbers(layoutModel, sourcePdfPages);
                  const finalCoverage = (sourcePdfPages - remainingMissing.length) / sourcePdfPages;
                  layoutDiagnostics = {
                    ...(layoutDiagnostics || {}),
                    pageCoverage: finalCoverage,
                    sourcePdfPages,
                    missingPages: remainingMissing,
                    backfilledPages: initialMissing.filter((p) => !remainingMissing.includes(p)),
                  };
                  completedSteps.push('missing_page_backfill');
                  if (finalCoverage < minCoverage) {
                    exportMode = 'editable';
                    layoutDiagnostics.detectedMode = 'editable';
                    (layoutDiagnostics.warnings || (layoutDiagnostics.warnings = [])).push(
                      `Layout coverage ${finalCoverage} below threshold ${minCoverage}; fidelity downgraded`
                    );
                  }
                }
              } catch (backfillErr) {
                console.warn('Missing-page backfill failed:', {
                  message: backfillErr.message,
                  stackTop: backfillErr.stack?.split('\n')?.[0] || null,
                });
              }
            }
          }
        } catch (adobeErr) {
          console.warn('Adobe PDF extraction failed, falling back to Python/pdf2json:', {
            message: adobeErr.message,
            stackTop: adobeErr.stack?.split('\n')?.[0] || null,
          });
        }
      }

      if (!extractedText && PYTHON_SERVICE_ENABLED) {
        try {
          const rawPythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
          const pythonServiceUrl = normalizePythonServiceUrl(rawPythonServiceUrl);
          const extractEndpoint = `${pythonServiceUrl}/api/extract`;
          const healthEndpoint = `${pythonServiceUrl}/health`;
          console.log('🧪 [ALIGN-QA] SmartScan python endpoint debug:', {
            rawPythonServiceUrl,
            normalizedPythonServiceUrl: pythonServiceUrl,
            extractEndpoint,
            healthEndpoint,
            isExtractAbsolute: isAbsoluteHttpUrl(extractEndpoint),
          });

          try {
            const healthRes = await fetchWithTimeout(healthEndpoint, { method: 'GET' }, stepTimeout(7000),);
            console.log('🧪 [ALIGN-QA] SmartScan python health:', {
              status: healthRes.status,
              ok: healthRes.ok,
            });
          } catch (healthErr) {
            console.warn('🧪 [ALIGN-QA] SmartScan python health check failed:', {
              message: healthErr.message,
              stackTop: healthErr.stack?.split('\n')?.[0] || null,
            });
          }

          const formData = new FormData();
          const fileBlob = new Blob([buffer], { type: 'application/pdf' });
          formData.append('file', fileBlob, file.fileName || 'document.pdf');
          const pyRes = await fetchWithTimeout(
            extractEndpoint,
            { method: 'POST', body: formData },
            stepTimeout(18000)
          );
          if (!pyRes.ok) throw new Error(`Python extractor failed: ${pyRes.status}`);
          const payload = await pyRes.json();
          console.log('🧪 [ALIGN-QA] Python extract payload summary:', {
            success: !!payload?.success,
            type: payload?.type || null,
            pages: payload?.pages || 0,
            textChars: (payload?.text || '').length,
            hasLayout: !!payload?.layout,
            layoutPages: Array.isArray(payload?.layout?.pages) ? payload.layout.pages.length : 0,
            confidenceLevel: payload?.layoutDiagnostics?.confidenceLevel || 'na',
            confidenceScore: payload?.layoutDiagnostics?.confidenceScore ?? null,
            majorStructures: payload?.layoutDiagnostics?.majorStructures || [],
          });
          extractedText = enhancePdfText(payload?.text || '');
          layoutModel = payload?.layout || null;
          layoutDiagnostics = payload?.layoutDiagnostics || null;
          exportMode = layoutDiagnostics?.detectedMode || (layoutModel?.pages?.length ? 'fidelity' : 'editable');
          htmlContent = payload?.html || layoutModelToHtml(layoutModel) || convertPdfTextToHtml(extractedText);
          completedSteps.push('python_extract');
        } catch (pdfError) {
          console.warn('Python PDF extraction failed, falling back to pdf2json:', {
            message: pdfError.message,
            stackTop: pdfError.stack?.split('\n')?.[0] || null,
          });
          try {
            const { default: PDFParser } = await import('pdf2json');
            await new Promise((resolve, reject) => {
              const pdfParser = new PDFParser(this, 1);
              pdfParser.on("pdfParser_dataError", errData => reject(errData.parserError));
              pdfParser.on("pdfParser_dataReady", () => {
                extractedText = pdfParser.getRawTextContent() || '';
                resolve();
              });
              pdfParser.parseBuffer(buffer);
            });
            extractedText = enhancePdfText(extractedText);
            htmlContent = convertPdfTextToHtml(extractedText);
            completedSteps.push('pdf2json_fallback_extract');
            console.log('🧪 [ALIGN-QA] pdf2json fallback summary:', {
              textChars: extractedText.length,
              htmlChars: htmlContent.length,
            });
          } catch (fallbackErr) {
            console.warn('pdf2json fallback failed:', {
              message: fallbackErr.message,
              stackTop: fallbackErr.stack?.split('\n')?.[0] || null,
            });
            extractedText = '';
          }
        }
      } else {
        console.log('🧪 [ALIGN-QA] Skipping Python/pdf2json because structured extraction already succeeded.');
      }

      if (!extractedText || extractedText.trim().length < 50) {
        console.log('📸 PDF appears scanned — text-based OCR not available for PDF buffers directly.');
        // Tesseract.js only processes image buffers (PNG/JPEG), not raw PDF binary.
        // Scanned PDFs would require converting pages to images first (e.g. via poppler).
        ocrText = '';
        extractedText = extractedText || '[Scanned PDF - limited text extracted]';
        if (!htmlContent) htmlContent = `<p>${extractedText}</p>`;
        exportMode = 'editable';
      }
    }

    // DOCX-only PDF mode: do not read raw PDF text/layout directly.
    else if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
      if (docxStatus === 'ready' && docxHtml && docxFileUrl) {
        htmlContent = docxHtml;
        extractedText = extractedText || stripHtmlToText(docxHtml);
        exportMode = 'editable';
        completedSteps.push('docx_primary_pdf_mode');
        console.log('✅ [DOCX-Pipeline] Using DOCX-only editable source for PDF', {
          fileId,
          docxFileUrl,
          htmlChars: docxHtml.length,
          textChars: extractedText.length,
        });
      } else {
        const reason = docxError || 'DOCX conversion did not produce valid html/fileUrl';
        console.error('❌ [DOCX-Pipeline] Blocking raw PDF read in DOCX-only mode', { fileId, reason, docxStatus });
        throw new AppError(`PDF→DOCX conversion required but failed: ${reason}`, 500);
      }
    }

    else if (fileType.startsWith('image/')) {
      console.log('📸 Smart Scan: Running OCR on image...');
      try {
        if (isAzureOcrConfigured()) {
          const azure = await extractTextWithAzureOcr(buffer, fileType || 'application/octet-stream');
          ocrText = azure?.text || '';
          ocrConfidence = azure?.confidence || 0;
          extractedText = ocrText;
          htmlContent = textToHtml(ocrText, null);
          console.log(`✅ Azure OCR completed with ${Math.round(ocrConfidence)}% confidence`);
          completedSteps.push('azure_ocr_image');
        } else {
          const { createWorker, PSM, OEM } = await import('tesseract.js');
          const worker = await createWorker('eng', OEM.LSTM_ONLY, {
            logger: (m) => {
              if (m.status === 'recognizing text') {
                console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
              }
            }
          });

          await worker.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
            preserve_interword_spaces: '1',
          });

          const result = await worker.recognize(buffer);
          ocrText = result.data.text || '';
          ocrConfidence = result.data.confidence || 0;
          extractedText = ocrText;
          htmlContent = textToHtml(ocrText, null);
          await worker.terminate();
          console.log(`✅ OCR completed with ${Math.round(ocrConfidence)}% confidence`);
          completedSteps.push('tesseract_ocr_image');
        }
      } catch (ocrErr) {
        console.error('OCR failed:', ocrErr.message);
        throw new AppError('OCR processing failed for this image', 500);
      }
    }

    else {
      extractedText = buffer.toString('utf-8');
      htmlContent = textToHtml(extractedText, null);
    }




    let scanResults = null;
    let smartSuggestions = [];
    let precedenceAnalysis = [];
    let complianceIssues = [];
    let missingClauses = [];
    let clauseFlaws = [];
    let chronologicalIssues = [];
    let outdatedReferences = [];
    let internalContradictions = [];
    let statutesReferenced = [];
    let governmentCompliance = null;
    let detectedDocType = '';
    let extractedParties = null;


    const validSeverities = ['info', 'warning', 'critical'];
    const sanitizeSeverity = (s) => validSeverities.includes(s) ? s : (s === 'medium' ? 'warning' : 'info');

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

    if (extractedText && extractedText.trim().length > 20) {

      try {
        const { parseDocument } = await import('../services/documentParserService.js');
        const structure = parseDocument(extractedText);


        scanResults = {
          documentType: '',
          structure: {
            sectionCount: structure.summary?.sectionCount || 0,
            clauseCount: structure.summary?.clauseCount || 0,
            clauseTypes: structure.summary?.clauseTypes || [],
            title: structure.metadata?.title || file.fileName
          },
          analyzedAt: new Date()
        };
      } catch (parseErr) {
        console.warn('Static parser failed (non-critical):', parseErr.message);
        scanResults = { documentType: '', analyzedAt: new Date() };
      }

      // Smart document windowing — preserves beginning, middle sample, and end
      const docSnippet = (() => {
        const len = extractedText.length;
        if (len <= 10000) return extractedText;
        const beginning = extractedText.substring(0, 5000);
        const midStart = Math.floor(len / 2) - 1000;
        const middle = extractedText.substring(midStart, midStart + 2000);
        const end = extractedText.substring(len - 2000);
        return `${beginning}\n\n[...]\n\n${middle}\n\n[...]\n\n${end}`;
      })();

      // Prompts are defined inline inside each try-catch below

      // ── CALL A: Core analysis (document type, parties, compliance, clause flaws) ─────
      try {
        const corePrompt = `You are an expert Indian legal document analyst. Analyze the document below and return ONLY a valid JSON object — no markdown, no explanation, no text before or after the JSON.

Return this exact structure:
{
  "documentType": "one of: Civil Writ Petition | Criminal Writ Petition | Special Leave Petition | Regular First Appeal | Criminal Appeal | Bail Application | Written Statement | Plaint | Sale Deed | Gift Deed | Rental Agreement | Affidavit | Legal Notice | Power of Attorney | Will | Employment Agreement | Court Judgment/Order | Other",
  "caseType": "one of: Civil | Criminal | Constitutional | Property | Family | Commercial | Other",
  "parties": {
    "petitioner": "full name",
    "respondent": "full name",
    "court": "court name",
    "caseNumber": "case number",
    "judges": ["judge name"],
    "petitionerAdvocates": ["advocate name"],
    "respondentAdvocates": ["advocate name"],
    "dates": ["DD/MM/YYYY: event description"],
    "otherParties": ["name - role"]
  },
  "complianceIssues": [
    { "rule": "exact Act/Section name", "description": "specific issue found in THIS document", "severity": "critical", "fix": "specific corrective action" }
  ],
  "clauseFlaws": [
    { "clauseRef": "Clause X / Section Y", "originalText": "verbatim excerpt max 80 chars", "issue": "what is wrong with this clause", "severity": "critical", "suggestedFix": "specific rewrite" }
  ],
  "missingClauses": [
    { "clauseType": "name of missing clause", "importance": "critical", "suggestedText": "suggested clause text" }
  ],
  "summary": "The verbatim Statement of Facts (SOF) paragraph from the document. Look for sections titled 'Statement of Facts', 'Facts', 'सार', 'Brief facts', 'Summary of the case', or similar. Copy the EXACT text from the document as it appears — do NOT paraphrase, summarize, or rewrite. Return the full paragraph(s) word-for-word. If no such section exists, return empty string."
}

STRICT RULES:
1. documentType MUST be specific — pick the best match. If this is a court judgment, order, or ruling, use "Court Judgment/Order". Use "Other" only if truly unclassifiable.
2. complianceIssues: Include ONLY genuine compliance issues you can directly trace to specific text in the document. For each issue, the "description" MUST quote or reference the exact passage that causes the issue. If there are no real compliance issues, return an empty array []. Do NOT fabricate generic issues.
3. clauseFlaws: Include ONLY flaws in clauses that ACTUALLY APPEAR in this document. The "originalText" MUST be a verbatim excerpt (max 80 chars) from the document. If no clauses have flaws, return an empty array []. Do NOT generate generic legal observations.
4. missingClauses: Include ONLY clauses that are genuinely expected for this specific document type but are clearly absent. If the document is a court judgment/order, it typically does NOT need additional clauses — return []. Do NOT fabricate missing clauses.
5. severity must be exactly one of: "critical", "warning", "info"
6. Return ONLY the JSON object, nothing else — do not wrap in markdown code blocks
7. CRITICAL: Every value MUST be traceable to specific text in the document. If you cannot point to a source passage, do NOT include the item. Fabricating or hallucinating content is strictly prohibited. When in doubt, return an empty array [].
8. summary (SOF): Extract the EXACT verbatim text of the Statement of Facts / Facts section from the document. Do NOT write a summary — copy the text as it appears in the document. If the document has no such section, return "".
9. RELEVANCE: Only flag issues, flaws, and missing clauses that are directly relevant to THIS specific document type and its legal context. Generic legal advice (e.g. "add a dispute resolution clause" to a court petition) is NOT relevant. Think: "Would a practising Indian lawyer filing this specific document actually care about this issue?"

DOCUMENT TO ANALYZE:
${docSnippet}`;

        console.log('[SmartScan] Call A (Core) starting, prompt:', corePrompt.length, 'chars', '| remainingMs:', remainingMs());
        const rawA = await withTimeout(
          () => callLLMWithRetry(corePrompt, { temperature: 0, maxTokens: 6000 }),
          stepTimeout(30000),
          'SmartScan Call A'
        );
        console.log('[SmartScan] Call A response:', rawA?.length || 0, 'chars');
        const parsedA = recoverJSON(rawA);

        if (parsedA && typeof parsedA === 'object') {
          completedSteps.push('call_a_core');
          console.log('[SmartScan] Call A ✅ docType:', parsedA.documentType);
          detectedDocType = parsedA.documentType || detectedDocType;
          extractedParties = parsedA.parties || null;
          if (scanResults) {
            scanResults.documentType = detectedDocType;
            scanResults.caseType = parsedA.caseType || '';
            scanResults.summary = parsedA.summary || '';
          }
          complianceIssues = Array.isArray(parsedA.complianceIssues)
            ? parsedA.complianceIssues.slice(0, 8).map(c => ({
              rule: String(c.rule || ''),
              description: String(c.description || ''),
              severity: sanitizeSeverity(c.severity),
              fix: String(c.fix || '')
            }))
            : [];
          clauseFlaws = Array.isArray(parsedA.clauseFlaws)
            ? parsedA.clauseFlaws.slice(0, 8).map(f => ({
              clauseRef: String(f.clauseRef || ''),
              originalText: String(f.originalText || ''),
              issue: String(f.issue || ''),
              severity: sanitizeSeverity(f.severity),
              suggestedFix: String(f.suggestedFix || '')
            }))
            : [];
          missingClauses = Array.isArray(parsedA.missingClauses)
            ? parsedA.missingClauses.slice(0, 6).map(m => ({
              clauseType: String(m.clauseType || ''),
              importance: sanitizeSeverity(m.importance),
              suggestedText: String(m.suggestedText || '')
            }))
            : [];
        } else {
          console.warn('[SmartScan] Call A ❌ parse failed. Raw (first 500):', rawA?.substring(0, 500));
        }
      } catch (errA) {
        console.error('[SmartScan] Call A threw:', errA.message);
      }

      // ── CALL B: Deep analysis (precedents, chronology, outdated laws, contradictions) ─
      if (canRunOptional(18000)) {
      try {
        const deepPrompt = `You are an expert Indian legal document analyst. Analyze the document below and return ONLY a valid JSON object — no markdown, no explanation, no text before or after the JSON.

Return a JSON object with these keys. Each key's value must contain REAL data from the document — NEVER copy the placeholder descriptions below.

{
  "precedenceAnalysis": [
    { "caseName": "<ACTUAL case title>", "citation": "<ACTUAL citation exactly as written in the document>", "relevance": "<why this case matters>", "summary": "<2 sentence summary>" }
  ],
  "statutesReferenced": [
    { "name": "<ACTUAL statute/act name>", "sections": "<specific sections cited, if any>", "relevance": "<how it relates to this document>" }
  ],
  "chronologicalIssues": [
    { "item": "<ACTUAL event/date out of order>", "expectedOrder": "<correct order>", "foundOrder": "<order in document>", "description": "<explanation>" }
  ],
  "outdatedReferences": [
    { "reference": "<ACTUAL provision cited in the document>", "currentLaw": "<replacement law now in force>", "description": "<what changed and when>" }
  ],
  "internalContradictions": [
    { "clause1": "<first conflicting section>", "clause2": "<second conflicting section>", "contradiction": "<what conflicts>", "resolution": "<fix>" }
  ],
  "governmentCompliance": {
    "applicable": true,
    "riskLevel": "low",
    "findings": [
      { "area": "<specific compliance area>", "status": "pass|fail|na", "description": "<finding>", "correctiveAction": "<action>" }
    ]
  }
}

STRICT RULES:

1. CRITICAL DISTINCTION — precedenceAnalysis vs statutesReferenced:
   - precedenceAnalysis is for CASE LAW: court judgments or rulings cited as legal authority. Include a case if:
     a) It has a proper citation in the document (e.g. "(YYYY) N SCC NNN", "AIR YYYY SC NNN", "YYYY Cr.L.J NNN") — copy citation EXACTLY, or
     b) It is referenced by case name only (no formal citation in the document) — leave citation as "".
   - Look for ALL patterns that indicate a case reference: "as held in", "relying on", "following the ratio in", "the Hon'ble Court held in", "citing", "vide judgment in", "v.", "vs.", "versus", "State of X v. Y", and any (YYYY) N SCC NNN or AIR citations.
   - statutesReferenced is for LEGISLATION ONLY: Acts, Rules, Regulations, Ordinances, Notifications, Orders (e.g., "Indian Penal Code, 1860", "Code of Criminal Procedure"). NEVER put a statute in precedenceAnalysis.
   - NEVER fabricate a citation. If the document cites "State of Bihar v. XYZ" without any SCC/AIR number, include the entry with citation "".
   - NEVER invent a citation (like "(2009) 8 SCC 654") for a statute or for a case that doesn't have one in the document.
   - If NO case law (judgments/rulings) are mentioned at all in the document, return precedenceAnalysis as [].
   - When a citation IS present in the document, the citation field MUST be copied EXACTLY — character for character.

2. outdatedReferences: ONLY flag these SPECIFIC replacements that occurred on 1 July 2024:
   - "Indian Penal Code" (IPC) → replaced by "Bharatiya Nyaya Sanhita" (BNS)
   - "Code of Criminal Procedure" (CrPC) → replaced by "Bharatiya Nagarik Suraksha Sanhita" (BNSS)
   - "Indian Evidence Act" → replaced by "Bharatiya Sakshya Adhiniyam" (BSA)
   Do NOT flag any other laws, rules, or regulations as "replaced by BNS/BNSS/BSA". State-level rules, subordinate legislation, education rules, service rules, etc. have NO connection to BNS/BNSS/BSA. Only flag them if you can identify a SPECIFIC, REAL replacement law.
   If none found, return [].

3. internalContradictions: Look for conflicting clauses, inconsistent dates, contradictory obligations WITHIN the document. If none found, return [].

4. governmentCompliance: For EACH compliance area (Stamp Duty, Registration, Court Fees, Notarization), determine:
   - status "na": The requirement does NOT APPLY to this document type. Court judgments/orders do NOT require stamp duty, registration, or notarization. Affidavits require notarization but not stamp duty. Petitions require court fees but not stamp duty or registration. Only property deeds, agreements, and conveyances require stamp duty and registration.
   - status "pass": The document text contains EXPLICIT EVIDENCE of compliance. You MUST quote the evidence.
   - status "fail": The requirement APPLIES but NO evidence found.
   NEVER say "has been properly stamped/registered/notarized" without quoting exact text.

5. Return ONLY the JSON object — no markdown code blocks.
6. CRITICAL: Do NOT copy placeholder text. Every value must be specific to THIS document. Empty array [] if nothing found. Fabricating is strictly prohibited.

DOCUMENT TO ANALYZE:
${docSnippet}`;

        console.log('[SmartScan] Call B (Deep) starting, prompt:', deepPrompt.length, 'chars', '| remainingMs:', remainingMs());
        const rawB = await withTimeout(
          () => callLLMWithRetry(deepPrompt, { temperature: 0, maxTokens: 5000 }),
          stepTimeout(28000),
          'SmartScan Call B'
        );
        console.log('[SmartScan] Call B response:', rawB?.length || 0, 'chars');
        const parsedB = recoverJSON(rawB);

        if (parsedB && typeof parsedB === 'object') {
          completedSteps.push('call_b_deep');
          console.log('[SmartScan] Call B ✅ precedents:', parsedB.precedenceAnalysis?.length || 0, 'statutes:', parsedB.statutesReferenced?.length || 0);
          precedenceAnalysis = Array.isArray(parsedB.precedenceAnalysis)
            ? parsedB.precedenceAnalysis.slice(0, 8).map(p => ({
              caseName: String(p.caseName || ''),
              citation: String(p.citation || ''),
              relevance: String(p.relevance || ''),
              summary: String(p.summary || '')
            }))
            : [];
          statutesReferenced = Array.isArray(parsedB.statutesReferenced)
            ? parsedB.statutesReferenced.slice(0, 10).map(s => ({
              name: String(s.name || ''),
              sections: String(s.sections || ''),
              relevance: String(s.relevance || '')
            }))
            : [];
          chronologicalIssues = Array.isArray(parsedB.chronologicalIssues)
            ? parsedB.chronologicalIssues.slice(0, 6).map(ch => ({
              item: String(ch.item || ''),
              expectedOrder: String(ch.expectedOrder || ''),
              foundOrder: String(ch.foundOrder || ''),
              description: String(ch.description || '')
            }))
            : [];
          outdatedReferences = Array.isArray(parsedB.outdatedReferences)
            ? parsedB.outdatedReferences.slice(0, 6).map(o => ({
              reference: String(o.reference || ''),
              currentLaw: String(o.currentLaw || ''),
              description: String(o.description || '')
            }))
            : [];
          internalContradictions = Array.isArray(parsedB.internalContradictions)
            ? parsedB.internalContradictions.slice(0, 6).map(i => ({
              clause1: String(i.clause1 || ''),
              clause2: String(i.clause2 || ''),
              contradiction: String(i.contradiction || ''),
              resolution: String(i.resolution || '')
            }))
            : [];
          if (parsedB.governmentCompliance && typeof parsedB.governmentCompliance === 'object') {
            governmentCompliance = {
              applicable: !!parsedB.governmentCompliance.applicable,
              riskLevel: ['low', 'medium', 'high', 'na'].includes(parsedB.governmentCompliance.riskLevel)
                ? parsedB.governmentCompliance.riskLevel : 'na',
              findings: Array.isArray(parsedB.governmentCompliance.findings)
                ? parsedB.governmentCompliance.findings.slice(0, 10).map(f => ({
                  area: String(f.area || ''),
                  status: ['pass', 'fail', 'na'].includes(f.status) ? f.status : 'na',
                  description: String(f.description || ''),
                  correctiveAction: String(f.correctiveAction || '')
                }))
                : []
            };
          }
        } else {
          console.warn('[SmartScan] Call B ❌ parse failed. Raw (first 500):', rawB?.substring(0, 500));
        }
      } catch (errB) {
        console.error('[SmartScan] Call B threw:', errB.message);
      }
      } else {
        skippedOptionalDueToBudget = true;
        console.log('[SmartScan] Skipping Call B due to time budget | remainingMs:', remainingMs());
      }

      // ── Server-side precedence cross-validation ─────────────────────
      // Goal: remove hallucinations but preserve real citations and name-only references.
      if (precedenceAnalysis.length > 0 && extractedText) {
        const docTextLower = extractedText.toLowerCase();
        const statuteKeywords = /\b(act|rules|regulation|ordinance|notification|sanhita|adhiniyam|bill)\b/i;
        // Note: "code" removed from statute keywords — too broad, matches valid case names
        const citationFormats = /\(\d{4}\)\s*\d+\s*SCC|\bAIR\s+\d{4}|\bCr\.?\s*L\.?\s*J|\bSCC\s+OnLine|\bSCC\s+\(Cri\)|\d{4}\s+\(\d+\)\s+SCC/i;

        const validatedPrecedences = precedenceAnalysis.filter(p => {
          // If the caseName contains Act/Rules keywords → move to statutes
          if (statuteKeywords.test(p.caseName)) {
            console.log(`[SmartScan] Filtering precedent as statute: "${p.caseName}"`);
            if (!statutesReferenced.some(s => s.name.toLowerCase().includes(p.caseName.toLowerCase().substring(0, 25)))) {
              statutesReferenced.push({ name: p.caseName, sections: '', relevance: p.relevance || '' });
            }
            return false;
          }

          const hasCitation = p.citation && p.citation.trim().length > 5;

          if (hasCitation) {
            // Citation provided — must be a valid format
            if (!citationFormats.test(p.citation)) {
              console.log(`[SmartScan] Filtering precedent with invalid citation format: "${p.citation}"`);
              return false;
            }
            // Citation must appear verbatim in the document (prevents hallucination)
            if (!docTextLower.includes(p.citation.toLowerCase())) {
              console.log(`[SmartScan] Filtering hallucinated citation not in document: "${p.citation}"`);
              return false;
            }
            return true;
          }

          // No citation provided — verify case name appears in document text
          if (p.caseName && p.caseName.trim().length > 5) {
            const nameLower = p.caseName.trim().toLowerCase();
            // Check that a meaningful fragment (first 25 chars) of the case name is in the doc
            const fragment = nameLower.substring(0, Math.min(25, nameLower.length));
            if (!docTextLower.includes(fragment)) {
              console.log(`[SmartScan] Filtering case name not found in document: "${p.caseName}"`);
              return false;
            }
            console.log(`[SmartScan] Keeping name-only precedent found in doc: "${p.caseName}"`);
            return true;
          }

          return false;
        });
        if (validatedPrecedences.length < precedenceAnalysis.length) {
          console.log(`[SmartScan] Precedence validation: ${precedenceAnalysis.length} → ${validatedPrecedences.length} (removed ${precedenceAnalysis.length - validatedPrecedences.length} hallucinated/statutes)`);
        }
        precedenceAnalysis = validatedPrecedences;
      }

      // ── Server-side statute document-presence verification ──────────
      // Only keep statutes whose name actually appears in the document text.
      // Also enrich with document context snippet and superseded status.
      if (statutesReferenced.length > 0 && extractedText) {
        const docTextLower = extractedText.toLowerCase();
        const supersededMap = {
          'indian penal code': { by: 'Bharatiya Nyaya Sanhita (BNS)', date: '1 July 2024' },
          'code of criminal procedure': { by: 'Bharatiya Nagarik Suraksha Sanhita (BNSS)', date: '1 July 2024' },
          'indian evidence act': { by: 'Bharatiya Sakshya Adhiniyam (BSA)', date: '1 July 2024' },
        };

        statutesReferenced = statutesReferenced.filter(s => {
          if (!s.name) return false;
          // Check if the statute name (or a significant portion) appears in the document
          const nameWords = s.name.replace(/,?\s*\d{4}$/, '').trim().toLowerCase();
          const nameInDoc = docTextLower.includes(nameWords) ||
            docTextLower.includes(nameWords.replace(/\s+/g, ' '));
          if (!nameInDoc) {
            // Try abbreviated form (e.g. "IPC", "CrPC", "CPC")
            const abbreviations = {
              'indian penal code': 'ipc',
              'code of criminal procedure': 'crpc',
              'code of civil procedure': 'cpc',
              'indian evidence act': 'evidence act',
              'bharatiya nyaya sanhita': 'bns',
              'bharatiya nagarik suraksha sanhita': 'bnss',
              'bharatiya sakshya adhiniyam': 'bsa',
            };
            const abbr = abbreviations[nameWords];
            if (!abbr || !docTextLower.includes(abbr)) {
              console.log(`[SmartScan] Filtering statute not found in document: "${s.name}"`);
              return false;
            }
          }
          return true;
        }).map(s => {
          // Extract document context snippet - find where the statute is mentioned
          const nameLower = s.name.replace(/,?\s*\d{4}$/, '').trim().toLowerCase();
          const idx = docTextLower.indexOf(nameLower);
          if (idx !== -1) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(extractedText.length, idx + nameLower.length + 80);
            s.documentContext = (start > 0 ? '…' : '') + extractedText.slice(start, end).replace(/\n/g, ' ').trim() + (end < extractedText.length ? '…' : '');
          }
          // Check if superseded
          const supersededKey = Object.keys(supersededMap).find(k => nameLower.includes(k));
          if (supersededKey) {
            s.superseded = supersededMap[supersededKey];
          }
          return s;
        });
        console.log(`[SmartScan] Statute verification: ${statutesReferenced.length} statutes verified in document`);
      }

      // ── Server-side government compliance validation ────────────────
      if (governmentCompliance && governmentCompliance.findings) {
        const docTypeLower = (detectedDocType || '').toLowerCase();
        const isJudgmentOrOrder = /judgment|order|ruling|decree|bail.*order/i.test(docTypeLower);
        const isPetition = /petition|writ|appeal|slp|application/i.test(docTypeLower);
        const isAffidavit = /affidavit/i.test(docTypeLower);
        const isDeedOrAgreement = /deed|agreement|lease|rent|sale|gift|conveyance|mortgage/i.test(docTypeLower);
        const isNotice = /notice/i.test(docTypeLower);
        const isWill = /will|testament/i.test(docTypeLower);

        const genericPassPhrases = [
          'has been properly', 'is properly', 'duly stamped', 'duly notarized',
          'duly registered', 'properly paid', 'properly stamped', 'properly registered',
          'properly notarized', 'been duly', 'adequately stamped'
        ];

        governmentCompliance.findings = governmentCompliance.findings.map(f => {
          const areaLower = (f.area || '').toLowerCase();
          const descLower = (f.description || '').toLowerCase();
          const isStampDuty = /stamp\s*duty/i.test(areaLower);
          const isRegistration = /registration/i.test(areaLower);
          const isCourtFees = /court\s*fee/i.test(areaLower);
          const isNotarization = /notari/i.test(areaLower);

          // Rule 1: Override N/A for document types that don't need it
          if (isJudgmentOrOrder && (isStampDuty || isRegistration || isNotarization || isCourtFees)) {
            return { ...f, status: 'na', description: 'Not applicable for court judgments/orders', correctiveAction: 'None' };
          }
          if (isPetition && (isStampDuty || isRegistration || isNotarization)) {
            return { ...f, status: 'na', description: 'Not applicable for petitions/appeals', correctiveAction: 'None' };
          }
          if (isAffidavit && (isStampDuty || isRegistration || isCourtFees)) {
            return { ...f, status: 'na', description: 'Not applicable for affidavits', correctiveAction: 'None' };
          }
          if (isNotice && (isStampDuty || isRegistration || isCourtFees || isNotarization)) {
            return { ...f, status: 'na', description: 'Not applicable for legal notices', correctiveAction: 'None' };
          }
          if (isWill && (isRegistration || isCourtFees)) {
            return { ...f, status: 'na', description: 'Not applicable for wills', correctiveAction: 'None' };
          }

          // Rule 2: Override generic "pass" with no real evidence
          if (f.status === 'pass') {
            const hasGenericDesc = genericPassPhrases.some(phrase => descLower.includes(phrase));
            if (hasGenericDesc) {
              return { ...f, status: 'na', description: 'Could not verify from document content — no explicit evidence found', correctiveAction: 'Verify manually' };
            }
          }

          return f;
        });

        // Recalculate risk level based on validated findings
        const hasFailures = governmentCompliance.findings.some(f => f.status === 'fail');
        const allNa = governmentCompliance.findings.every(f => f.status === 'na');
        if (allNa) {
          governmentCompliance.riskLevel = 'na';
        } else if (hasFailures) {
          governmentCompliance.riskLevel = 'high';
        }
      } else if (!extractedText && !PYTHON_SERVICE_ENABLED) {
        console.log('🧪 [ALIGN-QA] Python extractor disabled; using pdf2json fallback directly');
        try {
          const { default: PDFParser } = await import('pdf2json');
          let parsed = '';
          await new Promise((resolve, reject) => {
            const pdfParser = new PDFParser(this, 1);
            pdfParser.on('pdfParser_dataError', (errData) => reject(errData.parserError));
            pdfParser.on('pdfParser_dataReady', () => {
              parsed = pdfParser.getRawTextContent();
              resolve();
            });
            pdfParser.parseBuffer(buffer);
          });
          extractedText = enhancePdfText(parsed || '');
          if (!htmlContent) htmlContent = convertPdfTextToHtml(extractedText);
          completedSteps.push('pdf2json_extract');
        } catch (pdf2Err) {
          console.warn('pdf2json fallback failed:', {
            message: pdf2Err.message,
            stackTop: pdf2Err.stack?.split('\n')?.[0] || null,
          });
        }
      }

      // ── Server-side outdated reference validation ───────────────────
      // BNS/BNSS/BSA only replace IPC/CrPC/Evidence Act respectively.
      // Filter out false positives where the LLM incorrectly flags unrelated laws.
      if (outdatedReferences.length > 0) {
        const validBnsReplacements = {
          'bns': /indian\s*penal\s*code|ipc|\b45\s+of\s+1860\b/i,
          'bharatiya nyaya sanhita': /indian\s*penal\s*code|ipc|\b45\s+of\s+1860\b/i,
          'bnss': /code\s*of\s*criminal\s*procedure|crpc|cr\.?\s*p\.?\s*c|\b2\s+of\s+1974\b/i,
          'bharatiya nagarik suraksha sanhita': /code\s*of\s*criminal\s*procedure|crpc|cr\.?\s*p\.?\s*c|\b2\s+of\s+1974\b/i,
          'bsa': /indian\s*evidence\s*act|\b1\s+of\s+1872\b/i,
          'bharatiya sakshya adhiniyam': /indian\s*evidence\s*act|\b1\s+of\s+1872\b/i,
        };

        outdatedReferences = outdatedReferences.filter(ref => {
          const currentLawLower = (ref.currentLaw || '').toLowerCase().trim();
          const referenceLower = (ref.reference || '').toLowerCase().trim();

          // Check if the "currentLaw" claims BNS/BNSS/BSA replacement
          for (const [replacement, validSourcePattern] of Object.entries(validBnsReplacements)) {
            if (currentLawLower.includes(replacement)) {
              // Verify the reference being flagged is actually the correct source law
              if (!validSourcePattern.test(referenceLower)) {
                console.log(`[SmartScan] Filtering false BNS outdated ref: "${ref.reference}" → "${ref.currentLaw}"`);
                return false;
              }
            }
          }
          return true;
        });
      }

      // Build smartSuggestions from both analysis calls
      const allSugSources = [
        ...clauseFlaws.map(f => ({
          title: `Clause Flaw: ${f.clauseRef || 'Review'}`,
          severity: f.severity,
          type: 'clause_improvement',
          description: f.issue,
          originalText: f.originalText,
          suggestedText: f.suggestedFix
        })),
        ...complianceIssues.map(c => ({
          title: `Compliance: ${c.rule}`,
          severity: c.severity,
          type: 'legal_compliance',
          description: c.description,
          originalText: '',
          suggestedText: c.fix
        })),
        ...missingClauses.map(m => ({
          title: `Missing: ${m.clauseType}`,
          severity: m.importance,
          type: 'missing_clause',
          description: `This document is missing the ${m.clauseType} clause.`,
          originalText: '',
          suggestedText: m.suggestedText
        }))
      ];

      smartSuggestions = allSugSources.slice(0, 12).map((s, idx) => ({
        suggestionId: `ai_${idx}_${Date.now()}`,
        type: s.type || 'clause_improvement',
        severity: sanitizeSeverity(s.severity),
        title: String(s.title || 'Suggestion').substring(0, 200),
        description: String(s.description || '').substring(0, 1000),
        clauseRef: s.clauseRef || '',
        originalText: String(s.originalText || '').substring(0, 2000),
        suggestedText: String(s.suggestedText || '').substring(0, 2000),
        status: 'pending'
      }));

      console.log('[SmartScan] Analysis complete — docType:', detectedDocType,
        '| compliance:', complianceIssues.length, '| flaws:', clauseFlaws.length,
        '| missing:', missingClauses.length, '| precedents:', precedenceAnalysis.length);
    }

    if (layoutModel) {
      documentGraph = layoutModelToDocumentGraph(layoutModel, sourcePdfPages);
    }
    if (layoutModel || layoutDiagnostics || documentGraph) {
      scanResults = {
        ...(scanResults || {}),
        layoutDiagnostics: layoutDiagnostics || null,
        detectedExportMode: exportMode,
        documentGraph: documentGraph || null,
      };
    }
    scanResults = {
      ...(scanResults || {}),
      performanceDiagnostics: {
        budgetMs: SMART_SCAN_BUDGET_MS,
        elapsedMs: elapsedMs(),
        remainingMs: remainingMs(),
        skippedOptionalDueToBudget,
        completedSteps,
      },
    };


    // ── Template Matching: find the best JSON template for this document ─────
    // Skip template matching for already-filled/complete documents.
    // Template matching is ONLY useful for blank templates that need field filling.
    // Complete court orders, judgments, petitions with real data should never match templates.
    const filledDocTypes = /judgment|order|ruling|decree|bail.*order|opinion|minute|charge\s*sheet|fir|complaint|petition|writ|application|affidavit.*filed|criminal\s*misc|civil\s*misc|appeal|revision|review|stay|injunction|caveat|vakalatnama/i;
    const isFilledDocType = filledDocTypes.test(detectedDocType || '');

    let matchedTemplateId = '';
    let matchedTemplateFields = null;
    let matchedTemplateConfidence = '';
    if (!isFilledDocType) {
      try {
        const matchResult = await matchTemplateByDocType(detectedDocType, file.fileName);
        if (matchResult.template && matchResult.confidence !== 'none') {
          matchedTemplateId = matchResult.template.relPath || '';
          matchedTemplateFields = matchResult.template.schema || null;
          matchedTemplateConfidence = matchResult.confidence;
          console.log(`[SmartScan] Template match: "${matchResult.template.displayTitle}" (${matchResult.confidence})`);
        } else {
          matchedTemplateConfidence = 'none';
          console.log('[SmartScan] No template match found for:', detectedDocType);
        }
      } catch (matchErr) {
        console.warn('[SmartScan] Template matching failed (non-critical):', matchErr.message);
        matchedTemplateConfidence = 'none';
      }
    } else {
      matchedTemplateConfidence = 'none';
      console.log('[SmartScan] Skipping template match for already-filled document type:', detectedDocType);
    }

    // ── Blank Field Detection ────────────────────────────────────────────────
    // Step 1: regex on raw text + HTML (catches `____` and underline-formatted Word blanks)
    let detectedBlankFields = [
      ...detectBlanksFromText(extractedText || ''),
      ...detectBlanksFromHtml(htmlContent || ''),
    ].filter((f, i, arr) => arr.findIndex(x => x.key === f.key) === i); // deduplicate by key

    // Step 2: LLM fallback — if regex found nothing, ask the LLM to identify blank fields
    // But FIRST check if the document is clearly complete (has real values filled in).
    // Count actual blank patterns in the raw text to validate LLM results later.
    const actualBlankPatternCount = (
      ((extractedText || '').match(/_{3,}/g) || []).length +
      ((extractedText || '').match(/\.{6,}/g) || []).length
    );

    if (detectedBlankFields.length === 0 && actualBlankPatternCount === 0 && (extractedText || '').trim().length > 50 && canRunOptional(15000)) {
      // No regex blanks AND no actual blank patterns in text — check with LLM but validate strictly
      try {
        const blankPrompt = `You are analyzing an Indian legal document. Determine if it is a TEMPLATE (with blank fields to fill) or a COMPLETED document (all fields already have real values).

CRITICAL RULES:
- A COMPLETED document has actual names, dates, addresses, and case details filled in. Return [] for completed documents. Do NOT invent editable fields — that is a different task.
- Dotted separator lines like "... ... Petitioner/s" or "==== ====" or ".... Opposite Party" are NOT blank fields — they are formatting separators in Indian court documents.
- Only report genuine template placeholders where the VALUE is actually MISSING in the text: "Name: ________________", "S/o _____________", "Address: .............." with NO real value after the label.
- If a field has a real value next to its label (e.g. "Date: 13-02-2025" or "Petitioner: Rahul Kumar"), it is FILLED, not blank.
- When in doubt, return []. False negatives are better than false positives.

EXAMPLE of COMPLETED document (return []):
"IN THE HIGH COURT AT PATNA
Civil Writ Jurisdiction Case No.6683 of 2024
Parivartankari Prarambhik Sikshak Sangh Bihar ... Petitioner/s
Versus
The State of Bihar ... Respondent/s"
→ This has real party names, case number, court — return []

EXAMPLE of TEMPLATE (return fields):
"IN THE HIGH COURT OF ____________
Case No. _______ of _______
_________________ S/o _______________ ... Petitioner
Versus
_________________ ... Respondent"
→ This has blank underscores — return the field objects

If this is a completed document, return [].
If this is a template with genuine blanks, return a JSON array:
[{"key":"field_name","label":"Field Name","type":"text","required":true}]

Return ONLY the JSON array, no explanation.

DOCUMENT:
${(extractedText || '').substring(0, 4000)}`;
        const rawC = await withTimeout(
          () => callLLMWithRetry(blankPrompt, { temperature: 0, maxTokens: 1500 }),
          stepTimeout(16000),
          'SmartScan Call C'
        );
        const arrIdx = (rawC || '').indexOf('[');
        if (arrIdx >= 0) {
          const parsed = JSON.parse(rawC.substring(arrIdx, rawC.lastIndexOf(']') + 1));
          if (Array.isArray(parsed) && parsed.length > 0) {
            completedSteps.push('call_c_blank_fields');
            detectedBlankFields = parsed.slice(0, 20).map(f => ({
              key: String(f.key || `field_${Math.random().toString(36).slice(2, 6)}`).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
              label: String(f.label || f.key || 'Field'),
              type: ['text', 'date', 'number'].includes(f.type) ? f.type : 'text',
              required: f.required !== false,
            }));
            console.log('[SmartScan] Call C (Blank Fields) ✅ found:', detectedBlankFields.length);
          }
        }
      } catch (errC) {
        console.warn('[SmartScan] Call C (Blank Fields) failed (non-critical):', errC.message);
      }
    }

    // Post-validation: if LLM returned fields but the text has NO actual blank patterns
    // (underscores or dotted lines), the LLM hallucinated — discard the results
    if (detectedBlankFields.length > 0 && actualBlankPatternCount === 0) {
      // Verify at least one field maps to a real blank in the text
      const hasRealBlank = detectedBlankFields.some(f => {
        const escaped = f.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(escaped + '\\s*(?:_{3,}|\\.{4,})', 'i').test(extractedText || '');
      });
      if (!hasRealBlank) {
        console.log(`[SmartScan] Post-validation: discarding ${detectedBlankFields.length} LLM-detected fields — no actual blank patterns found in text`);
        detectedBlankFields = [];
      }
    }

    // Safety net: suppress template fields if no blank fields detected
    // This prevents the Fill modal from showing for already-completed documents
    if (detectedBlankFields.length === 0 && matchedTemplateFields) {
      console.log('[SmartScan] No blanks detected — suppressing template fields to prevent Fill modal for filled document');
      matchedTemplateFields = null;
      matchedTemplateConfidence = 'none';
    }

    // ── Smart Field Extraction for Complete Documents ─────────────────────────
    // When no blanks exist and the document has substantial text, extract all
    // identifiable fields so the user can review/modify before opening the editor.
    let extractedDocumentFields = null;
    let isCompleteDocument = false;
    if (detectedBlankFields.length === 0 && (extractedText || '').trim().length > 100) {
      isCompleteDocument = true;
      if (canRunOptional(12000)) {
      try {
        console.log('[SmartScan] Complete document detected — extracting fields via LLM...');
        extractedDocumentFields = await withTimeout(
          () => extractDocumentFields(extractedText, detectedDocType),
          stepTimeout(18000),
          'extractDocumentFields'
        );
        completedSteps.push('extract_document_fields');
        console.log(`[SmartScan] Extracted ${(extractedDocumentFields || []).length} fields from complete document`);
      } catch (fieldErr) {
        console.warn('[SmartScan] Field extraction failed (non-critical):', fieldErr.message);
        extractedDocumentFields = null;
      }
      } else {
        skippedOptionalDueToBudget = true;
        console.log('[SmartScan] Skipping extractDocumentFields due to time budget | remainingMs:', remainingMs());
      }
    }

    // ── Auto-Discover Precedents (when < 2 found in document) ────────────────
    let aiSuggestedPrecedents = [];
    if (precedenceAnalysis.length < 2 && (extractedText || '').trim().length > 100) {
      if (canRunOptional(12000)) {
      try {
        console.log('[SmartScan] Few precedents found — auto-discovering relevant cases...');
        const docSnippet = (extractedText || '').substring(0, 600);
        aiSuggestedPrecedents = await withTimeout(
          () => discoverPrecedentsForDocument(
            detectedDocType, extractedParties, statutesReferenced, docSnippet
          ),
          stepTimeout(18000),
          'discoverPrecedentsForDocument'
        );
        completedSteps.push('discover_precedents');
        console.log(`[SmartScan] AI discovered ${aiSuggestedPrecedents.length} suggested precedents`);
      } catch (discoverErr) {
        console.warn('[SmartScan] Auto-discover precedents failed (non-critical):', discoverErr.message);
      }
      } else {
        skippedOptionalDueToBudget = true;
        console.log('[SmartScan] Skipping auto-discover precedents due to time budget | remainingMs:', remainingMs());
      }
    }


    if (!session) {
      session = new EditSession({
        userId,
        fileId,
        fileName: file.fileName,
        fileType: fileType.includes('word') ? 'docx' : fileType === 'application/pdf' ? 'pdf' : fileType.startsWith('image/') ? 'image' : 'text',
        originalText: extractedText || ocrText || '[No text extracted]',
        currentText: extractedText || ocrText || '[No text extracted]',
        htmlContent,
        docxStatus: docxStatus || 'none',
        docxHtml: docxHtml || '',
        docxFileUrl: docxFileUrl || '',
        // Store the first-ever DOCX path — used as structural base during sync
        // to preserve original section properties (margins, header/footer) when regenerating.
        originalDocxPath: docxFileUrl || '',
        docxError: docxError || '',
        docxUpdatedAt: docxStatus && docxStatus !== 'none' ? new Date() : null,
        scanStatus: 'scanned',
        formatMetadata,
        scanResults,
        smartSuggestions,
        ocrText,
        ocrConfidence,
        layoutModel,
        documentGraph,
        fidelityEdits: null,
        exportMode,

        detectedDocType,
        extractedParties,
        precedenceAnalysis,
        statutesReferenced,
        complianceIssues,
        clauseFlaws,
        missingClauses,
        chronologicalIssues,
        outdatedReferences,
        internalContradictions,
        governmentCompliance,
        matchedTemplateId,
        matchedTemplateFields,
        matchedTemplateConfidence,
        detectedBlankFields: detectedBlankFields.length > 0 ? detectedBlankFields : null,
        extractedDocumentFields: extractedDocumentFields && extractedDocumentFields.length > 0 ? extractedDocumentFields : null,
        isCompleteDocument,
        aiSuggestedPrecedents,
      });
    } else {
      session.htmlContent = htmlContent;
      if (markdownHtml) session.markdownHtml = markdownHtml;
      if (geminiHtml)   session.geminiHtml   = geminiHtml;
      if (docxStatus && docxStatus !== 'none') session.docxStatus = docxStatus;
      if (docxHtml) session.docxHtml = docxHtml;
      if (docxFileUrl) session.docxFileUrl = docxFileUrl;
      // Preserve originalDocxPath: only set it on first scan (don't overwrite with synced versions)
      if (docxFileUrl && !session.originalDocxPath) session.originalDocxPath = docxFileUrl;
      if (docxError) session.docxError = docxError;
      if (docxStatus && docxStatus !== 'none') session.docxUpdatedAt = new Date();
      session.scanStatus = 'scanned';
      session.formatMetadata = formatMetadata;
      session.scanResults = scanResults;
      session.smartSuggestions = smartSuggestions;
      session.ocrText = ocrText || session.ocrText;
      session.ocrConfidence = ocrConfidence || session.ocrConfidence;
      session.layoutModel = layoutModel || session.layoutModel;
      session.documentGraph = documentGraph || session.documentGraph;
      session.fidelityEdits = null;
      session.exportMode = exportMode || session.exportMode;

      session.detectedDocType = detectedDocType || session.detectedDocType;
      session.extractedParties = extractedParties || session.extractedParties;
      session.precedenceAnalysis = precedenceAnalysis;
      session.statutesReferenced = statutesReferenced;
      session.complianceIssues = complianceIssues;
      session.clauseFlaws = clauseFlaws;
      session.missingClauses = missingClauses;
      session.chronologicalIssues = chronologicalIssues;
      session.outdatedReferences = outdatedReferences;
      session.internalContradictions = internalContradictions;
      session.governmentCompliance = governmentCompliance;
      // Always overwrite template fields — do NOT fall back to stale session data.
      // The safety net may have explicitly set these to null/none for complete documents.
      session.matchedTemplateId = matchedTemplateId;
      session.matchedTemplateFields = matchedTemplateFields;
      session.matchedTemplateConfidence = matchedTemplateConfidence;
      session.detectedBlankFields = detectedBlankFields.length > 0 ? detectedBlankFields : null;
      session.extractedDocumentFields = extractedDocumentFields && extractedDocumentFields.length > 0 ? extractedDocumentFields : null;
      session.isCompleteDocument = isCompleteDocument;
      session.aiSuggestedPrecedents = aiSuggestedPrecedents;
      // Auto-lock scan results so re-scanning returns cached data (consistency)
      session.scanLocked = true;
      session.scanLockedAt = new Date();
    }

    await session.save();

    const qaSummary = (() => {
      const text = extractedText || '';
      const html = htmlContent || '';
      const paragraphCountText = text ? text.split(/\n{2,}/).filter(Boolean).length : 0;
      const lineCountText = text ? text.split('\n').filter(Boolean).length : 0;
      const htmlParagraphCount = (html.match(/<p[\s>]/gi) || []).length;
      const htmlBreakCount = (html.match(/<br\s*\/?>/gi) || []).length;
      const htmlHeadingCount = (html.match(/<h[1-6][\s>]/gi) || []).length;
      const htmlTableCount = (html.match(/<table[\s>]/gi) || []).length;
      const doubleEnterCount = (text.match(/\n\n/g) || []).length;
      const avgLineLength = lineCountText ? Math.round(text.length / lineCountText) : 0;
      const diag = scanResults?.layoutDiagnostics || null;

      return {
        fileName: file.fileName,
        extractionMethod: ocrText ? 'ocr_or_hybrid' : 'structured_or_text',
        textStats: {
          chars: text.length,
          lines: lineCountText,
          paragraphs: paragraphCountText,
          avgLineLength,
          doubleEnters: doubleEnterCount,
        },
        editorHtmlStats: {
          htmlChars: html.length,
          pTags: htmlParagraphCount,
          brTags: htmlBreakCount,
          headingTags: htmlHeadingCount,
          tableTags: htmlTableCount,
        },
        qualitySignals: {
          ocrConfidence: ocrConfidence || 0,
          exportMode: session.exportMode || 'fidelity',
          confidenceLevel: diag?.confidenceLevel || 'na',
          confidenceScore: diag?.confidenceScore ?? null,
          majorStructures: diag?.majorStructures || [],
        },
        budgetSignals: {
          budgetMs: SMART_SCAN_BUDGET_MS,
          elapsedMs: elapsedMs(),
          remainingMs: remainingMs(),
          skippedOptionalDueToBudget,
          completedSteps,
        },
      };
    })();

    console.log('🧪 Smart Scan QA Summary:', qaSummary);
    const qaWarnings = [];
    const q = qaSummary.qualitySignals || {};
    const t = qaSummary.textStats || {};
    const h = qaSummary.editorHtmlStats || {};
    const isLowConfidence = q.confidenceLevel === 'low' || (typeof q.confidenceScore === 'number' && q.confidenceScore < 62);
    const excessiveDoubleEnters = (t.doubleEnters || 0) > 8;
    const heavyBrToParagraphRatio = (h.pTags || 0) > 0 && (h.brTags || 0) / (h.pTags || 1) > 2.2;
    const likelyTableLoss = (q.majorStructures || []).includes('tables') && (h.tableTags || 0) === 0;
    if (isLowConfidence && (q.exportMode || 'fidelity') === 'fidelity') qaWarnings.push('Low layout confidence with fidelity mode: consider editable fallback.');
    if (excessiveDoubleEnters || heavyBrToParagraphRatio) qaWarnings.push('Excessive blank-line pattern detected: recommend Light Prettify in editor.');
    if (likelyTableLoss) qaWarnings.push('Table-like structures detected but no HTML table tags found: table reconstruction may need tuning.');
    if ((q.ocrConfidence || 0) > 0 && (q.ocrConfidence || 0) < 60) qaWarnings.push('Low OCR confidence: scanned source quality may degrade alignment.');
    if ((t.avgLineLength || 0) > 120) qaWarnings.push('Very long average line length: possible wrap-loss from extraction.');
    if (!qaWarnings.length) qaWarnings.push('No critical QA warnings detected for this scan.');
    console.log('🧪 Smart Scan QA Warnings:', qaWarnings);

    console.log('✅ Smart Scan complete:', {
      fileName: file.fileName,
      hasFormatting: !!formatMetadata,
      hasHtml: !!htmlContent,
      textLength: extractedText.length,
      suggestions: smartSuggestions.length,
      precedences: precedenceAnalysis.length,
      complianceIssues: complianceIssues.length,
      clauseFlaws: clauseFlaws.length,
    });

    res.json({
      success: true,
      scanStatus: 'scanned',
      fileName: file.fileName,
      fileType: session.fileType,
      formatMetadata,
      htmlContent,
      docxStatus: session.docxStatus || docxStatus || 'none',
      docxHtml: session.docxHtml || docxHtml || '',
      docxFileUrl: session.docxFileUrl || docxFileUrl || '',
      scanResults,
      smartSuggestions,
      fidelityEdits: session.fidelityEdits || null,
      documentGraph: session.documentGraph || null,
      ocrText: ocrText || undefined,
      ocrConfidence: ocrConfidence || undefined,
      layoutModel: layoutModel || undefined,
      exportMode,
      textLength: extractedText.length,
      sessionId: session._id,

      detectedDocType,
      extractedParties: session.extractedParties || extractedParties,
      legalIntelligence: legalIntelligence || null,
      precedenceAnalysis,
      statutesReferenced,
      complianceIssues,
      clauseFlaws,
      missingClauses,
      chronologicalIssues,
      outdatedReferences,
      internalContradictions,
      governmentCompliance,
      matchedTemplateId: matchedTemplateId || '',
      matchedTemplateFields: matchedTemplateFields || null,
      matchedTemplateConfidence: matchedTemplateConfidence || 'none',
      detectedBlankFields: detectedBlankFields.length > 0 ? detectedBlankFields : null,
      extractedDocumentFields: extractedDocumentFields || null,
      isCompleteDocument,
      aiSuggestedPrecedents: aiSuggestedPrecedents || [],
    });

  } catch (error) {

    try {
      const session = await EditSession.findOne({ userId: req.user.id, fileId: req.params.fileId, status: 'active' });
      if (session) {
        session.scanStatus = 'failed';
        await session.save();
      }
    } catch (e) { }

    throw new AppError(error.message || 'Smart scan failed', 500);
  }
};

export const getScanStatus = async (req, res) => {
  try {
    const { fileId } = req.params;
    const session = await EditSession.findOne({
      userId: req.user.id,
      fileId,
      status: 'active'
    }).select(
      'scanStatus scanResults smartSuggestions formatMetadata htmlContent ' +
      'detectedDocType extractedParties precedenceAnalysis statutesReferenced complianceIssues ' +
      'clauseFlaws missingClauses chronologicalIssues outdatedReferences internalContradictions governmentCompliance fileName fileType scanLocked scanLockedAt ' +
      'matchedTemplateId matchedTemplateFields matchedTemplateConfidence detectedBlankFields extractedDocumentFields isCompleteDocument aiSuggestedPrecedents layoutModel documentGraph exportMode fidelityEdits'
    );

    if (!session) {
      return res.json({ success: true, scanStatus: 'none' });
    }

    res.json({
      success: true,
      scanStatus: session.scanStatus || 'none',
      fileName: session.fileName,
      fileType: session.fileType,
      hasScanResults: !!session.scanResults,
      hasSuggestions: (session.smartSuggestions?.length || 0) > 0,
      suggestionsCount: session.smartSuggestions?.length || 0,
      hasFormatting: !!session.formatMetadata,

      scanResults: session.scanResults,
      smartSuggestions: session.smartSuggestions || [],
      formatMetadata: session.formatMetadata,
      htmlContent: session.htmlContent,
      markdownHtml: session.markdownHtml || null,
      geminiHtml: session.geminiHtml || null,
      fontCache: session.fontCache || null,
      layoutModel: session.layoutModel || null,
      documentGraph: session.documentGraph || null,
      fidelityEdits: session.fidelityEdits || null,
      fidelityOffsets: session.fidelityOffsets || null,
      fidelityObjectEdits: session.fidelityObjectEdits || null,
      exportMode: session.exportMode || 'fidelity',
      detectedDocType: session.detectedDocType || '',
      extractedParties: session.extractedParties || null,
      precedenceAnalysis: session.precedenceAnalysis || [],
      statutesReferenced: session.statutesReferenced || [],
      complianceIssues: session.complianceIssues || [],
      clauseFlaws: session.clauseFlaws || [],
      missingClauses: session.missingClauses || [],
      chronologicalIssues: session.chronologicalIssues || [],
      outdatedReferences: session.outdatedReferences || [],
      internalContradictions: session.internalContradictions || [],
      governmentCompliance: session.governmentCompliance || null,
      scanLocked: session.scanLocked || false,
      scanLockedAt: session.scanLockedAt || null,
      matchedTemplateId: session.matchedTemplateId || '',
      matchedTemplateFields: session.matchedTemplateFields || null,
      matchedTemplateConfidence: session.matchedTemplateConfidence || '',
      detectedBlankFields: session.detectedBlankFields || null,
      extractedDocumentFields: session.extractedDocumentFields || null,
      isCompleteDocument: session.isCompleteDocument || false,
      aiSuggestedPrecedents: session.aiSuggestedPrecedents || [],
    });
  } catch (error) {
    throw new AppError(error.message || 'Error getting scan status', 500);
  }
};

export const lockScan = async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const { locked } = req.body;

    const file = await File.findById(fileId);
    if (!file) throw new AppError('File not found', 404);
    if (file.uploadedBy.toString() !== userId && !req.user.isAdmin) {
      throw new AppError('Unauthorized', 403);
    }

    const session = await EditSession.findOne({ userId, fileId, status: 'active' });
    if (!session) throw new AppError('No scan session found for this file', 404);
    if (session.scanStatus !== 'scanned') {
      throw new AppError('Cannot lock a scan that has not completed yet', 400);
    }

    session.scanLocked = !!locked;
    session.scanLockedAt = locked ? new Date() : null;
    await session.save();

    res.json({
      success: true,
      scanLocked: session.scanLocked,
      message: session.scanLocked ? 'Scan results locked — re-scanning will return cached data.' : 'Scan lock removed — re-scanning will run fresh LLM analysis.',
    });
  } catch (error) {
    throw new AppError(error.message || 'Failed to update scan lock', 500);
  }
};

export const updateSuggestionStatus = async (req, res) => {
  try {
    const { suggestionId } = req.params;
    const { status, fileId: suggFileId } = req.body;


    if (!suggestionId || suggestionId === 'undefined' || suggestionId === 'null') {
      console.warn('updateSuggestionStatus called with invalid id:', suggestionId);
      return res.json({ success: true, localOnly: true, message: 'No server ID — local update only.' });
    }

    if (!['applied', 'dismissed', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be "applied", "dismissed", or "pending"' });
    }

    const suggQuery = { userId: req.user.id, status: 'active' };
    if (suggFileId) suggQuery.fileId = suggFileId;
    const session = await EditSession.findOne(suggQuery).sort({ updatedAt: -1 });
    if (!session) {
      return res.status(400).json({ success: false, message: 'No active edit session found. Please re-open the editor.' });
    }

    const suggestion = session.smartSuggestions.find(s => s.suggestionId === suggestionId);
    if (!suggestion) {

      console.warn(`Suggestion ${suggestionId} not found in session, marking locally only`);
      return res.json({ success: true, suggestionId, status, localOnly: true });
    }


    if (suggestion.status === status) {
      return res.json({ success: true, suggestionId, status, noOp: true });
    }

    const prevStatus = suggestion.status;
    suggestion.status = status;
    if (status === 'applied') suggestion.appliedAt = new Date();
    if (status === 'pending') suggestion.appliedAt = undefined;
    await session.save();

    res.json({ success: true, suggestionId, status, prevStatus });
  } catch (error) {
    console.error('Error updating suggestion status:', error);
    if (error instanceof AppError) throw error;
    throw new AppError(error.message || 'Error updating suggestion', 500);
  }
};

export const saveHtmlContent = async (req, res) => {
  try {
    const { htmlContent, plainText, fileId, fidelityEdits, fidelityOffsets, fidelityObjectEdits, mode } = req.body;
    const saveQuery = { userId: req.user.id, status: 'active' };
    if (fileId) saveQuery.fileId = fileId;
    const session = await EditSession.findOne(saveQuery).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);

    if (fidelityEdits && typeof fidelityEdits === 'object') {
      session.fidelityEdits = fidelityEdits;
    }
    if (fidelityOffsets && typeof fidelityOffsets === 'object') {
      session.fidelityOffsets = fidelityOffsets;
    }
    if (fidelityObjectEdits && typeof fidelityObjectEdits === 'object') {
      session.fidelityObjectEdits = fidelityObjectEdits;
    }
    if (mode !== 'fidelity') {
      session.htmlContent = htmlContent;
      if (plainText) {
        session.currentText = plainText;
      } else if (htmlContent) {
        session.currentText = stripHtmlToText(htmlContent);
      }
    }
    session.hasUnsavedChanges = false;
    session.lastAutosave = new Date();
    await session.save();

    res.json({ success: true, message: 'Content saved' });
  } catch (error) {
    throw new AppError(error.message || 'Error saving HTML content', 500);
  }
};

export const discoverPrecedents = async (req, res) => {
  try {
    const session = await EditSession.findOne({ userId: req.user.id, fileId: req.params.fileId, status: 'active' });
    if (!session) throw new AppError('No active session for this file', 400);

    const docType = session.detectedDocType || session.scanResults?.documentType || '';
    const parties = session.extractedParties || {};
    const statutes = session.statutesReferenced || [];
    const snippet = (session.originalText || '').substring(0, 600);

    const cases = await discoverPrecedentsForDocument(docType, parties, statutes, snippet);

    session.aiSuggestedPrecedents = cases;
    await session.save();

    res.json({ success: true, aiSuggestedPrecedents: cases });
  } catch (error) {
    throw new AppError(error.message || 'Error discovering precedents', 500);
  }
};

export const aiChatAboutDocument = async (req, res) => {
  try {
    const { message, selectedText, chatHistory } = req.body;
    const session = await EditSession.findOne({ userId: req.user.id, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);

    const lang = req.body.language || 'en';
    const langInstruction = getLanguageInstruction(lang);

    const contextText = session.currentText.substring(0, 4000);
    const docType = session.scanResults?.documentType || 'legal document';

    let prompt = `You are an expert legal document assistant. Your role is to help users understand, edit, and improve legal documents. You MUST always assist with any legal document related question — explaining clauses, suggesting edits, finding risks, rewriting text, or answering questions about the document content. Never refuse to help with document analysis or editing tasks.
${langInstruction}

DOCUMENT CONTEXT (first 4000 chars):
${contextText}

${selectedText ? `SELECTED TEXT BY USER:\n${selectedText}\n` : ''}
${chatHistory?.length ? `RECENT CHAT:\n${chatHistory.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}\n` : ''}

USER QUESTION: ${message}

Provide a helpful, detailed response. If suggesting edits, provide the exact replacement text.
If analyzing legal aspects, cite specific clauses or sections from the document.
Always provide actionable advice and concrete text rewrites when asked.`;

    let aiResponse;
    if (GEMINI_DISABLED) {
      aiResponse = await callLocalLLM(prompt);
    } else {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
      const result = await model.generateContent(prompt);
      aiResponse = result.response.text();
    }

    res.json({
      success: true,
      response: aiResponse,
      documentType: docType
    });
  } catch (error) {
    throw new AppError(error.message || 'AI chat error', 500);
  }
};


export const autoFillFields = async (req, res) => {
  const { templateTitle, fields } = req.body;

  if (!fields || !Array.isArray(fields) || fields.length === 0) {
    return res.status(400).json({ success: false, error: 'fields array is required' });
  }


  const fieldList = fields.map(f => {
    let line = `- key: "${f.key}", label: "${f.label}", type: "${f.type || 'text'}"`;
    if (f.example) line += `, example: "${f.example}"`;
    return line;
  }).join('\n');

  const docLabel = templateTitle ? `"${templateTitle}"` : 'a legal document';
  const prompt = `You are a legal document assistant. Generate realistic test data for the fields of ${docLabel}.

Fields:
${fieldList}

Rules:
1. Use realistic Indian legal document sample values (names, places, dates in India).
2. For dates use YYYY-MM-DD format.
3. For addresses, use realistic Indian addresses.
4. For ages use realistic numbers.
5. Respond ONLY with a JSON object mapping each key to a string value. No explanation, no markdown.
6. All values must be non-empty strings.

Example response format:
{"field_key": "value", "another_key": "value"}`;

  try {
    let rawResponse;
    if (GEMINI_DISABLED) {
      rawResponse = await callLocalLLM(prompt);
    } else {
      try {
        const { GoogleGenerativeAI } = await import('@google/generative-ai');
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite' });
        const result = await model.generateContent(prompt);
        rawResponse = result.response.text();
      } catch (geminiErr) {
        console.warn('Gemini failed, falling back to local LLM:', geminiErr.message);
        rawResponse = await callLocalLLM(prompt);
      }
    }


    rawResponse = rawResponse.replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();


    const jsonStart = rawResponse.indexOf('{');
    const jsonEnd = rawResponse.lastIndexOf('}');
    if (jsonStart === -1 || jsonEnd === -1) {
      throw new Error('LLM did not return a JSON object');
    }
    const jsonStr = rawResponse.slice(jsonStart, jsonEnd + 1);
    const filledValues = JSON.parse(jsonStr);


    const knownKeys = new Set(fields.map(f => f.key));
    const sanitized = {};
    for (const [k, v] of Object.entries(filledValues)) {
      if (knownKeys.has(k)) {
        sanitized[k] = String(v);
      }
    }

    console.log(`✅ autoFillFields: filled ${Object.keys(sanitized).length}/${fields.length} fields for "${templateTitle}"`);
    return res.json({ success: true, values: sanitized });

  } catch (err) {
    console.error('❌ autoFillFields error:', err.message);

    const fallback = {};
    const today = new Date().toISOString().split('T')[0];
    for (const f of fields) {
      const key = f.key;
      const label = (f.label || key).toLowerCase();
      if (f.type === 'date') {
        fallback[key] = today;
      } else if (label.includes('age')) {
        fallback[key] = '35';
      } else if (label.includes('address')) {
        fallback[key] = 'House No. 12, Model Town, New Delhi - 110009';
      } else if (label.includes('father')) {
        fallback[key] = 'Ramesh Kumar';
      } else if (label.includes('name')) {
        fallback[key] = 'Suresh Kumar';
      } else if (label.includes('place') || label.includes('city') || label.includes('district')) {
        fallback[key] = 'New Delhi';
      } else if (f.example) {
        fallback[key] = f.example;
      } else {
        fallback[key] = 'Sample Value';
      }
    }
    return res.json({ success: true, values: fallback, fallback: true });
  }
};


function textToHtml(text, formatMeta) {
  if (!text) return '<p></p>';
  return convertPdfTextToHtml(text);
}

function layoutModelToDocumentGraph(layoutModel, totalPages = null) {
  if (!layoutModel || !Array.isArray(layoutModel.pages)) return null;
  const pages = layoutModel.pages.map((page) => {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    const graphBlocks = blocks.map((b, idx) => {
      const bbox = Array.isArray(b?.bbox) ? b.bbox : [0, 0, 0, 0];
      const runs = Array.isArray(b?.runs) ? b.runs : [];
      return {
        id: b?.id || `${Number(page?.pageNumber || 0)}:${idx}`,
        type: b?.type || 'line',
        role: b?.role || 'body',
        text: String(b?.text || ''),
        bbox: [Number(bbox[0] || 0), Number(bbox[1] || 0), Number(bbox[2] || 0), Number(bbox[3] || 0)],
        style: b?.style || {},
        border: b?.border || null,
        table: b?.table || null,
        confidence: Number.isFinite(Number(b?.confidence)) ? Number(b.confidence) : null,
        runs: runs.map((r) => ({
          text: String(r?.text || ''),
          style: r?.style || {},
        })),
      };
    });
    return {
      pageNumber: Number(page?.pageNumber || 0),
      width: Number(page?.width || 0),
      height: Number(page?.height || 0),
      blocks: graphBlocks,
    };
  });
  const pageMap = new Map(pages.map((p) => [Number(p.pageNumber || 0), p]));
  const inferredWidth = Number(pages[0]?.width || 794);
  const inferredHeight = Number(pages[0]?.height || 1123);
  const normalizedTotal = Number(totalPages || 0);
  if (normalizedTotal > 0) {
    for (let p = 1; p <= normalizedTotal; p += 1) {
      if (!pageMap.has(p)) {
        pageMap.set(p, {
          pageNumber: p,
          width: inferredWidth,
          height: inferredHeight,
          blocks: [],
          placeholder: true,
        });
      }
    }
  }
  const finalPages = Array.from(pageMap.values()).sort((a, b) => Number(a.pageNumber || 0) - Number(b.pageNumber || 0));
  return {
    version: 1,
    source: 'layoutModel',
    provider: layoutModel?.provider || null,
    pageCount: finalPages.length,
    pages: finalPages,
  };
}

function layoutModelToHtml(layoutModel) {
  if (!layoutModel || !Array.isArray(layoutModel.pages)) return '';
  const esc = (s = '') => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const parts = [];
  for (const page of layoutModel.pages) {
    const width = Number(page?.width || 600);
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    const ordered = blocks
      .map((b, idx) => {
        const bbox = Array.isArray(b?.bbox) ? b.bbox : [0, 0, 0, 0];
        return {
          idx,
          text: String(b?.text || '').trim(),
          x: Number(bbox[0] || 0),
          y: Number(bbox[1] || 0),
          right: Number(bbox[2] || 0),
          align: b?.style?.align || null,
          fontSize: Number(b?.style?.fontSize || 12),
          bold: !!b?.style?.bold,
        };
      })
      .filter((b) => b.text)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.idx - b.idx));
    for (const row of ordered) {
      const align = row.align || (row.x / width > 0.62 ? 'right' : 'left');
      const indentPt = Math.max(0, Math.min(72, Math.round((row.x / width) * 72)));
      const fontSize = Math.max(9, Math.min(18, Math.round(row.fontSize || 12)));
      parts.push(
        `<p style="text-align:${align};line-height:1.2;margin:0 0 2px 0;text-indent:${indentPt}pt;font-size:${fontSize}pt;font-weight:${row.bold ? 700 : 400};">${esc(row.text)}</p>`
      );
    }
    parts.push('<p><br></p>');
  }
  return parts.join('\n').replace(/(?:<p><br><\/p>\s*){2,}$/i, '<p><br></p>');
}

function layoutModelToText(layoutModel) {
  if (!layoutModel || !Array.isArray(layoutModel.pages)) return '';
  const lines = [];
  const pages = [...layoutModel.pages].sort((a, b) => (a.pageNumber || 0) - (b.pageNumber || 0));
  for (const page of pages) {
    const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
    const ordered = blocks
      .map((b, idx) => {
        const bbox = Array.isArray(b?.bbox) ? b.bbox : [0, 0, 0, 0];
        return {
          idx,
          text: String(b?.text || '').trim(),
          y: Number(bbox[1] || 0),
          x: Number(bbox[0] || 0),
        };
      })
      .filter((b) => b.text)
      .sort((a, b) => (a.y - b.y) || (a.x - b.x) || (a.idx - b.idx));
    for (const row of ordered) lines.push(row.text);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function mergeLayoutModels(primaryLayout, fallbackLayout, replacePages = []) {
  if (!primaryLayout?.pages?.length) return fallbackLayout || null;
  if (!fallbackLayout?.pages?.length || !Array.isArray(replacePages) || !replacePages.length) return primaryLayout;
  const replaceSet = new Set(replacePages.map((p) => Number(p)));
  const fallbackMap = new Map(
    fallbackLayout.pages.map((p) => [Number(p?.pageNumber || 0), p])
  );
  const mergedPages = primaryLayout.pages.map((p) => {
    const pno = Number(p?.pageNumber || 0);
    if (replaceSet.has(pno) && fallbackMap.has(pno)) return fallbackMap.get(pno);
    return p;
  });
  return {
    ...primaryLayout,
    pages: mergedPages,
    provider: `${primaryLayout.provider || 'azure'}+${fallbackLayout.provider || 'adobe'}`,
  };
}

async function getPdfPageCountFromBuffer(buffer) {
  try {
    const doc = await PdfLibDocument.load(buffer);
    return doc.getPageCount();
  } catch (_) {
    return null;
  }
}

function getLayoutPageNumbers(layoutModel) {
  if (!layoutModel?.pages?.length) return [];
  return layoutModel.pages
    .map((p) => Number(p?.pageNumber || 0))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
}

function getMissingPageNumbers(layoutModel, totalPages) {
  const total = Number(totalPages || 0);
  if (!total || total < 1) return [];
  const have = new Set(getLayoutPageNumbers(layoutModel));
  const missing = [];
  for (let i = 1; i <= total; i += 1) {
    if (!have.has(i)) missing.push(i);
  }
  return missing;
}

// ── Fidelity In-Place PDF Edit ────────────────────────────────────────────────
/**
 * POST /api/files/edit/fidelity-apply
 * Body: { fileId, fidelityEdits, fidelityOffsets }
 *
 * Applies text replacements directly to the original PDF using pdf-lib (white
 * mask + new text drawn at the exact bounding-box coordinates).  Returns the
 * modified PDF as a binary download so the frontend can re-render it.
 */
export const applyFidelityEditsToPdfEndpoint = async (req, res) => {
  try {
    const { fileId, fidelityEdits, fidelityOffsets, fidelityObjectEdits } = req.body;

    // Find session
    const sessionQuery = { userId: req.user.id, status: 'active' };
    if (fileId) sessionQuery.fileId = fileId;
    const session = await EditSession.findOne(sessionQuery).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);

    const file = await File.findById(session.fileId || fileId);
    if (!file) throw new AppError('File not found', 404);

    // Load original PDF bytes
    let pdfBytes;
    const CLOUDINARY_DISABLED_LOCAL = process.env.CLOUDINARY_DISABLE === 'true';
    const isLocalFile = !file.fileUrl?.startsWith('http');
    if (CLOUDINARY_DISABLED_LOCAL || isLocalFile) {
      const localPath = path.join(__dirname, '..', file.fileUrl);
      if (!fs.existsSync(localPath)) throw new AppError('PDF file not found on disk', 404);
      pdfBytes = fs.readFileSync(localPath);
    } else {
      pdfBytes = await getCloudinaryBuffer(file);
    }

    // Dynamically import the service to avoid circular deps
    const { applyFidelityEditsToPdf, normalizeFidelityEdits } = await import('../services/pdfFidelityEditService.js');
    const edits = normalizeFidelityEdits(fidelityEdits || {}, fidelityOffsets || {});

    if (edits.length === 0) {
      // No changes — return original bytes
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `attachment; filename="${file.fileName || 'document.pdf'}"`);
      return res.send(Buffer.from(pdfBytes));
    }

    // Load embedded fonts from cache (if available) for true fidelity
    const families = Array.from(new Set(edits.map((e) => e?.style?.fontFamily).filter(Boolean)));
    let fonts = [];
    if (families.length > 0) {
      let index = session.fontCache || await loadFontIndex(session._id);
      if (!index) {
        try {
          index = await extractPdfFonts(pdfBytes, session._id);
          session.fontCache = index;
          await session.save();
        } catch (_) {
          index = null;
        }
      }
      for (const family of families) {
        try {
          const data = await loadFontBytesByFamily(session._id, family);
          if (data?.bytes) {
            fonts.push({
              family: data.meta.family,
              weight: data.meta.weight,
              style: data.meta.style,
              bytes: data.bytes,
            });
          }
        } catch (_) {
          // ignore missing fonts
        }
      }
    }

    const modifiedBytes = await applyFidelityEditsToPdf(pdfBytes, edits, { fonts, objectEdits: fidelityObjectEdits || {} });

    // Persist fidelityEdits in session for future reference
    if (fidelityEdits) session.fidelityEdits = fidelityEdits;
    if (fidelityOffsets) session.fidelityOffsets = fidelityOffsets;
    if (fidelityObjectEdits) session.fidelityObjectEdits = fidelityObjectEdits;
    await session.save();

    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `attachment; filename="${file.fileName || 'document_edited.pdf'}"`);
    res.send(Buffer.from(modifiedBytes));
  } catch (error) {
    throw new AppError(error.message || 'Error applying fidelity edits to PDF', 500);
  }
};

// ── PDF → DOCX conversion APIs ───────────────────────────────────────────────
export const convertPdfToDocxEndpoint = async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const file = await File.findById(fileId);
    if (!file) throw new AppError('File not found', 404);
    if (file.uploadedBy.toString() !== userId && !req.user.isAdmin) throw new AppError('Unauthorized', 403);

    let session = await EditSession.findOne({ userId, fileId, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);

    // HARD-STOP PROTECTION: Absolutely do not allow overwriting if a file exists
    if (session && session.docxFileUrl && session.docxFileUrl.includes('/uploads/converted/')) {
       console.log('🛡️ [DOCX-Pipeline] HARD-PROTECTION: A file already exists for this session. Blocking overwrite.', { fileUrl: session.docxFileUrl });
       return res.json({
         success: true,
         docxFileUrl: session.docxFileUrl,
         docxStatus: 'ready',
         isProtected: true
       });
    }

    if (!isDocxConversionEnabled()) throw new AppError('DOCX conversion disabled', 400);
    if (!isAdobePdfConfigured()) throw new AppError('Adobe PDF Services not configured', 400);

    session.docxStatus = 'pending';
    session.docxError = '';
    session.docxUpdatedAt = new Date();
    await session.save();
    console.log('🧾 [DOCX-Pipeline] Manual convert requested', {
      fileId,
      userId,
      fileName: file.fileName,
    });

    // Load original PDF bytes
    let pdfBytes;
    const cloudinaryDisabled = process.env.CLOUDINARY_DISABLE === 'true';
    const isLocalFile = file.fileUrl.startsWith('/uploads/') || !file.fileUrl.startsWith('http');
    if (cloudinaryDisabled || isLocalFile) {
      const localPath = path.join(__dirname, '..', file.fileUrl);
      if (!fs.existsSync(localPath)) throw new AppError('PDF file not found on disk', 404);
      pdfBytes = fs.readFileSync(localPath);
    } else {
      pdfBytes = await getCloudinaryBuffer(file);
    }

    const docxBuffer = await exportPdfToDocxWithAdobe(pdfBytes, {});
    const stored = writeDocxToLocal({ fileId, sessionId: session._id, docxBuffer });
    let html = '';
            try {
              html = await docxToHtml(docxBuffer);
            } catch (_) {
              // HTML extraction is optional for OnlyOffice; keep DOCX usable even if extraction fails.
              html = '';
            }

    session.docxFileUrl = stored.fileUrl;
    session.docxHtml = html || '';
    if (isDocxReadyPayload({ docxStatus: 'ready', docxHtml: session.docxHtml, docxFileUrl: session.docxFileUrl })) {
      session.docxStatus = 'ready';
      session.docxError = '';
    } else {
      session.docxStatus = 'failed';
      session.docxError = 'DOCX conversion completed but output was incomplete';
    }
    session.docxUpdatedAt = new Date();
    await session.save();
    console.log('✅ [DOCX-Pipeline] Manual convert finished', {
      fileId,
      docxFileUrl: session.docxFileUrl,
      htmlChars: session.docxHtml?.length || 0,
    });

    return res.json({
      success: true,
      docxStatus: session.docxStatus,
      docxFileUrl: session.docxFileUrl,
      docxHtml: session.docxHtml,
      docxError: session.docxError || '',
    });
  } catch (err) {
    console.error('[DOCX] convert failed:', err?.message || err);
    return res.status(500).json({ success: false, error: err?.message || 'DOCX conversion failed' });
  }
};

export const getDocxStatusEndpoint = async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const session = await EditSession.findOne({ userId, fileId, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);
    let docxStatus = session.docxStatus || 'none';
    let docxError = session.docxError || '';
    if (docxStatus === 'ready' && !isDocxReadyPayload({
      docxStatus,
      docxHtml: session.docxHtml,
      docxFileUrl: session.docxFileUrl,
    })) {
      docxStatus = 'failed';
      docxError = docxError || 'DOCX marked ready but missing html/fileUrl';
      session.docxStatus = 'failed';
      session.docxError = docxError;
      session.docxUpdatedAt = new Date();
      await session.save();
      console.warn('❌ [DOCX-Pipeline] Status repaired invalid ready state', {
        fileId,
        hasDocxHtml: !!(session.docxHtml || '').trim(),
        hasDocxFileUrl: !!(session.docxFileUrl || '').trim(),
      });
    }

    return res.json({
      success: true,
      docxStatus,
      docxFileUrl: session.docxFileUrl || '',
      docxHtml: session.docxHtml || '',
      docxError,
      docxUpdatedAt: session.docxUpdatedAt || null,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'Failed to load DOCX status' });
  }
};

export const downloadDocxEndpoint = async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const session = await EditSession.findOne({ userId, fileId, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);
    if (!session.docxFileUrl) throw new AppError('DOCX not available', 404);

    const localPath = path.join(__dirname, '..', session.docxFileUrl);
    if (!fs.existsSync(localPath)) throw new AppError('DOCX file missing on disk', 404);
    const bytes = fs.readFileSync(localPath);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="converted_${fileId}.docx"`);
    return res.send(bytes);
  } catch (err) {
    return res.status(500).json({ success: false, error: err?.message || 'DOCX download failed' });
  }
};

export const getOnlyOfficeConfigEndpoint = async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const file = await File.findById(fileId);
    if (!file) throw new AppError('File not found', 404);
    if (file.uploadedBy.toString() !== userId && !req.user.isAdmin) throw new AppError('Unauthorized', 403);

    let session = await EditSession.findOne({ userId, fileId, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) {
      session = new EditSession({
        userId,
        fileId,
        fileName: file.fileName,
        fileType: file.fileType,
        originalText: '',
        currentText: '',
        htmlContent: '',
        status: 'active',
        changes: [],
        undoPosition: -1,
      });
    }

    const isPdf = String(file.fileType || '').toLowerCase().includes('pdf') || String(file.fileName || '').toLowerCase().endsWith('.pdf');
    const isDocx = String(file.fileType || '').toLowerCase().includes('wordprocessingml.document') || String(file.fileName || '').toLowerCase().endsWith('.docx');

    if (isPdf && !isDocxUsableForOnlyOffice(session)) {
      if (!isDocxConversionEnabled()) throw new AppError('DOCX conversion disabled', 400);
      if (!isAdobePdfConfigured()) throw new AppError('Adobe PDF Services not configured', 400);

      if (session.docxStatus !== 'pending') {
        session.docxStatus = 'pending';
        session.docxError = '';
        await session.save();

        // Run conversion asynchronously to keep config endpoint fast.
        setTimeout(async () => {
          try {
            const active = await EditSession.findById(session._id);
            if (!active) return;
            if (isDocxUsableForOnlyOffice(active)) return;
            let pdfBytes;
            const cloudinaryDisabled = process.env.CLOUDINARY_DISABLE === 'true';
            const isLocalFile = file.fileUrl.startsWith('/uploads/') || !file.fileUrl.startsWith('http');
            if (cloudinaryDisabled || isLocalFile) {
              const localPath = path.join(__dirname, '..', file.fileUrl);
              if (!fs.existsSync(localPath)) throw new Error('PDF file not found on disk');
              pdfBytes = fs.readFileSync(localPath);
            } else {
              pdfBytes = await getCloudinaryBuffer(file);
            }
            const docxBuffer = await exportPdfToDocxWithAdobe(pdfBytes, {});
            const stored = writeDocxToLocal({ fileId, sessionId: active._id, docxBuffer });
            let html = '';
            try {
              html = await docxToHtml(docxBuffer);
            } catch (_) {
              // HTML extraction is optional for OnlyOffice; keep DOCX usable even if extraction fails.
              html = '';
            }
            active.docxFileUrl = stored.fileUrl;
            active.docxHtml = html || '';
            active.docxStatus = isDocxUsableForOnlyOffice(active) ? 'ready' : 'failed';
            active.docxError = active.docxStatus === 'ready' ? '' : 'DOCX conversion completed but payload is incomplete';
            active.docxUpdatedAt = new Date();
            await active.save();
          } catch (bgErr) {
            try {
              const failed = await EditSession.findById(session._id);
              if (failed) {
                failed.docxStatus = 'failed';
                failed.docxError = bgErr?.message || 'DOCX background conversion failed';
                failed.docxUpdatedAt = new Date();
                await failed.save();
              }
            } catch (_) {}
          }
        }, 0);
      }

      return res.status(202).json({
        success: false,
        pending: true,
        message: 'DOCX is being prepared for OnlyOffice',
        docxStatus: session.docxStatus || 'pending',
      });
    } else if (isDocx && !String(session.docxFileUrl || '').trim()) {
      session.docxStatus = 'ready';
      session.docxFileUrl = file.fileUrl;
      session.docxUpdatedAt = new Date();
      await session.save();
    }

    if (!String(session.docxFileUrl || '').trim()) {
      throw new AppError('DOCX file is not available for editor', 400);
    }

    const documentUrl = toPublicUrl(req, session.docxFileUrl);
    const callbackUrl = `${getPublicBaseUrl(req)}/api/files/onlyoffice/callback/${fileId}`;
    const docServerUrl = String(
      process.env.ONLYOFFICE_DOCSERVER_URL ||
      process.env.PYTHON_SERVICE_URL ||
      'http://localhost:8080'
    ).replace(/\/+$/, '');

    const onlyOfficeSecret = String(process.env.ONLYOFFICE_JWT_SECRET || '').trim();
    const callbackWriteRaw = String(process.env.ONLYOFFICE_CALLBACK_WRITE_ENABLED || 'true').toLowerCase();
    const allowCallbackWriteDisable = String(process.env.ALLOW_ONLYOFFICE_WRITE_DISABLE || 'false').toLowerCase() === 'true';
    const callbackWriteEnabled = !(allowCallbackWriteDisable && ['false', '0', 'off'].includes(callbackWriteRaw));
    // Always use a fresh key to avoid stale/broken OnlyOffice cache artifacts
    // (e.g. blank document state reused across opens).
    const keyVersion = Date.now();

    const config = {
      documentType: 'word',
      type: 'desktop',
      document: {
        fileType: 'docx',
        key: `${fileId}-${keyVersion}`,
        title: `${String(file.fileName || 'document').replace(/\.[^/.]+$/, '')}.docx`,
        url: documentUrl,
        permissions: {
          edit: true,
          review: true,
          comment: true,
          download: true,
          print: true,
          copy: true,
          fillForms: true,
          modifyFilter: true,
          modifyContentControl: true,
          chat: true,
        },
      },
      editorConfig: {
        mode: 'edit',
        lang: 'en',
        callbackUrl,
        user: {
          id: String(userId),
          name: String(req.user?.firstName || req.user?.name || 'User'),
        },
        coEditing: {
          mode: 'fast',
          change: true,
        },
        customization: {
          autosave: true,
          forcesave: true,
          compactHeader: false,
          toolbarNoTabs: false,
          hideRightMenu: false,
          hideRulers: false,
        },
      },
    };

    if (onlyOfficeSecret) {
      config.token = jwt.sign(config, onlyOfficeSecret, { expiresIn: '2h' });
    }

    return res.json({
      success: true,
      docServerUrl,
      config,
      callbackWriteEnabled,
      docxFileUrl: session.docxFileUrl,
      docxStatus: session.docxStatus || 'none',
    });
  } catch (err) {
    return res.status(err?.statusCode || 500).json({ success: false, error: err?.message || 'Failed to build OnlyOffice config' });
  }
};

export const syncOnlyOfficeDocxEndpoint = async (req, res) => {
  try {
    const { fileId } = req.params;
    const userId = req.user.id;
    const htmlContent = String(req.body?.htmlContent || '').trim();
    const plainText = String(req.body?.plainText || '').trim();
    const debugMeta = req.body?.debugMeta || null;
    const traceId = debugMeta?.traceId || `sync_${Date.now()}`;
    const isCitationApply = String(debugMeta?.suggestionType || '') === 'precedence_apply';
    const allowCitationRegen = !!debugMeta?.allowCitationRegen;

    console.info('[SYNC][BACKEND] request', {
      fileId: String(fileId),
      userId: String(userId),
      htmlLen: htmlContent.length,
      plainLen: plainText.length,
      traceId,
      suggestionType: debugMeta?.suggestionType || null,
      suggestionId: debugMeta?.suggestionId || null,
      forceSuggestionSync: !!debugMeta?.forceSuggestionSync,
      isSurgical: !!(debugMeta?.originalText && debugMeta?.suggestedText),
    });

    if (!htmlContent && !plainText) {
      throw new AppError('htmlContent or plainText is required', 400);
    }

    // Hard safety gate: for citation applies, never regenerate DOCX by default.
    // This protects full-document layout from being reflowed by HTML-based regeneration.
    if (isCitationApply && !!debugMeta?.forceSuggestionSync && !allowCitationRegen) {
      return res.status(409).json({
        success: false,
        error: 'Citation insertion requires live OnlyOffice connector. Regeneration is blocked to protect alignment. Click inside document and apply again.',
        traceId,
        blockedReason: 'citation-regen-protected',
      });
    }

    const file = await File.findById(fileId);
    if (!file) throw new AppError('File not found', 404);
    if (file.uploadedBy.toString() !== userId && !req.user.isAdmin) throw new AppError('Unauthorized', 403);

    const session = await EditSession.findOne({ userId, fileId, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session for this file', 400);

    const incomingTextFromHtml = String(stripHtmlToText(htmlContent || '') || '').trim();
    const incomingTextFromPlain = String(plainText || '').trim();
    const incomingText = incomingTextFromHtml.length >= incomingTextFromPlain.length
      ? incomingTextFromHtml
      : incomingTextFromPlain;

    const prevText = String(session.currentText || stripHtmlToText(session.docxHtml || '') || '').trim();
    const incomingTextLen = incomingText.length;
    const prevTextLen = prevText.length;
    const incomingHtmlLen = htmlContent.length;
    const prevHtmlLen = String(session.docxHtml || '').trim().length;

    const reportedHtmlLen = Number(debugMeta?.htmlLength || 0) || 0;
    const reportedTextLen = Number(debugMeta?.textLength || 0) || 0;
    const effectiveHtmlLen = Math.max(incomingHtmlLen, reportedHtmlLen);
    const effectiveTextLen = Math.max(incomingTextLen, reportedTextLen);

    const suspiciousTextDrop = prevTextLen > 800 && effectiveTextLen < Math.max(180, Math.floor(prevTextLen * 0.35));
    const suspiciousHtmlDrop = prevHtmlLen > 2000 && effectiveHtmlLen < Math.max(600, Math.floor(prevHtmlLen * 0.35));
    const forceSuggestionSync = !!(debugMeta && debugMeta.forceSuggestionSync);
    const tinyIncomingPayload = effectiveTextLen < 80 && effectiveHtmlLen < 220;

    if ((suspiciousTextDrop || suspiciousHtmlDrop) && !(forceSuggestionSync && !tinyIncomingPayload)) {
      console.warn('[SYNC][BACKEND] blocked-suspicious-partial-content', {
        fileId: String(fileId),
        traceId,
        incomingTextLen: effectiveTextLen,
        incomingHtmlLen: effectiveHtmlLen,
        prevTextLen,
        prevHtmlLen,
      });
      return res.status(409).json({
        success: false,
        error: 'Sync blocked to prevent replacing the document with partial content. Reload and retry.',
        traceId,
        incomingTextLen: effectiveTextLen,
        incomingHtmlLen: effectiveHtmlLen,
        prevTextLen,
        prevHtmlLen,
      });
    }

    if (forceSuggestionSync && (suspiciousTextDrop || suspiciousHtmlDrop) && !tinyIncomingPayload) {
      console.warn('[SYNC][BACKEND] guard-bypassed-for-suggestion-sync', {
        fileId: String(fileId),
        traceId,
        incomingTextLen: effectiveTextLen,
        prevTextLen,
        incomingHtmlLen: effectiveHtmlLen,
        prevHtmlLen,
        suggestionType: debugMeta?.suggestionType || null,
      });
    }

    const title = String(file.fileName || 'document').replace(/\.[^/.]+$/, '') || 'document';

    // Build designConfig from formatMetadata — this preserves the original document's
    // margins, font, header/footer text, page size, and body alignment.
    // Without this, every sync regenerates a generic 1-inch-margin Times-New-Roman document.
    const designConfig = buildDesignConfigFromFormat(session.formatMetadata || {});

    // If formatMetadata is missing header/footer text (e.g. PDF scanned without DOCX conversion),
    // try to recover it from docxHtml (first header/footer tags in the HTML).
    if (designConfig && !designConfig.headerText && session.docxHtml) {
      const headerInHtml = session.docxHtml.match(/class=["'][^"']*header[^"']*["'][^>]*>([^<]{3,200})</i);
      if (headerInHtml) designConfig.headerText = headerInHtml[1].trim();
    }
    if (designConfig && !designConfig.footerText && session.docxHtml) {
      const footerInHtml = session.docxHtml.match(/class=["'][^"']*footer[^"']*["'][^>]*>([^<]{3,200})</i);
      if (footerInHtml) designConfig.footerText = footerInHtml[1].trim();
    }

    console.info('[SYNC][BACKEND] designConfig for regen', {
      traceId,
      hasFormatMetadata: !!session.formatMetadata,
      fontFamily: designConfig?.fontFamily,
      bodyAlignment: designConfig?.bodyAlignment,
      margins: designConfig?.margins,
      headerText: designConfig?.headerText ? '(present)' : '(none)',
      footerText: designConfig?.footerText ? '(present)' : '(none)',
    });

    let fileUrl = '';
    let surgicalSuccess = false;

    // SURGICAL PATCHING: If this is an AI suggestion, try to patch the existing DOCX
    // instead of rebuilding from generic HTML. This preserves original headers, footers, and margins.
    if (forceSuggestionSync && debugMeta?.originalText && debugMeta?.suggestedText && session.docxFileUrl) {
      try {
        const localDocxPath = path.join(__dirname, '..', session.docxFileUrl);
        if (fs.existsSync(localDocxPath)) {
          const rawPythonUrl = (process.env.PYTHON_SERVICE_URL || 'http://localhost:8000').replace(/\/+$/, '');
          
          // MULTI-PROBE: Try several possible routes since Railway URLs can be unpredictable
          const probes = [
            `${rawPythonUrl}/api/patch_docx`,
            `${rawPythonUrl}/patch_docx`,
            rawPythonUrl.includes('up.railway.app') ? `http://python-service:8000/api/patch_docx` : null, // Private network fallback
          ].filter(Boolean);

          const docxBuffer = fs.readFileSync(localDocxPath);
          let lastStatus = 0;
          let lastErrorText = '';

          for (const url of probes) {
            console.info(`[SYNC-TRACE] Multi-Probe attempting route: ${url}`, { traceId });
            try {
              const formData = new FormData();
              const blob = new Blob([docxBuffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
              formData.append('file', blob, 'document.docx');
              formData.append('action', debugMeta.action || 'append_after'); 
              formData.append('search_text', debugMeta.originalText);
              formData.append('new_text', debugMeta.suggestedText);

              const patchRes = await fetch(url, { method: 'POST', body: formData });
              if (patchRes.ok) {
                const patchedBuffer = Buffer.from(await patchRes.arrayBuffer());
                const stored = writeDocxToLocal({ fileId, sessionId: session._id, docxBuffer: patchedBuffer });
                fileUrl = stored.fileUrl;
                surgicalSuccess = true;
                console.info(`[SYNC-TRACE] Multi-Probe SUCCESS on route: ${url}`, { traceId, fileUrl });
                break;
              } else {
                lastStatus = patchRes.status;
                lastErrorText = await patchRes.text().catch(() => 'no-body');
                console.warn(`[SYNC-TRACE] Multi-Probe FAILED (status ${lastStatus}) on route: ${url}`);
              }
            } catch (err) {
              console.warn(`[SYNC-TRACE] Multi-Probe EXCEPTION on route: ${url}`, { message: err.message });
            }
          }

          if (!surgicalSuccess) {
            console.error('[SYNC-TRACE] Multi-Probe final failure.', { traceId, lastStatus, lastErrorText: lastErrorText.substring(0, 100) });
          }
        }
      } catch (patchErr) {
        console.warn('[SYNC][BACKEND] surgical-patch-exception', { traceId, message: patchErr.message });
      }
    }

    if (!surgicalSuccess) {
      if (debugMeta && (debugMeta.forceSuggestionSync || debugMeta.isAIApply)) {
        console.warn('[SYNC][BACKEND] surgical-patch-failed! using local high-fidelity fallback to ensure AI text is synchronized.', { traceId });
      }
      try {
        const htmlForDocx = htmlContent || `<p>${incomingText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
        const { filename } = await writeDocxFromHtml(htmlForDocx, title, 'uploads/converted', designConfig);
        fileUrl = `/uploads/converted/${filename}`;
      } catch (htmlErr) {
        const { filePath } = await writeDocxFromText(incomingText || prevText || '', title, 'uploads/converted', designConfig, true);
        fileUrl = `/uploads/converted/${path.basename(filePath)}`;
        console.warn('[SYNC][BACKEND] html->docx failed, used text fallback', {
          traceId,
          fileId: String(fileId),
          message: htmlErr?.message || String(htmlErr),
        });
      }
    }

    session.htmlContent = htmlContent || session.htmlContent || '';
    session.currentText = incomingText;
    session.docxFileUrl = fileUrl;
    session.docxHtml = htmlContent || session.docxHtml || '';
    session.docxStatus = 'ready';
    session.docxError = '';
    session.docxUpdatedAt = new Date();
    await session.save();

    console.info('[SYNC][BACKEND] success', {
      traceId,
      fileId: String(fileId),
      docxFileUrl: session.docxFileUrl,
      docxUpdatedAt: session.docxUpdatedAt,
    });

    return res.json({
      success: true,
      traceId,
      docxFileUrl: session.docxFileUrl,
      docxStatus: session.docxStatus,
      docxUpdatedAt: session.docxUpdatedAt,
    });
  } catch (err) {
    console.warn('[SYNC][BACKEND] failed', {
      traceId: req.body?.debugMeta?.traceId || null,
      fileId: req.params?.fileId || null,
      message: err?.message || String(err),
      statusCode: err?.statusCode || 500,
    });
    return res.status(err?.statusCode || 500).json({ success: false, error: err?.message || 'Failed to sync OnlyOffice DOCX' });
  }
};
export const onlyOfficeCallbackEndpoint = async (req, res) => {
  try {
    const { fileId } = req.params;
    const body = req.body || {};
    const status = Number(body.status || 0);
    const fileUrl = String(body.url || '').trim();

    const onlyOfficeSecret = String(process.env.ONLYOFFICE_JWT_SECRET || '').trim();
    const callbackWriteRaw = String(process.env.ONLYOFFICE_CALLBACK_WRITE_ENABLED || 'true').toLowerCase();
    const allowCallbackWriteDisable = String(process.env.ALLOW_ONLYOFFICE_WRITE_DISABLE || 'false').toLowerCase() === 'true';
    const callbackWriteEnabled = !(allowCallbackWriteDisable && ['false', '0', 'off'].includes(callbackWriteRaw));

    if (onlyOfficeSecret && body?.token) {
      try { jwt.verify(String(body.token), onlyOfficeSecret); } catch (_) {}
    }

    console.log('[OnlyOffice Callback] received', {
      fileId: String(fileId),
      status,
      hasUrl: !!fileUrl,
      callbackWriteEnabled,
      users: Array.isArray(body?.users) ? body.users.length : 0,
      actions: Array.isArray(body?.actions) ? body.actions.length : 0,
      forcesavetype: body?.forcesavetype || null,
    });

    if (![2, 6].includes(status) || !fileUrl) {
      return res.json({ error: 0 });
    }
    if (!callbackWriteEnabled) {
      console.log('[OnlyOffice Callback] write disabled by explicit ALLOW_ONLYOFFICE_WRITE_DISABLE flag, skipping persist');
      return res.json({ error: 0 });
    }

    const file = await File.findById(fileId);
    if (!file) return res.json({ error: 0 });
    const session = await EditSession.findOne({ fileId, status: 'active' }).sort({ updatedAt: -1 });
    if (!session) return res.json({ error: 0 });

    const response = await fetch(fileUrl);
    if (!response.ok) throw new Error(`OnlyOffice callback download failed: ${response.status}`);
    const arr = await response.arrayBuffer();
    const buffer = Buffer.from(arr);
    const html = await docxToHtml(buffer);
    console.log('[OnlyOffice Callback] payload stats', {
      fileId: String(fileId),
      bytes: buffer.length,
      htmlChars: String(html || '').trim().length,
    });

    // Guard against blank/placeholder callback payloads overwriting a valid DOCX.
    const nextHtmlLength = String(html || '').trim().length;
    const prevHtmlLength = String(session.docxHtml || '').trim().length;
    const looksSuspiciouslyEmpty = nextHtmlLength < 100 && prevHtmlLength > 500;
    let prevBytes = 0;
    try {
      const prevPath = path.join(__dirname, '..', String(session.docxFileUrl || ''));
      if (session.docxFileUrl && fs.existsSync(prevPath)) {
        prevBytes = fs.statSync(prevPath).size || 0;
      }
    } catch (_) {}
    const severeByteDrop = prevBytes > 0 && buffer.length < Math.max(6000, Math.floor(prevBytes * 0.55));
    const severeHtmlDrop = prevHtmlLength > 0 && nextHtmlLength < Math.max(120, Math.floor(prevHtmlLength * 0.35));
    const looksCorruptRegression = severeByteDrop && severeHtmlDrop;
    if (looksSuspiciouslyEmpty || looksCorruptRegression) {
      console.warn('[OnlyOffice Callback] ignored sparse save payload', {
        fileId: String(fileId),
        status,
        bytes: buffer.length,
        prevBytes,
        nextHtmlLength,
        prevHtmlLength,
        severeByteDrop,
        severeHtmlDrop,
      });
      return res.json({ error: 0 });
    }

    const stored = writeDocxToLocal({ fileId, sessionId: session._id, docxBuffer: buffer });

    session.docxFileUrl = stored.fileUrl;
    session.docxHtml = html || '';
    session.docxStatus = isDocxReadyPayload({ docxStatus: 'ready', docxHtml: session.docxHtml, docxFileUrl: session.docxFileUrl }) ? 'ready' : 'failed';
    session.docxError = session.docxStatus === 'ready' ? '' : 'OnlyOffice save generated incomplete DOCX payload';
    session.docxUpdatedAt = new Date();
    await session.save();

    return res.json({ error: 0 });
  } catch (err) {
    console.warn('[OnlyOffice Callback] failed:', err?.message || err);
    return res.json({ error: 0 });
  }
};

// ── PDF Font Extraction API ───────────────────────────────────────────────────
/**
 * GET /api/files/edit/fonts/:fileId
 * Returns a list of extracted embedded fonts for this PDF (cached per session).
 */
export const getPdfFontList = async (req, res) => {
  try {
    const { fileId } = req.params;
    const sessionQuery = { userId: req.user.id, status: 'active' };
    if (fileId) sessionQuery.fileId = fileId;
    const session = await EditSession.findOne(sessionQuery).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);

    if (session.fontCache?.fonts?.length) {
      return res.json({ fonts: session.fontCache.fonts, cached: true });
    }

    const file = await File.findById(session.fileId || fileId);
    if (!file) throw new AppError('File not found', 404);

    let pdfBytes;
    const CLOUDINARY_DISABLED_LOCAL = process.env.CLOUDINARY_DISABLE === 'true';
    const isLocalFile = !file.fileUrl?.startsWith('http');
    if (CLOUDINARY_DISABLED_LOCAL || isLocalFile) {
      const localPath = path.join(__dirname, '..', file.fileUrl);
      if (!fs.existsSync(localPath)) throw new AppError('PDF file not found on disk', 404);
      pdfBytes = fs.readFileSync(localPath);
    } else {
      pdfBytes = await getCloudinaryBuffer(file);
    }

    const index = await extractPdfFonts(pdfBytes, session._id);
    session.fontCache = index;
    await session.save();

    return res.json({ fonts: index.fonts || [], cached: false });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Font extraction failed' });
  }
};

/**
 * GET /api/files/edit/fonts/:fileId/:fontId
 * Streams the extracted font file for a given fontId.
 */
export const downloadPdfFont = async (req, res) => {
  try {
    const { fileId, fontId } = req.params;
    const sessionQuery = { userId: req.user.id, status: 'active' };
    if (fileId) sessionQuery.fileId = fileId;
    const session = await EditSession.findOne(sessionQuery).sort({ updatedAt: -1 });
    if (!session) throw new AppError('No active session', 400);

    const index = session.fontCache || await loadFontIndex(session._id);
    if (!index?.fonts?.length) {
      return res.status(404).json({ error: 'Font cache not found' });
    }

    const fontEntry = index.fonts.find((f) => f.id === fontId);
    if (!fontEntry) return res.status(404).json({ error: 'Font not found' });

    const data = await loadFontBytesById(session._id, fontId);
    if (!data?.bytes) return res.status(404).json({ error: 'Font data missing' });

    const mime = fontEntry.format === 'otf' ? 'font/otf' : 'font/ttf';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `inline; filename="${fontEntry.fileName}"`);
    return res.send(data.bytes);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Font download failed' });
  }
};
