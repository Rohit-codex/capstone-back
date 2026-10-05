import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import mammoth from 'mammoth';
import { extractDocxStructure, extractDocxText as extractDocxTextStructured } from './docxStructureExtractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


async function resolveTemplatesRoot() {
  const candidateEnv = process.env.TEMPLATE_ROOT;
  const pluralRepo = path.resolve(__dirname, '../normalized_templates');
  const singularRepo = path.resolve(__dirname, '../normalized_template');

  const candidates = [candidateEnv, pluralRepo, singularRepo].filter(Boolean);

  for (const dir of candidates) {
    try {
      const stat = await fs.stat(dir);
      if (stat && stat.isDirectory()) return dir;
    } catch (_) {}
  }
  return null;
}

let NORMALIZED_ROOT = await resolveTemplatesRoot();
if (!NORMALIZED_ROOT) {
  NORMALIZED_ROOT = path.resolve(__dirname, '../normalized_templates');
}

console.log(`📁 Templates root: ${NORMALIZED_ROOT}`);

let cachedTemplates = null;

function toDisplayTitle(relPathOrTitle) {
  const base = path.basename(relPathOrTitle, path.extname(relPathOrTitle));
  const name = base.replace(/[_-]+/g, ' ');
  const lowerWords = new Set(['of','a','an','the','and','or','to','for','from','in','on','with','by']);
  return name
    .split(' ')
    .filter(Boolean)
    .map((w, i) => {
      const wl = w.toLowerCase();
      if (i === 0 || !lowerWords.has(wl)) return wl.charAt(0).toUpperCase() + wl.slice(1);
      return wl;
    })
    .join(' ');
}

export function getDisplayTitleForRelPath(relPathStr) {
  return toDisplayTitle(relPathStr);
}

async function readJsonMetadata(absPath) {
  const jsonPath = absPath.replace(/\.docx$/i, '.json');
  try {
    const raw = await fs.readFile(jsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function extractDocxText(absPath) {
  try {
    return await extractDocxTextStructured(absPath);
  } catch (err) {
    console.warn('docxStructureExtractor failed, falling back to mammoth:', err.message);
    try {
      const result = await mammoth.extractRawText({ path: absPath });
      return (result?.value || '').trim();
    } catch (e2) {
      console.error('DOCX extraction error (mammoth fallback):', absPath, e2.message);
      return '';
    }
  }
}

async function parseTemplateFile(absPath, relPathStr) {
  const meta = await readJsonMetadata(absPath);
  const schema = Array.isArray(meta?.fields) ? meta.fields : [];
  const metaTitle = meta?.title ? meta.title.replace(/\s+/g, ' ').trim() : '';
  const displayTitle = metaTitle || toDisplayTitle(relPathStr);

  return {
    relPath: relPathStr,
    template: '',
    schema,
    displayTitle,
    filePath: absPath,
    metaPath: absPath.replace(/\.docx$/i, '.json'),
    description: meta?.description || '',
    description_hi: meta?.description_hi || '',
    category: meta?.category || '',
    subcategory: meta?.subcategory || null,
    placeholder_order: Array.isArray(meta?.placeholder_order) ? meta.placeholder_order : null,
  };
}

export async function loadTemplates() {
  if (cachedTemplates) return cachedTemplates;
  const out = [];

  try {
    const stat = await fs.stat(NORMALIZED_ROOT);
    if (!stat.isDirectory()) throw new Error();
  } catch {
    cachedTemplates = [];
    return cachedTemplates;
  }

  async function walk(dir, relBase = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name.startsWith('.')) continue;
      const abs = path.join(dir, ent.name);
      
      const rel = path.join(relBase, ent.name).replace(/\\/g, '/');
      if (ent.isDirectory()) await walk(abs, rel);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith('.docx')) {
        const meta = await parseTemplateFile(abs, rel);
        if (meta) out.push(meta);
      }
    }
  }

  await walk(NORMALIZED_ROOT);
  cachedTemplates = out;
  return cachedTemplates;
}

export async function getAllTemplates() {
  return loadTemplates();
}

export async function getTemplateText(template) {
  if (!template?.filePath) return '';
  if (template.template) return template.template;

  const ext = path.extname(template.filePath).toLowerCase();
  if (ext !== '.docx') {
    console.warn(`Template is not DOCX format: ${template.filePath}`);
    return '';
  }

  const text = await extractDocxText(template.filePath);
  template.template = text;
  return text;
}

export async function getTemplateBuffer(template) {
  if (!template?.filePath) return null;
  const ext = path.extname(template.filePath).toLowerCase();
  if (ext !== '.docx') {
    console.warn(`Template is not DOCX format: ${template.filePath}`);
    return null;
  }
  return fs.readFile(template.filePath);
}

export async function getTemplateStructure(template) {
  if (!template?.filePath) return null;
  const ext = path.extname(template.filePath).toLowerCase();
  if (ext !== '.docx') return null;
  try {
    return await extractDocxStructure(template.filePath);
  } catch (err) {
    console.error('getTemplateStructure failed:', err.message);
    return null;
  }
}

export async function findBestTemplate(contextText, guidanceContext = null) {
  const text = (contextText || '').toLowerCase();
  const tokens = text.split(/\W+/).filter(w => w.length > 2);
  const tokenSet = new Set(tokens);
  let templates = await loadTemplates();
  
  
  
  
  
  const categoryToFolder = {
    'property': ['Deeds', 'Sale', 'Rent', 'Lease'],
    'family': ['Family Law Drafts', 'Adoption', 'Will & Gift Deed', 'Divorce'],
    'contracts': ['Bond Drafts', 'Agreement', 'Arbitration', 'Power of Attorney'],
    'criminal': ['Criminal Pleadings Drafts', 'FIR', 'Bail'],
    'consumer': ['Legal Notice', 'Consumer', 'Complaint'],
    'employment': ['Employment', 'Service', 'Termination'],
    'other': null
  };
  
  let categoryFilter = null;
  if (guidanceContext?.mainCategory) {
    const category = guidanceContext.mainCategory.toLowerCase();
    categoryFilter = categoryToFolder[category] || null;
    
    if (categoryFilter) {
      console.log(`🎯 Filtering templates by category: ${category} → folders: ${categoryFilter.join(', ')}`);
      const originalCount = templates.length;
      templates = templates.filter(t => {
        const path = t.relPath.toLowerCase();
        return categoryFilter.some(folder => path.includes(folder.toLowerCase()));
      });
      console.log(`📂 Filtered from ${originalCount} to ${templates.length} templates based on category`);
    }
  }

  
  
  
  
  
  
  const isFIRRequest = text.includes('fir') || text.includes('first information report') ||
    text.includes('police complaint') || text.includes('file a complaint') ||
    (text.includes('stolen') && (text.includes('report') || text.includes('police'))) ||
    (text.includes('theft') && text.includes('report')) ||
    ((text.includes('domestic') || text.includes('abuse') || text.includes('assault') || text.includes('molest')) && 
     (text.includes('complaint') || text.includes('report') || text.includes('fir')));
  
  if (isFIRRequest) {
    console.log('🚨 FIR/Police complaint request detected - NO template available, will use AI generation');
    return null;
  }
  
  
  const isGeneralComplaintRequest = text.includes('written complaint') || 
    text.includes('complaint against') ||
    text.includes('complain against') ||
    (text.includes('generate') && text.includes('complaint')) ||
    (text.includes('draft') && text.includes('complaint') && !text.includes('consumer'));
  
  if (isGeneralComplaintRequest && !text.includes('consumer')) {
    console.log('📝 General written complaint request detected - NO template, will use AI generation');
    return null;
  }
  
  
  const isSaleDeedRequest = text.includes('sale deed') || text.includes('sale agreement') || 
    (text.includes('sale') && (text.includes('property') || text.includes('flat') || text.includes('land') || text.includes('house')));
  
  if (isSaleDeedRequest) {
    console.log('🏠 Sale deed request detected - restricting to sale templates');
    const saleTemplates = templates.filter(t => {
      const name = t.relPath.toLowerCase().replace(/\\/g, '/');
      const displayName = (t.displayTitle || '').toLowerCase();
      
      const isSaleTemplate = (name.includes('sale') || displayName.includes('sale'));
      const isInDeeds = name.includes('deed');
      return isSaleTemplate && isInDeeds;
    });
    
    console.log(`📋 Found ${saleTemplates.length} sale templates:`, saleTemplates.map(t => t.relPath));
    
    if (saleTemplates.length > 0) {
      
      let best = null;
      let bestScore = -1000;
      const isFlat = text.includes('flat') || text.includes('apartment') || text.includes('unit');
      const isLand = text.includes('land') || text.includes('plot') || text.includes('agriculture');
      
      for (const t of saleTemplates) {
        let score = 0;
        const name = t.relPath.toLowerCase().replace(/\\/g, '/');
        const displayName = (t.displayTitle || '').toLowerCase();
        
        
        if (name.includes('agreement')) {
          score -= 50;
          console.log(`  ❌ Penalizing "${t.displayTitle}" (-50 for agreement)`);
        }
        
        
        if (name.includes('sale _') || name.includes('sale_ ') || name.includes('sale_')) {
          score += 20;
          console.log(`  ✓ Boosting "${t.displayTitle}" (+20 for sale deed name)`);
        }
        
        
        if (isFlat && (name.includes('flat') || displayName.includes('flat'))) {
          score += 10;
          console.log(`  ✓ Boosting "${t.displayTitle}" (+10 for flat match)`);
        }
        if (isLand && (name.includes('land') || displayName.includes('land'))) {
          score += 10;
          console.log(`  ✓ Boosting "${t.displayTitle}" (+10 for land match)`);
        }
        
        
        if (!isFlat && !isLand) {
          if (name.includes('flat') || displayName.includes('flat')) {
            score += 5;
            console.log(`  ✓ Boosting "${t.displayTitle}" (+5 default flat preference)`);
          }
        }
        
        console.log(`  📊 Template "${t.displayTitle}" final score: ${score}`);
        
        if (score > bestScore) {
          best = t;
          bestScore = score;
        }
      }
      
      if (best) {
        console.log(`✅ Selected sale template: ${best.displayTitle} (score: ${bestScore})`);
        return { ...best, _matchScore: bestScore, _lowConfidence: false };
      }
    }
  }

  
  const isRentRequest = text.includes('rent agreement') || text.includes('lease agreement') || 
    text.includes('rental agreement') || text.includes('tenancy agreement');
  
  if (isRentRequest) {
    console.log('🏢 Rent/Lease agreement request detected');
    const rentTemplates = templates.filter(t => {
      const name = t.relPath.toLowerCase();
      return name.includes('lease') || name.includes('rent') || name.includes('tenan');
    });
    if (rentTemplates.length > 0) {
      console.log(`✅ Selected rent template: ${rentTemplates[0].displayTitle}`);
      return { ...rentTemplates[0], _matchScore: 10, _lowConfidence: false };
    }
  }

  
  const isWillRequest = text.includes('will') && (text.includes('testament') || text.includes('property') || text.includes('heir') || text.includes('death'));
  if (isWillRequest) {
    console.log('📜 Will/Testament request detected');
    const willTemplates = templates.filter(t => t.relPath.toLowerCase().includes('will'));
    if (willTemplates.length > 0) {
      return { ...willTemplates[0], _matchScore: 10, _lowConfidence: false };
    }
  }

  
  const isPOARequest = text.includes('power of attorney') || text.includes('poa');
  if (isPOARequest) {
    console.log('📋 Power of Attorney request detected');
    const poaTemplates = templates.filter(t => t.relPath.toLowerCase().includes('power of attorney') || t.relPath.toLowerCase().includes('poa'));
    if (poaTemplates.length > 0) {
      return { ...poaTemplates[0], _matchScore: 10, _lowConfidence: false };
    }
  }

  
  
  
  
  const isConsumerComplaint = text.includes('mrp') || text.includes('overcharg') || text.includes('consumer') || 
    text.includes('fraud') || text.includes('scam') || text.includes('overpriced') || text.includes('excessive charge') ||
    text.includes('shopkeeper') || text.includes('defective') || text.includes('fake product');
  const isChequeRelated = text.includes('cheque') || text.includes('check') || text.includes('bounce') || text.includes('dishonor');
  
  
  if (isConsumerComplaint && !isChequeRelated) {
    console.log('🔴 Consumer complaint detected - restricting template selection');
    const templates_filtered = templates.filter(t => {
      const name = t.relPath.toLowerCase();
      const displayName = (t.displayTitle || '').toLowerCase();
      
      
      if (name.includes('bond') || name.includes('deed') || name.includes('family law') || name.includes('adoption') ||
          name.includes('section 138') || name.includes('section-138') || name.includes('negotiable') || 
          name.includes('arbitration') || name.includes('will') || name.includes('power of attorney') ||
          name.includes('railway') || name.includes('railways') || name.includes('carrier') || name.includes('lis pendens')) {
        return false;
      }
      
      
      if (name.includes('cheque') || name.includes('check') || name.includes('payment') || name.includes('branch manager') ||
          name.includes('stop payment') || displayName.includes('cheque') || displayName.includes('check') || displayName.includes('payment')) {
        console.log(`  ❌ Rejecting cheque-related template: ${t.displayTitle}`);
        return false;
      }
      
      
      if (name.includes('notice') || name.includes('letter') || name.includes('complaint') || name.includes('representation')) {
        console.log(`  ✅ Including template: ${t.displayTitle}`);
        return true;
      }
      return false;
    });
    
    if (templates_filtered.length > 0) {
      console.log(`Found ${templates_filtered.length} appropriate templates for consumer complaint`);
      
      let best = templates_filtered[0];
      let bestScore = -1;
      for (const t of templates_filtered) {
        let score = 0;
        const hayPath = t.relPath.toLowerCase();
        const displayTitle = (t.displayTitle || '').toLowerCase();
        
        
        if (displayTitle.includes('consumer') || hayPath.includes('consumer')) {
          score += 50;
        }
        
        for (const tok of tokenSet) {
          if (hayPath.includes(tok)) score += 2;
          if (displayTitle.includes(tok)) score += 1;
        }
        if (score > bestScore) {
          best = t;
          bestScore = score;
        }
      }
      console.log(`Selected template: ${best.displayTitle} (score: ${bestScore})`);
      return best;
    }
  }

  
  if (
    text.includes('letter') ||
    text.includes('representation') ||
    text.includes('application') ||
    text.includes('request') ||
    text.includes('regarding') ||
    text.includes('complaint')
  ) {
    const letterTemplates = templates.filter(t =>
      t.relPath.toLowerCase().includes('letter') ||
      t.relPath.toLowerCase().includes('representation') ||
      t.relPath.toLowerCase().includes('notice') ||
      t.relPath.toLowerCase().includes('complaint')
    );

    if (letterTemplates.length > 0) {
      let bestLetter = null;
      let bestScore = -1;
      const leaseTerms = ['tenant', 'landlord', 'lease', 'possession', 'vacate', 'expiry', 'expired', 'rent'];
      const leaseMention = leaseTerms.some(k => tokenSet.has(k) || text.includes(k));

      for (const t of letterTemplates) {
        let score = 0;
        const hayPath = t.relPath.toLowerCase();
        const hayText = String(t.template || '').toLowerCase();
        
        
        if (isConsumerComplaint && (hayPath.includes('section 138') || hayPath.includes('section-138') || hayPath.includes('negotiable') || hayPath.includes('railway'))) {
          score -= 100;
        }
        
        for (const tok of tokenSet) {
          if (hayPath.includes(tok)) score += 1;
          if (hayText.slice(0, 800).includes(tok)) score += 0.5;
        }

        if (leaseMention) {
          if (hayPath.includes('notice') || hayText.includes('notice') || t.displayTitle.toLowerCase().includes('notice')) {
            score += 3;
          }
          if (hayPath.includes('tenant') || hayText.includes('tenant') || hayPath.includes('landlord') || hayText.includes('landlord') || hayText.includes('possession')) {
            score += 3;
          }
          if (hayPath.includes('adjacent') || hayPath.includes('railway') || t.displayTitle.toLowerCase().includes('adjacent')) {
            score -= 4;
          }
        }

        if (score > bestScore) {
          bestLetter = t;
          bestScore = score;
        }
      }

      return bestLetter || letterTemplates[0];
    }
  }

  
  let best = null;
  let bestScore = -1;

  
  const isDeedRequest = text.includes('deed') || text.includes('sale deed') || text.includes('gift deed') || 
    text.includes('lease deed') || text.includes('mortgage') || text.includes('partition');
  const isSaleRelated = text.includes('sale') || text.includes('sell') || text.includes('purchase') || text.includes('buy');
  const isFlat = text.includes('flat') || text.includes('apartment') || text.includes('unit');
  const isLand = text.includes('land') || text.includes('plot') || text.includes('property');

  for (const t of templates) {
    const hayPath = t.relPath.toLowerCase();
    const hayText = String(t.template || '').toLowerCase();
    const displayTitle = (t.displayTitle || '').toLowerCase();
    let score = 0;
    
    
    
    if (categoryFilter && categoryFilter.some(folder => hayPath.includes(folder.toLowerCase()))) {
      score += 15;
    }

    
    if (isConsumerComplaint && (hayPath.includes('bond') || hayPath.includes('deed') || hayPath.includes('section 138') || 
        hayPath.includes('negotiable') || hayPath.includes('adoption') || hayPath.includes('railway') || 
        hayPath.includes('carrier') || hayPath.includes('lis pendens'))) {
      continue;
    }

    
    if (isDeedRequest && isSaleRelated) {
      if (hayPath.includes('sale') || displayTitle.includes('sale')) {
        score += 5;
        
        if (isFlat && (hayPath.includes('flat') || displayTitle.includes('flat'))) {
          score += 3;
        } else if (isLand && (hayPath.includes('land') || displayTitle.includes('land'))) {
          score += 3;
        }
      }
    }

    for (const tok of tokenSet) {
      if (hayPath.includes(tok)) score += 1;
    }

    const snippet = hayText.slice(0, 800);
    for (const tok of tokenSet) {
      if (snippet.includes(tok)) score += 0.5;
    }

    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }

  
  
  const CONFIDENCE_THRESHOLD = 5;
  
  if (bestScore < 3) {
    console.log(`❌ No template match found (bestScore: ${bestScore})`);
    return null;
  }
  
  if (bestScore < CONFIDENCE_THRESHOLD) {
    console.log(`⚠️ Low confidence template match: ${best?.displayTitle} (score: ${bestScore}, threshold: ${CONFIDENCE_THRESHOLD})`);
    
    return {
      ...best,
      _matchScore: bestScore,
      _lowConfidence: true
    };
  }
  
  console.log(`✅ Good template match: ${best?.displayTitle} (score: ${bestScore})`);
  return {
    ...best,
    _matchScore: bestScore,
    _lowConfidence: false
  };
}

export async function findBestTemplateWithAI(contextText) {
  try {
    const templates = await loadTemplates();
    if (!templates.length) return null;

    const prompt = `
You are selecting the most appropriate legal document template.

USER QUERY:
"${contextText}"

AVAILABLE TEMPLATES:
${templates.map(t => `- ${t.displayTitle}`).join('\n')}

Respond with ONLY the exact template title.
`;

    const response = await axios.post(
      'http://localhost:11434/api/generate',
      {
        model: 'llama3.1:8b',
        prompt,
        stream: false
      },
      { timeout: 15000 }
    );

    const selectedTitle = response?.data?.response?.trim();
    if (!selectedTitle) return await findBestTemplate(contextText);

    return templates.find(t =>
      t.displayTitle.toLowerCase() === selectedTitle.toLowerCase()
    ) || await findBestTemplate(contextText);

  } catch (err) {
    console.warn('AI template selection failed, using heuristic:', err.message);
    return await findBestTemplate(contextText);
  }
}

/**
 * Match an uploaded document to a template JSON by LLM-detected doc type + file name.
 * Returns { template, confidence: 'high'|'medium'|'none' } where template has schema (fields).
 */
export async function matchTemplateByDocType(detectedDocType, fileName = '') {
  const templates = await loadTemplates();
  if (!templates.length || !detectedDocType) return { template: null, confidence: 'none' };

  const docLower = detectedDocType.toLowerCase().trim();
  const fileLower = (fileName || '').toLowerCase().replace(/[_.-]+/g, ' ');
  const combined = `${docLower} ${fileLower}`;
  const tokens = combined.split(/\W+/).filter(w => w.length > 2);
  const tokenSet = new Set(tokens);

  let best = null;
  let bestScore = -1;

  for (const t of templates) {
    if (!t.schema || t.schema.length === 0) continue; // skip templates without field definitions

    const title = (t.displayTitle || '').toLowerCase();
    const desc = (t.description || '').toLowerCase();
    const cat = (t.category || '').toLowerCase();
    const subcat = (t.subcategory || '').toLowerCase();
    const relLower = (t.relPath || '').toLowerCase().replace(/[\\/_.-]+/g, ' ');
    const haystack = `${title} ${desc} ${cat} ${subcat} ${relLower}`;
    let score = 0;

    // Exact doc-type substring match in template title/desc is very strong
    if (title.includes(docLower) || desc.includes(docLower)) {
      score += 20;
    }
    // Partial doc-type words in title
    const docWords = docLower.split(/\W+/).filter(w => w.length > 2);
    for (const dw of docWords) {
      if (title.includes(dw)) score += 4;
      if (desc.includes(dw)) score += 2;
      if (cat.includes(dw)) score += 3;
      if (subcat.includes(dw)) score += 3;
    }
    // Token overlap from file name + doc type
    for (const tok of tokenSet) {
      if (haystack.includes(tok)) score += 1;
    }

    if (score > bestScore) {
      best = t;
      bestScore = score;
    }
  }

  if (!best || bestScore < 3) {
    return { template: null, confidence: 'none' };
  }

  const confidence = bestScore >= 12 ? 'high' : 'medium';
  console.log(`[TemplateMatch] "${detectedDocType}" → "${best.displayTitle}" (score: ${bestScore}, confidence: ${confidence})`);
  return {
    template: best,
    confidence,
  };
}

export default {
  loadTemplates,
  getAllTemplates,
  findBestTemplate,
  findBestTemplateWithAI,
  matchTemplateByDocType,
  getDisplayTitleForRelPath,
  getTemplateText,
  getTemplateBuffer,
  getTemplateStructure,
  getTemplatesRoot: () => NORMALIZED_ROOT,
};
