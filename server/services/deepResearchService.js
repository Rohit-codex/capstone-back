import { callLLMWithRetry } from '../utils/llmUtils.js';
import { processLargeText } from '../utils/processLargeText.js';
import { generateDocumentSummary } from './documentSummaryService.js';
import ResearchSession from '../models/ResearchSession.js';


/**
 * Agent 1: Document Reader (with 4 sub-agents)
 */
export const runAgent1 = async (text) => {
  // Sub-Agent A.1: First 2 pages context (Sequential because it only needs the beginning)
  const initialText = text.substring(0, 6000);
  const promptA1 = `You are a legal analyst (Agent A.1). Review the beginning of this document and provide a high-level context summary (parties involved, main subject, jurisdiction).
  
DOCUMENT START:
${initialText}

Provide your response as a concise summary.`;

  // Start Promises for A.1, A.2, A.3 in Parallel
  const pContextA1 = callLLMWithRetry(promptA1, { maxTokens: 500 }, 1);

  // Sub-Agent A.2: Key points extraction (Using Map-Reduce)
  const pKeyPointsA2 = processLargeText(
    text,
    (chunk) => `You are a legal analyst (Agent A.2). Read this document chunk and extract the critical key points, clauses, and obligations.\n\nDOCUMENT CHUNK:\n${chunk}\n\nProvide your response as a bulleted list.`,
    `You are a senior legal analyst. Combine the following extracted key points from different sections of a document into one cohesive, deduplicated bulleted list of the most critical points.`,
    1000
  );

  // Sub-Agent A.3: Chronology Builder (Structured Dates - Using Map-Reduce)
  const pDatesA3 = processLargeText(
    text,
    (chunk) => `Extract all important dates (execution dates, deadlines, court dates, breaches) from this chunk. Format as a strict JSON array of objects with keys: "date", "event", "significance", "entitiesInvolved". Return ONLY JSON.\n\nDOCUMENT CHUNK:\n${chunk}`,
    `Combine these JSON arrays of chronological events into one single strictly formatted chronological JSON array. Deduplicate any overlapping events. Return ONLY valid JSON.`,
    1500
  );

  // Wait for A.1, A.2, A.3 to finish simultaneously
  const [contextA1, keyPointsA2, rawDatesA3] = await Promise.all([pContextA1, pKeyPointsA2, pDatesA3]);

  // Parse JSON for A.3 cautiously
  let datesA3 = [];
  try {
    let cleanedJson = rawDatesA3;
    const jsonMatch = rawDatesA3.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleanedJson = jsonMatch[0];
    } else {
      cleanedJson = rawDatesA3.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    datesA3 = JSON.parse(cleanedJson);
  } catch (err) {
    console.warn('[Agent A.3] Failed to parse chronology JSON', err);
    datesA3 = [];
  }

  // Sub-Agent A.4: Contextual synthesis (Depends on A.2, so it runs after Promise.all)
  const promptA4 = `You are a legal analyst (Agent A.4). Synthesize the following extracted key points into a cohesive narrative context that explains the core implications of the document.
  
KEY POINTS:
${keyPointsA2}

Provide your response as a 2-paragraph synthesis.`;
  const synthesisA4 = await callLLMWithRetry(promptA4, { maxTokens: 800 }, 1);

  return {
    context: contextA1,
    keyPoints: keyPointsA2,
    dates: datesA3,
    synthesis: synthesisA4
  };
};

/**
 * Agent 2: Action Analyzer
 */
export const runAgent2 = async (agent1Data) => {
  const prompt = `You are a senior legal strategist (Agent 2). Based on the extracted context and synthesized key points from a document, suggest 3-5 actionable next steps or recommendations for the client.

CONTEXT:
${agent1Data.context}

SYNTHESIS:
${agent1Data.synthesis}

Provide your response as a bulleted list of actionable suggestions.`;

  const actions = await callLLMWithRetry(prompt, { maxTokens: 1000 }, 1);
  return { actionableSteps: actions };
};

/**
 * Agent 3: Summarizer
 * Re-uses the existing documentSummaryService
 */
export const runAgent3 = async (text, docType = 'unknown') => {
  return await generateDocumentSummary(text, docType);
};

/**
 * Agent 4: Q&A Interface
 */
export const runAgent4Chat = async (sessionId, userMessage) => {
  const session = await ResearchSession.findById(sessionId);
  if (!session) throw new Error('Research session not found');

  // Build the system prompt using context from Agents 1, 2, and 3
  const systemPrompt = `You are a highly intelligent legal assistant (Agent 4) helping a user understand their uploaded documents.
You have access to the following pre-analyzed research data about the documents:

--- AGENT 1 (Extracted Data) ---
Context: ${session.agent1Data?.context || 'N/A'}
Key Points: ${session.agent1Data?.keyPoints || 'N/A'}
Dates: ${JSON.stringify(session.agent1Data?.dates || [])}
Synthesis: ${session.agent1Data?.synthesis || 'N/A'}

--- AGENT 2 (Actionable Steps) ---
${session.agent2Data?.actionableSteps || 'N/A'}

--- AGENT 3 (Summary) ---
${JSON.stringify(session.agent3Summary || {})}

Based on the above context, answer the user's questions. Be precise, helpful, and reference the extracted data when relevant.`;

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
