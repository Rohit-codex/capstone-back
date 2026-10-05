import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { 
  addLaw, 
  addCase, 
  addSection, 
  searchKnowledge, 
  getKnowledgeStats 
} from '../controllers/knowledgeController.js';
import rateLimit from 'express-rate-limit';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();


const knowledgeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: 'Too many knowledge base requests from this IP, please try again later'
});


router.use(authenticateJWT);
router.use(knowledgeLimiter);


router.post('/laws', asyncHandler(addLaw));
router.post('/cases', asyncHandler(addCase));
router.post('/sections', asyncHandler(addSection));
router.get('/search', asyncHandler(searchKnowledge));
router.get('/stats', asyncHandler(getKnowledgeStats));

export default router;
