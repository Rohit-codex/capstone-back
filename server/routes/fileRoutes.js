import express from 'express';
import multer from 'multer';
import { 
  uploadFile, 
  getAllFiles, 
  deleteFile, 
  analyzeFile,
  startEditSession,
  applyDocumentEdit,
  getEditStatus,
  downloadEditedDocument,
  clearDocumentEditSession,
  getDocumentStructure,
  autoFillFields
} from '../controllers/fileController.js';
import { isAdmin } from '../middleware/adminMiddleware.js';
import { authenticateJWT } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';

const router = express.Router();


const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    
    const allowedTypes = [
      
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/bmp',
      
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/csv',
      'application/json',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      
      'application/rtf',
      'text/rtf',
      'text/richtext',
      'application/x-rtf'
    ];
    
    
    const allowedExtensions = ['.pdf', '.txt', '.md', '.csv', '.json', '.doc', '.docx', '.xls', '.xlsx', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.rtf'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    
    if (allowedTypes.includes(file.mimetype) || allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, Word, Excel, Text (.txt), RTF, Markdown, CSV, JSON, Images`));
    }
  },
});


router.post('/upload', authenticateJWT, upload.single('file'), asyncHandler(uploadFile));


router.post('/autofill-fields', authenticateJWT, asyncHandler(autoFillFields));


router.get('/download/:filename', asyncHandler(async (req, res) => {
  const { downloadFile } = await import('../controllers/fileController.js');
  return await downloadFile(req, res);
}));


router.post('/analyze/:fileId', authenticateJWT, asyncHandler(analyzeFile));




router.post('/:fileId/edit/start', authenticateJWT, asyncHandler(startEditSession));


router.post('/:fileId/smart-scan', authenticateJWT, asyncHandler(async (req, res) => {
  const { smartScan } = await import('../controllers/fileController.js');
  return await smartScan(req, res);
}));

// PDF → DOCX conversion (used as primary editable source)
router.post('/:fileId/convert-docx', authenticateJWT, asyncHandler(async (req, res) => {
  const { convertPdfToDocxEndpoint } = await import('../controllers/fileController.js');
  return await convertPdfToDocxEndpoint(req, res);
}));
router.get('/:fileId/docx/status', authenticateJWT, asyncHandler(async (req, res) => {
  const { getDocxStatusEndpoint } = await import('../controllers/fileController.js');
  return await getDocxStatusEndpoint(req, res);
}));
router.get('/:fileId/docx/download', authenticateJWT, asyncHandler(async (req, res) => {
  const { downloadDocxEndpoint } = await import('../controllers/fileController.js');
  return await downloadDocxEndpoint(req, res);
}));
// Backward compatibility for older frontend callers.
router.get('/:fileId/download', authenticateJWT, asyncHandler(async (req, res) => {
  const { downloadDocxEndpoint } = await import('../controllers/fileController.js');
  return await downloadDocxEndpoint(req, res);
}));

router.get('/:fileId/onlyoffice/config', authenticateJWT, asyncHandler(async (req, res) => {
  const { getOnlyOfficeConfigEndpoint } = await import('../controllers/fileController.js');
  return await getOnlyOfficeConfigEndpoint(req, res);
}));
router.post('/:fileId/onlyoffice/sync', authenticateJWT, asyncHandler(async (req, res) => {
  const { syncOnlyOfficeDocxEndpoint } = await import('../controllers/fileController.js');
  return await syncOnlyOfficeDocxEndpoint(req, res);
}));
router.post('/onlyoffice/callback/:fileId', asyncHandler(async (req, res) => {
  const { onlyOfficeCallbackEndpoint } = await import('../controllers/fileController.js');
  return await onlyOfficeCallbackEndpoint(req, res);
}));


router.post('/:fileId/discover-precedents', authenticateJWT, asyncHandler(async (req, res) => {
  const { discoverPrecedents } = await import('../controllers/fileController.js');
  return await discoverPrecedents(req, res);
}));


router.get('/:fileId/scan-status', authenticateJWT, asyncHandler(async (req, res) => {
  const { getScanStatus } = await import('../controllers/fileController.js');
  return await getScanStatus(req, res);
}));


router.patch('/:fileId/lock-scan', authenticateJWT, asyncHandler(async (req, res) => {
  const { lockScan } = await import('../controllers/fileController.js');
  return await lockScan(req, res);
}));


router.post('/edit/apply', authenticateJWT, asyncHandler(applyDocumentEdit));


router.post('/edit/manual', authenticateJWT, asyncHandler(async (req, res) => {
  const { applyManualDocumentEdit } = await import('../controllers/fileController.js');
  return await applyManualDocumentEdit(req, res);
}));


router.post('/edit/undo', authenticateJWT, asyncHandler(async (req, res) => {
  const { undoDocumentEdit } = await import('../controllers/fileController.js');
  return await undoDocumentEdit(req, res);
}));


router.post('/edit/redo', authenticateJWT, asyncHandler(async (req, res) => {
  const { redoDocumentEdit } = await import('../controllers/fileController.js');
  return await redoDocumentEdit(req, res);
}));


router.post('/edit/autosave', authenticateJWT, asyncHandler(async (req, res) => {
  const { autosaveDocument } = await import('../controllers/fileController.js');
  return await autosaveDocument(req, res);
}));


router.get('/edit/undo-redo-state', authenticateJWT, asyncHandler(async (req, res) => {
  const { getUndoRedoState } = await import('../controllers/fileController.js');
  return await getUndoRedoState(req, res);
}));


router.get('/edit/diff', authenticateJWT, asyncHandler(async (req, res) => {
  const { getDiffBetweenVersions } = await import('../controllers/fileController.js');
  return await getDiffBetweenVersions(req, res);
}));


router.get('/edit/sessions', authenticateJWT, asyncHandler(async (req, res) => {
  const { getUserEditSessions } = await import('../controllers/fileController.js');
  return await getUserEditSessions(req, res);
}));


router.post('/edit/sessions/:sessionId/load', authenticateJWT, asyncHandler(async (req, res) => {
  const { loadEditSession } = await import('../controllers/fileController.js');
  return await loadEditSession(req, res);
}));


router.post('/edit/fill-variables', authenticateJWT, asyncHandler(async (req, res) => {
  const { fillTemplateVariables } = await import('../controllers/fileController.js');
  return await fillTemplateVariables(req, res);
}));

router.post('/edit/save-field-values', authenticateJWT, asyncHandler(async (req, res) => {
  const { saveFilledFieldValues } = await import('../controllers/fileController.js');
  return await saveFilledFieldValues(req, res);
}));


router.patch('/edit/suggestion/:suggestionId', authenticateJWT, asyncHandler(async (req, res) => {
  const { updateSuggestionStatus } = await import('../controllers/fileController.js');
  return await updateSuggestionStatus(req, res);
}));


router.post('/edit/save-html', authenticateJWT, asyncHandler(async (req, res) => {
  const { saveHtmlContent } = await import('../controllers/fileController.js');
  return await saveHtmlContent(req, res);
}));

router.post('/edit/ai-chat', authenticateJWT, asyncHandler(async (req, res) => {
  const { aiChatAboutDocument } = await import('../controllers/fileController.js');
  return await aiChatAboutDocument(req, res);
}));


router.post('/edit/apply-chunked', authenticateJWT, asyncHandler(async (req, res) => {
  const { applyChunkedDocumentEdit } = await import('../controllers/fileController.js');
  return await applyChunkedDocumentEdit(req, res);
}));


router.get('/edit/status', authenticateJWT, asyncHandler(getEditStatus));


router.get('/edit/analysis', authenticateJWT, asyncHandler(getDocumentStructure));


router.get('/edit/download', authenticateJWT, asyncHandler(downloadEditedDocument));

router.post('/edit/download', authenticateJWT, asyncHandler(downloadEditedDocument));


router.post('/edit/clear', authenticateJWT, asyncHandler(clearDocumentEditSession));

router.get('/edit/:sessionId/audit-log', authenticateJWT, asyncHandler(async (req, res) => {
  const { exportAuditLog } = await import('../controllers/auditController.js');
  return await exportAuditLog(req, res);
}));

router.get('/edit/:sessionId/verify-audit', asyncHandler(async (req, res) => {
  const { verifyAuditLog } = await import('../controllers/auditController.js');
  return await verifyAuditLog(req, res);
}));




router.get('/user-files', authenticateJWT, asyncHandler(async (req, res) => {
  const { getUserFiles } = await import('../controllers/fileController.js');
  return await getUserFiles(req, res);
}));




router.get('/all', authenticateJWT, isAdmin, asyncHandler(getAllFiles));


router.delete('/:id', authenticateJWT, asyncHandler(deleteFile));

export default router; 