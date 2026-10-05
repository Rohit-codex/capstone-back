
export async function extractPdfFormatting(buffer) {
  const formatMetadata = {
    pageSize: { width: 612, height: 792, orientation: 'portrait', name: 'Letter' },
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    defaultFont: 'Times New Roman',
    defaultFontSize: 12,
    headingStyles: {},
    bodyAlignment: 'left',
    lineSpacing: 1.15,
    paragraphSpacing: { before: 0, after: 200 },
    colors: { textColor: '000000', accentColor: '000000' },
    detectedFonts: [],
    detectedFontSizes: [],
    pageCount: 0,
    hasBorders: false,
    borderStyle: 'none',
    headerText: '',
    footerText: '',
    extracted: true
  };

  try {
    
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    
    
    const uint8Array = new Uint8Array(buffer);
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      disableFontFace: true
    });
    
    const pdfDoc = await loadingTask.promise;
    formatMetadata.pageCount = pdfDoc.numPages;

    
    try {
      const metadata = await pdfDoc.getMetadata();
      if (metadata?.info) {
        formatMetadata.pdfInfo = {
          title: metadata.info.Title || '',
          author: metadata.info.Author || '',
          creator: metadata.info.Creator || '',
          producer: metadata.info.Producer || ''
        };
      }
    } catch (e) {
      
    }

    
    const pagesToAnalyze = Math.min(pdfDoc.numPages, 5);
    const allFonts = [];
    const allSizes = [];
    const allPositions = { minX: Infinity, maxX: 0, minY: Infinity, maxY: 0 };
    let pageWidth = 612;
    let pageHeight = 792;

    for (let i = 1; i <= pagesToAnalyze; i++) {
      const page = await pdfDoc.getPage(i);
      const viewport = page.getViewport({ scale: 1.0 });
      
      if (i === 1) {
        pageWidth = viewport.width;
        pageHeight = viewport.height;
        formatMetadata.pageSize.width = Math.round(pageWidth);
        formatMetadata.pageSize.height = Math.round(pageHeight);
        formatMetadata.pageSize.orientation = pageWidth > pageHeight ? 'landscape' : 'portrait';
      }

      const textContent = await page.getTextContent();
      
      for (const item of textContent.items) {
        if (!item.str || item.str.trim() === '') continue;

        
        if (item.fontName) {
          
          let fontName = item.fontName.replace(/^[A-Z]{6}\+/, '');
          fontName = fontName.replace(/[-_]/g, ' ');
          
          if (/TimesNewRoman/i.test(fontName)) fontName = 'Times New Roman';
          else if (/Arial/i.test(fontName)) fontName = 'Arial';
          else if (/Calibri/i.test(fontName)) fontName = 'Calibri';
          else if (/Cambria/i.test(fontName)) fontName = 'Cambria';
          else if (/Courier/i.test(fontName)) fontName = 'Courier New';
          else if (/Helvetica/i.test(fontName)) fontName = 'Helvetica';
          else if (/Georgia/i.test(fontName)) fontName = 'Georgia';
          allFonts.push(fontName);
        }

        
        
        if (item.transform && item.transform.length >= 4) {
          const fontSize = Math.abs(item.transform[3]);
          if (fontSize > 0 && fontSize < 100) {
            allSizes.push(Math.round(fontSize * 10) / 10);
          }
        } else if (item.height) {
          allSizes.push(Math.round(item.height * 10) / 10);
        }

        
        if (item.transform) {
          const x = item.transform[4];
          const y = item.transform[5];
          if (x < allPositions.minX) allPositions.minX = x;
          if (x + (item.width || 0) > allPositions.maxX) allPositions.maxX = x + (item.width || 0);
          if (y < allPositions.minY) allPositions.minY = y;
          if (y > allPositions.maxY) allPositions.maxY = y;
        }
      }
    }

    
    if (allFonts.length > 0) {
      formatMetadata.detectedFonts = [...new Set(allFonts)];
      formatMetadata.defaultFont = getMostCommon(allFonts);
    }

    
    if (allSizes.length > 0) {
      formatMetadata.detectedFontSizes = [...new Set(allSizes)].sort((a, b) => a - b);
      const commonSize = getMostCommon(allSizes.map(s => String(Math.round(s))));
      formatMetadata.defaultFontSize = parseFloat(commonSize) || 12;
    }

    
    if (allPositions.minX < Infinity) {
      
      const leftMarginPt = Math.max(0, allPositions.minX);
      const rightMarginPt = Math.max(0, pageWidth - allPositions.maxX);
      const bottomMarginPt = Math.max(0, allPositions.minY);
      const topMarginPt = Math.max(0, pageHeight - allPositions.maxY);

      formatMetadata.margins = {
        top: Math.round(topMarginPt * 20),
        right: Math.round(rightMarginPt * 20),
        bottom: Math.round(bottomMarginPt * 20),
        left: Math.round(leftMarginPt * 20),
        topInches: Math.round(topMarginPt / 72 * 100) / 100,
        rightInches: Math.round(rightMarginPt / 72 * 100) / 100,
        bottomInches: Math.round(bottomMarginPt / 72 * 100) / 100,
        leftInches: Math.round(leftMarginPt / 72 * 100) / 100
      };
    }

    
    const w = Math.round(pageWidth);
    const h = Math.round(pageHeight);
    if (isApprox(w, 612) && isApprox(h, 792)) formatMetadata.pageSize.name = 'Letter';
    else if (isApprox(w, 595) && isApprox(h, 842)) formatMetadata.pageSize.name = 'A4';
    else if (isApprox(w, 612) && isApprox(h, 1008)) formatMetadata.pageSize.name = 'Legal';
    else if (isApprox(w, 420) && isApprox(h, 595)) formatMetadata.pageSize.name = 'A5';
    else formatMetadata.pageSize.name = 'Custom';

    
    formatMetadata.pageSize.widthTwips = Math.round(pageWidth * 20);
    formatMetadata.pageSize.heightTwips = Math.round(pageHeight * 20);

    await pdfDoc.destroy();

  } catch (err) {
    console.error('PDF format extraction error:', err.message);
    formatMetadata.extractionError = err.message;
    formatMetadata.extracted = false;
  }

  return formatMetadata;
}

function isApprox(a, b, tolerance = 5) {
  return Math.abs(a - b) <= tolerance;
}

function getMostCommon(arr) {
  if (!arr || arr.length === 0) return null;
  const counts = {};
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
