function escapeHtml(s) {
  if (s == null || s === '') return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapBlankUnderscores(escapedFragment) {
  return String(escapedFragment || '').replace(/_{3,}/g, (m) =>
    `<span class="counter-blank" aria-label="blank field">${m}</span>`
  );
}

function verificationToParagraphs(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${wrapBlankUnderscores(escapeHtml(p))}</p>`)
    .join('');
}

function listRespondentNames(cd) {
  if (Array.isArray(cd.respondentNames) && cd.respondentNames.length) {
    return cd.respondentNames.map((x) => String(x).trim()).filter(Boolean);
  }
  const r = String(cd.respondentName || '').trim();
  if (!r) return [];
  const parts = r.split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean);
  return parts.length > 1 ? parts : [r];
}

function docxStyles() {
  return {
    body: 'font-family:Times New Roman, serif; font-size:14px; line-height:1.5; color:#000;',
    center: 'text-align:center;',
    heading: 'font-weight:700; text-transform:uppercase; text-align:center;',
    section: 'font-weight:700; text-transform:uppercase; text-decoration:underline; margin:18px 0 8px 0;',
  };
}

function docxSectionHeading(layout, headingHtml) {
  if (layout.simpleWordMode) {
    return `<p style="font-weight:bold; margin:14px 0 8px 0;">${headingHtml}</p>`;
  }
  return `<p style="${docxStyles().section}">${headingHtml}</p>`;
}

function resolveDocumentTitle(counterData, L) {
  const explicit = String(counterData?.documentTitle || '').trim();
  if (explicit) return explicit;
  const respondents = listRespondentNames(counterData);
  const name = respondents[0] || '';
  if (name) return `Counter Affidavit on behalf of ${name}`;
  return L.documentTitleFallback || 'Counter Affidavit on behalf of the Respondent(s)';
}

function stanceLeadIn(item, L, counterData = {}) {
  const petitionPara = item?.petitionParaNo ?? item?.paraNo ?? '';
  const stance = String(item?.stance || '').toLowerCase().replace(/\s+/g, '_');
  const p = escapeHtml(String(petitionPara));
  const doc = String(counterData?.sourceDocumentType || counterData?.procedureKind || '');
  const isMjc = counterData?.procedureKind === 'mjc_show_cause'
    || /\bmjc\b|show\s*cause|miscellaneous\s*jurisdiction/i.test(doc);
  const docPhrase = isMjc ? 'the show cause / matter' : 'the writ petition';
  if (stance === 'admit' || stance === 'admitted') {
    return `That the contents of paragraph ${p} of ${docPhrase} are ${escapeHtml(L.stanceAdmit || 'admitted').toLowerCase()}. `;
  }
  if (stance === 'deny' || stance === 'denied') {
    return `That the statements made in paragraph ${p} of ${docPhrase} are ${escapeHtml(L.stanceDeny || 'denied').toLowerCase()}. `;
  }
  if (stance === 'partly_admit' || stance === 'partly' || stance === 'partly_admitted') {
    return `That paragraph ${p} of ${docPhrase} is ${escapeHtml(L.stancePartly || 'partly admitted and partly denied').toLowerCase()}. `;
  }
  return petitionPara ? `In reply to paragraph ${p} of ${docPhrase}: ` : '';
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

export function normalizeDefenceSection(counterData) {
  if (Array.isArray(counterData?.defenceSection) && counterData.defenceSection.length) {
    return counterData.defenceSection.map((x) => String(x || '').trim()).filter(Boolean);
  }
  const single = String(counterData?.defenceSection || counterData?.defence || '').trim();
  if (!single) return [];
  return single
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function appendIntroductoryParagraphs(body, counterData, format, paraCounter, numbered) {
  const intro = Array.isArray(counterData?.introductoryParagraphs) ? counterData.introductoryParagraphs : [];
  if (!intro.length) return body;

  if (numbered) {
    intro.forEach((para, idx) => {
      body = appendNumberedItem(body, para, format, paraCounter, format === 'html' ? ` data-edit-section="introductoryParagraphs" data-edit-index="${idx}" style="cursor:pointer;"` : '');
    });
  } else if (format === 'html') {
    intro.forEach((para, idx) => {
      body += `<p class="body-para" data-edit-section="introductoryParagraphs" data-edit-index="${idx}" style="cursor:pointer;">${wrapBlankUnderscores(escapeHtml(para))}</p>`;
    });
  } else {
    intro.forEach((para) => {
      body += `<p style="margin:0 0 10px 0; text-align:justify;">${escapeHtml(para)}</p>`;
    });
  }
  return body;
}

function appendDefenceSection(body, counterData, L, layout, format, paraCounter) {
  const paragraphs = normalizeDefenceSection(counterData);
  if (!paragraphs.length) return body;

  const numbered = layout.numberedBodyParagraphs === true;

  if (layout.showSectionHeadings) {
    const heading = escapeHtml(L.defenceSection || L.defence || 'DEFENCE');
    if (format === 'html') {
      body += `<h2 class="section">${heading}</h2>`;
    } else {
      body += docxSectionHeading(layout, heading);
    }
  }

  if (numbered) {
    paragraphs.forEach((para, idx) => {
      body = appendNumberedItem(body, para, format, paraCounter, format === 'html' ? ` data-edit-section="defenceSection" data-edit-index="${idx}" style="cursor:pointer;"` : '');
    });
  } else if (format === 'html') {
    paragraphs.forEach((para, idx) => {
      body += `<p class="body-para" data-edit-section="defenceSection" data-edit-index="${idx}" style="cursor:pointer;">${wrapBlankUnderscores(escapeHtml(para))}</p>`;
    });
  } else {
    paragraphs.forEach((para) => {
      body += `<p style="margin:0 0 10px 0; text-align:justify;">${escapeHtml(para)}</p>`;
    });
  }
  return body;
}

function appendStatementOfFacts(body, counterData, L, layout, format, paraCounter) {
  const additional = normalizeAdditionalFacts(counterData);
  if (!additional.length) return body;

  const numbered = layout.numberedBodyParagraphs === true;

  if (layout.showSectionHeadings) {
    const heading = escapeHtml(L.statementOfFacts || 'STATEMENT OF FACTS');
    if (format === 'html') {
      body += `<h2 class="section">${heading}</h2>`;
    } else {
      body += docxSectionHeading(layout, heading);
    }
  }

  if (numbered) {
    additional.forEach((fact, idx) => {
      body = appendNumberedItem(body, fact, format, paraCounter, format === 'html' ? ` data-edit-section="statementOfAdditionalFacts" data-edit-index="${idx}" style="cursor:pointer;"` : '');
    });
  } else if (format === 'html') {
    additional.forEach((fact, idx) => {
      body += `<p class="body-para" data-edit-section="statementOfAdditionalFacts" data-edit-index="${idx}" style="cursor:pointer;">${wrapBlankUnderscores(escapeHtml(fact))}</p>`;
    });
  } else {
    additional.forEach((fact) => {
      body += `<p style="margin:0 0 10px 0; text-align:justify;">${escapeHtml(fact)}</p>`;
    });
  }
  return body;
}

function appendClosingParagraphs(body, counterData, format, paraCounter, numbered) {
  const closing = Array.isArray(counterData?.closingParagraphs) ? counterData.closingParagraphs : [];
  if (!closing.length) return body;

  if (numbered) {
    closing.forEach((para, idx) => {
      body = appendNumberedItem(body, para, format, paraCounter, format === 'html' ? ` data-edit-section="closingParagraphs" data-edit-index="${idx}" style="cursor:pointer;"` : '');
    });
  } else if (format === 'html') {
    closing.forEach((para, idx) => {
      body += `<p class="body-para" data-edit-section="closingParagraphs" data-edit-index="${idx}" style="cursor:pointer;">${wrapBlankUnderscores(escapeHtml(para))}</p>`;
    });
  } else {
    closing.forEach((para) => {
      body += `<p style="margin:0 0 10px 0; text-align:justify;">${escapeHtml(para)}</p>`;
    });
  }
  return body;
}

function appendTitleBlock(body, counterData, L, layout, format) {
  const s = docxStyles();
  const main = escapeHtml(L.counterAffidavitMain || 'COUNTER AFFIDAVIT');
  const docTitle = escapeHtml(resolveDocumentTitle(counterData, L));

  if (format === 'html') {
    body += `<h1 class="main-title" data-edit-field="documentTitle" style="cursor:pointer; page-break-before: always;">${docTitle}</h1>`;
  } else if (layout.simpleWordMode) {
    body += `<p style="font-weight:bold; font-size:14pt; margin:12px 0 10px 0; text-align:center;">${docTitle}</p>`;
  } else {
    body += `<p style="${s.heading}; margin:12px 0 6px 0;">${docTitle}</p>`;
  }
  return body;
}

function appendDeponentBlock(body, counterData, L, layout, format) {
  const s = docxStyles();
  const deponent = String(counterData.deponentDetails || '').trim();
  const openingStyle = layout.deponentStyle === 'section' ? 'section' : 'opening_paragraph';
  const showHeading = layout.showDeponentSectionHeading === true;

  if (deponent) {
    if (openingStyle === 'opening_paragraph') {
      const inner = verificationToParagraphs(deponent);
      if (format === 'html') {
        body += `<div class="deponent-opening" data-edit-field="deponentDetails" style="cursor:pointer;">${inner}</div>`;
      } else {
        body += `<div style="margin:10px 0 14px 0; text-align:justify;">${inner}</div>`;
      }
    } else {
      const heading = escapeHtml(L.deponentDetails || 'DETAILS OF THE DEPONENT');
      if (format === 'html') {
        body += showHeading ? `<h2 class="section">${heading}</h2>` : '';
        body += `<div class="verification-block" data-edit-field="deponentDetails" style="cursor:pointer;">${verificationToParagraphs(deponent)}</div>`;
      } else {
        if (showHeading) body += `<p style="${s.section}">${heading}</p>`;
        body += `<div style="text-align:justify;">${verificationToParagraphs(deponent)}</div>`;
      }
    }
  } else if (format === 'html') {
    body += `<p class="deponent-intro">${escapeHtml(L.deponentPlaceholder || '')}</p>`;
  } else {
    body += `<p style="margin:8px 0 12px 0; text-align:justify;">${escapeHtml(L.deponentPlaceholder || '')}</p>`;
  }
  return body;
}

function appendNumberedItem(body, text, format, counter, editAttrs = '') {
  const n = counter.value++;
  if (format === 'html') {
    body += `<p class="body-para"${editAttrs}><span class="body-para-num">${n}.</span> ${escapeHtml(text)}</p>`;
  } else {
    body += `<p style="margin:0 0 8px 0; text-align:justify;"><strong>${n}.</strong> ${escapeHtml(text)}</p>`;
  }
  return body;
}

/** Sections 2–7 after cause title (section 1 = caption in export HTML). */
export function appendStandardCounterSections(counterData, L, layout, format = 'html', _ctx = null) {
  const ctx = _ctx || counterData;
  let body = '';
  const replyTitle =
    layout.replySectionVariant === 'para_wise'
      ? (L.paraWiseReply || 'PARA-WISE REPLY')
      : (L.replyOnMerits || 'REPLY ON MERITS');
  const s = docxStyles();
  const numbered = layout.numberedBodyParagraphs === true;
  const paraCounter = { value: 1 };
  const useReplyTable = layout.paraWiseReplyTable === true && layout.replySectionVariant === 'para_wise';
  const showStanceCol = layout.paraWiseReplyShowStance === true;

  body = appendTitleBlock(body, counterData, L, layout, format);
  body = appendDeponentBlock(body, counterData, L, layout, format);
  body = appendIntroductoryParagraphs(body, counterData, format, paraCounter, numbered);
  body = appendStatementOfFacts(body, counterData, L, layout, format, paraCounter);
  body = appendDefenceSection(body, counterData, L, layout, format, paraCounter);

  if (counterData.preliminaryObjections?.length) {
    if (layout.showSectionHeadings) {
      const heading = escapeHtml(L.preliminaryObjections || 'PRELIMINARY OBJECTIONS');
      if (format === 'html') {
        body += `<h2 class="section">${heading}</h2>`;
      } else {
        body += docxSectionHeading(layout, heading);
      }
    }
    if (numbered) {
      counterData.preliminaryObjections.forEach((obj, idx) => {
        body = appendNumberedItem(body, obj, format, paraCounter, format === 'html' ? ` data-edit-section="preliminaryObjections" data-edit-index="${idx}" style="cursor:pointer;"` : '');
      });
    } else if (format === 'html') {
      body += '<ol class="obj">';
      counterData.preliminaryObjections.forEach((obj, idx) => { body += `<li data-edit-section="preliminaryObjections" data-edit-index="${idx}" style="cursor:pointer;">${escapeHtml(obj)}</li>`; });
      body += '</ol>';
    } else {
      body += '<ol style="margin:0 0 10px 20px; padding:0;">';
      counterData.preliminaryObjections.forEach((obj) => {
        body += `<li style="margin:0 0 6px 0; text-align:justify;">${escapeHtml(obj)}</li>`;
      });
      body += '</ol>';
    }
  }

  if (counterData.counterDraft?.length && counterData.includeParaWiseReply && layout.showSectionHeadings) {
    if (format === 'html') {
      body += `<h2 class="section">${escapeHtml(replyTitle)}</h2>`;
    } else {
      body += docxSectionHeading(layout, escapeHtml(replyTitle));
    }
  }

  if (counterData.counterDraft?.length && counterData.includeParaWiseReply) {
    if (useReplyTable && format === 'html') {
      const stanceTh = showStanceCol
        ? `<th>${escapeHtml(L.stanceColumn || 'Stance')}</th>`
        : '';
      body += `<table class="reply-table"><thead><tr><th>${escapeHtml(L.paraLabel || 'Para')}</th>${stanceTh}<th>${escapeHtml(L.replyColumn || 'Reply')}</th></tr></thead><tbody>`;
      counterData.counterDraft.forEach((item, idx) => {
        const lead = stanceLeadIn(item, L, ctx);
        const arg = escapeHtml(item.counterArgument || '');
        const law = item.supportingLaw ? ` <span class="support-law">(${escapeHtml(item.supportingLaw)})</span>` : '';
        const label = item.petitionParaNo ?? item.paraNo ?? '—';
        const stance = String(item.stance || '').replace(/_/g, ' ') || '—';
        const stanceTd = showStanceCol
          ? `<td class="reply-stance">${escapeHtml(stance)}</td>`
          : '';
        body += `<tr data-edit-section="counterDraft" data-edit-index="${idx}" style="cursor:pointer;"><td class="reply-para">${escapeHtml(label)}</td>${stanceTd}<td class="reply-text">${lead}${arg}${law}</td></tr>`;
      });
      body += '</tbody></table>';
    } else if (useReplyTable && format === 'docx') {
      const stanceTh = showStanceCol
        ? `<th style="width:14%; text-align:center;">${escapeHtml(L.stanceColumn || 'Stance')}</th>`
        : '';
      body += '<table style="width:100%; border-collapse:collapse; margin:8px 0 14px 0;" border="1" cellpadding="6">';
      body += `<tr><th style="width:10%; text-align:center;">${escapeHtml(L.paraLabel || 'Para')}</th>${stanceTh}<th>${escapeHtml(L.replyColumn || 'Reply')}</th></tr>`;
      counterData.counterDraft.forEach((item) => {
        const lead = stanceLeadIn(item, L, ctx);
        const arg = escapeHtml(item.counterArgument || '');
        const law = item.supportingLaw ? ` <em>(${escapeHtml(item.supportingLaw)})</em>` : '';
        const label = item.petitionParaNo ?? item.paraNo ?? '—';
        const stance = String(item.stance || '').replace(/_/g, ' ') || '—';
        const stanceTd = showStanceCol
          ? `<td style="text-align:center; vertical-align:top; text-transform:capitalize;">${escapeHtml(stance)}</td>`
          : '';
        body += `<tr><td style="text-align:center; vertical-align:top;"><strong>${escapeHtml(label)}</strong></td>${stanceTd}<td style="text-align:justify;">${lead}${arg}${law}</td></tr>`;
      });
      body += '</table>';
    } else {
      counterData.counterDraft.forEach((item, idx) => {
        const lead = stanceLeadIn(item, L, ctx);
        const arg = escapeHtml(item.counterArgument || '');
        const label = item.petitionParaNo ?? item.paraNo;
        const full = `${lead}${arg}${item.supportingLaw ? ` (${item.supportingLaw})` : ''}`.trim();
        if (numbered) {
          body = appendNumberedItem(body, full, format, paraCounter, format === 'html' ? ` data-edit-section="counterDraft" data-edit-index="${idx}" style="cursor:pointer;"` : '');
        } else if (format === 'html') {
          const law = item.supportingLaw ? ` <span class="support-law">(${escapeHtml(item.supportingLaw)})</span>` : '';
          body += `<div class="para" data-edit-section="counterDraft" data-edit-index="${idx}" style="cursor:pointer;"><span class="para-num">${escapeHtml(L.paraLabel || 'Para')} ${escapeHtml(label)}:</span> ${lead}${arg}${law}</div>`;
        } else {
          const law = item.supportingLaw ? ` <em>(${escapeHtml(item.supportingLaw)})</em>` : '';
          body += `<p style="margin:0 0 8px 0; text-align:justify;"><strong>${escapeHtml(L.paraLabel || 'Para')} ${escapeHtml(label)}:</strong> ${lead}${arg}${law}</p>`;
        }
      });
    }
  }

  // statementOfFacts is already rendered earlier


  body = appendClosingParagraphs(body, counterData, format, paraCounter, numbered);

  if (counterData.prayer && layout.showSectionHeadings) {
    const heading = escapeHtml(L.prayer || 'PRAYER');
    if (format === 'html') {
      body += `<h2 class="section">${heading}</h2><div class="para" data-edit-field="prayer" style="cursor:pointer;">${escapeHtml(counterData.prayer)}</div>`;
    } else {
      body += docxSectionHeading(layout, heading);
      body += `<p style="margin:0 0 10px 0; text-align:justify;">${escapeHtml(counterData.prayer)}</p>`;
    }
  }

  if (counterData.verification && layout.showSectionHeadings) {
    const heading = escapeHtml(L.verification || 'VERIFICATION');
    if (format === 'html') {
      body += `<h2 class="section">${heading}</h2><div class="verification-block" data-edit-field="verification" style="cursor:pointer;">${verificationToParagraphs(counterData.verification)}</div>`;
    } else {
      body += docxSectionHeading(layout, heading);
      body += `<div style="text-align:justify;">${verificationToParagraphs(counterData.verification)}</div>`;
    }
  }

  const verifiedAtText = counterData.verifiedAt !== undefined ? counterData.verifiedAt : (L.verifiedAt || '');
  const deponentSigText = counterData.deponentSignature !== undefined ? counterData.deponentSignature : (L.deponentSignature || 'Deponent');
  const advocateText = counterData.advocateBlock !== undefined ? counterData.advocateBlock : (L.advocateBlock || '');

  if (format === 'html') {
    body += `<p class="place-date" data-edit-field="verifiedAt" style="cursor:pointer;">${escapeHtml(verifiedAtText)}</p>`;
    body += '<div class="sig-block">';
    body += `<div class="sig-line" data-edit-field="deponentSignature" style="cursor:pointer;">${escapeHtml(deponentSigText)}</div>`;
    body += '</div>';
    body += `<div class="advocate" data-edit-field="advocateBlock" style="cursor:pointer;"><strong>${escapeHtml(advocateText)}</strong></div>`;
  } else {
    body += `<p style="margin:16px 0 0 0; text-align:justify;">${escapeHtml(verifiedAtText)}</p>`;
    body += `<p style="margin:26px 0 0 0; text-align:right;"><strong>${escapeHtml(deponentSigText)}</strong></p>`;
    body += `<p style="margin:20px 0 0 0;"><strong>${escapeHtml(advocateText)}</strong></p>`;
  }

  return body;
}
