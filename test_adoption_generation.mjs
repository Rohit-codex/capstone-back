/**
 * Test script to generate an adoption draft
 * Tests the template filling and DOCX generation pipeline
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the utilities we need
async function testAdoptionGeneration() {
  console.log('🧪 Testing Adoption Draft Generation\n');
  console.log('='.repeat(50));
  
  try {
    // 1. Import required modules
    const { loadTemplates, getTemplateText } = await import('./server/utils/templateIndex.js');
    const { writeDocxFromText } = await import('./server/utils/docxWriter.js');
    
    console.log('✅ Modules loaded successfully\n');
    
    // 2. Load templates
    console.log('📂 Loading templates...');
    const templates = await loadTemplates();
    console.log(`✅ Loaded ${templates.length} templates\n`);
    
    // 3. Find the adoption template
    const templatePath = 'Adoption Drafts/Adoption-by-a-hindu-without-his-wife_s-consent.docx';
    const template = templates.find(t => t.relPath === templatePath);
    
    if (!template) {
      console.error('❌ Template not found:', templatePath);
      console.log('Available templates:', templates.map(t => t.relPath));
      return;
    }
    
    console.log('✅ Found template:', template.displayTitle);
    console.log('   Fields required:', template.schema.length);
    console.log('   Fields:', template.schema.map(f => f.key).join(', '));
    console.log();
    
    // 4. Prepare test data
    const testData = {
      adoptive_father_name: 'Ramesh Kumar',
      adoptive_father_father_name: 'Late Shri Mohan Lal',
      natural_father_name: 'Suresh Sharma',
      natural_father_father_name: 'Shri Gopal Sharma',
      natural_father_address: '456, Park Street, Mumbai, Maharashtra',
      child_name: 'Rahul',
      child_age: '2',
      adoption_date: '15th February, 2026',
      adoption_place: 'Delhi',
      witnesses: 'Witness 1: Vijay Patel, Witness 2: Anjali Verma'
    };
    
    console.log('📝 Test Data prepared:');
    Object.entries(testData).forEach(([key, value]) => {
      console.log(`   ${key}: ${value}`);
    });
    console.log();
    
    // 5. Get template text
    console.log('📖 Reading template text...');
    console.log('   File path:', template.filePath);
    const templateText = await getTemplateText(template);
    console.log(`✅ Template text loaded (${templateText.length} characters)`);
    if (templateText.length > 0) {
      console.log('   Preview:', templateText.substring(0, 200));
    } else {
      console.log('   ⚠️ WARNING: Template text is empty!');
    }
    console.log();
    
    // 6. Fill template with data (using production code logic)
    console.log('🔄 Filling template with data...');
    let filledText = templateText;
    
    // Step 1: Replace {{field_name}} placeholders
    for (const [key, value] of Object.entries(testData)) {
      const placeholder = new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi');
      const beforeCount = (filledText.match(placeholder) || []).length;
      filledText = filledText.replace(placeholder, String(value || '').trim());
      if (beforeCount > 0) {
        console.log(`   {{${key}}}: Replaced ${beforeCount} occurrence(s)`);
      }
    }
    
    // Step 2: Handle dot/underscore placeholders (sequential replacement)
    const placeholderOrder = template.placeholder_order;
    const schemaFields = template.schema;
    
    if (Array.isArray(placeholderOrder) && placeholderOrder.length > 0) {
      // Use explicit mapping
      console.log('📌 Using explicit placeholder_order mapping');
      let valueIndex = 0;
      filledText = filledText.replace(/(^|[^\s])?(\.{5,}|_{5,})([^\s]|$)?/g, (match, before, placeholder, after) => {
        if (valueIndex >= placeholderOrder.length) {
          valueIndex++;
          return match;
        }
        const fieldKey = placeholderOrder[valueIndex];
        valueIndex++;
        const value = testData[fieldKey];
        const replacementValue = value ? String(value).trim() : '____________';
        
        const needSpaceBefore = before && before !== ' ' && before !== '\n' && before !== '\t';
        const needSpaceAfter = after && after !== ' ' && after !== '\n' && after !== '\t';
        
        let result = '';
        if (before) result += before;
        if (needSpaceBefore) result += ' ';
        result += replacementValue;
        if (needSpaceAfter) result += ' ';
        if (after) result += after;
        
        console.log(`   Placeholder ${valueIndex}: ${fieldKey} → ${replacementValue}`);
        return result;
      });
    } else {
      // Fallback: Use schema field order
      console.log('📌 Using schema field order for sequential placeholders');
      const orderedValues = schemaFields.map(f => {
        const val = testData[f.key];
        return val ? String(val).trim() : '____________';
      });
      
      let valueIndex = 0;
      filledText = filledText.replace(/(^|[^\s])?(\.{5,}|_{5,})([^\s]|$)?/g, (match, before, placeholder, after) => {
        if (valueIndex >= orderedValues.length) {
          valueIndex++;
          return match;
        }
        
        const replacementValue = orderedValues[valueIndex];
        const fieldKey = schemaFields[valueIndex]?.key;
        valueIndex++;
        
        const needSpaceBefore = before && before !== ' ' && before !== '\n' && before !== '\t';
        const needSpaceAfter = after && after !== ' ' && after !== '\n' && after !== '\t';
        
        let result = '';
        if (before) result += before;
        if (needSpaceBefore) result += ' ';
        result += replacementValue;
        if (needSpaceAfter) result += ' ';
        if (after) result += after;
        
        console.log(`   Placeholder ${valueIndex}: ${fieldKey} → ${replacementValue}`);
        return result;
      });
    }
    
    // Post-processing cleanup (from production code)
    filledText = filledText
      .replace(/ \. /g, ' ')           // " . " → " "
      .replace(/\. \./g, '.')          // ". ." → "."
      .replace(/ {2,}/g, ' ')          // Multiple spaces → single
      .replace(/ ,/g, ',')             // " ," → ","
      .replace(/ \.(\n|$)/g, '.$1')    // " ." at line end → "."
      .replace(/\n{3,}/g, '\n\n');     // Max 2 newlines
    
    // Check for remaining placeholders
    const remainingPlaceholders = filledText.match(/\{\{[^}]+\}\}/g);
    if (remainingPlaceholders) {
      console.log('\n⚠️  Warning: Unfilled {{placeholders}} found:');
      [...new Set(remainingPlaceholders)].forEach(p => console.log(`   ${p}`));
    } else {
      console.log('\n✅ All placeholders filled!');
    }
    console.log();
    
    // 7. Generate DOCX
    console.log('📄 Generating DOCX file...');
    const title = 'Adoption by a Hindu without his Wife\'s Consent';
    const { filePath, fileSize } = await writeDocxFromText(
      filledText,
      title,
      'generated_docs',
      null, // no design config for testing
      false // include title
    );
    
    console.log(`✅ DOCX generated successfully!`);
    console.log(`   📁 Path: ${filePath}`);
    console.log(`   📦 Size: ${(fileSize / 1024).toFixed(2)} KB`);
    console.log();
    
    // 8. Show preview
    console.log('📄 Document Preview (first 500 characters):');
    console.log('─'.repeat(50));
    console.log(filledText.substring(0, 500));
    console.log('─'.repeat(50));
    console.log();
    
    console.log('✅ Test completed successfully!');
    console.log('\n🎉 You can now open the generated file in MS Word:');
    console.log(`   ${filePath}`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testAdoptionGeneration();
