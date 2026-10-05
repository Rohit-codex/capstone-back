import { callLLM } from '../utils/llmUtils.js';
import DocumentSession from '../models/DocumentSession.js';
import PrecedenceSession from '../models/PrecedenceSession.js';
import { processLargeText } from '../utils/processLargeText.js';



const PRECEDENCE_PROMPT = `
You are an expert Indian Legal AI. Analyze the following legal document excerpt.
Identify the key legal issues and summarize the relevant facts.
If there are any explicit court precedents (case laws) mentioned, list them. If none are mentioned, suggest the types of case laws or legal sections that would be most relevant to this situation based on Indian Law.

Document excerpt:
{TEXT}
`;

const REDUCE_PRECEDENCE_PROMPT = `
You are an expert Indian Legal AI. You are given a set of extracted legal issues, facts, and precedents from various parts of a large document.
Your task is to consolidate this into a single, comprehensive Precedence Analysis Report.

Return ONLY a valid JSON object with this exact structure. Do not include markdown formatting or backticks:
{
  "legalIssues": ["issue 1", "issue 2"],
  "precedents": [
    {
      "caseName": "Name of case or 'Suggested Relevant Case Laws'",
      "citation": "Citation or Act/Section",
      "court": "Name of Court",
      "year": "Year if known",
      "relevance": "Why is this relevant to the current matter?",
      "summary": "Brief summary of the precedent or legal principle"
    }
  ],
  "overallSummary": "A concise summary of the legal situation and how these precedents apply."
}
`;

class PrecedenceService {
  async processPrecedenceAnalysis(sessionId) {
    try {
      const session = await PrecedenceSession.findById(sessionId);
      if (!session) throw new Error('Session not found');

      session.status = 'processing';
      await session.save();

      const docSession = await DocumentSession.findById(session.fileId);
      if (!docSession || !docSession.documentText) {
        throw new Error('Document text not found');
      }

      console.log(`Starting Precedence Analysis for session: ${sessionId}`);

      // Run map-reduce chunking via processLargeText
      const chunkPromptGen = (chunk) => PRECEDENCE_PROMPT.replace('{TEXT}', chunk);
      const textResponse = await processLargeText(docSession.documentText, chunkPromptGen, REDUCE_PRECEDENCE_PROMPT, 2000);
      const text = textResponse.replace(/```json\n?|\n?```/g, '').trim();
      const jsonResponse = JSON.parse(text);

      session.analysisReport = {
        legalIssues: jsonResponse.legalIssues || [],
        precedents: jsonResponse.precedents || [],
        overallSummary: jsonResponse.overallSummary || 'No summary available.'
      };

      session.status = 'completed';
      await session.save();

      console.log(`Precedence Analysis completed for session: ${sessionId}`);
    } catch (error) {
      console.error(`Precedence Analysis failed for session ${sessionId}:`, error);
      await PrecedenceSession.findByIdAndUpdate(sessionId, {
        status: 'failed',
        error: error.message
      });
    }
  }
}

export default new PrecedenceService();
