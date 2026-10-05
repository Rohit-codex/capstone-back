import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const ROOT = path.resolve(__dirname, '..', 'normalized_templates');

function walk(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, fileList);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.txt')) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

function safeParseSchema(schemaText) {
  try {
    return JSON.parse(schemaText);
  } catch (err) {
    return null;
  }
}

function getSchemaBlock(content) {
  const marker = 'FIELDS_SCHEMA';
  const idx = content.indexOf(marker);
  if (idx === -1) return null;

  const before = content.slice(0, idx).trimEnd();
  const after = content.slice(idx + marker.length).trim();

  
  const start = after.indexOf('[');
  const end = after.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonText = after.slice(start, end + 1);
  return { before, jsonText };
}

function extractExistingKeys(schema) {
  const keys = new Set();
  for (const field of schema || []) {
    if (field && field.key) keys.add(field.key);
  }
  return keys;
}

function generateUniqueKey(base, usedKeys) {
  let i = 1;
  let key = `${base}_${i}`;
  while (usedKeys.has(key)) {
    i += 1;
    key = `${base}_${i}`;
  }
  usedKeys.add(key);
  return key;
}

function normalizeTemplate(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const schemaBlock = getSchemaBlock(content);
  if (!schemaBlock) return { changed: false, reason: 'no_schema' };

  const { before, jsonText } = schemaBlock;
  const schema = safeParseSchema(jsonText);
  if (!schema) return { changed: false, reason: 'bad_schema' };

  const usedKeys = extractExistingKeys(schema);
  const inlinePattern = /\.{5,}/g;
  let matchCount = 0;

  const updatedBefore = before.replace(inlinePattern, () => {
    matchCount += 1;
    const key = generateUniqueKey('inline_field', usedKeys);
    return `{{${key}}}`;
  });

  if (matchCount === 0) return { changed: false, reason: 'no_inline_dots' };

  
  const newFields = [];
  for (const key of usedKeys) {
    if (key.startsWith('inline_field_') && !schema.find(f => f.key === key)) {
      const suffix = key.replace('inline_field_', '');
      newFields.push({
        key,
        label: `Field ${suffix}`,
        type: 'text',
        required: true,
        example: ''
      });
    }
  }

  const updatedSchema = [...schema, ...newFields];

  const updatedContent = `${updatedBefore}\n\nFIELDS_SCHEMA\n${JSON.stringify(updatedSchema, null, 2)}\n`;
  fs.writeFileSync(filePath, updatedContent, 'utf8');

  return { changed: true, addedFields: newFields.length };
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`normalized_templates not found at: ${ROOT}`);
    process.exit(1);
  }

  const files = walk(ROOT);
  let changedCount = 0;
  let skippedNoSchema = 0;
  let skippedBadSchema = 0;

  for (const file of files) {
    const result = normalizeTemplate(file);
    if (result.changed) {
      changedCount += 1;
    } else if (result.reason === 'no_schema') {
      skippedNoSchema += 1;
    } else if (result.reason === 'bad_schema') {
      skippedBadSchema += 1;
    }
  }

  console.log(`✅ Templates updated: ${changedCount}`);
  console.log(`⚠️ Skipped (no schema): ${skippedNoSchema}`);
  console.log(`⚠️ Skipped (bad schema): ${skippedBadSchema}`);
}

main();
