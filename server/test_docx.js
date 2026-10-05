
const { Document, Packer, Paragraph, TextRun } = require('docx');
const fs = require('fs').promises;
const path = require('path');

async function testDocx() {
  console.log('Starting DOCX test...');
  
  try {
    
    const doc1 = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: 'SIMPLE TEST HEADING',
                bold: true,
                size: 26
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'This is a simple test paragraph with only ASCII characters.',
                size: 22
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Second paragraph for testing.',
                size: 22
              })
            ]
          })
        ]
      }]
    });
    
    const buffer1 = await Packer.toBuffer(doc1);
    const testFile1 = path.join(__dirname, 'uploads', 'test_ascii.docx');
    await fs.writeFile(testFile1, buffer1);
    console.log('✅ Test 1: Pure ASCII DOCX created:', testFile1);
    console.log('   File size:', buffer1.length, 'bytes');
    
    
    const doc2 = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: 'शिकायत पत्र',
                bold: true,
                size: 26
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'यह एक परीक्षण दस्तावेज़ है।',
                size: 22
              })
            ]
          })
        ]
      }]
    });
    
    const buffer2 = await Packer.toBuffer(doc2);
    const testFile2 = path.join(__dirname, 'uploads', 'test_hindi.docx');
    await fs.writeFile(testFile2, buffer2);
    console.log('✅ Test 2: Hindi DOCX created:', testFile2);
    console.log('   File size:', buffer2.length, 'bytes');
    
    
    const doc3 = new Document({
      sections: [{
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: 'IN THE COURT OF JUDICIAL MAGISTRATE',
                bold: true,
                size: 26
              })
            ]
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: 'Complaint under Section 138 of Negotiable Instruments Act, 1881. The accused person issued a cheque for Rs. 50,000/- which was dishonored with reason "Insufficient Funds".',
                size: 22
              })
            ]
          })
        ]
      }]
    });
    
    const buffer3 = await Packer.toBuffer(doc3);
    const testFile3 = path.join(__dirname, 'uploads', 'test_complex.docx');
    await fs.writeFile(testFile3, buffer3);
    console.log('✅ Test 3: Complex text DOCX created:', testFile3);
    console.log('   File size:', buffer3.length, 'bytes');
    
    console.log('\n✅ All tests completed. Try opening these files in Word:');
    console.log('   1. test_ascii.docx (pure ASCII)');
    console.log('   2. test_hindi.docx (Devanagari script)');
    console.log('   3. test_complex.docx (legal text)');
    
  } catch (error) {
    console.error('❌ DOCX test failed:', error);
    console.error(error.stack);
  }
}

testDocx();
