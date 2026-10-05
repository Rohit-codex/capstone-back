import express from 'express';
import { listLawyers } from '../controllers/lawyerController.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();

router.get('/', asyncHandler(listLawyers));

export default router;
