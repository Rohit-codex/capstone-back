import axios from 'axios';
import { logger } from '../utils/logger.js';

class IntentClassifierService {
  constructor() {
    this.cache = new Map();
    this.CACHE_TTL = 30 * 60 * 1000;
    this.allowedIntents = [
      'DOCUMENT_REQUEST',
      'LEGAL_INFORMATION',
      'DOCUMENT_MODIFICATION',
      'CONVERSATIONAL'
    ];
  }

  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.cachedAt > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }

  async classifyIntent(message, context = '') {
    if (!message || typeof message !== 'string') {
      return { type: 'CONVERSATIONAL', confidence: 0.5, metadata: { fallback: true } };
    }

    const trimmedMessage = message.trim();
    const cacheKey = `${trimmedMessage.toLowerCase()}:${context.slice(-100)}`;
    const cached = this.cache.get(cacheKey);

    if (cached && (Date.now() - cached.cachedAt < this.CACHE_TTL)) {
      return {
        type: cached.type,
        confidence: cached.confidence,
        metadata: { ...cached.metadata, fromCache: true },
        originalMessage: message
      };
    }

    const combined = `${context} ${trimmedMessage}`.trim();
    const msgLower = trimmedMessage.toLowerCase();
    const lower = combined.toLowerCase();

    const docTypeMatch = this.detectExplicitDocRequest(msgLower);
    if (docTypeMatch) {
      const docType = docTypeMatch.type;
      const docClass = {
        type: 'DOCUMENT_REQUEST',
        confidence: 0.85,
        metadata: { fast: true, documentType: docType, hasAllInfo: this.checkCompleteness(combined, docType), timestamp: new Date().toISOString(), hasContext: context.length > 0 },
        originalMessage: message
      };
      this.cache.set(cacheKey, { ...docClass, cachedAt: Date.now() });
      this.cleanCache();
      return docClass;
    }

    const hesitationRegex = /(guide me|i'?m not sure|not sure|help me|could you guide|unsure|i need help|guide me please|mujhe ni|nahi pata|pata nahi|mujhe nahi|malum nahi|kya banau|samajh nahi|sure nahi|confused|what should|\u092e\u0941\u091d\u0947 \u0928\u0939\u0940\u0902|\u0928\u0939\u0940\u0902 \u092a\u0924\u093e|\u092a\u0924\u093e \u0928\u0939\u0940\u0902|\u0915\u094d\u092f\u093e \u092c\u0928\u093e\u090a\u0902|\u0938\u092e\u091d \u0928\u0939\u0940\u0902)/i;
    if (hesitationRegex.test(msgLower)) {
      const conv = {
        type: 'CONVERSATIONAL',
        confidence: 0.9,
        metadata: { fast: true, reason: 'hesitation_detected', keywords: this.extractKeywords(combined), timestamp: new Date().toISOString(), hasContext: context.length > 0, isHesitation: true },
        originalMessage: message
      };
      this.cache.set(cacheKey, { ...conv, cachedAt: Date.now() });
      this.cleanCache();
      return conv;
    }

    const legalQueryPhrases = [
      /what (should|can|do) i do/i,
      /how (should|can|do) i/i,
      /what are my (rights|options)/i,
      /can i file/i,
      /is it legal/i,
      /what is the (law|procedure|process)/i,
      /explain|tell me about/i,
      /what happens if/i,
      /am i (liable|responsible|allowed)/i,
      /kya (karna|karein|karu|karun|krna|krein|kru) (chahiye|chaiye|chahie)/i,
      /kya (kare|karun|karu|krein|kru)\b/i,
      /mujhe kya (karna|krna)/i,
      /kaise (kare|karun|karu|karein|krein)\b/i,
      /kya (ho|hoga|hogi|sakta|sakti)/i,
      /batao|bataiye|bataye/i,
      /samjhao|samjhaiye|samjhaye/i,
      /madad (karo|karein|kijiye|chahiye)/i,
      /help (chahiye|karo|karein)/i,
      /suggest(ion)? (do|dijiye|karo)/i,
      /salah (do|dijiye|chahiye)/i,
      /advice (chahiye|do|dijiye)/i,
      /kya (kar|kr) sakta/i,
      /maine.*kya (karna|krna)/i,
      /mera.*kya (hoga|ho sakta)/i,
      /police|fir|complaint|shikayat/i,
      /chori|theft|stolen|chura/i,
      /problem|issue|pareshani|dikkat/i
    ];

    const isLegalQuery = legalQueryPhrases.some(pattern => pattern.test(lower));
    const noDocKeywordStrict = !/\b(deed|agreement|lease|rental|notice|affidavit|will|contract|draft|document|letter|template|generate|create|banao|banana|likho|likhna)\b/i.test(lower);

    if (isLegalQuery && noDocKeywordStrict) {
      const legalInfo = {
        type: 'LEGAL_INFORMATION',
        confidence: 0.9,
        metadata: { 
          fast: true, 
          reason: 'legal_query_detected', 
          keywords: this.extractKeywords(combined), 
          topics: this.extractTopics(combined),
          timestamp: new Date().toISOString(), 
          hasContext: context.length > 0 
        },
        originalMessage: message
      };
      this.cache.set(cacheKey, { ...legalInfo, cachedAt: Date.now() });
      this.cleanCache();
      return legalInfo;
    }

    const conversationalPhrases = [
      /^(namaste|namaskar|pranam|hello|hi|hy|hyy|hii|hlo|hey|heyy|yo|sup|greetings)\b/i,
      /^(aap|tum|ap) (kaun|kon|kya|kaise)/i,
      /^(mera naam|my name)/i,
      /\b(dhanyawad|shukriya|thanks|thank you)\b/i,
      /^(theek|thik|accha|acha|okay|ok|sure)\b/i,
      /^(haan|han|nahi|nhi|yes|no)\s*$/i,
      /i (was|am|have been|had)/i,
      /mere saath|mujhe|mera|meri/i
    ];

    const isConversational = conversationalPhrases.some(pattern => pattern.test(lower));
    if (isConversational && noDocKeywordStrict && !isLegalQuery) {
      const conv = {
        type: 'CONVERSATIONAL',
        confidence: 0.85,
        metadata: { fast: true, reason: 'conversational_phrase_detected', keywords: this.extractKeywords(combined), timestamp: new Date().toISOString(), hasContext: context.length > 0 },
        originalMessage: message
      };
      this.cache.set(cacheKey, { ...conv, cachedAt: Date.now() });
      this.cleanCache();
      return conv;
    }

    try {
      const classification = await this.performClassification(message, context);
      this.cache.set(cacheKey, { ...classification, cachedAt: Date.now(), hasContext: context.length > 0 });
      this.cleanCache();
      return classification;
    } catch (error) {
      console.error('Intent classification failed:', error);
      return this.getFallbackClassification(message);
    }
  }

  detectExplicitDocRequest(msgLower) {
    const patterns = [
      { regex: /\b(rental|rent|lease)\s+(agreement|deed|contract)\b/i, type: 'rental_agreement' },
      { regex: /\b(sale)\s+(deed|agreement|contract)\b/i, type: 'sale_deed' },
      { regex: /\b(gift)\s+(deed)\b/i, type: 'gift_deed' },
      { regex: /\b(affidavit|declaration)\b/i, type: 'affidavit' },
      { regex: /\b(notice|legal notice)\b/i, type: 'legal_notice' },
      { regex: /\b(power of attorney|poa)\b/i, type: 'power_of_attorney' },
      { regex: /\b(will|testament)\b/i, type: 'will' },
      { regex: /\b(adoption)\s+(deed|paper|document)\b/i, type: 'adoption_deed' },
      { regex: /\b(complaint|fir)\b/i, type: 'complaint' }
    ];

    for (const p of patterns) {
      if (p.regex.test(msgLower)) {
        return p;
      }
    }
    return null;
  }

  checkCompleteness(text, docType) {
    const reqFields = {
      rental_agreement: ['landlord', 'tenant', 'rent', 'address'],
      sale_deed: ['seller', 'buyer', 'amount', 'property'],
      gift_deed: ['donor', 'donee', 'property'],
      affidavit: ['deponent', 'fact', 'purpose'],
      legal_notice: ['sender', 'recipient', 'claim', 'demand'],
      power_of_attorney: ['principal', 'attorney', 'power'],
      will: ['testator', 'beneficiary', 'property'],
      adoption_deed: ['adoptive', 'child', 'natural'],
      complaint: ['complainant', 'accused', 'offense']
    };

    const fields = reqFields[docType] || [];
    if (!fields.length) return false;

    const lower = text.toLowerCase();
    let count = 0;
    for (const f of fields) {
      if (lower.includes(f)) count++;
    }
    return count >= Math.ceil(fields.length * 0.6);
  }

  extractKeywords(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/gi, '')
      .split(/\s+/)
      .filter(w => w.length > 3)
      .slice(0, 10);
  }

  extractTopics(text) {
    const topics = [];
    const lower = text.toLowerCase();
    if (/rent|landlord|tenant|lease/i.test(lower)) topics.push('property_rental');
    if (/police|fir|stolen|theft|crime|criminal/i.test(lower)) topics.push('criminal_law');
    if (/sale|property|land|flat|house/i.test(lower)) topics.push('property_sale');
    if (/marriage|divorce|adoption|custody|will/i.test(lower)) topics.push('family_law');
    if (/notice|cheque|bounce|money|recovery|debt/i.test(lower)) topics.push('civil_recovery');
    return topics;
  }

  calculateConfidence(message, category) {
    const lower = message.toLowerCase();
    let score = 0;

    const strongIndicators = {
      DOCUMENT_REQUEST: ['deed', 'adoption', 'sale', 'lease', 'affidavit', 'notice', 'will', 'agreement', 'letter', 'complaint'],
      LEGAL_INFORMATION: ['what is', 'section', 'law', 'penalty', 'punishment', 'explain', 'define', 'how', 'why'],
      DOCUMENT_MODIFICATION: ['edit', 'change', 'modify', 'update', 'fix', 'correct', 'amend'],
      CONVERSATIONAL: ['hello', 'hi', 'hy', 'thank', 'help', 'bye', 'hey']
    };

    const indicators = strongIndicators[category] || [];
    const maxScore = indicators.length || 1;

    for (const indicator of indicators) {
      if (lower.includes(indicator)) score++;
    }

    const rawConfidence = Math.min(score / maxScore, 1);
    return Math.max(rawConfidence, 0.5);
  }

  getFallbackClassification(message) {
    const lower = message.toLowerCase();

    if (lower.includes('deed') || lower.includes('agreement') || lower.includes('affidavit')) {
      return { type: 'DOCUMENT_REQUEST', confidence: 0.7, metadata: { fallback: true } };
    }

    if (lower.includes('what') || lower.includes('how') || lower.includes('why') || lower.includes('section')) {
      return { type: 'LEGAL_INFORMATION', confidence: 0.7, metadata: { fallback: true } };
    }

    return { type: 'CONVERSATIONAL', confidence: 0.5, metadata: { fallback: true } };
  }

  async performClassification(message, context = '') {
    const contextLine = context.trim() ? `\n\nRecent conversation context:\n${context}` : '';
    const prompt = `
You are a strict intent classifier for a legal AI assistant (Indian law). Classify user messages into ONE of these categories:

DOCUMENT_REQUEST - User explicitly wants to CREATE/GENERATE/DRAFT a legal document
  Examples: "I need a rental agreement", "draft a legal notice", "create an affidavit", "make a sale deed"
  
LEGAL_INFORMATION - User is ASKING FOR ADVICE, GUIDANCE, or INFORMATION about law/legal matters
  Examples: "What should I do if someone stole my wallet?", "What are my rights?", "Is this legal?", "kya karna chahiye?", "How to file FIR?"
  
DOCUMENT_MODIFICATION - User wants to EDIT/CHANGE an existing document
  Examples: "change the name in document", "update the address", "fix the date"
  
CONVERSATIONAL - Greetings, thanks, general chat, unclear requests
  Examples: "hello", "thanks", "ok", "tell me more"

IMPORTANT RULES:
- If user describes a situation/problem and asks "what should I do?" or "kya karna chahiye?" → LEGAL_INFORMATION (NOT document request!)
- If user mentions theft/FIR/police/complaint as a situation → LEGAL_INFORMATION
- Only use DOCUMENT_REQUEST if user explicitly says create/generate/draft/make/need a [document type]
- When in doubt between LEGAL_INFORMATION and DOCUMENT_REQUEST, prefer LEGAL_INFORMATION

Output ONLY the label, nothing else.${contextLine}

User message: "${message}"
`;

    try {
      const response = await this.callLocalLLaMA(prompt);
      const category = response.trim().toUpperCase();

      if (!this.allowedIntents.includes(category)) {
        return this.getFallbackClassification(message);
      }

      return {
        type: category,
        confidence: this.calculateConfidence(message, category),
        metadata: this.extractMetadata(message, category),
        originalMessage: message
      };
    } catch (err) {
      return this.getFallbackClassification(message);
    }
  }

  extractMetadata(message, category) {
    return {
      keywords: this.extractKeywords(message),
      topics: this.extractTopics(message),
      timestamp: new Date().toISOString()
    };
  }

  async callLocalLLaMA(prompt) {
    const timeoutMs = Number(process.env.INTENT_LLM_TIMEOUT_MS) || 15000;
    try {
      const response = await axios.post(
        'http://localhost:11434/api/generate',
        {
          model: 'llama3.1:8b',
          prompt,
          stream: false,
          options: { temperature: 0.1, top_p: 0.9, num_predict: 10 }
        },
        { timeout: timeoutMs }
      );
      return response.data?.response || 'CONVERSATIONAL';
    } catch (error) {
      return 'CONVERSATIONAL';
    }
  }
}

export const intentClassifier = new IntentClassifierService();
export default intentClassifier;
