import express from 'express';
import multer from 'multer';
import { digitizeDocument } from '../controllers/ocrController.js';
import { authenticateJWT } from '../middleware/auth.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/digitize', authenticateJWT, upload.single('file'), digitizeDocument);

export default router;
