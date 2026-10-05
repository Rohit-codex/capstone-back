import ResearchSession from '../models/ResearchSession.js';
import EditSession from '../models/EditSession.js';
import { runAgent1, runAgent2, runAgent3, runAgent4Chat } from '../services/deepResearchService.js';

export const startResearch = async (req, res) => {
  try {
    const { editSessionIds, guestId } = req.body;
    
    if (!editSessionIds || !Array.isArray(editSessionIds) || editSessionIds.length === 0) {
      return res.status(400).json({ error: 'editSessionIds array is required' });
    }

    const userId = req.user ? req.user._id : null;
    
    // Create new research session
    const researchSession = await ResearchSession.create({
      userId,
      guestId: userId ? null : guestId,
      status: 'pending'
    });

    // Run asynchronously
    processDeepResearch(researchSession._id, editSessionIds).catch(err => {
      console.error('Deep Research Failed:', err);
    });

    return res.status(202).json({
      message: 'Deep research started',
      sessionId: researchSession._id
    });
  } catch (error) {
    console.error('Error starting research:', error);
    res.status(500).json({ error: 'Failed to start deep research' });
  }
};

const processDeepResearch = async (sessionId, editSessionIds) => {
  const session = await ResearchSession.findById(sessionId);
  if (!session) return;

  try {
    session.status = 'processing';
    await session.save();

    // Collect text from all edit sessions
    let combinedText = '';
    const fileIds = [];

    for (const id of editSessionIds) {
      const editSession = await EditSession.findById(id);
      // Input sanitization: skip empty files
      if (editSession && editSession.originalText && editSession.originalText.trim().length > 0) {
        combinedText += `\n\n--- DOCUMENT: ${editSession.fileName || 'Unknown'} ---\n${editSession.originalText}`;
        if (editSession.fileId) fileIds.push(editSession.fileId);
      }
    }

    if (combinedText.trim().length === 0) {
      throw new Error("No readable text found in the provided sessions.");
    }

    session.fileIds = fileIds;
    
    let hasErrors = false;

    // Run Agent 1
    try {
      session.agent1Data = await runAgent1(combinedText);
    } catch (e) {
      console.error('[Agent 1 Failed]', e);
      session.agent1Data = { error: 'Failed to extract context and dates.' };
      hasErrors = true;
    }
    await session.save();

    // Run Agent 2 (depends on Agent 1)
    try {
      if (!session.agent1Data.error) {
        session.agent2Data = await runAgent2(session.agent1Data);
      } else {
        session.agent2Data = { error: 'Skipped because Agent 1 failed.' };
      }
    } catch (e) {
      console.error('[Agent 2 Failed]', e);
      session.agent2Data = { error: 'Failed to generate actionable steps.' };
      hasErrors = true;
    }
    await session.save();

    // Run Agent 3 (Summary)
    try {
      session.agent3Summary = await runAgent3(combinedText);
    } catch (e) {
      console.error('[Agent 3 Failed]', e);
      session.agent3Summary = { error: 'Failed to generate summary.' };
      hasErrors = true;
    }

    session.status = hasErrors ? 'completed_with_errors' : 'completed';
    await session.save();

  } catch (error) {
    console.error('[processDeepResearch Critical Failure]', error);
    session.status = 'failed';
    await session.save();
  }
};

export const getResearchResults = async (req, res) => {
  try {
    const session = await ResearchSession.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Research session not found' });
    }
    
    // Auth check (allow guests if they match guestId, or users if they match userId)
    if (session.userId && (!req.user || req.user._id.toString() !== session.userId.toString())) {
      return res.status(403).json({ error: 'Unauthorized access to this session' });
    }

    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch research results' });
  }
};

export const chatWithAgent4 = async (req, res) => {
  try {
    const { message, guestId } = req.body;
    const session = await ResearchSession.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'Research session not found' });
    }

    // Guest limits logic
    if (!session.userId) {
      // Validate guest ID
      if (session.guestId !== guestId) {
        return res.status(403).json({ error: 'Invalid guest session' });
      }
      
      // Enforce 2 message limit (each query/response pair is 2 entries in chatHistory)
      // So 4 total history entries = 2 messages sent by user
      if (session.chatHistory && session.chatHistory.length >= 4) {
        return res.status(403).json({ 
          error: 'Guest limit reached', 
          code: 'GUEST_LIMIT_EXCEEDED',
          message: 'You have reached the maximum number of free queries. Please log in to continue.'
        });
      }
    } else {
      // Authenticated user
      if (!req.user || req.user._id.toString() !== session.userId.toString()) {
        return res.status(403).json({ error: 'Unauthorized access to this session' });
      }
    }

    const reply = await runAgent4Chat(session._id, message);
    
    res.json({ reply });
  } catch (error) {
    console.error('Agent 4 chat error:', error);
    res.status(500).json({ error: 'Failed to chat with agent' });
  }
};
