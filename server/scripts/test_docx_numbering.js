import { extractDocxStructure, docxStructureToHtml } from '../utils/docxStructureExtractor.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function testExtraction() {
  try {
    const file1Path = path.resolve(__dirname, '../../tests/Quashing of Shravan Kumar.docx');
    console.log('Testing:', file1Path);
    const struct1 = await extractDocxStructure(file1Path);
    const html1 = docxStructureToHtml(struct1);
    fs.writeFileSync(path.resolve(__dirname, 'test_quashing1.html'), html1);
    console.log('Wrote test_quashing1.html');
    
    let numItems1 = 0;
    struct1.paragraphs.forEach((p, i) => {
      if (p.listInfo) {
        numItems1++;
      }
    });

    console.log(`Original file has ${struct1.paragraphs.length} total paragraphs and ${numItems1} list items.`);

    const file2Path = path.resolve(__dirname, '../../tests/Quashing of Shravan Kumar_edited.docx');
    console.log('\nTesting:', file2Path);
    const struct2 = await extractDocxStructure(file2Path);
    const html2 = docxStructureToHtml(struct2);
    fs.writeFileSync(path.resolve(__dirname, 'test_quashing2.html'), html2);
    console.log('Wrote test_quashing2.html');
    
    let numItems2 = 0;
    struct2.paragraphs.forEach((p, i) => {
      if (p.listInfo) {
        numItems2++;
      }
    });
    console.log(`Edited file has ${struct2.paragraphs.length} total paragraphs and ${numItems2} list items.`);
    
  } catch (error) {
    console.error('Error:', error);
  }
}

testExtraction();
