import ChronologySession from '../models/ChronologySession.js';
import EditSession from '../models/EditSession.js';
import {
  extractEventsFromFile,
  mergeAndSortEvents,
  generateTimelineSummary,
  chatAboutTimeline
} from '../services/chronologyService.js';

/**
 * POST /api/chronology/start
 * Start a chronology analysis session from one or more edit sessions.
 */
export const startChronology = async (req, res) => {
  try {
    const { editSessionIds, guestId } = req.body;

    if (!editSessionIds || !Array.isArray(editSessionIds) || editSessionIds.length === 0) {
      return res.status(400).json({ error: 'editSessionIds array is required' });
    }

    const userId = req.user ? req.user._id : null;

    // Create new chronology session
    const session = await ChronologySession.create({
      userId,
      guestId: userId ? null : guestId,
      status: 'pending'
    });

    // Run asynchronously
    processChronology(session._id, editSessionIds).catch(err => {
      console.error('[Chronology] Processing failed:', err);
    });

    return res.status(202).json({
      message: 'Chronology analysis started',
      sessionId: session._id
    });
  } catch (error) {
    console.error('[Chronology] Error starting:', error);
    res.status(500).json({ error: 'Failed to start chronology analysis' });
  }
};

/**
 * Async processor — runs in the background after API returns.
 */
const processChronology = async (sessionId, editSessionIds) => {
  const session = await ChronologySession.findById(sessionId);
  if (!session) return;

  try {
    session.status = 'processing';
    await session.save();

    // Step 1: Collect text from all edit sessions
    const fileDataList = [];
    for (const id of editSessionIds) {
      const editSession = await EditSession.findById(id);
      if (editSession && editSession.originalText && editSession.originalText.trim().length > 0) {
        fileDataList.push({
          editSessionId: editSession._id,
          fileName: editSession.fileName || 'Unknown File',
          fileId: editSession.fileId || null,
          text: editSession.originalText
        });
      }
    }

    if (fileDataList.length === 0) {
      throw new Error('No readable text found in the provided files.');
    }

    // Save file metadata
    session.files = fileDataList.map(f => ({
      editSessionId: f.editSessionId,
      fileName: f.fileName,
      fileId: f.fileId
    }));
    await session.save();

    let hasErrors = false;

    // Step 2: Extract events from each file in parallel
    console.log(`[Chronology] Extracting events from ${fileDataList.length} file(s)...`);
    const extractionPromises = fileDataList.map(f =>
      extractEventsFromFile(f.text, f.fileName).catch(err => {
        console.error(`[Chronology] Failed to extract events from "${f.fileName}":`, err.message);
        hasErrors = true;
        return [];
      })
    );
    const allFileEvents = await Promise.all(extractionPromises);

    // Step 3: Merge and sort
    console.log('[Chronology] Merging and sorting events...');
    const mergedEvents = mergeAndSortEvents(allFileEvents);
    session.events = mergedEvents;
    await session.save();

    // Step 4: Generate narrative summary
    console.log('[Chronology] Generating timeline summary...');
    try {
      const fileNames = fileDataList.map(f => f.fileName);
      session.summary = await generateTimelineSummary(mergedEvents, fileNames);
    } catch (err) {
      console.error('[Chronology] Summary generation failed:', err.message);
      session.summary = 'Summary generation failed. You can still review individual events below.';
      hasErrors = true;
    }

    session.status = hasErrors ? 'completed_with_errors' : 'completed';
    await session.save();
    console.log(`[Chronology] Session ${sessionId} completed with ${mergedEvents.length} events.`);

  } catch (error) {
    console.error('[Chronology] Critical failure:', error);
    session.status = 'failed';
    await session.save();
  }
};

/**
 * GET /api/chronology/:id/results
 * Get chronology results / status (for polling).
 */
export const getChronologyResults = async (req, res) => {
  try {
    const session = await ChronologySession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Chronology session not found' });
    }

    // Auth check
    if (session.userId && (!req.user || req.user._id.toString() !== session.userId.toString())) {
      return res.status(403).json({ error: 'Unauthorized access to this session' });
    }

    res.json(session);
  } catch (error) {
    console.error('[Chronology] Error fetching results:', error);
    res.status(500).json({ error: 'Failed to fetch chronology results' });
  }
};

/**
 * POST /api/chronology/:id/chat
 * Q&A chat about the timeline.
 */
export const chatWithChronologyAgent = async (req, res) => {
  try {
    const { message, guestId } = req.body;
    const session = await ChronologySession.findById(req.params.id);

    if (!session) {
      return res.status(404).json({ error: 'Chronology session not found' });
    }

    // Guest limits
    if (!session.userId) {
      if (session.guestId !== guestId) {
        return res.status(403).json({ error: 'Invalid guest session' });
      }
      if (session.chatHistory && session.chatHistory.length >= 4) {
        return res.status(403).json({
          error: 'Guest limit reached',
          code: 'GUEST_LIMIT_EXCEEDED',
          message: 'You have reached the maximum number of free queries. Please log in to continue.'
        });
      }
    } else {
      if (!req.user || req.user._id.toString() !== session.userId.toString()) {
        return res.status(403).json({ error: 'Unauthorized access to this session' });
      }
    }

    const reply = await chatAboutTimeline(session._id, message);
    res.json({ reply });
  } catch (error) {
    console.error('[Chronology] Chat error:', error);
    res.status(500).json({ error: 'Failed to chat with chronology agent' });
  }
};
