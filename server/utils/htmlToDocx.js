
import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Packer,
  LevelFormat,
  convertInchesToTwip,
  SectionType,
  ImageRun,
  Header,
  Footer,
  Table,
  TableRow,
  TableCell,
  VerticalAlign,
  WidthType,
  HorizontalPositionRelativeFrom,
  VerticalPositionRelativeFrom,
  HorizontalPositionAlign,
  VerticalPositionAlign,
  TextWrappingType,
  TextWrappingSide,
} from 'docx';
import fs from 'fs';
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

function processDesignImages(designConfig) {
  const result = {
    watermarks: [],
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

      const imgType = detectImageType(base64Data);

      if (img.isWatermark) {
        
        const watermarkRun = new ImageRun({
          type: imgType,
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
        
        
        const positionMap = {
          'center': 'top-center',
          'left': 'top-left',
          'right': 'top-right',
          'top': 'top-center',
          'bottom': 'bottom-center',
        };
        if (positionMap[position]) position = positionMap[position];

        const imageRun = new ImageRun({
          type: imgType,
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
      console.warn('Failed to process image in htmlToDocx:', img.label || 'unnamed', err.message);
    }
  }

  return result;
}

function parseInlineStyles(html) {
  const runs = [];
  if (!html || typeof html !== 'string') return runs;

  // Pre-strip any block-level tags that shouldn't be inside inline content,
  // keeping their inner text content
  let cleaned = html
    .replace(/<\/?(div|section|article|main|header|footer|nav|aside|figure|figcaption|details|summary)[^>]*>/gi, '')
    .replace(/<\/?(table|thead|tbody|tfoot|tr|td|th|col|colgroup|caption)[^>]*>/gi, '')
    .replace(/<\/?(p|h[1-6]|blockquote|pre|hr|dl|dt|dd|address)[^>]*>/gi, '');

  const tagRegex = /<\/?(?:strong|b|em|i|u|s|del|strike|span|mark|br|a|sup|sub)[^>]*>|[^<]+/gi;
  const tokens = cleaned.match(tagRegex);
  
  // If regex produces no tokens, extract plain text by stripping ALL tags
  if (!tokens || tokens.length === 0) {
    const plainText = decodeHtmlEntities(cleaned.replace(/<[^>]*>/g, ''));
    if (plainText.trim()) {
      runs.push(new TextRun({ text: plainText }));
    }
    return runs;
  }
  
  let bold = false;
  let italic = false;
  let underline = false;
  let strike = false;
  let color = null;
  let highlight = null;
  let fontSize = null;
  let fontFamily = null;

  for (const token of tokens) {
    if (token.startsWith('<')) {
      const lower = token.toLowerCase();
      
      if (lower === '<strong>' || lower === '<b>') bold = true;
      else if (lower === '</strong>' || lower === '</b>') bold = false;
      else if (lower === '<em>' || lower === '<i>') italic = true;
      else if (lower === '</em>' || lower === '</i>') italic = false;
      else if (lower === '<u>') underline = true;
      else if (lower === '</u>') underline = false;
      else if (lower === '<s>' || lower === '<del>' || lower === '<strike>') strike = true;
      else if (lower === '</s>' || lower === '</del>' || lower === '</strike>') strike = false;
      else if (lower === '<br>' || lower === '<br/>') {
        runs.push(new TextRun({ break: 1 }));
      }
      else if (lower.startsWith('<span')) {
        
        const styleMatch = token.match(/style="([^"]+)"/i);
        if (styleMatch) {
          const style = styleMatch[1];
          const colorMatch = style.match(/color:\s*([^;]+)/i);
          if (colorMatch) color = colorMatch[1].trim().replace('#', '');
          const sizeMatch = style.match(/font-size:\s*([^;]+)/i);
          if (sizeMatch) {
            const sizeVal = sizeMatch[1].trim();
            const ptMatch = sizeVal.match(/([\d.]+)pt/);
            if (ptMatch) fontSize = Math.round(parseFloat(ptMatch[1]) * 2);
          }
          const fontMatch = style.match(/font-family:\s*([^;]+)/i);
          if (fontMatch) fontFamily = fontMatch[1].trim().replace(/['"]/g, '').split(',')[0];
        }
      }
      else if (lower === '</span>') {
        color = null;
        fontSize = null;
        fontFamily = null;
      }
      else if (lower.startsWith('<mark')) {
        const bgMatch = token.match(/data-color="([^"]+)"/i) || token.match(/style="[^"]*background-color:\s*([^;"]+)/i);
        if (bgMatch) highlight = bgMatch[1].trim();
      }
      else if (lower === '</mark>') {
        highlight = null;
      }
    } else {
      
      const text = decodeHtmlEntities(token);
      if (text.trim() || text.includes(' ')) {
        const runOpts = { text };
        if (bold) runOpts.bold = true;
        if (italic) runOpts.italics = true;
        if (underline) runOpts.underline = {};
        if (strike) runOpts.strike = true;
        if (color) runOpts.color = color.length === 6 ? color : undefined;
        if (fontSize) runOpts.size = fontSize;
        if (fontFamily) runOpts.font = fontFamily;
        if (highlight) runOpts.highlight = 'yellow';
        runs.push(new TextRun(runOpts));
      }
    }
  }

  return runs;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function getAlignment(styleStr) {
  if (!styleStr) return undefined;
  const match = styleStr.match(/text-align:\s*(left|center|right|justify)/i);
  if (!match) return undefined;
  const map = {
    left: AlignmentType.LEFT,
    center: AlignmentType.CENTER,
    right: AlignmentType.RIGHT,
    justify: AlignmentType.JUSTIFIED,
  };
  return map[match[1].toLowerCase()];
}

function getAlignmentFromValue(value) {
  const v = String(value || '').toLowerCase().trim();
  if (!v) return undefined;
  if (v === 'left') return AlignmentType.LEFT;
  if (v === 'center') return AlignmentType.CENTER;
  if (v === 'right') return AlignmentType.RIGHT;
  if (v === 'justify' || v === 'justified' || v === 'both') return AlignmentType.JUSTIFIED;
  return undefined;
}

function htmlToParagraphs(html, titleStyle = null, defaultParagraphAlignment = undefined) {
  const paragraphs = [];
  
  // Pre-sanitize: normalize HTML before block-level extraction
  let sanitized = html
    // Remove HTML comments
    .replace(/<!--[\s\S]*?-->/g, '')
    // Convert <div> to <p> equivalents (preserving attributes)
    .replace(/<div([^>]*)>/gi, '<p$1>')
    .replace(/<\/div>/gi, '</p>')
    // Strip unknown/non-standard block tags while preserving content
    .replace(/<\/?(section|article|main|header|footer|nav|aside|figure|figcaption|details|summary|address)[^>]*>/gi, '')
    // Normalize self-closing tags
    .replace(/<br\s*\/?\s*>/gi, '<br>')
    .replace(/<hr\s*\/?\s*>/gi, '<hr>');

  // Extract tables first, replace with placeholders, and process them
  const tables = [];
  sanitized = sanitized.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (fullMatch, tableContent) => {
    const tableRows = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const cells = [];
      const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        const cellContent = cellMatch[1];
        // Parse cell content as inline styles to preserve formatting
        const cellRuns = parseInlineStyles(cellContent);
        const cellText = decodeHtmlEntities(cellContent.replace(/<[^>]*>/g, '')).trim();
        cells.push({ runs: cellRuns, text: cellText });
      }
      if (cells.length > 0) tableRows.push(cells);
    }
    const idx = tables.length;
    tables.push(tableRows);
    return `<!--TABLE_PLACEHOLDER_${idx}-->`;
  });
  
  
  const blockRegex = /<(h[1-6]|p|li|blockquote|hr)([^>]*)>([\s\S]*?)<\/\1>|<(hr)\s*\/?>|<(br)\s*\/?>/gi;
  
  let lastIndex = 0;
  let match;
  
  
  let inOrderedList = false;
  let listItemNumber = 0;
  
  
  const fullBlocks = sanitized.replace(/<ol[^>]*>/gi, '<!--OL_START-->').replace(/<\/ol>/gi, '<!--OL_END-->')
    .replace(/<ul[^>]*>/gi, '<!--UL_START-->').replace(/<\/ul>/gi, '<!--UL_END-->');
  
  
  const blockSplitRegex = /<(h[1-6]|p|li|blockquote)([^>]*)>([\s\S]*?)<\/\1>|<hr\s*\/?>|<!--(OL_START|OL_END|UL_START|UL_END)-->|<!--TABLE_PLACEHOLDER_(\d+)-->/gi;
  
  while ((match = blockSplitRegex.exec(fullBlocks)) !== null) {
    const tag = (match[1] || '').toLowerCase();
    const attrs = match[2] || '';
    const content = match[3] || '';
    const comment = match[4] || '';
    const tableIdx = match[5];

    // Handle table placeholder
    if (tableIdx !== undefined) {
      const tableRows = tables[parseInt(tableIdx, 10)];
      if (tableRows && tableRows.length > 0) {
        const docxRows = tableRows.map(cells => {
          return new TableRow({
            children: cells.map(cell => {
              const cellChildren = cell.runs.length > 0
                ? [new Paragraph({ children: cell.runs })]
                : [new Paragraph({ children: [new TextRun({ text: cell.text || '' })] })];
              return new TableCell({
                children: cellChildren,
                verticalAlign: VerticalAlign.CENTER,
              });
            }),
          });
        });
        paragraphs.push(new Table({
          rows: docxRows,
          width: { size: 100, type: WidthType.PERCENTAGE },
        }));
      }
      continue;
    }
    
    
    if (comment === 'OL_START') { inOrderedList = true; listItemNumber = 0; continue; }
    if (comment === 'OL_END') { inOrderedList = false; continue; }
    if (comment === 'UL_START') { inOrderedList = false; continue; }
    if (comment === 'UL_END') { continue; }
    
    
    if (match[0].match(/^<hr/i)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: '─'.repeat(50) })],
        spacing: { before: 200, after: 200 },
      }));
      continue;
    }
    
    const alignment = getAlignment(attrs);
    const effectiveAlignment = alignment || defaultParagraphAlignment;
    const styleMatch = attrs.match(/style="([^"]+)"/i);
    const styleStr = styleMatch ? styleMatch[1] : '';
    const runs = parseInlineStyles(content);
    
    if (runs.length === 0) {
      runs.push(new TextRun({ text: '' }));
    }
    
    switch (tag) {
      case 'h1':
        paragraphs.push(new Paragraph({
          children: runs.map(r => {
            if (r instanceof TextRun) return new TextRun({ 
              ...r, 
              bold: true, 
              size: titleStyle?.size || 48,
              font: titleStyle?.font || undefined,
            });
            return r;
          }),
          heading: HeadingLevel.HEADING_1,
          alignment: titleStyle ? AlignmentType.CENTER : effectiveAlignment,
          spacing: titleStyle 
            ? { before: 0, after: 240, line: Math.round((titleStyle.lineSpacing || 1.15) * 240) }
            : { before: 240, after: 120 },
        }));
        break;
      case 'h2':
        paragraphs.push(new Paragraph({
          children: runs.map(r => {
            if (r instanceof TextRun) return new TextRun({ ...r, bold: true, size: 36 });
            return r;
          }),
          heading: HeadingLevel.HEADING_2,
          alignment: effectiveAlignment,
          spacing: { before: 200, after: 100 },
        }));
        break;
      case 'h3':
        paragraphs.push(new Paragraph({
          children: runs.map(r => {
            if (r instanceof TextRun) return new TextRun({ ...r, bold: true, size: 28 });
            return r;
          }),
          heading: HeadingLevel.HEADING_3,
          alignment: effectiveAlignment,
          spacing: { before: 160, after: 80 },
        }));
        break;
      case 'h4':
      case 'h5':
      case 'h6':
        paragraphs.push(new Paragraph({
          children: runs.map(r => {
            if (r instanceof TextRun) return new TextRun({ ...r, bold: true, size: 24 });
            return r;
          }),
          heading: HeadingLevel.HEADING_4,
          alignment: effectiveAlignment,
          spacing: { before: 120, after: 60 },
        }));
        break;
      case 'li':
        listItemNumber++;
        const bullet = inOrderedList ? `${listItemNumber}. ` : '• ';
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: bullet }), ...runs],
          indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) },
          alignment: effectiveAlignment,
          spacing: { before: 40, after: 40 },
        }));
        break;
      case 'blockquote':
        paragraphs.push(new Paragraph({
          children: runs.map(r => {
            if (r instanceof TextRun) return new TextRun({ ...r, italics: true, color: '666666' });
            return r;
          }),
          indent: { left: convertInchesToTwip(0.5) },
          alignment: effectiveAlignment,
          spacing: { before: 120, after: 120 },
        }));
        break;
      default: {
        // Parse spacing and indent from inline style
        const spacing = {};
        const indent = {};
        if (styleStr) {
          const mt = styleStr.match(/margin-top:\s*([\d.]+)pt/i);
          if (mt) spacing.before = Math.round(parseFloat(mt[1]) * 20); // pt to twips
          const mb = styleStr.match(/margin-bottom:\s*([\d.]+)pt/i);
          if (mb) spacing.after = Math.round(parseFloat(mb[1]) * 20);
          const lh = styleStr.match(/line-height:\s*([\d.]+)/i);
          if (lh) spacing.line = Math.round(parseFloat(lh[1]) * 240); // ratio to 240ths
          const ml = styleStr.match(/margin-left:\s*([\d.]+)em/i);
          if (ml) indent.left = Math.round(parseFloat(ml[1]) * 240); // em to twips approx
          const ti = styleStr.match(/text-indent:\s*([\d.]+)em/i);
          if (ti) indent.firstLine = Math.round(parseFloat(ti[1]) * 240);
        }
        if (!spacing.before && spacing.before !== 0) spacing.before = 0;
        if (!spacing.after && spacing.after !== 0) spacing.after = 40;
        
        const paraOpts = {
          children: runs,
          alignment: effectiveAlignment,
          spacing,
        };
        if (indent.left || indent.firstLine) paraOpts.indent = indent;
        paragraphs.push(new Paragraph(paraOpts));
        break;
      }
    }
  }
  
  
  if (paragraphs.length === 0) {
    // Strip ALL HTML tags to get plain text, then split into paragraphs
    const plainText = sanitized.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, '');
    const decoded = decodeHtmlEntities(plainText);
    const lines = decoded.split(/\n+/).filter(l => l.trim());
    if (lines.length > 0) {
      for (const line of lines) {
        paragraphs.push(new Paragraph({
          children: [new TextRun({ text: line.trim() })],
          alignment: defaultParagraphAlignment,
          spacing: { before: 0, after: 40 },
        }));
      }
    } else {
      // Absolute last resort: try parseInlineStyles on the sanitized HTML
      const runs = parseInlineStyles(sanitized);
      if (runs.length > 0) {
        paragraphs.push(new Paragraph({ children: runs }));
      }
    }
  }
  
  return paragraphs;
}

export async function writeDocxFromHtml(html, title = 'Document', outDir = 'uploads/generated', designConfig = null) {
  
  const dc = designConfig || {};
  const margins = dc.margins || {};
  const defaultFont = dc.fontFamily || 'Times New Roman';
  const defaultSize = (dc.bodyFontSize || dc.fontSize || 12) * 2;
  const titleSize = dc.headingSize ? dc.headingSize * 2 : Math.round(defaultSize * 1.5);

  
  const PAGE_SIZE_TWIPS = {
    A4: { width: 11906, height: 16838 },
    Legal: { width: 12240, height: 20160 },
    Letter: { width: 12240, height: 15840 },
    A5: { width: 8391, height: 11906 },
  };
  const pageSize = PAGE_SIZE_TWIPS[dc.pageSize] || PAGE_SIZE_TWIPS.A4;
  const isLandscape = dc.pageOrientation === 'landscape';

  
  let pageBorders = undefined;
  if (dc.borderStyle && dc.borderStyle !== 'none') {
    const styleMap = { single: 'single', double: 'double', thick: 'thick', dotted: 'dotted', dashed: 'dashed', shadow: 'single' };
    const borderVal = styleMap[dc.borderStyle] || 'single';
    const borderColor = dc.borderColor?.replace('#', '') || '000000';
    const borderSize = dc.borderStyle === 'thick' ? (dc.borderWidth || 1) * 4 : (dc.borderWidth || 1) * 2;
    const borderDef = { style: borderVal, size: borderSize, color: borderColor };
    pageBorders = { pageBorderTop: borderDef, pageBorderBottom: borderDef, pageBorderLeft: borderDef, pageBorderRight: borderDef };
  }

  
  const titleStyle = {
    font: defaultFont,
    size: titleSize,
    lineSpacing: dc.lineSpacing || 1.15,
  };
  const defaultParagraphAlignment = getAlignmentFromValue(dc.bodyAlignment);
  const paragraphs = htmlToParagraphs(html, titleStyle, defaultParagraphAlignment);
  
  
  const hasHeadingTag = html.match(/<h[1-6][^>]*>/i);
  const titleInContent = title && title !== 'Document' && html.toLowerCase().includes(title.toLowerCase());
  
  
  if (!hasHeadingTag && !titleInContent && title && title !== 'Document') {
    paragraphs.unshift(new Paragraph({
      children: [new TextRun({ 
        text: title, 
        bold: true, 
        size: titleSize,
        font: defaultFont,
      })],
      heading: HeadingLevel.HEADING_1,
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 240, line: Math.round((dc.lineSpacing || 1.15) * 240) },
    }));
  }
  
  
  const processedImages = processDesignImages(designConfig);
  
  
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
  
  if (hasTopImages || dc.headerText) {
    const headerChildren = [];
    if (hasTopImages || processedImages.watermarks.length > 0) {
      const topCenterImages = [
        ...processedImages.positionedImages['top-center'],
        ...processedImages.watermarks.map((wm) => ({
          imageRun: wm.imageRun,
          label: 'watermark-header',
          opacity: wm.opacity,
          width: wm.width,
          height: wm.height,
        })),
      ];
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
          children: [new TextRun({ text: dc.headerText, size: defaultSize - 2, color: '888888', font: defaultFont })],
        })
      );
    }
    headerObj = new Header({ children: headerChildren });
  }
  
  
  let footerObj = undefined;
  const hasBottomImages = processedImages.positionedImages['bottom-left'].length > 0 ||
                          processedImages.positionedImages['bottom-center'].length > 0 ||
                          processedImages.positionedImages['bottom-right'].length > 0;
  
  if (hasBottomImages || dc.footerText || (dc.pageNumbering && dc.pageNumbering !== 'none')) {
    const footerChildren = [];
    if (dc.footerText) {
      const footerAlign = ({ center: AlignmentType.CENTER, left: AlignmentType.LEFT, right: AlignmentType.RIGHT })[dc.footerAlignment] || AlignmentType.CENTER;
      footerChildren.push(
        new Paragraph({
          alignment: footerAlign,
          children: [new TextRun({ text: dc.footerText, size: defaultSize - 2, color: '888888', font: defaultFont })],
        })
      );
    }
    if (dc.pageNumbering && dc.pageNumbering !== 'none') {
      const numAlign = dc.pageNumbering.includes('right') ? AlignmentType.RIGHT : AlignmentType.CENTER;
      footerChildren.push(
        new Paragraph({
          alignment: numAlign,
          children: [new TextRun({ text: '\u2014 1 \u2014', size: defaultSize - 4, color: '999999' })],
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
  
  const documentChildren = [...paragraphs];
  
  const sectionProps = {
    properties: {
      page: {
        size: {
          width: isLandscape ? pageSize.height : pageSize.width,
          height: isLandscape ? pageSize.width : pageSize.height,
          orientation: isLandscape ? 'landscape' : undefined,
        },
    margin: {
      top: margins?.topTwips ?? (margins?.topInches ? convertInchesToTwip(margins.topInches) : convertInchesToTwip(1)),
      right: margins?.rightTwips ?? (margins?.rightInches ? convertInchesToTwip(margins.rightInches) : convertInchesToTwip(1)),
      bottom: margins?.bottomTwips ?? (margins?.bottomInches ? convertInchesToTwip(margins.bottomInches) : convertInchesToTwip(1)),
      left: margins?.leftTwips ?? (margins?.leftInches ? convertInchesToTwip(margins.leftInches) : convertInchesToTwip(1)),
    },
      },
      ...(pageBorders ? { borders: pageBorders } : {}),
    },
    ...(headerObj ? { headers: { default: headerObj } } : {}),
    ...(footerObj ? { footers: { default: footerObj } } : {}),
    children: documentChildren,
  };
  
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: defaultFont,
            size: defaultSize,
          },
          paragraph: {
            ...(defaultParagraphAlignment ? { alignment: defaultParagraphAlignment } : {}),
            spacing: {
              line: Math.round((dc.lineSpacing || 1.15) * 240),
            },
          },
        },
      },
    },
    sections: [sectionProps],
  });
  
  
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  
  const safeName = title.replace(/[^a-zA-Z0-9_\- ]/g, '').substring(0, 60);
  const fileName = `${safeName}_${Date.now()}.docx`;
  const filePath = path.join(outDir, fileName);
  
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
  
  return { filePath, fileSize: buffer.length, filename: fileName };
}

export default { writeDocxFromHtml };
