
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import fs from 'fs/promises';
import path from 'path';



function sanitizeFields(fields) {
  const out = {};
  for (const [key, val] of Object.entries(fields || {})) {
    if (Array.isArray(val)) {
      out[key] = val.map((v, i) => `${i + 1}. ${String(v)}`).join('\n');
    } else if (val === null || val === undefined) {
      out[key] = '';
    } else {
      out[key] = String(val);
    }
  }
  return out;
}

function fillDocxTemplate(templateBuffer, fields) {
  const sanitized = sanitizeFields(fields);

  const zip = new PizZip(templateBuffer);

  const doc = new Docxtemplater(zip, {
    
    delimiters: { start: '{{', end: '}}' },
    
    nullGetter() { return ''; },
    
    errorLogging: false,
  });

  
  doc.render(sanitized);

  const filledBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  return filledBuffer;
}



async function applyDesignConfigToBuffer(filledBuffer, title, designConfig) {
  if (!designConfig) return filledBuffer;
  
  
  return injectDesignToDocx(filledBuffer, designConfig);
}



export async function renderTemplateDocx(
  templateFilePath,
  fields,
  outDir = 'uploads/generated',
  title = 'DRAFT',
  designConfig = null
) {
  console.log('🔧 renderTemplateDocx:', path.basename(templateFilePath));
  console.log('   Fields:', Object.keys(fields || {}).join(', '));
  if (designConfig) console.log('   DesignConfig:', designConfig.fontFamily || 'custom');

  
  const templateBuffer = await fs.readFile(templateFilePath);

  
  let filledBuffer;
  try {
    filledBuffer = fillDocxTemplate(templateBuffer, fields);
    console.log('   ✅ docxtemplater fill complete:', filledBuffer.length, 'bytes');
  } catch (dtErr) {
    console.warn('   ⚠️  docxtemplater failed, falling back to underscore XML fill:', dtErr.message);
    
    
    try {
      return await fillUnderlineDocx(templateFilePath, fields, [], outDir, title, designConfig);
    } catch (fallbackErr) {
      console.error('   ❌ Fallback fillUnderlineDocx also failed:', fallbackErr.message);
      throw dtErr;
    }
  }

  
  let finalBuffer = filledBuffer;
  if (designConfig) {
    try {
      finalBuffer = await applyDesignConfigToBuffer(filledBuffer, title, designConfig);
      console.log('   ✅ design config applied:', finalBuffer.length, 'bytes');
    } catch (designErr) {
      console.warn('   ⚠️  design config apply failed, using docxtemplater output:', designErr.message);
      finalBuffer = filledBuffer;
    }
  }

  
  await fs.mkdir(outDir, { recursive: true });
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);
  const fileName = `${safeTitle || 'document'}_${Date.now()}.docx`;
  const filePath = path.join(outDir, fileName);

  await fs.writeFile(filePath, finalBuffer, { encoding: null });

  const stats = await fs.stat(filePath);
  console.log(`✅ renderTemplateDocx output: ${fileName} (${stats.size} bytes)`);

  return { filePath, fileSize: stats.size };
}



function replaceUnderscoresInXml(docXml, fields, placeholder_order) {
  let valueIdx = 0;

  const getValue = () => {
    const key = valueIdx < placeholder_order.length ? placeholder_order[valueIdx] : null;
    valueIdx++;
    if (!key) return '';
    return String(fields[key] ?? '').trim();
  };

  
  const segments = [];
  const tPatternG = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;
  let lastIndex = 0;
  let m;

  while ((m = tPatternG.exec(docXml)) !== null) {
    if (m.index > lastIndex) {
      segments.push({ type: 'raw', text: docXml.slice(lastIndex, m.index) });
    }
    segments.push({ type: 'wt', open: m[1], content: m[2], close: m[3] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < docXml.length) {
    segments.push({ type: 'raw', text: docXml.slice(lastIndex) });
  }

  let prevWasBlankRun = false;
  const out = [];

  
  
  const peekNextWtContent = (segments, fromIdx) => {
    for (let j = fromIdx + 1; j < segments.length; j++) {
      const s = segments[j];
      if (s.type === 'raw') {
        if (/<\/w:p\b/.test(s.text)) return null;
        continue;
      }
      return s.content;
    }
    return null;
  };

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.type === 'raw') {
      
      if (/<\/w:p[^r]|<w:p[^rP]/i.test(seg.text)) {
        prevWasBlankRun = false;
      }
      out.push(seg.text);
      continue;
    }

    const { open, content, close } = seg;
    
    
    const isBlankRun = /^[ ]*_{3,}[ ]*$/.test(content) || /^_$/.test(content);
    
    const hasMixed = /_{3,}/.test(content) && !isBlankRun;

    if (isBlankRun) {
      if (prevWasBlankRun) {
        
        out.push(open + close);
      } else {
        
        prevWasBlankRun = true;
        const value = getValue();
        const leadingSpace = content.startsWith(' ') ? ' ' : '';

        
        
        
        
        let trailingSpace = '';
        if (value && /\w$/.test(value)) {
          const nextContent = peekNextWtContent(segments, i);
          if (nextContent && /^\w/.test(nextContent)) {
            trailingSpace = ' ';
          }
        }

        out.push(open + leadingSpace + value + trailingSpace + close);
      }
    } else if (hasMixed) {
      prevWasBlankRun = false;
      
      const newContent = content.replace(/_{3,}/g, (match, offset, str) => {
        const val = getValue();
        
        const charAfter = str[offset + match.length];
        const needsTrail = val && /\w$/.test(val) && charAfter && /\w/.test(charAfter);
        return val + (needsTrail ? ' ' : '');
      });
      out.push(open + newContent + close);
    } else {
      prevWasBlankRun = false;
      out.push(open + content + close);
    }
  }

  return out.join('');
}

export async function fillUnderlineDocx(
  templateFilePath,
  fields,
  placeholder_order,
  outDir = 'uploads/generated',
  title = 'DRAFT',
  designConfig = null
) {
  console.log('📝 fillUnderlineDocx:', path.basename(templateFilePath));
  console.log('   placeholder_order length:', placeholder_order?.length ?? 0);
  console.log('   fields provided:', Object.keys(fields || {}).join(', '));

  const templateBuffer = await fs.readFile(templateFilePath);
  const zip = new PizZip(templateBuffer);

  const docXml = zip.files['word/document.xml'].asText();
  const filledXml = replaceUnderscoresInXml(docXml, fields, placeholder_order || []);
  zip.file('word/document.xml', filledXml);

  let filledBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  console.log('   ✅ underscore fill complete:', filledBuffer.length, 'bytes');

  
  if (designConfig) {
    try {
      filledBuffer = await injectDesignToDocx(filledBuffer, designConfig);
      console.log('   ✅ design injected:', filledBuffer.length, 'bytes');
    } catch (e) {
      console.warn('   ⚠️  design inject failed:', e.message);
    }
  }

  await fs.mkdir(outDir, { recursive: true });
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 40);
  const fileName = `${safeTitle || 'document'}_${Date.now()}.docx`;
  const filePath = path.join(outDir, fileName);
  await fs.writeFile(filePath, filledBuffer, { encoding: null });

  const stats = await fs.stat(filePath);
  console.log(`✅ fillUnderlineDocx output: ${fileName} (${stats.size} bytes)`);
  return { filePath, fileSize: stats.size };
}



function buildWatermarkHeaderXml(watermarkText, opacity = 0.15) {
  
  
  
  const opacityHex = Math.round(255 - opacity * 255).toString(16).padStart(2, '0').toUpperCase();
  const fillColor = `#${opacityHex}${opacityHex}${opacityHex}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
       xmlns:v="urn:schemas-microsoft-com:vml"
       xmlns:o="urn:schemas-microsoft-com:office:office"
       xmlns:w10="urn:schemas-microsoft-com:office:word"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r>
      <w:rPr><w:noProof/></w:rPr>
      <w:pict>
        <v:shape id="watermarkShape1" o:spid="_x0000_s2051" type="#_x0000_t136"
          style="position:absolute;margin-left:0;margin-top:0;width:432pt;height:144pt;z-index:-251654144;mso-position-horizontal:center;mso-position-horizontal-relative:margin;mso-position-vertical:center;mso-position-vertical-relative:margin"
          fillcolor="${fillColor}" stroked="f">
          <v:fill on="t" focussize="0,0"/>
          <v:path textpathok="t" o:connecttype="none"/>
          <v:textpath style="font-family:&quot;Arial&quot;;font-size:1pt;mso-font-kerning:0pt;font-weight:bold"
                      string="${watermarkText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}"
                      trim="t"/>
          <o:lock v:ext="edit" text="t" shapetype="t"/>
        </v:shape>
      </w:pict>
    </w:r>
  </w:p>
</w:hdr>`;
}

function buildImageAnchorXml(img, relId, uniqueId) {
  
  const w = Math.round((img.width || 80) * 9144);
  const h = Math.round((img.height || 80) * 9144);
  const pos = img.position || 'bottom-right';
  const opacity = img.opacity != null ? Math.max(0, Math.min(1, img.opacity)) : 1;
  
  const lumEffect = opacity < 0.99
    ? `<a:lum bright="${Math.round((1 - opacity) * 80000)}" contrast="${Math.round(-(1 - opacity) * 50000)}"/>`
    : '';

  
  const posMap = {
    'top-left':     { hAlign: 'left',   vAlign: 'top' },
    'top-center':   { hAlign: 'center', vAlign: 'top' },
    'top-right':    { hAlign: 'right',  vAlign: 'top' },
    'bottom-left':  { hAlign: 'left',   vAlign: 'bottom' },
    'bottom-center':{ hAlign: 'center', vAlign: 'bottom' },
    'bottom-right': { hAlign: 'right',  vAlign: 'bottom' },
    'center':       { hAlign: 'center', vAlign: 'center' },
  };
  const { hAlign, vAlign } = posMap[pos] || posMap['bottom-right'];

  return `<w:drawing>
  <wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"
    xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
    <wp:simplePos x="0" y="0"/>
    <wp:positionH relativeFrom="margin"><wp:align>${hAlign}</wp:align></wp:positionH>
    <wp:positionV relativeFrom="margin"><wp:align>${vAlign}</wp:align></wp:positionV>
    <wp:extent cx="${w}" cy="${h}"/>
    <wp:effectExtent l="0" t="0" r="0" b="0"/>
    <wp:wrapNone/>
    <wp:docPr id="${uniqueId}" name="Image${uniqueId}"/>
    <wp:cNvGraphicFramePr>
      <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
    </wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
      <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
        <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:nvPicPr>
            <pic:cNvPr id="${uniqueId}" name="Image${uniqueId}"/>
            <pic:cNvPicPr><a:picLocks noChangeAspect="1" noChangeArrowheads="1"/></pic:cNvPicPr>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${relId}">${lumEffect}</a:blip>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr bwMode="auto">
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:anchor>
</w:drawing>`;
}

export async function injectDesignToDocx(filledBuffer, designConfig) {
  if (!designConfig) return filledBuffer;

  const dc = designConfig;
  const hasWatermark = dc.watermarkText?.trim();
  const stampImages = Array.isArray(dc.images) ? dc.images.filter(i => !i.isWatermark && i.data) : [];
  const hasBorder = dc.borderStyle && dc.borderStyle !== 'none';
  const hasMargins = dc.margins && (dc.margins.top || dc.margins.bottom || dc.margins.left || dc.margins.right);

  const zip = new PizZip(filledBuffer);
  let docXml = zip.files['word/document.xml'].asText();
  let relsXml = zip.files['word/_rels/document.xml.rels']?.asText() || '';
  let contentTypesXml = zip.files['[Content_Types].xml']?.asText() || '';

  
  if (hasWatermark) {
    const hdrFileName = 'word/header_wm.xml';
    const hdrRelType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';
    const hdrRelId = `rIdWMHdr1`;
    const hdrContentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';

    const hdrXml = buildWatermarkHeaderXml(dc.watermarkText.trim(), dc.watermarkOpacity ?? 0.15);
    zip.file(hdrFileName, hdrXml);

    
    if (!contentTypesXml.includes('header_wm.xml')) {
      contentTypesXml = contentTypesXml.replace('</Types>',
        `<Override PartName="/word/header_wm.xml" ContentType="${hdrContentType}"/>\n</Types>`);
    }

    
    if (!relsXml.includes(hdrRelId)) {
      relsXml = relsXml.replace('</Relationships>',
        `<Relationship Id="${hdrRelId}" Type="${hdrRelType}" Target="header_wm.xml"/>\n</Relationships>`);
    }

    
    const headerRefXml = `<w:headerReference w:type="default" r:id="${hdrRelId}"/>`;
    if (!docXml.includes(hdrRelId)) {
      docXml = docXml.replace(/<w:sectPr([^>]*)>/, `<w:sectPr$1>${headerRefXml}`);
    }
  }

  
  if (stampImages.length > 0) {
    let uniqueId = 9001;
    const drawingXmlParts = [];

    
    if (!contentTypesXml.includes('Extension="png"') && !contentTypesXml.includes("Extension='png'")) {
      contentTypesXml = contentTypesXml.replace('</Types>',
        `<Default Extension="png" ContentType="image/png"/>\n</Types>`);
    }
    if (!contentTypesXml.includes('Extension="jpeg"') && !contentTypesXml.includes('Extension="jpg"')) {
      contentTypesXml = contentTypesXml.replace('</Types>',
        `<Default Extension="jpeg" ContentType="image/jpeg"/>\n<Default Extension="jpg" ContentType="image/jpeg"/>\n</Types>`);
    }

    for (const img of stampImages) {
      const relId = `rIdStamp${uniqueId}`;
      const b64 = img.data.includes(',') ? img.data.split(',')[1] : img.data;
      const imgBuffer = Buffer.from(b64, 'base64');

      
      let ext = 'png';
      if (b64.substring(0, 4) === '/9j/') ext = 'jpeg';
      else if (b64.substring(0, 4) === 'Qk') ext = 'bmp';

      const mediaFile = `word/media/stamp_${uniqueId}.${ext}`;
      const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';

      zip.file(mediaFile, imgBuffer);

      
      relsXml = relsXml.replace('</Relationships>',
        `<Relationship Id="${relId}" Type="${relType}" Target="media/stamp_${uniqueId}.${ext}"/>\n</Relationships>`);

      drawingXmlParts.push(buildImageAnchorXml(img, relId, uniqueId));
      uniqueId++;
    }

    
    
    const drawingsRuns = drawingXmlParts.map(d => `<w:r>${d}</w:r>`).join('');
    const drawingsParagraph = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr>${drawingsRuns}</w:p>`;
    docXml = docXml.replace('<w:body>', `<w:body>${drawingsParagraph}`);
  }

  
  if (hasBorder) {
    const styleMap = { single: 'single', double: 'double', thick: 'thick', dotted: 'dotted', dashed: 'dashed', shadow: 'threeDEmboss' };
    const bStyle = styleMap[dc.borderStyle] || 'single';
    const bColor = (dc.borderColor || '#000000').replace('#', '');
    const bSize = dc.borderStyle === 'thick' ? (dc.borderWidth || 1) * 8 : 4;

    const borderXml = `<w:pgBorders w:offsetFrom="page">
  <w:top w:val="${bStyle}" w:sz="${bSize}" w:space="24" w:color="${bColor}"/>
  <w:left w:val="${bStyle}" w:sz="${bSize}" w:space="24" w:color="${bColor}"/>
  <w:bottom w:val="${bStyle}" w:sz="${bSize}" w:space="24" w:color="${bColor}"/>
  <w:right w:val="${bStyle}" w:sz="${bSize}" w:space="24" w:color="${bColor}"/>
</w:pgBorders>`;

    if (!docXml.includes('<w:pgBorders')) {
      docXml = docXml.replace(/<w:sectPr([^>]*)>/, `<w:sectPr$1>${borderXml}`);
    }
  }

  
  if (hasMargins) {
    const m = dc.margins;
    const marginOverride = `<w:pgMar w:top="${m.top || 1440}" w:right="${m.right || 1440}" w:bottom="${m.bottom || 1440}" w:left="${m.left || 1440}" w:header="720" w:footer="720" w:gutter="0"/>`;
    
    if (docXml.includes('<w:pgMar')) {
      docXml = docXml.replace(/<w:pgMar[^\/]*\/>/g, marginOverride);
    } else {
      docXml = docXml.replace(/<w:sectPr([^>]*)>/, `<w:sectPr$1>${marginOverride}`);
    }
  }

  
  
  
  
  
  
  
  

  const hasFontFamily    = !!(dc.fontFamily && dc.fontFamily.trim());
  const hasFontSize      = !!(dc.fontSize && Number(dc.fontSize) > 0);
  const hasHeadingSize   = !!(dc.headingSize && Number(dc.headingSize) > 0);
  const hasLineSpacing   = !!(dc.lineSpacing && Number(dc.lineSpacing) > 0);
  const hasBodyAlign     = !!(dc.bodyAlignment && dc.bodyAlignment !== 'none');
  const hasTitleStyle    = !!(dc.titleBold || dc.titleUnderline || dc.titleItalic ||
                              (dc.titleAlignment && dc.titleAlignment !== 'none') ||
                              hasHeadingSize);
  const hasParagraphSpacing = !!(dc.paragraphSpacing &&
                                 (Number(dc.paragraphSpacing.before) > 0 ||
                                  Number(dc.paragraphSpacing.after)  > 0));
  const hasFirstLineIndent  = !!(dc.firstLineIndent && Number(dc.firstLineIndent) > 0);
  const hasTextTransform    = !!(dc.textTransform && dc.textTransform !== 'none');
  const hasLetterSpacing    = !!(dc.letterSpacing && Number(dc.letterSpacing) !== 0);
  const hasPrimaryColor     = !!(dc.colorScheme?.primary && dc.colorScheme.primary !== '#000000');

  const needsTypography = hasFontFamily || hasFontSize || hasHeadingSize || hasLineSpacing ||
    hasBodyAlign || hasTitleStyle || hasParagraphSpacing || hasFirstLineIndent ||
    hasTextTransform || hasLetterSpacing || hasPrimaryColor;

  if (needsTypography) {
    const alignMap = { left: 'left', center: 'center', right: 'right', justified: 'both', justify: 'both' };

    
    
    const upsertInRpr = (rb, tag, xml) => {
      const tagOpen = tag.replace(':', '\\:');
      const existing = new RegExp(`<${tagOpen}\\s[^/]*/>`).test(rb) ||
                       new RegExp(`<${tagOpen}/>`).test(rb) ||
                       rb.includes(`<${tag} `) || rb.includes(`<${tag}/>`);
      if (existing) {
        return rb.replace(new RegExp(`<${tagOpen}(?:\\s[^/]*)?\\/>`), xml);
      }
      if (rb.includes('</w:rPr>')) {
        return rb.replace('</w:rPr>', `${xml}</w:rPr>`);
      }
      
      return rb.replace(/(<w:t)/, `<w:rPr>${xml}</w:rPr>$1`);
    };

    
    const prependInRpr = (rb, xml) => {
      if (rb.includes('<w:rPr>') || rb.includes('<w:rPr ')) {
        return rb.replace(/(<w:rPr(?:[ >][^]*?)?>)/, `$1${xml}`);
      }
      return rb.replace(/(<w:t)/, `<w:rPr>${xml}</w:rPr>$1`);
    };

    docXml = docXml.replace(/<w:p([ >][^]*?<\/w:p>)/g, (fullMatch, rest) => {
      
      const styleMatch    = rest.match(/<w:pStyle w:val="([^"]+)"/);
      const pStyleVal     = styleMatch ? styleMatch[1].toLowerCase() : '';
      const isWordHeading = /^heading\d*$|^title$|^subtitle$/.test(pStyleVal);

      
      
      
      
      
      
      const paraText = (rest.match(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g) || [])
        .map(t => t.replace(/<[^>]+>/g, '')).join('').trim();
      const isAllCaps    = paraText.length >= 20 && paraText.length <= 120 &&
                           /^[A-Z\s\d.:\-'\u2019\u2018'\/()&,;]+$/.test(paraText);
      const isLegalTitle = isAllCaps;
      const isHeading    = isWordHeading || isLegalTitle;

      

      
      if (!isHeading && hasBodyAlign) {
        const jcVal = alignMap[dc.bodyAlignment] || 'both';
        const currentAlignMatch = rest.match(/<w:jc w:val="([^"]+)"/);
        const currentAlign = currentAlignMatch ? currentAlignMatch[1] : null;
        if (currentAlign === null) {
          if (rest.includes('<w:pPr>') || rest.includes('<w:pPr ')) {
            rest = rest.replace(/(<w:pPr(?:[ >][^]*?)?>)/, `$1<w:jc w:val="${jcVal}"/>`);
          }
        } else if (currentAlign === 'both') {
          rest = rest.replace(/<w:jc w:val="both"\s*\/>/, `<w:jc w:val="${jcVal}"/>`);
        }
        
      }
      if (isHeading && hasTitleStyle && dc.titleAlignment && dc.titleAlignment !== 'none') {
        const tAlignVal = alignMap[dc.titleAlignment] || 'center';
        if (rest.includes('<w:jc ')) {
          rest = rest.replace(/<w:jc w:val="[^"]*"\s*\/>/, `<w:jc w:val="${tAlignVal}"/>`);
        } else if (rest.includes('<w:pPr>') || rest.includes('<w:pPr ')) {
          rest = rest.replace(/(<w:pPr(?:[ >][^]*?)?>)/, `$1<w:jc w:val="${tAlignVal}"/>`);
        }
      }

      
      if (hasLineSpacing || hasParagraphSpacing) {
        const lineVal  = hasLineSpacing
          ? Math.round(Math.min(Number(dc.lineSpacing), 3.0) * 240) : null;
        const beforePt = hasParagraphSpacing ? Number(dc.paragraphSpacing.before || 0) : null;
        const afterPt  = hasParagraphSpacing ? Number(dc.paragraphSpacing.after  || 0) : null;
        
        const beforeTwips = beforePt != null ? Math.round(beforePt * 20) : null;
        const afterTwips  = afterPt  != null ? Math.round(afterPt  * 20) : null;

        if (rest.includes('<w:spacing ')) {
          rest = rest.replace(/<w:spacing ([^\/]*)\/>/, (_, attrs) => {
            let a = attrs
              .replace(/w:line="[^"]*"\s*/g, '')
              .replace(/w:lineRule="[^"]*"\s*/g, '');
            if (beforeTwips != null) a = a.replace(/w:before="[^"]*"\s*/g, '');
            if (afterTwips  != null) a = a.replace(/w:after="[^"]*"\s*/g,  '');
            a = a.trim();
            if (lineVal    != null) a += ` w:line="${lineVal}" w:lineRule="auto"`;
            if (beforeTwips != null) a += ` w:before="${beforeTwips}"`;
            if (afterTwips  != null) a += ` w:after="${afterTwips}"`;
            return `<w:spacing ${a.trim()}/>`;
          });
        } else if (rest.includes('<w:pPr>') || rest.includes('<w:pPr ')) {
          let spacingAttrs = '';
          if (lineVal    != null) spacingAttrs += ` w:line="${lineVal}" w:lineRule="auto"`;
          if (beforeTwips != null) spacingAttrs += ` w:before="${beforeTwips}"`;
          if (afterTwips  != null) spacingAttrs += ` w:after="${afterTwips}"`;
          rest = rest.replace(/(<w:pPr(?:[ >][^]*?)?>)/, `$1<w:spacing${spacingAttrs}/>`);
        }
      }

      
      if (!isHeading && hasFirstLineIndent) {
        const indTwips = Math.round(Number(dc.firstLineIndent));
        if (rest.includes('<w:ind ')) {
          rest = rest.replace(/<w:ind ([^\/]*)\/>/, (_, attrs) => {
            const a = attrs.replace(/w:firstLine="[^"]*"\s*/g, '').trim();
            return `<w:ind ${a} w:firstLine="${indTwips}"/>`;
          });
        } else if (rest.includes('<w:pPr>') || rest.includes('<w:pPr ')) {
          rest = rest.replace(/(<w:pPr(?:[ >][^]*?)?>)/, `$1<w:ind w:firstLine="${indTwips}"/>`);
        }
      }

      
      
      
      rest = rest.replace(/<w:r([ >])([\s\S]*?)<\/w:r>/g, (runMatch, rAttr, rb) => {

        
        if (hasFontFamily) {
          const fn = dc.fontFamily.trim();
          const fe = `<w:rFonts w:ascii="${fn}" w:hAnsi="${fn}" w:cs="${fn}"/>`;
          if (rb.includes('<w:rFonts ')) {
            rb = rb.replace(/<w:rFonts [^\/]*\/>/, fe);
          } else {
            rb = prependInRpr(rb, fe);
          }
        }

        
        
        
        
        
        const effectiveSizePt = (!isHeading && hasFontSize) ? Number(dc.fontSize) : null;

        if (effectiveSizePt != null) {
          const szVal = Math.round(effectiveSizePt * 2);
          const szE   = `<w:sz w:val="${szVal}"/>`;
          const szCsE = `<w:szCs w:val="${szVal}"/>`;
          if (rb.includes('<w:sz ') || rb.includes('<w:sz/>')) {
            rb = rb.replace(/<w:sz w:val="[^"]*"\s*\/>/, szE);
          } else {
            rb = upsertInRpr(rb, 'w:sz', szE);
          }
          if (rb.includes('<w:szCs ') || rb.includes('<w:szCs/>')) {
            rb = rb.replace(/<w:szCs w:val="[^"]*"\s*\/>/, szCsE);
          } else {
            rb = upsertInRpr(rb, 'w:szCs', szCsE);
          }
        }

        
        if (hasPrimaryColor && !isHeading) {
          const colorHex = dc.colorScheme.primary.replace('#', '');
          const colorE   = `<w:color w:val="${colorHex}"/>`;
          rb = upsertInRpr(rb, 'w:color', colorE);
        }

        
        if (hasLetterSpacing) {
          
          const lsVal = Math.round(Number(dc.letterSpacing) * 15);
          const lsE   = `<w:spacing w:val="${lsVal}"/>`;
          rb = upsertInRpr(rb, 'w:spacing', lsE);
        }

        
        if (hasTextTransform && !isHeading) {
          if (dc.textTransform === 'uppercase') {
            if (!rb.includes('<w:caps/>') && !rb.includes('<w:caps ')) {
              rb = prependInRpr(rb, '<w:caps/>');
            }
          } else if (dc.textTransform === 'lowercase') {
            
            rb = rb.replace(/<w:caps\/>/g, '').replace(/<w:caps\s[^/]*\/>/g, '');
          }
          
        }

        
        if (isHeading) {
          
          
          
          const runTextContent = (rb.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
            .map(t => t.replace(/<[^>]+>/g, '')).join('');
          const isWhitespaceRun = runTextContent.trim().length === 0 && runTextContent.length > 0;

          if (!isWhitespaceRun) {
            
            if (dc.titleBold) {
              if (!rb.includes('<w:b/>') && !rb.includes('<w:b ')) {
                rb = prependInRpr(rb, '<w:b/>');
              }
            } else if (dc.titleBold === false) {
              rb = rb.replace(/<w:b\/>/g, '').replace(/<w:b\s[^/]*\/>/g, '');
            }
            
            if (dc.titleUnderline) {
              if (!rb.includes('<w:u ')) {
                rb = prependInRpr(rb, '<w:u w:val="single"/>');
              }
            } else if (dc.titleUnderline === false) {
              rb = rb.replace(/<w:u [^>]*\/>/g, '');
            }
            
            if (dc.titleItalic) {
              if (!rb.includes('<w:i/>') && !rb.includes('<w:i ')) {
                rb = prependInRpr(rb, '<w:i/>');
              }
            } else if (dc.titleItalic === false) {
              rb = rb.replace(/<w:i\/>/g, '').replace(/<w:i\s[^/]*\/>/g, '');
            }
          } else {
            
            
            rb = rb.replace(/<w:u [^>]*\/>/g, '');
          }
        }

        return `<w:r${rAttr}${rb}</w:r>`;
      });

      return `<w:p${rest}`;
    });
  }

  zip.file('word/document.xml', docXml);
  zip.file('word/_rels/document.xml.rels', relsXml);
  if (contentTypesXml) zip.file('[Content_Types].xml', contentTypesXml);
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export default { renderTemplateDocx, fillUnderlineDocx, injectDesignToDocx };
