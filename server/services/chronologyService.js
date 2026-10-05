import { callLLMWithRetry } from '../utils/llmUtils.js';
import { processLargeText } from '../utils/processLargeText.js';
import ChronologySession from '../models/ChronologySession.js';

/**
 * Stage 1: Extract date-event pairs from a single file.
 * Uses Map-Reduce for large documents.
 */
export const extractEventsFromFile = async (text, fileName) => {
  const chunkPrompt = (chunk) => `You are a legal chronology analyst. Extract ALL dates and date-related events from this document chunk.

For each event found, return a JSON object with:
- "date": The date in ISO or human-readable format (e.g., "2024-01-15" or "January 15, 2024"). If only month/year, use that.
- "event": A clear, concise description of what happened on that date.
- "significance": Why this date matters (1-2 sentences).
- "category": One of: "court_date", "deadline", "execution", "breach", "filing", "notice", "hearing", "order", "other"

Return ONLY a valid JSON array. If no dates found, return [].

DOCUMENT CHUNK:
${chunk}`;

  const reducePrompt = `You are a senior legal chronology analyst. The following are extracted date-event pairs from different chunks of the same document.

Combine them into ONE single JSON array. Rules:
1. Deduplicate events with the same date and similar descriptions.
2. Keep the most detailed version of each event.
3. Sort by date in ascending chronological order.
4. Return ONLY valid JSON array.`;

  const rawResult = await processLargeText(text, chunkPrompt, reducePrompt, 2000);

  // Parse JSON safely
  try {
    let cleaned = rawResult;
    const jsonMatch = rawResult.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    } else {
      cleaned = rawResult.replace(/```json/g, '').replace(/```/g, '').trim();
    }
    const events = JSON.parse(cleaned);
    // Tag each event with the source file name
    return (Array.isArray(events) ? events : []).map(e => ({
      date: e.date || 'Unknown',
      event: e.event || '',
      significance: e.significance || '',
      category: e.category || 'other',
      sourceFile: fileName
    }));
  } catch (err) {
    console.warn(`[Chronology] Failed to parse events JSON from file "${fileName}":`, err.message);
    return [];
  }
};

/**
 * Stage 2: Merge events from multiple files into a unified, sorted timeline.
 * Pure JS — no LLM needed.
 */
export const mergeAndSortEvents = (allFileEvents) => {
  // Flatten all events from all files
  const allEvents = allFileEvents.flat();

  // Attempt to parse dates for sorting
  const withParsed = allEvents.map(e => {
    let parsedDate = null;
    try {
      parsedDate = new Date(e.date);
      if (isNaN(parsedDate.getTime())) parsedDate = null;
    } catch { parsedDate = null; }
    return { ...e, _parsed: parsedDate };
  });

  // Sort: events with parseable dates first (ascending), then unparseable at the end
  withParsed.sort((a, b) => {
    if (a._parsed && b._parsed) return a._parsed - b._parsed;
    if (a._parsed && !b._parsed) return -1;
    if (!a._parsed && b._parsed) return 1;
    return 0;
  });

  // Remove temp _parsed field and deduplicate by date+event similarity
  const seen = new Set();
  const deduped = [];
  for (const ev of withParsed) {
    const key = `${ev.date}::${ev.event.substring(0, 60).toLowerCase()}`;
    if (!seen.has(key)) {
      seen.add(key);
      const { _parsed, ...clean } = ev;
      deduped.push(clean);
    }
  }

  return deduped;
};

/**
 * Stage 3: Generate a narrative timeline summary from the sorted events.
 */
export const generateTimelineSummary = async (events, fileNames) => {
  if (!events || events.length === 0) {
    return 'No datable events were found in the uploaded documents.';
  }

  const eventsText = events.slice(0, 40).map((e, i) =>
    `${i + 1}. [${e.date}] ${e.event} (Source: ${e.sourceFile}, Category: ${e.category})`
  ).join('\n');

  const prompt = `You are a senior legal analyst. Based on the following chronological timeline extracted from ${fileNames.length} document(s) (${fileNames.join(', ')}), write a clear, professional narrative summary (3-5 paragraphs) that:
1. Identifies the overall case/matter and parties involved.
2. Highlights the most significant dates and turning points.
3. Notes any gaps, inconsistencies, or urgencies in the timeline.
4. If multiple files are involved, explains how the timelines relate to each other.

TIMELINE:
${eventsText}

Write the summary in professional legal language.`;

  return await callLLMWithRetry(prompt, { maxTokens: 1500 }, 1);
};

/**
 * Stage 4: Q&A chat about the timeline.
 */
export const chatAboutTimeline = async (sessionId, userMessage) => {
  const session = await ChronologySession.findById(sessionId);
  if (!session) throw new Error('Chronology session not found');

  // Build context from the timeline data
  const eventsContext = (session.events || []).slice(0, 50).map((e, i) =>
    `${i + 1}. [${e.date}] ${e.event} — Source: ${e.sourceFile} (${e.category})${e.significance ? ' — ' + e.significance : ''}`
  ).join('\n');

  const fileNames = (session.files || []).map(f => f.fileName).join(', ');

  const systemPrompt = `You are an intelligent legal timeline assistant. The user has uploaded ${session.files?.length || 0} document(s) (${fileNames}) and you have extracted a chronological timeline from them.

--- TIMELINE DATA ---
${eventsContext}

--- SUMMARY ---
${session.summary || 'No summary available.'}

Based on the above timeline and summary, answer the user's questions accurately. Reference specific dates and events when relevant. If asked about relationships between files, explain how events from different files connect chronologically.`;

  // Format previous chat history
  let chatHistoryText = '';
  if (session.chatHistory && session.chatHistory.length > 0) {
    chatHistoryText = '--- PREVIOUS CHAT ---\n';
    session.chatHistory.forEach(msg => {
      chatHistoryText += `${msg.role.toUpperCase()}: ${msg.content}\n`;
    });
    chatHistoryText += '\n';
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
