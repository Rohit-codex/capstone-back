import express from 'express';
import { searchBiharBhumiRecords } from '../controllers/biharBhumiController.js';
import { authenticateJWT } from '../middleware/auth.js';
import path from 'path';
import fs from 'fs';

const router = express.Router();

// Main search endpoint
router.post('/search', authenticateJWT, searchBiharBhumiRecords);

// Endpoint to serve cached HTML temp files safely
router.get('/temp/:filename', authenticateJWT, (req, res) => {
  const { filename } = req.params;
  // Ensure the filename is safe (no directory traversal)
  if (!filename.match(/^[a-zA-Z0-9_.-]+$/)) {
    return res.status(400).send('Invalid filename');
  }

  const tempPath = path.join(process.cwd(), 'public', 'temp', filename);
  
  if (fs.existsSync(tempPath)) {
    res.sendFile(tempPath);
  } else {
    res.status(404).send('Document not found or expired.');
  }
});

export default router;
