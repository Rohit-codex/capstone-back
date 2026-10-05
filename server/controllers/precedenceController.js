import PrecedenceSession from '../models/PrecedenceSession.js';
import precedenceService from '../services/precedenceService.js';
import { callLLM } from '../utils/llmUtils.js';


export const startPrecedenceAnalysis = async (req, res) => {
  try {
    const { fileId } = req.body;
    if (!fileId) return res.status(400).json({ error: 'fileId is required' });

    const session = new PrecedenceSession({
      userId: req.user.id || req.user._id,
      fileId,
      status: 'pending'
    });
    await session.save();

    // Start async processing
    precedenceService.processPrecedenceAnalysis(session._id);

    res.json({ sessionId: session._id, status: session.status });
  } catch (error) {
    console.error('Start precedence error:', error);
    res.status(500).json({ error: 'Failed to start precedence analysis' });
  }
};

export const getPrecedenceResults = async (req, res) => {
  try {
    const session = await PrecedenceSession.findOne({
      _id: req.params.sessionId,
      userId: req.user.id || req.user._id
    });

    if (!session) return res.status(404).json({ error: 'Session not found' });

    res.json({
      status: session.status,
      report: session.analysisReport,
      error: session.error
    });
  } catch (error) {
    console.error('Get precedence results error:', error);
    res.status(500).json({ error: 'Failed to get precedence results' });
  }
};

export const chatWithAgent = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    const session = await PrecedenceSession.findOne({ _id: sessionId, userId: req.user.id || req.user._id });
    if (!session || session.status !== 'completed') {
      return res.status(400).json({ error: 'Invalid or incomplete precedence session' });
    }

    const prompt = `
You are an expert Indian Legal AI.
The user is asking a question about the following Precedence Analysis report:
${JSON.stringify(session.analysisReport, null, 2)}

User's Question: ${message}

Provide a helpful, legally sound answer based on the analysis.
`;
    const reply = await callLLM(prompt);
    res.json({ reply });
  } catch (error) {
    console.error('Precedence chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
};
