import { legalRAG } from '../utils/legalRAG.js';

class BNSKnowledgeService {
  constructor() {
    this.isInitialized = false;
    this.bnsSections = new Map();
  }

  
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      console.log('📚 Initializing BNS Knowledge Service...');
      
      
      await legalRAG.processLegalDocument(
        'https://www.mha.gov.in/sites/default/files/250883_english_01042024.pdf',
        'BNS',
        { 
          name: 'Bharatiya Nyaya Sanhita 2023',
          source: 'Ministry of Home Affairs, Government of India',
          enacted: 'December 25, 2023',
          effective: 'July 1, 2024'
        }
      );
      
      
      const bnsDoc = legalRAG.documents.get('BNS');
      if (bnsDoc && bnsDoc.sections) {
        for (const section of bnsDoc.sections) {
          this.bnsSections.set(section.number, section);
        }
      }
      
      this.isInitialized = true;
      console.log(`✅ BNS Knowledge Service initialized with ${this.bnsSections.size} sections`);
      
    } catch (error) {
      console.error('❌ Error initializing BNS Knowledge Service:', error.message);
    }
  }

  
  async searchBNSKnowledge(query, limit = 3) {
    await this.initialize();
    
    try {
      
      const relevantSections = await legalRAG.searchRelevantSections(query, 'BNS', limit);
      
      return relevantSections.map(section => ({
        sectionNumber: section.number,
        title: section.title,
        content: section.text,
        summary: section.summary,
        relevance: section.similarity
      }));
      
    } catch (error) {
      console.error('Error searching BNS knowledge:', error.message);
      return [];
    }
  }

  
  async getBNSSection(sectionNumber) {
    await this.initialize();
    
    const section = this.bnsSections.get(sectionNumber);
    if (section) {
      return {
        sectionNumber: section.number,
        title: section.title,
        content: section.text,
        summary: section.summary
      };
    }
    
    return null;
  }

  
  async answerBNSQuery(query) {
    await this.initialize();
    
    const lowerQuery = query.toLowerCase();
    
    
    const sectionMatch = lowerQuery.match(/section\s+(\d+)/);
    if (sectionMatch) {
      const sectionNumber = sectionMatch[1];
      const section = await this.getBNSSection(sectionNumber);
      if (section) {
        return {
          type: 'section',
          section: section,
          response: `**BNS Section ${sectionNumber}**\n\n${section.content}`
        };
      }
    }
    
    
    const relevantSections = await this.searchBNSKnowledge(query, 3);
    
    if (relevantSections.length > 0) {
      let response = `**BNS Legal Information**\n\n`;
      
      relevantSections.forEach((section, index) => {
        response += `**${section.title}**\n`;
        response += `${section.content.substring(0, 400)}...\n\n`;
      });
      
      
      if (lowerQuery.includes('murder') || lowerQuery.includes('kill') || lowerQuery.includes('death')) {
        response += `**⚠️ Important Legal Notice:**\n`;
        response += `This is general legal information about BNS provisions. If you are involved in a criminal matter, you must:\n`;
        response += `1. Consult with a qualified criminal lawyer immediately\n`;
        response += `2. Exercise your right to remain silent\n`;
        response += `3. Do not make any statements without legal counsel\n\n`;
      }
      
      response += `*Source: Bharatiya Nyaya Sanhita (BNS) 2023 - Official Government Document*\n`;
      response += `*This information is for educational purposes only. For specific legal advice, consult a qualified lawyer.*`;
      
      return {
        type: 'search',
        sections: relevantSections,
        response: response
      };
    }
    
    return {
      type: 'no_results',
      response: `I couldn't find specific information about "${query}" in the BNS. Please try rephrasing your question or ask about specific sections (e.g., "BNS Section 3" or "theft punishment under BNS").`
    };
  }

  
  getStats() {
    return {
      initialized: this.isInitialized,
      sectionsLoaded: this.bnsSections.size,
      source: 'Ministry of Home Affairs, Government of India',
      document: 'Bharatiya Nyaya Sanhita 2023'
    };
  }
}


export const bnsKnowledgeService = new BNSKnowledgeService();

export default bnsKnowledgeService;
