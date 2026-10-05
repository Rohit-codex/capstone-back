
import JSZip from 'jszip';
import fs from 'fs/promises';



function xmlAttr(xml, elemName, attrName) {
  const re = new RegExp(`<w:${elemName}[^>]*\\bw:${attrName}="([^"]*)"`, 'i');
  const m = xml.match(re);
  return m ? m[1] : null;
}

function xmlHasElem(xml, elemName) {
  return new RegExp(`<w:${elemName}(?:\\s[^/]*)?(?:/>|>)`).test(xml);
}

function extractBlocks(xml, tagName) {
  const results = [];
  const openTag = `<w:${tagName}`;
  const closeTag = `</w:${tagName}>`;
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(openTag, pos);
    if (start === -1) break;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    results.push(xml.slice(start, end + closeTag.length));
    pos = end + closeTag.length;
  }
  return results;
}

function extractElement(xml, tagName) {
  const openRe = new RegExp(`<w:${tagName}(?:\\s[^>]*)?>`);
  const closeTag = `</w:${tagName}>`;
  const m = openRe.exec(xml);
  if (!m) return '';
  const start = m.index + m[0].length;
  const end = xml.indexOf(closeTag, start);
  if (end === -1) return '';
  return xml.slice(start, end);
}



/**
 * Parse word/numbering.xml -> returns map of numId -> 'ordered' | 'unordered'
 * This is the authoritative source in DOCX for numbered vs bulleted lists.
 */
function parseNumberingXml(numberingXml) {
  const numTypeMap = {};
  if (!numberingXml) return numTypeMap;

  // Step 1: abstractNumId -> numFmt
  const abstractNumMap = {};
  const abstractBlocks = extractBlocks(numberingXml, 'abstractNum');
  for (const block of abstractBlocks) {
    const idMatch = block.match(/w:abstractNumId="([^"]+)"/);
    if (!idMatch) continue;
    const abstractId = idMatch[1];
    const lvlBlocks = extractBlocks(block, 'lvl');
    for (const lvl of lvlBlocks) {
      const ilvlMatch = lvl.match(/w:ilvl="([^"]+)"/);
      if (!ilvlMatch || ilvlMatch[1] !== '0') continue;
      const fmtMatch = lvl.match(/w:numFmt[^>]*w:val="([^"]+)"/);
      if (fmtMatch) {
        const fmt = fmtMatch[1].toLowerCase();
        abstractNumMap[abstractId] = (fmt === 'bullet' || fmt === 'none') ? 'unordered' : 'ordered';
      }
      break;
    }
  }

  // Step 2: numId -> abstractNumId -> type
  const numBlocks = extractBlocks(numberingXml, 'num');
  for (const block of numBlocks) {
    const numIdMatch = block.match(/<w:num\s[^>]*w:numId="([^"]+)"/);
    const absIdMatch = block.match(/w:abstractNumId[^>]*w:val="([^"]+)"/);
    if (!numIdMatch || !absIdMatch) continue;
    numTypeMap[numIdMatch[1]] = abstractNumMap[absIdMatch[1]] || 'ordered';
  }

  return numTypeMap;
}

function parseNamedStyles(stylesXml) {

  const styles = {};
  if (!stylesXml) return styles;
  const styleBlocks = extractBlocks(stylesXml, 'style');
  for (const block of styleBlocks) {
    const idMatch = block.match(/w:styleId="([^"]*)"/);
    if (!idMatch) continue;
    const id = idMatch[1];
    const nameMatch = block.match(/<w:name\s+w:val="([^"]*)"/);
    const name = nameMatch ? nameMatch[1] : id;
    
    const basedOnMatch = block.match(/<w:basedOn\s+w:val="([^"]*)"/);
    styles[id] = {
      name,
      basedOn: basedOnMatch ? basedOnMatch[1] : null,
      rPr: extractElement(block, 'rPr'),
      pPr: extractElement(block, 'pPr'),
    };
  }
  return styles;
}



function parseRunProps(rPrXml) {
  if (!rPrXml) return {};
  return {
    bold: xmlHasElem(rPrXml, 'b') && !xmlHasElem(rPrXml, 'bCs')
      ? !(rPrXml.includes('<w:b w:val="0"') || rPrXml.includes('<w:b w:val="false"'))
      : xmlHasElem(rPrXml, 'b'),
    italic: xmlHasElem(rPrXml, 'i') && !rPrXml.includes('<w:i w:val="0"'),
    underline: xmlHasElem(rPrXml, 'u') && !rPrXml.includes('<w:u w:val="none"'),
    strikethrough: xmlHasElem(rPrXml, 'strike') && !rPrXml.includes('<w:strike w:val="0"'),
    allCaps: xmlHasElem(rPrXml, 'caps'),
    smallCaps: xmlHasElem(rPrXml, 'smallCaps'),
    color: xmlAttr(rPrXml, 'color', 'val') || null,
    size: xmlAttr(rPrXml, 'sz', 'val') ? parseInt(xmlAttr(rPrXml, 'sz', 'val'), 10) : null,
    font: xmlAttr(rPrXml, 'rFonts', 'ascii') || xmlAttr(rPrXml, 'rFonts', 'hAnsi') || null,
    highlight: xmlAttr(rPrXml, 'highlight', 'val') || null,
    vertAlign: xmlAttr(rPrXml, 'vertAlign', 'val') || null,
  };
}

function parseRunText(runXml) {
  let text = '';
  
  const tRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let m;
  while ((m = tRe.exec(runXml)) !== null) {
    text += m[1];
  }
  
  if (/<w:tab\s*\/?>/.test(runXml)) text += '\t';
  
  if (/<w:cr\s*\/?>/.test(runXml)) text += '\n';
  return text;
}

function parseRun(runXml) {
  const rPrXml = extractElement(runXml, 'rPr');
  const props = parseRunProps(rPrXml);
  const text = parseRunText(runXml);
  return { text, ...props };
}



const ALIGN_MAP = {
  left: 'left', center: 'center', right: 'right',
  both: 'justified', distribute: 'justified',
};

function parseParagraph(pXml, namedStyles) {
  const pPrXml = extractElement(pXml, 'pPr');

  
  const styleName = xmlAttr(pPrXml, 'pStyle', 'val') || 'Normal';

  // Resolve style chain: get inherited pPr and rPr from named styles
  let resolvedAlignment = null;
  let resolvedNumPr = null;
  let resolvedRunProps = {};
  const resolveStyle = (styleId, visited = new Set()) => {
    if (!styleId || visited.has(styleId) || !namedStyles[styleId]) return;
    visited.add(styleId);
    const style = namedStyles[styleId];
    // Resolve base style first (parent properties get overridden by child)
    if (style.basedOn) resolveStyle(style.basedOn, visited);
    // Apply paragraph properties from style
    if (style.pPr) {
      const styleJc = xmlAttr(style.pPr, 'jc', 'val');
      if (styleJc && ALIGN_MAP[styleJc]) resolvedAlignment = ALIGN_MAP[styleJc];
      
      const sNumPr = extractElement(style.pPr, 'numPr');
      if (sNumPr && !resolvedNumPr) resolvedNumPr = sNumPr;
    }
    // Apply run properties from style
    if (style.rPr) {
      const styleRunProps = parseRunProps(style.rPr);
      Object.keys(styleRunProps).forEach(k => {
        if (styleRunProps[k] !== null && styleRunProps[k] !== false) {
          resolvedRunProps[k] = styleRunProps[k];
        }
      });
    }
  };
  resolveStyle(styleName);

  
  const jcRaw = xmlAttr(pPrXml, 'jc', 'val');
  const alignment = ALIGN_MAP[jcRaw] || resolvedAlignment || 'left';

  
  const spacingXml = extractElement(pPrXml, 'spacing');
  const spacing = {
    before: spacingXml ? parseInt(xmlAttr(spacingXml, 'spacing', 'before') || '0', 10) : 0,
    after: spacingXml ? parseInt(xmlAttr(spacingXml, 'spacing', 'after') || '0', 10) : 0,
    line: spacingXml ? xmlAttr(spacingXml, 'spacing', 'line') : null,
  };
  
  if (!spacingXml && pPrXml) {
    const spMatch = pPrXml.match(/<w:spacing([^>]*)>/);
    if (spMatch) {
      const attrs = spMatch[1];
      const bef = attrs.match(/w:before="(\d+)"/);
      const aft = attrs.match(/w:after="(\d+)"/);
      const lin = attrs.match(/w:line="(\d+)"/);
      spacing.before = bef ? parseInt(bef[1], 10) : 0;
      spacing.after = aft ? parseInt(aft[1], 10) : 0;
      spacing.line = lin ? lin[1] : null;
    }
  }

  
  const indXml = pPrXml;
  const indent = {
    left: parseInt(xmlAttr(indXml, 'ind', 'left') || '0', 10),
    right: parseInt(xmlAttr(indXml, 'ind', 'right') || '0', 10),
    firstLine: parseInt(xmlAttr(indXml, 'ind', 'firstLine') || '0', 10),
    hanging: parseInt(xmlAttr(indXml, 'ind', 'hanging') || '0', 10),
  };

  
  const numPrXml = extractElement(pPrXml, 'numPr') || resolvedNumPr;
  let listInfo = numPrXml ? {
    numId: xmlAttr(numPrXml, 'numId', 'val'),
    level: parseInt(xmlAttr(numPrXml, 'ilvl', 'val') || '0', 10),
  } : null;

  // Fallback heuristic based on common list style names if numPr is missing
  if (!listInfo && /List/i.test(styleName) && !/Paragraph/i.test(styleName)) {
    listInfo = {
      numId: /Bullet/i.test(styleName) ? 'bullet' : 'number',
      level: 0
    };
  }

  
  const paraRPr = extractElement(pPrXml, 'rPr');
  const paraRunPropsRaw = parseRunProps(paraRPr);
  // Merge: resolved style props, then paragraph-level rPr overrides
  const paraRunProps = { ...resolvedRunProps };
  Object.keys(paraRunPropsRaw).forEach(k => {
    if (paraRunPropsRaw[k] !== null && paraRunPropsRaw[k] !== false) {
      paraRunProps[k] = paraRunPropsRaw[k];
    }
  });

  
  
  const unwrapped = pXml
    .replace(/<w:hyperlink[^>]*>/g, '')
    .replace(/<\/w:hyperlink>/g, '');

  const runBlocks = extractBlocks(unwrapped, 'r');
  const runs = runBlocks.map(r => parseRun(r)).filter(r => r.text !== '');

  const fullText = runs.map(r => r.text).join('');

  return {
    fullText,
    style: styleName,
    alignment,
    spacing,
    indent,
    listInfo,
    paraRunProps,
    runs,
    isEmpty: fullText.trim() === '',
    isHeading: /^Heading\d+$/i.test(styleName),
    headingLevel: /^Heading(\d+)$/i.test(styleName)
      ? parseInt(styleName.match(/\d+/)[0], 10)
      : null,
  };
}



export async function extractDocxStructure(filePathOrBuffer) {
  const data = Buffer.isBuffer(filePathOrBuffer)
    ? filePathOrBuffer
    : await fs.readFile(filePathOrBuffer);

  const zip = await JSZip.loadAsync(data);

  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Invalid DOCX: word/document.xml not found');
  const documentXml = await docFile.async('string');

  const stylesFile = zip.file('word/styles.xml');
  const stylesXml = stylesFile ? await stylesFile.async('string') : '';
  const namedStyles = parseNamedStyles(stylesXml);

  // Parse numbering.xml to correctly classify ordered vs unordered lists
  const numberingFile = zip.file('word/numbering.xml');
  const numberingXml = numberingFile ? await numberingFile.async('string') : '';
  const numTypeMap = parseNumberingXml(numberingXml);

  
  const bodyXml = extractElement(documentXml, 'body');

  // Extract body elements in document order (paragraphs and tables interleaved)
  const paragraphs = [];
  const tableParagraphs = [];
  const bodyElements = []; // ordered list: { type: 'paragraph'|'table', data }

  // Extract top-level <w:p> and <w:tbl> from body in order, tracking nesting depth
  // to avoid matching <w:p> inside <w:tbl>
  function extractTopLevelElements(xml) {
    const elements = [];
    let i = 0;
    while (i < xml.length) {
      // Look for next <w:p or <w:tbl tag
      const nextP = xml.indexOf('<w:p', i);
      const nextTbl = xml.indexOf('<w:tbl', i);
      
      let nextPos = -1;
      let tag = '';
      if (nextP === -1 && nextTbl === -1) break;
      if (nextP === -1) { nextPos = nextTbl; tag = 'tbl'; }
      else if (nextTbl === -1) { nextPos = nextP; tag = 'p'; }
      else if (nextP < nextTbl) { nextPos = nextP; tag = 'p'; }
      else { nextPos = nextTbl; tag = 'tbl'; }

      // Find the character immediately following the tag name (e.g., `<w:p` or `<w:tbl`)
      const tagLen = tag === 'tbl' ? 6 : 4; // '<w:tbl'.length === 6, '<w:p'.length === 4
      const charAfterTag = xml[nextPos + tagLen];
      if (tag === 'p' && charAfterTag !== '>' && charAfterTag !== ' ' && charAfterTag !== '/') {
        i = nextPos + 1;
        continue;
      }
      if (tag === 'tbl' && charAfterTag !== '>' && charAfterTag !== ' ' && charAfterTag !== '/') {
        i = nextPos + 1;
        continue;
      }

      // Find matching close tag, tracking nesting
      const openTag = `<w:${tag}`;
      const closeTag = `</w:${tag}>`;
      let depth = 1;
      let searchFrom = nextPos + openTag.length;
      while (depth > 0 && searchFrom < xml.length) {
        const nextOpen = xml.indexOf(openTag, searchFrom);
        const nextClose = xml.indexOf(closeTag, searchFrom);
        if (nextClose === -1) break; // malformed XML
        
        if (nextOpen !== -1 && nextOpen < nextClose) {
          // Check if it's a real open tag (not <w:pPr> etc.)
          const ca = xml[nextOpen + openTag.length];
          if (ca === '>' || ca === ' ' || ca === '/') {
            depth++;
          }
          searchFrom = nextOpen + openTag.length;
        } else {
          depth--;
          if (depth === 0) {
            const blockXml = xml.slice(nextPos, nextClose + closeTag.length);
            elements.push({ tag, xml: blockXml });
            i = nextClose + closeTag.length;
          } else {
            searchFrom = nextClose + closeTag.length;
          }
        }
      }
      if (depth > 0) {
        // Could not find close tag, skip
        i = nextPos + 1;
      }
    }
    return elements;
  }

  const topLevelElements = extractTopLevelElements(bodyXml);
  
  for (const elem of topLevelElements) {
    if (elem.tag === 'p') {
      const para = parseParagraph(elem.xml, namedStyles);
      paragraphs.push(para);
      bodyElements.push({ type: 'paragraph', data: para });
    } else if (elem.tag === 'tbl') {
      const rows = [];
      const rowBlocks = extractBlocks(elem.xml, 'tr');
      for (const rowXml of rowBlocks) {
        const cells = [];
        const cellBlocks = extractBlocks(rowXml, 'tc');
        for (const cellXml of cellBlocks) {
          const cellParas = extractBlocks(cellXml, 'p').map(pXml => parseParagraph(pXml, namedStyles));
          cellParas.forEach(cp => tableParagraphs.push(cp));
          cells.push(cellParas);
        }
        rows.push(cells);
      }
      bodyElements.push({ type: 'table', data: rows });
    }
  }

  const plainText = paragraphs.map(p => p.fullText).join('\n');

  return {
    paragraphs,
    tableParagraphs,
    bodyElements,
    plainText,
    namedStyles,
    numTypeMap,
    metadata: {
      paragraphCount: paragraphs.length,
      tableParagraphCount: tableParagraphs.length,
      extractedAt: new Date().toISOString(),
    },
    rawDocumentXml: documentXml,
  };
}

export async function extractDocxText(filePathOrBuffer) {
  try {
    const structure = await extractDocxStructure(filePathOrBuffer);
    return structure.plainText;
  } catch (err) {
    console.warn('⚠️  docxStructureExtractor fallback to mammoth:', err.message);
    try {
      const mammoth = await import('mammoth');
      const input = Buffer.isBuffer(filePathOrBuffer)
        ? { buffer: filePathOrBuffer }
        : { path: filePathOrBuffer };
      const result = await mammoth.extractRawText(input);
      return (result?.value || '').trim();
    } catch (e2) {
      console.error('❌ Both docx and mammoth extraction failed:', e2.message);
      return '';
    }
  }
}

export default { extractDocxStructure, extractDocxText };


/**
 * Convert extracted docxStructure into TipTap-compatible HTML.
 * Preserves bold, italic, underline, strikethrough, fonts, sizes, colors,
 * alignment, spacing, headings, and lists.
 */
export function docxStructureToHtml(docxStructure) {
  if (!docxStructure || !docxStructure.paragraphs) return '<p></p>';
  
  // Use bodyElements for correct document order if available, else fallback
  const useBodyElements = docxStructure.bodyElements?.length > 0;

  const htmlParts = [];
  let inOrderedList = false;
  let inUnorderedList = false;
  let lastListNumId = null;
  const listCounters = {};

  function closeLists() {
    if (inOrderedList) { htmlParts.push('</ol>'); inOrderedList = false; lastListNumId = null; }
    if (inUnorderedList) { htmlParts.push('</ul>'); inUnorderedList = false; }
  }

  function renderParagraph(para) {
    const isList = !!para.listInfo;
    
    // Use numTypeMap from numbering.xml for authoritative ordered/unordered classification
    const numTypeMap = docxStructure.numTypeMap || {};
    let isOrdered = false;
    if (isList && para.listInfo.numId && para.listInfo.numId !== '0') {
      const numType = numTypeMap[para.listInfo.numId];
      if (numType === 'unordered') {
        isOrdered = false;
      } else if (numType === 'ordered') {
        isOrdered = true;
      } else {
        // Fallback heuristic when numbering.xml is missing
        if (/Bullet/i.test(para.style || '')) isOrdered = false;
        else isOrdered = true; // default to ordered if unknown
      }
    }

    // Numbering fix: empty paragraphs between list items break the list
    if (!isList && para.isEmpty) {
      if (inOrderedList || inUnorderedList) {
        // Append visual spacing to the previous list item instead of breaking the list
        let lastItemIdx = htmlParts.length - 1;
        while (lastItemIdx >= 0 && !htmlParts[lastItemIdx].endsWith('</li>')) {
          lastItemIdx--;
        }
        if (lastItemIdx >= 0) {
          const lastItem = htmlParts[lastItemIdx];
          htmlParts[lastItemIdx] = lastItem.slice(0, -5) + '<br><br></li>';
          return;
        }
      }
    }

    if (!isList) closeLists();

    const runsHtml = buildRunsHtml(para.runs, para.paraRunProps);

    if (para.isEmpty && !isList) {
      htmlParts.push('<p><br></p>');
      return;
    }

    if (para.isHeading && para.headingLevel) {
      const level = Math.min(para.headingLevel, 6);
      const alignStyle = para.alignment && para.alignment !== 'left' ? ` style="text-align: ${para.alignment}"` : '';
      htmlParts.push(`<h${level}${alignStyle}>${runsHtml}</h${level}>`);
      return;
    }

    if (isList) {
      if (isOrdered) {
        const currentNumId = para.listInfo.numId;
        if (!listCounters[currentNumId]) {
          listCounters[currentNumId] = 0;
        }
        listCounters[currentNumId]++;

        if (!inOrderedList || lastListNumId !== currentNumId) {
          if (inUnorderedList) { htmlParts.push('</ul>'); inUnorderedList = false; }
          if (inOrderedList && lastListNumId !== currentNumId) { htmlParts.push('</ol>'); }
          
          const startVal = listCounters[currentNumId];
          if (startVal > 1) {
            htmlParts.push(`<ol start="${startVal}">`);
          } else {
            htmlParts.push('<ol>');
          }
          inOrderedList = true;
          lastListNumId = currentNumId;
        }
      } else {
        if (!inUnorderedList) {
          if (inOrderedList) { htmlParts.push('</ol>'); inOrderedList = false; lastListNumId = null; }
          htmlParts.push('<ul>');
          inUnorderedList = true;
        }
      }
      htmlParts.push(`<li>${runsHtml}</li>`);
      return;
    }

    // Regular paragraph
    const styles = [];
    if (para.alignment && para.alignment !== 'left') {
      styles.push(`text-align: ${para.alignment}`);
    }
    if (para.indent?.left > 0) {
      styles.push(`margin-left: ${Math.round(para.indent.left / 240)}em`);
    }
    if (para.indent?.firstLine > 0) {
      styles.push(`text-indent: ${Math.round(para.indent.firstLine / 240)}em`);
    }
    if (para.spacing?.before > 0) {
      styles.push(`margin-top: ${Math.round(para.spacing.before / 20)}pt`);
    }
    if (para.spacing?.after > 0) {
      styles.push(`margin-bottom: ${Math.round(para.spacing.after / 20)}pt`);
    }
    if (para.spacing?.line) {
      const lineVal = parseInt(para.spacing.line, 10);
      if (lineVal > 0 && lineVal !== 240) {
        styles.push(`line-height: ${(lineVal / 240).toFixed(2)}`);
      }
    }

    const styleAttr = styles.length ? ` style="${styles.join('; ')}"` : '';
    htmlParts.push(`<p${styleAttr}>${runsHtml}</p>`);
  }

  function renderTable(rows) {
    closeLists();
    htmlParts.push('<table style="border-collapse: collapse; width: 100%">');
    for (const row of rows) {
      htmlParts.push('<tr>');
      for (const cellParas of row) {
        htmlParts.push('<td style="border: 1px solid #999; padding: 4px; vertical-align: top">');
        for (const para of cellParas) {
          const runsHtml = buildRunsHtml(para.runs, para.paraRunProps);
          if (para.isEmpty) {
            htmlParts.push('<p><br></p>');
          } else {
            const styles = [];
            if (para.alignment && para.alignment !== 'left') styles.push(`text-align: ${para.alignment}`);
            const styleAttr = styles.length ? ` style="${styles.join('; ')}"` : '';
            htmlParts.push(`<p${styleAttr}>${runsHtml}</p>`);
          }
        }
        htmlParts.push('</td>');
      }
      htmlParts.push('</tr>');
    }
    htmlParts.push('</table>');
  }

  if (useBodyElements) {
    for (const element of docxStructure.bodyElements) {
      if (element.type === 'paragraph') {
        renderParagraph(element.data);
      } else if (element.type === 'table') {
        renderTable(element.data);
      }
    }
  } else {
    // Fallback for old structures without bodyElements
    const allParas = [...docxStructure.paragraphs];
    if (docxStructure.tableParagraphs?.length) {
      allParas.push(...docxStructure.tableParagraphs);
    }
    for (const para of allParas) {
      renderParagraph(para);
    }
  }

  closeLists();

  return htmlParts.join('\n');
}

function buildRunsHtml(runs, paraRunProps = {}) {
  if (!runs || runs.length === 0) return '';

  return runs.map(run => {
    let text = escapeHtml(run.text || '');
    if (!text) return '';
    
    // Replace tabs with spaces
    text = text.replace(/\t/g, '&nbsp;&nbsp;&nbsp;&nbsp;');
    // Replace newlines (from <w:cr/>) with <br>
    text = text.replace(/\n/g, '<br>');

    // Merge: paraRunProps (from style) are defaults, run props override
    const bold = run.bold !== null && run.bold !== undefined ? run.bold : paraRunProps.bold;
    const italic = run.italic !== null && run.italic !== undefined ? run.italic : paraRunProps.italic;
    const underline = run.underline !== null && run.underline !== undefined ? run.underline : paraRunProps.underline;
    const strikethrough = run.strikethrough !== null && run.strikethrough !== undefined ? run.strikethrough : paraRunProps.strikethrough;
    const highlight = run.highlight || paraRunProps.highlight;
    const font = run.font || paraRunProps.font;
    const size = run.size || paraRunProps.size;
    const color = run.color || paraRunProps.color;
    const vertAlign = run.vertAlign || paraRunProps.vertAlign;

    // Apply inline formatting (innermost first, outermost last)
    if (strikethrough) text = `<s>${text}</s>`;
    if (underline) text = `<u>${text}</u>`;
    if (italic) text = `<em>${text}</em>`;
    if (bold) text = `<strong>${text}</strong>`;
    if (highlight) text = `<mark>${text}</mark>`;

    // Check if we need a <span> for font/size/color
    const spanStyles = [];
    if (font) spanStyles.push(`font-family: ${font}`);
    // size is in half-points (DOCX convention), convert to pt
    if (size) spanStyles.push(`font-size: ${size / 2}pt`);
    if (color && color !== '000000' && color !== 'auto') spanStyles.push(`color: #${color}`);

    if (spanStyles.length > 0) {
      text = `<span style="${spanStyles.join('; ')}">${text}</span>`;
    }

    if (vertAlign === 'superscript') text = `<sup>${text}</sup>`;
    if (vertAlign === 'subscript') text = `<sub>${text}</sub>`;

    return text;
  }).join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
