import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { generateDraft, getTemplateSchema, generateFromForm } from '../controllers/draftController.js';
import {
  generateCounterAffidavit,
  exportCounterAffidavit,
  previewCounterAffidavit,
  listCounterAffidavitDesignsEndpoint,
  registerCounterAnnexure,
  chatEditCounterAffidavit,
} from '../controllers/counterAffidavitController.js';

const router = express.Router();

router.post('/', authenticateJWT, asyncHandler(generateDraft));
router.get('/schema', authenticateJWT, asyncHandler(getTemplateSchema));
router.post('/form-generate', authenticateJWT, asyncHandler(generateFromForm));
router.get('/counter-affidavit/designs', authenticateJWT, asyncHandler(listCounterAffidavitDesignsEndpoint));
router.post('/counter-affidavit', authenticateJWT, asyncHandler(generateCounterAffidavit));
router.post('/counter-affidavit/preview', authenticateJWT, asyncHandler(previewCounterAffidavit));
router.post('/counter-affidavit/export', authenticateJWT, asyncHandler(exportCounterAffidavit));
router.post('/counter-affidavit/annexure', authenticateJWT, asyncHandler(registerCounterAnnexure));
router.post('/counter-affidavit/chat-edit', authenticateJWT, asyncHandler(chatEditCounterAffidavit));

export default router;


