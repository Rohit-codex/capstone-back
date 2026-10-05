
// Use dynamic import to handle potential ESM/CJS mismatch
(async () => {
    try {
        const fs = await import('fs');
        const path = await import('path');
        // Dynamic import of the writer
        const { writeDocxFromText } = await import('./server/utils/docxWriter.js');

        const OUTPUT_DIR = 'repro_output';

        // Mock Professional Design Config (from designTemplates.js)
        const PROFESSIONAL_CONFIG = {
            fontFamily: 'Times New Roman',
            fontSize: 12,
            headingSize: 14,
            titleAlignment: 'center',
            bodyAlignment: 'justified',
            titleBold: true,
            titleUnderline: false,
            titleItalic: false,
            lineSpacing: 1.5,
            margins: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440
            },
            paragraphSpacing: {
                before: 6,
                after: 6
            },
            firstLineIndent: 0,
            textTransform: 'none',
            pageSize: 'A4',
            pageOrientation: 'portrait',
            colorScheme: {
                primary: '#000000',
                accent: '#000000'
            },
            borderStyle: 'none'
        };

        const SAMPLE_TEXT = `This is a test document to verify DOCX generation.
It replicates the "Professional" design configuration.

1. This is a list item.
2. This is another list item.

Here is a paragraph with some standard text to check alignment and spacing. The quick brown fox jumps over the lazy dog.
`;

        console.log('🚀 Starting reproduction test...');

        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR);
        }

        const { filePath } = await writeDocxFromText(
            SAMPLE_TEXT,
            'Reproduction Test Doc',
            OUTPUT_DIR,
            PROFESSIONAL_CONFIG
        );

        console.log(`✅ successfully created: ${filePath}`);
        console.log('👉 Please download this file and open it in Word.');
        console.log('   If it opens WITHOUT error, the issue is in the specific template content.');
        console.log('   If it shows UNREADABLE CONTENT, the issue is in the design config or writer logic.');

    } catch (error) {
        console.error('❌ Error reproducing issue:', error);
    }
})();
