import fetch from 'node-fetch';

const parseIntSafe = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeAzureEndpoint = (raw = '') => {
  const trimmed = String(raw || '').trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithTimeout = async (url, options = {}, timeoutMs = 20000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

export const isAzureOcrConfigured = () => {
  const enabled = String(process.env.AZURE_OCR_ENABLED || 'false').toLowerCase() === 'true';
  const endpoint = normalizeAzureEndpoint(process.env.AZURE_OCR_ENDPOINT || '');
  const key = String(process.env.AZURE_OCR_KEY || '').trim();
  return enabled && !!endpoint && !!key;
};

export const extractTextWithAzureOcr = async (buffer, mimeType = 'application/octet-stream') => {
  const endpoint = normalizeAzureEndpoint(process.env.AZURE_OCR_ENDPOINT || '');
  const key = String(process.env.AZURE_OCR_KEY || '').trim();
  const apiVersion = process.env.AZURE_OCR_API_VERSION || 'v3.2';
  const language = process.env.AZURE_OCR_LANGUAGE || 'en';

  if (!endpoint || !key) throw new Error('Azure OCR endpoint/key missing');

  const analyzeUrl = `${endpoint}/vision/${apiVersion}/read/analyze?language=${encodeURIComponent(language)}`;
  const submitRes = await fetchWithTimeout(analyzeUrl, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': mimeType || 'application/octet-stream',
    },
    body: buffer,
  }, parseIntSafe(process.env.AZURE_OCR_SUBMIT_TIMEOUT_MS, 20000));

  if (!(submitRes.status === 202 || submitRes.status === 201)) {
    const errText = await submitRes.text().catch(() => '');
    throw new Error(`Azure OCR submit failed (${submitRes.status}): ${errText.substring(0, 250)}`);
  }

  const operationUrl = submitRes.headers.get('operation-location');
  if (!operationUrl) throw new Error('Azure OCR missing operation-location');

  const pollMax = parseIntSafe(process.env.AZURE_OCR_POLL_MAX_ATTEMPTS, 20);
  const pollInterval = parseIntSafe(process.env.AZURE_OCR_POLL_INTERVAL_MS, 1200);
  const pollTimeout = parseIntSafe(process.env.AZURE_OCR_POLL_TIMEOUT_MS, 12000);

  for (let i = 0; i < pollMax; i++) {
    const pollRes = await fetchWithTimeout(operationUrl, {
      method: 'GET',
      headers: { 'Ocp-Apim-Subscription-Key': key },
    }, pollTimeout);

    if (!pollRes.ok) {
      const errText = await pollRes.text().catch(() => '');
      throw new Error(`Azure OCR poll failed (${pollRes.status}): ${errText.substring(0, 250)}`);
    }

    const payload = await pollRes.json();
    const status = String(payload?.status || '').toLowerCase();
    if (status === 'succeeded') {
      const pages = Array.isArray(payload?.analyzeResult?.readResults)
        ? payload.analyzeResult.readResults
        : [];
      const lines = [];
      for (const page of pages) {
        const pageLines = Array.isArray(page?.lines) ? page.lines : [];
        for (const line of pageLines) {
          if (line?.text) lines.push(String(line.text));
        }
      }
      const text = lines.join('\n').trim();
      return {
        text,
        confidence: text ? 90 : 0,
        provider: 'azure',
        pages: pages.length,
      };
    }
    if (status === 'failed') {
      throw new Error(`Azure OCR failed: ${JSON.stringify(payload).substring(0, 400)}`);
    }
    await sleep(pollInterval);
  }

  throw new Error('Azure OCR timed out');
};

