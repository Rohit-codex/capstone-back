import express from 'express';
import { isAdmin } from '../middleware/adminMiddleware.js';
import { 
  users, removeUser, financialStats, updateSubscriptionPricing, 
  getFreeMessageLimit, setFreeMessageLimit,
  getFeatureAccessMatrix, updateFeatureAccessMatrix, updateUserTier
} from '../controllers/adminController.js';
import { 
  getTemplateDesigns, createTemplateDesign, updateTemplateDesign, 
  deleteTemplateDesign, getTemplateDesignCategories,
  uploadMiddleware, analyzeUploadedDocument
} from '../controllers/templateDesignController.js';
import { createLawyer, updateLawyer, deleteLawyer } from '../controllers/lawyerController.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();


router.get('/users', isAdmin, asyncHandler(users));

router.delete('/users/:id', isAdmin, asyncHandler(removeUser));

router.put('/users/:id/tier', isAdmin, asyncHandler(updateUserTier));

router.get('/financial-stats', isAdmin, asyncHandler(financialStats));

router.put('/subscription-price', isAdmin, asyncHandler(updateSubscriptionPricing));


router.get('/settings/free-message-limit', isAdmin, asyncHandler(getFreeMessageLimit));
router.put('/settings/free-message-limit', isAdmin, asyncHandler(setFreeMessageLimit));


router.get('/feature-access', isAdmin, asyncHandler(getFeatureAccessMatrix));
router.put('/feature-access', isAdmin, asyncHandler(updateFeatureAccessMatrix));


router.get('/template-designs', isAdmin, asyncHandler(getTemplateDesigns));
router.get('/template-designs/categories', isAdmin, asyncHandler(getTemplateDesignCategories));
router.post('/template-designs/analyze', isAdmin, uploadMiddleware, asyncHandler(analyzeUploadedDocument));
router.post('/template-designs', isAdmin, asyncHandler(createTemplateDesign));
router.put('/template-designs/:id', isAdmin, asyncHandler(updateTemplateDesign));
router.delete('/template-designs/:id', isAdmin, asyncHandler(deleteTemplateDesign));

// Admin Lawyers Management
router.post('/lawyers', isAdmin, asyncHandler(createLawyer));
router.put('/lawyers/:id', isAdmin, asyncHandler(updateLawyer));
router.delete('/lawyers/:id', isAdmin, asyncHandler(deleteLawyer));

export default router;
