import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import axios from 'axios';
import { AppError } from '../utils/errors.js';
import { callLLM } from '../utils/llmUtils.js';

let caseIndex = null;

const candidatePaths = [
  path.resolve(process.cwd(), '../../chatbot_try/langchain/combined_legal_cases.csv'),
  path.resolve(process.cwd(), '../../chatbot_try/langchain-ask-csv/combined_legal_cases.csv'),
  path.resolve(process.cwd(), '../../chatbot_try/testing/combined_legal_cases.csv'),
];

const loadCaseIndex = async () => {
  if (caseIndex !== null) return caseIndex;
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      const rows = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(p)
          .pipe(csv())
          .on('data', (row) => {
            const title = row.title || row.Title || '';
            const citation = row.citation || row.Citation || '';
            const summary = row.summary || row.Summary || row.content || '';
            rows.push({ title, citation, summary });
          })
          .on('end', resolve)
          .on('error', reject);
      });
      caseIndex = rows;
      return caseIndex;
    }
  }
  caseIndex = [];
  return caseIndex;
};

const generateLLMPrecedences = async (query, limit = 5) => {
  const prompt = `You are an expert Indian legal researcher. For the following legal query, provide ${limit} relevant Indian Supreme Court or High Court case precedents.

Query: ${query}

Respond ONLY with a valid JSON array (no prose, no markdown fences):
[
  {
    "caseName": "Petitioner vs Respondent (Year)",
    "citation": "AIR XXXX SC XXX or (XXXX) X SCC XXX",
    "relevance": "one-sentence reason why this case is relevant to the query",
    "summary": "2-3 sentence summary of the judgment and its significance"
  }
]

Rules:
- Only cite REAL cases that actually exist in Indian jurisprudence
- Prioritize Supreme Court cases; include High Court cases only if highly relevant
- Keep relevance and summary concise (under 150 chars each)
- Return ONLY the JSON array`;

  try {
    const raw_clean = (await callLLM(prompt))
      .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
    const arrIdx = raw_clean.indexOf('[');
    const jsonStr = arrIdx >= 0 ? raw_clean.substring(arrIdx) : raw_clean;
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) return parsed.slice(0, limit);
  } catch (err) {
    console.warn('LLM precedence generation failed:', err.message);
  }
  return [];
};

export const searchCases = async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));
    if (!q) {
      throw new AppError('Missing query parameter q', 400);
    }
    const index = await loadCaseIndex();

    
    if (!index.length) {
      console.log('📚 Case CSV not found, using LLM to generate precedences for:', q);
      const results = await generateLLMPrecedences(q, limit);
      return res.json({ results, source: 'llm' });
    }

    const scored = [];
    for (const item of index) {
      const text = `${item.title} ${item.citation} ${item.summary}`.toLowerCase();
      if (!text) continue;
      let score = 0;
      if (text.includes(q)) score += 2;
      for (const tok of q.split(/\s+/)) {
        if (tok && text.includes(tok)) score += 1;
      }
      if (score > 0) scored.push({ score, item });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, limit).map(({ item }) => item);
    res.json({ results, source: 'csv' });
  } catch (error) {
    throw new AppError(error.message || 'Error searching cases', 500);
  }
};

export default { searchCases };


const augmentCache = new Map();

const fetchWiki = async (caseName) => {
  const trimmed = (caseName || '').trim();
  if (!trimmed) return null;
  const opts = { timeout: 8000, headers: { Accept: 'application/json', 'User-Agent': 'Dastavezai/1.0' } };

  const tryRest = async (title) => {
    try {
      const { data } = await axios.get(
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        opts
      );
      return {
        extract: data.extract || '',
        thumbnail: data.thumbnail?.source || data.originalimage?.source || null,
        wikiUrl: data.content_urls?.desktop?.page || null,
      };
    } catch {
      return null;
    }
  };

  let result = await tryRest(trimmed);
  if (!result && trimmed.includes(' ')) {
    result = await tryRest(trimmed.replace(/\s+/g, '_'));
  }
  if (!result) {
    try {
      const wikiTitle = trimmed.replace(/\s+/g, '_');
      const { data } = await axios.get(
        `https://en.wikipedia.org/w/api.php`,
        {
          ...opts,
          params: {
            action: 'query',
            titles: wikiTitle,
            prop: 'extracts|pageimages',
            exintro: 1,
            explaintext: 1,
            exchars: 500,
            format: 'json',
            origin: '*',
          },
        }
      );
      const pages = data?.query?.pages || {};
      const page = Object.values(pages).find((p) => p.pageid > 0 && p.extract);
      if (page) {
        result = {
          extract: page.extract || '',
          thumbnail: page.thumbnail?.source || null,
          wikiUrl: page.pageid ? `https://en.wikipedia.org/wiki/?curid=${page.pageid}` : null,
        };
      }
    } catch {
      /* ignore */
    }
  }
  return result;
};

const enrichWithLLM = async (caseName, wikiExtract = '') => {
  const context = wikiExtract ? `Wikipedia extract: ${wikiExtract.substring(0, 800)}` : '';
  const prompt = `You are an expert Indian legal scholar. Provide structured enrichment for:
  Case: ${caseName}
  ${context}

  Respond ONLY with a valid JSON object (no prose, no markdown fences):
  {
    "bench": "Names of presiding judges (if known)",
    "year": "Year of judgment",
    "court": "Court name",
    "keyFacts": "2-3 sentence summary of key facts",
    "holding": "The ratio decidendi / core holding",
    "significance": "Doctrinal/constitutional significance in 1-2 sentences",
    "citation": "Correct legal citation",
    "relatedCases": ["Related case 1", "Related case 2"]
  }`;

  try {
    const raw = (await callLLM(prompt))
      .replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim();
    const objIdx = raw.indexOf('{');
    if (objIdx >= 0) return JSON.parse(raw.substring(objIdx));
  } catch (err) {
    console.warn('LLM case enrichment failed:', err.message);
  }
  return {};
};

export const augmentCase = async (req, res) => {
  const { caseName, noLLM = false } = req.body || {};
  if (!caseName || typeof caseName !== 'string' || !caseName.trim()) {
    throw new AppError('caseName is required', 400);
  }

  const cacheKey = `${caseName.trim().toLowerCase()}::${noLLM}`;
  if (augmentCache.has(cacheKey)) {
    return res.json({ success: true, ...augmentCache.get(cacheKey), cached: true });
  }

  
  const [wiki, llm] = await Promise.all([
    fetchWiki(caseName),
    noLLM ? Promise.resolve({}) : enrichWithLLM(caseName, '').catch(() => ({})),
  ]);

  
  let llmEnriched = llm;
  if (!noLLM && wiki?.extract) {
    llmEnriched = await enrichWithLLM(caseName, wiki.extract).catch(() => llm);
  }

  const result = {
    caseName,
    wiki: wiki || null,
    ...llmEnriched,
  };

  
  augmentCache.set(cacheKey, result);

  res.json({ success: true, ...result });
};



