import axios from 'axios';
import mongoose from 'mongoose';
import Chat from '../models/Chat.js';
import User from '../models/User.js';
import MessageCount from '../models/MessageCount.js';
import ResearchSession from '../models/ResearchSession.js';
import CounterMakerSession from '../models/CounterMakerSession.js';
import ChronologySession from '../models/ChronologySession.js';
import PrecedenceSession from '../models/PrecedenceSession.js';
import { getMessageLimitForTier, getRemainingMessages } from '../models/SubscriptionPrice.js';
import DocumentSession from '../models/DocumentSession.js';
import InlineActionResponse from '../models/InlineActionResponse.js';
import redis from '../utils/redisClient.js';
import { AppError } from '../utils/errors.js';
import { LEGAL_ASSISTANT_SYSTEM_PROMPT, DRAFT_ENHANCEMENT_PROMPT } from '../utils/prompts.js';
import path from 'path';
import { findBestTemplate, getDisplayTitleForRelPath, getAllTemplates, loadTemplates } from '../utils/templateIndex.js';
import { renderTemplateText } from '../utils/templateRender.js';
import { writeDocxFromText } from '../utils/docxWriter.js';
import { enhancePromptWithLegalContext } from '../utils/legalRAG.js';
import { documentIngestion } from '../services/documentIngestion.js';
import { intentClassifier } from '../services/intentClassifier.js';
import { documentExtractor } from '../services/documentExtractor.js';
import { generateErrorResponse, logError, getErrorDetails } from '../utils/errorCodes.js';
import conversationService from '../services/conversationService.js';
import { 
  getOrCreateDocumentSession, 
  accumulateExtractedFields, 
  getSessionAccumulatedData, 
  completeDocumentSession,
  recordSessionTurn,
  getSessionInfo,
  abandonDocumentSession
} from '../services/documentSessionService.js';
import { getDocumentSchema, hasSubtypes, getSubtypes, getSubtypeSchema } from '../utils/documentSchemas.js';

const LLM_HTTP_TIMEOUT_MS = Number(process.env.LLM_HTTP_TIMEOUT_MS || 180000);





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

function wrapPromptWithLanguage(prompt, req) {
  const lang = req?.preferredLanguage || 'en';
  const langInstruction = getLanguageInstruction(lang);
  return prompt + langInstruction;
}



async function callLocalLLM(prompt) {
  try {
    const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
    if (provider === 'groq') {
      return await callGroqAPI(prompt);
    }
    if (provider === 'openrouter') {
      return await callOpenRouterAPI(prompt);
    }

    const response = await axios.post(
      'http://localhost:11434/api/generate',
      {
        model: 'llama3.1:8b',
        prompt,
        stream: false
      },
      { timeout: LLM_HTTP_TIMEOUT_MS }
    );
    return response.data.response;
  } catch (error) {
    if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
      return await callGeminiAPI(prompt);
    }
    throw error;
  }
}

async function callGroqAPI(prompt) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY is missing');
  }

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    },
    {
      timeout: LLM_HTTP_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
}

async function callOpenRouterAPI(prompt) {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is missing');
  }

  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct';
  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    },
    {
      timeout: LLM_HTTP_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'http://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'dastavezai-local-dev',
      },
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
}

async function callGeminiAPI(prompt) {
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const geminiUrl = `https://generativelanguage.googleapis.com/v1/models/${geminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  
  const response = await axios.post(geminiUrl, {
    contents: [{
      parts: [{ text: prompt }]
    }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1000
    }
  }, { timeout: LLM_HTTP_TIMEOUT_MS });

  return response.data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}


function isPlaceholderValue(val) {
  if (val === null || val === undefined) return true;
  if (typeof val !== 'string') return false;
  const s = val.trim();
  if (!s) return true;
  const lower = s.toLowerCase();
  
  if (lower === 'n/a' || lower === 'tbd' || lower === 'to be filled' || lower === 'to be updated' || lower === 'not specified' || lower === 'as mentioned' || lower === 'please specify' || lower === '?' || lower === 'none' || lower === 'null') return true;
  if (s.length <= 1) return true;
  if (/^\.{2,}$/.test(s)) return true;
  if (/_{2,}/.test(s)) return true;
  if (s.includes('...')) return true;
  if (/^[-\s]+$/.test(s)) return true;
  if (/\[\s*(insert|fill|provide|specify)/i.test(s)) return true;
  if (/\{\{[^}]+\}\}/.test(s)) return true;
  if (/address as mentioned/i.test(s)) return true;
  
  if (/^(the complainant|the respondent|unknown|authorized|authorized signatory|city|india|relevant|applicable)$/i.test(s)) return true;
  if (/^(relevant applicable|appropriate|as per|as mentioned|street name|address|name)$/i.test(s)) return true;
  if (/relevant.*sections/i.test(s)) return true;
  
  if (/\b(owner of|residential flat|tenant|landlord|the one part|the other part|hereinafter|hereby)\b/i.test(s) && s.split(/\s+/).length < 6) return true;
  
  
  
  if (/\b(s\/o|d\/o|w\/o|r\/o|c\/o|p\.s\.|p\.s)\s*[:.]?\s*(\(not provided\)|\(not specified\)|\(missing\)|_+|\.{2,}|$)/i.test(s)) return true;
  
  if (/\(not provided\)|\(not specified\)|\(missing\)|\(blank\)|\(empty\)|\(to be filled\)/i.test(s)) return true;
  
  if (/…{2,}|\.{4,}|_{3,}/.test(s)) return true;
  
  if (/\d+\s*[…\.]{3,}/.test(s)) return true;
  if (/no\.?\s*[…\.]{3,}/i.test(s)) return true;
  
  if (/\(\s*\)|\[\s*\]/.test(s)) return true;
  
  return false;
}


function validateFieldValue(fieldName, value) {
  const displayField = fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  
  if (!value || typeof value !== 'string') {
    return { valid: false, reason: `The field "${displayField}" cannot be empty.` };
  }

  const v = value.trim();
  if (isPlaceholderValue(v)) {
    return { valid: false, reason: `The value for "${displayField}" seems invalid. Please provide a clear, meaningful response.` };
  }
  
  const lowerField = fieldName.toLowerCase();
  
  if (lowerField.includes('name')) {
    if (v.length < 2 || /^[^a-zA-Z]/.test(v)) {
      return { valid: false, reason: `"${displayField}" should be a valid name (e.g., 'John Doe' or 'Smt. Sunita Sharma').` };
    }
  }
  
  if (lowerField.includes('date')) {
    const dateRegex = /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$|^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/;
    if (!dateRegex.test(v) && isNaN(Date.parse(v))) {
      return { valid: false, reason: `"${displayField}" should be a valid date (e.g., '15-01-2026' or 'January 15, 2026').` };
    }
  }

  if (lowerField.includes('age')) {
    if (isNaN(parseInt(v)) || parseInt(v) <= 0 || parseInt(v) > 130) {
      return { valid: false, reason: `"${displayField}" should be a valid age in numbers (e.g., '35').` };
    }
  }

  if (lowerField.includes('email')) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) {
      return { valid: false, reason: `"${displayField}" should be a valid email address (e.g., 'example@email.com').` };
    }
  }

  if (lowerField.includes('phone') || lowerField.includes('mobile')) {
    if (!/^\+?[\d\s-]{8,15}$/.test(v)) {
      return { valid: false, reason: `"${displayField}" should be a valid phone number (e.g., '+91 9876543210').` };
    }
  }

  return { valid: true };
}

function detectMissingFromExtracted(extracted = {}) {
  const missing = [];
  if (!extracted) return missing;
  
  if (Array.isArray(extracted.missingFields) && extracted.missingFields.length) {
    extracted.missingFields.forEach(f => {
      if (!missing.find(m => m.key === f.key)) missing.push(f);
    });
  }
  
  const data = extracted.data || {};
  for (const [key, value] of Object.entries(data)) {
    if (isPlaceholderValue(value)) {
      if (!missing.find(m => m.key === key)) missing.push({ key, label: key });
    }
  }
  return missing;
}


function tryParseStructuredInput(message) {
  if (!message || typeof message !== 'string') return null;
  
  try {
    const parsed = JSON.parse(message);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (e) {}

  const out = {};
  let found = false;
  
  
  const cleanValue = (val) => {
    if (!val) return val;
    
    return val.replace(/^\d+[\.\)\:]\s*/, '').trim();
  };
  
  
  
  
  const parts = message.split(/,(?![^"]*"(?:[^"]*"[^"]*")*[^"]*$)/).map(p => p.trim()).filter(Boolean);
  
  for (const part of parts) {
    
    
    const match = part.match(/^(\d+[\.\)]?\s*)?([A-Za-z][A-Za-z0-9 ']*?)\s*[-:=]\s*["']?(.+?)["']?$/);
    if (match) {
      const rawKey = match[2].trim();
      let rawVal = cleanValue(match[3].trim());
      
      rawVal = rawVal.replace(/^['"]|['"]$/g, '').trim();
      const key = rawKey.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '').replace(/[^a-z0-9_]/g, '');
      if (key && rawVal && rawVal.length > 0) {
        out[key] = rawVal;
        found = true;
      }
    }
  }
  
  
  if (!found) {
    const lines = message.split(/\r?\n/).map(p => p.trim()).filter(Boolean);
    for (const line of lines) {
      const match = line.match(/^(\d+[\.\)]?\s*)?([A-Za-z][A-Za-z0-9 ']*?)\s*[-:=]\s*["']?(.+?)["']?$/);
      if (match) {
        const rawKey = match[2].trim();
        let rawVal = cleanValue(match[3].trim());
        rawVal = rawVal.replace(/^['"]|['"]$/g, '').trim();
        const key = rawKey.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '').replace(/[^a-z0-9_]/g, '');
        if (key && rawVal && rawVal.length > 0) {
          out[key] = rawVal;
          found = true;
        }
      }
    }
  }
  
  
  if (!found) {
    
    const simpleKvRegex = /\b([a-zA-Z][a-zA-Z ]{1,20})\s*[-:=]\s*["']?([^,\n]+?)["']?(?=,|\n|$)/g;
    let match = null;
    while ((match = simpleKvRegex.exec(message)) !== null) {
      const rawKey = match[1].trim();
      let rawVal = cleanValue(match[2].trim());
      rawVal = rawVal.replace(/^['"]|['"]$/g, '').trim();
      const key = rawKey.toLowerCase().replace(/\s+/g, '_').replace(/[()]/g, '').replace(/[^a-z0-9_]/g, '');
      if (key && rawVal && rawVal.length > 0) {
        out[key] = rawVal;
        found = true;
      }
    }
  }

  return found ? out : null;
}


function parseMissingFieldsFromAssistantMessage(text) {
  if (!text || typeof text !== 'string') return [];
  
  const m = text.match(/I need a few more details:\s*([^\.\n]+)/i);
  const listText = m ? m[1] : null;
  if (!listText) return [];
  return listText.split(/,|and/).map(s => s.trim()).filter(Boolean).map(s => s.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''));
}


function isLikelyAnswerToMissingFields(userMessage, lastAssistantMessage) {
  if (!lastAssistantMessage || !userMessage) return false;
  const askPhrases = [
    'i need a few more details',
    'could you please provide',
    'please provide',
    'please provide this information',
    'could you provide this information',
    'i need a few more details to complete'
  ];
  const lowerAssistant = String(lastAssistantMessage).toLowerCase();
  const matchesAsk = askPhrases.some(p => lowerAssistant.includes(p));
  if (!matchesAsk) return false;

  
  const structured = tryParseStructuredInput(userMessage);
  if (structured) return true;

  
  const low = userMessage.trim().toLowerCase();
  const greetings = new Set(['hello','hi','hey','thanks','thank you','ok','okay','sure','yes','no','bye']);
  if (greetings.has(low)) return false;

  
  const wordCount = userMessage.trim().split(/\s+/).length;
  return wordCount <= 8;
}


function isLikelyPersonName(val) {
  if (!val || typeof val !== 'string') return false;
  const s = val.trim();
  if (s.length < 3 || s.length > 60) return false;
  
  if (/\b(rent|due|late|overdue|pending|notice|deadline|date|lease|expiry)\b/i.test(s)) return false;
  
  if (/\b(Mr|Mrs|Ms|Shri|Smt|Dr|Adv)\.?\b/i.test(s)) return true;
  const words = s.split(/\s+/);
  const capWords = words.filter(w => /^[A-Z][a-z]+$/.test(w));
  return capWords.length >= Math.min(1, Math.floor(words.length / 2));
}


async function handleMissingFieldsReply(message, req, res, user, slug = 'default') {
  const trimmedLower = message.trim().toLowerCase();
  const isGreeting = /^(hi|hy|hello|hey|greetings|namaste|helo|hii+)\b/i.test(trimmedLower);
  const isExitCommand = /\b(cancel|exit|stop|quit|nevermind|reset|start new|new chat|start over)\b/i.test(trimmedLower);

  if (isExitCommand || (isGreeting && trimmedLower.length <= 10)) {
    console.log(`🚫 Interrupted missing fields collection with exit/greeting: "${message}"`);
    await abandonDocumentSession(req.user.id);
    const keysToDelete = [
      `pending_missing:${req.user.id}:${slug}`,
      `pending_confirmation:${req.user.id}:${slug}`,
      `pending_template_confirm:${req.user.id}:${slug}`,
      `pending_ai_document:${req.user.id}:${slug}`,
      `pending_freeform:${req.user.id}:${slug}`
    ];
    for (const key of keysToDelete) {
      try { await redis.del(key); } catch (e) {}
    }

    if (isExitCommand) {
      const exitText = (req?.preferredLanguage === 'hi')
        ? 'दस्तावेज़ निर्माण रद्द कर दिया गया है। मैं आपकी कैसे मदद कर सकता हूँ?'
        : 'Drafting process cancelled. How can I assist you today?';
      return await replyWithText(res, exitText, user, req);
    }
    return await handleConversationalChat(message, req, res, user);
  }

  const chatDoc = await getUserChatHistory(req.user.id, slug);
  const lastAssistantMsg = [...chatDoc.messages].reverse().find(m => m.role === 'assistant');
  const lastAssistantText = lastAssistantMsg?.content || '';

  
  let pending = null;
  try {
    const raw = await redis.get(`pending_missing:${req.user.id}:${slug}`);
    if (raw) pending = JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to read pending missing fields:', e?.message || e);
  }

  let missingKeys = [];
  if (pending && Array.isArray(pending.missingFields) && pending.missingFields.length) {
    missingKeys = pending.missingFields.map(f => f.key);
  } else {
    missingKeys = parseMissingFieldsFromAssistantMessage(lastAssistantText);
  }

  
  function findBestMatchingKey(userKey, candidates) {
    const uk = userKey.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (candidates.includes(uk)) return uk;
    
    const synonyms = {
      complainant: 'complainant_name',
      complaint: 'complainant_name',
      complainant_name: 'complainant_name',
      respondent: 'respondent_name',
      tenant: 'respondent_name',
      signatory: 'signatory_name',
      signatory_name: 'signatory_name',
      plan: 'plan_label',
      plan_label: 'plan_label',
      place: 'place',
      date: 'date',
      flat: 'plan_label',
      flat_number: 'flat_number'
    };
    if (synonyms[uk]) return synonyms[uk];
    
    const ukTokens = new Set(uk.split('_'));
    let best = null; let bestScore = 0;
    for (const c of candidates) {
      const ctoks = new Set(c.split('_'));
      let score = 0;
      for (const t of ukTokens) if (ctoks.has(t)) score++;
      if (score > bestScore) { best = c; bestScore = score; }
    }
    
    if (bestScore > 0) return best;
    
    for (const c of candidates) {
      if (c.includes(uk) || uk.includes(c)) return c;
    }
    return null;
  }

  
  const structured = tryParseStructuredInput(message);
  const answers = {};
  const validationErrors = [];
  
  if (structured) {
    
    for (const [k, v] of Object.entries(structured)) {
      const nkRaw = k.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      
      let mapped = findBestMatchingKey(nkRaw, missingKeys) || nkRaw;
      if (nkRaw === 'complaint' || nkRaw === 'complaint_name') {
        if (/\b(rent|due|late|overdue|pending)\b/i.test(String(v))) {
          mapped = 'rent_due';
        } else if (/\b(name|mr|mrs|smt|shri|dr|adv)\b/i.test(String(v))) {
          mapped = 'complainant_name';
        }
      }

      
      if (mapped === 'complainant_name' && !isLikelyPersonName(v)) {
        
        if (/\b(rent|due|late|overdue|pending)\b/i.test(String(v)) || String(v).length > 40) {
          answers['rent_due'] = v;
          continue;
        }
        return await replyWithText(res, "Thanks — it looks like you provided a description rather than the landlord's name. Please provide the landlord's name in 'Complainant (Landlord): <Full Name>' format (e.g., 'Complainant (Landlord): Smt. Sunita Sharma').", user, req);
      }

      answers[mapped] = v;
    }
  } else {
    const trimmed = message.trim();
    const kv = message.match(/^([\w \-()]+)\s*[:\-\s]\s*(.+)$/);
    if (kv) {
      const k = kv[1].toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      const bestMatch = findBestMatchingKey(k, missingKeys);
      if (bestMatch) {
        answers[bestMatch] = kv[2].trim();
      } else if (missingKeys.length > 0) {
        answers[missingKeys[0]] = trimmed;
      }
    } else {
      if (missingKeys.length > 0) {
        answers[missingKeys[0]] = trimmed;
      }
    }
  }

  // Global validation on all collected answers
  for (const [k, v] of Object.entries(answers)) {
    const validation = validateFieldValue(k, v);
    if (!validation.valid) {
      validationErrors.push(validation.reason);
      delete answers[k];
    }
  }

  if (validationErrors.length > 0 && Object.keys(answers).length === 0) {
    return await replyWithText(res, `I couldn't accept your input:\n\n${validationErrors.join('\n\n')}\n\nPlease try again with valid values.`, user, req);
  }

  
  
  const activeSession = await DocumentSession.findOne({ userId: req.user.id, slug, status: 'active' });
  let genTemplate = null;
  
  if (activeSession && activeSession.template) {
    
    const templates = await loadTemplates();
    genTemplate = templates.find(t => t.relPath === activeSession.template.relPath);
    if (genTemplate) {
      console.log(`📋 Using template from active session: ${genTemplate.displayTitle}`);
    }
  }
  
  
  if (!genTemplate) {
    try {
      const pendingStr = await redis.get(`pending_missing:${req.user.id}:${slug}`);
      if (pendingStr) {
        const pending = JSON.parse(pendingStr);
        if (pending.template) {
          const templates = await loadTemplates();
          
          const templatePath = typeof pending.template === 'string' ? pending.template : pending.template.relPath;
          genTemplate = templates.find(t => t.relPath === templatePath);
          if (genTemplate) {
            console.log(`📋 Using template from pending_missing state: ${genTemplate.displayTitle}`);
          }
        }
      }
    } catch (e) {
      console.warn('Failed to read template from pending_missing:', e?.message);
    }
  }
  
  
  if (!genTemplate) {
    const recentMessages = chatDoc.messages.slice(-12);
    const contextMessages = recentMessages.map(m => m.content).join('\\n');
    
    
    let originalUserMsg = null;
    for (let i = chatDoc.messages.length - 1; i >= 0; i--) {
      const m = chatDoc.messages[i];
      if (m === lastAssistantMsg) break;
      if (m.role === 'user') { originalUserMsg = m.content; break; }
    }

    const baseContext = (originalUserMsg || contextMessages) + '\\n' + message;
    genTemplate = await findBestTemplate(baseContext);
    console.log(`📋 Fallback: Using context-based template match: ${genTemplate?.displayTitle || 'none'}`);
  }

  if (!genTemplate) {
    const lang = req?.preferredLanguage || 'en';
    const noTemplateMsg = lang === 'hi'
      ? "मैं आपके जवाब से यह तय नहीं कर सका कि कौन सा टेम्पलेट उपयोग करना है। कृपया दस्तावेज़ प्रकार फिर से बताएं (जैसे, 'फ्लैट के लिए बिक्री विलेख')?"
      : "I couldn't determine which template to use from your response. Could you restate the document type (e.g., 'Sale Deed for Flat')?";
    return await replyWithText(res, noTemplateMsg, user, req);
  }

  
  
  if (!activeSession || activeSession.template.relPath !== genTemplate.relPath) {
    console.log(`📋 Creating/updating session for template: ${genTemplate.displayTitle} [slug: ${slug}]`);
    await getOrCreateDocumentSession(req.user.id, genTemplate, slug);
  }

  
  let extracted = await documentExtractor.extractFields(message, genTemplate.relPath, genTemplate.schema);

  
  extracted.data = extracted.data || {};
  for (const [k, v] of Object.entries(answers)) {
    extracted.data[k] = v;
  }

  
  
  const { session: updatedSession, newlyFilledFields, stillMissing, isComplete } = 
    await accumulateExtractedFields(req.user.id, extracted.data || {}, slug);

  console.log(`📊 Session update after field reply:`, {
    userId: req.user.id,
    turn: updatedSession.turnCount,
    newlyFilled: newlyFilledFields,
    stillMissing: stillMissing.length,
    isComplete
  });

  
  if (stillMissing.length > 0) {
    const missingFieldObjs = updatedSession.missingFields || stillMissing.map(k => ({ key: k, label: k }));
    return await handleMissingFields(res, missingFieldObjs, genTemplate, user, req, message, newlyFilledFields);
  }

  
  try {
    const accumulatedData = await getSessionAccumulatedData(req.user.id);
    console.log(`✅ All fields collected. Generating document with accumulated data:`, Object.keys(accumulatedData));
    
    const generatedDoc = await generateDocumentInline(accumulatedData, genTemplate);
    
    
    try { 
      await redis.del(`pending_missing:${req.user.id}:${slug}`);
      await completeDocumentSession(req.user.id);
    } catch(e) {  }
    
    return await replyWithDocument(res, generatedDoc, user, req, message);
  } catch (err) {
    console.error('Error generating document from missing-fields reply:', err);
    if (err?.message === 'document_contains_placeholders') {
      const accumulatedData = await getSessionAccumulatedData(req.user.id);
      const pf = detectMissingFromExtracted({ data: accumulatedData });
      const lang = req?.preferredLanguage || 'en';
      const placeholderMsg = lang === 'hi'
        ? `मैंने देखा कि जेनरेट किए गए दस्तावेज़ में अभी भी प्लेसहोल्डर हैं। कृपया लापता विवरण प्रदान करें?`
        : `I noticed the generated document still contains placeholders. Could you please provide the missing details?`;
      return await replyWithText(res, placeholderMsg, user, req, { 
        mode: 'waiting_for_details', 
        missingFields: pf,
        templatePath: genTemplate.relPath,
        templateTitle: genTemplate.displayTitle || genTemplate.relPath
      });
    }
    throw err;
  }
}

async function offerFreeFormGeneration(message, context, res, user, req, sourceAction = null, documentType = null) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  const lang = req?.preferredLanguage || 'en';

  
  if (isVagueDocumentRequest(message)) {
    const clarifyMessage = lang === 'hi'
      ? `ज़रूर! मैं आपकी कैसे मदद कर सकता हूं? नीचे से एक विकल्प चुनें:`
      : `Sure! How can I help you? Choose an option below:`;

    
    const suggestedActions = lang === 'hi'
      ? [
          { 
            type: 'doc_choice', 
            label: '📝 दस्तावेज़ बनाएं', 
            icon: '📝', 
            action: 'CREATE_DOCUMENT', 
            description: 'गाइडेड प्रक्रिया से दस्तावेज़ का प्रकार चुनें और बनाना शुरू करें' 
          },
          { 
            type: 'doc_choice', 
            label: '🧭 मुझे गाइड करें', 
            icon: '🧭', 
            action: 'GUIDE_ME', 
            description: 'अपनी स्थिति बताएं और मैं आपको सही दस्तावेज़ खोजने में मदद करूंगा' 
          },
          { 
            type: 'doc_choice', 
            label: '📚 टेम्पलेट ब्राउज़ करें', 
            icon: '📚', 
            action: 'BROWSE_TEMPLATES', 
            description: 'सभी उपलब्ध दस्तावेज़ टेम्पलेट देखें और सर्च करें' 
          }
        ]
      : [
          { 
            type: 'doc_choice', 
            label: '📝 Create Document', 
            icon: '📝', 
            action: 'CREATE_DOCUMENT', 
            description: 'Follow a guided process to select and create your document' 
          },
          { 
            type: 'doc_choice', 
            label: '🧭 Guide Me', 
            icon: '🧭', 
            action: 'GUIDE_ME', 
            description: 'Tell me your situation and I\'ll help you find the right document' 
          },
          { 
            type: 'doc_choice', 
            label: '📚 Browse Templates', 
            icon: '📚', 
            action: 'BROWSE_TEMPLATES', 
            description: 'View and search all available document templates' 
          }
        ];

    return await replyWithText(res, clarifyMessage, user, req, {
      mode: 'clarify_document_type',
      suggestedActions
    });
  }
  
  
  
  
  
  if (sourceAction === 'CREATE_DOCUMENT') {
    const docType = req.body.documentType || null;
    return await generateFreeFormDocument(message, context, res, user, req, docType);
  }
  
  const offerMessage = lang === 'hi'
    ? `मेरे पास इस प्रकार के दस्तावेज़ के लिए कोई पूर्व-निर्मित टेम्पलेट नहीं है। हालांकि, मैं AI का उपयोग करके आपकी ज़रूरतों के अनुसार कस्टम कानूनी दस्तावेज़ बना सकता हूं।

क्या आप चाहते हैं कि मैं आगे बढ़ूं?`
    : `I don't have a pre-built template for this specific document type. However, I can generate a custom legal document tailored to your needs using AI.

Would you like me to proceed?`;

  
  const suggestedActions = lang === 'hi'
    ? [
        { type: 'freeform_choice', label: '✅ हाँ, कस्टम बनाएं', icon: '✅', action: 'FREEFORM_YES', description: 'AI से कस्टम दस्तावेज़ बनाएं' },
        { type: 'freeform_choice', label: '📚 टेम्पलेट देखें', icon: '📚', action: 'BROWSE_TEMPLATES', description: 'उपलब्ध टेम्पलेट ब्राउज़ करें' }
      ]
    : [
        { type: 'freeform_choice', label: '✅ Yes, Create Custom', icon: '✅', action: 'FREEFORM_YES', description: 'Generate custom document with AI' },
        { type: 'freeform_choice', label: '📚 Browse Templates', icon: '📚', action: 'BROWSE_TEMPLATES', description: 'Browse available templates' }
      ];
  
  
  try {
    await redis.set(`pending_freeform:${req.user.id}:${slug}`, JSON.stringify({
      context: message,
      fullContext: context
    }), 'EX', 300);
  } catch (e) {
    console.warn('Failed to store pending freeform choice:', e?.message);
  }
  
  return await replyWithText(res, offerMessage, user, req, {
    mode: 'freeform_choice',
    noTemplateMatch: true,
    suggestedActions
  });
}

function isVagueDocumentRequest(message) {
  if (!message || typeof message !== 'string') return false;
  const text = message.toLowerCase().trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;

  const genericTerms = [
    'draft', 'document', 'legal document', 'agreement', 'notice', 'application',
    'dastavez', 'dastavej', 'masoda', 'praroop'
  ];

  const specificTerms = [
    'rent', 'lease', 'tenancy', 'affidavit', 'bail', 'fir', 'complaint',
    'power of attorney', 'poa', 'will', 'gift deed', 'sale deed', 'divorce',
    'adoption', 'partnership', 'consumer', 'cheque', 'section 138', 'petition',
    'writ', 'mou', 'nda', 'employment', 'service', 'loan', 'mortgage',
    'succession', 'legal notice', 'agreement to sell', 'rent agreement'
  ];

  const hasGeneric = genericTerms.some(term => text.includes(term));
  const hasSpecific = specificTerms.some(term => text.includes(term));

  return hasGeneric && !hasSpecific && wordCount <= 6;
}

async function offerSubtypeSelection(documentType, subtypes, userRequest, res, user, req, lang) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  console.log(`📋 Offering ${subtypes.length} subtypes for ${documentType}`);
  
  const message = lang === 'hi'
    ? `${documentType} के विभिन्न प्रकार हैं। कृपया अपनी ज़रूरतों के लिए सबसे उपयुक्त प्रकार चुनें:`
    : `There are different types of ${documentType}. Please select the one that best fits your needs:`;
  
  
  const suggestedActions = subtypes.map(subtype => ({
    type: 'subtype_selection',
    label: subtype,
    icon: '📄',
    action: 'SELECT_SUBTYPE',
    data: { documentType, subtype }
  }));
  
  
  try {
    await redis.set(`pending_subtype:${req.user.id}:${slug}`, JSON.stringify({
      documentType,
      subtypes,
      originalRequest: userRequest
    }), 'EX', 300);
  } catch (e) {
    console.warn('Failed to store pending subtype selection:', e?.message);
  }
  
  return await replyWithText(res, message, user, req, {
    mode: 'subtype_selection',
    suggestedActions
  });
}

async function initiateFieldCollection(analysis, userRequest, res, user, req) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  const lang = req?.preferredLanguage || 'en';
  
  
  const pendingAIDoc = {
    documentType: analysis.documentType,
    documentTitle: analysis.documentTitle,
    description: analysis.description,
    requiredFields: analysis.requiredFields,
    extractedData: analysis.extractedFromRequest || {},
    originalRequest: userRequest
  };
  
  try {
    await redis.set(`pending_ai_document:${req.user.id}:${slug}`, JSON.stringify(pendingAIDoc), 'EX', 900);
  } catch (e) {
    console.warn('Failed to store pending AI document:', e?.message);
  }
  
  
  const filledFields = Object.keys(analysis.extractedFromRequest || {}).filter(k => analysis.extractedFromRequest[k]);
  const missingFields = (analysis.requiredFields || []).filter(f => !filledFields.includes(f.key));
  
  
  let responseMessage;
  
  if (lang === 'hi') {
    responseMessage = `📄 दस्तावेज़ प्रकार: ${analysis.documentTitle}\n\n`;
    responseMessage += `${analysis.description}\n\n`;
    
    if (filledFields.length > 0) {
      responseMessage += `✅ प्राप्त जानकारी:\n`;
      for (const key of filledFields) {
        const field = analysis.requiredFields?.find(f => f.key === key);
        const label = field?.label || key.replace(/_/g, ' ');
        responseMessage += `• ${label}: ${analysis.extractedFromRequest[key]}\n`;
      }
      responseMessage += '\n';
    }
    
    responseMessage += `आप कैसे आगे बढ़ना चाहेंगे?`;
  } else {
    responseMessage = `📄 Document Type: ${analysis.documentTitle}\n\n`;
    responseMessage += `${analysis.description}\n\n`;
    
    if (filledFields.length > 0) {
      responseMessage += `✅ Information captured:\n`;
      for (const key of filledFields) {
        const field = analysis.requiredFields?.find(f => f.key === key);
        const label = field?.label || key.replace(/_/g, ' ');
        responseMessage += `• ${label}: ${analysis.extractedFromRequest[key]}\n`;
      }
      responseMessage += '\n';
    }
    
    responseMessage += `How would you like to proceed?`;
  }
  
  
  const suggestedActions = lang === 'hi'
    ? [
        { type: 'ai_doc_choice', label: `✍️ भरा हुआ दस्तावेज़ (${missingFields.length} फ़ील्ड)`, icon: '✍️', action: 'AI_DOC_FILLED', description: 'मैं बाकी विवरण पूछूंगा और पूरा दस्तावेज़ बनाऊंगा' },
        { type: 'ai_doc_choice', label: '📋 कच्चा टेम्पलेट', icon: '📋', action: 'AI_DOC_RAW', description: 'प्लेसहोल्डर्स के साथ टेम्पलेट' }
      ]
    : [
        { type: 'ai_doc_choice', label: `✍️ Filled Document (${missingFields.length} fields)`, icon: '✍️', action: 'AI_DOC_FILLED', description: "I'll ask for missing details and generate complete document" },
        { type: 'ai_doc_choice', label: '📋 Raw Template', icon: '📋', action: 'AI_DOC_RAW', description: 'Template with placeholders you can fill' }
      ];
  
  return await replyWithText(res, responseMessage, user, req, {
    mode: 'ai_document_choice',
    documentType: analysis.documentType,
    missingFieldsCount: missingFields.length,
    filledFieldsCount: filledFields.length,
    suggestedActions
  });
}

async function generateFreeFormDocument(userRequest, context, res, user, req, documentTypeHint = null) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  try {
    const requestLower = userRequest.toLowerCase();
    
    
    
    let analysis = null;
    if (documentTypeHint) {
      console.log(`📋 Document type hint provided: ${documentTypeHint}`);
      
      
      const schema = getDocumentSchema(documentTypeHint);
      if (schema) {
        
        if (hasSubtypes(documentTypeHint)) {
          const subtypes = getSubtypes(documentTypeHint);
          console.log(`🔀 Document has ${subtypes.length} subtypes, need subtype selection`);
          
          
          const lang = req?.preferredLanguage || 'en';
          return await offerSubtypeSelection(documentTypeHint, subtypes, userRequest, res, user, req, lang);
        }
        
        
        console.log(`✅ Using predefined schema for ${documentTypeHint}`);
        analysis = {
          documentType: documentTypeHint,
          documentTitle: schema.displayName,
          description: schema.description,
          requiredFields: schema.fields,
          extractedFromRequest: {}
        };
      }
    }
    
    
    if (!analysis) {
      
      if (requestLower.includes('fir') || requestLower.includes('first information report') ||
          requestLower.includes('police complaint') || requestLower.includes('domestic abuse') ||
          requestLower.includes('domestic violence') || requestLower.includes('assault') ||
          (requestLower.includes('stolen') && requestLower.includes('report'))) {
        
        const isFIR = requestLower.includes('fir') || requestLower.includes('first information');
        const isDomestic = requestLower.includes('domestic') || requestLower.includes('husband') || 
                           requestLower.includes('wife') || requestLower.includes('dowry');
        const isTheft = requestLower.includes('stolen') || requestLower.includes('theft') || 
                        requestLower.includes('robbery');
        
        let docType = 'Police Complaint';
        let docTitle = 'Police Complaint';
        let docDesc = 'A formal complaint to be filed with the police';
        
        if (isFIR) {
          docType = 'First Information Report (FIR)';
          docTitle = 'First Information Report';
          docDesc = 'An FIR to be registered at the police station';
        }
        if (isDomestic) {
          docTitle = isFIR ? 'FIR for Domestic Violence/Abuse' : 'Complaint for Domestic Violence';
          docDesc = 'A complaint regarding domestic violence/abuse under Protection of Women from Domestic Violence Act';
        }
        if (isTheft) {
          docTitle = isFIR ? 'FIR for Theft/Robbery' : 'Complaint for Theft';
          docDesc = 'A complaint regarding stolen property/theft';
        }
        
        
        const extractedData = {};
        if (requestLower.includes('husband')) extractedData.accused_relationship = 'Husband';
        if (requestLower.includes('wife')) extractedData.accused_relationship = 'Wife';
        if (requestLower.includes('dowry')) extractedData.incident_type = 'Domestic abuse related to dowry';
        if (isDomestic && !extractedData.incident_type) extractedData.incident_type = 'Domestic violence/abuse';
        if (isTheft) extractedData.incident_type = 'Theft/Robbery';
        
        analysis = {
          documentType: docType,
          documentTitle: docTitle,
          description: docDesc,
          requiredFields: [
            { key: 'complainant_name', label: 'Complainant Name', description: 'Your full legal name' },
            { key: 'complainant_father_name', label: 'Father\'s/Husband\'s Name', description: 'Father\'s or husband\'s name' },
            { key: 'complainant_address', label: 'Complainant Address', description: 'Your complete residential address' },
            { key: 'complainant_phone', label: 'Contact Number', description: 'Your phone number' },
            { key: 'accused_name', label: 'Accused Person\'s Name', description: 'Name of the person you are complaining against' },
            { key: 'accused_address', label: 'Accused\'s Address', description: 'Address of the accused (if known)' },
            { key: 'incident_date', label: 'Date of Incident', description: 'When did the incident occur' },
            { key: 'incident_time', label: 'Time of Incident', description: 'Approximate time of the incident' },
            { key: 'incident_location', label: 'Place of Incident', description: 'Where did the incident occur' },
            { key: 'incident_description', label: 'Detailed Description', description: 'Detailed description of what happened' },
            { key: 'police_station', label: 'Police Station', description: 'Name of the police station where filing' }
          ],
          extractedFromRequest: extractedData
        };
        
        
        if (isTheft) {
          analysis.requiredFields.push(
            { key: 'items_stolen', label: 'Items Stolen', description: 'List of stolen items with descriptions' },
            { key: 'estimated_value', label: 'Estimated Value', description: 'Approximate value of stolen items' }
          );
        }
        
        
        if (isDomestic) {
          analysis.requiredFields.push(
            { key: 'injuries_sustained', label: 'Injuries (if any)', description: 'Description of any physical injuries' },
            { key: 'witnesses', label: 'Witnesses (if any)', description: 'Names of any witnesses' }
          );
        }
        
        console.log('📝 Using predefined FIR/Complaint schema');
      }
    }
    
    
    if (!analysis) {
      const analysisPrompt = `You are an expert Indian legal document analyst. Analyze this request and identify the document type and required fields.

USER REQUEST: "${userRequest}"

CONTEXT: "${context}"

IMPORTANT: 
- Generate a SPECIFIC and DESCRIPTIVE document title based on what the user wants (e.g., "Goods Share and Exchange Bond", "Neighbor Dispute Settlement Agreement", "Property Partition Deed")
- Do NOT use generic titles like "Custom Legal Document" or "Legal Agreement"
- The title should clearly describe the purpose of the document

Respond ONLY with valid JSON in this exact format (no other text):
{
  "documentType": "The specific type of document",
  "documentTitle": "Specific descriptive title for this document (NOT generic)",
  "description": "Brief description of what this document is for",
  "requiredFields": [
    {"key": "field_key", "label": "Human Readable Label", "description": "What this field is for"}
  ],
  "extractedFromRequest": {
    "field_key": "value if already provided by user"
  }
}

JSON ONLY:`;

      const analysisResponse = await callLocalLLM(analysisPrompt);
      
      try {
        const jsonMatch = analysisResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch (parseErr) {
        console.error('Failed to parse AI analysis:', parseErr);
        
        const requestLower = userRequest.toLowerCase();
        let fallbackTitle = 'Legal Agreement';
        let fallbackType = 'Legal Document';
        
        
        if (requestLower.includes('bond')) {
          fallbackTitle = requestLower.includes('share') || requestLower.includes('exchange') 
            ? 'Goods Share and Exchange Bond' 
            : 'Legal Bond';
          fallbackType = 'Bond';
        } else if (requestLower.includes('agreement') || requestLower.includes('deal')) {
          fallbackTitle = 'Mutual Agreement';
          fallbackType = 'Agreement';
        } else if (requestLower.includes('deed')) {
          fallbackTitle = 'Legal Deed';
          fallbackType = 'Deed';
        } else if (requestLower.includes('notice')) {
          fallbackTitle = 'Legal Notice';
          fallbackType = 'Notice';
        }
        
        analysis = {
          documentType: fallbackType,
          documentTitle: fallbackTitle,
          description: 'A legal document based on your requirements',
          requiredFields: [
            { key: 'party_one_name', label: 'First Party Name', description: 'Name of the first party' },
            { key: 'party_one_address', label: 'First Party Address', description: 'Address of the first party' },
            { key: 'party_two_name', label: 'Second Party Name', description: 'Name of the second party (if applicable)' },
            { key: 'date', label: 'Date', description: 'Date of the document' },
            { key: 'subject_matter', label: 'Subject/Details', description: 'The main subject matter or details' },
            { key: 'place', label: 'Place', description: 'Place where document is executed' }
          ],
          extractedFromRequest: {}
        };
      }
    }
    
    console.log('📝 AI Document Analysis:', {
      type: analysis.documentType,
      fieldsCount: analysis.requiredFields?.length || 0,
      extractedCount: Object.keys(analysis.extractedFromRequest || {}).length
    });
    
    
    const lang = req?.preferredLanguage || 'en';
    const pendingAIDoc = {
      documentType: analysis.documentType,
      documentTitle: analysis.documentTitle,
      description: analysis.description,
      requiredFields: analysis.requiredFields || [],
      extractedData: analysis.extractedFromRequest || {},
      originalRequest: userRequest,
      context: context,
      preferredLanguage: lang,
      documentLanguage: null,
      timestamp: Date.now()
    };
    
    try {
      await redis.set(`pending_ai_document:${req.user.id}:${slug}`, JSON.stringify(pendingAIDoc), 'EX', 900);
    } catch (e) {
      console.warn('Failed to store pending AI document:', e?.message);
    }
    
    
    const filledFields = Object.keys(analysis.extractedFromRequest || {}).filter(k => analysis.extractedFromRequest[k]);
    const missingFields = (analysis.requiredFields || []).filter(f => !filledFields.includes(f.key));
    
    
    let responseMessage;
    
    if (lang === 'hi') {
      responseMessage = `📄 दस्तावेज़ प्रकार पहचाना गया: ${analysis.documentTitle}\n\n`;
      responseMessage += `${analysis.description}\n\n`;
      
      if (filledFields.length > 0) {
        responseMessage += `✅ आपके अनुरोध से प्राप्त जानकारी:\n`;
        for (const key of filledFields) {
          const field = analysis.requiredFields?.find(f => f.key === key);
          const label = field?.label || key.replace(/_/g, ' ');
          responseMessage += `• ${label}: ${analysis.extractedFromRequest[key]}\n`;
        }
        responseMessage += '\n';
      }
      
      responseMessage += `आप कैसे आगे बढ़ना चाहेंगे?`;
    } else {
      responseMessage = `📄 Document Type Identified: ${analysis.documentTitle}\n\n`;
      responseMessage += `${analysis.description}\n\n`;
      
      if (filledFields.length > 0) {
        responseMessage += `✅ Information captured from your request:\n`;
        for (const key of filledFields) {
          const field = analysis.requiredFields?.find(f => f.key === key);
          const label = field?.label || key.replace(/_/g, ' ');
          responseMessage += `• ${label}: ${analysis.extractedFromRequest[key]}\n`;
        }
        responseMessage += '\n';
      }
      
      responseMessage += `How would you like to proceed?`;
    }
    
    
    const suggestedActions = lang === 'hi'
      ? [
          { type: 'ai_doc_choice', label: `✍️ भरा हुआ दस्तावेज़ (${missingFields.length} फ़ील्ड)`, icon: '✍️', action: 'AI_DOC_FILLED', description: 'मैं बाकी विवरण पूछूंगा और पूरा दस्तावेज़ बनाऊंगा' },
          { type: 'ai_doc_choice', label: '📋 कच्चा टेम्पलेट', icon: '📋', action: 'AI_DOC_RAW', description: 'प्लेसहोल्डर्स के साथ टेम्पलेट जिसे आप भर सकते हैं' }
        ]
      : [
          { type: 'ai_doc_choice', label: `✍️ Filled Document (${missingFields.length} fields)`, icon: '✍️', action: 'AI_DOC_FILLED', description: "I'll ask for missing details and generate complete document" },
          { type: 'ai_doc_choice', label: '📋 Raw Template', icon: '📋', action: 'AI_DOC_RAW', description: 'Template with placeholders you can fill manually' }
        ];
    
    return await replyWithText(res, responseMessage, user, req, {
      mode: 'ai_document_choice',
      documentType: analysis.documentType,
      missingFieldsCount: missingFields.length,
      filledFieldsCount: filledFields.length,
      suggestedActions
    });
    
  } catch (error) {
    console.error('Free-form document generation error:', error);
    return await replyWithText(res, 'I encountered an error analyzing your document request. Please try again with more specific details about what you need.', user, req);
  }
}

async function handleAIDocumentChoice(message, res, user, req) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  const msgLower = message.trim().toLowerCase();
  
  let pending = null;
  try {
    const pendingStr = await redis.get(`pending_ai_document:${req.user.id}:${slug}`);
    pending = pendingStr ? JSON.parse(pendingStr) : null;
  } catch (e) {
    console.warn('Failed to read pending AI document:', e?.message);
  }
  
  if (!pending) {
    return null;
  }
  
  
  const wantsFilled = msgLower === '1' || msgLower === 'one' || 
    msgLower.includes('filled') || msgLower.includes('complete') ||
    msgLower.includes('ask') || msgLower.includes('first') ||
    msgLower.includes('option 1') ||
    
    msgLower.includes('bhara') || msgLower.includes('भरा') ||
    msgLower.includes('filled') || msgLower.includes('पूरा') ||
    msgLower.includes('दस्तावेज़') || msgLower.includes('dastavez');
  
  
  const wantsRaw = msgLower === '2' || msgLower === 'two' ||
    msgLower.includes('raw') || msgLower.includes('template') ||
    msgLower.includes('placeholder') || msgLower.includes('manual') ||
    msgLower.includes('second') || msgLower.includes('option 2') ||
    
    msgLower.includes('kaccha') || msgLower.includes('कच्चा') ||
    msgLower.includes('टेम्पलेट') || msgLower.includes('template');
  
  if (wantsRaw) {
    
    console.log('📄 User chose RAW template');
    await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
    return await generateRawAITemplate(pending, res, user, req);
  }
  
  if (wantsFilled) {
    
    console.log('📄 User chose FILLED document - opening fields modal');
    const lang = pending.preferredLanguage || req?.preferredLanguage || 'en';
    
    const filledKeys = Object.keys(pending.extractedData || {}).filter(k => pending.extractedData[k]);
    const missingFields = (pending.requiredFields || []).filter(f => !filledKeys.includes(f.key));
    
    if (missingFields.length === 0) {
      
      await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
      return await generateFilledAIDocument(pending, res, user, req);
    }
    
    
    pending.collectingFields = true;
    pending.missingFields = missingFields;
    pending.usingModal = true;
    await redis.set(`pending_ai_document:${req.user.id}:${slug}`, JSON.stringify(pending), 'EX', 900);
    
    
    
    const syntheticTemplatePath = `AI_SCHEMA:${pending.documentType.replace(/\s+/g, '_')}`;
    
    const responseMsg = lang === 'hi'
      ? `बढ़िया! कृपया नीचे दिए गए फॉर्म में विवरण भरें।`
      : `Great! Please fill in the details in the form below.`;
    
    return await replyWithText(res, responseMsg, user, req, {
      mode: 'ai_document_field_collection',
      missingFields: missingFields.map(f => ({ 
        key: f.key, 
        label: f.label,
        description: f.description,
        type: f.type || 'text',
        required: f.required !== false
      })),
      templatePath: syntheticTemplatePath,
      templateTitle: pending.documentTitle,
      isSchemaDocument: true
    });
  }
  
  
  const lang = pending?.preferredLanguage || req?.preferredLanguage || 'en';
  const unclearMsg = lang === 'hi'
    ? `कृपया नीचे दिए गए विकल्पों में से चुनें:`
    : `Please choose from the options below:`;
  
  const suggestedActions = lang === 'hi'
    ? [
        { type: 'ai_doc_choice', label: '✍️ भरा हुआ दस्तावेज़', icon: '✍️', action: 'AI_DOC_FILLED', description: 'मैं बाकी विवरण पूछूंगा' },
        { type: 'ai_doc_choice', label: '📋 कच्चा टेम्पलेट', icon: '📋', action: 'AI_DOC_RAW', description: 'प्लेसहोल्डर्स के साथ टेम्पलेट' }
      ]
    : [
        { type: 'ai_doc_choice', label: '✍️ Filled Document', icon: '✍️', action: 'AI_DOC_FILLED', description: "I'll ask for missing details" },
        { type: 'ai_doc_choice', label: '📋 Raw Template', icon: '📋', action: 'AI_DOC_RAW', description: 'Template with placeholders' }
      ];
  
  return await replyWithText(res, unclearMsg, user, req, { suggestedActions });
}

async function handleAIDocumentLanguageChoice(message, res, user, req) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  let pending = null;
  try {
    const pendingStr = await redis.get(`pending_ai_document:${req.user.id}:${slug}`);
    pending = pendingStr ? JSON.parse(pendingStr) : null;
  } catch (e) {
    console.warn('Failed to read pending AI document for language choice:', e?.message);
  }
  
  if (!pending || !pending.awaitingLanguageChoice) {
    return null;
  }
  
  const msgLower = message.toLowerCase().trim();
  const lang = pending.preferredLanguage || req?.preferredLanguage || 'en';
  
  
  const wantsHindi = msgLower.includes('hindi') || msgLower.includes('हिंदी') || 
                     msgLower.includes('हिन्दी') || msgLower === '1';
  
  
  const wantsEnglish = msgLower.includes('english') || msgLower.includes('अंग्रेज़ी') || 
                       msgLower.includes('अंग्रेजी') || msgLower === '2';
  
  if (wantsHindi) {
    pending.documentLanguage = 'hi';
    pending.awaitingLanguageChoice = false;
    await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
    console.log('📄 User chose HINDI document language');
    return await generateFilledAIDocument(pending, res, user, req);
  }
  
  if (wantsEnglish) {
    pending.documentLanguage = 'en';
    pending.awaitingLanguageChoice = false;
    await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
    console.log('📄 User chose ENGLISH document language');
    return await generateFilledAIDocument(pending, res, user, req);
  }
  
  
  const askAgain = lang === 'hi'
    ? `कृपया स्पष्ट करें - आप दस्तावेज़ किस भाषा में चाहते हैं?\n\n🇮🇳 **हिंदी** के लिए "हिंदी" या "hindi" लिखें\n🇬🇧 **English** के लिए "english" या "अंग्रेज़ी" लिखें`
    : `Please clarify - which language do you want your document in?\n\n🇮🇳 Type "hindi" for **Hindi**\n🇬🇧 Type "english" for **English**`;
  
  return await replyWithText(res, askAgain, user, req, {
    mode: 'ai_document_language_choice'
  });
}

async function handleAIDocumentFields(message, res, user, req) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  let pending = null;
  try {
    const pendingStr = await redis.get(`pending_ai_document:${req.user.id}:${slug}`);
    pending = pendingStr ? JSON.parse(pendingStr) : null;
  } catch (e) {
    console.warn('Failed to read pending AI document:', e?.message);
  }
  
  if (!pending || !pending.collectingFields) {
    return null;
  }
  
  
  const parsedValues = tryParseStructuredInput(message);
  
  
  if (pending.missingFields && pending.missingFields.length > 0) {
    const fieldExtractionPrompt = `Extract ONLY ACTUAL VALUES from this user message for a ${pending.documentType}.

CRITICAL RULES:
1. ONLY extract values that the user has EXPLICITLY provided
2. If a field value is not in the user's message, return null for that field
3. DO NOT make up values, invent names, or use placeholder text
4. DO NOT return text like "[value]" or "[not provided]" - return null instead

USER MESSAGE: "${message}"

EXPECTED FIELDS:
${pending.missingFields.map(f => `- ${f.key}: ${f.label}`).join('\n')}

Return valid JSON with ONLY the fields that have actual values from the message:
{
  "field_key": "actual_value_from_message"
}

If user says "my name is Rahul", return: {"complainantName": "Rahul"}
If user doesn't mention a field, DO NOT include it.
Return {} if no values found.`;

    try {
      const extractionResponse = await callLocalLLM(fieldExtractionPrompt);
      const jsonMatch = extractionResponse.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);
        
        for (const [key, value] of Object.entries(extracted)) {
          if (value && typeof value === 'string' && value.trim()) {
            const valueTrimmed = value.trim();
            
            if (valueTrimmed.startsWith('[') || valueTrimmed.startsWith('(') ||
                valueTrimmed.includes('not provided') || valueTrimmed.includes('mentioned') ||
                valueTrimmed.includes('unknown') || valueTrimmed === 'null' ||
                valueTrimmed.includes('N/A')) {
              console.log(`⚠️ Skipping placeholder value for ${key}: "${valueTrimmed}"`);
              continue;
            }
            pending.extractedData[key] = valueTrimmed;
          }
        }
      }
    } catch (e) {
      console.warn('AI field extraction failed:', e?.message);
    }
  }
  
  
  if (parsedValues) {
    for (const [key, value] of Object.entries(parsedValues)) {
      
      const normalizedKey = key.toLowerCase().replace(/\s+/g, '_');
      const matchingField = pending.missingFields?.find(f => 
        f.key.toLowerCase() === normalizedKey ||
        f.label.toLowerCase().replace(/\s+/g, '_') === normalizedKey ||
        f.key.toLowerCase().includes(normalizedKey) ||
        normalizedKey.includes(f.key.toLowerCase())
      );
      if (matchingField) {
        pending.extractedData[matchingField.key] = value;
      } else {
        pending.extractedData[normalizedKey] = value;
      }
    }
  }
  
  
  const filledKeys = Object.keys(pending.extractedData).filter(k => pending.extractedData[k]);
  const stillMissing = (pending.requiredFields || []).filter(f => !filledKeys.includes(f.key));
  
  console.log('📝 AI Document field update:', {
    filled: filledKeys.length,
    stillMissing: stillMissing.length,
    newData: pending.extractedData
  });
  
  const lang = pending.preferredLanguage || req?.preferredLanguage || 'en';
  
  if (stillMissing.length === 0) {
    
    if (!pending.documentLanguage) {
      pending.awaitingLanguageChoice = true;
      pending.collectingFields = false;
      await redis.set(`pending_ai_document:${req.user.id}:${slug}`, JSON.stringify(pending), 'EX', 900);
      
      const langChoiceMsg = lang === 'hi'
        ? `सभी विवरण प्राप्त हो गए! 🎉\n\nआप अपना दस्तावेज़ किस भाषा में चाहते हैं?\n\n🇮🇳 **हिंदी** के लिए "हिंदी" या "hindi" टाइप करें\n🇬🇧 **English** के लिए "english" या "अंग्रेज़ी" टाइप करें`
        : `All details captured! 🎉\n\nWhich language would you like your document in?\n\n🇮🇳 Type "hindi" or "हिंदी" for **Hindi**\n🇬🇧 Type "english" for **English**`;
      
      return await replyWithText(res, langChoiceMsg, user, req, {
        mode: 'ai_document_language_choice'
      });
    }
    
    await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
    return await generateFilledAIDocument(pending, res, user, req);
  }
  
  
  pending.missingFields = stillMissing;
  await redis.set(`pending_ai_document:${req.user.id}:${slug}`, JSON.stringify(pending), 'EX', 900);
  
  
  const capturedStr = filledKeys.map(k => {
    const field = pending.requiredFields?.find(f => f.key === k);
    return `${field?.label || k}: ${pending.extractedData[k]}`;
  }).join(', ');
  
  let askMore;
  if (lang === 'hi') {
    askMore = `✅ **प्राप्त जानकारी:** ${capturedStr}\n\n`;
    askMore += `📋 **अभी भी आवश्यक:**\n`;
    stillMissing.forEach((field, idx) => {
      askMore += `${idx + 1}. ${field.label}`;
      if (field.description) askMore += ` - ${field.description}`;
      askMore += '\n';
    });
  } else {
    askMore = `✅ **Captured:** ${capturedStr}\n\n`;
    askMore += `📋 **Still need:**\n`;
    stillMissing.forEach((field, idx) => {
      askMore += `${idx + 1}. ${field.label}`;
      if (field.description) askMore += ` - ${field.description}`;
      askMore += '\n';
    });
  }
  
  return await replyWithText(res, askMore, user, req, {
    mode: 'ai_document_fields',
    missingFields: stillMissing.map(f => ({ key: f.key, label: f.label }))
  });
}

async function generateRawAITemplate(pending, res, user, req) {
  const docTypeLower = (pending.documentType || '').toLowerCase();
  let generatePrompt;
  
  if (docTypeLower.includes('fir') || docTypeLower.includes('police') || docTypeLower.includes('complaint')) {
    generatePrompt = `Generate a First Information Report (FIR) / Police Complaint TEMPLATE with placeholders.

Use [PLACEHOLDER] format for fields. Generate this exact structure:

---
TO,
The Station House Officer,
[POLICE_STATION]

Subject: First Information Report / Complaint regarding [INCIDENT_TYPE]

Respected Sir/Madam,

I, [COMPLAINANT_NAME], [S/o, D/o, W/o] [FATHER_HUSBAND_NAME], aged about [AGE] years, resident of [COMPLAINANT_ADDRESS], Contact No: [PHONE_NUMBER], do hereby lodge this complaint and state as follows:

1. DETAILS OF INCIDENT:
   - Date of Incident: [INCIDENT_DATE]
   - Time of Incident: [INCIDENT_TIME]
   - Place of Incident: [INCIDENT_LOCATION]

2. DESCRIPTION OF INCIDENT:
[INCIDENT_DESCRIPTION]

3. DETAILS OF ACCUSED:
   - Name: [ACCUSED_NAME]
   - Address: [ACCUSED_ADDRESS]
   - Relationship with Complainant: [ACCUSED_RELATIONSHIP]

4. WITNESSES (if any):
[WITNESSES]

5. INJURIES/LOSSES (if any):
[INJURIES_LOSSES]

6. PRAYER:
I therefore request you to kindly register an FIR against the above-named accused under the appropriate sections of law and take necessary legal action.

I hereby declare that the above statement is true to the best of my knowledge and belief.

Date: [DATE]
Place: [PLACE]

Yours faithfully,
[COMPLAINANT_NAME]
(Signature of Complainant)

VERIFICATION
I, [COMPLAINANT_NAME], do hereby verify that the contents of this complaint are true and correct to my knowledge and nothing has been concealed therein.

Verified at [PLACE] on [DATE]

[COMPLAINANT_NAME]
---

Generate this template (plain text, no markdown):`;
  } else {
    generatePrompt = `You are an expert Indian legal document drafter. Generate a professional ${pending.documentType} template.

DOCUMENT TYPE: ${pending.documentTitle}
DESCRIPTION: ${pending.description}
ORIGINAL REQUEST: ${pending.originalRequest}

Use [PLACEHOLDER_NAME] format for ALL variable fields.
Include proper legal formatting and numbered clauses.
Include date and signature sections.

PLACEHOLDERS TO INCLUDE:
${pending.requiredFields.map(f => `[${f.key.toUpperCase()}] - ${f.label}`).join('\n')}

Use plain text only (no markdown).
Generate the complete template now:`;
  }

  try {
    console.log('🔄 Generating raw AI template...');
    const templateText = await callLocalLLM(generatePrompt);
    
    if (!templateText || templateText.trim().length < 100) {
      console.error('AI returned insufficient content for template');
      throw new Error('AI generated insufficient content');
    }
    
    console.log('✅ AI generated template length:', templateText.length);
    
    
    const cleanedText = templateText
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/__/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/```/g, '')
      .trim();
    
    
    const fileName = `${pending.documentType.replace(/\s+/g, '_')}_Template.docx`;
    const { filePath, fileSize } = await writeDocxFromText(cleanedText, pending.documentTitle);
    
    const documentData = {
      text: cleanedText,
      downloadUrl: `/api/files/download/${path.basename(filePath)}`,
      fileName: path.basename(filePath),
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: fileSize,
      displayTitle: `${pending.documentTitle} (Template)`,
      extractedData: {},
      success: true,
      isTemplate: true
    };
    
    const responseMsg = `📄 I've generated a **${pending.documentTitle}** template with placeholders.\n\nYou can download it and fill in the bracketed [FIELDS] manually.`;
    
    return await replyWithDocument(res, documentData, user, req, pending.originalRequest, responseMsg);
  } catch (error) {
    console.error('Raw template generation error:', error);
    return await replyWithText(res, 'I encountered an error generating the template. Please try again.', user, req);
  }
}

async function generateFilledAIDocument(pending, res, user, req) {
  
  const docLang = pending.documentLanguage || pending.preferredLanguage || req?.preferredLanguage || 'en';
  const isHindi = docLang === 'hi';
  
  const dataDescription = Object.entries(pending.extractedData)
    .filter(([k, v]) => v)
    .map(([k, v]) => {
      const field = pending.requiredFields?.find(f => f.key === k);
      return `${field?.label || k}: ${v}`;
    })
    .join('\n');
  
  
  const langInstruction = isHindi
    ? `\n\nIMPORTANT: Generate the ENTIRE document in HINDI language using Devanagari script. All headings, content, and text should be in proper Hindi.`
    : `\n\nGenerate the document in formal English.`;
  
  
  let generatePrompt;
  const docTypeLower = (pending.documentType || '').toLowerCase();
  
  if (docTypeLower.includes('fir') || docTypeLower.includes('police') || docTypeLower.includes('complaint')) {
    generatePrompt = `You are a legal document assistant helping a citizen draft a complaint to submit to authorities.
    
IMPORTANT: This is a BLANK TEMPLATE / DRAFT that the user will review, verify, and submit themselves. You are NOT making accusations - you are helping format information the user has provided into proper legal format.

Generate a formal complaint document DRAFT for the user to submit to the appropriate authorities.

FORMAT THIS AS A PROPER INDIAN COMPLAINT WITH THE FOLLOWING STRUCTURE:

---
TO,
The Station House Officer,
[Police Station Name] Police Station

Subject: Complaint regarding [type of incident]

Respected Sir/Madam,

I, [Complainant Name], aged about [age] years, resident of [Complete Address], do hereby submit this complaint and state as follows:

1. DETAILS OF INCIDENT:
   - Date of Incident: [Date]
   - Time of Incident: [Time] 
   - Place of Incident: [Location]

2. DESCRIPTION OF INCIDENT:
[Detailed narrative based on information provided]

3. REQUEST:
I request you to kindly look into this matter and take appropriate legal action as per law.

I hereby declare that the above statement is based on my personal knowledge and belief.

Date: [Date]
Place: [Place]

Respectfully,
[Complainant Name]
(Signature of Complainant)
---

NOW CREATE THIS DRAFT DOCUMENT USING THE FOLLOWING INFORMATION PROVIDED BY THE USER:
${dataDescription}

User's description: ${pending.originalRequest}
${langInstruction}

Generate the complete DRAFT document (plain text, no markdown). Remember this is a template draft for the user to verify and submit:`;
  } else {
    
    generatePrompt = `You are an expert Indian legal document drafter. Generate a complete, professional ${pending.documentType}.

DOCUMENT TYPE: ${pending.documentTitle}
DESCRIPTION: ${pending.description}
ORIGINAL REQUEST: ${pending.originalRequest}

PROVIDED INFORMATION:
${dataDescription}

STRICT RULES:
1. DO NOT add any disclaimers, warnings, or notes about document validity
2. DO NOT add any text like "this document should not be used for..." 
3. DO NOT include any AI-generated notices or cautionary statements
4. Start directly with the document title/heading
5. Use plain text only (no markdown, no ** or # symbols)
6. Make it legally sound and professional

Create a complete, formal Indian legal document with:
1. Proper heading and title
2. All parties clearly identified  
3. Main content with numbered clauses
4. Date and place
5. Signature section
6. Verification/Declaration if needed (standard legal verification ONLY)

Fill in ALL the provided information.
${langInstruction}

Generate the complete document now (NO disclaimers or warnings):`;
  }

  try {
    console.log('🔄 Generating filled AI document...');
    const documentText = await callLocalLLM(generatePrompt);
    
    if (!documentText || documentText.trim().length < 100) {
      console.error('AI returned insufficient content:', documentText?.substring(0, 200));
      throw new Error('AI generated insufficient content');
    }
    
    console.log('✅ AI generated content length:', documentText.length);
    
    
    const cleanedText = documentText
      .replace(/\*\*/g, '')
      .replace(/^#+\s*/gm, '')
      .replace(/__/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/```/g, '')
      .trim();
    
    
    const { filePath, fileSize } = await writeDocxFromText(cleanedText, pending.documentTitle);
    
    const documentData = {
      text: cleanedText,
      downloadUrl: `/api/files/download/${path.basename(filePath)}`,
      fileName: path.basename(filePath),
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: fileSize,
      displayTitle: pending.documentTitle,
      extractedData: pending.extractedData,
      success: true,
      isCustomGenerated: true
    };
    
    return await replyWithDocument(res, documentData, user, req, pending.originalRequest);
  } catch (error) {
    console.error('Filled document generation error:', error);
    
    
    const errorMsg = error?.message || '';
    if (errorMsg.includes('insufficient content')) {
      const lang = req?.preferredLanguage || 'en';
      const refusalMsg = lang === 'hi'
        ? `मैं इस प्रकार का दस्तावेज़ AI के माध्यम से जेनरेट करने में असमर्थ हूँ। सुरक्षा कारणों से, कुछ दस्तावेज़ों को सीधे संबंधित अधिकारियों (जैसे पुलिस स्टेशन) में भरना चाहिए।\n\nमैं आपको इसके बजाय मार्गदर्शन दे सकता हूँ:\n1. अपने निकटतम पुलिस स्टेशन जाएं\n2. आवश्यक दस्तावेज़ (ID प्रूफ, पता) ले जाएं\n3. घटना का विवरण बताएं\n\nक्या आप चाहते हैं कि मैं प्रक्रिया के बारे में और जानकारी दूं?`
        : `I'm unable to generate this type of document via AI. For safety reasons, certain documents (like police complaints) should be filed directly with the appropriate authorities.\n\nI can guide you instead:\n1. Visit your nearest police station\n2. Bring required documents (ID proof, address proof)\n3. Provide the details of the incident to the officer\n\nWould you like me to explain the process in more detail?`;
      return await replyWithText(res, refusalMsg, user, req);
    }
    
    const lang = req?.preferredLanguage || 'en';
    const genericError = lang === 'hi'
      ? 'दस्तावेज़ जेनरेट करते समय त्रुटि हुई। कृपया पुनः प्रयास करें।'
      : 'I encountered an error generating your document. Please try again.';
    return await replyWithText(res, genericError, user, req);
  }
}

async function showTemplateCategories(res, user, req, message) {
  const lang = req?.preferredLanguage || 'en';
  
  const categories = [
    { name: 'Adoption Drafts', nameHi: 'गोद लेने के दस्तावेज़', description: 'Adoption deeds, consent forms, certificates', descHi: 'गोद लेने के विलेख, सहमति प्रपत्र, प्रमाण पत्र' },
    { name: 'Affidavit Formats', nameHi: 'शपथ पत्र प्रारूप', description: 'Various affidavit types for courts and authorities', descHi: 'न्यायालयों और अधिकारियों के लिए विभिन्न शपथ पत्र' },
    { name: 'Arbitration Agreement', nameHi: 'मध्यस्थता समझौता', description: 'Arbitration applications, awards, agreements', descHi: 'मध्यस्थता आवेदन, पुरस्कार, समझौते' },
    { name: 'Bond Drafts', nameHi: 'बॉन्ड दस्तावेज़', description: 'Administration bonds, bail bonds, surety bonds', descHi: 'प्रशासनिक बॉन्ड, जमानत बॉन्ड, जामिन बॉन्ड' },
    { name: 'Criminal Pleadings', nameHi: 'आपराधिक अभिवचन', description: 'Bail applications, FIR, criminal appeals', descHi: 'जमानत आवेदन, एफआईआर, आपराधिक अपील' },
    { name: 'Deeds', nameHi: 'विलेख', description: 'Sale deeds, gift deeds, lease, mortgage, partnership', descHi: 'बिक्री विलेख, उपहार विलेख, पट्टा, बंधक, साझेदारी' },
    { name: 'Family Law Drafts', nameHi: 'पारिवारिक कानून', description: 'Divorce, maintenance, separation, marriage', descHi: 'तलाक, भरण-पोषण, अलगाव, विवाह' },
    { name: 'Legal Notice', nameHi: 'कानूनी नोटिस', description: 'Tenant notices, consumer complaints, cheque bounce', descHi: 'किरायेदार नोटिस, उपभोक्ता शिकायत, चेक बाउंस' },
    { name: 'Motor Vehicle Act', nameHi: 'मोटर वाहन अधिनियम', description: 'Accident claims, vehicle registration, permits', descHi: 'दुर्घटना दावे, वाहन पंजीकरण, परमिट' },
    { name: 'Negotiable Instruments', nameHi: 'परक्राम्य लिखत', description: 'Section 138 notices, cheque dishonor', descHi: 'धारा 138 नोटिस, चेक अनादर' },
    { name: 'Power of Attorney', nameHi: 'मुख्तारनामा', description: 'General, specific, irrevocable POA', descHi: 'सामान्य, विशिष्ट, अपरिवर्तनीय POA' },
    { name: 'SLP Formats', nameHi: 'SLP प्रारूप', description: 'Supreme Court special leave petitions', descHi: 'सर्वोच्च न्यायालय विशेष अनुमति याचिकाएं' },
    { name: 'Specific Relief Act', nameHi: 'विशिष्ट राहत अधिनियम', description: 'Specific performance suits', descHi: 'विशिष्ट निष्पादन वाद' },
    { name: 'Will & Gift Deed', nameHi: 'वसीयत और उपहार विलेख', description: 'Wills, codicils, gift deeds', descHi: 'वसीयत, कोडिसिल, उपहार विलेख' }
  ];
  
  const categoryList = categories
    .map((cat, idx) => `${idx + 1}. **${lang === 'hi' ? cat.nameHi : cat.name}** - ${lang === 'hi' ? cat.descHi : cat.description}`)
    .join('\n');
  
  const browseMessage = lang === 'hi'
    ? `यहाँ उपलब्ध टेम्पलेट श्रेणियाँ हैं:\n\n${categoryList}\n\nकृपया बताएं कि आपको कौन सी श्रेणी चाहिए, या अपने दस्तावेज़ का वर्णन करें और मैं सबसे उपयुक्त मिलान खोजूंगा।`
    : `Here are the available template categories:\n\n${categoryList}\n\nPlease tell me which category interests you, or describe the document you need and I'll find the best match.`;
  
  return await replyWithText(res, browseMessage, user, req, {
    mode: 'browse_templates',
    categories: categories.map(c => c.name)
  });
}

async function handleDocumentRequest(message, res, user, req, classification, guidanceContext = null, sourceAction = null, documentType = null, slug = 'default') {
  try {
    
    const chatDoc = await getUserChatHistory(req.user.id, slug);
    const contextMessages = chatDoc.messages.slice(-4).map(m => m.content).join('\n');
    const fullContext = `${contextMessages}\n${message}`;

    
    const documentSuggestion = await generateDocumentSuggestion(message, fullContext);
    
    
    
    const template = await findBestTemplate(message, guidanceContext);
    
    console.log(`Template selection result for user ${req.user?.id || 'unknown'}:`, template ? { relPath: template.relPath, displayTitle: template.displayTitle, score: template._matchScore, lowConfidence: template._lowConfidence } : null);
    
    
    if (!template) {
      return await offerFreeFormGeneration(message, fullContext, res, user, req, sourceAction, documentType);
    }
    
    
    
    let pendingConfirmation = null;
    try {
      const pendingStr = await redis.get(`pending_template_confirm:${req.user.id}:${slug}`);
      pendingConfirmation = pendingStr ? JSON.parse(pendingStr) : null;
    } catch (e) {}
    
    
    if (!pendingConfirmation) {
      const confidenceLevel = template._lowConfidence ? 'not fully confident' : 'confident';
      const templateDescription = getTemplateDescription(template.displayTitle);
      const lang = req?.preferredLanguage || 'en';
      
      let confirmMessage;
      if (lang === 'hi') {
        const confidenceHi = template._lowConfidence ? 'पूरी तरह आश्वस्त नहीं' : 'आश्वस्त';
        confirmMessage = `📋 **टेम्पलेट मिला:** ${template.displayTitle}\n\n${templateDescription}\n\nमैं ${confidenceHi} हूं कि यह आपकी ज़रूरतों से मेल खाता है।\n\n**विकल्प:**\n1️⃣ **इस टेम्पलेट का उपयोग करें** - मैं आवश्यक विवरण एकत्र करूंगा और दस्तावेज़ तैयार करूंगा\n2️⃣ **AI दस्तावेज़ बनाएं** - मैं आपकी विशिष्ट ज़रूरतों के अनुसार कस्टम दस्तावेज़ बनाऊंगा\n\nटेम्पलेट के लिए **1** या AI-जनित दस्तावेज़ के लिए **2** जवाब दें।`;
      } else {
        confirmMessage = `📋 **Template Found:** ${template.displayTitle}\n\n${templateDescription}\n\nI am ${confidenceLevel} this matches your needs.\n\n**Options:**\n1️⃣ **Use this template** - I'll collect the required details and generate the document\n2️⃣ **Generate AI document** - I'll create a custom document tailored to your specific needs\n\nPlease reply with **1** to use the template, or **2** for AI-generated document.`;
      }
      
      
      let preExtractedFields = {};
      try {
        const preExtracted = await documentExtractor.extractFields(message, template.relPath, template.schema);
        preExtractedFields = preExtracted?.data || {};
        const extractedCount = Object.keys(preExtractedFields).length;
        if (extractedCount > 0) {
          console.log(`🔍 Pre-extracted ${extractedCount} fields from user message:`, Object.keys(preExtractedFields));
        }
      } catch (e) {
        console.warn('Pre-field-extraction failed (non-critical):', e?.message);
      }

      
      try {
        await redis.set(`pending_template_confirm:${req.user.id}:${slug}`, JSON.stringify({
          template: template,
          originalRequest: message,
          context: fullContext,
          timestamp: Date.now(),
          preExtractedFields
        }), 'EX', 600);
      } catch (e) {
        console.warn('Failed to store pending template confirmation:', e?.message);
      }
      
      
      const templateChoiceSuggestedActions = lang === 'hi' ? [
        { type: 'choice', label: 'इस टेम्पलेट का उपयोग करें', icon: '📋', action: 'USE_TEMPLATE', description: 'टेम्पलेट से दस्तावेज़ बनाएं' },
        { type: 'choice', label: 'AI से बनाएं', icon: '🤖', action: 'USE_AI_GENERATE', description: 'AI से कस्टम दस्तावेज़ बनाएं' }
      ] : [
        { type: 'choice', label: 'Use this template', icon: '📋', action: 'USE_TEMPLATE', description: 'Generate document from template' },
        { type: 'choice', label: 'Generate with AI', icon: '🤖', action: 'USE_AI_GENERATE', description: 'Create a custom AI-generated document' }
      ];

      return await replyWithText(res, confirmMessage, user, req, {
        mode: 'template_confirmation',
        suggestedTemplate: template.displayTitle,
        templatePath: template.relPath,
        lowConfidence: template._lowConfidence,
        suggestedActions: templateChoiceSuggestedActions
      });
    }
    
    
    
    
    return await proceedWithTemplate(template, message, res, user, req, classification);
    
  } catch (error) {
    console.error('Document request error:', error);
    logError('DOC002', error, { context: 'document_request_processing', userId: req.user.id, message });
    const errorResponse = generateErrorResponse('DOC002');
    return await replyWithText(res, errorResponse.error.message, user, req, { 
      errorCode: errorResponse.error.code,
      errorDetails: errorResponse.error 
    });
  }
}

function getTemplateDescription(displayTitle) {
  const descriptions = {
    'application for exemption from personal appearance of complainant': 'This template is for requesting court exemption from personal appearance. **This is NOT an FIR or police complaint form.**',
    'sale flat': 'A deed for selling a flat/apartment property.',
    'sale land land with structure': 'A deed for selling land with or without structures.',
    'agreement to sale without possession': 'A preliminary agreement before final sale (not the actual sale deed).',
    'bail application': 'Application for release on bail in criminal matters.',
    'rent agreement': 'Rental/lease agreement between landlord and tenant.',
    'lease agreement': 'Rental/lease agreement between landlord and tenant.',
    'general power of attorney': 'Document authorizing someone to act on your behalf.',
    'will': 'Last will and testament for property distribution.',
    'affidavit': 'A written sworn statement of fact.',
    'legal notice': 'Formal notice sent before legal proceedings.',
    'adoption deed': 'Legal document for adoption proceedings.',
    'gift deed': 'Document for transferring property as a gift.',
    'partnership deed': 'Agreement between business partners.',
    'divorce petition': 'Application for dissolution of marriage.',
    'consumer complaint': 'Complaint against defective goods or deficient services.',
    'bond by sureties': 'A surety bond document - **This is NOT an FIR or police complaint.**',
    'anticipatory bail': 'Application for bail before arrest.',
  };
  
  const titleLower = displayTitle.toLowerCase();
  
  
  if (descriptions[titleLower]) {
    return `*${descriptions[titleLower]}*`;
  }
  
  
  
  
  
  for (const [key, desc] of Object.entries(descriptions)) {
    
    const keyWords = key.split(' ').filter(w => w.length > 2);
    const titleWords = titleLower.split(' ');
    
    
    const matchCount = keyWords.filter(kw => titleWords.some(tw => tw === kw || tw.startsWith(kw))).length;
    if (matchCount >= Math.ceil(keyWords.length * 0.6)) {
      return `*${desc}*`;
    }
  }
  
  return '';
}

async function handleTemplateConfirmation(message, res, user, req) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  const msgLower = message.toLowerCase().trim();
  
  let pending = null;
  try {
    const pendingStr = await redis.get(`pending_template_confirm:${req.user.id}:${slug}`);
    pending = pendingStr ? JSON.parse(pendingStr) : null;
  } catch (e) {
    console.warn('Failed to read pending template confirmation:', e?.message);
  }
  
  if (!pending || !pending.template) {
    return null;
  }
  
  
  const wantsTemplate = msgLower === '1' || msgLower === 'one' || 
    msgLower.includes('use this template') || msgLower.includes('use template') ||
    msgLower.includes('yes') || msgLower.includes('option 1') ||
    msgLower.includes('first option') || msgLower.includes('template');
  
  const wantsAI = msgLower === '2' || msgLower === 'two' ||
    msgLower.includes('ai') || msgLower.includes('generate') ||
    msgLower.includes('custom') || msgLower.includes('option 2') ||
    msgLower.includes('second option') || msgLower.includes('wrong') ||
    msgLower.includes('not right') || msgLower.includes('incorrect');
  
  if (wantsTemplate) {
    
    try { await redis.del(`pending_template_confirm:${req.user.id}:${slug}`); } catch(e) {}
    
    
    const templates = await loadTemplates();
    const template = templates.find(t => t.relPath === pending.template.relPath) || pending.template;
    
    
    
    if (pending.preExtractedFields && Object.keys(pending.preExtractedFields).length > 0) {
      try {
        await getOrCreateDocumentSession(req.user.id, template);
        await accumulateExtractedFields(req.user.id, pending.preExtractedFields);
        console.log(`🌱 Pre-seeded session with ${Object.keys(pending.preExtractedFields).length} fields from original message`);
      } catch (e) {
        console.warn('Failed to pre-seed session with extracted fields:', e?.message);
      }
    }
    
    console.log(`✅ User confirmed template: ${template.displayTitle}`);
    return await proceedWithTemplate(template, pending.originalRequest, res, user, req, null);
  }
  
  if (wantsAI) {
    
    try { await redis.del(`pending_template_confirm:${req.user.id}:${slug}`); } catch(e) {}
    
    console.log(`🤖 User chose AI generation over template: ${pending.template.displayTitle}`);
    return await generateFreeFormDocument(pending.originalRequest, pending.context, res, user, req);
  }
  
  
  return null;
}

async function proceedWithTemplate(template, originalMessage, res, user, req, classification, slug = 'default') {
  try {
    
    
    const existingSession = await DocumentSession.findOne({ userId: req.user.id, slug, status: 'active' });
    
    if (existingSession && existingSession.template.relPath !== template.relPath) {
      console.log(`🔄 Template changed from "${existingSession.template.displayTitle}" to "${template.displayTitle}" - abandoning old session [slug: ${slug}]`);
      await abandonDocumentSession(req.user.id, slug);
      try {
        await redis.del(`pending_missing:${req.user.id}:${slug}`);
        await redis.del(`pending_missing:${req.user.id}:${slug}`);
        await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
      } catch (e) {  }
    }
    
    
    let session = await getOrCreateDocumentSession(req.user.id, template, slug);

    
    const extracted = await documentExtractor.extractFields(originalMessage, template.relPath, template.schema);

    const previewSnapshot = Object.entries(extracted?.data || {}).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'string'
        ? value.replace(/\s+/g, ' ').trim().slice(0, 120)
        : value;
      return acc;
    }, {});
    console.log('Document extraction preview', {
      userId: req.user?.id,
      template: template?.relPath,
      preview: previewSnapshot
    });

    
    const { session: updatedSession, newlyFilledFields, stillMissing, isComplete } = 
      await accumulateExtractedFields(req.user.id, extracted?.data || {});

    console.log(`📊 Session update:`, {
      userId: req.user.id,
      turn: updatedSession.turnCount,
      newlyFilled: newlyFilledFields.length,
      stillMissing: stillMissing.length,
      isComplete
    });

    
    await recordSessionTurn(
      req.user.id,
      originalMessage,
      '',
      extracted?.data || {},
      stillMissing
    );

    if (isComplete) {
      
      console.log(`✅ Session complete - all required fields filled. Generating document...`);
      
      const accumulatedData = await getSessionAccumulatedData(req.user.id);
      
      try {
        const generatedDoc = await generateDocumentInline(accumulatedData, template);
        await completeDocumentSession(req.user.id);
        
        try { await redis.del(`pending_missing:${req.user.id}:${slug}`); } catch(e) {  }
        
        return await replyWithDocument(res, generatedDoc, user, req, originalMessage);
      } catch (err) {
        if (err?.message === 'document_contains_placeholders') {
          const pf = detectMissingFromExtracted({ data: accumulatedData });
          return await replyWithText(res, `I noticed the generated document still contains placeholders (e.g., '...'). Could you please provide the missing details?`, user, req, { 
            mode: 'waiting_for_details', 
            missingFields: pf 
          });
        }
        throw err;
      }
    } else {
      
      const missingFieldObjs = updatedSession.missingFields.map(f => ({ 
        key: f.key, 
        label: f.label || f.key 
      }));
      
      console.log(`❌ Still missing fields:`, stillMissing);
      
      
      const preFilledValues = {};
      if (updatedSession.accumulatedData) {
        if (updatedSession.accumulatedData instanceof Map) {
          for (const [k, v] of updatedSession.accumulatedData.entries()) {
            preFilledValues[k] = v;
          }
        } else if (typeof updatedSession.accumulatedData === 'object') {
          Object.assign(preFilledValues, updatedSession.accumulatedData);
        }
      }
      const preFilledCount = Object.keys(preFilledValues).length;
      console.log(`✅ Pre-filled ${preFilledCount} fields from user message for form:`, Object.keys(preFilledValues));

      
      try {
        await redis.set(`pending_missing:${req.user.id}:${slug}`, JSON.stringify({
          type: 'missing_fields',
          template: template.relPath,
          missingFields: missingFieldObjs
        }), 'EX', 300);
      } catch (err) {
        console.warn('Failed to update pending state:', err?.message);
      }

      
      
      
      const lang = req?.preferredLanguage || 'en';
      let formOpenMsg;
      if (lang === 'hi') {
        formOpenMsg = preFilledCount > 0
          ? `📋 मैंने **${template.displayTitle}** के लिए फ़ॉर्म खोल दिया है। आपके संदेश से **${preFilledCount} विवरण** पहले से भरे गए हैं — शेष फ़ील्ड पूरे करें और दस्तावेज़ बनाएं।`
          : `📋 मैंने **${template.displayTitle}** के लिए फ़ॉर्म खोल दिया है। कृपया आवश्यक विवरण भरें।`;
      } else {
        formOpenMsg = preFilledCount > 0
          ? `📋 I've opened the **${template.displayTitle}** form for you. **${preFilledCount} field${preFilledCount !== 1 ? 's have' : ' has'} been pre-filled** from your message — review and complete the remaining details, then hit "Generate Document".`
          : `📋 I've opened the **${template.displayTitle}** form for you. Please fill in the required details to generate your document.`;
      }

      const draftFormInlineActions = lang === 'hi' ? [
        { type: 'draft_action', label: 'फ़ॉर्म भरना जारी रखें', icon: '📝', action: 'RESUME_FORM', description: 'फ़ॉर्म को फिर से खोलें' },
        { type: 'draft_action', label: 'ड्राफ्ट बंद करें', icon: '❌', action: 'CLOSE_DRAFT_FLOW', description: 'ड्राफ्ट प्रक्रिया बंद करें और रीसेट करें' },
        { type: 'draft_action', label: 'नया ड्राफ्ट', icon: '🔄', action: 'REGENERATE_DRAFT', description: 'इसे छोड़ें और नया ड्राफ्ट शुरू करें' },
        { type: 'draft_action', label: 'इस ड्राफ्ट के बारे में पूछें', icon: '💬', action: 'ASK_ABOUT_DRAFT', description: 'AI से इस दस्तावेज़ की जानकारी लें' },
      ] : [
        { type: 'draft_action', label: 'Resume Form filling', icon: '📝', action: 'RESUME_FORM', description: 'Reopen the form to continue filling' },
        { type: 'draft_action', label: 'Close draft flow', icon: '❌', action: 'CLOSE_DRAFT_FLOW', description: 'Exit the draft process and reset to main menu' },
        { type: 'draft_action', label: 'Regenerate new draft', icon: '🔄', action: 'REGENERATE_DRAFT', description: 'Discard this and start a fresh draft request' },
        { type: 'draft_action', label: 'Ask about this draft', icon: '💬', action: 'ASK_ABOUT_DRAFT', description: 'Get real-time AI assistance about this document' },
      ];

      return await replyWithText(res, formOpenMsg, user, req, {
        mode: 'draft_form_open',
        templatePath: template.relPath,
        templateTitle: template.displayTitle,
        missingFields: missingFieldObjs,
        preFilledValues,
        suggestedActions: draftFormInlineActions
      });
    }
  } catch (error) {
    console.error('Error proceeding with template:', error);
    throw error;
  }
}

async function proceedWithTemplateDirectly(template, originalMessage, res, user, req) {
  const lang = req?.preferredLanguage || 'en';
  const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
  
  try {
    console.log(`📋 Direct template processing (browser selection): ${template.displayTitle} [slug: ${slug}]`);
    
    
    await abandonDocumentSession(req.user.id, slug);
    try {
      await redis.del(`pending_missing:${req.user.id}:${slug}`);
      await redis.del(`pending_missing:${req.user.id}:${slug}`);
      await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
      await redis.del(`pending_template_confirm:${req.user.id}:${slug}`);
    } catch (e) {  }
    
    
    let session = await getOrCreateDocumentSession(req.user.id, template, slug);
    
    
    const missingFields = session.missingFields || [];
    
    if (missingFields.length === 0) {
      
      console.log('✅ No fields required, generating document directly');
      const accumulatedData = await getSessionAccumulatedData(req.user.id);
      const generatedDoc = await generateDocumentInline(accumulatedData || {}, template);
      await completeDocumentSession(req.user.id);
      return await replyWithDocument(res, generatedDoc, user, req, originalMessage);
    }
    
    
    const missingFieldObjs = missingFields.map(f => ({ 
      key: f.key, 
      label: f.label || f.key 
    }));
    
    
    try {
      await redis.set(`pending_missing:${req.user.id}:${slug}`, JSON.stringify({
        type: 'missing_fields',
        template: template.relPath,
        missingFields: missingFieldObjs
      }), 'EX', 300);
    } catch (err) {
      console.warn('Failed to update pending state:', err?.message);
    }
    
    
    const currentField = missingFieldObjs[0];
    const fieldLabel = currentField.label || currentField.key;
    const fieldDescriptions = {
      'complainant_name': 'your full name',
      'respondent_name': 'the name of the person or business you are drafting against',
      'place': 'the city/location where this document is being executed (e.g., "Patna")',
      'date': 'the date for this document (e.g., "22nd July 2026")',
      'signatory_name': 'the name of the person signing this document',
      'court_name': 'the name of the court (e.g., "District Court, Patna")',
      'sections_invoked': 'the legal sections to be invoked',
      'lease_rent': 'the monthly lease rent amount',
      'security_deposit': 'the security deposit amount',
      'lease_period': 'the duration of the lease (e.g., "11 months")',
      'property_address': 'the full address of the property',
      'buyer_name': 'the full name of the buyer',
      'seller_name': 'the full name of the seller',
      'purchase_amount': 'the total purchase amount'
    };
    const description = fieldDescriptions[currentField.key] || fieldLabel.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

    const formOpenMsg = lang === 'hi'
      ? `📋 आपने **${template.displayTitle}** टेम्पलेट चुना है। कृपया फ़ॉर्म में विवरण भरें या यहाँ चैट में जवाब दें।\n\nआइए पहले विवरण से शुरू करें। कृपया बताएं: **${description}**`
      : `📋 You've selected the **${template.displayTitle}** template. Please fill in the required details in the form, or answer in the chat.\n\nLet's start with the first detail. Please tell me: **${description}**`;

    const draftFormInlineActions = lang === 'hi' ? [
      { type: 'draft_action', label: 'फ़ॉर्म भरना जारी रखें', icon: '📝', action: 'RESUME_FORM', description: 'फ़ॉर्म को फिर से खोलें' },
      { type: 'draft_action', label: 'ड्राफ्ट बंद करें', icon: '❌', action: 'CLOSE_DRAFT_FLOW', description: 'ड्राफ्ट प्रक्रिया बंद करें और रीसेट करें' },
      { type: 'draft_action', label: 'नया ड्राफ्ट', icon: '🔄', action: 'REGENERATE_DRAFT', description: 'इसे छोड़ें और नया ड्राफ्ट शुरू करें' },
      { type: 'draft_action', label: 'इस ड्राफ्ट के बारे में पूछें', icon: '💬', action: 'ASK_ABOUT_DRAFT', description: 'AI से इस दस्तावेज़ की जानकारी लें' },
    ] : [
      { type: 'draft_action', label: 'Resume Form filling', icon: '📝', action: 'RESUME_FORM', description: 'Reopen the form to continue filling' },
      { type: 'draft_action', label: 'Close draft flow', icon: '❌', action: 'CLOSE_DRAFT_FLOW', description: 'Exit the draft process and reset to main menu' },
      { type: 'draft_action', label: 'Regenerate new draft', icon: '🔄', action: 'REGENERATE_DRAFT', description: 'Discard this and start a fresh draft request' },
      { type: 'draft_action', label: 'Ask about this draft', icon: '💬', action: 'ASK_ABOUT_DRAFT', description: 'Get real-time AI assistance about this document' },
    ];

    return await replyWithText(res, formOpenMsg, user, req, {
      mode: 'draft_form_open',
      templatePath: template.relPath,
      templateTitle: template.displayTitle,
      missingFields: missingFieldObjs,
      preFilledValues: {},
      suggestedActions: draftFormInlineActions,
      fromBrowser: true
    });
    
  } catch (error) {
    console.error('Error in direct template processing:', error);
    throw error;
  }
}

async function handleLegalInformation(message, query, res, user, req) {
  try {
    const lang = req?.preferredLanguage || 'en';
    
    
    const sections = (query && query.metadata && Array.isArray(query.metadata.sections)) ? query.metadata.sections : [];
    if (sections.length > 0) {
      const { bnsKnowledgeService } = await import('../services/bnsKnowledgeService.js');
      const bnsResponse = await bnsKnowledgeService.answerBNSQuery(message);
      
      if (bnsResponse.type !== 'no_results') {
        return await replyWithText(res, bnsResponse.response, user, req);
      }
    }

    
    

    
    const needsDocuments = await checkForDocumentOpportunity(message, query);
    let enhancedResponse = await generateEnhancedLegalResponse(message, req);
    
    
    if (needsDocuments.length > 0) {
      const docSuggestionText = lang === 'hi'
        ? `\n\nआपकी स्थिति के आधार पर, आपको इनकी भी आवश्यकता हो सकती है: ${needsDocuments.join(', ')}। क्या आप चाहते हैं कि मैं आपके लिए इनमें से कोई दस्तावेज़ तैयार करूं?`
        : `\n\nBased on your situation, you may also need: ${needsDocuments.join(', ')}. Would you like me to generate any of these documents for you?`;
      enhancedResponse += docSuggestionText;
    }
    
    
    const suggestedActions = await generateSmartSuggestions(message, enhancedResponse, lang);
    
    
    
    return await replyWithText(res, enhancedResponse, user, req, { 
      suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
      suggestedDocuments: needsDocuments.length > 0 ? needsDocuments : undefined 
    });

  } catch (error) {
    console.error('Legal information error:', error);
    const fallbackResponse = await generateEnhancedLegalResponse(message, req);
    return await replyWithText(res, fallbackResponse, user, req);
  }
}

async function handleDocumentModification(message, res, user, req, slug = 'default') {
  try {
    
    const recentDoc = await getRecentDocument(req.user.id, slug);
    
    if (!recentDoc) {
      const noDocMsg = req?.preferredLanguage === 'hi'
        ? "मेरे पास संशोधित करने के लिए कोई हालिया दस्तावेज़ नहीं है। क्या आप इसके बजाय एक नया दस्तावेज़ बनाना चाहेंगे?"
        : "I don't have a recent document to modify. Would you like to create a new document instead?";
      return await replyWithText(res, noDocMsg, user, req);
    }

    
    const modifiedDoc = await applyDocumentModification(message, recentDoc);
    return await replyWithDocument(res, modifiedDoc, user, req, message);

  } catch (error) {
    console.error('Document modification error:', error);
    if (error?.message === 'missing_field_placeholders') {
      const placeholderMsg = req?.preferredLanguage === 'hi'
        ? "मैंने देखा कि संशोधित दस्तावेज़ में कुछ प्लेसहोल्डर अभी भी हैं (जैसे '...','TBD')। कृपया मुझे बताएं कि आप कौन सी विशिष्ट जानकारी भरना चाहते हैं (नाम, तारीख, पते, आदि)।"
        : "I noticed some placeholders remain in the revised document (e.g. '...','TBD'). Please tell me the specific details you'd like filled in (names, dates, addresses, etc.).";
      return await replyWithText(res, placeholderMsg, user, req);
    }
    const modifyErrorMsg = req?.preferredLanguage === 'hi'
      ? "मैं अनुरोधित तरीके से दस्तावेज़ को संशोधित नहीं कर सका। कृपया अपना अनुरोध दूसरे तरीके से बताएं।"
      : "I couldn't modify the document as requested. Please try rephrasing your request.";
    return await replyWithText(res, modifyErrorMsg, user, req);
  }
}

async function generateDocumentInline(extractedData, template) {
  try {
    let documentText = renderTemplateText(template.template, extractedData);

    
    const hasInlinePlaceholders = /\.{5,}|_{5,}/.test(documentText);
    
    
    const fieldContext = Object.entries(extractedData || {})
      .filter(([k, v]) => v && String(v).trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    let enhancementPrompt;
    
    if (hasInlinePlaceholders && fieldContext) {
      
      enhancementPrompt =
        `You are a legal document formatter. Fill in ALL blank spaces (shown as dots .......... or underscores _____) with appropriate values based on the provided information.\n\n` +
        `COLLECTED INFORMATION:\n${fieldContext}\n\n` +
        `STRICT RULES:\n` +
        `1. DO NOT add any introduction like "Here is..." or "Below is..."\n` +
        `2. DO NOT add any commentary, notes, or explanations\n` +
        `3. DO NOT change the document title or add a new title\n` +
        `4. DO NOT add disclaimers or warnings\n` +
        `5. ONLY output the document text - nothing else\n` +
        `6. Start directly with the ORIGINAL document title (not a modified one)\n` +
        `7. Replace ALL ............ and _______ with actual values from the information provided\n` +
        `8. If a value is not available, leave a reasonable blank like ____________\n` +
        `9. Preserve the exact legal format and structure\n\n` +
        `DOCUMENT TO COMPLETE:\n\n` +
        documentText;
    } else {
      enhancementPrompt =
        `You are a legal document formatter. Your ONLY task is to ensure proper formatting of this legal document.\n\n` +
        `STRICT RULES:\n` +
        `1. DO NOT add any introduction like "Here is..." or "Below is..."\n` +
        `2. DO NOT add any commentary, notes, or explanations\n` +
        `3. DO NOT change the document title or add a new title\n` +
        `4. DO NOT add disclaimers or warnings\n` +
        `5. ONLY output the document text - nothing else\n` +
        `6. Start directly with the ORIGINAL document title\n` +
        `7. Preserve ALL information exactly as provided\n\n` +
        `DOCUMENT TO FORMAT:\n\n` +
        documentText;
    }

    const combinedPrompt =
      `${DRAFT_ENHANCEMENT_PROMPT}\n\n${enhancementPrompt}\n\nAssistant:`;

    const llmResponse = await callLocalLLM(combinedPrompt);

    if (llmResponse && llmResponse.trim()) {
      let cleanedResponse = llmResponse
        .replace(/\*\*/g, '')
        .replace(/^(Here is|Below is|I have|The following|I've)[^\n]*\n+/i, '')
        .replace(/^(Note:|Please note:|Disclaimer:|कृपया ध्यान दें)[^\n]*\n*/gim, '')
        .replace(/^(This document|यह दस्तावेज़)[^\n]*should not[^\n]*\n*/gim, '')
        .trim();
      documentText = cleanedResponse;
    }

    const placeholderPatterns = [
      /\b(tbd|n\/a|to be filled|to be updated|please specify|your name|owner of)\b/i,
      /_{3,}/,
      /\.{4,}/,
      /…{2,}/,
      /\(not provided\)|\(not specified\)|\(missing\)/i,
      /s\/o\s*:\s*\(|d\/o\s*:\s*\(|w\/o\s*:\s*\(|r\/o\s*:\s*\(/i,
      /\bno\.\s*…+/i,
      /\bof\s+20…+/i,
      /case\s*no\.?\s*…+/i,
      /\[\s*field_name\s*\]|\[\s*insert\s*\]/i,
      /\{\{\s*\w+\s*\}\}/,
    ];
    const hasPlaceholders = placeholderPatterns.some(pattern => pattern.test(documentText));
    if (hasPlaceholders) {
      const foundPlaceholders = [];
      if (/s\/o\s*:\s*\(/i.test(documentText)) foundPlaceholders.push("Father's/Son's Name (S/o)");
      if (/r\/o\s*:\s*\(/i.test(documentText)) foundPlaceholders.push("Address (R/o)");
      if (/p\.s\.?\s*:\s*\(/i.test(documentText)) foundPlaceholders.push("Police Station (P.S.)");
      if (/\(not provided\)/i.test(documentText)) foundPlaceholders.push("Various (Not Provided) fields");
      if (/…{2,}|\.{4,}|_{3,}/.test(documentText)) foundPlaceholders.push("Blank fields (dots/underscores)");
      logError('DOC003', { 
        template: template.relPath, 
        excerpt: documentText.slice(0, 200),
        foundPlaceholders 
      }, { context: 'document_contains_placeholders' });
      throw new Error('document_contains_placeholders');
    }

    const { filePath, fileSize } = await writeDocxFromText(
      documentText,
      getDisplayTitleForRelPath(template.relPath)
    );

    console.log(`writeDocxFromText saved file at: ${filePath}, size: ${fileSize} bytes`);
    const fileName = path.basename(filePath);

    return {
      text: documentText,
      downloadUrl: `/api/files/download/${fileName}`,
      fileName,
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: fileSize,
      displayTitle: getDisplayTitleForRelPath(template.relPath),
      extractedData,
      success: true
    };
  } catch (error) {
    console.error('Document generation error:', error);
    throw error;
  }
}


async function replyWithText(res, text, user, req, extraData = {}) {
  try {
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    
    try {
      const messageToSave = {
        role: 'assistant',
        content: text,
        timestamp: new Date()
      };
      
      
      if (extraData.suggestedActions) messageToSave.suggestedActions = extraData.suggestedActions;
      if (extraData.mode) messageToSave.mode = extraData.mode;
      if (extraData.file) messageToSave.file = extraData.file;
      if (extraData.missingFields) messageToSave.missingFields = extraData.missingFields;
      if (extraData.templatePath) messageToSave.templatePath = extraData.templatePath;
      if (extraData.templateTitle) messageToSave.templateTitle = extraData.templateTitle;
      
      await Chat.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(req.user.id), slug },
        { $push: { messages: messageToSave } },
        { upsert: true }
      );
    } catch (dbError) {
      logError('DB002', dbError, { context: 'save_message', userId: req.user.id });
      
    }

    
    let remainingMessages = null;
    const limit = await getMessageLimitForTier(user.subscriptionStatus);
    const isPremium = limit === -1;
    if (limit !== -1) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let mc = await MessageCount.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        date: today
      });
      if (!mc) {
        mc = new MessageCount({ userId: new mongoose.Types.ObjectId(req.user.id), date: today, count: 0 });
      }
      mc.count += 1;
      try {
        await mc.save();
        remainingMessages = Math.max(0, limit - mc.count);
      } catch (countError) {
        logError('DB003', countError, { context: 'update_message_count', userId: req.user.id });
        remainingMessages = Math.max(0, limit - mc.count);
      }
    }

    
    try { 
      await redis.del(`chat:${req.user.id}:${slug}`);
    } catch (cacheError) {
      logError('NET001', cacheError, { context: 'cache_clear', userId: req.user.id });
      
    }

    return res.json({
      response: text,
      remainingMessages: isPremium ? null : remainingMessages,
      subscriptionStatus: user.subscriptionStatus,
      ...extraData
    });
  } catch (error) {
    console.error('Reply with text error:', error);
    throw error;
  }
}

async function replyWithDocument(res, documentData, user, req, message, customMessage = null) {
  const lang = req?.preferredLanguage || 'en';
  const docTitle = documentData.displayTitle || (lang === 'hi' ? 'कानूनी दस्तावेज़' : 'legal document');
  
  const text = customMessage || (lang === 'hi'
    ? `मैंने आपका **${docTitle}** तैयार कर दिया है। आप नीचे इसे देख और डाउनलोड कर सकते हैं।`
    : `I've prepared your **${docTitle}**. You can review and download it below.`);
  
  
  const postDownloadActions = lang === 'hi' ? [
    { type: 'action', label: 'यही दस्तावेज़ फिर से बनाएं', icon: '🔄', action: 'REGENERATE_SAME', description: 'वही दस्तावेज़ नए डेटा के साथ बनाएं' },
    { type: 'action', label: 'दस्तावेज़ संपादित करें', icon: '✏️', action: 'EDIT_DOCUMENT', description: 'मौजूदा दस्तावेज़ को संपादित करें', documentContent: documentData.text },
    { type: 'action', label: 'बाहर निकलें', icon: '✖️', action: 'EXIT_DOCUMENT_MODE', description: 'दस्तावेज़ मोड से बाहर निकलें' }
  ] : [
    { type: 'action', label: 'Regenerate Same', icon: '🔄', action: 'REGENERATE_SAME', description: 'Generate the same document with new data' },
    { type: 'action', label: 'Edit Document', icon: '✏️', action: 'EDIT_DOCUMENT', description: 'Edit the current document', documentContent: documentData.text },
    { type: 'action', label: 'Exit', icon: '✖️', action: 'EXIT_DOCUMENT_MODE', description: 'Exit document mode' }
  ];
  
  console.log(`Replying with document to user ${req.user?.id || 'unknown'}:`, { fileUrl: documentData.downloadUrl, fileName: documentData.fileName, fileType: documentData.fileType, fileSize: documentData.fileSize });
  return await replyWithText(res, text, user, req, {
    mode: 'document_ready',
    
    file: {
      fileUrl: documentData.downloadUrl,
      fileName: documentData.fileName || 'document.txt',
      fileType: documentData.fileType || 'text/plain',
      fileSize: documentData.fileSize || 0
    },
    
    document: {
      preview:
        documentData.text.substring(0, 300) +
        (documentData.text.length > 300 ? '...' : ''),
      downloadUrl: documentData.downloadUrl,
      displayTitle: documentData.displayTitle,
      extractedData: documentData.extractedData,
      ready: true
    },
    
    suggestedActions: postDownloadActions
  });
}

async function handleMissingFields(res, missingFields, template, user, req, message, newlyFilledFields = []) {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  if (!missingFields || missingFields.length === 0) {
    return;
  }
  
  const currentField = missingFields[0];
  const fieldLabel = currentField.label || currentField.key;
  
  const fieldDescriptions = {
    'complainant_name': 'your full name',
    'respondent_name': 'the name of the person or business you are drafting against',
    'place': 'the city/location where this document is being executed (e.g., "Patna")',
    'date': 'the date for this document (e.g., "22nd July 2026")',
    'signatory_name': 'the name of the person signing this document',
    'court_name': 'the name of the court (e.g., "District Court, Patna")',
    'sections_invoked': 'the legal sections to be invoked',
    'lease_rent': 'the monthly lease rent amount',
    'security_deposit': 'the security deposit amount',
    'lease_period': 'the duration of the lease (e.g., "11 months")',
    'property_address': 'the full address of the property',
    'buyer_name': 'the full name of the buyer',
    'seller_name': 'the full name of the seller',
    'purchase_amount': 'the total purchase amount'
  };
  
  const description = fieldDescriptions[currentField.key] || fieldLabel.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
  
  const lang = req?.preferredLanguage || 'en';
  let prefix = "";
  if (newlyFilledFields && newlyFilledFields.length > 0) {
    prefix = lang === 'hi' ? 'गया! अगला प्रश्न: ' : 'Got that! Next: ';
  }
  
  const helpfulMessage = lang === 'hi'
    ? `${prefix}दस्तावेज़ **${template.displayTitle || template.relPath}** बनाने के लिए मुझे कुछ जानकारी चाहिए।\n\nकृपया बताएं: **${description}**`
    : `${prefix}To generate your **${template.displayTitle || template.relPath}**, please tell me: **${description}**`;

  console.log('Asking for single missing field:', {
    userId: req.user.id,
    field: currentField.key
  });

  try {
    const payload = {
      type: 'missing_fields',
      missingFields: missingFields.map(f => ({ key: f.key, label: f.label || f.key })),
      template: template.relPath || template
    };
    await redis.set(`pending_missing:${req.user.id}:${slug}`, JSON.stringify(payload), 'EX', 300);
  } catch (err) {
    console.warn('Failed to persist pending missing fields:', err?.message || err);
  }

  return await replyWithText(res, helpfulMessage, user, req, {
    mode: 'waiting_for_details',
    missingFields: missingFields.map(f => ({ key: f.key, label: f.label || f.key })),
    templatePath: template.relPath || template,
    templateTitle: template.displayTitle || template.relPath
  });
}

async function checkForDocumentOpportunity(message, classification) {
  try {
    const documentOpportunitiesPrompt = `Analyze this legal query and determine if the user might need legal documents after getting the legal advice. Respond with "Yes" and document types if applicable, "No" if not.

Query: "${message}"

Document triggers:
- Property disputes → Sale Deed, Legal Notice
- Family issues → Adoption Deed, Will, Affidavit  
- Contract problems → Agreement, Legal Notice
- Adoption matters → Adoption Deed, Affidavit
- Property buying/selling → Sale Deed, Agreement

Respond: "Yes: [Document Types]" or "No"`;

    const response = await generateEnhancedLegalResponse(documentOpportunitiesPrompt);
    
    if (response.toLowerCase().includes('yes:')) {
      const documentTypes = response.split(':')[1]?.split(',')
        .map(type => type.trim())
        .filter(type => type.length > 0 && type.length < 30);
      return documentTypes || [];
    }
    
    return [];
  } catch (error) {
    console.error('Document opportunity check error:', error);
    return [];
  }
}

async function generateDocumentSuggestion(message, chatContext) {
  try {
    
    const validDocumentTypes = [
      'Sale Deed', 'Lease Deed', 'Rental Agreement', 'Property Agreement',
      'Will', 'Adoption Deed', 'Gift Deed', 'Power of Attorney',
      'Legal Notice', 'Affidavit', 'Undertaking',
      'Agreement', 'Contract', 'Promissory Note', 'Cheque Bounce Notice',
      'Arbitration Agreement', 'Separation Deed', 'Divorce Deed',
      'Employment Agreement', 'Service Agreement', 'Non-Disclosure Agreement',
      'Bond', 'Indemnity Bond', 'Security Deposit Receipt',
      'Complaint', 'FIR', 'Petition', 'Appeal'
    ];

    const suggestionPrompt = `Analyze this conversation and suggest relevant Indian legal documents that might be needed. Only respond with document types if clearly applicable, otherwise respond "None needed".

Conversation: "${chatContext}"

Common document triggers:
- Property transactions → Sale Deed, Lease Deed
- Family matters → Adoption Deed, Will  
- Disputes → Legal Notice, Affidavit
- Legal proceedings → Power of Attorney, Agreement

Respond only with comma-separated document types or "None needed".`;

    const response = await generateEnhancedLegalResponse(suggestionPrompt);
    
    
    if (response.toLowerCase().includes('none needed')) {
      return [];
    }
    
    
    const documentTypes = response.split(',')
      .map(type => type.trim())
      .filter(type => {
        
        if (!type || type.length === 0 || type.length > 50) return false;
        if (type.includes('_') || type.includes('?')) return false;
        if (type.toLowerCase().includes('respond') || type.toLowerCase().includes('conversation')) return false;
        
        
        const matches = validDocumentTypes.some(vdt => 
          vdt.toLowerCase() === type.toLowerCase() || 
          type.toLowerCase().includes(vdt.toLowerCase())
        );
        return matches;
      });
    
    return documentTypes;
  } catch (error) {
    console.error('Document suggestion error:', error);
    return [];
  }
}

async function generateEnhancedLegalResponse(message, req = null) {
  try {
    const lang = req?.preferredLanguage || 'en';
    const langInstruction = getLanguageInstruction(lang);
    
    const enhancedSystemPrompt = `You are an expert AI legal assistant specializing in Indian law, adopting the persona of a highly experienced Senior Advocate who has also served as a Magistrate.

TONE & APPROACHABILITY:
- Keep your tone warm, friendly, approachable, relaxed, and professional.
- For greetings, casual remarks, or general questions, respond directly in a friendly and helpful manner without asking if the user is a lawyer vs non-lawyer.
- If the query is in plain language, explain in simple, accessible terms. If the query uses technical legal terms, respond with appropriate technical detail.
- Do NOT interrogate the user or demand clarification about their profession. Answer general questions clearly.

RESPONSE STRUCTURE (DO NOT USE THESE LABELS IN OUTPUT - just follow the structure naturally):
1. Start with a brief empathetic acknowledgment (1 sentence, no label).
2. State the most direct and actionable remedies under Indian law (3-4 sentences).
3. Cite 1-2 relevant statutory provisions or case laws to support your advice.

IMPORTANT: Do NOT prefix your response with labels like "Empathetic Note:", "Remedies First:", "Supporting Authority:", etc. Write naturally flowing paragraphs.

DOCUMENT GENERATION INTEGRATION:
Intelligently assess if the user needs legal documents and proactively offer generation:
- If the user describes a situation requiring a legal document (adoption, sale, lease, notice), immediately offer: "Based on your situation, you may need a [Document Type]. Would you like me to generate this document for you with the details you've provided?"
- Common triggers: property transactions, adoption processes, legal notices, affidavits, agreements, leases, wills, power of attorney
- Generate professional Indian legal documents using current laws when requested

ESCALATION PROTOCOL:
- First chat: Focus on providing guidance, never suggest human lawyer.
- Next 5–6 exchanges: If serious legal matters (FIR, bail, property disputes, court filings), gently mention: "For complex legal proceedings, professional representation may be beneficial."
- Only after continued conversation OR explicit requests for filing/representation: "Would you like me to connect you with a suitable specialist and book an offline appointment?"

GUIDELINES:
- Keep responses under 200 words for efficiency
- Be authoritative, practical, and solution-oriented
- Adjust tone automatically: plain for laypersons, technical for lawyers
- Avoid Markdown formatting; use clean paragraphs
- Always maintain professional empathy while being direct${langInstruction}`;
	
    let researchContext = "";
    const activeFileId = req?.body?.fileId;
    if (activeFileId && mongoose.Types.ObjectId.isValid(activeFileId) && req?.user?.id) {
      const session = await ResearchSession.findOne({ 
        userId: new mongoose.Types.ObjectId(req.user.id), 
        fileIds: new mongoose.Types.ObjectId(activeFileId),
        status: 'completed'
      }).lean();
      
      if (session) {
        const contextStr = session.agent1Data?.context || "";
        const summaryStr = session.agent3Summary?.summary || session.agent3Summary || "";
        const keyPointsStr = session.agent1Data?.keyPoints || "";
        
        researchContext = `
[ACTIVE FILE RESEARCH CONTEXT - ALWAYS ANSWER IN CONTEXT OF THIS FILE AND ITS RESEARCH IF USER ASKS RELATED TO THIS FILE]
File Name: ${session.agent1Data?.fileName || 'Uploaded Legal Document'}
Document Summary: ${typeof summaryStr === 'string' ? summaryStr : JSON.stringify(summaryStr)}
Key Points: ${typeof keyPointsStr === 'string' ? keyPointsStr : JSON.stringify(keyPointsStr)}
Detailed Context: ${typeof contextStr === 'string' ? contextStr : JSON.stringify(contextStr)}
`;
      }
    }

    if (!researchContext && req?.user?.id) {
      const session = await ResearchSession.findOne({ 
        userId: new mongoose.Types.ObjectId(req.user.id), 
        status: 'completed'
      })
      .sort({ updatedAt: -1 })
      .lean();
      
      if (session) {
        const contextStr = session.agent1Data?.context || "";
        const summaryStr = session.agent3Summary?.summary || session.agent3Summary || "";
        const keyPointsStr = session.agent1Data?.keyPoints || "";
        
        researchContext = `
[ACTIVE FILE RESEARCH CONTEXT - ALWAYS ANSWER IN CONTEXT OF THIS FILE AND ITS RESEARCH IF USER ASKS RELATED TO THIS FILE]
Document Summary: ${typeof summaryStr === 'string' ? summaryStr : JSON.stringify(summaryStr)}
Key Points: ${typeof keyPointsStr === 'string' ? keyPointsStr : JSON.stringify(keyPointsStr)}
Detailed Context: ${typeof contextStr === 'string' ? contextStr : JSON.stringify(contextStr)}
`;
      }
    }

    const chatHistory = [];
    if (req?.user?.id) {
      const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
      const historyObj = await getUserChatHistory(req.user.id, slug);
      if (historyObj && Array.isArray(historyObj.messages)) {
        chatHistory.push(...historyObj.messages.slice(-8));
      }
    }

    let historyContext = "";
    if (chatHistory.length > 0) {
      historyContext = "\n[CONVERSATION HISTORY]\n" + chatHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + "\n";
    }

    const combinedPrompt = `${enhancedSystemPrompt}\n${researchContext}${historyContext}\nUser: ${message}\nAssistant:`;

    const llmResponse = await callLocalLLM(combinedPrompt);

    return llmResponse || (lang === 'hi' ? 'क्षमा करें, अभी जवाब देने में असमर्थ हूँ। कृपया पुनः प्रयास करें।' : 'Local AI did not return a response.');

	
  } catch (error) {
    console.error('Enhanced legal response error:', error);
    if (error?.response?.status === 429) {
      logError('AI002', error, { context: 'rate_limit_exceeded', endpoint: 'legal_response' });
      return 'AI service is experiencing high demand. Please wait a moment and try again.';
    } else if (error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT' || error?.code === 'ECONNREFUSED') {
      logError('AI001', error, { context: 'service_unavailable', endpoint: 'legal_response' });
      return 'Our AI service is temporarily unavailable. Please try again in a few moments.';
    } else if (error?.response?.status >= 500) {
      logError('AI001', error, { context: 'service_error', endpoint: 'legal_response' });
      return 'AI service is currently experiencing issues. Please try again later.';
    } else {
      logError('SYS001', error, { context: 'unexpected_error', endpoint: 'legal_response' });
      return 'I apologize, but I encountered an error processing your legal query. Please try rephrasing your question.';
    }
  }
}

async function getUserChatHistory(userId, slug = 'default') {
  try {
    const cacheKey = `chat:${userId}:${slug}`;
    let cached = null;
    
    try {
      cached = await redis.get(cacheKey);
    } catch (e) {
      console.warn('Redis get failed for chat history:', e?.message || e);
    }
    
    if (cached) {
      return { messages: JSON.parse(cached) };
    }

    const chat = await Chat.findOne({ userId, slug })
      .select('messages')
      .lean();
      
    const messages = chat?.messages || [];
    
    try {
      await redis.set(cacheKey, JSON.stringify(messages), 'EX', 120);
    } catch (e) {
      console.warn('Redis set failed for chat history cache:', e?.message || e);
    }
    
    return { messages };
  } catch (error) {
    console.error('Get chat history error:', error);
    return { messages: [] };
  }
}

async function getRecentDocument(userId, slug = 'default') {
  try {
    const chat = await Chat.findOne({ userId, slug }).select('messages').lean();
    const messages = chat?.messages || [];
    
    
    for (let i = messages.length - 1; i >= Math.max(0, messages.length - 10); i--) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.mode === 'document_ready') {
        return msg.document || null;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Get recent document error:', error);
    return null;
  }
}

async function applyDocumentModification(message, documentData) {
  try {
    const revisionPrompt =
      `Apply these modifications to the legal document.\n\n` +
      `Modifications: ${message}\n\n` +
      `Current document:\n${documentData.text}`;

    
    

    
    const combinedPrompt =
      `${DRAFT_ENHANCEMENT_PROMPT}\n\n${revisionPrompt}\n\nReturn only the revised document text.`;

    const revisedText = await callLocalLLM(combinedPrompt);

    if (!revisedText || !revisedText.trim()) {
      throw new Error('Empty revision from local model');
    }

    
    if (/\b(tbd|n\/a|to be filled|to be updated|please specify|your name|owner of|__+|\.\.\.)\b/i.test(revisedText) || revisedText.match(/_{3,}/) || revisedText.match(/\.{3,}/)) {
      const err = new Error('missing_field_placeholders');
      err.details = { message: 'Revision contains placeholders. Request user to provide missing details.' };
      throw err;
    }

    const { filePath, fileSize } = await writeDocxFromText(
      revisedText,
      documentData.displayTitle
    );

    const fileName = filePath.split('/').pop();

    return {
      ...documentData,
      text: revisedText.replace(/\*\*/g, ''),
      downloadUrl: `/api/files/download/${fileName}`,
      fileSize: fileSize,
      modified: true
    };
  } catch (error) {
    console.error('Document modification error:', error);
    throw error;
  }
}





async function handleStreamingResponse(req, res, { geminiModel, systemPrompt, conversationHistory, user, message, genConfig }) {
  
  if (res && typeof res.writeHead === 'function') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });
  }

  const sendSSE = (data) => {
    if (res && typeof res.write === 'function') {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  try {
    
    sendSSE({ type: 'start', message: 'Starting response...' });

    
const SAFETY_RULES = `
You must NOT generate content involving:
- violence, murder instructions, or self-harm
- sexual or explicit material
- hate speech or harassment
- illegal activities

If a request is unsafe, politely refuse and provide legal information only.
`;

const prompt =
  `${SAFETY_RULES}\n\n` +
  `${systemPrompt}\n\n` +
  conversationHistory.map(m => `${m.role}: ${m.content}`).join('\n') +
  `\nUser: ${message}\nAssistant:`;

const response = await axios.post(
  'http://localhost:11434/api/generate',
  {
    model: 'llama3.1:8b',
    prompt,
    stream: true
  },
  {
    responseType: 'stream',
    timeout: 0
  }
);

let fullResponse = '';

response.data.on('data', (chunk) => {
  const lines = chunk.toString().split('\n').filter(Boolean);

  for (const line of lines) {
    try {
      const data = JSON.parse(line);

      if (data.response) {
        fullResponse += data.response;
        sendSSE({ type: 'chunk', text: data.response });
      }

      if (data.done) {
        sendSSE({ type: 'complete' });
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } catch {}
  }
});

response.data.on('error', (error) => {
  logError('NET002', error, { context: 'ollama_stream_error', userId: req.user.id });
  sendSSE({
    type: 'error',
    message: 'Local AI streaming failed. Please try again.'
  });
  res.end();
});



  } catch (error) {
    console.error('handleStreamingResponse error', { message: error?.message, stack: error?.stack });
    logError('AI003', error, { context: 'stream_response_error', userId: req.user.id });
    
    if (res && res.headersSent) {
      sendSSE({ 
        type: 'error', 
        message: 'I encountered an error while processing your document request. Please try again.',
        errorCode: 'AI003'
      });
      if (res && typeof res.end === 'function') {
        res.end();
      }
    } else {
      const errorResponse = generateErrorResponse('AI003');
      if (res && typeof res.status === 'function') {
        res.status(errorResponse.error.httpStatus).json(errorResponse);
      }
    }
  }
}

export const sendMessage = async (req, res) => {
  try {
    const { message, language, templatePath, guidanceContext, sourceAction, documentType, fileId, intentOverride } = req.body;
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    
    
    
    req.preferredLanguage = language === 'hi' ? 'hi' : 'en';
    
    
    if (guidanceContext) {
      console.log('🧭 Guidance context received:', guidanceContext);
    }
    if (sourceAction) {
      console.log('🎯 Source action:', sourceAction);
    }
    if (documentType) {
      console.log('📄 Document type hint:', documentType);
    }
    
    
    if (templatePath && typeof templatePath === 'string') {
      console.log('📋 User selected template from browser:', templatePath);
      const templates = await loadTemplates();
      
      
      const normalizedInputPath = templatePath.replace(/\\/g, '/').toLowerCase().trim();
      console.log('🔍 Normalized input path:', normalizedInputPath);
      
      
      const template = templates.find(t => {
        const tPath = (t.relPath || '').replace(/\\/g, '/').toLowerCase().trim();
        const matches = tPath === normalizedInputPath;
        if (matches) {
          console.log('✅ Template matched:', t.displayTitle, 'path:', tPath);
        }
        return matches;
      });
      
      if (template) {
        console.log('✅ Found template from browser selection:', template.displayTitle);
        const user = await User.findById(new mongoose.Types.ObjectId(req.user.id))
          .select('isActive subscriptionStatus remainingMessages')
          .lean();
        
        
        
        return await proceedWithTemplateDirectly(template, message, res, user, req);
      } else {
        console.warn('⚠️ Template not found for path:', templatePath);
        console.log('Available templates:', templates.slice(0, 5).map(t => t.relPath));
      }
    }
    
    
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      logError('VAL001', { message, userId: req.user.id }, { validation: 'message_empty' });
      const errorResponse = generateErrorResponse('VAL001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    }

    if (message.length > 10000) {
      logError('VAL001', { messageLength: message.length }, { validation: 'message_too_long' });
      const errorResponse = generateErrorResponse('VAL001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    }

    if (!mongoose.Types.ObjectId.isValid(req.user.id)) {
      logError('VAL002', { userId: req.user.id }, { validation: 'invalid_user_id' });
      const errorResponse = generateErrorResponse('VAL002');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    }

    
    const user = await User.findById(new mongoose.Types.ObjectId(req.user.id))
      .select('isActive subscriptionStatus remainingMessages')
      .lean();
    if (!user) {
      logError('AUTH001', { userId: req.user.id }, { context: 'user_lookup' });
      const errorResponse = generateErrorResponse('AUTH001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    }

    if (!user.isActive) {
      logError('AUTH002', { userId: req.user.id, subscriptionStatus: user.subscriptionStatus }, { context: 'account_check' });
      const errorResponse = generateErrorResponse('AUTH002');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    }
          const isStreaming = req.path === '/stream';

    
    const limit = await getMessageLimitForTier(user.subscriptionStatus);
    if (limit !== -1) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let messageCount = await MessageCount.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        date: today
      });
      if (!messageCount) {
        messageCount = new MessageCount({
          userId: new mongoose.Types.ObjectId(req.user.id),
          date: today,
          count: 0
        });
      }
      if (messageCount.count >= limit) {
        logError('AUTH003', { userId: req.user.id, messageCount: messageCount.count }, { context: 'daily_limit_check' });
        const errorResponse = generateErrorResponse('AUTH003');
        return res.status(errorResponse.error.httpStatus).json(errorResponse);
      }
    }

    
    
    
    
    try {
      const chatExists = await Chat.findOne({ userId: req.user.id, slug }).select('_id messages').lean();
      const isNewChat = !chatExists || !chatExists.messages || chatExists.messages.length === 0;

      await Chat.findOneAndUpdate(
        { userId: new mongoose.Types.ObjectId(req.user.id), slug },
        { $push: { messages: { role: 'user', content: message, hidden: req.body.hidden || req.body.isHidden || false } } },
        { upsert: true }
      );
      
      if (isNewChat) {
        generateAndSaveChatTitle(req.user.id, slug, message).catch(err => {
          console.error('Failed to trigger title generation:', err.message);
        });
      }
      
      await redis.del(`chat:${req.user.id}:${slug}`);
    } catch (saveError) {
      logError('DB002', saveError, { context: 'immediate_user_message_save', userId: req.user.id });
      
    }

    
    
    
    
    try {
      
      const pendingTemplateChoiceRaw = await redis.get(`pending_template_choice:${req.user.id}:${slug}`);
      if (pendingTemplateChoiceRaw) {
        try {
          const pendingChoice = JSON.parse(pendingTemplateChoiceRaw);
          const low = message.trim().toLowerCase();
          const isTemplateChoice = low === '1' || low.includes('template') || low.includes('use this');
          const isCustomChoice = low === '2' || low.includes('custom') || low.includes('generate');
          
          if (isTemplateChoice || isCustomChoice) {
            console.log('📋 Template choice consumed');
            await redis.del(`pending_template_choice:${req.user.id}:${slug}`);
            
            if (isTemplateChoice) {
              
              return await handleDocumentRequest(pendingChoice.context || message, res, user, req, {}, null, null, null);
            } else {
              
              return await generateFreeFormDocument(pendingChoice.context, '', res, user, req, null);
            }
          }
        } catch (parseErr) {
          console.warn('Template choice parse failed:', parseErr?.message);
        }
      }
      
      
      const pendingTemplateConfirmRaw = await redis.get(`pending_template_confirm:${req.user.id}:${slug}`);
      if (pendingTemplateConfirmRaw) {
        try {
          const pendingConfirm = JSON.parse(pendingTemplateConfirmRaw);
          const low = message.trim().toLowerCase();
          
          
          const wantsTemplate = low === '1' || low === 'one' || 
            low.includes('use this template') || low.includes('use template') ||
            low.includes('option 1') || low.includes('first option') ||
            (low === 'yes' && !low.includes('wrong'));
          
          
          const wantsAI = low === '2' || low === 'two' ||
            low.includes('ai') || low.includes('generate') ||
            low.includes('custom') || low.includes('option 2') ||
            low.includes('second option') || low.includes('wrong') ||
            low.includes('not right') || low.includes('incorrect') ||
            low.includes('no') || low.includes('different');
          
          if (wantsTemplate || wantsAI) {
            console.log(`📋 Template confirmation: ${wantsTemplate ? 'USE TEMPLATE' : 'USE AI'}`);
            await redis.del(`pending_template_confirm:${req.user.id}:${slug}`);
            
            if (wantsTemplate) {
              
              const templates = await loadTemplates();
              const template = templates.find(t => t.relPath === pendingConfirm.template.relPath) || pendingConfirm.template;
              console.log(`✅ User confirmed template: ${template.displayTitle}`);
              return await proceedWithTemplate(template, pendingConfirm.originalRequest, res, user, req, null);
            } else {
              
              console.log(`🤖 User chose AI generation over template: ${pendingConfirm.template.displayTitle}`);
              return await generateFreeFormDocument(pendingConfirm.originalRequest, pendingConfirm.context, res, user, req);
            }
          }
          
          
          const lang = req?.preferredLanguage || 'en';
          const unclearMsg = lang === 'hi'
            ? `कृपया नीचे दिए गए विकल्पों में से चुनें:`
            : `Please choose from the options below:`;
          
          const suggestedActions = lang === 'hi'
            ? [
                { type: 'template_choice', label: `✅ ${pendingConfirm.template.displayTitle} उपयोग करें`, icon: '✅', action: 'USE_TEMPLATE', description: 'इस टेम्पलेट का उपयोग करें' },
                { type: 'template_choice', label: '🤖 AI से बनाएं', icon: '🤖', action: 'USE_AI_GENERATE', description: 'AI से कस्टम दस्तावेज़ बनाएं' }
              ]
            : [
                { type: 'template_choice', label: `✅ Use ${pendingConfirm.template.displayTitle}`, icon: '✅', action: 'USE_TEMPLATE', description: 'Use this template' },
                { type: 'template_choice', label: '🤖 AI Generate', icon: '🤖', action: 'USE_AI_GENERATE', description: 'Generate custom document with AI' }
              ];
          
          return await replyWithText(res, unclearMsg, user, req, { suggestedActions });
        } catch (parseErr) {
          console.warn('Template confirmation parse failed:', parseErr?.message);
        }
      }
      
      
      const pendingFreeformRaw = await redis.get(`pending_freeform:${req.user.id}:${slug}`);
      if (pendingFreeformRaw) {
        try {
          const pendingFreeform = JSON.parse(pendingFreeformRaw);
          const low = message.trim().toLowerCase();
          const isCustomChoice = low === '1' || low.includes('custom') || low.includes('generate');
          const isBrowseChoice = low === '2' || low.includes('browse') || low.includes('template');
          
          if (isCustomChoice || isBrowseChoice) {
            console.log('📋 Freeform choice consumed');
            await redis.del(`pending_freeform:${req.user.id}:${slug}`);
            
            if (isCustomChoice) {
              return await generateFreeFormDocument(pendingFreeform.context, pendingFreeform.fullContext || '', res, user, req);
            } else {
              
              return await showTemplateCategories(res, user, req, message);
            }
          }
        } catch (parseErr) {
          console.warn('Freeform choice parse failed:', parseErr?.message);
        }
      }
      
      
      const pendingSubtypeRaw = await redis.get(`pending_subtype:${req.user.id}:${slug}`);
      if (pendingSubtypeRaw) {
        try {
          const pendingSubtype = JSON.parse(pendingSubtypeRaw);
          const selectedSubtype = message.trim();
          
          
          if (pendingSubtype.subtypes.includes(selectedSubtype)) {
            console.log(`📋 Subtype selected: ${selectedSubtype} for ${pendingSubtype.documentType}`);
            await redis.del(`pending_subtype:${req.user.id}:${slug}`);
            
            
            const schema = getSubtypeSchema(pendingSubtype.documentType, selectedSubtype);
            if (schema) {
              const analysis = {
                documentType: `${pendingSubtype.documentType} - ${selectedSubtype}`,
                documentTitle: schema.displayName,
                description: schema.description,
                requiredFields: schema.fields,
                extractedFromRequest: {}
              };
              
              
              return await initiateFieldCollection(analysis, pendingSubtype.originalRequest, res, user, req);
            }
          }
        } catch (parseErr) {
          console.warn('Subtype selection parse failed:', parseErr?.message);
        }
      }
      
      
      const pendingAIDocRaw = await redis.get(`pending_ai_document:${req.user.id}:${slug}`);
      if (pendingAIDocRaw) {
        try {
          const pendingAIDoc = JSON.parse(pendingAIDocRaw);
          
          
          if (pendingAIDoc.awaitingLanguageChoice) {
            console.log('📋 Processing AI document language choice');
            const result = await handleAIDocumentLanguageChoice(message, res, user, req);
            if (result) return result;
          }
          
          else if (pendingAIDoc.collectingFields) {
            console.log('📋 Processing AI document field input');
            const result = await handleAIDocumentFields(message, res, user, req);
            if (result) return result;
          } else {
            
            console.log('📋 Processing AI document choice (filled vs raw)');
            const result = await handleAIDocumentChoice(message, res, user, req);
            if (result) return result;
          }
        } catch (parseErr) {
          console.warn('Pending AI document parse failed:', parseErr?.message);
        }
      }
      
      
      const pendingConfRaw = await redis.get(`pending_confirmation:${req.user.id}:${slug}`);
      if (pendingConfRaw) {
        try {
          const pendingConf = JSON.parse(pendingConfRaw);
          if (pendingConf && pendingConf.type === 'document_confirmation') {
            const low = message.trim().toLowerCase();
            
            const isCreate = /\b(create|generate|start|1|now|yes|haan|ha|banao|shuru|बनाओ|हाँ|शुरू)\b/i.test(message);
            
            const isGuide = /\b(guide|suggest|2|help|madad|batao|मदद|बताओ|गाइड)\b/i.test(message);
            
            const stillHesitant = /\b(not sure|unsure|don'?t know|mujhe ni|nahi pata|pata nahi|मुझे नहीं|नहीं पता|पता नहीं|confused|what should)\b/i.test(message);
            
            if (isCreate || isGuide) {
              console.log('📋 Pending confirmation consumed');
              await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
              
              if (isCreate) {
                return await handleDocumentRequest(pendingConf.originalMessage || message, res, user, req, pendingConf.classification || {}, null, null, null);
              } else {
                return await handleLegalInformation(pendingConf.originalMessage || message, pendingConf.classification || { metadata: {} }, res, user, req);
              }
            } else if (stillHesitant) {
              
              const lang = req?.preferredLanguage || 'en';
              const helpMsg = lang === 'hi'
                ? `कोई बात नहीं! आप नीचे दिए गए विकल्पों में से चुन सकते हैं:`
                : `No problem! You can choose from the options below:`;
              
              const suggestedActions = lang === 'hi'
                ? [
                    { 
                      type: 'doc_choice', 
                      label: '📝 दस्तावेज़ बनाएं', 
                      icon: '📝', 
                      action: 'CREATE_DOCUMENT', 
                      description: 'गाइडेड प्रक्रिया से दस्तावेज़ का प्रकार चुनें और बनाना शुरू करें' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '🧭 मुझे गाइड करें', 
                      icon: '🧭', 
                      action: 'GUIDE_ME', 
                      description: 'अपनी स्थिति बताएं और मैं आपको सही दस्तावेज़ खोजने में मदद करूंगा' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '📚 टेम्पलेट ब्राउज़ करें', 
                      icon: '📚', 
                      action: 'BROWSE_TEMPLATES', 
                      description: 'सभी उपलब्ध दस्तावेज़ टेम्पलेट देखें और सर्च करें' 
                    }
                  ]
                : [
                    { 
                      type: 'doc_choice', 
                      label: '📝 Create Document', 
                      icon: '📝', 
                      action: 'CREATE_DOCUMENT', 
                      description: 'Follow a guided process to select and create your document' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '🧭 Guide Me', 
                      icon: '🧭', 
                      action: 'GUIDE_ME', 
                      description: 'Tell me your situation and I\'ll help you find the right document' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '📚 Browse Templates', 
                      icon: '📚', 
                      action: 'BROWSE_TEMPLATES', 
                      description: 'View and search all available document templates' 
                    }
                  ];
              
              return await replyWithText(res, helpMsg, user, req, { suggestedActions });
            } else {
              
              const lang = req?.preferredLanguage || 'en';
              const unclearMsg = lang === 'hi'
                ? `कृपया नीचे दिए गए विकल्पों में से चुनें:`
                : `Please choose from the options below:`;
              
              const suggestedActions = lang === 'hi'
                ? [
                    { 
                      type: 'doc_choice', 
                      label: '📝 दस्तावेज़ बनाएं', 
                      icon: '📝', 
                      action: 'CREATE_DOCUMENT', 
                      description: 'गाइडेड प्रक्रिया से दस्तावेज़ का प्रकार चुनें और बनाना शुरू करें' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '🧭 मुझे गाइड करें', 
                      icon: '🧭', 
                      action: 'GUIDE_ME', 
                      description: 'अपनी स्थिति बताएं और मैं आपको सही दस्तावेज़ खोजने में मदद करूंगा' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '📚 टेम्पलेट ब्राउज़ करें', 
                      icon: '📚', 
                      action: 'BROWSE_TEMPLATES', 
                      description: 'सभी उपलब्ध दस्तावेज़ टेम्पलेट देखें और सर्च करें' 
                    }
                  ]
                : [
                    { 
                      type: 'doc_choice', 
                      label: '📝 Create Document', 
                      icon: '📝', 
                      action: 'CREATE_DOCUMENT', 
                      description: 'Follow a guided process to select and create your document' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '🧭 Guide Me', 
                      icon: '🧭', 
                      action: 'GUIDE_ME', 
                      description: 'Tell me your situation and I\'ll help you find the right document' 
                    },
                    { 
                      type: 'doc_choice', 
                      label: '📚 Browse Templates', 
                      icon: '📚', 
                      action: 'BROWSE_TEMPLATES', 
                      description: 'View and search all available document templates' 
                    }
                  ];
              
              return await replyWithText(res, unclearMsg, user, req, { suggestedActions });
            }
          }
        } catch (parseErr) {
          console.warn('Pending confirmation parse failed:', parseErr?.message);
        }
      }

      
      const pendingMissingRaw = await redis.get(`pending_missing:${req.user.id}:${slug}`) || await redis.get(`pending_missing:${req.user.id}:${slug}`);
      if (pendingMissingRaw) {
        try {
          const pendingMissing = JSON.parse(pendingMissingRaw);
          if (pendingMissing && pendingMissing.type === 'missing_fields') {
            console.log(`📋 Processing missing-fields reply for slug: ${slug}`);
            return await handleMissingFieldsReply(message, req, res, user, slug);
          }
        } catch (parseErr) {
          console.warn('Pending missing parse failed:', parseErr?.message);
        }
      }
      
      
      const activeDocSession = await DocumentSession.findOne({ userId: req.user.id, slug, status: 'active' });
      if (activeDocSession && activeDocSession.missingFields && activeDocSession.missingFields.length > 0) {
        console.log(`📋 Active document session found for slug ${slug} with missing fields - routing to handleMissingFieldsReply`);
        return await handleMissingFieldsReply(message, req, res, user, slug);
      }
    } catch (stateErr) {
      console.error('State check failed:', stateErr);
      const lang = req?.preferredLanguage || 'en';
      const errMsg = lang === 'hi' 
        ? "क्षमा करें, दस्तावेज़ बनाते समय एक त्रुटि हुई। कृपया फिर से प्रयास करें या नया चैट शुरू करें।" 
        : "Sorry, an error occurred while processing your document. Please try again or start a new chat.";
      return await replyWithText(res, errMsg, user, req);
    }    
    const recentHistory = await conversationService.getConversationHistory(req.user.id, 5);
    const contextText = conversationService.formatContextFromHistory(recentHistory);

    
    let classification;
    
    
    if (intentOverride === 'QUICK_SCAN_FILE') {
      console.log(`🔍 QUICK_SCAN_FILE action triggered for fileId: ${fileId}`);
      const lang = req?.preferredLanguage || 'en';
      let fileDoc = null;
      if (fileId) {
        try {
          const FileModel = (await import('../models/File.js')).default;
          fileDoc = await FileModel.findById(fileId).lean();
        } catch (e) {
          console.warn('Failed to load file for quick scan:', e?.message);
        }
      }

      const fileName = fileDoc?.originalName || fileDoc?.fileName || 'Uploaded Document';
      const fileText = fileDoc?.text || fileDoc?.extractedText || '';
      
      let docCategory = 'Legal Document';
      if (/bail|custody|fir|accused|police|crime/i.test(fileName + ' ' + fileText)) docCategory = 'Bail Petition / Criminal Pleadings';
      else if (/sale|deed|property|conveyance|land/i.test(fileName + ' ' + fileText)) docCategory = 'Property / Sale Deed';
      else if (/rent|lease|tenant|landlord/i.test(fileName + ' ' + fileText)) docCategory = 'Rental / Lease Agreement';
      else if (/notice|demand|cheque/i.test(fileName + ' ' + fileText)) docCategory = 'Legal Notice / Section Notice';
      else if (/writ|petition|article\s*226|high\s*court/i.test(fileName + ' ' + fileText)) docCategory = 'Writ Petition';
      else if (/affidavit|declaration|oath/i.test(fileName + ' ' + fileText)) docCategory = 'Affidavit / Sworn Statement';

      const snippet = fileText ? fileText.substring(0, 300).replace(/\s+/g, ' ').trim() : '';
      const summarySnippet = snippet ? `"${snippet}..."` : (lang === 'hi' ? 'दस्तावेज़ सफलतापूर्वक प्रोसेस किया गया है।' : 'Document file processed successfully.');

      const scanMessage = lang === 'hi'
        ? `📄 **फ़ाइल का तुरंत विश्लेषण (Quick Scan Complete)**\n\n` +
          `• **फ़ाइल का नाम**: \`${fileName}\`\n` +
          `• **श्रेणी**: \`${docCategory}\`\n\n` +
          `**संक्षिप्त विवरण**: ${summarySnippet}\n\n` +
          `आप इस दस्तावेज़ के साथ क्या करना चाहते हैं? नीचे दिए गए उपयुक्त विकल्पों में से चुनें:`
        : `📄 **Document Quick Scan Complete**\n\n` +
          `• **File Name**: \`${fileName}\`\n` +
          `• **Detected Category**: \`${docCategory}\`\n\n` +
          `**Quick Overview**: ${summarySnippet}\n\n` +
          `What would you like me to do with this document? Choose one of the suitable options below:`;

      const suggestedActions = lang === 'hi' ? [
        { type: 'toggle_right_panel', label: '🔬 दीप रिसर्च रिपोर्ट', icon: '🔬', action: 'START_DEEP_RESEARCH', tab: 'research', panelKey: 'isReportPanelOpen', description: 'इस दस्तावेज़ पर विस्तृत लीगल रिसर्च करें' },
        { type: 'toggle_right_panel', label: '⏱️ टाइमलाइन और घटनाक्रम', icon: '⏱️', action: 'START_CHRONOLOGY', tab: 'chronology', panelKey: 'isTimelinePanelOpen', description: 'महत्वपूर्ण तिथियां और क्रोनोलॉजी निकालें' },
        { type: 'toggle_right_panel', label: '⚡ पूर्व निर्णयों का विश्लेषण', icon: '⚡', action: 'START_PRECEDENCE', tab: 'drafting', panelKey: 'isPrecedencePanelOpen', description: 'अदालती फैसलों से तुलना करें' },
        { type: 'toggle_right_panel', label: '📝 काउंटर ड्राफ्ट बनाएं', icon: '📝', action: 'START_COUNTER_MAKER', tab: 'drafting', panelKey: 'isCounterMakerPanelOpen', description: 'कानूनी जवाब/काउंटर तैयार करें' },
        { type: 'toggle_right_panel', label: '🌐 दस्तावेज़ अनुवाद करें', icon: '🌐', action: 'TRANSLATE_DOCUMENT', tab: 'translation', panelKey: 'isTranslationPanelOpen', description: 'दस्तावेज़ का अनुवाद करें' },
        { type: 'file_action', label: '💬 AI से सवाल पूछें', icon: '💬', action: 'ASK_FILE_QUESTIONS', description: 'इस दस्तावेज़ से सीधे सवाल पूछें' }
      ] : [
        { type: 'toggle_right_panel', label: '🔬 Deep Research Report', icon: '🔬', action: 'START_DEEP_RESEARCH', tab: 'research', panelKey: 'isReportPanelOpen', description: 'Run comprehensive analysis report' },
        { type: 'toggle_right_panel', label: '⏱️ Extract Chronology & Timeline', icon: '⏱️', action: 'START_CHRONOLOGY', tab: 'chronology', panelKey: 'isTimelinePanelOpen', description: 'Extract key dates and timeline events' },
        { type: 'toggle_right_panel', label: '⚡ Precedence Analysis', icon: '⚡', action: 'START_PRECEDENCE', tab: 'drafting', panelKey: 'isPrecedencePanelOpen', description: 'Analyze court precedents relevant to this file' },
        { type: 'toggle_right_panel', label: '📝 Counter Affidavit Maker', icon: '📝', action: 'START_COUNTER_MAKER', tab: 'drafting', panelKey: 'isCounterMakerPanelOpen', description: 'Draft a legal counter response' },
        { type: 'toggle_right_panel', label: '🌐 Document Translator', icon: '🌐', action: 'TRANSLATE_DOCUMENT', tab: 'translation', panelKey: 'isTranslationPanelOpen', description: 'Translate document to another language' },
        { type: 'file_action', label: '💬 Ask AI Questions', icon: '💬', action: 'ASK_FILE_QUESTIONS', description: 'Ask specific legal questions about this file' }
      ];

      return await replyWithText(res, scanMessage, user, req, {
        mode: 'quick_scan_ready',
        file: fileDoc ? {
          fileId: fileDoc._id,
          fileName: fileDoc.originalName || fileDoc.fileName,
          fileType: fileDoc.fileType || 'application/pdf',
          fileSize: fileDoc.fileSize || 0,
          downloadUrl: fileDoc.downloadUrl
        } : null,
        suggestedActions
      });
    }

    if (intentOverride === 'CREATE_DOCUMENT') {
      console.log('📌 CREATE_DOCUMENT action override - clearing pending states');
      
      try {
        await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
        await redis.del(`pending_missing:${req.user.id}:${slug}`);
        await redis.del(`pending_freeform:${req.user.id}:${slug}`);
        await redis.del(`pending_template_confirm:${req.user.id}:${slug}`);
        await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
      } catch (e) { console.warn('Clear pending states error:', e?.message); }
      
      
      const lang = req?.preferredLanguage || 'en';
      const askDocType = lang === 'hi'
        ? `बढ़िया! आप किस प्रकार का दस्तावेज़ बनाना चाहते हैं?

उदाहरण: किराया समझौता, कानूनी नोटिस, शपथ पत्र, मुख्तारनामा, बिक्री विलेख, जमानत आवेदन, तलाक याचिका।`
        : `Great! What type of document would you like to create?

Examples: Rent Agreement, Legal Notice, Affidavit, Power of Attorney, Sale Deed, Bail Application, Divorce Petition.`;
      
      const suggestedActions = lang === 'hi'
        ? [
            { type: 'doc_type', label: '📜 किराया समझौता', icon: '📜', action: 'DOC_RENT_AGREEMENT', description: 'किराया/लीज़ समझौता बनाएं' },
            { type: 'doc_type', label: '📋 कानूनी नोटिस', icon: '📋', action: 'DOC_LEGAL_NOTICE', description: 'कानूनी नोटिस बनाएं' },
            { type: 'doc_type', label: '📝 शपथ पत्र', icon: '📝', action: 'DOC_AFFIDAVIT', description: 'शपथ पत्र बनाएं' },
            { type: 'doc_type', label: '📚 सभी टेम्पलेट देखें', icon: '📚', action: 'BROWSE_TEMPLATES', description: 'सभी उपलब्ध टेम्पलेट ब्राउज़ करें' }
          ]
        : [
            { type: 'doc_type', label: '📜 Rent Agreement', icon: '📜', action: 'DOC_RENT_AGREEMENT', description: 'Create a rental/lease agreement' },
            { type: 'doc_type', label: '📋 Legal Notice', icon: '📋', action: 'DOC_LEGAL_NOTICE', description: 'Create a legal notice' },
            { type: 'doc_type', label: '📝 Affidavit', icon: '📝', action: 'DOC_AFFIDAVIT', description: 'Create an affidavit' },
            { type: 'doc_type', label: '📚 Browse All Templates', icon: '📚', action: 'BROWSE_TEMPLATES', description: 'Browse all available templates' }
          ];
      
      return await replyWithText(res, askDocType, user, req, {
        mode: 'select_document_type',
        suggestedActions
      });
    }
    
    if (intentOverride === 'GUIDE_ME') {
      console.log('📌 GUIDE_ME action override - starting guidance flow');
      
      try {
        await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
        await redis.del(`pending_missing:${req.user.id}:${slug}`);
        await redis.del(`pending_freeform:${req.user.id}:${slug}`);
        await redis.del(`pending_template_confirm:${req.user.id}:${slug}`);
        await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
      } catch (e) { console.warn('Clear pending states error:', e?.message); }
      
      
      const lang = req?.preferredLanguage || 'en';
      const guideIntro = lang === 'hi'
        ? `मैं आपकी मदद करूंगा! कृपया बताइए आपकी कानूनी स्थिति क्या है?

**उदाहरण:**
- "मुझे किराएदार से समस्या है"
- "मेरा चेक बाउंस हो गया"
- "मुझे रिश्तेदार को पावर ऑफ अटॉर्नी देनी है"
- "मैं कोर्ट मैरिज करना चाहता/चाहती हूं"
- "मेरे साथ धोखाधड़ी हुई है"

बस अपनी स्थिति बताएं, और मैं सही दस्तावेज़ सुझाऊंगा।`
        : `I'll help you figure out the right document! Please describe your legal situation.

**Examples:**
- "I have a problem with my tenant"
- "My cheque bounced"
- "I need to give power of attorney to a relative"
- "I want to get a court marriage"
- "I was cheated by someone"

Just describe your situation, and I'll suggest the appropriate document.`;
      
      return await replyWithText(res, guideIntro, user, req, {
        mode: 'guidance_started'
      });
    }
    
    if (['CONVERSATIONAL', 'LEGAL_INFORMATION', 'DOCUMENT_REQUEST'].includes(intentOverride)) {
      console.log('📌 Intent override from frontend:', intentOverride);
      classification = { 
        type: intentOverride, 
        confidence: 1.0, 
        metadata: { override: true, timestamp: new Date().toISOString() } 
      };
    } else {
      classification = await intentClassifier.classifyIntent(message, contextText);
    }
    console.log('Intent classification:', classification);

    
    if (classification.metadata?.isCancellation) {
      console.log('🛑 User cancelled document generation - clearing pending states');
      try {
        await redis.del(`pending_missing:${req.user.id}:${slug}`);
        await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
        await redis.del(`pending_template_choice:${req.user.id}:${slug}`);
        await redis.del(`pending_template_confirm:${req.user.id}:${slug}`);
        await redis.del(`pending_freeform:${req.user.id}:${slug}`);
        await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
        await abandonDocumentSession(req.user.id);
      } catch (e) {
        console.warn('Failed to clear pending states:', e?.message);
      }
      return await replyWithText(res, "No problem! I've cancelled the document generation. How else can I help you today?", user, req);
    }


    
    switch (classification.type) {
      case 'DOCUMENT_REQUEST': {
        
        
        const AUTO_START_CONFIDENCE = Number(process.env.DOC_AUTO_START_CONFIDENCE || 0.4);
        const lowConfidence = (classification.confidence || 0) < AUTO_START_CONFIDENCE;
        const fallbackHint = Boolean(classification.metadata && classification.metadata.fallback);
        
        const hesitationRegex = /not sure|i'?m not sure|guide me|help me|unsure|could you guide|mujhe ni|nahi pata|pata nahi|मुझे नहीं|नहीं पता|kya banau|क्या बनाऊं/i;
        const containsHesitation = hesitationRegex.test(message || '');
        
        
        
        const specificDocTypes = [
          'legal notice', 'affidavit', 'power of attorney', 'poa', 'rent agreement', 'lease',
          'sale deed', 'gift deed', 'will', 'testament', 'adoption', 'divorce', 'complaint',
          'fir', 'bail', 'petition', 'vakalatnama', 'partnership deed', 'mou', 'agreement',
          'notice', 'contract', 'bond', 'undertaking', 'declaration', 'consent',
          'कानूनी नोटिस', 'शपथ पत्र', 'मुख्तारनामा', 'किराया समझौता', 'विक्रय विलेख'
        ];
        const msgLower = (message || '').toLowerCase();
        const hasSpecificDocType = specificDocTypes.some(dt => msgLower.includes(dt));
        
        
        if ((lowConfidence || fallbackHint || containsHesitation) && !hasSpecificDocType) {
          console.log('Document request deferred for confirmation (low confidence or ambiguous):', { confidence: classification.confidence, fallback: fallbackHint, message });
          const lang = req?.preferredLanguage || 'en';
          const clarifying = lang === 'hi'
            ? `ऐसा लगता है कि आप कानूनी दस्तावेज़ बनाने में मदद चाहते हैं। कृपया नीचे से चुनें:`
            : `It sounds like you might want help creating a legal document. Please choose from below:`;
          
          const suggestedActions = lang === 'hi'
            ? [
                { type: 'doc_choice', label: '📝 दस्तावेज़ बनाएं', icon: '📝', action: 'CREATE_DOCUMENT', description: 'अभी दस्तावेज़ बनाना शुरू करें' },
                { type: 'doc_choice', label: '🧭 मुझे गाइड करें', icon: '🧭', action: 'GUIDE_ME', description: 'कौन सा दस्तावेज़ चाहिए, जानें' },
                { type: 'doc_choice', label: '📚 टेम्पलेट देखें', icon: '📚', action: 'BROWSE_TEMPLATES', description: 'सभी उपलब्ध टेम्पलेट देखें' }
              ]
            : [
                { type: 'doc_choice', label: '📝 Create Document', icon: '📝', action: 'CREATE_DOCUMENT', description: 'Start creating a document now' },
                { type: 'doc_choice', label: '🧭 Guide Me', icon: '🧭', action: 'GUIDE_ME', description: 'Help me decide what I need' },
                { type: 'doc_choice', label: '📚 Browse Templates', icon: '📚', action: 'BROWSE_TEMPLATES', description: 'See all available templates' }
              ];

          
          try {
            await redis.set(`pending_confirmation:${req.user.id}:${slug}`, JSON.stringify({
              type: 'document_confirmation',
              suggestedActions: ['create_document', 'guide_me'],
              originalMessage: message,
              classification
            }), 'EX', 300);
          } catch (err) {
            console.warn('Failed to persist pending confirmation:', err?.message || err);
          }

          return await replyWithText(res, clarifying, user, req, { suggestedActions, classification });
        }

        return await handleDocumentRequest(message, res, user, req, classification, guidanceContext, sourceAction, documentType);
      }
      case 'LEGAL_INFORMATION':
        return await handleLegalInformation(message, classification, res, user, req);
      
      case 'DOCUMENT_MODIFICATION':
        return await handleDocumentModification(message, res, user, req);
      
      case 'CONVERSATIONAL':
      default:
        return await handleConversationalChat(message, req, res, user);
    }

  } catch (error) {
    console.error('Send message error:', error);
    
    
    if (error?.response?.status === 429) {
      logError('AI002', error, { context: 'main_request_rate_limit', userId: req.user.id });
      const errorResponse = generateErrorResponse('AI002');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    } else if (error?.code === 'ENOTFOUND' || error?.code === 'ETIMEDOUT') {
      logError('AI001', error, { context: 'main_request_service_unavailable', userId: req.user.id });
      const errorResponse = generateErrorResponse('AI001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    } else if (error?.name === 'MongooseError' || error?.name === 'MongoError') {
      logError('DB001', error, { context: 'main_request_database_error', userId: req.user.id });
      const errorResponse = generateErrorResponse('DB001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    } else if (error?.response?.status >= 500) {
      logError('SYS001', error, { context: 'main_request_server_error', userId: req.user.id });
      const errorResponse = generateErrorResponse('SYS001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
            } else {
      logError('SYS001', error, { context: 'main_request_unexpected_error', userId: req.user.id });
      const errorResponse = generateErrorResponse('SYS001');
      return res.status(errorResponse.error.httpStatus).json(errorResponse);
    }
  }
};

async function handleConversationalChat(message, req, res, user) {
  try {
    
    const lang = req.preferredLanguage || 'en';
    
    
    const acceptHeader = req.headers.accept || '';
    const wantsStreaming = acceptHeader.includes('text/event-stream') || req.query.stream === 'true';
    
    if (wantsStreaming) {
      return await handleStreamingResponse(req, res, {
        systemPrompt: LEGAL_ASSISTANT_SYSTEM_PROMPT,
        conversationHistory: await getConversationHistory(req.user.id),
        user,
        message
      });
    }

    
    const messageLower = message.toLowerCase().trim();
    const greetingKeywords = ['hello', 'hi', 'hy', 'hyy', 'hii', 'hlo', 'hey', 'heyy', 'yo', 'sup', 'greetings', 'good morning', 'good afternoon', 'good evening', 'thanks', 'thank you', 'ok', 'okay', 'sure', 'yes', 'no', 'bye', 'goodbye', 'namaste', 'namaskar', 'dhanyawad', 'shukriya'];
    const isSimpleGreeting = greetingKeywords.some(kw => messageLower === kw || messageLower.startsWith(kw + ' ') || messageLower.startsWith(kw + ',') || messageLower.startsWith(kw + '!')) || (messageLower.length <= 12 && /^(hy|hyy|hii|hlo|heyy|yo|hi|hey|hello|namaste)\b/i.test(messageLower));
    
    
    const helpQueries = ['what can you do', 'what can you help', 'how can you help', 'what are you', 'what is this', 'help me', 'what do you do', 'kya kar sakte', 'kaise madad', 'aap kya', 'madad karo'];
    const isHelpQuery = helpQueries.some(q => messageLower.includes(q));
    
    if (isHelpQuery || (isSimpleGreeting && messageLower.includes('help'))) {
      const helpResponse = lang === 'hi' 
        ? `नमस्ते! मैं आपका AI कानूनी सहायक हूँ।

→ **कानूनी प्रश्न**: भारतीय कानून के बारे में कोई भी सवाल पूछें - संपत्ति, परिवार, आपराधिक, दीवानी, उपभोक्ता अधिकार, रोजगार, आदि।

→ **दस्तावेज़ बनाना**: मैं कानूनी दस्तावेज़ तैयार कर सकता हूँ जैसे:
  • शपथ पत्र और घोषणाएं
  • कानूनी नोटिस (किरायेदार, नियोक्ता, आदि)
  • मुख्तारनामा (पावर ऑफ अटॉर्नी)
  • बिक्री/पट्टा समझौते
  • दत्तक ग्रहण पत्र
  • वसीयत और उपहार विलेख
  • और 100+ टेम्पलेट

→ **दस्तावेज़ संपादन**: कोई भी दस्तावेज़ (PDF, DOCX, Excel) अपलोड करें और मैं:
  • उसकी सामग्री का विश्लेषण करूंगा
  • आपके निर्देशों के अनुसार संपादन करूंगा
  • DOCX या PDF के रूप में निर्यात करूंगा

→ **केस अनुसंधान**: संबंधित कानूनों, धाराओं और केस उदाहरणों के बारे में जानकारी प्राप्त करें।

बस अपना सवाल टाइप करें या बताएं कि आपको क्या चाहिए!`
        : `Hello! I'm your AI Legal Assistant for Indian Law.

→ **Legal Queries**: Ask any question about Indian law - property, family, criminal, civil, consumer rights, employment, etc.

→ **Document Drafting**: I can generate legal documents like:
  • Affidavits & Declarations
  • Legal Notices (tenant, employer, etc.)
  • Power of Attorney
  • Sale/Lease Agreements
  • Adoption Papers
  • Wills & Gift Deeds
  • And 100+ more templates

→ **Document Editing**: Upload any document (PDF, DOCX, Excel) and I can:
  • Analyze its contents
  • Make edits based on your instructions
  • Export as DOCX or PDF

→ **Case Research**: Get information about relevant laws, sections, and case precedents.

Just type your question or describe what you need!`;
      
      return await replyWithText(res, helpResponse, user, req);
    }
    
    
    if (isSimpleGreeting && !messageLower.includes('?')) {
      const greetingResponses = lang === 'hi' 
        ? [
            "नमस्ते! 👋 आज मैं आपकी क्या मदद कर सकता हूँ? आप कोई भी कानूनी सवाल पूछ सकते हैं या दस्तावेज़ बनाने का अनुरोध कर सकते हैं।",
            "नमस्कार! 😊 मैं आपके किसी भी सवाल या दस्तावेज़ सहायता के लिए तैयार हूँ। बताएं, आज क्या करना चाहेंगे?",
            "जी! 👋 भारतीय कानून के बारे में कुछ भी पूछें या कानूनी दस्तावेज़ तैयार करने के लिए कहें।"
          ]
        : [
            "Hello! 👋 How can I help you today? Feel free to ask any question, draft a legal document, or upload a file for analysis.",
            "Hi there! 😊 Ready to help with any legal questions or document needs. What are you working on today?",
            "Hey! 👋 Feel free to ask me anything or describe what you need assistance with."
          ];
      const randomGreeting = greetingResponses[Math.floor(Math.random() * greetingResponses.length)];
      return await replyWithText(res, randomGreeting, user, req);
    }

    
    let enhancedResponse = await generateEnhancedLegalResponse(message, req);
    
    
    let suggestedDocuments = [];
    if (message.split(/\s+/).length > 5) {
      
      const chatContext = await getConversationHistory(req.user.id);
      const conversationText = chatContext.map(msg => msg.parts[0]?.text || '').join(' ');
      suggestedDocuments = await generateDocumentSuggestion(message, conversationText);
    }
    
    let finalResponse = enhancedResponse;
    if (suggestedDocuments.length > 0) {
      const docSuggestionText = lang === 'hi'
        ? `\n\nआपकी ज़रूरतों के आधार पर, आपको इनसे भी फायदा हो सकता है: ${suggestedDocuments.join(', ')}। क्या आप चाहते हैं कि मैं इनमें से कोई दस्तावेज़ तैयार करूं?`
        : `\n\nBased on your needs, you may also benefit from: ${suggestedDocuments.join(', ')}. Would you like me to generate any of these documents for you?`;
      finalResponse += docSuggestionText;
    }
    
    
    const suggestedActions = await generateSmartSuggestions(message, finalResponse, lang);
    
    
    
    return await replyWithText(res, finalResponse, user, req, { 
      suggestedActions: suggestedActions.length > 0 ? suggestedActions : undefined,
      suggestedDocuments: suggestedDocuments.length > 0 ? suggestedDocuments : undefined
    });

  } catch (error) {
    console.error('Conversational chat error:', error);
    const lang = req?.preferredLanguage || 'en';
    const fallbackResponse = lang === 'hi' 
      ? 'क्षमा करें, आपका संदेश प्रोसेस करने में त्रुटि हुई। कृपया पुनः प्रयास करें।'
      : 'I apologize, but I encountered an error processing your message. Please try again.';
    return await replyWithText(res, fallbackResponse, user, req);
  }
}

async function generateSmartSuggestions(userMessage, aiResponse, lang = 'en') {
  const suggestions = [];
  const messageLower = userMessage.toLowerCase();
  const responseLower = aiResponse.toLowerCase();
  
  
  const docKeywords = {
    lease: ['lease', 'rent', 'rental', 'tenant', 'landlord', 'kirayadaar', 'kiraya', 'makan-malik', 'patta'],
    notice: ['legal notice', 'notice', 'kanooni notice', 'notice dena'],
    affidavit: ['affidavit', 'shapat', 'shapat patra', 'sworn statement', 'declaration'],
    poa: ['power of attorney', 'poa', 'mukhtarnama', 'attorney'],
    will: ['will', 'testament', 'vasiyat', 'property distribution'],
    sale: ['sale deed', 'property sale', 'bikri', 'sampatti bikri', 'sale agreement'],
    complaint: ['complaint', 'consumer complaint', 'shikayat', 'fir', 'police complaint', 
                'domestic incident report', 'dir', '498a', 'section 498a', 
                'criminal complaint', 'police report', 'complaint under section'],
  };
  
  const docLabels = {
    hi: {
      lease: 'किराया समझौता बनाएं',
      notice: 'कानूनी नोटिस बनाएं',
      affidavit: 'शपथ पत्र बनाएं',
      poa: 'मुख्तारनामा बनाएं',
      will: 'वसीयत बनाएं',
      sale: 'बिक्री पत्र बनाएं',
      complaint: 'शिकायत/FIR बनाएं',
    },
    en: {
      lease: 'Generate Lease Agreement',
      notice: 'Generate Legal Notice',
      affidavit: 'Generate Affidavit',
      poa: 'Generate Power of Attorney',
      will: 'Generate Will',
      sale: 'Generate Sale Deed',
      complaint: 'Generate Complaint/FIR',
    }
  };
  
  
  
  const aiOffersPhrases = [
    'would you like me to generate',
    'would you like me to create',
    'would you like me to prepare',
    'would you like me to help generate',
    'would you like me to help',
    'i can generate',
    'i can prepare',
    'i can create',
    'i can help',
    'you may need',
    'you might need',
    'you may also need',
    'you will need',
    'you would need',
    'based on your situation, you may',
    'kya aap chahenge',
    'main bana sakta',
    'taiyar kar sakta'
  ];
  
  const aiExplicitlyOffers = aiOffersPhrases.some(phrase => responseLower.includes(phrase));
  
  if (aiExplicitlyOffers) {
    
    console.log('🎯 AI explicitly offering documents, parsing with expanded context...');
    
    
    const sentences = aiResponse.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    
    const offerIndices = [];
    sentences.forEach((sentence, idx) => {
      if (aiOffersPhrases.some(phrase => sentence.toLowerCase().includes(phrase))) {
        offerIndices.push(idx);
      }
    });
    
    
    const contextSentences = new Set();
    offerIndices.forEach(idx => {
      contextSentences.add(Math.max(0, idx - 2));
      contextSentences.add(Math.max(0, idx - 1));
      contextSentences.add(idx);
      if (idx + 1 < sentences.length) contextSentences.add(idx + 1);
    });
    
    const offerContext = Array.from(contextSentences)
      .sort((a, b) => a - b)
      .map(i => sentences[i])
      .join(' ')
      .toLowerCase();
    
    console.log('🔍 Expanded offer context:', offerContext);
    
    const offeredDocs = [];
    
    
    for (const [type, keywords] of Object.entries(docKeywords)) {
      if (keywords.some(kw => offerContext.includes(kw.toLowerCase()))) {
        offeredDocs.push(type);
        console.log(`✅ Detected document offer: ${type}`);
      }
    }
    
    
    
    if ((offerContext.includes('these documents') || offerContext.includes('any of these')) && offeredDocs.length === 0) {
      console.log('🔍 Generic offer detected ("these documents"), scanning full response...');
      for (const [type, keywords] of Object.entries(docKeywords)) {
        if (keywords.some(kw => responseLower.includes(kw.toLowerCase()))) {
          offeredDocs.push(type);
          console.log(`✅ Detected document in full response: ${type}`);
        }
      }
    }
    
    
    const maxSuggestions = 4;
    
    
    
    const hasComplaint = offeredDocs.includes('complaint');
    
    if (hasComplaint) {
      suggestions.push({
        type: 'generate_complaint',
        label: docLabels[lang].complaint,
        icon: '📝',
        action: 'GENERATE_COMPLAINT',
        description: lang === 'hi' ? 'संरचित फॉर्म के साथ औपचारिक शिकायत/FIR' : 'Formal complaint/FIR with structured form'
      });
      
    } else {
      offeredDocs.slice(0, maxSuggestions).forEach(docType => {
        suggestions.push({
          type: 'generate_document',
          label: docLabels[lang][docType] || (lang === 'hi' ? 'दस्तावेज़ बनाएं' : 'Generate Document'),
          icon: '📝',
          action: 'DOCUMENT_REQUEST',
          data: { documentType: docType },
          description: lang === 'hi' ? 'मैं आपके लिए यह दस्तावेज़ तैयार कर सकता हूँ' : 'I can prepare this document for you'
        });
      });
    }
  }
  
  
  
  const userActionVerbs = [
    'generate', 'create', 'draft', 'need', 'want', 'file', 'make', 
    'prepare', 'get', 'help with', 'guide', 'obtain', 'apply for',
    'banana', 'chahiye', 'banwana', 'taiyar', 'madad', 'guide karo'
  ];
  
  const userWantsDocument = userActionVerbs.some(verb => messageLower.includes(verb));
  
  if (userWantsDocument && suggestions.length === 0) {
    
    let detectedDocType = null;
    for (const [type, keywords] of Object.entries(docKeywords)) {
      if (keywords.some(kw => messageLower.includes(kw))) {
        detectedDocType = type;
        break;
      }
    }
    
    if (detectedDocType) {
      if (detectedDocType === 'complaint') {
        suggestions.push({
          type: 'generate_complaint',
          label: docLabels[lang].complaint,
          icon: '📝',
          action: 'GENERATE_COMPLAINT',
          description: lang === 'hi' ? 'संरचित फॉर्म के साथ औपचारिक शिकायत' : 'Formal complaint with structured form'
        });
      } else {
        suggestions.push({
          type: 'generate_document',
          label: docLabels[lang][detectedDocType] || (lang === 'hi' ? 'दस्तावेज़ बनाएं' : 'Generate Document'),
          icon: '📝',
          action: 'DOCUMENT_REQUEST',
          data: { documentType: detectedDocType },
          description: lang === 'hi' ? 'मैं आपके लिए यह दस्तावेज़ तैयार कर सकता हूँ' : 'I can prepare this document for you'
        });
      }
    }
  }
  
  
  
  const hasComplaintSuggestion = suggestions.some(s => s.type === 'generate_complaint');
  
  if (!hasComplaintSuggestion && (responseLower.includes('section') || responseLower.includes('act') || 
      responseLower.includes('dhara') || responseLower.includes('kanoon') ||
      responseLower.includes('statutory provision'))) {
    
    const alreadyHasLaw = suggestions.some(s => s.type === 'learn_more_law');
    if (!alreadyHasLaw) {
      suggestions.push({
        type: 'learn_more_law',
        label: lang === 'hi' ? 'इस कानून के बारे में और जानें' : 'Learn more about this law',
        icon: '⚖️',
        action: 'LEARN_MORE_LAW',
        description: lang === 'hi' ? 'विस्तृत विश्लेषण, केस लॉ, और उदाहरण' : 'Comprehensive analysis, case law, and examples'
      });
    }
  }
  
  
  
  if (!hasComplaintSuggestion && (messageLower.includes('case') || messageLower.includes('judgment') || 
      messageLower.includes('dispute') || messageLower.includes('rights') ||
      messageLower.includes('adhikar') || messageLower.includes('vivad'))) {
    const alreadyHasCase = suggestions.some(s => s.type === 'case_search');
    if (!alreadyHasCase) {
      suggestions.push({
        type: 'case_search',
        label: lang === 'hi' ? 'संबंधित केस खोजें' : 'Search Related Cases',
        icon: '🔍',
        action: 'CASE_SEARCH',
        description: lang === 'hi' ? 'समान केस उदाहरण देखें' : 'Find similar case examples'
      });
    }
  }
  
  
  
  if (!hasComplaintSuggestion) {
    const documentMentioned = suggestions.some(s => s.type === 'generate_document');
    const userInterestedInDocs = documentMentioned || 
                                 messageLower.includes('template') || 
                                 messageLower.includes('browse') ||
                                 messageLower.includes('document') || 
                                 messageLower.includes('dastavez');
    
    if (userInterestedInDocs) {
      const alreadyHasBrowse = suggestions.some(s => s.type === 'browse_templates');
      if (!alreadyHasBrowse) {
        suggestions.push({
          type: 'browse_templates',
          label: lang === 'hi' ? 'सभी टेम्पलेट देखें' : 'Browse All Templates',
          icon: '📋',
          action: 'BROWSE_TEMPLATES',
          description: lang === 'hi' ? '100+ कानूनी दस्तावेज़ टेम्पलेट' : '100+ legal document templates'
        });
      }
    }
  }
  
  
  if (suggestions.length === 0) {
    suggestions.push({
      type: 'general_help',
      label: lang === 'hi' ? 'मैं और क्या कर सकता हूँ?' : 'What else can I do?',
      icon: '💡',
      action: 'HELP',
      description: lang === 'hi' ? 'मेरी सभी क्षमताएं देखें' : 'See all my capabilities'
    });
  }
  
  console.log(`🎯 Generated ${suggestions.length} smart suggestions:`, suggestions.map(s => s.label).join(', '));
  
  return suggestions;
}

async function getConversationHistory(userId, slug = 'default') {
  try {
    const chatDoc = await Chat.findOne({ userId, slug })
      .select('messages')
      .lean();
      
    const messages = chatDoc?.messages || [];
    
    
    const lastMessages = messages.slice(-6)
      .filter(msg =>
        msg &&
        (msg.role === 'user' || msg.role === 'assistant') &&
        typeof msg.content === 'string' &&
        msg.content.trim().length > 0
      )
      .map(msg => ({
        role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      }));

    return lastMessages;
      } catch (error) {
    console.error('Get conversation history error:', error);
    return [];
  }
};

async function handleLegacyChatWorkflow(req, res, user, message, slug = 'default') {
  
  
  
  const systemPrompt = LEGAL_ASSISTANT_SYSTEM_PROMPT;

    
    let chatDoc = await Chat.findOne({ userId: new mongoose.Types.ObjectId(req.user.id), slug })
      .select('messages')
      .lean();
    if (!chatDoc) {
      chatDoc = { userId: new mongoose.Types.ObjectId(req.user.id), slug, messages: [] };
    }

    
    const lastMessages = chatDoc.messages.slice(-6);

    
    let enhancedSystemPrompt = systemPrompt;
    const legalKeywords = ['section', 'act', 'law', 'court', 'judge', 'criminal', 'civil', 'penalty', 'offence', 'bns', 'ipc', 'crpc', 'evidence'];
    const isLegalQuery = legalKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    if (isLegalQuery) {
      try {
        const legalContext = await enhancePromptWithLegalContext(message);
        if (legalContext) {
          enhancedSystemPrompt += legalContext;
          console.log('📚 Enhanced prompt with legal context');
        }
      } catch (error) {
        console.error('Error enhancing with legal context:', error.message);
      }
    }

    
    const conversationHistory = lastMessages
      .filter(msg =>
        msg &&
        (msg.role === 'user' || msg.role === 'assistant') &&
        typeof msg.content === 'string' &&
        msg.content.trim().length > 0
      )
      .map(msg => ({
      role: msg.role === 'assistant' ? 'model' : msg.role,
        parts: [{ text: msg.content }]
      }));

    
    conversationHistory.push({
      role: 'user',
      parts: [{ text: message }]
    });

  try {
    
    console.log('🤖 Legacy workflow - calling local Llama model...');
    
    
    const contextMessages = conversationHistory.map(msg => 
      `${msg.role === 'model' ? 'Assistant' : 'User'}: ${msg.parts[0].text}`
    ).join('\n');
    
    const fullPrompt = `${systemPrompt}\n\nConversation History:\n${contextMessages}\n\nUser: ${message}\n\nAssistant:`;
    
    const aiResponse = await callLocalLLM(fullPrompt);
    
    if (!aiResponse || aiResponse.trim().length === 0) {
      throw new Error('Empty response from local LLM');
    }

    
    await Chat.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(req.user.id), slug },
      { $push: { messages: { role: 'assistant', content: aiResponse } } },
      { upsert: true }
    );

    
    if (chatDoc.messages.length > 50) {
      chatDoc.messages = chatDoc.messages.slice(-50);
    }

    try { await redis.del(`chat:${req.user.id}:${slug}`); } catch {}

    
    let remainingMessages = null;
    const limit = await getMessageLimitForTier(user.subscriptionStatus);
    if (limit !== -1) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let mc = await MessageCount.findOne({
        userId: new mongoose.Types.ObjectId(req.user.id),
        date: today
      });
      if (!mc) {
        mc = new MessageCount({ userId: new mongoose.Types.ObjectId(req.user.id), date: today, count: 0 });
      }
      mc.count += 1;
      await mc.save();
      remainingMessages = Math.max(0, limit - mc.count);
    }

    return res.json({ 
      response: aiResponse,
      remainingMessages,
      subscriptionStatus: user.subscriptionStatus
    });

  } catch (error) {
    console.error('Legacy workflow error:', error);
    throw error;
  }
}

export const getChatHistory = async (req, res) => {
  try {
    const slug = req.params.slug || req.headers['x-chat-slug'] || req.query.slug || 'default';
    const cacheKey = `chat:${req.user.id}:${slug}`;
    let cached = null;
    try {
      cached = await redis.get(cacheKey);
    } catch (e) {
      console.warn('Redis get failed for chat history, proceeding without cache:', e?.message || e);
    }
    if (cached) {
      const parsed = JSON.parse(cached);
      return res.json({
        success: true,
        messages: parsed.messages || [],
        activeFileId: parsed.activeFileId || null,
        researchSessionId: parsed.researchSessionId || null,
        chronologySessionId: parsed.chronologySessionId || null,
        bulkReviewSessionId: parsed.bulkReviewSessionId || null,
        reviewFileIds: parsed.reviewFileIds || [],
        chronologyFileIds: parsed.chronologyFileIds || []
      });
    }
    
    const chat = await Chat.findOne({ userId: req.user.id, slug })
      .select('messages activeFileId researchSessionId chronologySessionId bulkReviewSessionId reviewFileIds chronologyFileIds')
      .lean();
    const messages = chat?.messages || [];
    
    const payload = {
      messages,
      activeFileId: chat?.activeFileId || null,
      researchSessionId: chat?.researchSessionId || null,
      chronologySessionId: chat?.chronologySessionId || null,
      bulkReviewSessionId: chat?.bulkReviewSessionId || null,
      reviewFileIds: chat?.reviewFileIds || [],
      chronologyFileIds: chat?.chronologyFileIds || []
    };
    
    try {
      await redis.set(cacheKey, JSON.stringify(payload), 'EX', 120);
    } catch (e) {
      console.warn('Redis set failed for chat history cache:', e?.message || e);
    }
    
    res.json({ success: true, ...payload });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching chat history', 500);
  }
};

export const updateChatState = async (req, res) => {
  try {
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    const { 
      activeFileId, 
      researchSessionId, 
      chronologySessionId, 
      bulkReviewSessionId,
      reviewFileIds,
      chronologyFileIds
    } = req.body;
    
    await Chat.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(req.user.id), slug },
      { 
        $set: { 
          activeFileId: activeFileId || null, 
          researchSessionId: researchSessionId || null, 
          chronologySessionId: chronologySessionId || null, 
          bulkReviewSessionId: bulkReviewSessionId || null,
          reviewFileIds: reviewFileIds || [],
          chronologyFileIds: chronologyFileIds || []
        } 
      },
      { upsert: true }
    );
    
    // Clear cache
    const cacheKey = `chat:${req.user.id}:${slug}`;
    await redis.del(cacheKey);
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const clearChatHistory = async (req, res) => {
  try {
    const { password } = req.body;
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    
    
    if (!password) {
      return res.status(400).json({ 
        success: false, 
        message: 'Password is required to clear chat history' 
      });
    }
    
    
    const user = await User.findById(req.user.id).select('+password');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    
    const bcrypt = await import('bcryptjs');
    const isMatch = await bcrypt.default.compare(password, user.password);
    
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        message: 'Incorrect password. Please try again.' 
      });
    }
    
    
    
    const cacheKey = `chat:${req.user.id}:${slug}`;
    try { await redis.del(cacheKey); } catch {}

    
    const wfKey = `workflow:chat:${req.user.id}:${slug}`;
    try { await redis.del(wfKey); } catch {}

    
    const modeKey = `mode:chat:${req.user.id}:${slug}`;
    try { await redis.del(modeKey); } catch {}
    
    
    try { 
      await redis.del(`pending_missing:${req.user.id}:${slug}`);
      await redis.del(`pending_confirmation:${req.user.id}:${slug}`);
      await redis.del(`pending_template_choice:${req.user.id}:${slug}`);
      await redis.del(`pending_freeform:${req.user.id}:${slug}`);
    } catch {}

    const soft = String(req.query.soft || '').toLowerCase() === 'true';
    if (soft) {
      return res.json({ success: true, message: 'Chat session reset (soft). Workflow cleared.' });
    }
    
    await Chat.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(req.user.id), slug },
      { $set: { messages: [] } },
      { new: true }
    );
    
    
    try {
      await abandonDocumentSession(req.user.id);
    } catch {}
    
    res.json({ success: true, message: 'Chat history cleared successfully' });
  } catch (error) {
    throw new AppError(error.message || 'Error clearing chat history', 500);
  }
};

export const exitDocumentMode = async (req, res) => {
  try {
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    await abandonDocumentSession(req.user.id, slug);
    
    
    const keysToDelete = [
      `pending_missing:${req.user.id}:${slug}`,
      `pending_missing:${req.user.id}:${slug}`,
      `pending_confirmation:${req.user.id}:${slug}`,
      `pending_template_confirm:${req.user.id}:${slug}`,
      `pending_ai_document:${req.user.id}:${slug}`,
      `pending_freeform:${req.user.id}:${slug}`
    ];
    
    for (const key of keysToDelete) {
      try {
        await redis.del(key);
      } catch (e) {
        
      }
    }
    
    console.log(`✅ Document mode exited for user ${req.user.id}`);
    
    res.json({ 
      success: true, 
      message: 'Document mode exited successfully' 
    });
  } catch (error) {
    console.error('Error exiting document mode:', error);
    throw new AppError(error.message || 'Error exiting document mode', 500);
  }
};

export const rateDraft = async (req, res) => {
  try {
    const { rating, templatePath } = req.body;
    const userId = req.user.id;
    
    
    if (!rating || !['like', 'dislike'].includes(rating)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid rating. Must be "like" or "dislike"' 
      });
    }
    
    
    console.log(`📊 User ${userId} rated draft: ${rating}`, {
      templatePath: templatePath || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    
    
    
    res.json({ 
      success: true, 
      message: 'Rating recorded successfully',
      rating 
    });
  } catch (error) {
    // generateComplaint and generateLegalAnalysis controllers have been moved to separate files. 
    console.error('Error recording rating:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Error recording rating' 
    });
  }
};


export const getUserChats = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // 1. Generic Chats (only include chats where at least 1 message was sent)
    const chats = await Chat.find({ userId, 'messages.0': { $exists: true } })
      .select('slug messages updatedAt title')
      .sort({ updatedAt: -1 })
      .lean();
      
    const chatList = chats
      .filter(chat => chat.messages && chat.messages.length > 0)
      .map(chat => {
        const lastMsg = chat.messages[chat.messages.length - 1];
        const defaultTitle = chat.messages[0]?.content 
          ? (chat.messages[0].content.substring(0, 35) + '...')
          : 'Conversation';
        return {
          slug: chat.slug,
          title: chat.title || defaultTitle,
          preview: lastMsg ? lastMsg.content.substring(0, 60) : 'Conversation',
          updatedAt: chat.updatedAt || (lastMsg ? lastMsg.timestamp : new Date()),
          feature: lastMsg?.mode || 'chat',
          type: 'chat'
        };
      });

    // 2. Research Sessions
    const research = await ResearchSession.find({ userId })
      .select('_id updatedAt status')
      .sort({ updatedAt: -1 })
      .lean();
    
    const researchList = research.map(r => ({
      slug: r._id.toString(),
      title: 'Deep Research Session',
      preview: `Status: ${r.status}`,
      updatedAt: r.updatedAt || new Date(),
      feature: 'research',
      type: 'research'
    }));

    // 3. Counter Maker Sessions
    const counterMaker = await CounterMakerSession.find({ userId })
      .select('_id updatedAt status')
      .sort({ updatedAt: -1 })
      .lean();

    const counterMakerList = counterMaker.map(c => ({
      slug: c._id.toString(),
      title: 'Counter Affidavit Draft',
      preview: `Status: ${c.status}`,
      updatedAt: c.updatedAt || new Date(),
      feature: 'counter_maker',
      type: 'counter_maker'
    }));

    // 4. Chronology Sessions
    const chronology = await ChronologySession.find({ userId })
      .select('_id updatedAt status')
      .sort({ updatedAt: -1 })
      .lean();

    const chronologyList = chronology.map(c => ({
      slug: c._id.toString(),
      title: 'Timeline & Chronology',
      preview: `Status: ${c.status}`,
      updatedAt: c.updatedAt || new Date(),
      feature: 'chronology',
      type: 'chronology'
    }));
    
    // 5. Precedence Sessions
    const precedence = await PrecedenceSession.find({ userId })
      .select('_id updatedAt status')
      .sort({ updatedAt: -1 })
      .lean();

    const precedenceList = precedence.map(p => ({
      slug: p._id.toString(),
      title: 'Precedence Analysis',
      preview: `Status: ${p.status}`,
      updatedAt: p.updatedAt || new Date(),
      feature: 'precedence',
      type: 'precedence'
    }));

    // Combine and sort
    const combinedList = [...chatList, ...researchList, ...counterMakerList, ...chronologyList, ...precedenceList];
    combinedList.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json(combinedList);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

async function generateAndSaveChatTitle(userId, slug, firstMessage) {
  try {
    const prompt = `Provide a very short summary (3-5 words) of this user's legal query to use as a navigation title. Do not output anything else. No quotes, no preamble.
    
Query: "${firstMessage}"`;

    const title = await callLocalLLM(prompt);
    if (title && title.trim().length > 0) {
      const cleanTitle = title.trim().replace(/^["']|["']$/g, '').substring(0, 50);
      await Chat.updateOne(
        { userId, slug },
        { $set: { title: cleanTitle } }
      );
      console.log(`🏷️ Auto-generated chat title for ${slug}: "${cleanTitle}"`);
    }
  } catch (err) {
    console.warn('[Title Gen] Title generation failed:', err.message);
  }
}


export const deleteChatSession = async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!slug) {
      return res.status(400).json({ success: false, message: 'Session slug is required' });
    }

    const userId = req.user.id;
    await Chat.deleteOne({ userId, slug });

    try {
      await redis.del(`chat:${req.user.id}:${slug}`);
      await redis.del(`wfKey:chat:${req.user.id}:${slug}`);
      await redis.del(`modeKey:chat:${req.user.id}:${slug}`);
    } catch {}

    res.json({ success: true, message: 'Chat session deleted successfully' });
  } catch (error) {
    console.error('Delete chat session error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error deleting session' });
  }
};

export const updateChatTitle = async (req, res) => {
  try {
    const slug = req.params.slug;
    const { title } = req.body;
    if (!slug || !title) {
      return res.status(400).json({ success: false, message: 'Slug and title are required' });
    }

    const userId = req.user.id;
    const cleanTitle = title.trim().substring(0, 100);

    const chat = await Chat.findOneAndUpdate(
      { userId, slug },
      { $set: { title: cleanTitle } },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({ success: false, message: 'Chat session not found' });
    }

    res.json({ success: true, title: cleanTitle });
  } catch (error) {
    console.error('Update chat title error:', error);
    res.status(500).json({ success: false, message: error.message || 'Error updating title' });
  }
};

export { callLocalLLM, writeDocxFromText };