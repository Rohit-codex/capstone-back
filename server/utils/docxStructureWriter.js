
import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  Header, Footer, ImageRun, Table, TableRow, TableCell,
  VerticalAlign, WidthType, HeadingLevel,
} from 'docx';
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

const HEADING_LEVEL_MAP = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const ALIGN_MAP = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justified: AlignmentType.JUSTIFIED,
};


function processDesignImages(designConfig) {
  const result = {
    watermarks: [],
    positionedImages: {
      'top-left': [], 'top-center': [], 'top-right': [],
      'bottom-left': [], 'bottom-center': [], 'bottom-right': [],
    },
  };
  if (!designConfig?.images || !Array.isArray(designConfig.images)) return result;

  for (const img of designConfig.images) {
    try {
      if (!img.data) continue;
      const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
      const buffer = Buffer.from(base64Data, 'base64');
      const w = img.width || 200;
      const h = img.height || 200;

      const imgType = detectImageType(base64Data);
      const imageRun = new ImageRun({ type: imgType, data: buffer, transformation: { width: w, height: h } });

      if (img.isWatermark) {
        result.watermarks.push({ imageRun, opacity: img.opacity || 0.2, width: w, height: h });
      } else {
        const pos = img.position || 'top-center';
        if (result.positionedImages[pos]) {
          result.positionedImages[pos].push({ imageRun, opacity: img.opacity || 1, width: w, height: h });
        }
      }
    } catch (e) {
      console.warn('Image processing error:', e.message);
    }
  }
  return result;
}

function makeImageCell(images, align) {
  if (!images || images.length === 0) {
    return new TableCell({
      children: [new Paragraph({ text: '' })],
      borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
      width: { size: 33, type: WidthType.PERCENTAGE },
    });
  }
  return new TableCell({
    children: images.map(img => new Paragraph({ alignment: align, children: [img.imageRun] })),
    borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' } },
    verticalAlign: VerticalAlign.CENTER,
    width: { size: 33, type: WidthType.PERCENTAGE },
  });
}


function buildTextRun(run, designConfig) {
  const dc = designConfig || {};
  const fontFamily = dc.fontFamily || run.font;
  const bodySize = dc.fontSize ? dc.fontSize * 2 : (run.size || 24);
  const textColor = (dc.colorScheme?.primary?.replace('#', '')) || run.color || undefined;

  return new TextRun({
    text: run.text,
    bold: run.bold,
    italics: run.italic,
    underline: run.underline ? {} : undefined,
    strike: run.strikethrough,
    color: textColor !== 'auto' && textColor !== '000000' ? textColor : undefined,
    size: bodySize,
    ...(fontFamily ? { font: fontFamily } : {}),
  });
}


function buildParagraph(para, designConfig, isTitle = false, numTypeMap = {}) {
  const dc = designConfig || {};

  
  let alignment;
  if (isTitle) {
    alignment = ALIGN_MAP[dc.titleAlignment] || ALIGN_MAP[para.alignment] || AlignmentType.CENTER;
  } else if (para.isHeading) {
    alignment = ALIGN_MAP[para.alignment] || AlignmentType.LEFT;
  } else {
    alignment = ALIGN_MAP[dc.bodyAlignment] || ALIGN_MAP[para.alignment] || AlignmentType.JUSTIFIED;
  }

  
  const lineSpacing = dc.lineSpacing ? Math.round(dc.lineSpacing * 240) : undefined;
  const spacingBefore = para.spacing?.before || 0;
  const spacingAfter = para.spacing?.after || 100;

  
  const headingLevel = para.headingLevel ? HEADING_LEVEL_MAP[para.headingLevel] : undefined;

  const children = para.runs.length > 0
    ? para.runs.map(r => buildTextRun(r, isTitle ? null : designConfig))
    : [buildTextRun({ text: para.fullText, bold: para.isHeading || isTitle, size: null }, designConfig)];

  
  if (isTitle) {
    const fontFamily = dc.fontFamily;
    const titleSize = (dc.headingSize || 16) * 2;
    const titleColor = dc.colorScheme?.accent?.replace('#', '') || undefined;
    const titleChild = new TextRun({
      text: para.fullText,
      bold: dc.titleBold !== false,
      italics: dc.titleItalic || false,
      underline: dc.titleUnderline ? {} : undefined,
      size: titleSize,
      ...(fontFamily ? { font: fontFamily } : {}),
      ...(titleColor ? { color: titleColor } : {}),
    });
    return new Paragraph({
      alignment,
      heading: headingLevel,
      children: [titleChild],
      spacing: { before: spacingBefore, after: 300, ...(lineSpacing ? { line: lineSpacing } : {}) },
    });
  }

  let numberingOpt;
  if (para.listInfo && !isTitle && !para.isHeading) {
    let isOrdered = true;
    if (para.listInfo.numId && para.listInfo.numId !== '0') {
      const type = numTypeMap[para.listInfo.numId];
      if (type === 'unordered') isOrdered = false;
      else if (type === 'ordered') isOrdered = true;
      else if (/Bullet/i.test(para.style || '')) isOrdered = false;
    } else if (para.listInfo.numId === 'bullet') {
      isOrdered = false;
    }
    
    numberingOpt = {
      reference: isOrdered ? "ordered-list" : "unordered-list",
      level: Math.max(0, Math.min(8, para.listInfo.level || 0)),
    };
  }

  return new Paragraph({
    numbering: numberingOpt,
    alignment,
    heading: headingLevel,
    indent: (para.indent?.firstLine || para.indent?.left) ? {
      firstLine: para.indent.firstLine || undefined,
      left: para.indent.left || undefined,
    } : undefined,
    children,
    spacing: {
      before: spacingBefore,
      after: spacingAfter,
      ...(lineSpacing ? { line: lineSpacing } : {}),
    },
  });
}



export async function writeDocxFromStructure(
  structure,
  title = 'DRAFT',
  outDir = 'uploads/generated',
  designConfig = null,
  skipTitle = false
) {
  const dc = designConfig || {};
  const pageSize = PAGE_SIZE_TWIPS[dc.pageSize] || PAGE_SIZE_TWIPS.A4;
  const isLandscape = dc.pageOrientation === 'landscape';
  const margins = dc.margins || { top: 720, right: 720, bottom: 720, left: 720 };

  
  let pageBorders;
  if (dc.borderStyle && dc.borderStyle !== 'none') {
    const styleMap = { single: 'single', double: 'double', thick: 'thick', dotted: 'dotted', dashed: 'dashed' };
    const bStyle = styleMap[dc.borderStyle] || 'single';
    const bColor = dc.borderColor?.replace('#', '') || '000000';
    const bSize = dc.borderStyle === 'thick' ? (dc.borderWidth || 1) * 4 : 2;
    const bd = { style: bStyle, size: bSize, color: bColor };
    pageBorders = { pageBorderTop: bd, pageBorderBottom: bd, pageBorderLeft: bd, pageBorderRight: bd };
  }

  
  const processedImages = processDesignImages(dc);

  
  let headerObj;
  const hasTopImages = ['top-left', 'top-center', 'top-right'].some(
    k => processedImages.positionedImages[k].length > 0
  );
  if (dc.headerText || hasTopImages) {
    const headerChildren = [];
    const topCenter = [
      ...processedImages.positionedImages['top-center'],
      
    ];
    if (hasTopImages || topCenter.length > 0) {
      headerChildren.push(new Table({
        rows: [new TableRow({
          children: [
            makeImageCell(processedImages.positionedImages['top-left'], AlignmentType.LEFT),
            makeImageCell(topCenter, AlignmentType.CENTER),
            makeImageCell(processedImages.positionedImages['top-right'], AlignmentType.RIGHT),
          ],
        })],
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' }, insideHorizontal: { style: 'none' }, insideVertical: { style: 'none' } },
      }));
    }
    if (dc.headerText) {
      const hAlign = ALIGN_MAP[dc.headerAlignment] || AlignmentType.CENTER;
      const bodySize = dc.fontSize ? dc.fontSize * 2 : 22;
      headerChildren.push(new Paragraph({
        alignment: hAlign,
        children: [new TextRun({ text: dc.headerText, size: bodySize - 2, color: '888888', ...(dc.fontFamily ? { font: dc.fontFamily } : {}) })],
      }));
    }
    headerObj = new Header({ children: headerChildren });
  }

  
  let footerObj;
  const hasBottomImages = ['bottom-left', 'bottom-center', 'bottom-right'].some(
    k => processedImages.positionedImages[k].length > 0
  );
  if (dc.footerText || hasBottomImages) {
    const footerChildren = [];
    if (dc.footerText) {
      const fAlign = ALIGN_MAP[dc.footerAlignment] || AlignmentType.CENTER;
      const bodySize = dc.fontSize ? dc.fontSize * 2 : 22;
      footerChildren.push(new Paragraph({
        alignment: fAlign,
        children: [new TextRun({ text: dc.footerText, size: bodySize - 2, color: '888888', ...(dc.fontFamily ? { font: dc.fontFamily } : {}) })],
      }));
    }
    if (hasBottomImages) {
      footerChildren.push(new Table({
        rows: [new TableRow({
          children: [
            makeImageCell(processedImages.positionedImages['bottom-left'], AlignmentType.LEFT),
            makeImageCell(processedImages.positionedImages['bottom-center'], AlignmentType.CENTER),
            makeImageCell(processedImages.positionedImages['bottom-right'], AlignmentType.RIGHT),
          ],
        })],
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: 'none' }, bottom: { style: 'none' }, left: { style: 'none' }, right: { style: 'none' }, insideHorizontal: { style: 'none' }, insideVertical: { style: 'none' } },
      }));
    }
    footerObj = new Footer({ children: footerChildren });
  }

  
  const watermarkParagraphs = processedImages.watermarks.map(wm =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [wm.imageRun],
      spacing: { before: 0, after: 120 },
    })
  );

  
  const paragraphs = structure.paragraphs.map((para, i) => {
    const isFirstNonEmpty = i === 0 && !para.isEmpty && !skipTitle;
    return buildParagraph(para, designConfig, isFirstNonEmpty, structure.numTypeMap || {});
  });

  
  if (paragraphs.length === 0) {
    paragraphs.push(new Paragraph({ text: '' }));
  }

  const doc = new Document({
    creator: 'Dastavezai Legal AI',
    title,
    numbering: {
      config: [
        {
          reference: "ordered-list",
          levels: Array.from({ length: 9 }).map((_, i) => ({
            level: i,
            format: "decimal",
            text: `%${i + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } },
          })),
        },
        {
          reference: "unordered-list",
          levels: Array.from({ length: 9 }).map((_, i) => ({
            level: i,
            format: "bullet",
            text: i % 2 === 0 ? "●" : "○",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 720 + i * 360, hanging: 360 } } },
          })),
        },
      ],
    },


    sections: [{
      properties: {
        page: {
          size: {
            width: isLandscape ? pageSize.height : pageSize.width,
            height: isLandscape ? pageSize.width : pageSize.height,
          },
          margin: {
            top: margins.top || 720,
            right: margins.right || 720,
            bottom: margins.bottom || 720,
            left: margins.left || 720,
          },
        },
        ...(pageBorders ? { borders: pageBorders } : {}),
      },
      ...(headerObj ? { headers: { default: headerObj } } : {}),
      ...(footerObj ? { footers: { default: footerObj } } : {}),
      children: [...watermarkParagraphs, ...paragraphs],
    }],
  });

  const buffer = await Packer.toBuffer(doc);

  await fs.mkdir(outDir, { recursive: true });

  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);
  const fileName = `${safeTitle || 'document'}_${Date.now()}.docx`;
  const filePath = path.join(outDir, fileName);

  await fs.writeFile(filePath, buffer, { encoding: null });

  const stats = await fs.stat(filePath);
  console.log(`✅ writeDocxFromStructure: ${fileName} (${stats.size} bytes)`);

  return { filePath, fileSize: stats.size };
}

export default { writeDocxFromStructure };
