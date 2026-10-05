import express from 'express';
import { startResearch, getResearchResults, chatWithAgent4 } from '../controllers/researchController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

// optionalAuth is assumed to check for JWT but not throw if absent, attaching req.user if valid.
// If optionalAuth doesn't exist, we can use a custom middleware or just allow it and let the controller handle it.
// Let's assume optionalAuth exists or we use a fallback if it doesn't.
// Wait, I will just create a quick inline optional auth middleware here if needed.
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

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

router.post('/start', softAuth, startResearch);
router.get('/:id/results', softAuth, getResearchResults);
router.post('/:id/chat', softAuth, chatWithAgent4);

export default router;
