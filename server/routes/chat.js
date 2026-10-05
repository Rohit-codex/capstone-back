import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { 
  getChatHistory, 
  sendMessage, 
  clearChatHistory,
  exitDocumentMode,
  rateDraft,
  getUserChats,
  deleteChatSession,
  updateChatTitle,
  updateChatState
} from '../controllers/chatController.js';
import { generateComplaint } from '../controllers/complaintController.js';
import { generateLegalAnalysis } from '../controllers/legalAnalysisController.js';
import rateLimit from 'express-rate-limit';
import asyncHandler from '../utils/asyncHandler.js';
import { validateRequest, schemas } from '../middleware/validators.js';

const router = express.Router();

const chatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: (req) => (['premium', 'pro', 'departmental', 'standard'].includes(req.user?.subscriptionStatus) ? 300 : 80),
  message: 'Too many requests from this IP, please try again later',
  keyGenerator: (req) => req.user?.id || req.ip
});

router.use(authenticateJWT);
router.use(chatLimiter);

router.get('/history', asyncHandler(getChatHistory));
router.get('/sessions', asyncHandler(getUserChats));
router.get('/session/:slug', asyncHandler(getChatHistory));
router.delete('/session/:slug', asyncHandler(deleteChatSession));
router.patch('/session/:slug/title', asyncHandler(updateChatTitle));
router.patch('/session/:slug/state', asyncHandler(updateChatState));
router.post('/message', validateRequest(schemas.chat.sendMessage), asyncHandler(sendMessage));
router.post('/stream', validateRequest(schemas.chat.sendMessage), asyncHandler(sendMessage));
router.delete('/clear', asyncHandler(clearChatHistory));
router.post('/exit-document-mode', asyncHandler(exitDocumentMode));
router.post('/rate-draft', asyncHandler(rateDraft));
router.post('/generate-complaint', asyncHandler(generateComplaint));
router.post('/legal-analysis', asyncHandler(generateLegalAnalysis));

router.post('/translate', asyncHandler(async (req, res) => {
  const { text, langCode, direction, fileId } = req.body;
  const translationService = (await import('../services/translationService.js')).default;
  
  let sourceText = text || '';
  if (!sourceText && fileId) {
    try {
      const FileModel = (await import('../models/File.js')).default;
      const fileDoc = await FileModel.findById(fileId).lean();
      sourceText = fileDoc?.text || fileDoc?.extractedText || '';
    } catch (e) {
      console.warn('Failed to load text from fileId for translation:', e?.message);
    }
  }

  const result = await translationService.translateDocumentText({
    text: sourceText,
    langCode: langCode || 'hi',
    direction: direction || 'to_indian'
  });

  res.json({
    success: true,
    originalText: result.originalText,
    translatedText: result.translatedText,
    langCode,
    direction
  });
}));

export default router; 