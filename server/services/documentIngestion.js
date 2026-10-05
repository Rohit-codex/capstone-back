import { legalRAG, LEGAL_DOCUMENT_SOURCES } from '../utils/legalRAG.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class DocumentIngestionService {
  constructor() {
    this.processedDocuments = new Set();
    
    
    
    const baseCacheDir =
      process.env.CACHE_DIR ||
      process.env.TMPDIR ||
      process.env.TEMP ||
      '/tmp';

    this.cacheDir = path.join(baseCacheDir, 'legal_documents');
  }

  
  async initialize() {
    try {
      
      await fs.mkdir(this.cacheDir, { recursive: true });
      
      
      await this.loadCachedDocuments();
      
      console.log('📚 Document Ingestion Service initialized');
    } catch (error) {
      console.error('❌ Error initializing Document Ingestion Service:', error.message);
    }
  }

  
  async loadCachedDocuments() {
    try {
      const cacheFile = path.join(this.cacheDir, 'processed_documents.json');
      const cacheData = await fs.readFile(cacheFile, 'utf-8');
      const cached = JSON.parse(cacheData);
      
      for (const docType of cached.processed) {
        this.processedDocuments.add(docType);
      }
      
      console.log(`📖 Loaded ${this.processedDocuments.size} cached documents`);
    } catch (error) {
      console.log('No cached documents found, starting fresh');
    }
  }

  
  async saveCachedDocuments() {
    try {
      const cacheFile = path.join(this.cacheDir, 'processed_documents.json');
      const cacheData = {
        processed: Array.from(this.processedDocuments),
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(cacheFile, JSON.stringify(cacheData, null, 2));
      console.log('💾 Cached documents saved');
    } catch (error) {
      console.error('Error saving cache:', error.message);
    }
  }

  
  async processAllLegalDocuments() {
    console.log('🚀 Starting legal document processing...');
    
    const results = [];
    
    for (const [key, source] of Object.entries(LEGAL_DOCUMENT_SOURCES)) {
      try {
        if (this.processedDocuments.has(source.type)) {
          console.log(`⏭️ Skipping ${source.name} (already processed)`);
          continue;
        }

        console.log(`📄 Processing ${source.name}...`);
        const result = await legalRAG.processLegalDocument(
          source.url,
          source.type,
          {
            name: source.name,
            description: source.description,
            sourceType: 'government_pdf'
          }
        );

        this.processedDocuments.add(source.type);
        results.push({
          success: true,
          documentType: source.type,
          sections: result.sections.length,
          name: source.name
        });

        console.log(`✅ ${source.name}: ${result.sections.length} sections processed`);

      } catch (error) {
        console.error(`❌ Failed to process ${source.name}:`, error.message);
        results.push({
          success: false,
          documentType: source.type,
          error: error.message,
          name: source.name
        });
      }
    }

    
    await this.saveCachedDocuments();
    
    return results;
  }

  
  async processDocument(documentType) {
    const source = Object.values(LEGAL_DOCUMENT_SOURCES).find(s => s.type === documentType);
    
    if (!source) {
      throw new Error(`Document type ${documentType} not found`);
    }

    if (this.processedDocuments.has(documentType)) {
      console.log(`⏭️ ${source.name} already processed`);
      return { success: true, message: 'Already processed' };
    }

    try {
      console.log(`📄 Processing ${source.name}...`);
      const result = await legalRAG.processLegalDocument(
        source.url,
        source.type,
        {
          name: source.name,
          description: source.description,
          sourceType: 'government_pdf'
        }
      );

      this.processedDocuments.add(documentType);
      await this.saveCachedDocuments();

      return {
        success: true,
        documentType: source.type,
        sections: result.sections.length,
        name: source.name
      };

    } catch (error) {
      console.error(`❌ Failed to process ${source.name}:`, error.message);
      throw error;
    }
  }

  
  async addCustomDocument(url, documentType, metadata = {}) {
    try {
      console.log(`📄 Adding custom document: ${documentType}`);
      const result = await legalRAG.processLegalDocument(url, documentType, {
        ...metadata,
        sourceType: 'custom',
        addedAt: new Date().toISOString()
      });

      this.processedDocuments.add(documentType);
      await this.saveCachedDocuments();

      return {
        success: true,
        documentType,
        sections: result.sections.length,
        metadata: result.metadata
      };

    } catch (error) {
      console.error(`❌ Failed to add custom document:`, error.message);
      throw error;
    }
  }

  
  getStatus() {
    const allDocuments = Object.values(LEGAL_DOCUMENT_SOURCES);
    const processed = Array.from(this.processedDocuments);
    
    return {
      total: allDocuments.length,
      processed: processed.length,
      pending: allDocuments.length - processed.length,
      documents: allDocuments.map(doc => ({
        type: doc.type,
        name: doc.name,
        processed: processed.includes(doc.type),
        url: doc.url
      }))
    };
  }

  
  async searchDocuments(query, documentType = null, limit = 5) {
    if (this.processedDocuments.size === 0) {
      throw new Error('No documents processed yet. Please run processAllLegalDocuments() first.');
    }

    return await legalRAG.searchRelevantSections(query, documentType, limit);
  }
}


export const documentIngestion = new DocumentIngestionService();


documentIngestion.initialize();

export default documentIngestion;






