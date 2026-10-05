
(async () => {
    try {
        const fs = await import('fs');
        const path = await import('path');
        const { writeDocxFromText } = await import('./server/utils/docxWriter.js');
        // Import the function from templateIndex.js
        // Note: We need to import it properly.
        // Since templateIndex.js has "export function extractDocxText", 
        // but it is NOT exported directly in the default export object in the way we might expect for partial imports if not careful.
        // Let's import the whole module.
        const templateIndex = await import('./server/utils/templateIndex.js');

        // We need to access the function. It is not exported directly, but used internally.
        // Wait, line 178: export async function getTemplateText(template)
        // line 188 calls extractDocxText(template.filePath)
        // So we can use getTemplateText.

        const { getTemplateText } = templateIndex;

        const TEMPLATE_PATH = path.resolve('./server/normalized_templates/Adoption Drafts/Simple-Adoption-Deed.docx');
        const OUTPUT_DIR = 'repro_output';

        console.log(`📂 Testing with template: ${TEMPLATE_PATH}`);

        if (!fs.existsSync(TEMPLATE_PATH)) {
            console.error('❌ Template file not found!');
            process.exit(1);
        }

        if (!fs.existsSync(OUTPUT_DIR)) {
            fs.mkdirSync(OUTPUT_DIR);
        }

        // Mock template object expected by getTemplateText
        const mockTemplate = {
            filePath: TEMPLATE_PATH,
            template: null // Force extraction
        };

        console.log('🔄 Extracting text...');
        const text = await getTemplateText(mockTemplate);

        console.log(`✅ Extracted text length: ${text.length}`);
        console.log('📝 First 200 chars:', text.substring(0, 200));

        console.log('🔄 Generating DOCX...');
        const { filePath } = await writeDocxFromText(
            text,
            'Simple Adoption Deed Test',
            OUTPUT_DIR,
            null // Use default design
        );

        console.log(`✅ Generated file: ${filePath}`);
        console.log('Please check this file for corruption.');

    } catch (error) {
        console.error('❌ Error during test:', error);
    }
})();
