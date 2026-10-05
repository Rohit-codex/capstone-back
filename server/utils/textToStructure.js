

function similarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > Math.max(la, lb) * 0.6) return 0;

  const dp = Array.from({ length: lb + 1 }, (_, i) => i);
  for (let i = 1; i <= la; i++) {
    let prev = i;
    for (let j = 1; j <= lb; j++) {
      const curr = a[i - 1] === b[j - 1]
        ? dp[j - 1]
        : 1 + Math.min(prev, dp[j], dp[j - 1]);
      dp[j - 1] = prev;
      prev = curr;
    }
    dp[lb] = prev;
  }
  const dist = dp[lb];
  return 1 - dist / Math.max(la, lb);
}


function clonePara(para) {
  return JSON.parse(JSON.stringify(para));
}


function defaultPara(text, template) {
  return {
    fullText: text,
    style: template?.style || 'Normal',
    alignment: template?.alignment || 'justified',
    spacing: { ...(template?.spacing || { before: 0, after: 100 }) },
    indent: { ...(template?.indent || { left: 0, right: 0, firstLine: 0, hanging: 0 }) },
    listInfo: null,
    paraRunProps: { ...(template?.paraRunProps || {}) },
    runs: [{ text, bold: false, italic: false, underline: false, strikethrough: false, color: null, size: template?.runs?.[0]?.size || 24, font: template?.runs?.[0]?.font || null }],
    isEmpty: text.trim() === '',
    isHeading: false,
    headingLevel: null,
  };
}



export function mergeEditedTextIntoStructure(originalStructure, editedText) {
  const origParas = originalStructure.paragraphs || [];
  const editedLines = editedText
    .split('\n')
    .map(l => l.trim());

  if (origParas.length === 0) {
    
    return {
      ...originalStructure,
      paragraphs: editedLines.map(line => defaultPara(line, null)),
      plainText: editedText,
    };
  }

  
  const origNonEmpty = origParas.filter(p => !p.isEmpty);

  
  const result = [];
  let origCursor = 0;

  for (let i = 0; i < editedLines.length; i++) {
    const line = editedLines[i];

    if (!line) {
      
      const nearestEmpty = origParas.find(p => p.isEmpty) || origParas[0];
      const blank = clonePara(nearestEmpty);
      blank.fullText = '';
      blank.runs = [];
      blank.isEmpty = true;
      result.push(blank);
      continue;
    }

    
    let bestIdx = -1;
    let bestScore = 0;
    const searchWindow = Math.min(origCursor + 8, origNonEmpty.length);
    for (let j = origCursor; j < searchWindow; j++) {
      const score = similarity(line.toLowerCase(), origNonEmpty[j].fullText.toLowerCase());
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    if (bestScore > 0.55 && bestIdx !== -1) {
      
      const matched = clonePara(origNonEmpty[bestIdx]);
      matched.fullText = line;

      
      if (matched.runs.length === 1) {
        matched.runs[0].text = line;
      } else if (matched.runs.length > 1) {
        
        
        const firstRun = { ...matched.runs[0], text: line };
        matched.runs = [firstRun];
      } else {
        matched.runs = [{ text: line, bold: matched.isHeading, italic: false, underline: false, size: null, font: null }];
      }
      matched.isEmpty = false;
      result.push(matched);
      origCursor = bestIdx + 1;
    } else {
      
      const templatePara = result.length > 0 ? result[result.length - 1] : origParas[0];
      result.push(defaultPara(line, templatePara));
    }
  }

  return {
    ...originalStructure,
    paragraphs: result,
    plainText: editedText,
    metadata: {
      ...originalStructure.metadata,
      mergedAt: new Date().toISOString(),
      editedParagraphCount: result.length,
    },
  };
}

export default { mergeEditedTextIntoStructure };
