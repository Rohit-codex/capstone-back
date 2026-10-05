import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'utils', 'counterAffidavitExportHtml.js');
let src = fs.readFileSync(p, 'utf8');
const start = src.indexOf('export function buildCounterAffidavitExportHtml');
const end = src.indexOf('function docxStyles()', start);
if (start < 0 || end < 0) throw new Error('markers not found');
const replacement = `export function buildCounterAffidavitExportHtml(counterData, { language = 'en', court: courtOverride, designId } = {}) {
  const design = loadCounterAffidavitDesign(designId);
  const lang = language === 'hi' ? 'hi' : 'en';
  const L = design.labels?.[lang] || design.labels?.en || {};
  const layout = design.layout || {};

  let body = '';
  body += buildFirstPageCaption(counterData, courtOverride, design, L);
  body += appendStandardCounterSections(counterData, L, layout, 'html');

  const footerHtml =
    design.footer?.mode === 'draft_notice'
      ? (lang === 'hi' ? design.footer.hiHtml : design.footer.enHtml) || ''
      : '';

  if (footerHtml) {
    body += \`<div class="footer-draft">\${footerHtml}</div>\`;
  }

  const title = escapeHtml(L.counterAffidavitMain || 'Counter Affidavit');
  const css = design.css || '';

  return \`<!DOCTYPE html><html lang="\${lang}"><head><meta charset="utf-8"><title>\${title}</title>
<style>\${css}</style></head><body>\${body}</body></html>\`;
}

`;
src = src.slice(0, start) + replacement + src.slice(end);
src = src.replace(/(<\/)?motion\.div>`/g, '$1div>`');
fs.writeFileSync(p, src);
console.log('fixed export html');
