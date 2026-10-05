// server/controllers/sofController.js
// Exposes POST /api/files/edit/sof for on-demand SOF generation.
// Also used by startEditSession() via sofService.js directly.
//
// Wire-up in server/routes/fileRoutes.js (or wherever file routes live):
//   const { generateSOFHandler } = require('../controllers/sofController');
//   router.post('/edit/sof', authenticateJWT, generateSOFHandler);

const { generateSOF } = require('../services/sofService');

/**
 * POST /api/files/edit/sof
 * Body: { sessionId } — uses the active edit session's extracted text
 * OR
 * Body: { text, docType } — direct text input (for re-generation)
 */
const generateSOFHandler = async (req, res) => {
  try {
    const { sessionId, text, docType } = req.body;
    const userId = req.user?._id || req.user?.id;

    let extractedText = text || '';
    let detectedDocType = docType || 'unknown';

    // If sessionId provided, load text from the active edit session
    // This matches how your existing edit session system works in fileController.js
    if (sessionId && !text) {
      // Import the session store used by fileController.js
      // Adjust this import path if your session storage differs
      const { getEditSession } = require('../services/documentEditService');
      const session = await getEditSession(sessionId, userId);

      if (!session) {
        return res.status(404).json({
          success: false,
          message: 'Edit session not found. Please re-open the document.',
        });
      }

      extractedText = session.extractedText || session.currentText || session.text || '';
      detectedDocType = session.docType || 'unknown';
    }

    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(400).json({
        success: false,
        message: 'No document text available. Please upload and open a document first.',
      });
    }

    const sof = await generateSOF(extractedText, detectedDocType, sessionId || 'direct');

    if (sof.error) {
      return res.status(500).json({
        success: false,
        message: sof.error,
        sof,
      });
    }

    res.json({
      success: true,
      message: 'Statement of Facts generated successfully',
      sof,
    });
  } catch (err) {
    console.error('[sofController] generateSOFHandler error:', err);
    res.status(500).json({
      success: false,
      message: err.message || 'SOF generation failed',
    });
  }
};

module.exports = { generateSOFHandler };
