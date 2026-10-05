import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


class LegalKnowledgeBase {
  constructor() {
    this.laws = new Map();
    this.cases = new Map();
    this.sections = new Map();
    this.loadKnowledgeBase();
  }

  async loadKnowledgeBase() {
    try {
      
      const lawsDir = path.join(__dirname, '../../knowledge/laws');
      const casesDir = path.join(__dirname, '../../knowledge/cases');
      const sectionsDir = path.join(__dirname, '../../knowledge/sections');

      await this.loadFromDirectory(lawsDir, this.laws);
      await this.loadFromDirectory(casesDir, this.cases);
      await this.loadFromDirectory(sectionsDir, this.sections);

      
    } catch (error) {
      console.warn('Could not load knowledge base:', error.message);
    }
  }

  async loadFromDirectory(dir, map) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(dir, file), 'utf-8');
          const data = JSON.parse(content);
          map.set(file.replace('.json', ''), data);
        }
      }
    } catch (error) {
      
    }
  }

  
  searchLaws(query, category = null) {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const [key, law] of this.laws) {
      if (category && law.category !== category) continue;
      
      const relevance = this.calculateRelevance(queryLower, law);
      if (relevance > 0.3) {
        results.push({ ...law, relevance, source: 'knowledge_base' });
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, 5);
  }

  searchCases(query, jurisdiction = 'India') {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const [key, caseData] of this.cases) {
      if (caseData.jurisdiction !== jurisdiction) continue;
      
      const relevance = this.calculateRelevance(queryLower, caseData);
      if (relevance > 0.3) {
        results.push({ ...caseData, relevance, source: 'knowledge_base' });
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
  }

  searchSections(query, act = null) {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const [key, section] of this.sections) {
      if (act && section.act !== act) continue;
      
      const relevance = this.calculateRelevance(queryLower, section);
      if (relevance > 0.3) {
        results.push({ ...section, relevance, source: 'knowledge_base' });
      }
    }

    return results.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
  }

  calculateRelevance(query, item) {
    const text = `${item.title || ''} ${item.description || ''} ${item.content || ''}`.toLowerCase();
    const words = query.split(/\s+/);
    let score = 0;

    for (const word of words) {
      if (text.includes(word)) {
        score += 1;
        
        if (text.includes(query)) score += 0.5;
      }
    }

    return score / words.length;
  }

  
  async addLaw(lawData) {
    const id = `law_${Date.now()}`;
    this.laws.set(id, {
      ...lawData,
      id,
      addedAt: new Date().toISOString()
    });
    return id;
  }

  async addCase(caseData) {
    const id = `case_${Date.now()}`;
    this.cases.set(id, {
      ...caseData,
      id,
      addedAt: new Date().toISOString()
    });
    return id;
  }

  async addSection(sectionData) {
    const id = `section_${Date.now()}`;
    this.sections.set(id, {
      ...sectionData,
      id,
      addedAt: new Date().toISOString()
    });
    return id;
  }
}

export const knowledgeBase = new LegalKnowledgeBase();


export function enhancePromptWithKnowledge(query, context = '') {
  const laws = knowledgeBase.searchLaws(query);
  const cases = knowledgeBase.searchCases(query);
  const sections = knowledgeBase.searchSections(query);

  let knowledgeContext = '';
  
  if (laws.length > 0) {
    knowledgeContext += '\n\nRelevant Laws:\n';
    laws.forEach(law => {
      knowledgeContext += `- ${law.title}: ${law.description}\n`;
    });
  }

  if (cases.length > 0) {
    knowledgeContext += '\n\nRelevant Cases:\n';
    cases.forEach(caseData => {
      knowledgeContext += `- ${caseData.title} (${caseData.court}): ${caseData.summary}\n`;
    });
  }

  if (sections.length > 0) {
    knowledgeContext += '\n\nRelevant Sections:\n';
    sections.forEach(section => {
      knowledgeContext += `- ${section.act} Section ${section.number}: ${section.content}\n`;
    });
  }

  return knowledgeContext;
}

export default knowledgeBase;
