import BulkReview from '../models/BulkReview.js';
import EditSession from '../models/EditSession.js';
import { runAgent1, runAgent2 } from '../services/deepResearchService.js';
import { callLLMWithRetry } from '../utils/llmUtils.js';

export const startBulkReview = async (req, res) => {
  try {
    const { editSessionIds, guestId } = req.body;
    
    if (!editSessionIds || !Array.isArray(editSessionIds) || editSessionIds.length === 0) {
      return res.status(400).json({ error: 'editSessionIds array is required' });
    }

    const userId = req.user ? req.user._id : null;
    
    // Create new bulk review session
    const bulkReviewSession = await BulkReview.create({
      userId,
      guestId: userId ? null : guestId,
      status: 'pending'
    });

    // Run asynchronously
    processBulkReview(bulkReviewSession._id, editSessionIds).catch(err => {
      console.error('Bulk Review Processing Failed:', err);
    });

    return res.status(202).json({
      message: 'Bulk review started',
      sessionId: bulkReviewSession._id
    });
  } catch (error) {
    console.error('Error starting bulk review:', error);
    res.status(500).json({ error: 'Failed to start bulk review' });
  }
};

const processBulkReview = async (sessionId, editSessionIds) => {
  const session = await BulkReview.findById(sessionId);
  if (!session) return;

  try {
    session.status = 'processing';
    await session.save();

    const fileIds = [];
    const validDocs = [];
    let hasErrors = false;

    // Process each document in parallel
    const analysisPromises = editSessionIds.map(async (id) => {
      try {
        const editSession = await EditSession.findById(id);
        if (editSession && editSession.originalText && editSession.originalText.trim().length > 0) {
          const docText = editSession.originalText;
          const fileName = editSession.fileName || 'Unknown';
          
          if (editSession.fileId) {
            fileIds.push(editSession.fileId);
          }

          // Run Agent 1 specifically for this file
          const agent1Result = await runAgent1(docText);

          return {
            fileId: editSession.fileId || null,
            fileName: fileName,
            originalText: docText,
            context: agent1Result.context || '',
            keyPoints: agent1Result.keyPoints || '',
            synthesis: agent1Result.synthesis || '',
            dates: agent1Result.dates || []
          };
        }
      } catch (err) {
        console.error(`[BulkReview] Error processing document ${id}:`, err);
        hasErrors = true;
      }
      return null;
    });

    const results = await Promise.all(analysisPromises);
    
    // Filter out any null results
    for (const res of results) {
      if (res) {
        validDocs.push(res);
      }
    }

    if (validDocs.length === 0) {
      throw new Error("No readable text found in any of the provided sessions.");
    }

    session.fileIds = fileIds;
    session.documents = validDocs;
    session.status = hasErrors ? 'completed_with_errors' : 'completed';
    await session.save();

  } catch (error) {
    console.error('[processBulkReview Critical Failure]', error);
    session.status = 'failed';
    await session.save();
  }
};

export const getBulkReviewResults = async (req, res) => {
  try {
    const session = await BulkReview.findById(req.params.id);
    if (!session) {
      return res.status(404).json({ error: 'Bulk review session not found' });
    }
    
    // Auth check
    if (session.userId && (!req.user || req.user._id.toString() !== session.userId.toString())) {
      return res.status(403).json({ error: 'Unauthorized access to this session' });
    }

    res.json(session);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bulk review results' });
  }
};

export const chatWithBulkReviewAgent = async (req, res) => {
  try {
    const { message, guestId } = req.body;
    const session = await BulkReview.findById(req.params.id);
    
    if (!session) {
      return res.status(404).json({ error: 'Bulk review session not found' });
    }

    // Guest limits logic
    if (!session.userId) {
      // Validate guest ID
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
      // Authenticated user
      if (!req.user || req.user._id.toString() !== session.userId.toString()) {
        return res.status(403).json({ error: 'Unauthorized access to this session' });
      }
    }

    const reply = await runBulkReviewChat(session._id, message);
    
    res.json({ reply });
  } catch (error) {
    console.error('Bulk review chat error:', error);
    res.status(500).json({ error: 'Failed to chat with agent' });
  }
};

export const runBulkReviewChat = async (sessionId, userMessage) => {
  const session = await BulkReview.findById(sessionId);
  if (!session) throw new Error('Bulk review session not found');

  // Build the system prompt using context from all documents
  let documentsContext = '';
  session.documents.forEach((doc, idx) => {
    documentsContext += `
=== DOCUMENT #${idx + 1}: ${doc.fileName} ===
Context Summary: ${doc.context || 'N/A'}
Key Points: ${doc.keyPoints || 'N/A'}
Dates & Events Chronology:
${JSON.stringify(doc.dates || [], null, 2)}
Synthesis: ${doc.synthesis || 'N/A'}
`;
  });

  const systemPrompt = `You are a highly intelligent legal assistant (Agent 4) helping a user understand, compare, and find connections across multiple uploaded documents.
You have access to the structured, pre-analyzed research data for each document below:

${documentsContext}

Based on the above context, answer the user's questions. 
Since multiple documents are uploaded, pay close attention to:
1. Identifying connections, differences, or contradictions between different documents.
2. Comparing dates, deadlines, and schedules across documents. When the user asks about dates, construct chronological timelines or comparison tables referencing which date belongs to which file by name.
3. Answering questions about specific files by referencing their exact file names.
4. Keeping your answers precise, helpful, and referencing the specific extracted details when relevant.`;

  // Format previous chat history
  let chatHistoryText = '';
  if (session.chatHistory && session.chatHistory.length > 0) {
    chatHistoryText = "--- PREVIOUS CHAT HISTORY ---\n";
    session.chatHistory.forEach(msg => {
      chatHistoryText += `${msg.role.toUpperCase()}: ${msg.content}\n`;
    });
    chatHistoryText += "\n";
  }

  const finalPrompt = {
    system: systemPrompt,
    user: `${chatHistoryText}USER: ${userMessage}`
  };

  const response = await callLLMWithRetry(finalPrompt, { maxTokens: 1000 }, 1);
  
  // Save to history
  session.chatHistory.push({ role: 'user', content: userMessage });
  session.chatHistory.push({ role: 'assistant', content: response });
  await session.save();

  return response;
};
