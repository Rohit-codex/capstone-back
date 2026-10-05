import { callLLM } from '../utils/llmUtils.js';
import DocumentSession from '../models/DocumentSession.js';
import CounterMakerSession from '../models/CounterMakerSession.js';
import File from '../models/File.js';
import { getFileContent } from '../controllers/fileController.js';
import { processLargeText } from '../utils/processLargeText.js';



const COMPLAINT_ANALYSIS_PROMPT = `
You are an expert Indian Legal AI. Analyze the following excerpt from a legal complaint/petition.
Identify the key allegations, claims, and demands made by the petitioner/complainant.
This will be used to draft a Counter Affidavit.

Excerpt:
{TEXT}
`;

const DRAFT_COUNTER_PROMPT = `
You are an expert Indian Legal AI drafting a Counter Affidavit.
You have the extracted allegations from the original complaint (provided at the end as COMBINED RESULTS), and the counter-facts provided by the respondent (our client).

Our Counter-Facts / Defenses:
{COUNTER_FACTS}

Draft a formal, structured Counter Affidavit suitable for an Indian court.
Use standard legal formatting (e.g., IN THE COURT OF..., BEFORE THE HON'BLE..., COUNTER AFFIDAVIT ON BEHALF OF RESPONDENT).
Address the allegations point-by-point, denying false claims and asserting our counter-facts.

Return ONLY a valid JSON object with this exact structure. Do not include markdown formatting or backticks:
{
  "title": "Title of the Document (e.g., COUNTER AFFIDAVIT OF RESPONDENT NO. 1)",
  "content": "The full drafted legal text of the counter affidavit. Use clear paragraphs, numbering, and standard legal phrasing.",
  "analysis": "A brief explanation of the strategy used in this draft and any weaknesses or missing information."
}
`;

class CounterMakerService {
  async extractFacts(complaintFileId) {
    try {
      const docFile = await File.findById(complaintFileId);
      if (!docFile) {
        throw new Error('Complaint document file not found');
      }

      const contentResult = await getFileContent(docFile);
      if (!contentResult || !contentResult.text) {
        throw new Error('Could not extract text from file');
      }
      
      const documentText = contentResult.text;

      console.log(`Extracting facts from complaint: ${complaintFileId}`);

      const chunkPromptGen = (chunk) => COMPLAINT_ANALYSIS_PROMPT.replace('{TEXT}', chunk);
      const reducePrompt = `
You are an expert Indian Legal AI.
You have extracted the following allegations from a legal complaint (provided below).
Summarize them into a concise list of bullet points representing the core factual allegations that need to be countered.
Return ONLY the bulleted list.

Extracted Allegations:
{COMBINED_RESULTS}
`;
      const textResponse = await processLargeText(documentText, chunkPromptGen, reducePrompt, 2000);
      return textResponse.trim();
    } catch (error) {
      console.error('Fact extraction failed:', error);
      throw error;
    }
  }

  async processCounterMaker(sessionId) {
    try {
      const session = await CounterMakerSession.findById(sessionId);
      if (!session) throw new Error('Session not found');

      session.status = 'processing';
      await session.save();

      const docFile = await File.findById(session.complaintFileId);
      if (!docFile) {
        throw new Error('Complaint document file not found');
      }

      const contentResult = await getFileContent(docFile);
      if (!contentResult || !contentResult.text) {
        throw new Error('Could not extract text from file');
      }

      const documentText = contentResult.text;

      console.log(`Starting Counter Maker Analysis for session: ${sessionId}`);

      // Run map-reduce chunking via processLargeText
      const chunkPromptGen = (chunk) => COMPLAINT_ANALYSIS_PROMPT.replace('{TEXT}', chunk);
      const reducePrompt = DRAFT_COUNTER_PROMPT.replace('{COUNTER_FACTS}', session.counterFacts || 'General denial of allegations. Require strict proof thereof.');
      
      const textResponse = await processLargeText(documentText, chunkPromptGen, reducePrompt, 2000);
      const text = textResponse.replace(/```json\n?|\n?```/g, '').trim();
      const jsonResponse = JSON.parse(text);

      session.draft = {
        title: jsonResponse.title || 'Counter Affidavit',
        content: jsonResponse.content || 'Drafting failed.',
        analysis: jsonResponse.analysis || ''
      };

      session.status = 'completed';
      await session.save();

      console.log(`Counter Maker completed for session: ${sessionId}`);
    } catch (error) {
      console.error(`Counter Maker failed for session ${sessionId}:`, error);
      await CounterMakerSession.findByIdAndUpdate(sessionId, {
        status: 'failed',
        error: error.message
      });
    }
  }
}

export default new CounterMakerService();
