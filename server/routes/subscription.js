import express from 'express';
import { 
  createOrder, 
  verifyPayment, 
  updateSubscriptionPrice, 
  getSubscriptionPrice,
  getSubscriptionStatus,
  handleWebhook,
  createCoupon,
  validateCoupon,
  getCoupons,
  deleteCoupon,
  editCoupon
} from '../controllers/subscriptionController.js';
import { authenticateJWT } from '../middleware/auth.js';
import { isAdmin } from '../middleware/adminMiddleware.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();


router.post('/webhook', handleWebhook);
router.get('/price', getSubscriptionPrice);



router.use(authenticateJWT);
router.post('/order', asyncHandler(createOrder));
router.post('/verify', asyncHandler(verifyPayment));
router.get('/status', asyncHandler(getSubscriptionStatus));
router.post('/validate-coupon', asyncHandler(validateCoupon));


router.use(isAdmin);
router.put('/price', asyncHandler(updateSubscriptionPrice));
router.post('/coupons', asyncHandler(createCoupon));
router.get('/coupons', asyncHandler(getCoupons));
router.delete('/coupons/:id', asyncHandler(deleteCoupon));
router.put('/coupons/:id', asyncHandler(editCoupon));

export default router; 