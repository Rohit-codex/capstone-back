import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { documentIngestion } from '../services/documentIngestion.js';
import { legalRAG } from '../utils/legalRAG.js';
import asyncHandler from '../utils/asyncHandler.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();


const legalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many legal requests from this IP, please try again later'
});


router.use(authenticateJWT);
router.use(legalLimiter);


router.get('/status', asyncHandler(async (req, res) => {
  const status = documentIngestion.getStatus();
  res.json({
    success: true,
    status
  });
}));


router.post('/process-all', asyncHandler(async (req, res) => {
  
  if (!req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admin users can process legal documents'
    });
  }

  const results = await documentIngestion.processAllLegalDocuments();
  res.json({
    success: true,
    message: 'Document processing completed',
    results
  });
}));


router.post('/process/:documentType', asyncHandler(async (req, res) => {
  const { documentType } = req.params;
  
  if (!req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admin users can process legal documents'
    });
  }

  const result = await documentIngestion.processDocument(documentType);
  res.json({
    success: true,
    message: `Document ${documentType} processed successfully`,
    result
  });
}));


router.post('/add-custom', asyncHandler(async (req, res) => {
  const { url, documentType, metadata } = req.body;
  
  if (!req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Only admin users can add custom documents'
    });
  }

  if (!url || !documentType) {
    return res.status(400).json({
      success: false,
      message: 'URL and documentType are required'
    });
  }

  const result = await documentIngestion.addCustomDocument(url, documentType, metadata);
  res.json({
    success: true,
    message: 'Custom document added successfully',
    result
  });
}));


router.post('/search', asyncHandler(async (req, res) => {
  const { query, documentType, limit = 5 } = req.body;
  
  if (!query) {
    return res.status(400).json({
      success: false,
      message: 'Query is required'
    });
  }

  const results = await documentIngestion.searchDocuments(query, documentType, limit);
  res.json({
    success: true,
    query,
    results: results.map(result => ({
      title: result.title,
      text: result.text.substring(0, 500) + '...',
      summary: result.summary,
      documentType: result.documentType,
      similarity: result.similarity,
      metadata: result.metadata
    }))
  });
}));


router.get('/stats', asyncHandler(async (req, res) => {
  const stats = legalRAG.getDocumentStats();
  res.json({
    success: true,
    stats
  });
}));

export default router;






