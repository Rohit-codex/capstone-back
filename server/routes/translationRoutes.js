import express from 'express';
import multer from 'multer';
import { uploadAndTranslate, uploadAndTranslateInPlace, translateText, startTranslationSession, getTranslationSession } from '../controllers/translationController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

// Apply auth middleware if you want only logged-in users to use it
router.post('/upload', authenticateJWT, upload.single('document'), uploadAndTranslate);
router.post('/upload-inplace', authenticateJWT, upload.single('document'), uploadAndTranslateInPlace);
router.post('/text', authenticateJWT, translateText);

// New Session-based Endpoints
router.post('/start', authenticateJWT, startTranslationSession);
router.get('/:sessionId', authenticateJWT, getTranslationSession);

export default router;
