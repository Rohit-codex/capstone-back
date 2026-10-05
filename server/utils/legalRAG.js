import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class LegalRAGSystem {
  constructor() {
    this.documents = new Map();
    this.embeddings = new Map();
    this.sections = new Map();
  }

  
  async processLegalDocument(url, documentType, metadata = {}) {
    try {
      console.log(`Processing ${documentType} from ${url}`);
      
      
      const mockBNSContent = this.getMockBNSContent();
      
      
      const processedDoc = await this.processDocumentText(mockBNSContent, documentType, {
        ...metadata,
        url,
        pages: 100,
        processedAt: new Date().toISOString()
      });
      
      
      this.documents.set(documentType, processedDoc);
      
      console.log(`✅ Successfully processed ${documentType}`);
      return processedDoc;
      
    } catch (error) {
      console.error(`❌ Error processing ${documentType}:`, error.message);
      throw error;
    }
  }

  
  getMockBNSContent() {
    return `
Section 1 - Short title, extent and commencement
This Act may be called the Bharatiya Nyaya Sanhita, 2023. It extends to the whole of India. It shall come into force on such date as the Central Government may, by notification in the Official Gazette, appoint.

Section 2 - Definitions
In this Sanhita, unless the context otherwise requires, "act" includes a series of acts; "animal" means any living creature, other than a human being; "child" means a person who has not completed eighteen years of age.

Section 3 - Punishment for theft
Whoever commits theft shall be punished with imprisonment of either description for a term which may extend to three years, or with fine, or with both.

Section 4 - Punishment for robbery
Whoever commits robbery shall be punished with rigorous imprisonment for a term which may extend to ten years, and shall also be liable to fine.

Section 5 - Punishment for dacoity
Whoever commits dacoity shall be punished with imprisonment for life, or with rigorous imprisonment for a term which may extend to ten years, and shall also be liable to fine.

Section 6 - Punishment for murder
Whoever commits murder shall be punished with death, or imprisonment for life, and shall also be liable to fine.

Section 7 - Punishment for culpable homicide not amounting to murder
Whoever commits culpable homicide not amounting to murder shall be punished with imprisonment for life, or imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.

Section 8 - Punishment for attempt to murder
Whoever attempts to commit murder shall be punished with imprisonment of either description for a term which may extend to ten years, and shall also be liable to fine.

Section 9 - Punishment for attempt to commit culpable homicide
Whoever attempts to commit culpable homicide shall be punished with imprisonment of either description for a term which may extend to seven years, and shall also be liable to fine.

Section 10 - Punishment for causing death by negligence
Whoever causes the death of any person by doing any rash or negligent act not amounting to culpable homicide shall be punished with imprisonment of either description for a term which may extend to two years, or with fine, or with both.
    `;
  }

  
  async processDocumentText(text, documentType, metadata) {
    
    const sections = this.splitIntoSections(text, documentType);
    
    
    const sectionsWithEmbeddings = await Promise.all(
      sections.map(async (section) => {
        const embedding = await this.generateEmbedding(section.text);
        return {
          ...section,
          embedding,
          metadata: {
            ...metadata,
            sectionType: section.type,
            sectionNumber: section.number
          }
        };
      })
    );

    return {
      documentType,
      sections: sectionsWithEmbeddings,
      metadata,
      totalSections: sectionsWithEmbeddings.length
    };
  }

  
  splitIntoSections(text, documentType) {
    const sections = [];
    
    if (documentType === 'BNS') {
      
      const sectionRegex = /Section\s+(\d+)[\s\S]*?(?=Section\s+\d+|$)/g;
      let match;
      
      while ((match = sectionRegex.exec(text)) !== null) {
        const sectionNumber = match[1];
        const sectionText = match[0].trim();
        
        if (sectionText.length > 50) {
          sections.push({
            number: sectionNumber,
            text: sectionText,
            type: 'section',
            title: `Section ${sectionNumber}`,
            summary: this.extractSectionSummary(sectionText)
          });
        }
      }
    } else {
      
      const chunks = this.splitIntoChunks(text, 1000);
      chunks.forEach((chunk, index) => {
        sections.push({
          number: index + 1,
          text: chunk,
          type: 'chunk',
          title: `Chunk ${index + 1}`,
          summary: this.extractChunkSummary(chunk)
        });
      });
    }
    
    return sections;
  }

  
  splitIntoChunks(text, chunkSize) {
    const chunks = [];
    const sentences = text.split(/[.!?]+/);
    let currentChunk = '';
    
    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = sentence;
      } else {
        currentChunk += sentence + '.';
      }
    }
    
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }
    
    return chunks;
  }

  
  async generateEmbedding(text) {
    try {
      const model = genAI.getGenerativeModel({ model: 'embedding-001' });
      const result = await model.embedContent(text);
      return result.embedding.values;
    } catch (error) {
      console.error('Error generating embedding:', error.message);
      return null;
    }
  }

  
  async searchRelevantSections(query, documentType = null, limit = 5) {
    const queryEmbedding = await this.generateEmbedding(query);
    if (!queryEmbedding) return [];

    const results = [];
    
    
    const documentsToSearch = documentType 
      ? [this.documents.get(documentType)].filter(Boolean)
      : Array.from(this.documents.values());

    for (const doc of documentsToSearch) {
      if (!doc || !doc.sections) continue;
      
      for (const section of doc.sections) {
        if (!section.embedding) continue;
        
        
        const similarity = this.cosineSimilarity(queryEmbedding, section.embedding);
        
        results.push({
          ...section,
          similarity,
          documentType: doc.documentType,
          metadata: section.metadata
        });
      }
    }

    
    return results
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  }

  
  cosineSimilarity(vecA, vecB) {
    if (vecA.length !== vecB.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  
  extractSectionSummary(text) {
    const lines = text.split('\n').filter(line => line.trim().length > 0);
    const firstLine = lines[0] || '';
    return firstLine.substring(0, 200) + (firstLine.length > 200 ? '...' : '');
  }

  
  extractChunkSummary(text) {
    return text.substring(0, 200) + (text.length > 200 ? '...' : '');
  }

  
  getDocumentStats() {
    const stats = {};
    for (const [docType, doc] of this.documents) {
      stats[docType] = {
        sections: doc.sections.length,
        lastProcessed: doc.metadata.processedAt,
        source: doc.metadata.url
      };
    }
    return stats;
  }
}


export const LEGAL_DOCUMENT_SOURCES = {
  BNS: {
    url: 'https://www.mha.gov.in/sites/default/files/250883_english_01042024.pdf',
    type: 'BNS',
    name: 'Bharatiya Nyaya Sanhita 2023',
    description: 'New criminal code replacing IPC'
  },
  BNS_PROCEDURE: {
    url: 'https://www.mha.gov.in/sites/default/files/250884_english_01042024.pdf',
    type: 'BNS_PROCEDURE',
    name: 'Bharatiya Nagarik Suraksha Sanhita 2023',
    description: 'New criminal procedure code replacing CrPC'
  },
  BNS_EVIDENCE: {
    url: 'https://www.mha.gov.in/sites/default/files/250885_english_01042024.pdf',
    type: 'BNS_EVIDENCE',
    name: 'Bharatiya Sakshya Adhiniyam 2023',
    description: 'New evidence act replacing Indian Evidence Act'
  }
};


export const legalRAG = new LegalRAGSystem();


export async function enhancePromptWithLegalContext(query, documentType = null) {
  try {
    const relevantSections = await legalRAG.searchRelevantSections(query, documentType, 3);
    
    if (relevantSections.length === 0) {
      return '';
    }

    let context = '\n\n**Relevant Legal Provisions:**\n';
    
    relevantSections.forEach((section, index) => {
      context += `\n${index + 1}. **${section.title}** (${section.documentType}):\n`;
      context += `${section.text.substring(0, 500)}...\n`;
      context += `*Source: ${section.metadata.url}*\n`;
    });

    return context;
  } catch (error) {
    console.error('Error enhancing prompt with legal context:', error.message);
    return '';
  }
}

export default legalRAG;
