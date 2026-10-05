import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '..', 'utils', 'counterAffidavitExportHtml.js');
let src = fs.readFileSync(p, 'utf8');

const helpersPath = path.join(__dirname, '..', 'utils', 'counterAffidavitBodySections.js');
if (!fs.existsSync(helpersPath)) {
  fs.writeFileSync(helpersPath, `import { escapeHtml, verificationToParagraphs, listRespondentNames, docxStyles } from './counterAffidavitExportHtmlInternals.js';
// placeholder - will be inlined
`, 'utf8');
}

const helpers = `
function resolveDocumentTitle(counterData, L) {
  const explicit = String(counterData?.documentTitle || '').trim();
  if (explicit) return explicit;
  const respondents = listRespondentNames(counterData);
  const name = respondents[0] || '';
  if (name) return \`Counter Affidavit on behalf of \${name}\`;
  return L.documentTitleFallback || 'Counter Affidavit on behalf of the Respondent(s)';
}

function stanceLeadIn(item, L) {
  const petitionPara = item?.petitionParaNo ?? item?.paraNo ?? '';
  const stance = String(item?.stance || '').toLowerCase().replace(/\\s+/g, '_');
  const p = escapeHtml(String(petitionPara));
  if (stance === 'admit' || stance === 'admitted') {
    return \`That the contents of paragraph \${p} of the petition are \${escapeHtml(L.stanceAdmit || 'admitted').toLowerCase()}. \`;
  }
  if (stance === 'deny' || stance === 'denied') {
    return \`That the statements made in paragraph \${p} of the petition are vehemently \${escapeHtml(L.stanceDeny || 'denied').toLowerCase()}. \`;
  }
  if (stance === 'partly_admit' || stance === 'partly' || stance === 'partly_admitted') {
    return \`That paragraph \${p} of the petition is \${escapeHtml(L.stancePartly || 'partly admitted and partly denied').toLowerCase()}. \`;
  }
  return petitionPara ? \`In reply to paragraph \${p} of the petition: \` : '';
}

function normalizeAdditionalFacts(counterData) {
  if (Array.isArray(counterData.statementOfAdditionalFacts) && counterData.statementOfAdditionalFacts.length) {
    return counterData.statementOfAdditionalFacts.map((x) => String(x || '').trim()).filter(Boolean);
  }
  if (Array.isArray(counterData.statementOfFacts) && counterData.statementOfFacts.length) {
    return counterData.statementOfFacts.map((x) => String(x || '').trim()).filter(Boolean);
  }
  return [];
}

function appendStandardCounterSections(counterData, L, layout, format = 'html') {
  let body = '';
  const replyTitle =
    layout.replySectionVariant === 'para_wise'
      ? (L.paraWiseReply || 'PARA-WISE REPLY')
      : (L.replyOnMerits || 'REPLY ON MERITS');
  const docTitle = resolveDocumentTitle(counterData, L);
  const s = docxStyles();

  if (format === 'html') {
    body += \`<h1 class="main-title">\${escapeHtml(L.counterAffidavitMain || 'COUNTER AFFIDAVIT')}</h1>\`;
    body += \`<motion.div class="subheading">\${escapeHtml(docTitle)}</div>\`;
  } else {
    body += \`<p style="\${s.heading}; margin:8px 0 6px 0;">\${escapeHtml(L.counterAffidavitMain || 'COUNTER AFFIDAVIT')}</p>\`;
    body += \`<p style="\${s.center}; font-weight:700; margin:0 0 12px 0;">\${escapeHtml(docTitle)}</p>\`;
  }

  const deponent = String(counterData.deponentDetails || '').trim();
  if (deponent) {
    const heading = escapeHtml(L.deponentDetails || 'DETAILS OF THE DEPONENT');
    if (format === 'html') {
      body += \`<h2 class="section">\${heading}</h2><div class="verification-block">\${verificationToParagraphs(deponent)}</div>\`;
    } else {
      body += \`<p style="\${s.section}">\${heading}</p><motion.div style="text-align:justify;">\${verificationToParagraphs(deponent)}</div>\`;
    }
  } else if (format === 'html') {
    body += \`<p class="deponent-intro">\${escapeHtml(L.deponentPlaceholder || '')}</p>\`;
  } else {
    body += \`<p style="margin:8px 0 12px 0; text-align:justify;">\${escapeHtml(L.deponentPlaceholder || '')}</p>\`;
  }

  if (counterData.preliminaryObjections?.length) {
    const heading = escapeHtml(L.preliminaryObjections || 'PRELIMINARY OBJECTIONS');
    if (format === 'html') {
      body += \`<h2 class="section">\${heading}</h2><ol class="obj">\`;
      counterData.preliminaryObjections.forEach((obj) => { body += \`<li>\${escapeHtml(obj)}</li>\`; });
      body += '</ol>';
    } else {
      body += \`<p style="\${s.section}">\${heading}</p><ol style="margin:0 0 10px 20px; padding:0;">\`;
      counterData.preliminaryObjections.forEach((obj) => {
        body += \`<li style="margin:0 0 6px 0; text-align:justify;">\${escapeHtml(obj)}</li>\`;
      });
      body += '</ol>';
    }
  }

  body += format === 'html'
    ? \`<h2 class="section">\${escapeHtml(replyTitle)}</h2>\`
    : \`<p style="\${s.section}">\${escapeHtml(replyTitle)}</p>\`;

  if (counterData.counterDraft?.length) {
    counterData.counterDraft.forEach((item) => {
      const lead = stanceLeadIn(item, L);
      const arg = escapeHtml(item.counterArgument || '');
      const label = item.petitionParaNo ?? item.paraNo;
      if (format === 'html') {
        const law = item.supportingLaw ? \` <span class="support-law">(\${escapeHtml(item.supportingLaw)})</span>\` : '';
        body += \`<div class="para"><span class="para-num">\${escapeHtml(L.paraLabel || 'Para')} \${escapeHtml(label)}:</span> \${lead}\${arg}\${law}</div>\`;
      } else {
        const law = item.supportingLaw ? \` <em>(\${escapeHtml(item.supportingLaw)})</em>\` : '';
        body += \`<p style="margin:0 0 8px 0; text-align:justify;"><strong>\${escapeHtml(L.paraLabel || 'Para')} \${escapeHtml(label)}:</strong> \${lead}\${arg}\${law}</p>\`;
      }
    });
  }

  const additional = normalizeAdditionalFacts(counterData);
  if (additional.length) {
    const heading = escapeHtml(L.statementOfAdditionalFacts || 'STATEMENT OF ADDITIONAL FACTS');
    if (format === 'html') {
      body += \`<h2 class="section">\${heading}</h2><ol class="sof">\`;
      additional.forEach((fact) => { body += \`<li>\${escapeHtml(fact)}</li>\`; });
      body += '</ol>';
    } else {
      body += \`<p style="\${s.section}">\${heading}</p><ol style="margin:0 0 10px 20px; padding:0;">\`;
      additional.forEach((fact) => {
        body += \`<li style="margin:0 0 6px 0; text-align:justify;">\${escapeHtml(fact)}</li>\`;
      });
      body += '</ol>';
    }
  }

  if (counterData.prayer) {
    const heading = escapeHtml(L.prayer || 'PRAYER');
    if (format === 'html') {
      body += \`<h2 class="section">\${heading}</h2><div class="para">\${escapeHtml(counterData.prayer)}</div>\`;
    } else {
      body += \`<p style="\${s.section}">\${heading}</p><p style="margin:0 0 10px 0; text-align:justify;">\${escapeHtml(counterData.prayer)}</p>\`;
    }
  }

  if (counterData.verification) {
    const heading = escapeHtml(L.verification || 'VERIFICATION');
    if (format === 'html') {
      body += \`<h2 class="section">\${heading}</h2><div class="verification-block">\${verificationToParagraphs(counterData.verification)}</div>\`;
    } else {
      body += \`<p style="\${s.section}">\${heading}</p><div style="text-align:justify;">\${verificationToParagraphs(counterData.verification)}</div>\`;
    }
  }

  if (format === 'html') {
    body += \`<p class="place-date">\${escapeHtml(L.verifiedAt || '')}</p>\`;
    body += '<div class="sig-block">';
    body += \`<div class="sig-line">\${escapeHtml(L.deponentSignature || 'Deponent')}</motion.div>\`;
    body += '</div>';
    body += \`<div class="advocate"><strong>\${escapeHtml(L.advocateBlock || '')}</strong></div>\`;
  } else {
    body += \`<p style="margin:16px 0 0 0; text-align:justify;">\${escapeHtml(L.verifiedAt || '')}</p>\`;
    body += \`<p style="margin:26px 0 0 0; text-align:right;"><strong>\${escapeHtml(L.deponentSignature || 'Deponent')}</strong></p>\`;
    body += \`<p style="margin:20px 0 0 0;"><strong>\${escapeHtml(L.advocateBlock || '')}</strong></p>\`;
  }

  return body;
}
`;

if (!src.includes('function appendStandardCounterSections')) {
  const marker = '/**\n * Builds HTML/PDF source for counter affidavit export';
  const idx = src.indexOf(marker);
  if (idx < 0) throw new Error('marker missing');
  src = `${src.slice(0, idx)}${helpers}\n${src.slice(idx)}`;
}

const exportRe = /body \+= buildFirstPageCaption\(counterData, courtOverride, design, L\);[\s\S]*?const footerHtml =\s*\n\s*design\.footer/;
if (exportRe.test(src) && !src.includes("appendStandardCounterSections(counterData, L, layout, 'html')")) {
  src = src.replace(
    exportRe,
    `body += buildFirstPageCaption(counterData, courtOverride, design, L);\n  body += appendStandardCounterSections(counterData, L, layout, 'html');\n\n  const footerHtml =\n    design.footer`
  );
}

const docxRe = /export function buildCounterAffidavitDocxHtml[\s\S]*?body \+= buildDocxCaption\(counterData, courtOverride, design, L\);[\s\S]*?body \+= '<\/motion.div>';/;
if (docxRe.test(src) && !src.includes("appendStandardCounterSections(counterData, L, layout, 'docx')")) {
  src = src.replace(
    /(export function buildCounterAffidavitDocxHtml[\s\S]*?body \+= buildDocxCaption\(counterData, courtOverride, design, L\);)[\s\S]*?(body \+= '<\/div>';\s*\n\s*return `<!DOCTYPE html>)/,
    `$1\n  body += appendStandardCounterSections(counterData, L, layout, 'docx');\n  $2`
  );
}

// Fix typos from helpers template
src = src.replace(/<motion\.motion\.div/g, '<div');
src = src.replace(/<motion\.div\b([^>]*)>/g, '<div$1>');
src = src.replace(/<\/motion\.div>/g, '</div>');

fs.writeFileSync(p, src);
console.log('done', src.includes('appendStandardCounterSections'));
