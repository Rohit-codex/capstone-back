


const SECTION_PATTERNS = [
  
  /^(?:ARTICLE\s+)?(?:[IVXLCDM]+|[0-9]+)[\.\):\s]+([A-Z][A-Z\s]+)$/m,
  /^(?:Section|SECTION)\s+(?:[0-9]+|[IVXLCDM]+)[\.\):\s]*(.*)$/m,
  /^(?:CLAUSE|Clause)\s+(?:[0-9]+|[IVXLCDM]+)[\.\):\s]*(.*)$/m,
  
  /^([A-Z][A-Z\s]{5,})$/m,
  
  /^(WHEREAS|NOW THEREFORE|WITNESSETH|RECITALS|DEFINITIONS|INTERPRETATION)/m,
];


const CLAUSE_TYPES = {
  definition: /^["']?[\w\s]+["']?\s+(?:means|shall mean|refers to|includes)/i,
  obligation: /\b(?:shall|must|will|agrees to|undertakes to)\b/i,
  prohibition: /\b(?:shall not|must not|may not|is prohibited|cannot)\b/i,
  representation: /\b(?:represents|warrants|represents and warrants)\b/i,
  indemnification: /\b(?:indemnif|hold harmless|defend)\b/i,
  termination: /\b(?:terminat|expir|cancel|end of term)\b/i,
  confidentiality: /\b(?:confidential|non-disclosure|proprietary)\b/i,
  limitation: /\b(?:limitation of liability|cap|maximum|aggregate)\b/i,
  payment: /\b(?:payment|fee|cost|price|compensation|remuneration)\b/i,
  governing_law: /\b(?:governing law|jurisdiction|venue|applicable law)\b/i,
  force_majeure: /\b(?:force majeure|act of god|beyond.+control)\b/i,
  assignment: /\b(?:assign|transfer|delegate)\b/i,
  notice: /\b(?:notice|notification|written notice)\b/i,
  amendment: /\b(?:amend|modif|supplement|vary)\b/i,
  severability: /\b(?:severab|invalid|unenforceable|void)\b/i,
  waiver: /\b(?:waiv|relinquish|forbear)\b/i,
  entire_agreement: /\b(?:entire agreement|whole agreement|complete agreement)\b/i,
};

export const detectDocumentType = (input) => {
  
  let text = typeof input === 'string' ? input : (input?.metadata?.title || '') + ' ' + (input?.sections?.map(s => s.heading).join(' ') || '');
  
  
  if (typeof input !== 'string' && input?.text) {
    text += ' ' + input.text;
  }
  
  
  console.log(`🔍 detectDocumentType input type: ${typeof input === 'string' ? 'string' : 'object'}`);
  console.log(`🔍 Document text (first 300 chars): ${text.substring(0, 300)}`);
  
  const lowerText = text.toLowerCase();
  
  
  if (/affidavit|sworn statement|deponent/i.test(text)) {
    console.log('✅ Matched: Affidavit');
    return 'Affidavit';
  }
  if (/power of attorney|attorney-in-fact/i.test(text)) {
    console.log('✅ Matched: Power of Attorney');
    return 'Power of Attorney';
  }
  if (/adopt.*son|adopt.*child|consent.*adopt|wife.*adopt|authority.*adopt/i.test(text)) {
    console.log('✅ Matched: Adoption Deed');
    return 'Adoption Deed';
  }
  if (
    /in\s+the\s+high\s+court|judicature|writ\s+jurisdiction|civil\s+writ|criminal\s+writ|cwjc|case\s*no\.?|petitioner\/s?|respondent\/s?|^\s*versus\s*$/im.test(text)
  ) {
    console.log('✅ Matched: Court Judgment/Order');
    return 'Court Judgment/Order';
  }
  if (/petition|petitioner|respondent/i.test(text)) {
    console.log('✅ Matched: Petition');
    return 'Petition';
  }
  if (/authority|authoris(?:e|ation)|authorized by/i.test(text)) {
    console.log('✅ Matched: Authorization Document');
    return 'Authorization Document';
  }
  if (/lease agreement|landlord|tenant|demised premises|rent agreement/i.test(text)) {
    console.log('✅ Matched: Lease Agreement');
    return 'Lease Agreement';
  }
  if (/employment agreement|employee|employer/i.test(text)) {
    console.log('✅ Matched: Employment Contract');
    return 'Employment Contract';
  }
  const hasNdaCore = /non-disclosure|confidentiality agreement|\bnda\b/i.test(text);
  const hasNdaContext = /disclosing party|receiving party|confidential information|purpose of disclosure|term and termination/i.test(text);
  if (hasNdaCore || (/\bconfidential\b/i.test(text) && hasNdaContext)) {
    console.log('✅ Matched: Non-Disclosure Agreement');
    return 'Non-Disclosure Agreement';
  }
  if (/sale deed|conveyance|seller|purchaser/i.test(text)) {
    console.log('✅ Matched: Sale Deed');
    return 'Sale Deed';
  }
  if (/service agreement|service provider/i.test(text)) {
    console.log('✅ Matched: Service Agreement');
    return 'Service Agreement';
  }
  if (/partnership|partner/i.test(text)) {
    console.log('✅ Matched: Partnership Deed');
    return 'Partnership Deed';
  }
  if (/will|testament|bequest|executor/i.test(text)) {
    console.log('✅ Matched: Will / Testament');
    return 'Will / Testament';
  }
  if (/loan agreement|borrower|lender/i.test(text)) {
    console.log('✅ Matched: Loan Agreement');
    return 'Loan Agreement';
  }
  if (/legal notice|notice is hereby/i.test(text)) {
    console.log('✅ Matched: Legal Notice');
    return 'Legal Notice';
  }
  if (/mortgage|hypothecation/i.test(text)) {
    console.log('✅ Matched: Mortgage Deed');
    return 'Mortgage Deed';
  }
  if (/gift deed|donee|donor/i.test(text)) {
    console.log('✅ Matched: Gift Deed');
    return 'Gift Deed';
  }
  if (/bail|surety|accused/i.test(text)) {
    console.log('✅ Matched: Bail Application');
    return 'Bail Application';
  }
  if (/divorce|dissolution of marriage/i.test(text)) {
    console.log('✅ Matched: Divorce Petition');
    return 'Divorce Petition';
  }
  if (/arbitration|arbitrator/i.test(text)) {
    console.log('✅ Matched: Arbitration Agreement');
    return 'Arbitration Agreement';
  }
  if (/memorandum of understanding|mou/i.test(text)) {
    console.log('✅ Matched: MOU');
    return 'MOU';
  }
  if (/agreement|contract/i.test(text)) {
    console.log('✅ Matched: Agreement');
    return 'Agreement';
  }
  
  console.log('❌ No pattern matched, returning: Legal Document');
  return 'Legal Document';
};

export const parseDocumentStructure = (rawText, fileName = 'document') => {
  const lines = rawText.split('\n');
  const structure = {
    metadata: {
      title: extractTitle(lines, fileName),
      fileName,
      type: detectDocumentType(rawText),
      createdAt: new Date().toISOString(),
      charCount: rawText.length,
      lineCount: lines.length,
    },
    sections: [],
    summary: {
      sectionCount: 0,
      clauseCount: 0,
      clauseTypes: {},
    }
  };

  let currentSection = null;
  let currentClauseNumber = 0;
  let sectionNumber = 0;
  let buffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    
    if (!line) {
      
      if (buffer.length > 0 && currentSection) {
        flushBuffer(buffer, currentSection, currentClauseNumber);
        buffer = [];
      }
      continue;
    }

    
    const sectionMatch = detectSectionHeading(line);
    if (sectionMatch) {
      
      if (currentSection) {
        if (buffer.length > 0) {
          flushBuffer(buffer, currentSection, currentClauseNumber);
        }
        structure.sections.push(currentSection);
      }

      sectionNumber++;
      currentClauseNumber = 0;
      currentSection = {
        id: `s${sectionNumber}`,
        number: sectionMatch.number || String(sectionNumber),
        heading: sectionMatch.heading,
        text: '',
        clauses: [],
        startLine: i + 1,
      };
      buffer = [];
      continue;
    }

    
    const clauseMatch = detectClause(line);
    if (clauseMatch && currentSection) {
      if (buffer.length > 0) {
        flushBuffer(buffer, currentSection, currentClauseNumber);
        buffer = [];
      }
      currentClauseNumber++;
      
      const clauseType = detectClauseType(line + ' ' + lines.slice(i + 1, i + 3).join(' '));
      currentSection.clauses.push({
        id: `${currentSection.id}.c${currentClauseNumber}`,
        number: clauseMatch.number || `${currentSection.number}.${currentClauseNumber}`,
        text: line,
        type: clauseType,
        lineNumber: i + 1,
      });
      continue;
    }

    
    buffer.push(line);
  }

  
  if (currentSection) {
    if (buffer.length > 0) {
      flushBuffer(buffer, currentSection, currentClauseNumber);
    }
    structure.sections.push(currentSection);
  } else if (buffer.length > 0) {
    
    structure.sections.push({
      id: 's1',
      number: '1',
      heading: 'DOCUMENT CONTENT',
      text: buffer.join('\n'),
      clauses: parseClausesFromText(buffer.join('\n')),
      startLine: 1,
    });
  }

  
  structure.summary.sectionCount = structure.sections.length;
  structure.summary.clauseCount = structure.sections.reduce((sum, s) => sum + s.clauses.length, 0);
  
  
  structure.sections.forEach(section => {
    section.clauses.forEach(clause => {
      if (clause.type) {
        structure.summary.clauseTypes[clause.type] = (structure.summary.clauseTypes[clause.type] || 0) + 1;
      }
    });
  });

  return structure;
};

const extractTitle = (lines, fileName) => {
  
  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const line = lines[i].trim();
    if (line && line.length > 5 && line.length < 100) {
      
      if (/^[A-Z][A-Z\s]+$/.test(line) || /agreement|contract|deed|notice|affidavit/i.test(line)) {
        return line;
      }
    }
  }
  
  return fileName.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');
};

const detectSectionHeading = (line) => {
  
  let match = line.match(/^(?:ARTICLE|Article)\s+([IVXLCDM]+|[0-9]+)[\.\):\s]*(.*)$/);
  if (match) {
    return { number: match[1], heading: match[2] || `ARTICLE ${match[1]}` };
  }

  match = line.match(/^(?:SECTION|Section)\s+([0-9]+|[IVXLCDM]+)[\.\):\s]*(.*)$/);
  if (match) {
    return { number: match[1], heading: match[2] || `SECTION ${match[1]}` };
  }

  
  match = line.match(/^([0-9]+)[\.\)]\s+([A-Z][A-Z\s]+)$/);
  if (match) {
    return { number: match[1], heading: match[2] };
  }

  
  if (/^[A-Z][A-Z\s]{4,50}$/.test(line) && !line.includes('  ')) {
    return { number: null, heading: line };
  }

  
  if (/^(WHEREAS|RECITALS|WITNESSETH|NOW,?\s*THEREFORE|DEFINITIONS|INTERPRETATION|SCHEDULES?)$/i.test(line)) {
    return { number: null, heading: line.toUpperCase() };
  }

  return null;
};

const detectClause = (line) => {
  
  let match = line.match(/^([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s+/);
  if (match) return { number: match[1] };

  match = line.match(/^\(([a-z]|[ivx]+|[0-9]+)\)\s+/i);
  if (match) return { number: `(${match[1]})` };

  match = line.match(/^([a-z]|[ivx]+)[\.\)]\s+/i);
  if (match) return { number: match[1] };

  return null;
};

const detectClauseType = (text) => {
  for (const [type, pattern] of Object.entries(CLAUSE_TYPES)) {
    if (pattern.test(text)) {
      return type;
    }
  }
  return 'general';
};

const flushBuffer = (buffer, section, clauseNum) => {
  const text = buffer.join('\n').trim();
  if (!text) return;

  if (section.clauses.length === 0) {
    
    section.text = (section.text ? section.text + '\n' : '') + text;
  } else {
    
    const lastClause = section.clauses[section.clauses.length - 1];
    lastClause.text = lastClause.text + '\n' + text;
  }
};

const parseClausesFromText = (text) => {
  const clauses = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  let clauseNum = 0;

  for (const sentence of sentences) {
    if (sentence.length > 30) {
      const type = detectClauseType(sentence);
      if (type !== 'general' || clauseNum < 10) {
        clauseNum++;
        clauses.push({
          id: `c${clauseNum}`,
          number: String(clauseNum),
          text: sentence.trim(),
          type,
        });
      }
    }
  }

  return clauses;
};

export const structureToText = (structure) => {
  let text = '';

  if (structure.metadata?.title) {
    text += structure.metadata.title.toUpperCase() + '\n\n';
  }

  for (const section of structure.sections) {
    if (section.heading) {
      text += `${section.number ? section.number + '. ' : ''}${section.heading}\n\n`;
    }
    if (section.text) {
      text += section.text + '\n\n';
    }
    for (const clause of section.clauses) {
      text += `${clause.number} ${clause.text}\n\n`;
    }
  }

  return text.trim();
};

export const analyzeDocumentRisks = (input) => {
  const structure = typeof input === 'string' ? parseDocumentStructure(input) : input;
  const risks = [];
  const suggestions = [];

  
  const foundTypes = new Set(Object.keys(structure.summary.clauseTypes));
  const criticalTypes = ['governing_law', 'termination', 'limitation', 'indemnification'];
  
  for (const type of criticalTypes) {
    if (!foundTypes.has(type)) {
      suggestions.push({
        type: 'missing_clause',
        severity: 'warning',
        message: `Consider adding a ${type.replace(/_/g, ' ')} clause`,
      });
    }
  }

  
  structure.sections.forEach(section => {
    section.clauses.forEach(clause => {
      
      if (clause.type === 'indemnification' && !/cap|limit|maximum/i.test(clause.text)) {
        risks.push({
          clauseId: clause.id,
          type: 'unlimited_indemnification',
          severity: 'high',
          message: 'Indemnification clause has no cap - consider adding a limitation',
        });
      }

      
      if (clause.type === 'termination' && /at any time|without cause|sole discretion/i.test(clause.text)) {
        risks.push({
          clauseId: clause.id,
          type: 'unilateral_termination',
          severity: 'medium',
          message: 'Termination clause may be one-sided',
        });
      }
    });
  });

  return { risks, suggestions };
};


export const parseDocument = parseDocumentStructure;

export default {
  parseDocumentStructure,
  parseDocument,
  detectDocumentType,
  structureToText,
  analyzeDocumentRisks,
};
