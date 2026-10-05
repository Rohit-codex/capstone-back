
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseDocumentStructure, analyzeDocumentRisks } from './documentParserService.js';
import EditSession from '../models/EditSession.js';
import { diffChars, diffWords } from 'diff';
import { writeDocxFromStructure } from '../utils/docxStructureWriter.js';
import { mergeEditedTextIntoStructure } from '../utils/textToStructure.js';
import { generatePdf as generatePdfService } from './pdfGenerationService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PYTHON_SERVICE_ENABLED = (process.env.PYTHON_SERVICE_ENABLED || 'false').toLowerCase() === 'true';



export const createEditSession = async (userId, fileId, extractedText, fileName, docxStructure = null, htmlContent = '') => {

  let session = await EditSession.findOne({
    userId,
    fileId,
    status: 'active'
  });

  if (session) {
    console.log(`📝 Resuming existing edit session for user ${userId}, file: ${fileName}`);
    return sessionToObject(session);
  }


  const structure = parseDocumentStructure(extractedText, fileName);
  const riskAnalysis = analyzeDocumentRisks(structure);


  const detectedVariables = extractTemplateVariables(extractedText);


  session = new EditSession({
    userId,
    fileId,
    fileName,
    fileType: fileName.split('.').pop().toLowerCase(),
    originalText: extractedText,
    currentText: extractedText,
    htmlContent: htmlContent || '',
    structure,
    riskAnalysis,
    detectedVariables,
    docxStructure: docxStructure || null,
    changes: [],
    undoPosition: -1
  });

  await session.save();

  console.log(`📝 Edit session created for user ${userId}, file: ${fileName}`);
  console.log(`   → ${structure?.summary?.sectionCount || 0} sections detected`);
  console.log(`   → ${detectedVariables.length} template variables found`);

  return sessionToObject(session);
};

export const getEditSession = async (userId, fileId = null) => {
  const query = { userId, status: 'active' };
  if (fileId) query.fileId = fileId;
  const session = await EditSession.findOne(query).sort({ updatedAt: -1 });

  if (!session) return null;
  return sessionToObject(session);
};

export const getUserSessions = async (userId, limit = 10) => {
  const sessions = await EditSession.find({ userId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .select('fileName status createdAt updatedAt changes');

  return sessions.map(s => ({
    id: s._id,
    fileName: s.fileName,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    changesCount: s.changes.length
  }));
};

export const loadSession = async (userId, sessionId) => {
  const session = await EditSession.findOne({ _id: sessionId, userId });
  if (!session) return null;


  session.status = 'active';
  await session.save();

  return sessionToObject(session);
};



export const applyEdit = async (userId, editInstruction, aiResponse, changeType = 'manual_edit') => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session. Please upload a document first.');
  }

  const previousText = session.currentText;
  const newText = aiResponse.editedText;


  const diff = calculateDiff(previousText, newText);


  if (session.undoPosition !== -1 && session.undoPosition < session.changes.length - 1) {
    session.changes = session.changes.slice(0, session.undoPosition + 1);
  }


  const change = {
    instruction: editInstruction,
    timestamp: new Date(),
    previousText,
    newText,
    summary: aiResponse.changeSummary || editInstruction,
    changeType,
    diff
  };

  session.changes.push(change);
  session.currentText = newText;
  session.undoPosition = -1;
  session.hasUnsavedChanges = false;


  try {
    session.structure = parseDocumentStructure(newText, session.fileName);
    session.riskAnalysis = analyzeDocumentRisks(session.structure);
  } catch (e) {
    console.error('Structure parsing error:', e.message);
  }

  await session.save();

  console.log(`📝 Edit applied: ${aiResponse.changeSummary || editInstruction}`);
  return sessionToObject(session);
};

export const autosave = async (userId, currentText) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) return null;


  if (session.currentText === currentText) {
    return sessionToObject(session);
  }

  session.currentText = currentText;
  session.hasUnsavedChanges = true;
  session.lastAutosave = new Date();

  await session.save();

  console.log(`💾 Autosaved for user ${userId}`);
  return sessionToObject(session);
};

export const commitAutosave = async (userId, description = 'Manual edits') => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session || !session.hasUnsavedChanges) return null;


  const lastSavedText = session.changes.length > 0
    ? session.changes[session.changes.length - 1].newText
    : session.originalText;

  if (session.currentText === lastSavedText) {
    session.hasUnsavedChanges = false;
    await session.save();
    return sessionToObject(session);
  }


  const diff = calculateDiff(lastSavedText, session.currentText);

  const change = {
    instruction: description,
    timestamp: new Date(),
    previousText: lastSavedText,
    newText: session.currentText,
    summary: description,
    changeType: 'autosave',
    diff
  };

  session.changes.push(change);
  session.undoPosition = -1;
  session.hasUnsavedChanges = false;

  await session.save();

  return sessionToObject(session);
};



export const undoEdit = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session || session.changes.length === 0) {
    return { success: false, message: 'Nothing to undo' };
  }


  let currentPos = session.undoPosition === -1
    ? session.changes.length - 1
    : session.undoPosition;

  if (currentPos < 0) {
    return { success: false, message: 'Already at oldest version' };
  }


  const previousText = currentPos === 0
    ? session.originalText
    : session.changes[currentPos - 1].newText;

  session.currentText = previousText;
  session.undoPosition = currentPos - 1;


  try {
    session.structure = parseDocumentStructure(previousText, session.fileName);
  } catch (e) { }

  await session.save();

  console.log(`↩️ Undo: Reverted to position ${session.undoPosition}`);
  return {
    success: true,
    session: sessionToObject(session),
    canUndo: session.undoPosition >= 0,
    canRedo: true
  };
};

export const redoEdit = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session || session.undoPosition === -1) {
    return { success: false, message: 'Nothing to redo' };
  }

  const nextPos = session.undoPosition + 1;

  if (nextPos >= session.changes.length) {
    return { success: false, message: 'Already at latest version' };
  }


  const nextText = session.changes[nextPos].newText;

  session.currentText = nextText;
  session.undoPosition = nextPos === session.changes.length - 1 ? -1 : nextPos;


  try {
    session.structure = parseDocumentStructure(nextText, session.fileName);
  } catch (e) { }

  await session.save();

  console.log(`↪️ Redo: Advanced to position ${session.undoPosition}`);
  return {
    success: true,
    session: sessionToObject(session),
    canUndo: true,
    canRedo: session.undoPosition !== -1 && session.undoPosition < session.changes.length - 1
  };
};

export const getUndoRedoState = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    return { canUndo: false, canRedo: false };
  }

  const currentPos = session.undoPosition === -1
    ? session.changes.length - 1
    : session.undoPosition;

  return {
    canUndo: session.changes.length > 0 && currentPos >= 0,
    canRedo: session.undoPosition !== -1 && session.undoPosition < session.changes.length - 1,
    currentPosition: currentPos,
    totalChanges: session.changes.length
  };
};



export const splitIntoChunks = (text, maxChunkSize = 2000) => {
  const paragraphs = text.split(/\n\n+/);
  const chunks = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    if (currentChunk.length + para.length > maxChunkSize && currentChunk.length > 0) {
      chunks.push({
        index: chunkIndex++,
        text: currentChunk.trim(),
        startOffset: text.indexOf(currentChunk.trim())
      });
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + para;
    }
  }

  if (currentChunk.trim()) {
    chunks.push({
      index: chunkIndex,
      text: currentChunk.trim(),
      startOffset: text.indexOf(currentChunk.trim())
    });
  }

  return chunks;
};

export const reassembleChunks = (chunks) => {
  return chunks
    .sort((a, b) => a.index - b.index)
    .map(c => c.text)
    .join('\n\n');
};

export const processChunkedEdit = async (userId, editInstruction, aiProcessor) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  const originalText = session.currentText;
  const chunks = splitIntoChunks(originalText);

  console.log(`📝 Processing ${chunks.length} chunks for edit: "${editInstruction}"`);

  const processedChunks = [];

  for (const chunk of chunks) {
    console.log(`   → Processing chunk ${chunk.index + 1}/${chunks.length}`);

    const editedChunk = await aiProcessor(chunk.text, editInstruction, chunk.index, chunks.length);

    processedChunks.push({
      index: chunk.index,
      text: editedChunk,
      originalText: chunk.text
    });
  }

  const editedText = reassembleChunks(processedChunks);


  return await applyEdit(userId, editInstruction, {
    editedText,
    changeSummary: `${editInstruction} (processed in ${chunks.length} chunks)`
  }, 'ai_edit');
};



const calculateDiff = (oldText, newText) => {
  const changes = diffWords(oldText, newText);

  const additions = [];
  const deletions = [];
  let position = 0;

  for (const change of changes) {
    if (change.added) {
      additions.push({
        start: position,
        end: position + change.value.length,
        text: change.value
      });
      position += change.value.length;
    } else if (change.removed) {
      deletions.push({
        start: position,
        end: position,
        text: change.value
      });
    } else {
      position += change.value.length;
    }
  }

  return { additions, deletions };
};

export const getDiffBetweenVersions = async (userId, fromVersion, toVersion) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) return null;

  const fromText = fromVersion === 0
    ? session.originalText
    : session.changes[fromVersion - 1]?.newText || session.originalText;

  const toText = toVersion === -1 || toVersion >= session.changes.length
    ? session.currentText
    : session.changes[toVersion]?.newText || session.currentText;

  return {
    from: fromVersion,
    to: toVersion,
    diff: calculateDiff(fromText, toText),
    fromText,
    toText
  };
};

export const getChangeWithDiff = async (userId, changeIndex) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session || changeIndex >= session.changes.length) return null;

  const change = session.changes[changeIndex];

  return {
    instruction: change.instruction,
    summary: change.summary,
    timestamp: change.timestamp,
    changeType: change.changeType,
    diff: change.diff,
    previousText: change.previousText,
    newText: change.newText
  };
};



const extractTemplateVariables = (text) => {
  const variables = [];


  const bracketPattern = /\[([A-Z][A-Z0-9_\s]+)\]/gi;
  let match;

  while ((match = bracketPattern.exec(text)) !== null) {
    variables.push({
      name: match[1].trim(),
      pattern: match[0],
      position: match.index,
      filled: false,
      value: ''
    });
  }


  const curlyPattern = /\{\{?([A-Za-z][A-Za-z0-9_\s]+)\}?\}/g;

  while ((match = curlyPattern.exec(text)) !== null) {
    variables.push({
      name: match[1].trim(),
      pattern: match[0],
      position: match.index,
      filled: false,
      value: ''
    });
  }


  const blankPattern = /_{3,}([A-Za-z_]*)?_{0,}/g;

  while ((match = blankPattern.exec(text)) !== null) {
    variables.push({
      name: match[1]?.trim() || `BLANK_${variables.length + 1}`,
      pattern: match[0],
      position: match.index,
      filled: false,
      value: ''
    });
  }


  const anglePattern = /<([A-Za-z][A-Za-z0-9_\s]+)>/g;

  while ((match = anglePattern.exec(text)) !== null) {
    variables.push({
      name: match[1].trim(),
      pattern: match[0],
      position: match.index,
      filled: false,
      value: ''
    });
  }


  const unique = [];
  const seen = new Set();

  for (const v of variables) {
    const key = v.name.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(v);
    }
  }

  return unique;
};

export const fillTemplateVariables = async (userId, variableValues) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  let newText = session.currentText;
  const filledVars = [];

  for (const [name, value] of Object.entries(variableValues)) {
    const variable = session.detectedVariables.find(
      v => v.name.toLowerCase() === name.toLowerCase()
    );

    if (variable && value) {
      newText = newText.replace(new RegExp(escapeRegex(variable.pattern), 'gi'), value);
      filledVars.push({ name, value });


      variable.filled = true;
      variable.value = value;
    }
  }

  if (filledVars.length === 0) {
    return sessionToObject(session);
  }


  return await applyEdit(userId, `Fill template variables: ${filledVars.map(v => v.name).join(', ')}`, {
    editedText: newText,
    changeSummary: `Filled ${filledVars.length} variable(s)`
  }, 'manual_edit');
};

const escapeRegex = (string) => {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};



export const generateDocx = async (userId, designConfig = null) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  console.log(`📝 Generating DOCX for user ${userId}, text length: ${session.currentText?.length || 0}`);

  const text = session.currentText || '';
  const generatedDir = path.join(__dirname, '..', 'uploads', 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const baseName = session.fileName.replace(/\.[^/.]+$/, '').replace(/_edited_\d+$/, '');
  const timestamp = Date.now();
  const outputFilename = `${baseName}_edited_${timestamp}.docx`;
  const outputPath = path.join(generatedDir, outputFilename);


  if (session.docxStructure && session.docxStructure.paragraphs) {
    try {
      console.log('📄 Using format-preserving DOCX generation (docxStructure available)');
      const mergedStructure = mergeEditedTextIntoStructure(session.docxStructure, text);
      const { filePath } = await writeDocxFromStructure(
        mergedStructure,
        baseName,
        generatedDir,
        designConfig,
        true
      );

      fs.renameSync(filePath, outputPath);
      const stats = fs.statSync(outputPath);
      console.log(`✅ Format-preserving DOCX: ${outputFilename} (${stats.size} bytes)`);
      return {
        filename: outputFilename,
        path: outputPath,
        downloadUrl: `/api/files/download/${outputFilename}`,
        originalName: session.fileName,
        changesCount: session.changes.length,
        format: 'docx',
        formattingPreserved: true,
      };
    } catch (err) {
      console.warn('⚠️  Format-preserving DOCX failed, falling back to legacy:', err.message);
    }
  }


  try {
    if (!PYTHON_SERVICE_ENABLED) throw new Error('Python generator disabled by config');
    console.log('📄 Forwarding generation to python microservice...');
    const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

    const response = await fetch(`${pythonServiceUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: text,
        html: session.htmlContent || '',
        metadata: designConfig || {}
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Python service responded with status ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(outputPath, buffer);
    console.log(`📄 Python microservice DOCX: ${outputFilename} (${buffer.length} bytes)`);
  } catch (microErr) {
    console.warn('⚠️ Python DOCX generation unavailable, falling back to legacy JS:', microErr.message);

    const lines = text.split('\n');
    const paragraphs = [];

    const title = lines.find(l => l.trim()) || baseName;
    paragraphs.push(
      new Paragraph({
        children: [new TextRun({ text: title, bold: true, size: 32 })],
        spacing: { after: 400 },
        alignment: AlignmentType.CENTER,
      })
    );
    paragraphs.push(new Paragraph({ text: '' }));

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) {
        paragraphs.push(new Paragraph({ text: '', spacing: { after: 200 } }));
        continue;
      }
      const isHeading =
        line.trim() === line.trim().toUpperCase() &&
        line.trim().length > 3 &&
        line.trim().length < 100;
      const isNumberedHeading = /^\d+\.\s+[A-Z]/.test(line.trim());
      if (isHeading || isNumberedHeading) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: line.trim(), bold: true, size: 26 })], spacing: { before: 300, after: 200 } }));
      } else {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: line.trim(), size: 24 })], spacing: { after: 120 } }));
      }
    }

    const doc = new Document({ sections: [{ properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);
    fs.writeFileSync(outputPath, buffer);

    console.log(`📄 Legacy DOCX: ${outputFilename} (${buffer.length} bytes)`);
  }
  return {
    filename: outputFilename,
    path: outputPath,
    downloadUrl: `/api/files/download/${outputFilename}`,
    originalName: session.fileName,
    changesCount: session.changes.length,
    format: 'docx',
    formattingPreserved: false,
  };
};

export const generatePdf = async (userId, designConfig = null) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  console.log(`📝 Generating PDF for user ${userId}, text length: ${session.currentText?.length || 0}`);

  const text = session.currentText || '';
  const rawTitle = session.fileName.replace(/\.[^/.]+$/, '').replace(/_edited_\d+$/, '');
  const scanTitle = session.scanResults?.structure?.title;
  const firstHeading = text.split('\n').find(
    l => l.trim() && /^[A-Z][A-Z\s\d.\-:]+$/.test(l.trim()) && l.trim().length < 100
  );
  const title = scanTitle || firstHeading?.trim() || rawTitle.replace(/_\d{10,}$/, '').replace(/_/g, ' ');


  let docxBuffer = null;
  try {
    const docxResult = await generateDocx(userId, designConfig);
    docxBuffer = fs.readFileSync(docxResult.path);
  } catch (e) {
    console.warn('⚠️  Could not produce DOCX for LibreOffice PDF path:', e.message);
  }

  const baseName = rawTitle.replace(/[^a-z0-9_-]/gi, '_').substring(0, 40);

  const result = await generatePdfService({
    docxBuffer,
    text,
    title,
    baseName,
    designConfig,
  });

  return {
    filename: result.filename,
    path: result.path,
    downloadUrl: result.downloadUrl,
    originalName: session.fileName,
    changesCount: session.changes.length,
    format: result.format,
    engine: result.engine,
    ...(result.note ? { note: result.note } : {}),
  };
};

export const generateRtf = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  const text = session.currentText || '';
  const title = session.fileName.replace(/\.[^/.]+$/, '');


  const rtfContent = `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0\\froman Times New Roman;}}
{\\colortbl;\\red0\\green0\\blue0;}
\\paperw12240\\paperh15840\\margl1440\\margr1440\\margt1440\\margb1440
\\pard\\qc\\b\\fs32 ${escapeRtf(title)}\\b0\\par
\\pard\\par
${text.split('\n').map(line => {
    if (!line.trim()) return '\\par';
    const isHeading = line.trim() === line.trim().toUpperCase() && line.trim().length > 3;
    if (isHeading) {
      return `\\pard\\b\\fs28 ${escapeRtf(line.trim())}\\b0\\par`;
    }
    return `\\pard\\fs24 ${escapeRtf(line.trim())}\\par`;
  }).join('\n')}
}`;

  const generatedDir = path.join(__dirname, '..', 'uploads', 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const baseName = session.fileName.replace(/\.[^/.]+$/, '');
  const timestamp = Date.now();
  const outputFilename = `${baseName}_edited_${timestamp}.rtf`;
  const outputPath = path.join(generatedDir, outputFilename);

  fs.writeFileSync(outputPath, rtfContent);

  return {
    filename: outputFilename,
    path: outputPath,
    downloadUrl: `/api/files/download/${outputFilename}`,
    format: 'rtf'
  };
};

export const generateMarkdown = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  const text = session.currentText || '';
  const title = session.fileName.replace(/\.[^/.]+$/, '');


  let markdown = `# ${title}\n\n`;

  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) {
      markdown += '\n';
      continue;
    }

    const isHeading = line.trim() === line.trim().toUpperCase() && line.trim().length > 3 && line.trim().length < 100;
    const isNumberedHeading = /^\d+\.\s+[A-Z]/.test(line.trim());

    if (isHeading || isNumberedHeading) {
      markdown += `## ${line.trim()}\n\n`;
    } else {
      markdown += `${line.trim()}\n\n`;
    }
  }

  const generatedDir = path.join(__dirname, '..', 'uploads', 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const baseName = session.fileName.replace(/\.[^/.]+$/, '');
  const timestamp = Date.now();
  const outputFilename = `${baseName}_edited_${timestamp}.md`;
  const outputPath = path.join(generatedDir, outputFilename);

  fs.writeFileSync(outputPath, markdown);

  return {
    filename: outputFilename,
    path: outputPath,
    downloadUrl: `/api/files/download/${outputFilename}`,
    format: 'markdown'
  };
};

export const generateHtml = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) {
    throw new Error('No active edit session.');
  }

  const text = session.currentText || '';
  const rawTitle = session.fileName.replace(/\.[^/.]+$/, '');
  const scanTitle = session.scanResults?.structure?.title;
  const firstHeading = text.split('\n').find(l => l.trim() && /^[A-Z][A-Z\s\d\.\-:]+$/.test(l.trim()) && l.trim().length < 100);
  const title = scanTitle || firstHeading?.trim() || rawTitle.replace(/_\d{10,}$/, '').replace(/_/g, ' ');
  const html = generateSimpleHtml(text, title);

  const generatedDir = path.join(__dirname, '..', 'uploads', 'generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const baseName = session.fileName.replace(/\.[^/.]+$/, '');
  const timestamp = Date.now();
  const outputFilename = `${baseName}_edited_${timestamp}.html`;
  const outputPath = path.join(generatedDir, outputFilename);

  fs.writeFileSync(outputPath, html);

  return {
    filename: outputFilename,
    path: outputPath,
    downloadUrl: `/api/files/download/${outputFilename}`,
    format: 'html'
  };
};



const generateSimpleHtml = (text, title) => {
  const lines = text.split('\n');
  let bodyContent = '';


  const titleNorm = title ? title.trim().toLowerCase() : '';
  let titleAlreadyAdded = false;

  for (const line of lines) {
    if (!line.trim()) {
      bodyContent += '<p>&nbsp;</p>\n';
      continue;
    }


    const lineNorm = line.trim().toLowerCase();
    if (!titleAlreadyAdded && titleNorm && lineNorm === titleNorm) {
      titleAlreadyAdded = true;
      continue;
    }

    bodyContent += `<p>${escapeHtml(line.trim())}</p>\n`;
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${escapeHtml(title)}</title>
  <style>
    body {
      font-family: 'Times New Roman', Times, serif;
      font-size: 12pt;
      line-height: 1.6;
      color: #000;
      max-width: 8.5in;
      margin: 0 auto;
      padding: 20px;
    }
    h1 {
      text-align: center;
      font-size: 16pt;
      font-weight: bold;
      margin-bottom: 24pt;
    }
    h2 {
      font-size: 14pt;
      font-weight: bold;
      margin-top: 18pt;
      margin-bottom: 12pt;
    }
    p {
      text-align: justify;
      margin: 6pt 0;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${bodyContent}
</body>
</html>
  `;
};

const escapeHtml = (text) => {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const escapeRtf = (text) => {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
};

const sessionToObject = (session) => {
  if (!session) return null;

  const obj = session.toObject ? session.toObject() : session;

  return {
    id: obj._id?.toString(),
    fileId: obj.fileId?.toString(),
    fileName: obj.fileName,
    fileType: obj.fileType,
    originalText: obj.originalText,
    currentText: obj.currentText,
    htmlContent: obj.htmlContent,
    structure: obj.structure,
    riskAnalysis: obj.riskAnalysis,
    changes: obj.changes || [],
    undoPosition: obj.undoPosition,
    hasUnsavedChanges: obj.hasUnsavedChanges,
    lastAutosave: obj.lastAutosave,
    detectedVariables: obj.detectedVariables || [],
    scanStatus: obj.scanStatus,
    formatMetadata: obj.formatMetadata,
    scanResults: obj.scanResults,
    smartSuggestions: obj.smartSuggestions || [],
    ocrText: obj.ocrText,
    ocrConfidence: obj.ocrConfidence,
    createdAt: obj.createdAt,
    updatedAt: obj.updatedAt
  };
};

export const clearEditSession = async (userId) => {
  await EditSession.updateMany(
    { userId, status: 'active' },
    { status: 'abandoned' }
  );
  console.log(`📝 Edit session cleared for user ${userId}`);
};

export const getChangeHistory = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) return [];

  return session.changes.map((c, i) => ({
    index: i,
    instruction: c.instruction,
    summary: c.summary,
    timestamp: c.timestamp,
    changeType: c.changeType
  }));
};

export const getDocumentAnalysis = async (userId) => {
  const session = await EditSession.findOne({ userId, status: 'active' });

  if (!session) return null;

  return {
    structure: session.structure,
    riskAnalysis: session.riskAnalysis,
    metadata: session.structure?.metadata,
    summary: session.structure?.summary,
    detectedVariables: session.detectedVariables
  };
};



export default {

  createEditSession,
  getEditSession,
  getUserSessions,
  loadSession,
  clearEditSession,


  applyEdit,
  autosave,
  commitAutosave,


  undoEdit,
  redoEdit,
  getUndoRedoState,


  splitIntoChunks,
  reassembleChunks,
  processChunkedEdit,


  getDiffBetweenVersions,
  getChangeWithDiff,


  fillTemplateVariables,


  generateDocx,
  generatePdf,
  generateRtf,
  generateMarkdown,
  generateHtml,


  getChangeHistory,
  getDocumentAnalysis
};
