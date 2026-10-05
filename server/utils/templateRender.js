export function renderTemplateText(templateText, fields) {
  let out = String(templateText || '');
  
  for (const [key, val] of Object.entries(fields || {})) {
    if (Array.isArray(val)) {
      const numbered = val.map((v, i) => `${i + 1}. ${String(v)}`).join('\n');
      out = out.replaceAll(`{{${key}}}`, numbered);
    }
  }
  
  for (const [key, val] of Object.entries(fields || {})) {
    if (!Array.isArray(val)) {
      out = out.replaceAll(`{{${key}}}`, String(val ?? ''));
    }
  }
  return out;
}

export default { renderTemplateText };



