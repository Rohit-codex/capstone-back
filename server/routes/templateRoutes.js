import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import { listCategories, previewTemplates, getTemplateContent, listAllTemplates, previewSingleTemplate, loadTemplateAsHtml } from '../controllers/templateController.js';
import { getActiveDesignsForCategory, matchDesignsToDocument } from '../controllers/templateDesignController.js';

const router = express.Router();


router.get('/designs', authenticateJWT, getActiveDesignsForCategory);


router.post('/designs/match', authenticateJWT, matchDesignsToDocument);


router.get('/list', authenticateJWT, listAllTemplates);


router.get('/categories', authenticateJWT, listCategories);


router.get('/preview', authenticateJWT, previewTemplates);


router.get('/preview/*', authenticateJWT, previewSingleTemplate);


router.get('/load/*', authenticateJWT, loadTemplateAsHtml);


router.get('/:category/:filename', authenticateJWT, getTemplateContent);

export default router;
