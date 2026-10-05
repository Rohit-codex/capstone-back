import JSZip from 'jszip';


function getAttrVal(xmlStr, tagName, attrName) {
  const regex = new RegExp(`<${tagName}[^>]*?${attrName}="([^"]*)"`, 'i');
  const match = xmlStr.match(regex);
  return match ? match[1] : null;
}


function findAll(xmlStr, regex) {
  const results = [];
  let match;
  while ((match = regex.exec(xmlStr)) !== null) {
    results.push(match);
  }
  return results;
}


function twipsToInches(twips) {
  return Math.round((parseInt(twips) / 1440) * 100) / 100;
}


function halfPointsToPoints(hp) {
  return parseInt(hp) / 2;
}

export async function extractDocxFormatting(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  
  const formatMetadata = {
    pageSize: { width: 12240, height: 15840, orientation: 'portrait' },
    margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
    defaultFont: 'Times New Roman',
    defaultFontSize: 12,
    headingFonts: {},
    headingStyles: {},
    bodyAlignment: 'left',
    lineSpacing: 1.15,
    paragraphSpacing: { before: 0, after: 200 },
    colors: { textColor: '000000', accentColor: '000000' },
    styles: [],
    headerText: '',
    footerText: '',
    detectedFonts: [],
    detectedFontSizes: [],
    hasBorders: false,
    borderStyle: 'none',
    extracted: true
  };

  try {
    
    const settingsXml = await tryReadXml(zip, 'word/settings.xml');
    
    
    const documentXml = await tryReadXml(zip, 'word/document.xml');
    if (documentXml) {
      extractPageLayout(documentXml, formatMetadata);
      extractParagraphFormatting(documentXml, formatMetadata);
      extractRunFormatting(documentXml, formatMetadata);
      extractBorders(documentXml, formatMetadata);
    }

    
    const stylesXml = await tryReadXml(zip, 'word/styles.xml');
    if (stylesXml) {
      extractStyles(stylesXml, formatMetadata);
    }

    
    await extractHeadersFooters(zip, formatMetadata);

    
    computeDominantValues(formatMetadata);

  } catch (err) {
    console.error('DOCX format extraction error:', err.message);
    formatMetadata.extractionError = err.message;
  }

  return formatMetadata;
}

async function tryReadXml(zip, path) {
  const file = zip.file(path);
  if (!file) return null;
  return await file.async('string');
}

function extractPageLayout(xml, meta) {
  
  const pgSzMatch = xml.match(/<w:pgSz([^\/]*?)\/>/i);
  if (pgSzMatch) {
    const attrs = pgSzMatch[1];
    const w = attrs.match(/w:w="(\d+)"/);
    const h = attrs.match(/w:h="(\d+)"/);
    const orient = attrs.match(/w:orient="(\w+)"/);
    if (w) meta.pageSize.width = parseInt(w[1]);
    if (h) meta.pageSize.height = parseInt(h[1]);
    if (orient) meta.pageSize.orientation = orient[1];
  }

  
  const pgMarMatch = xml.match(/<w:pgMar([^\/]*?)\/>/i);
  if (pgMarMatch) {
    const attrs = pgMarMatch[1];
    const top = attrs.match(/w:top="(-?\d+)"/);
    const right = attrs.match(/w:right="(\d+)"/);
    const bottom = attrs.match(/w:bottom="(-?\d+)"/);
    const left = attrs.match(/w:left="(\d+)"/);
    if (top) meta.margins.top = parseInt(top[1]);
    if (right) meta.margins.right = parseInt(right[1]);
    if (bottom) meta.margins.bottom = parseInt(bottom[1]);
    if (left) meta.margins.left = parseInt(left[1]);
  }
}

function extractParagraphFormatting(xml, meta) {
  
  const paragraphs = findAll(xml, /<w:pPr>([\s\S]*?)<\/w:pPr>/gi);
  const alignments = [];
  const spacings = [];

  for (const p of paragraphs) {
    const pprContent = p[1];
    
    
    const jcMatch = pprContent.match(/w:jc\s+w:val="(\w+)"/);
    if (jcMatch) alignments.push(jcMatch[1]);

    
    const spacingMatch = pprContent.match(/<w:spacing([^\/]*?)\/>/);
    if (spacingMatch) {
      const attrs = spacingMatch[1];
      const line = attrs.match(/w:line="(\d+)"/);
      const before = attrs.match(/w:before="(\d+)"/);
      const after = attrs.match(/w:after="(\d+)"/);
      if (line) spacings.push(parseInt(line[1]));
      if (before) meta.paragraphSpacing.before = parseInt(before[1]);
      if (after) meta.paragraphSpacing.after = parseInt(after[1]);
    }
  }

  
  if (alignments.length > 0) {
    const counts = {};
    alignments.forEach(a => { counts[a] = (counts[a] || 0) + 1; });
    meta.bodyAlignment = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  
  if (spacings.length > 0) {
    const avgSpacing = spacings.reduce((a, b) => a + b, 0) / spacings.length;
    meta.lineSpacing = Math.round((avgSpacing / 240) * 100) / 100;
  }
}

function extractRunFormatting(xml, meta) {
  
  const runs = findAll(xml, /<w:rPr>([\s\S]*?)<\/w:rPr>/gi);
  const fonts = [];
  const sizes = [];
  const colors = [];

  for (const r of runs) {
    const rprContent = r[1];

    
    const fontMatch = rprContent.match(/w:rFonts[^>]*?w:ascii="([^"]+)"/);
    if (fontMatch) fonts.push(fontMatch[1]);
    
    
    const hAnsiMatch = rprContent.match(/w:rFonts[^>]*?w:hAnsi="([^"]+)"/);
    if (hAnsiMatch && !fontMatch) fonts.push(hAnsiMatch[1]);

    
    const szMatch = rprContent.match(/w:sz\s+w:val="(\d+)"/);
    if (szMatch) sizes.push(parseInt(szMatch[1]));

    
    const colorMatch = rprContent.match(/w:color\s+w:val="([^"]+)"/);
    if (colorMatch && colorMatch[1] !== 'auto') colors.push(colorMatch[1]);
  }

  meta.detectedFonts = [...new Set(fonts)];
  meta.detectedFontSizes = [...new Set(sizes.map(s => halfPointsToPoints(s)))];
  
  if (colors.length > 0) {
    meta.colors.textColor = getMostCommon(colors) || '000000';
    const accentColors = colors.filter(c => c !== meta.colors.textColor);
    if (accentColors.length > 0) {
      meta.colors.accentColor = getMostCommon(accentColors);
    }
  }
}

function extractBorders(xml, meta) {
  
  const borderMatch = xml.match(/<w:pgBorders[^>]*>([\s\S]*?)<\/w:pgBorders>/i);
  if (borderMatch) {
    meta.hasBorders = true;
    const borderContent = borderMatch[1];
    const styleMatch = borderContent.match(/w:val="(\w+)"/);
    if (styleMatch) {
      meta.borderStyle = styleMatch[1];
    }
  }
}

function extractStyles(stylesXml, meta) {
  
  const defaultFontMatch = stylesXml.match(/<w:rFontsDefaults>[\s\S]*?w:ascii="([^"]+)"/);
  if (defaultFontMatch) {
    meta.defaultFont = defaultFontMatch[1];
  }
  
  
  const rPrDefaultMatch = stylesXml.match(/<w:rPrDefault>[\s\S]*?<w:rPr>([\s\S]*?)<\/w:rPr>/);
  if (rPrDefaultMatch) {
    const fontM = rPrDefaultMatch[1].match(/w:rFonts[^>]*?w:ascii="([^"]+)"/);
    if (fontM) meta.defaultFont = fontM[1];
    const szM = rPrDefaultMatch[1].match(/w:sz\s+w:val="(\d+)"/);
    if (szM) meta.defaultFontSize = halfPointsToPoints(szM[1]);
  }

  
  const styleBlocks = findAll(stylesXml, /<w:style\s+w:type="paragraph"[^>]*?w:styleId="(Heading\d)"[^>]*?>([\s\S]*?)<\/w:style>/gi);
  for (const s of styleBlocks) {
    const styleId = s[1];
    const content = s[2];
    const headingInfo = {};
    
    const fontM = content.match(/w:rFonts[^>]*?w:ascii="([^"]+)"/);
    if (fontM) headingInfo.font = fontM[1];
    
    const szM = content.match(/w:sz\s+w:val="(\d+)"/);
    if (szM) headingInfo.fontSize = halfPointsToPoints(szM[1]);
    
    const boldM = content.match(/<w:b\s*\/?>|<w:b\s/);
    headingInfo.bold = !!boldM;
    
    const colorM = content.match(/w:color\s+w:val="([^"]+)"/);
    if (colorM) headingInfo.color = colorM[1];
    
    meta.headingStyles[styleId] = headingInfo;
  }

  
  const allStyles = findAll(stylesXml, /<w:style\s+w:type="(\w+)"[^>]*?w:styleId="([^"]+)"[^>]*?>([\s\S]*?)<\/w:style>/gi);
  for (const s of allStyles) {
    const nameMatch = s[3].match(/<w:name\s+w:val="([^"]+)"/);
    meta.styles.push({
      type: s[1],
      id: s[2],
      name: nameMatch ? nameMatch[1] : s[2]
    });
  }
}

async function extractHeadersFooters(zip, meta) {
  
  for (let i = 1; i <= 3; i++) {
    const headerXml = await tryReadXml(zip, `word/header${i}.xml`);
    if (headerXml) {
      const text = headerXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && text.length > 0) {
        meta.headerText = text;
        break;
      }
    }
  }

  
  for (let i = 1; i <= 3; i++) {
    const footerXml = await tryReadXml(zip, `word/footer${i}.xml`);
    if (footerXml) {
      const text = footerXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (text && text.length > 0) {
        meta.footerText = text;
        break;
      }
    }
  }
}

function computeDominantValues(meta) {
  
  if (meta.detectedFonts.length > 0 && meta.defaultFont === 'Times New Roman') {
    meta.defaultFont = getMostCommon(meta.detectedFonts) || meta.defaultFont;
  }
  
  
  if (meta.detectedFontSizes.length > 0) {
    const commonSize = getMostCommon(meta.detectedFontSizes.map(String));
    if (commonSize) meta.defaultFontSize = parseFloat(commonSize);
  }

  
  const alignMap = { left: 'left', center: 'center', right: 'right', both: 'justify' };
  meta.bodyAlignment = alignMap[meta.bodyAlignment] || meta.bodyAlignment;

  
  const w = meta.pageSize.width;
  const h = meta.pageSize.height;
  if (w === 12240 && h === 15840) meta.pageSize.name = 'Letter';
  else if (w === 11906 && h === 16838) meta.pageSize.name = 'A4';
  else if (w === 12240 && h === 20160) meta.pageSize.name = 'Legal';
  else if (w === 8391 && h === 11906) meta.pageSize.name = 'A5';
  else meta.pageSize.name = 'Custom';

  
  meta.margins.topInches = twipsToInches(meta.margins.top);
  meta.margins.rightInches = twipsToInches(meta.margins.right);
  meta.margins.bottomInches = twipsToInches(meta.margins.bottom);
  meta.margins.leftInches = twipsToInches(meta.margins.left);
}

function getMostCommon(arr) {
  if (!arr || arr.length === 0) return null;
  const counts = {};
  arr.forEach(item => { counts[item] = (counts[item] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export async function extractDocxImages(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const images = [];

  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'emf', 'wmf'];
  const MIME_MAP = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff',
    tif: 'image/tiff', webp: 'image/webp',
    emf: 'image/x-emf', wmf: 'image/x-wmf',
  };

  let index = 0;
  for (const [filename, file] of Object.entries(zip.files)) {
    if (!filename.startsWith('word/media/') || file.dir) continue;
    const ext = filename.split('.').pop().toLowerCase();
    if (!IMAGE_EXTS.includes(ext)) continue;

    try {
      const data = await file.async('base64');
      const mimeType = MIME_MAP[ext] || 'image/png';
      const baseName = filename.split('/').pop();

      
      const positions = ['bottom-right', 'bottom-left', 'top-right', 'top-left', 'center'];
      const position = positions[index % positions.length];

      images.push({
        data: `data:${mimeType};base64,${data}`,
        label: baseName,
        position,
        width: 80,
        height: 80,
        opacity: 1,
        isWatermark: false,
      });
      index++;
    } catch (err) {
      console.warn(`Failed to extract image ${filename}:`, err.message);
    }
  }

  return images;
}

export async function docxToHtml(buffer) {
  const mammoth = await import('mammoth');
  const result = await mammoth.convertToHtml({ buffer }, {
    styleMap: [
      "p[style-name='Title'] => h1.doc-title",
      "p[style-name='Heading 1'] => h1",
      "p[style-name='Heading 2'] => h2",
      "p[style-name='Heading 3'] => h3",
      "p[style-name='Heading 4'] => h4",
      "p[style-name='Heading 5'] => h5",
      "p[style-name='Heading 6'] => h6",
      "b => strong",
      "i => em",
      "u => u",
      "strike => s"
    ]
  });
  return result.value;
}
