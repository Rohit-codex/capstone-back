import express from 'express';
import {
  sendContactEmail,
  listContactSubmissions,
  markSubmissionRead,
  deleteContactSubmission
} from '../controllers/contactController.js';
import { isAdmin } from '../middleware/adminMiddleware.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();

// Public: submit contact/demo form
router.post('/', asyncHandler(sendContactEmail));

// Admin: view, manage submissions
router.get('/admin/submissions', isAdmin, asyncHandler(listContactSubmissions));
router.put('/admin/submissions/:id/read', isAdmin, asyncHandler(markSubmissionRead));
router.delete('/admin/submissions/:id', isAdmin, asyncHandler(deleteContactSubmission));

export default router;