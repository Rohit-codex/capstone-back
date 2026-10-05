import express from 'express';
import { startBulkReview, getBulkReviewResults, chatWithBulkReviewAgent } from '../controllers/bulkReviewController.js';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const router = express.Router();

const softAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = await User.findById(decoded.userId || decoded.id).select('-password');
    } catch (err) {
      // ignore invalid tokens for soft auth
    }
  }
  next();
};

router.post('/start', softAuth, startBulkReview);
router.get('/:id/results', softAuth, getBulkReviewResults);
router.post('/:id/chat', softAuth, chatWithBulkReviewAgent);

export default router;
