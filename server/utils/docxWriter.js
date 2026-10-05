import { Document, Packer, Paragraph, TextRun, AlignmentType, Header, Footer, ImageRun, Table, TableRow, TableCell, VerticalAlign, WidthType, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, HorizontalPositionAlign, VerticalPositionAlign, TextWrappingType, TextWrappingSide } from 'docx';
import fs from 'fs/promises';
import path from 'path';

function detectImageType(base64Str) {
  try {
    const b64 = base64Str.replace(/^data:[^;]+;base64,/, '');
    const header = b64.substring(0, 8);
    if (header.startsWith('/9j/'))   return 'jpg';
    if (header.startsWith('iVBOR')) return 'png';
    if (header.startsWith('R0lGO')) return 'gif';
    if (header.startsWith('Qk'))    return 'bmp';
    if (header.startsWith('SUkq') || header.startsWith('SUkg')) return 'tiff';
  } catch {  }
  return 'png';
}


const PAGE_SIZE_TWIPS = {
  A4: { width: 11906, height: 16838 },
  Legal: { width: 12240, height: 20160 },
  Letter: { width: 12240, height: 15840 },
  A5: { width: 8391, height: 11906 },
};

function sanitizeTextForDocx(text) {
  if (!text) return '';
  
  let cleaned = String(text);
  
  
  cleaned = cleaned
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u2022\u2023\u2043]/g, '-')
    .replace(/[\u00A0]/g, ' ');
  
  
  cleaned = cleaned.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, '');
  
  
  cleaned = cleaned.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
  
  
  cleaned = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/ +/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n');
  
  
  cleaned = cleaned.replace(/[^\x20-\x7E\n\u00A0-\u024F\u0400-\u04FF\u0900-\u097F]/g, '');
  
  return cleaned.trim();
}

function processDesignImages(designConfig) {
  const result = {
    watermarks: [],
    topFullWidth: [],
    positionedImages: {
      'top-left': [],
      'top-center': [],
      'top-right': [],
      'bottom-left': [],
      'bottom-center': [],
      'bottom-right': [],
    },
  };

  if (!designConfig?.images || !Array.isArray(designConfig.images)) {
    return result;
  }

  for (const img of designConfig.images) {
    try {
      if (!img.data) continue;

      
      const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
      const buffer = Buffer.from(base64Data, 'base64');

      const imgWidth = img.width || 200;
      const imgHeight = img.height || 200;

      
      if (img.placement === 'top-full-width') {
        result.topFullWidth.push({
          buffer,
          base64Data,
          label: img.label || 'Stamp',
          stampWidth: img.stampWidth ?? 100,
          stampAlign: img.stampAlign || 'center',
          stampMarginBottom: img.stampMarginBottom ?? 8,
          opacity: img.opacity ?? 1,
          origWidth: imgWidth,
          origHeight: imgHeight,
        });
        continue;
      }

      
      if (img.isWatermark || img.placement === 'watermark') {
        
        const wmType = detectImageType(base64Data);
        const watermarkRun = new ImageRun({
          type: wmType,
          data: buffer,
          transformation: {
            width: imgWidth,
            height: imgHeight,
          },
        });

        result.watermarks.push({
          imageRun: watermarkRun,
          opacity: img.opacity || 0.2,
          width: imgWidth,
          height: imgHeight,
        });
      } else {
        let position = img.position || 'top-center';
        
        
        const shorthandMap = {
          'center': 'top-center',
          'left': 'top-left',
          'right': 'top-right',
          'top': 'top-center',
          'bottom': 'bottom-center',
        };
        if (shorthandMap[position]) position = shorthandMap[position];
        
        
        const hAlignMap = {
          'top-left': HorizontalPositionAlign.LEFT,
          'top-center': HorizontalPositionAlign.CENTER,
          'top-right': HorizontalPositionAlign.RIGHT,
          'bottom-left': HorizontalPositionAlign.LEFT,
          'bottom-center': HorizontalPositionAlign.CENTER,
          'bottom-right': HorizontalPositionAlign.RIGHT,
        };

        const imageRun = new ImageRun({
          type: detectImageType(base64Data),
          data: buffer,
          transformation: {
            width: imgWidth,
            height: imgHeight,
          },
        });

        if (result.positionedImages[position]) {
          result.positionedImages[position].push({
            imageRun,
            label: img.label,
            opacity: img.opacity || 1,
            width: imgWidth,
            height: imgHeight,
          });
        }
      }
    } catch (err) {
      console.warn('Failed to process image:', img.label || 'unnamed', err.message);
    }
  }

  return result;
}

export async function writeDocxFromText(text, title = 'DRAFT', outDir = 'uploads/drafts', designConfig = null, skipTitle = false) {
  try {
    console.log('📝 DOCX Generation Started');
    console.log('  Input text length:', text?.length || 0);
    console.log('  Title:', title);
    console.log('  Skip title:', skipTitle);
    if (designConfig) console.log('  Design config applied:', designConfig.fontFamily || 'custom');
    
    
    const sanitizedText = sanitizeTextForDocx(text);
    const sanitizedTitle = sanitizeTextForDocx(title) ||'DRAFT';
    
    console.log('  Sanitized text length:', sanitizedText.length);
    
    if (!sanitizedText || sanitizedText.length < 10) {
      throw new Error('Text too short or invalid after sanitization');
    }
    
    
    const dc = designConfig || {};
    const fontFamily = dc.fontFamily || undefined;
    const bodySize = dc.fontSize ? dc.fontSize * 2 : 22;
    const headingSize = dc.headingSize ? dc.headingSize * 2 : 26;
    const titleAlign = ({ center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT })[dc.titleAlignment] || AlignmentType.CENTER;
    const bodyAlign = ({ justified: AlignmentType.JUSTIFIED, left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT })[dc.bodyAlignment] || AlignmentType.JUSTIFIED;
    const titleBold = dc.titleBold !== undefined ? dc.titleBold : true;
    const titleUnderline = dc.titleUnderline || false;
    const titleItalic = dc.titleItalic || false;
    const lineSpacing = dc.lineSpacing ? Math.round(dc.lineSpacing * 240) : undefined;
    const margins = dc.margins || { top: 720, right: 720, bottom: 720, left: 720 };
    const textTransform = dc.textTransform || 'none';
    const firstLineIndent = dc.firstLineIndent || 0;
    const paraSpacingBefore = dc.paragraphSpacing?.before ? dc.paragraphSpacing.before * 20 : undefined;
    const paraSpacingAfter = dc.paragraphSpacing?.after ? dc.paragraphSpacing.after * 20 : 100;
    const textColor = dc.colorScheme?.primary?.replace('#', '') || undefined;
    const accentColor = dc.colorScheme?.accent?.replace('#', '') || undefined;

    
    const pageSize = PAGE_SIZE_TWIPS[dc.pageSize] || PAGE_SIZE_TWIPS.A4;
    const isLandscape = dc.pageOrientation === 'landscape';

    
    const applyTransform = (t) => {
      if (textTransform === 'uppercase') return t.toUpperCase();
      if (textTransform === 'lowercase') return t.toLowerCase();
      if (textTransform === 'capitalize') return t.replace(/\b\w/g, c => c.toUpperCase());
      return t;
    };

    
    const lines = sanitizedText.split('\n').filter(line => line.trim().length > 0);
    console.log('  Total lines:', lines.length);
    
    
    const paragraphs = lines.map(line => {
      const trimmedLine = line.trim();
      const displayText = applyTransform(trimmedLine);
      
      
      const isHeading = /^[A-Z\s\d:-]{3,60}$/.test(trimmedLine) && 
                        !trimmedLine.endsWith('.') && 
                        !trimmedLine.endsWith(',');
      
      if (isHeading) {
        return new Paragraph({
          children: [new TextRun({ 
            text: displayText, 
            bold: true, 
            size: headingSize,
            ...(fontFamily ? { font: fontFamily } : {}),
            ...(accentColor ? { color: accentColor } : {}),
          })],
          spacing: { 
            before: paraSpacingBefore || 200, 
            after: paraSpacingAfter || 100, 
            ...(lineSpacing ? { line: lineSpacing } : {}) 
          }
        });
      } else {
        return new Paragraph({
          alignment: bodyAlign,
          indent: firstLineIndent ? { firstLine: firstLineIndent } : undefined,
          children: [new TextRun({ 
            text: displayText, 
            size: bodySize,
            ...(fontFamily ? { font: fontFamily } : {}),
            ...(textColor ? { color: textColor } : {}),
          })],
          spacing: { 
            ...(paraSpacingBefore ? { before: paraSpacingBefore } : {}),
            after: paraSpacingAfter || 100, 
            ...(lineSpacing ? { line: lineSpacing } : {}) 
          }
        });
      }
    });
    
    console.log('  Paragraphs created:', paragraphs.length);

    
    let pageBorders = undefined;
    if (dc.borderStyle && dc.borderStyle !== 'none') {
      const styleMap = {
        single: 'single', double: 'double', thick: 'thick',
        dotted: 'dotted', dashed: 'dashed', shadow: 'single'
      };
      const borderVal = styleMap[dc.borderStyle] || 'single';
      const borderColor = dc.borderColor?.replace('#', '') || '000000';
      const borderSize = dc.borderStyle === 'thick' ? (dc.borderWidth || 1) * 4 : (dc.borderWidth || 1) * 2;
      const borderDef = { style: borderVal, size: borderSize, color: borderColor };
      pageBorders = { pageBorderTop: borderDef, pageBorderBottom: borderDef, pageBorderLeft: borderDef, pageBorderRight: borderDef };
    }

    
    const processedImages = processDesignImages(dc);
    console.log('  Processed images - TopFullWidth:', processedImages.topFullWidth.length,
                'Watermarks:', processedImages.watermarks.length,
                'Positioned:', Object.values(processedImages.positionedImages).flat().length);

    
    
    const pageWidthTwips = isLandscape ? pageSize.height : pageSize.width;
    const leftMarginTwips  = margins.left  || 720;
    const rightMarginTwips = margins.right || 720;
    const contentWidthTwips = pageWidthTwips - leftMarginTwips - rightMarginTwips;
    
    const contentWidthPx = Math.round(contentWidthTwips / 1440 * 96);

    const stampAlignMap = { left: AlignmentType.LEFT, center: AlignmentType.CENTER, right: AlignmentType.RIGHT };

    const topStampParagraphs = processedImages.topFullWidth.map(s => {
      const stampWidthPx  = Math.round(contentWidthPx * (s.stampWidth / 100));
      
      const aspectRatio   = (s.origWidth > 0 && s.origHeight > 0) ? (s.origHeight / s.origWidth) : 0.3;
      const stampHeightPx = Math.max(20, Math.round(stampWidthPx * aspectRatio));
      const imgType = detectImageType(s.base64Data);
      const imageRun = new ImageRun({
        type: imgType,
        data: s.buffer,
        transformation: { width: stampWidthPx, height: stampHeightPx },
      });
      return new Paragraph({
        alignment: stampAlignMap[s.stampAlign] || AlignmentType.CENTER,
        children: [imageRun],
        spacing: { before: 0, after: Math.round(s.stampMarginBottom * 20) },
      });
    });

    
    const watermarkParagraphs = processedImages.watermarks.map(wm =>
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [wm.imageRun],
        spacing: { before: 0, after: 120 },
      })
    );

    
    const createImageCell = (images, align) => {
      if (!images || images.length === 0) {
        return new TableCell({
          children: [new Paragraph({ text: '' })],
          borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
          width: { size: 33, type: WidthType.PERCENTAGE },
        });
      }
      return new TableCell({
        children: images.map(img => new Paragraph({
          alignment: align,
          children: [img.imageRun],
        })),
        borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
        verticalAlign: VerticalAlign.CENTER,
        width: { size: 33, type: WidthType.PERCENTAGE },
      });
    };

    
    let headerObj = undefined;
    const hasTopImages = processedImages.positionedImages['top-left'].length > 0 ||
                         processedImages.positionedImages['top-center'].length > 0 ||
                         processedImages.positionedImages['top-right'].length > 0;

    if (dc.headerText || hasTopImages) {
      const headerChildren = [];
      const topCenterImages = [
        ...processedImages.positionedImages['top-center'],
        
      ];
      
      
      if (hasTopImages || topCenterImages.length > 0) {
        headerChildren.push(
          new Table({
            rows: [
              new TableRow({
                children: [
                  createImageCell(processedImages.positionedImages['top-left'], AlignmentType.LEFT),
                  createImageCell(topCenterImages, AlignmentType.CENTER),
                  createImageCell(processedImages.positionedImages['top-right'], AlignmentType.RIGHT),
                ],
              }),
            ],
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: 'none' }, bottom: { style: 'none' },
              left: { style: 'none' }, right: { style: 'none' },
              insideHorizontal: { style: 'none' }, insideVertical: { style: 'none' },
            },
          })
        );
      }
      
      
      if (dc.headerText) {
        const headerAlign = ({ center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT })[dc.headerAlignment] || AlignmentType.CENTER;
        headerChildren.push(
          new Paragraph({
            alignment: headerAlign,
            children: [new TextRun({ text: dc.headerText, size: bodySize - 2, color: '888888', ...(fontFamily ? { font: fontFamily } : {}) })],
          })
        );
      }
      
      headerObj = new Header({ children: headerChildren });
    }

    
    let footerObj = undefined;
    const hasBottomImages = processedImages.positionedImages['bottom-left'].length > 0 ||
                            processedImages.positionedImages['bottom-center'].length > 0 ||
                            processedImages.positionedImages['bottom-right'].length > 0;

    if (dc.footerText || (dc.pageNumbering && dc.pageNumbering !== 'none') || hasBottomImages) {
      const footerChildren = [];
      
      
      if (dc.footerText) {
        const footerAlign = ({ center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT })[dc.footerAlignment] || AlignmentType.CENTER;
        footerChildren.push(
          new Paragraph({
            alignment: footerAlign,
            children: [new TextRun({ text: dc.footerText, size: bodySize - 2, color: '888888', ...(fontFamily ? { font: fontFamily } : {}) })],
          })
        );
      }
      
      
      if (dc.pageNumbering && dc.pageNumbering !== 'none') {
        const numAlign = dc.pageNumbering.includes('right') ? AlignmentType.RIGHT : AlignmentType.CENTER;
        footerChildren.push(
          new Paragraph({
            alignment: numAlign,
            children: [
              new TextRun({ text: '— 1 —', size: bodySize - 4, color: '999999' }),
            ],
          })
        );
      }
      
      
      if (hasBottomImages) {
        footerChildren.push(
          new Table({
            rows: [
              new TableRow({
                children: [
                  createImageCell(processedImages.positionedImages['bottom-left'], AlignmentType.LEFT),
                  createImageCell(processedImages.positionedImages['bottom-center'], AlignmentType.CENTER),
                  createImageCell(processedImages.positionedImages['bottom-right'], AlignmentType.RIGHT),
                ],
              }),
            ],
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: 'none' }, bottom: { style: 'none' },
              left: { style: 'none' }, right: { style: 'none' },
              insideHorizontal: { style: 'none' }, insideVertical: { style: 'none' },
            },
          })
        );
      }
      
      footerObj = new Footer({ children: footerChildren });
    }
    
    
    const doc = new Document({
      creator: "Dastavezai Legal AI",
      title: sanitizedTitle,
      description: "Legal document generated by Dastavezai",
      sections: [{
        properties: {
          page: {
            size: {
              width: isLandscape ? pageSize.height : pageSize.width,
              height: isLandscape ? pageSize.width : pageSize.height,
              orientation: isLandscape ? 'landscape' : undefined,
            },
            margin: {
              top: margins.top || 720,
              right: margins.right || 720,
              bottom: margins.bottom || 720,
              left: margins.left || 720
            },
          },
          ...(pageBorders ? { borders: pageBorders } : {}),
        },
        ...(headerObj ? { headers: { default: headerObj } } : {}),
        ...(footerObj ? { footers: { default: footerObj } } : {}),
        children: [
          
          ...topStampParagraphs,
          
          ...watermarkParagraphs,
          
          ...(skipTitle ? [] : [
            new Paragraph({
              alignment: titleAlign,
              children: [new TextRun({ 
                text: sanitizedTitle.toUpperCase(), 
                bold: titleBold,
                italics: titleItalic,
                underline: titleUnderline ? {} : undefined,
                size: (dc.headingSize || 16) * 2,
                ...(fontFamily ? { font: fontFamily } : {}),
                ...(accentColor ? { color: accentColor } : {}),
              })],
              spacing: { after: 300 }
            })
          ]),
          
          ...paragraphs
        ]
      }]
    });
    
    console.log('  Document object created');
    
    
    await fs.mkdir(outDir, { recursive: true });
    console.log('  Output directory ensured:', outDir);
    
    
    const fileBase = sanitizedTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 40);
    
    const timestamp = Date.now();
    const fileName = `${fileBase || 'document'}_${timestamp}.docx`;
    const filePath = path.join(outDir, fileName);
    
    console.log('  Output path:', filePath);
    
    
    let buffer;
    try {
      buffer = await Packer.toBuffer(doc);
      console.log('  Buffer generated:', buffer.length, 'bytes');
      console.log('  Buffer type:', Buffer.isBuffer(buffer) ? 'Buffer' : typeof buffer);
    } catch (packError) {
      console.error('  Packer.toBuffer failed:', packError);
      throw new Error(`Failed to pack document: ${packError.message}`);
    }
    
    if (!buffer || buffer.length === 0) {
      throw new Error('Generated buffer is empty');
    }
    
    
    if (!Buffer.isBuffer(buffer)) {
      console.error('  ERROR: Generated data is not a Buffer!');
      throw new Error('Packer did not return a Buffer');
    }
    
    
    try {
      await fs.writeFile(filePath, buffer, { encoding: null, flag: 'w' });
      console.log('  File written successfully');
    } catch (writeError) {
      console.error('  File write failed:', writeError);
      throw new Error(`Failed to write file: ${writeError.message}`);
    }
    
    
    const stats = await fs.stat(filePath);
    console.log('  Final file size:', stats.size, 'bytes');
    
    if (stats.size === 0) {
      throw new Error('Written file is 0 bytes');
    }
    
    if (stats.size < 1000) {
      console.warn('⚠️  File size is suspiciously small:', stats.size, 'bytes');
    }
    
    
    const fileBuffer = await fs.readFile(filePath);
    const magic = fileBuffer.slice(0, 4).toString('hex');
    console.log('  File magic number:', magic);
    if (magic !== '504b0304') {
      console.warn('⚠️  WARNING: File does not start with ZIP magic number (504b0304)');
    }
    
    console.log('✅ DOCX generation successful');
    
    return { filePath, fileSize: stats.size };
    
  } catch (error) {
    console.error('❌ DOCX generation failed:', error.message);
    console.error('   Stack:', error.stack);
    throw new Error(`Failed to create DOCX: ${error.message}`);
  }
}

export default { writeDocxFromText };



