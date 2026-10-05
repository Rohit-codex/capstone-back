import fs from 'fs/promises';
import { writeDocxFromStructure } from '../utils/docxStructureWriter.js';

const dummyStructure = {
  metadata: { creator: 'Test' },
  paragraphs: [
    {
      fullText: 'Hello World',
      isEmpty: false,
      runs: [{ text: 'Hello World', size: 24, font: 'Arial' }],
      alignment: 'left'
    },
    {
      fullText: 'Item 1',
      isEmpty: false,
      listInfo: { numId: '1', level: 0 },
      runs: [{ text: 'Item 1', size: 24, font: 'Arial' }],
      alignment: 'left'
    }
  ],
  numTypeMap: { '1': 'ordered' },
};

async function test() {
  try {
    const res = await writeDocxFromStructure(dummyStructure, 'test_doc', './');
    console.log('Success:', res);
  } catch(e) {
    console.error('Error:', e);
  }
}
test();
