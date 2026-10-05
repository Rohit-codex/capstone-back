import express from 'express';
import { authenticateJWT } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import { searchCases, augmentCase } from '../controllers/caseSearchController.js';

const router = express.Router();


router.get('/search', authenticateJWT, asyncHandler(searchCases));


router.post('/augment', authenticateJWT, asyncHandler(augmentCase));

export default router;
