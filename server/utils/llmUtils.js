import axios from 'axios';

const GEMINI_DISABLED = process.env.GEMINI_DISABLED === 'true';
const LLM_PROVIDER = (process.env.LLM_PROVIDER || '').toLowerCase();
const LLM_HTTP_TIMEOUT_MS = Number(process.env.LLM_HTTP_TIMEOUT_MS || 180000);

export const callLocalLLM = async (prompt, options = {}) => {
  const temperature = options.temperature !== undefined ? options.temperature : 0.8;
  const ollamaOpts = { temperature };
  if (options.maxTokens) ollamaOpts.num_predict = options.maxTokens;
  const model = process.env.OLLAMA_MODEL || 'llama3.1:8b';
  let promptText;
  if (typeof prompt === 'string') {
    promptText = prompt;
  } else if (typeof prompt === 'object' && prompt !== null) {
    promptText = `${prompt.system || ''}\n\n${prompt.user || ''}`;
  } else {
    promptText = '';
  }
  const response = await axios.post(
    'http://localhost:11434/api/generate',
    { model, prompt: promptText, stream: false, options: ollamaOpts },
    { timeout: 300000 } // 5 minutes — local LLM needs time on large documents
  );
  return response.data.response;
};

export const callGeminiFlash = async (prompt, options = {}) => {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const generationConfig = {};
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (options.maxTokens !== undefined) generationConfig.maxOutputTokens = options.maxTokens;
  const modelName = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const model = genAI.getGenerativeModel({ model: modelName, generationConfig });
  let promptText;
  if (typeof prompt === 'string') {
    promptText = prompt;
  } else if (typeof prompt === 'object' && prompt !== null) {
    promptText = `${prompt.system || ''}\n\n${prompt.user || ''}`;
  } else {
    promptText = '';
  }
  const result = await model.generateContent(promptText);
  return result.response.text();
};

export const callGroqChat = async (prompt, options = {}) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('GROQ_API_KEY is not configured');
  }

  const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
  // Support role-separated prompt objects: { system, user }
  const messages = [];
  if (typeof prompt === 'object' && prompt !== null) {
    if (prompt.system) messages.push({ role: 'system', content: prompt.system });
    if (prompt.user) messages.push({ role: 'user', content: prompt.user });
  } else if (prompt) {
    messages.push({ role: 'user', content: String(prompt) });
  }

  // Ensure at least one message to send
  if (messages.length === 0) {
    messages.push({ role: 'user', content: 'Process this request' });
  }

  const body = {
    model,
    messages,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
  };
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  const response = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    body,
    {
      timeout: LLM_HTTP_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
};

export const callOpenRouterChat = async (prompt, options = {}) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct';
  const messages = [];
  if (typeof prompt === 'object' && prompt !== null) {
    if (prompt.system) messages.push({ role: 'system', content: prompt.system });
    if (prompt.user) messages.push({ role: 'user', content: prompt.user });
  } else if (prompt) {
    messages.push({ role: 'user', content: String(prompt) });
  }

  // Ensure at least one message to send
  if (messages.length === 0) {
    messages.push({ role: 'user', content: 'Process this request' });
  }

  const body = {
    model,
    messages,
    temperature: options.temperature !== undefined ? options.temperature : 0.7,
  };
  if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    body,
    {
      timeout: LLM_HTTP_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        // OpenRouter recommends sending these (optional but helpful).
        'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'http://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'dastavezai-local-dev',
      },
    }
  );

  return response.data?.choices?.[0]?.message?.content || '';
};

/**
 * Multimodal Gemini call — supports sending a PDF (as base64 inline data) alongside
 * a text prompt.  Used for PDF→HTML layout reconstruction where Gemini needs to
 * both *see* the page visually and receive the accurate extracted text.
 *
 * @param {Buffer|null}  pdfBuffer    Raw PDF bytes (or null for text-only)
 * @param {string}       textPrompt   The instruction / context text
 * @param {object}       options      { temperature, maxTokens, model }
 * @returns {Promise<string>}
 */
export const callGeminiMultimodal = async (pdfBuffer, textPrompt, options = {}) => {
  const { GoogleGenerativeAI } = await import('@google/generative-ai');
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  const generationConfig = {};
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (options.maxTokens   !== undefined) generationConfig.maxOutputTokens = options.maxTokens;

  // Prefer a vision-capable model; allow override via env or caller option.
  // gemini-2.5-flash-lite may not support PDF inline data, so default to
  // gemini-2.0-flash which reliably handles multimodal PDF input.
  const modelName =
    options.model ||
    process.env.GEMINI_HTML_MODEL ||
    'gemini-2.0-flash';

  const model = genAI.getGenerativeModel({ model: modelName, generationConfig });

  const parts = [];

  if (pdfBuffer && pdfBuffer.length > 0) {
    // Inline data limit ≈ 20 MB.  Skip the PDF part for oversized files so
    // the text-only path still works (Gemini will rely on the markdown alone).
    const MAX_INLINE_BYTES = 18 * 1024 * 1024; // 18 MB safety margin
    if (pdfBuffer.length <= MAX_INLINE_BYTES) {
      parts.push({
        inlineData: {
          data: pdfBuffer.toString('base64'),
          mimeType: 'application/pdf',
        },
      });
    } else {
      console.warn('[GeminiMultimodal] PDF too large for inline data, using text-only mode');
    }
  }

  parts.push({ text: textPrompt });

  const result = await model.generateContent(parts);
  return result.response.text();
};

export const callLLM = async (prompt, options = {}) => {
  if (LLM_PROVIDER === 'groq') {
    console.log('[LLM] Using Groq provider');
    return callGroqChat(prompt, options);
  }

  if (LLM_PROVIDER === 'openrouter') {
    console.log('[LLM] Using OpenRouter provider');
    return callOpenRouterChat(prompt, options);
  }

  if (LLM_PROVIDER === 'ollama') {
    console.log('[LLM] Using Ollama provider');
    return callLocalLLM(prompt, options);
  }

  if (LLM_PROVIDER === 'gemini') {
    console.log('[LLM] Using Gemini provider');
    return callGeminiFlash(prompt, options);
  }

  if (GEMINI_DISABLED) {
    console.log('[LLM] Gemini disabled, using Ollama');
    return callLocalLLM(prompt, options);
  }
  try {
    console.log('[LLM] Attempting Gemini...');
    return await callGeminiFlash(prompt, options);
  } catch (err) {
    console.log(`[LLM] Gemini failed (${err.message}), falling back to Ollama`);
    return callLocalLLM(prompt, options);
  }
};

/**
 * Calls LLM with one automatic retry on failure or null/empty response.
 * Each call attempt is independent — ideal for critical scan operations.
 */
export const callLLMWithRetry = async (prompt, options = {}, retries = 1) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await callLLM(prompt, options);
      if (response && typeof response === 'string' && response.trim().length > 0) {
        return response;
      }
      console.warn(`[LLM] Attempt ${attempt + 1} returned empty response${attempt < retries ? ', retrying...' : ''}`);
    } catch (err) {
      console.warn(`[LLM] Attempt ${attempt + 1} failed: ${err.message}${attempt < retries ? ', retrying...' : ''}`);
      if (attempt === retries) throw err;
    }
  }
  return null;
};
