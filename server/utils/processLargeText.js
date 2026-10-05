import { callLLMWithRetry } from './llmUtils.js';

/**
 * Utility to handle massive documents via Chunking & Map-Reduce.
 * Shared across deep research, chronology, and other LLM-powered services.
 *
 * @param {string} text - The full document text.
 * @param {Function} chunkPromptGen - A function (chunk) => prompt string for each chunk.
 * @param {string} reducePrompt - The prompt used to combine/reduce chunk results.
 * @param {number} maxTokens - Max tokens for each LLM call.
 * @returns {Promise<string>} The final combined result.
 */
export const processLargeText = async (text, chunkPromptGen, reducePrompt, maxTokens = 1000) => {
  const CHUNK_SIZE = 15000; // characters (approx 3000 words)
  
  if (text.length <= CHUNK_SIZE) {
    // Small enough, no need to chunk
    return await callLLMWithRetry(chunkPromptGen(text), { maxTokens }, 1);
  }

  console.log(`[processLargeText] Chunking large text of length ${text.length} into chunks of ${CHUNK_SIZE}...`);
  const chunks = [];
  for (let i = 0; i < text.length; i += CHUNK_SIZE) {
    chunks.push(text.substring(i, i + CHUNK_SIZE));
  }

  // MAP Phase: Process chunks in parallel
  const chunkPromises = chunks.map(chunk => callLLMWithRetry(chunkPromptGen(chunk), { maxTokens }, 1));
  const chunkResults = await Promise.all(chunkPromises);

  // REDUCE Phase: Combine the results
  const combinedResults = chunkResults.join('\n\n--- NEXT CHUNK RESULT ---\n\n');
  // Truncate to avoid blowing up the reduce prompt
  const finalPrompt = `${reducePrompt}\n\nCOMBINED RESULTS:\n${combinedResults.substring(0, 30000)}`;
  
  return await callLLMWithRetry(finalPrompt, { maxTokens }, 1);
};
