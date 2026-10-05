import axios from 'axios';
import fs from 'fs';
import { callLLM } from '../utils/llmUtils.js';
import ApiUsage from '../models/ApiUsage.js';
import crypto from 'crypto';
import puppeteer from 'puppeteer';
import translate from 'google-translate-api-x';
import TranslationSession from '../models/TranslationSession.js';
import File from '../models/File.js';
const MAX_USAGE = 500;

// Helper to call Google Vision with a 15s timeout and basic per-request error validation
async function callVisionAnnotate(endpoint, body, apiKey) {
  const url = `https://vision.googleapis.com/v1/${endpoint}?key=${apiKey}`;
  const resp = await axios.post(url, body, { timeout: 15000 });
  const data = resp.data || {};
  const responses = data.responses || [];
  const first = responses[0];
  if (first && first.error) {
    throw new Error(`Vision API error: ${first.error.message}`);
  }
  return { data, responses, first };
}

async function extractLandRecordData(extractedText) {
  try {
    const prompt = {
      system: `You are a strict JSON data extractor for Indian legal documents and land records. 
Analyze the highly noisy Hindi/English OCR text and extract the geographic and identity details into a strict JSON object. 
IMPORTANT RULES:
1. Try EXTREMELY HARD to find the District, Mauja, Anchal, and Halka. Look for misspellings, blurred words, abbreviations, and archaic Hindi variations.
2. Map Hindi words like "जिला", "जीला", "डिस्ट्रिक्ट" to "jilla".
3. Map "मौजा", "ग्राम", "साकिन", "गांव" to "mauja".
4. Map "अंचल", "प्रगना", "परगना", "थाना", "प्र०" to "anchal".
5. Map "हल्का", "ह०" to "halka".
6. Return exactly this JSON structure. Only set a field to null if it is TRULY not present anywhere in the text after an exhaustive search. Do not include any text outside the JSON block.
7. CRITICAL: Extract and return ALL values in their original Hindi (Devanagari) script exactly as they appear in the source text. Do NOT translate them to English.
8. Actively search for specific land identifiers like "खाता" (Khata), "खेसरा" / "प्लॉट" (Khesra/Plot), "जमाबंदी" (Jamabandi), "थाना नं" (Thana No), "तौजी" (Touzi No), and Deed/Registry numbers. Extract them into the 'identifiers' array.

{
  "jilla": "District Name or null",
  "anchal": "Anchal / Pargana Name or null",
  "halka": "Halka Name or null",
  "mauja": "Mauja / Gram Name or null",
  "identifiers": [
    { "type": "identifier name (e.g. Khata, Khesra, Jamabandi, Thana No, Touzi No)", "value": "extracted value in original Hindi script" }
  ],
  "documentBrief": "A 1-2 sentence brief describing what this document is."
}`,
      user: extractedText
    };
    
    const response = await callLLM(prompt, { temperature: 0.1 });
    
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in response");
    
    return JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error('LLM Extraction Error:', err.message);
    return null;
  }
}

export const uploadAndTranslate = async (req, res) => {
  try {
    const { targetLanguage } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    if (!targetLanguage) {
      return res.status(400).json({ error: 'Target language is required' });
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Vision API key is not configured in .env' });
    }

    // Check and atomically increment quota before making the API call
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    
    // Find and update if usage count is under limit
    let apiUsage = await ApiUsage.findOneAndUpdate(
      { apiKeyHash, usageCount: { $lt: MAX_USAGE } },
      { $inc: { usageCount: 1 }, $set: { lastUsed: new Date() } },
      { new: true }
    );

    if (!apiUsage) {
      // Either it doesn't exist, or it exists but usageCount >= MAX_USAGE
      const existing = await ApiUsage.findOne({ apiKeyHash });
      
      if (existing && existing.usageCount >= MAX_USAGE) {
        fs.unlinkSync(file.path);
        return res.status(403).json({ error: `API quota exceeded. Maximum of ${MAX_USAGE} requests allowed.` });
      }
      
      // If it doesn't exist, create it with usageCount = 1
      if (!existing) {
        apiUsage = new ApiUsage({ apiKeyHash, usageCount: 1, lastUsed: new Date() });
        await apiUsage.save();
      }
    }

    const fileContent = fs.readFileSync(file.path, { encoding: 'base64' });
    const mimeType = file.mimetype;
    let extractedText = '';

    if (mimeType === 'application/pdf') {
      // Use files:annotate for PDF (sync, up to 5 pages)
      const vr = await callVisionAnnotate('files:annotate', {
        requests: [
          {
            inputConfig: { mimeType: 'application/pdf', content: fileContent },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            pages: [1, 2, 3, 4, 5]
          }
        ]
      }, apiKey);

      const fileResponse = (vr.responses && vr.responses[0]) || {};
      extractedText = (fileResponse.responses || [])
        .filter(r => r.fullTextAnnotation)
        .map(r => r.fullTextAnnotation.text)
        .join('\n\n');
    } else if (mimeType.startsWith('image/')) {
      // Use images:annotate for images
      const vr = await callVisionAnnotate('images:annotate', {
        requests: [ { image: { content: fileContent }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] } ]
      }, apiKey);

      extractedText = vr.first?.fullTextAnnotation?.text || '';
    } else {
      fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or an Image.' });
    }
    
    
    // Clean up file
    fs.unlinkSync(file.path);

    if (!extractedText.trim()) {
      return res.status(400).json({ error: 'No text could be extracted from the provided file.' });
    }

    // Translate using free google-translate-api-x
    let translatedText = '';
    try {
      const res = await translate(extractedText, { to: targetLanguage });
      translatedText = res.text;
    } catch (err) {
      console.error('Translation error:', err.message);
      translatedText = "[Translation Failed]";
    }

    // Extract land record data asynchronously
    const landRecordData = await extractLandRecordData(extractedText);

    res.json({
      originalText: extractedText,
      translatedText: translatedText,
      landRecordData: landRecordData,
      usageCount: apiUsage.usageCount,
      maxUsage: MAX_USAGE
    });

  } catch (error) {
    console.error('Translation error:', error.response?.data || error.message);
    
    // Cleanup on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    res.status(500).json({ error: 'Failed to process the document for translation.' });
  }
};

export const uploadAndTranslateInPlace = async (req, res) => {
  try {
    const { targetLanguage } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    if (!targetLanguage) {
      return res.status(400).json({ error: 'Target language is required' });
    }

    const mimeType = file.mimetype;
    if (!mimeType.startsWith('image/')) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'In-place translation is currently supported for Images only. Please use Standard Translation for PDFs.' });
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Vision API key is not configured in .env' });
    }

    // Check quota
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    let apiUsage = await ApiUsage.findOneAndUpdate(
      { apiKeyHash, usageCount: { $lt: MAX_USAGE } },
      { $inc: { usageCount: 1 }, $set: { lastUsed: new Date() } },
      { new: true }
    );
    if (!apiUsage) {
      const existing = await ApiUsage.findOne({ apiKeyHash });
      if (existing && existing.usageCount >= MAX_USAGE) {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return res.status(403).json({ error: `API quota exceeded. Maximum of ${MAX_USAGE} requests allowed.` });
      }
      if (!existing) {
        apiUsage = new ApiUsage({ apiKeyHash, usageCount: 1, lastUsed: new Date() });
        await apiUsage.save();
      }
    }

    const fileContent = fs.readFileSync(file.path, { encoding: 'base64' });
    
    // Call Google Vision (with shared helper enforcing timeout and per-request validation)
    const vr = await callVisionAnnotate('images:annotate', {
      requests: [ { image: { content: fileContent }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] } ]
    }, apiKey);

    const annotation = vr.first?.fullTextAnnotation;
    if (!annotation) {
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      return res.status(400).json({ error: 'No text found in the image.' });
    }

    // Extract blocks
    const blocks = [];
    const pages = annotation.pages || [];
    let imgWidth = 800; // default
    let imgHeight = 1000;
    
    if (pages.length > 0) {
      imgWidth = pages[0].width || imgWidth;
      imgHeight = pages[0].height || imgHeight;
      
      for (const block of pages[0].blocks || []) {
        let blockText = '';
        for (const paragraph of block.paragraphs || []) {
          let paraText = '';
          for (const word of paragraph.words || []) {
            let wordText = '';
            for (const symbol of word.symbols || []) {
              wordText += symbol.text;
              if (symbol.property && symbol.property.detectedBreak) {
                const breakType = symbol.property.detectedBreak.type;
                if (['SPACE', 'SURE_SPACE'].includes(breakType)) wordText += ' ';
                if (['EOL_SURE_SPACE', 'LINE_BREAK'].includes(breakType)) wordText += '\n';
              }
            }
            paraText += wordText;
          }
          blockText += paraText;
        }
        
        if (blockText.trim()) {
          const vertices = (block.boundingBox && block.boundingBox.vertices) || [];
          if (Array.isArray(vertices) && vertices.length >= 2) {
            const xList = vertices.map(v => v.x || 0);
            const yList = vertices.map(v => v.y || 0);
            const minX = Math.min(...xList);
            const minY = Math.min(...yList);
            const maxX = Math.max(...xList);
            const maxY = Math.max(...yList);
            const width = maxX - minX;
            const height = maxY - minY;
            if (width > 0 && height > 0) {
              blocks.push({ text: blockText.trim(), x: minX, y: minY, width, height });
            }
          }
        }
      }
    }

    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

    if (blocks.length === 0) {
      return res.status(400).json({ error: 'No text blocks found.' });
    }

    // Translate blocks using free google-translate-api-x
    let translatedDict = {};
    try {
      const textArray = blocks.map(b => b.text);
      const res = await translate(textArray, { to: targetLanguage });
      
      if (Array.isArray(res)) {
        res.forEach((t, i) => {
          translatedDict[i] = t.text;
        });
      } else {
        blocks.forEach((b, i) => {
          translatedDict[i] = res.text;
        });
      }
    } catch (err) {
      console.error('Translation error:', err.message);
      blocks.forEach((b, i) => {
        translatedDict[i] = b.text + "\n[Translation Failed]";
      });
    }
const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

let htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; padding: 0; width: ${imgWidth}px; height: ${imgHeight}px; position: relative; overflow: hidden; }
          .bg-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; z-index: 1; }
          .text-block {
            position: absolute;
            z-index: 10;
            backdrop-filter: blur(8px);
            background: rgba(255, 255, 255, 0.95);
            border-radius: 4px;
            color: #111;
            padding: 2px 4px;
            box-sizing: border-box;
            display: flex;
            align-items: flex-start;
            justify-content: flex-start;
            text-align: left;
            font-family: Arial, sans-serif;
            overflow: hidden;
          }
          .text-content {
            width: 100%;
            display: flex;
            align-items: flex-start;
            justify-content: flex-start;
          }
        </style>
      </head>
      <body>
        <img src="data:${escapeHtml(mimeType)};base64,${fileContent}" class="bg-img" />
    `;

    blocks.forEach((block, index) => {
      const translatedText = translatedDict[index] || block.text;
      const lines = translatedText.split('\n').length || 1;
      let estFontSize = Math.min((block.height / lines) * 0.9, block.height * 0.9);
      const maxCharPerLine = Math.max(...translatedText.split('\n').map(l => l.length));
      if (maxCharPerLine > 0 && (maxCharPerLine * estFontSize * 0.5 > block.width)) {
         estFontSize = block.width / (maxCharPerLine * 0.5);
      }
      estFontSize = Math.max(estFontSize, 8);
      
      htmlContent += `
        <div class="text-block" style="left: ${block.x}px; top: ${block.y}px; width: ${block.width}px; height: ${block.height}px;">
          <div class="text-content" style="font-size: ${estFontSize}px; line-height: 1.1;">
            ${escapeHtml(translatedText).replace(/\n/g, '<br/>')}
          </div>
        </div>
      `;
    });

    htmlContent += `
      </body>
      </html>
    `;

    // Puppeteer
    let browser;
    let screenshotBuffer;
    try {
      browser = await puppeteer.launch({ 
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
      });
      const page = await browser.newPage();
      await page.setViewport({ width: imgWidth, height: imgHeight, deviceScaleFactor: 2 });
      await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
      screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {
          console.error('Browser close error:', closeErr.message);
        }
      }
    }

    const resultBase64 = screenshotBuffer.toString('base64');
    
    // Extract land record data
    const fullOriginalText = blocks.map(b => b.text).join('\n');
    const landRecordData = await extractLandRecordData(fullOriginalText);
    
    res.json({
      originalText: fullOriginalText,
      translatedImageBase64: `data:image/jpeg;base64,${resultBase64}`,
      originalBlocks: blocks,
      imageDimensions: { width: imgWidth, height: imgHeight },
      translatedDict: translatedDict,
      landRecordData: landRecordData,
      usageCount: apiUsage.usageCount,
      maxUsage: MAX_USAGE
    });

  } catch (error) {
    console.error('In-place translation error:', error.response?.data || error.message);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ error: 'Failed to process the document for in-place translation.' });
  }
};
export const translateText = async (req, res) => {
  try {
    const { text, dict, targetLanguage } = req.body;
    
    if (dict) {
      const values = Object.values(dict);
      const keys = Object.keys(dict);
      const results = await resilientTranslateBatch(values, targetLanguage);
      const newDict = {};
      results.forEach((r, idx) => { newDict[keys[idx]] = r.text; });
      return res.json({ translatedDict: newDict });
      }   else if (text) {
      const result = await resilientTranslateSingle(text, targetLanguage);
      return res.json({ translatedText: result.text });
    } else if (Array.isArray(req.body.textArray)) {
      const results = await resilientTranslateBatch(req.body.textArray, targetLanguage);
      return res.json({ translatedTexts: results });
    } else if (text) {
       const response = await translate(text, { to: targetLanguage });
       return res.json({ translatedText: response.text });
    }
    
    return res.status(400).json({ error: 'No text or dict provided.' });
  } catch (error) {
    console.error('Text translation error:', error.message);
    res.status(500).json({ error: 'Translation failed.' });
  }
};

export const startTranslationSession = async (req, res) => {
  try {
    const { fileId, targetLanguage, isInPlace } = req.body;
    
    if (!fileId) return res.status(400).json({ error: 'fileId is required' });
    if (!targetLanguage) return res.status(400).json({ error: 'targetLanguage is required' });

    const userId = req.user ? req.user._id : null;
    const session = await TranslationSession.create({
      userId,
      fileId,
      targetLanguage,
      isInPlace: isInPlace === true || isInPlace === 'true',
      status: 'pending'
    });

    processTranslationSession(session._id).catch(err => console.error('Translation async error:', err));

    return res.status(202).json({
      message: 'Translation started',
      sessionId: session._id
    });
  } catch (error) {
    console.error('startTranslationSession error:', error);
    res.status(500).json({ error: 'Failed to start translation session' });
  }
};

export const getTranslationSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await TranslationSession.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    return res.json(session);
  } catch (error) {
    console.error('getTranslationSession error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
};

const processTranslationSession = async (sessionId) => {
  const session = await TranslationSession.findById(sessionId).populate('fileId');
  if (!session || !session.fileId) return;

  try {
    session.status = 'processing';
    await session.save();

    const file = session.fileId;
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) throw new Error('Google Vision API key is not configured');

    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    let apiUsage = await ApiUsage.findOneAndUpdate(
      { apiKeyHash, usageCount: { $lt: MAX_USAGE } },
      { $inc: { usageCount: 1 }, $set: { lastUsed: new Date() } },
      { new: true }
    );
    if (!apiUsage) {
      const existing = await ApiUsage.findOne({ apiKeyHash });
      if (existing && existing.usageCount >= MAX_USAGE) {
        throw new Error(`API quota exceeded. Maximum of ${MAX_USAGE} requests allowed.`);
      }
      if (!existing) {
        apiUsage = new ApiUsage({ apiKeyHash, usageCount: 1, lastUsed: new Date() });
        await apiUsage.save();
      }
    }

    session.usageCount = apiUsage.usageCount;
    session.maxUsage = MAX_USAGE;

    const fileContent = fs.readFileSync(file.path, { encoding: 'base64' });
    const mimeType = file.fileType || 'image/jpeg';
    
    if (session.isInPlace) {
      if (!mimeType.startsWith('image/')) {
        throw new Error('In-place translation is currently supported for Images only.');
      }
      const vr = await callVisionAnnotate('images:annotate', { requests: [{ image: { content: fileContent }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }, apiKey);
      const annotation = vr.first?.fullTextAnnotation;
      if (!annotation) throw new Error('No text found in the image.');

      const blocks = [];
      const pages = annotation.pages || [];
      let imgWidth = 800; let imgHeight = 1000;
      if (pages.length > 0) {
        imgWidth = pages[0].width || imgWidth;
        imgHeight = pages[0].height || imgHeight;
        for (const block of pages[0].blocks || []) {
          let blockText = '';
          for (const paragraph of block.paragraphs || []) {
            let paraText = '';
            for (const word of paragraph.words || []) {
              let wordText = '';
              for (const symbol of word.symbols || []) {
                wordText += symbol.text;
                if (symbol.property && symbol.property.detectedBreak) {
                  const bt = symbol.property.detectedBreak.type;
                  if (['SPACE', 'SURE_SPACE'].includes(bt)) wordText += ' ';
                  if (['EOL_SURE_SPACE', 'LINE_BREAK'].includes(bt)) wordText += '\n';
                }
              }
              paraText += wordText;
            }
            blockText += paraText;
          }
          if (blockText.trim()) {
            const vertices = (block.boundingBox && block.boundingBox.vertices) || [];
            if (Array.isArray(vertices) && vertices.length >= 2) {
              const xList = vertices.map(v => v.x || 0);
              const yList = vertices.map(v => v.y || 0);
              const minX = Math.min(...xList);
              const minY = Math.min(...yList);
              const maxX = Math.max(...xList);
              const maxY = Math.max(...yList);
              const width = maxX - minX;
              const height = maxY - minY;
              if (width > 0 && height > 0) {
                blocks.push({ text: blockText.trim(), x: minX, y: minY, width, height });
              }
            }
          }
        }
      }

      if (blocks.length === 0) throw new Error('No text blocks found.');
      
      let translatedDict = {};
      try {
        const textArray = blocks.map(b => b.text);
        const res = await translate(textArray, { to: session.targetLanguage });
        if (Array.isArray(res)) res.forEach((t, i) => { translatedDict[i] = t.text; });
        else blocks.forEach((b, i) => { translatedDict[i] = res.text; });
      } catch (err) {
        console.error('Translation block error:', err.message);
        blocks.forEach((b, i) => { translatedDict[i] = b.text + "\n[Translation Failed]"; });
      }

      let htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { margin: 0; padding: 0; width: ${imgWidth}px; height: ${imgHeight}px; position: relative; overflow: hidden; }
            .bg-img { position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: contain; z-index: 1; }
            .text-block { position: absolute; z-index: 10; backdrop-filter: blur(8px); background: rgba(255, 255, 255, 0.95); border-radius: 4px; color: #111; padding: 2px 4px; box-sizing: border-box; display: flex; align-items: flex-start; justify-content: flex-start; text-align: left; font-family: Arial, sans-serif; overflow: hidden; }
            .text-content { width: 100%; display: flex; align-items: flex-start; justify-content: flex-start; }
          </style>
        </head>
        <body>
          <img src="data:${mimeType};base64,${fileContent}" class="bg-img" />
      `;

      blocks.forEach((block, index) => {
        const translatedText = translatedDict[index] || block.text;
        const lines = translatedText.split('\n').length || 1;
        let estFontSize = Math.min((block.height / lines) * 0.9, block.height * 0.9);
        const maxCharPerLine = Math.max(...translatedText.split('\n').map(l => l.length));
        if (maxCharPerLine > 0 && (maxCharPerLine * estFontSize * 0.5 > block.width)) {
           estFontSize = block.width / (maxCharPerLine * 0.5);
        }
        estFontSize = Math.max(estFontSize, 8);
        
        htmlContent += `
          <div class="text-block" style="left: ${block.x}px; top: ${block.y}px; width: ${block.width}px; height: ${block.height}px;">
            <div class="text-content" style="font-size: ${estFontSize}px; line-height: 1.1;">
              ${translatedText.replace(/\n/g, '<br/>')}
            </div>
          </div>
        `;
      });
      htmlContent += `</body></html>`;

      let browser;
      let screenshotBuffer;
      try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        const page = await browser.newPage();
        await page.setViewport({ width: imgWidth, height: imgHeight, deviceScaleFactor: 2 });
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
        screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90 });
      } finally {
        if (browser) {
          try {
            await browser.close();
          } catch (closeErr) {
            console.error('Browser close error:', closeErr.message);
          }
        }
      }

      const fullOriginalText = blocks.map(b => b.text).join('\n');
      session.originalText = fullOriginalText;
      session.translatedImageBase64 = `data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`;
      session.originalBlocks = blocks;
      session.imageDimensions = { width: imgWidth, height: imgHeight };
      session.translatedDict = translatedDict;
      session.landRecordData = await extractLandRecordData(fullOriginalText);

    } else {
      let extractedText = '';
      if (mimeType === 'application/pdf') {
        const vr = await callVisionAnnotate('files:annotate', { requests: [{ inputConfig: { mimeType: 'application/pdf', content: fileContent }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }], pages: [1, 2, 3, 4, 5] }] }, apiKey);
        const fileResponse = (vr.responses && vr.responses[0]) || {};
        const responses = fileResponse.responses || [];
        extractedText = responses.filter(r => r.fullTextAnnotation).map(r => r.fullTextAnnotation.text).join('\n\n');
      } else {
        const vr = await callVisionAnnotate('images:annotate', { requests: [{ image: { content: fileContent }, features: [{ type: 'DOCUMENT_TEXT_DETECTION' }] }] }, apiKey);
        extractedText = vr.first?.fullTextAnnotation?.text || '';
      }

      if (!extractedText.trim()) throw new Error('No text could be extracted.');

      session.originalText = extractedText;
      try {
        const res = await translate(extractedText, { to: session.targetLanguage });
        session.translatedText = res.text;
      } catch (err) {
        console.error('Translation error:', err.message);
        session.translatedText = "[Translation Failed]";
      }
      session.landRecordData = await extractLandRecordData(extractedText);
    }

    session.status = 'completed';
    await session.save();
  } catch (err) {
    console.error('processTranslationSession error:', err);
    session.status = 'failed';
    session.errorDetails = err.message;
    await session.save();
  }
};
