import CounterMakerSession from '../models/CounterMakerSession.js';
import counterMakerService from '../services/counterMakerService.js';
import { callLLM } from '../utils/llmUtils.js';

export const extractFacts = async (req, res) => {
  try {
    const { complaintFileId } = req.body;
    if (!complaintFileId) return res.status(400).json({ error: 'complaintFileId is required' });

    const facts = await counterMakerService.extractFacts(complaintFileId);
    res.json({ facts });
  } catch (error) {
    console.error('Extract facts error:', error);
    res.status(500).json({ error: 'Failed to extract facts' });
  }
};

export const startCounterMaker = async (req, res) => {
  try {
    const { complaintFileId, counterFacts } = req.body;
    if (!complaintFileId) return res.status(400).json({ error: 'complaintFileId is required' });

    const session = new CounterMakerSession({
      userId: req.user.id || req.user._id,
      complaintFileId,
      counterFacts: counterFacts || '',
      status: 'pending'
    });
    await session.save();

    // Start async processing
    counterMakerService.processCounterMaker(session._id);

    res.json({ sessionId: session._id, status: session.status });
  } catch (error) {
    console.error('Start Counter Maker error:', error);
    res.status(500).json({ error: 'Failed to start Counter Maker' });
  }
};

export const getCounterMakerResults = async (req, res) => {
  try {
    const session = await CounterMakerSession.findOne({
      _id: req.params.sessionId,
      userId: req.user.id || req.user._id
    });

    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      status: session.status,
      draft: session.draft,
      error: session.error
    });
  } catch (error) {
    console.error('Get Counter Maker results error:', error);
    res.status(500).json({ error: 'Failed to get Counter Maker results' });
  }
};

export const chatWithAgent = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    const session = await CounterMakerSession.findOne({ _id: sessionId, userId: req.user.id || req.user._id });
    if (!session || session.status !== 'completed') {
      return res.status(400).json({ error: 'Invalid or incomplete Counter Maker session' });
    }

    const prompt = `
You are an expert Indian Legal AI acting as an assistant for drafting a Counter Affidavit.
The user is asking a question about the following generated draft:
Title: ${session.draft.title}
Analysis: ${session.draft.analysis}
Content Preview: ${session.draft.content.substring(0, 1000)}...

User's Question: ${message}

Provide a helpful, legally sound answer based on the draft and standard Indian legal procedures.
`;
    const reply = await callLLM(prompt);
    res.json({ reply });
  } catch (error) {
    console.error('Counter Maker chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
};
