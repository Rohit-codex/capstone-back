import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { AppError } from '../utils/errors.js';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadTemplates, getTemplateText } from '../utils/templateIndex.js';
import { renderTemplateDocx, fillUnderlineDocx, injectDesignToDocx } from '../utils/templateRenderDocx.js';
import { Document, Paragraph, TextRun, Packer, AlignmentType } from 'docx';
import DocumentSession from '../models/DocumentSession.js';
import redis from '../utils/redisClient.js';
import { writeDocxFromText } from '../utils/docxWriter.js';
import { generatePdf } from '../services/pdfGenerationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GENERATED_DIR = path.resolve(__dirname, '../../generated_docs');
const LLM_HTTP_TIMEOUT_MS = Number(process.env.LLM_HTTP_TIMEOUT_MS || 180000);


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


const DRAFTING_SYSTEM_PROMPT = `You are a legal drafting assistant. Generate a formal Indian legal document with clear headings and numbered clauses based on the provided details. Use professional tone, avoid markdown, and include appropriate sections (parties, recitals/background, terms/reliefs/demands, governing law, signatures).`;


async function callLocalLLM(prompt) {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (provider === 'groq') {
    if (!process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is missing');
    }
    const model = process.env.GROQ_MODEL || 'llama-3.1-8b-instant';
    const groqResponse = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        timeout: LLM_HTTP_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return groqResponse?.data?.choices?.[0]?.message?.content || '';
  }

  if (provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY is missing');
    }
    const model = process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.1-8b-instruct';
    const openRouterResponse = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 1000
      },
      {
        timeout: LLM_HTTP_TIMEOUT_MS,
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': process.env.OPENROUTER_REFERRER || 'http://localhost',
          'X-Title': process.env.OPENROUTER_APP_NAME || 'dastavezai-local-dev',
        }
      }
    );
    return openRouterResponse?.data?.choices?.[0]?.message?.content || '';
  }

  const response = await axios.post(
    'http://localhost:11434/api/generate',
    {
      model: 'llama3.1:8b',
      prompt,
      stream: false
    },
    { timeout: LLM_HTTP_TIMEOUT_MS }
  );

  return response?.data?.response;
}


export const generateDraft = async (req, res) => {
  try {
    const { docType, parties, facts, instructions } = req.body || {};

    if (!docType || !parties || !facts || !instructions) {
      throw new AppError('docType, parties, facts, and instructions are required', 400);
    }

    const prompt = [
      DRAFTING_SYSTEM_PROMPT,
      '',
      `Document Type: ${String(docType).trim()}`,
      `Parties: ${String(parties).trim()}`,
      `Facts/Background: ${String(facts).trim()}`,
      `Instructions/Demands: ${String(instructions).trim()}`,
      '',
      'Return only the final draft text in plain paragraphs (no markdown).',
      '',
      'Assistant:'
    ].join('\n');

    let draftText = null;

    
    try {
      draftText = await callLocalLLM(prompt);
    } catch (_) {}

    
    if (!draftText || !draftText.trim()) {
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: DRAFTING_SYSTEM_PROMPT
      });

      const result = await model.generateContent(prompt);
      draftText = result.response.text();
    }

    if (!draftText || !draftText.trim()) {
      throw new AppError('Failed to generate draft document', 500);
    }

    
    await fs.mkdir(GENERATED_DIR, { recursive: true });

    const fileName = `${Date.now()}_${String(docType)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_')}.txt`;

    const filePath = path.join(GENERATED_DIR, fileName);
    await fs.writeFile(filePath, draftText, 'utf-8');

    res.json({
      success: true,
      message: 'Draft generated successfully',
      downloadUrl: `/api/files/download/${fileName}`,
      fileName
    });

  } catch (error) {
    throw new AppError(error.message || 'Error generating draft', 500);
  }
};

export default { generateDraft };

async function extractPlaceholdersFromTemplate(template) {
  try {
    const text = await getTemplateText(template);
    if (!text || text.length < 50) {
      console.warn('⚠️  Template text too short or empty:', template.relPath);
      return [];
    }

    const placeholders = new Set();
    const seenNames = new Set();

    
    const pattern1Regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
    let match;
    while ((match = pattern1Regex.exec(text)) !== null) {
      placeholders.add(match[1]);
    }

    
    const pattern2Regex = /[<\[]\s*([a-zA-Z_][a-zA-Z0-9_\s]*)\s*[>\]]/g;
    while ((match = pattern2Regex.exec(text)) !== null) {
      const name = match[1].trim().replace(/\s+/g, '_');
      if (name.length > 1 && name.length < 100) placeholders.add(name);
    }

    
    
    const blankLineRegex = /(\d+\.\s+)?(.{0,100}?)([._]{5,})(.{0,100})?/g;
    let blankMatch;
    let blankFieldIndex = 0;
    while ((blankMatch = blankLineRegex.exec(text)) !== null) {
      
      const label = blankMatch[2]?.trim() || `Field_${++blankFieldIndex}`;
      if (label && label.length > 1) {
        const sanitized = label
          .substring(0, 60)
          .replace(/[^a-zA-Z0-9_\s]/g, '')
          .trim()
          .replace(/\s+/g, '_');
        if (sanitized.length > 1) placeholders.add(sanitized);
      } else {
        placeholders.add(`Blank_${++blankFieldIndex}`);
      }
    }

    
    const fields = Array.from(placeholders)
      .filter(name => {
        
        const lower = name.toLowerCase();
        const skipWords = ['rtf', 'doc', 'docx', 'pdf', 'page', 'pages', 'word', 'microsoft', 'noreferrer', 'noopener'];
        return !skipWords.includes(lower) && name.length < 100;
      })
      .map((name, idx) => ({
        key: name.toLowerCase().replace(/\s+/g, '_'),
        label: name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' '),
        description: `${name.replace(/_/g, ' ')} (auto-detected from template)`,
        required: true,
        order: idx
      }));

    console.log(`📋 Auto-extracted ${fields.length} placeholders from template: ${template.relPath}`);
    return fields;
  } catch (error) {
    console.error('❌ Error extracting placeholders:', error.message);
    return [];
  }
}

export const getTemplateSchema = async (req, res) => {
  try {
    const { templatePath } = req.query;
    console.log('📋 [getTemplateSchema] Request received:', { templatePath, userId: req.user?.id });
    
    if (!templatePath) {
      console.error('❌ [getTemplateSchema] No templatePath provided');
      throw new AppError('templatePath query parameter is required', 400);
    }

    
    const templates = await loadTemplates();
    console.log(`📚 [getTemplateSchema] Loaded ${templates.length} templates`);
    
    const template = templates.find(t => 
      t.relPath === templatePath || 
      t.relPath.endsWith(templatePath) ||
      templatePath.includes(t.relPath)
    );

    if (!template) {
      console.error(`❌ [getTemplateSchema] Template not found: ${templatePath}`);
      console.log('Available templates (first 10):', templates.slice(0, 10).map(t => t.relPath));
      throw new AppError('Template not found', 404);
    }
    
    console.log(`✅ [getTemplateSchema] Template found:`, {
      relPath: template.relPath,
      displayTitle: template.displayTitle,
      hasSchema: !!template.schema,
      schemaLength: template.schema?.length || 0
    });

    let fields = Array.isArray(template.schema) ? template.schema : [];
    
    
    if (!fields || fields.length === 0) {
      console.log(`⚠️  Template ${template.relPath} has no schema metadata, auto-detecting placeholders...`);
      fields = await extractPlaceholdersFromTemplate(template);
      
      if (!fields || fields.length === 0) {
        throw new AppError('Template has no field metadata and no placeholders detected', 400);
      }
      
      console.log(`✅ Auto-detected ${fields.length} fields for template: ${template.relPath}`);
    }

    
    const displayTitle = template.displayTitle || template.relPath
      .split('/').pop()
      .replace(/\.docx$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    res.json({
      success: true,
      templatePath: template.relPath,
      displayTitle,
      fields,
      fieldCount: fields.length,
      requiredCount: fields.filter(f => f.required !== false).length,
      autoDetected: !template.schema || template.schema.length === 0
    });

  } catch (error) {
    throw new AppError(error.message || 'Error fetching template schema', error.statusCode || 500);
  }
};

export const generateFromForm = async (req, res) => {
  const slug = req?.headers?.['x-chat-slug'] || req?.query?.slug || req?.body?.slug || 'default';
  try {
    const { templatePath, fields, language = 'en', designConfig } = req.body;
    
    console.log('🔍 [GENERATEFROMFORM] Request received:', {
      templatePath,
      fieldKeys: Object.keys(fields || {}),
      fieldCount: Object.keys(fields || {}).length,
      language,
      hasDesignConfig: !!designConfig,
      userId: req.user?.id
    });
    
    
    if (designConfig) {
      console.log('✅ designConfig received in generateFromForm:', {
        fontFamily: designConfig.fontFamily,
        fontSize: designConfig.fontSize,
        titleAlignment: designConfig.titleAlignment,
        bodyAlignment: designConfig.bodyAlignment,
        borderStyle: designConfig.borderStyle
      });
    } else {
      console.log('⚠️  NO designConfig provided - will use defaults');
    }

    if (!templatePath) {
      throw new AppError('templatePath is required', 400);
    }

    if (!fields || typeof fields !== 'object') {
      throw new AppError('fields object is required', 400);
    }

    
    if (templatePath.startsWith('AI_SCHEMA:')) {
      
      const documentType = templatePath.replace('AI_SCHEMA:', '').replace(/_/g, ' ');
      
      console.log(`📄 Generating schema-based AI document: ${documentType}`);
      
      
      let pending = null;
      try {
        const pendingStr = await redis.get(`pending_ai_document:${req.user.id}:${slug}`);
        pending = pendingStr ? JSON.parse(pendingStr) : null;
      } catch (e) {
        console.warn('Failed to retrieve pending AI document:', e?.message);
      }
      
      if (!pending || !pending.requiredFields) {
        throw new AppError('AI document schema not found. Please start the process again.', 404);
      }
      
      
      const allData = { ...pending.extractedData, ...fields };
      
      
      pending.extractedData = allData;
      pending.documentLanguage = language;
      
      
      await redis.del(`pending_ai_document:${req.user.id}:${slug}`);
      
      
      
      const { callLocalLLM } = await import('../controllers/chatController.js');
      
      
      const dataDescription = Object.entries(allData)
        .filter(([k, v]) => v)
        .map(([k, v]) => {
          const field = pending.requiredFields?.find(f => f.key === k);
          return `${field?.label || k}: ${v}`;
        })
        .join('\n');
      
      const isHindi = language === 'hi';
      const langInstruction = isHindi
        ? `\n\nIMPORTANT: Generate the ENTIRE document in HINDI language using Devanagari script. All headings, content, and text should be in proper Hindi.`
        : `\n\nGenerate the document in formal English.`;
      
      const generatePrompt = `You are an expert Indian legal document drafter. Generate a complete, professional ${pending.documentType}.

DOCUMENT TYPE: ${pending.documentTitle}
DESCRIPTION: ${pending.description}
ORIGINAL REQUEST: ${pending.originalRequest || documentType}

PROVIDED INFORMATION:
${dataDescription}

STRICT RULES:
1. DO NOT add any disclaimers, warnings, or notes about document validity
2. DO NOT add any text like "this document should not be used for..." 
3. DO NOT include any AI-generated notices or cautionary statements
4. DO NOT use placeholder brackets like [Your Name], [DATE], [PARTY], [ADDRESS] — substitute blank underlines ("________") for genuinely unknown values
5. Start directly with the document title/heading
6. Use plain text only (no markdown, no ** or # symbols)
7. Make it legally sound and professional
8. For dates, use the current date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

Create a complete, formal Indian legal document with:
1. Proper heading and title
2. All parties clearly identified using provided names (use "________" for any genuinely missing party name)
3. Main content with numbered clauses
4. Date and place
5. Signature section
6. Verification/Declaration if needed (standard legal verification ONLY)

Fill in ALL the provided information exactly as given.
${langInstruction}

Generate the complete document now (NO disclaimers, NO bracket placeholders):`;
      
      console.log('🔄 Generating schema-based AI document...');
      const documentText = await callLocalLLM(generatePrompt);
      
      if (!documentText || documentText.trim().length < 100) {
        throw new Error('AI generated insufficient content');
      }
      
      
      let cleanedText = documentText
        .replace(/\*\*/g, '')
        .replace(/^#+\s*/gm, '')
        .replace(/__/g, '')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/```/g, '')
        .trim();

      
      
      const preambleBreakPatterns = [
        /^[\s\S]*?(?:here(?:'s| is) (?:a |the |your |my )?(?:sample |complete |draft |generated )?document[^:]*:\s*\n+)/i,
        /^[\s\S]*?(?:based on the (?:provided |given )?information[,:]?\s*\n+)/i,
        /^[\s\S]*?(?:please note that[^\n]*\n+)/i,
      ];
      for (const pattern of preambleBreakPatterns) {
        const match = cleanedText.match(pattern);
        if (match && match[0].length < cleanedText.length * 0.4) {
          cleanedText = cleanedText.slice(match[0].length).trim();
        }
      }
      
      const firstLine = cleanedText.split('\n')[0].trim();
      if (/^(i |this |please |note:|here|as |based |the following)/i.test(firstLine) && firstLine.length < 200) {
        const idx = cleanedText.indexOf('\n');
        if (idx > -1) cleanedText = cleanedText.slice(idx + 1).trim();
      }
      
      
      const { filePath, fileSize } = await writeDocxFromText(cleanedText, pending.documentTitle, 'uploads/generated', designConfig || null, true);
      
      
      const downloadUrl = `/api/files/download/${path.basename(filePath)}`;

      
      let aiPdfUrl = null;
      if (designConfig) {
        try {
          const docxBuf = fsSync.readFileSync(filePath);
          const safeBase = pending.documentTitle.replace(/[^a-z0-9_\s-]/gi, '').replace(/\s+/g, '_').substring(0, 40) || 'document';
          const pdfRes = await generatePdf({ docxBuffer: docxBuf, text: cleanedText, title: pending.documentTitle, baseName: safeBase, designConfig, skipTitle: true });
          aiPdfUrl = pdfRes.downloadUrl;
        } catch (e) { console.warn('⚠️ AI schema PDF generation failed:', e.message); }
      }
      
      
      return res.json({
        success: true,
        message: language === 'hi' 
          ? `आपका ${pending.documentTitle} तैयार है। आप इसे डाउनलोड कर सकते हैं।`
          : `Your ${pending.documentTitle} is ready. You can download it below.`,
        file: {
          url: downloadUrl,
          name: path.basename(filePath),
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: fileSize
        },
        ...(aiPdfUrl ? { pdfFile: { url: aiPdfUrl, name: aiPdfUrl.split('/').pop(), type: 'application/pdf' } } : {}),
        document: {
          text: cleanedText,
          displayTitle: pending.documentTitle,
          isCustomGenerated: true
        }
      });
    }

    
    console.log(`📄 [TEMPLATE_PATH] Using template-based generation for: ${templatePath}`);
    
    const templates = await loadTemplates();
    const template = templates.find(t => 
      t.relPath === templatePath || 
      t.relPath.endsWith(templatePath) ||
      templatePath.includes(t.relPath)
    );

    if (!template) {
      console.error(`❌ [ERROR] Template not found: ${templatePath}`);
      throw new AppError('Template not found', 404);
    }
    
    console.log(`✅ [TEMPLATE_FOUND] ${template.displayTitle || template.relPath}`);

    const schemaFields = Array.isArray(template.schema) ? template.schema : [];

    
    const missingFields = schemaFields
      .filter(f => f.required !== false)
      .filter(f => !fields[f.key] || String(fields[f.key]).trim() === '')
      .map(f => f.label || f.key);

    if (missingFields.length > 0) {
      throw new AppError(`Missing required fields: ${missingFields.join(', ')}`, 400);
    }

    
    const displayTitle = template.displayTitle || template.relPath
      .split('/').pop()
      .replace(/\.docx$/, '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());

    
    const templateBuffer = fsSync.readFileSync(template.filePath);
    const zip2 = (await import('pizzip')).default;
    const templateZip = new zip2(templateBuffer);
    const templateXml = templateZip.files['word/document.xml'].asText();
    const usesHandlebars = /\{\{[a-z_]+\}\}/.test(templateXml);

    const placeholderOrder = template.placeholder_order || [];

    console.log(`📄 Template type: ${usesHandlebars ? '{{handlebars}}' : '____underscores'}, title="${displayTitle}", hasDesignConfig=${!!designConfig}`);
    const outDir = path.resolve(process.cwd(), 'uploads', 'generated');
    let filePath, fileSize;

    try {
      if (usesHandlebars) {
        
        ({ filePath, fileSize } = await renderTemplateDocx(
          template.filePath, fields, outDir, displayTitle, designConfig || null
        ));
        console.log('✅ renderTemplateDocx (handlebars) succeeded');
      } else {
        
        ({ filePath, fileSize } = await fillUnderlineDocx(
          template.filePath, fields, placeholderOrder, outDir, displayTitle, designConfig || null
        ));
        console.log('✅ fillUnderlineDocx (underscore) succeeded');
      }
    } catch (renderErr) {
      console.warn('⚠️ Template render failed:', renderErr.message);
      throw new AppError('Failed to render document template', 500);
    }

    
    
    
    let documentText = '';
    let documentHtml = null;
    try {
      const filledBuf = fsSync.readFileSync(filePath);
      const PizZipPdf = (await import('pizzip')).default;
      const dzip = new PizZipPdf(filledBuf);
      const dXml = dzip.files['word/document.xml'].asText();

      
      
      const paragraphs = [];
      const paragraphMatches = [...dXml.matchAll(/<w:p[ >]([\s\S]*?)<\/w:p>/g)];
      for (const pm of paragraphMatches) {
        const pContent = pm[1];
        
        const jcMatch = pContent.match(/<w:jc w:val="([^"]+)"/);
        let align = 'justify';
        if (jcMatch) {
          const jcVal = jcMatch[1];
          align = jcVal === 'right' ? 'right' : jcVal === 'center' ? 'center' : jcVal === 'left' ? 'left' : 'justify';
        }
        
        const textParts = [...pContent.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(t => t[1]);
        const lineText = textParts.join('');
        if (lineText.trim()) {
          paragraphs.push({ text: lineText, align });
        } else {
          paragraphs.push({ text: '', align: 'left' });
        }
      }
      documentHtml = paragraphs;

      
      documentText = paragraphs.map(p => p.text).join('\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    } catch (e) {
      console.warn('⚠️ XML text extraction for PDF failed (non-fatal):', e.message);
    }

    
    let pdfDownloadUrl = null;
    try {
      const docxBuffer = fsSync.readFileSync(filePath);
      const safeBase = displayTitle.replace(/[^a-z0-9_\s-]/gi, '').replace(/\s+/g, '_').substring(0, 40) || 'document';
      const pdfResult = await generatePdf({
        docxBuffer,
        text: documentText || null,
        structuredParagraphs: documentHtml || null,
        title: displayTitle,
        baseName: safeBase,
        designConfig: designConfig || null,
        skipTitle: true,
      });
      pdfDownloadUrl = pdfResult.downloadUrl;
      console.log('✅ PDF generated:', pdfResult.downloadUrl);
    } catch (pdfErr) {
      console.warn('⚠️ PDF generation failed (non-fatal):', pdfErr.message);
    }
    const fileName = path.basename(filePath);

    
    try {
      const session = await DocumentSession.findOneAndUpdate(
        {
          userId: req.user.id,
          'template.relPath': templatePath,
          status: { $in: ['active', 'completed'] }
        },
        {
          $set: {
            accumulatedData: new Map(Object.entries(fields)),
            status: 'completed',
            'template.displayTitle': displayTitle,
            'template.schema': schemaFields,
            fields: fields,
            updatedAt: new Date()
          }
        },
        {
          upsert: true,
          new: true,
          runValidators: false
        }
      );
      console.log(`💾 Saved form data to DocumentSession for user ${req.user.id}`, {
        templatePath,
        fieldCount: Object.keys(fields).length,
        schemaFieldCount: schemaFields.length
      });
    } catch (sessionError) {
      
      console.warn('⚠️ Failed to save form data to DocumentSession:', sessionError.message);
    }

    const successMessage = language === 'hi'
      ? `आपका **${displayTitle}** तैयार है। आप इसे नीचे देख और डाउनलोड कर सकते हैं।`
      : `Your **${displayTitle}** is ready. You can review and download it below.`;

    res.json({
      success: true,
      message: successMessage,
      file: {
        url: `/api/files/download/${fileName}`,
        name: fileName,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: fileSize
      },
      ...(pdfDownloadUrl ? {
        pdfFile: {
          url: pdfDownloadUrl,
          name: pdfDownloadUrl.split('/').pop(),
          type: 'application/pdf',
        }
      } : {}),
      document: {
        content: '',
        title: displayTitle
      }
    });

  } catch (error) {
    throw new AppError(error.message || 'Error generating document', error.statusCode || 500);
  }
};
