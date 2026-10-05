import axios from 'axios';

class DocumentExtractor {
  constructor() {
    this.cache = new Map();
  }

  async extractFields(message, documentType, schema = []) {
    const cacheKey = `${message}_${documentType}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const extractedData = await this.extractWithAI(message, documentType, schema);

      
      const validatedData = await this.validateAndEnrich(extractedData, schema);

      const result = this.calculateCompleteness(validatedData, schema);

      this.cache.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error('Field extraction failed:', error);
      return this.getFallbackExtraction(message, documentType, schema);
    }
  }

  async extractWithAI(message, documentType, schema) {
    const fieldsList = schema.map(f => `${f.key}: ${f.label} (example: ${f.example || 'N/A'})`).join('\n');

    const prompt = `
You are a legal document data extractor. Extract ONLY the information that the user has EXPLICITLY provided.

CRITICAL RULES:
1. ONLY extract information the user has ACTUALLY stated in their message
2. DO NOT invent, assume, or hallucinate any values
3. DO NOT use example values from the schema as actual values
4. If a field is not mentioned, return null for that field
5. If information is ambiguous, return null

USER INPUT: "${message}"

FIELDS TO EXTRACT:
${fieldsList}

For each field:
- If the user explicitly provided this information → extract it exactly as stated
- If the user did NOT mention this information → return null
- NEVER make up names, addresses, amounts, dates, or any other values

Examples of WRONG behavior:
- User says "generate sale deed" → DO NOT assume any names or amounts
- User says "for my property" → DO NOT invent a property address

Examples of CORRECT behavior:
- User says "seller is Rajesh Kumar" → vendor_name: "Rajesh Kumar"
- User says "property at MG Road Mumbai" → property_address: "MG Road Mumbai"
- User does not mention buyer name → purchaser_name: null

Respond ONLY with a valid JSON object. No explanations.
{
  "field1": "extracted_value_or_null",
  "field2": null
}
`;

    const response = await this.callLocalLLaMA(prompt);
    const safeParsed = this.safeParseAIResponse(response);

    if (!safeParsed) {
      console.error('❌ SAFE PARSE FAILED - returning empty extraction');
      return this.forceUserInput(schema);
    }

    
    const cleanedData = this.removeHallucinatedValues(safeParsed, message, schema);
    return cleanedData;
  }

  removeHallucinatedValues(extractedData, userMessage, schema) {
    const cleaned = {};
    const messageLower = userMessage.toLowerCase();
    
    
    const legalFields = ['section_invoked', 'court_name', 'legal_codes', 'procedures', 'act'];
    
    for (const [key, value] of Object.entries(extractedData)) {
      if (value === null || value === undefined || value === '') {
        cleaned[key] = null;
        continue;
      }
      
      
      if (legalFields.includes(key)) {
        cleaned[key] = value;
        continue;
      }
      
      
      const valueStr = String(value).toLowerCase();
      const valueWords = valueStr.split(/\s+/).filter(w => w.length > 2);
      
      
      const foundInMessage = valueWords.some(word => {
        
        if (['the', 'and', 'for', 'from', 'with', 'this', 'that'].includes(word)) return true;
        return messageLower.includes(word);
      });
      
      
      const isExampleData = this.isLikelyExampleData(value, schema, key);
      
      if (foundInMessage && !isExampleData) {
        cleaned[key] = value;
      } else {
        console.log(`🚫 Rejected hallucinated value for ${key}: "${value}" (not in user message)`);
        cleaned[key] = null;
      }
    }
    
    return cleaned;
  }

  isLikelyExampleData(value, schema, key) {
    const valueStr = String(value).toLowerCase();
    
    
    const fieldSchema = schema.find(f => f.key === key);
    if (fieldSchema?.example && valueStr === String(fieldSchema.example).toLowerCase()) {
      return true;
    }
    
    
    const hallucinationPatterns = [
      /amit\s*sharma/i,
      /priya\s*patel/i,
      /rajesh\s*kumar/i,
      /authorized\s*signatory/i,
      /address\s*as\s*mentioned/i,
      /plot\s*no\.?\s*\d+.*sector/i,
      /the\s*(complainant|respondent|vendor|purchaser)/i,
      /rs\.?\s*\d+,\d+,\d+/i,
      /\d{4}-\d{2}-\d{2}/,
    ];
    
    return hallucinationPatterns.some(pattern => pattern.test(valueStr));
  }

  async callLocalLLaMA(prompt) {
    const response = await axios.post(
      'http://localhost:11434/api/generate',
      {
        model: 'llama3.1:8b',
        prompt,
        stream: false
      },
      { timeout: 20000 }
    );

    return response?.data?.response || '';
  }
    
  sanitizeJsonString(raw) {
    return raw
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
      .replace(/,\s*([}\]])/g, '$1')
      .trim();
  }

  safeParseAIResponse(raw) {
    if (!raw || typeof raw !== 'string') return null;

    
    const codeBlockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    let candidate = codeBlockMatch ? codeBlockMatch[1] : raw;

    
    if (!codeBlockMatch) {
      const first = candidate.indexOf('{');
      const last = candidate.lastIndexOf('}');
      if (first >= 0 && last > first) candidate = candidate.slice(first, last + 1);
    }

    
    candidate = candidate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1').trim();

    
    try {
      return JSON.parse(candidate);
    } catch (err) {
      
      let depth = 0;
      let start = -1;
      for (let i = 0; i < candidate.length; i++) {
        const ch = candidate[i];
        if (ch === '{') {
          if (start === -1) start = i;
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && start !== -1) {
            const sub = candidate.slice(start, i + 1).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/,\s*([}\]])/g, '$1');
            try {
              return JSON.parse(sub);
            } catch (e) {
              
              start = -1;
            }
          }
        }
      }
    }

    return null;
  }


  forceUserInput(schema) {
    return {
      __forceUserInput: true,
      data: {},
      completeness: 0,
      filledFields: [],
      missingFields: schema.map(f => ({
        key: f.key,
        label: f.label
      })),
      canGenerate: false,
      confidence: 0,
      extractionError: 'INVALID_AI_JSON'
    };
  }

  async validateAndEnrich(extractedData, schema) {
    const enriched = { ...extractedData };

    
    const userFields = ['name', 'address', 'amount', 'vendor', 'purchaser', 'seller', 'buyer', 
                        'landlord', 'tenant', 'complainant', 'respondent', 'accused', 'petitioner',
                        'property', 'flat', 'plot', 'land', 'signatory', 'witness'];

    for (const field of schema) {
      const fieldKey = field.key;
      const currentValue = enriched[fieldKey];
      const keyLower = field.key.toLowerCase();

      
      const isUserField = userFields.some(term => keyLower.includes(term));
      
      
      const isLegalTechnicality = ['section', 'court', 'code', 'procedure', 'act', 'legal']
        .some(term => keyLower.includes(term));

      if (!currentValue && field.type !== 'optional') {
        if (isLegalTechnicality && !isUserField) {
          
          enriched[fieldKey] = this.generateLegalDefault(field, extractedData);
        }
        
      }

      if (currentValue) {
        enriched[fieldKey] = await this.validateFieldFormat(currentValue, field);
      }
    }

    return enriched;
  }

  async inferMissingField(field, extractedData, schema) {
    const fieldKey = field.label || field.key.toLowerCase();
    const currentData = Object.values(extractedData)
      .filter(v => v && typeof v === 'string')
      .join(' ');

    const prompt = `
Based on this context, what is a reasonable value for "${fieldKey}"?

CONTEXT: "${currentData}"
FIELD TYPE: ${field.type}
EXAMPLE: ${field.example || 'N/A'}

Provide a reasonable value or null if not possible to infer.
Respond with just the value or "null".
`;

    
    const response = await this.callLocalLLaMA(prompt);
    const cleanResponse = response.trim().replace(/['"]/g, '');

    return cleanResponse === 'null' || cleanResponse.includes('not possible')
      ? null
      : cleanResponse;
  }


  autoFillLegalFields(data, context) {
    const lowerContext = context.toLowerCase();

    if (!data.date) {
      data.date = new Date().toISOString().split('T')[0];
    }

    if (!data.place) {
      data.place = 'India';
    }

    if (lowerContext.includes('agreement') && !data.legal_act) {
      data.legal_act = 'Indian Contract Act, 1872';
    }

    return data;
  }

  generateLegalDefault(field, extractedData) {
    const key = field.key.toLowerCase();

    if (key.includes('court')) return 'District Court';
    if (key.includes('section')) return 'Relevant applicable sections';
    if (key.includes('act')) return 'Applicable Indian Law';

    return 'As per law';
  }


  calculateCompleteness(data, schema) {
    const requiredFields = schema.filter(f => f.required);
    const filledFields = [];
    const missingFields = [];

    for (const field of requiredFields) {
      const value = data[field.key];
      if (value && (typeof value === 'string' ? value.trim().length > 0 : true)) {
        filledFields.push(field.key);
      } else {
        missingFields.push({ key: field.key, label: field.label });
      }
    }

    return {
      data,
      completeness: (filledFields.length / requiredFields.length) * 100,
      filledFields,
      missingFields,
      canGenerate: missingFields.length === 0,
      confidence: this.calculateExtractionConfidence(data, schema)
    };
  }

  calculateExtractionConfidence(data, schema) {
    const totalFields = schema.length;
    const filledFields = Object.values(data)
      .filter(v => v !== null && v !== undefined && (typeof v === 'string' ? v.trim().length > 0 : true))
      .length;

    return Math.min(filledFields / totalFields, 1.0);
  }

  validateFieldFormat(value, field) {
    if (field.type === 'date' && /\d{4}-\d{2}-\d{2}/.test(value)) {
      return value;
    }
    return value;
  }

  parseExtractionFallback(response) {
    const extracted = {};
    const lines = response.split('\n');

    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        const cleanKey = key.trim().replace(/['"]/g, '').toLowerCase().replace(/\s+/g, '_');
        const cleanValue = value.trim().replace(/['"]/g, '');
        if (cleanValue && cleanValue !== 'null') {
          extracted[cleanKey] = cleanValue;
        }
      }
    }

    return extracted;
  }

  getFallbackExtraction(message, documentType, schema) {
    return this.calculateCompleteness({}, schema);
  }

}

export const documentExtractor = new DocumentExtractor();
