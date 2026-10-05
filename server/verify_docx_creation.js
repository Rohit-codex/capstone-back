
import { Document, Packer, Paragraph, TextRun, AlignmentType } from 'docx';
import fs from 'fs';
import JSZip from 'jszip';

async function testDocxGeneration() {
    console.log('🧪 Testing DOCX Generation...');

    const designConfig = {
        "fontFamily": "Times New Roman",
        "fontSize": 12,
        "headingSize": 14,
        "titleAlignment": "center",
        "bodyAlignment": "justified",
        "titleBold": true,
        "titleUnderline": false,
        "titleItalic": false,
        "lineSpacing": 1.5,
        "margins": {
            "top": 1440,
            "right": 1440,
            "bottom": 1440,
            "left": 1440
        },
        "paragraphSpacing": {
            "before": 6,
            "after": 6
        },
        "firstLineIndent": 0,
        "textTransform": "none",
        "pageSize": "A4",
        "pageOrientation": "portrait",
        "colorScheme": {
            "primary": "#000000",
            "accent": "#000000"
        },
        "borderStyle": "none"
    };

    try {
        const doc = new Document({
            sections: [{
                properties: {}, // simplified
                children: [
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "TEST DOCUMENT TITLE",
                                font: designConfig.fontFamily,
                                size: 28,
                            }),
                        ],
                    }),
                    new Paragraph({
                        children: [
                            new TextRun({
                                text: "This is a test paragraph to verify DOCX generation works correctly.",
                                font: designConfig.fontFamily,
                                size: 24,
                            }),
                        ],
                    })
                ],
            }],
        });

        console.log('📄 Document object created');

        const buffer = await Packer.toBuffer(doc);
        console.log(`📦 Buffer generated, size: ${buffer.length} bytes`);

        // Check Header
        const headerHex = buffer.subarray(0, 16).toString('hex');
        console.log(`📦 DOCX Buffer Header: ${headerHex.toUpperCase()}`);

        // JSZip Check
        const zip = await JSZip.loadAsync(buffer);
        const hasDocument = !!zip.file('word/document.xml');
        console.log(`🔍 Integrity Check (word/document.xml): ${hasDocument}`);

        if (hasDocument) {
            const content = await zip.file('word/document.xml').async('string');
            console.log('📄 document.xml content snippet:', content.substring(0, 200));
        }

        fs.writeFileSync('test_output.docx', buffer);
        console.log('✅ test_output.docx saved');

    } catch (error) {
        console.error('❌ Error:', error);
    }
}

testDocxGeneration();
