import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function testPdfParse() {
    console.log('--- PDF Parse Library Check ---');

    try {
        console.log('Using createRequire to import pdf-parse...');
        const { createRequire } = await import('module');
        const require = createRequire(import.meta.url);

        console.log('Importing pdf-parse...');
        const pdfModule = require('pdf-parse');
        const PDFParse = pdfModule.PDFParse;

        console.log('Got PDFParse class.');

        try {
            console.log('Instantiating parser...');
            // Try with Uint8Array as per original code
            const uint8 = new Uint8Array(dummyPdfBuffer);
            const parser = new PDFParse(uint8);
            console.log('Instance created.');

            // If it follows the pattern in original code:
            // await parser.load();
            // const text = await parser.getText();

            // Check available methods
            console.log('Methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(parser)));

        } catch (e) {
            console.error('Instantiation failed:', e.message);
        }
        const dummyPdfBuffer = Buffer.from(
            '%PDF-1.4\n' +
            '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' + // Catalog
            '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' + // Pages
            '3 0 obj<</Type/Page/MediaBox[0 0 595 842]/Parent 2 0 R/Resources<<>>/Contents 4 0 R>>endobj\n' + // Page
            '4 0 obj<</Length 44>>stream\n' +
            'BT /F1 24 Tf 100 700 Td (Hello World) Tj ET\n' + // Content stream
            'endstream\nendobj\n' +
            'xref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n0000000200 00000 n \n' +
            'trailer<</Size 5/Root 1 0 R>>\nstartxref\n293\n%%EOF'
        );

        console.log('Parsing dummy PDF buffer...');
        const data = await pdf(dummyPdfBuffer);

        console.log('✅ Parse Success!');
        console.log('Page Count:', data.numpages);
        console.log('Info:', data.info);
        console.log('Text Content:', data.text.trim());

        return true;
    } catch (error) {
        console.error('❌ PDF Parse Failed:', error.message);
        console.error('Stack:', error.stack);
        return false;
    }
}

testPdfParse();
