const IST_LOCALE = 'en-IN';

export function normalizeAuditChange(c, index = 0) {
  const ts = c?.timestamp ? new Date(c.timestamp) : null;
  const validTs = ts && !Number.isNaN(ts.getTime()) ? ts : null;
  let changeType = c?.changeType;
  if (!changeType && c?.type === 'suggestion') changeType = 'suggestion';
  if (!changeType) changeType = 'manual_edit';

  return {
    no: index + 1,
    id: c?._id ? String(c._id) : String(index),
    timestampIso: validTs ? validTs.toISOString() : null,
    dateKey: validTs ? validTs.toISOString().slice(0, 10) : 'unknown',
    dateLabel: validTs
      ? validTs.toLocaleDateString(IST_LOCALE, {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })
      : 'Unknown date',
    timeLabel: validTs
      ? validTs.toLocaleTimeString(IST_LOCALE, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '—',
    fullTimestamp: validTs ? validTs.toLocaleString(IST_LOCALE) : 'N/A',
    changeType,
    instruction: c?.instruction || '',
    summary: c?.summary || '',
    previousText: c?.previousText || c?.originalText || '',
    newText: c?.newText || c?.suggestedText || '',
    reverted: !!c?.reverted,
  };
}

export function buildAuditEntries(changes = []) {
  return (changes || []).map((c, idx) => normalizeAuditChange(c, idx));
}

export function filterAuditEntries(entries, { from, to, type, q } = {}) {
  let list = [...entries];

  if (from) {
    const fromKey = String(from).slice(0, 10);
    list = list.filter((e) => e.dateKey >= fromKey);
  }
  if (to) {
    const toKey = String(to).slice(0, 10);
    list = list.filter((e) => e.dateKey <= toKey);
  }
  if (type && type !== 'all') {
    list = list.filter((e) => e.changeType === type);
  }
  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    list = list.filter((e) =>
      [e.instruction, e.summary, e.previousText, e.newText, e.changeType, e.fullTimestamp]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }

  return list;
}

export function groupAuditEntriesByDate(entries) {
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.dateKey)) byDate.set(e.dateKey, []);
    byDate.get(e.dateKey).push(e);
  }
  for (const [, dayEntries] of byDate) {
    dayEntries.sort((a, b) => (b.timestampIso || '').localeCompare(a.timestampIso || ''));
  }
  return [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildFilterSummary({ from, to, type, q }) {
  const parts = [];
  if (from) parts.push(`from ${from}`);
  if (to) parts.push(`to ${to}`);
  if (type && type !== 'all') parts.push(`type ${type}`);
  if (q) parts.push(`search "${q}"`);
  return parts.length ? parts.join(', ') : '';
}

export function renderAuditLogHtml({
  fileName,
  docType,
  sessionId,
  sessionCreatedAt,
  generatedAt,
  signatureHash,
  groups,
  filteredCount,
  totalCount,
  filterSummary,
}) {
  const dateStr = generatedAt.toLocaleString(IST_LOCALE);

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Audit Log - ${escapeHtml(fileName)}</title>
<style>
body{font-family:'Segoe UI',Arial,sans-serif;max-width:960px;margin:0 auto;padding:30px;color:#1a1a1a;line-height:1.5;font-size:13px;position:relative}
.watermark{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:60px;color:rgba(200,200,200,0.15);font-weight:bold;white-space:nowrap;pointer-events:none;z-index:0}
h1{color:#1a365d;font-size:20px;border-bottom:2px solid #c9b99a;padding-bottom:8px}
.meta{margin-bottom:16px;padding:12px;background:#f7fafc;border:1px solid #e2e8f0;border-radius:6px;font-size:12px}
.filters{color:#4a5568;margin-top:6px}
.day-block{margin:20px 0 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
.day-head{background:#1a365d;color:#fff;padding:10px 14px;font-weight:600;font-size:14px;display:flex;justify-content:space-between}
.day-head span{font-weight:400;font-size:12px;opacity:0.9}
table{border-collapse:collapse;width:100%;font-size:12px}
td,th{border-top:1px solid #e2e8f0;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#edf2f7;font-size:10px;text-transform:uppercase}
.type-badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:bold;color:#fff}
.type-ai_edit{background:#805ad5}.type-manual_edit{background:#3182ce}.type-undo{background:#d69e2e}.type-redo{background:#38a169}.type-autosave{background:#718096}.type-suggestion{background:#2b6cb0}
.diff-old{background:#fed7d7;padding:4px 6px;border-radius:3px;font-size:11px;white-space:pre-wrap;word-break:break-word}
.diff-new{background:#c6f6d5;padding:4px 6px;border-radius:3px;font-size:11px;white-space:pre-wrap;word-break:break-word}
.signature{margin-top:30px;padding:12px;background:#fefcbf;border:1px solid #d69e2e;border-radius:6px;font-size:11px}
.footer{margin-top:20px;font-size:10px;color:#718096;text-align:center;border-top:1px solid #e2e8f0;padding-top:8px}
</style></head><body>
<div class="watermark">Dastavezai Audit Log</div>
<h1>Document change statement</h1>
<div class="meta">
<p><strong>Document:</strong> ${escapeHtml(fileName)}</p>
<p><strong>Type:</strong> ${escapeHtml(docType)}</p>
<p><strong>Session:</strong> ${escapeHtml(sessionId)}</p>
<p><strong>Entries:</strong> ${filteredCount} of ${totalCount}</p>
<p><strong>Generated:</strong> ${escapeHtml(dateStr)}</p>
<p><strong>Session created:</strong> ${sessionCreatedAt ? escapeHtml(new Date(sessionCreatedAt).toLocaleString(IST_LOCALE)) : 'N/A'}</p>
${filterSummary ? `<p class="filters"><strong>Filters:</strong> ${escapeHtml(filterSummary)}</p>` : ''}
</div>`;

  if (!groups.length) {
    html += `<p style="text-align:center;color:#718096;padding:24px">No entries match the filters.</p>`;
  } else {
    for (const [, dayEntries] of groups) {
      const label = dayEntries[0]?.dateLabel || 'Unknown date';
      html += `<div class="day-block"><div class="day-head">${escapeHtml(label)}<span>${dayEntries.length} entries</span></div>
<table><thead><tr><th>#</th><th>Time</th><th>Type</th><th>Details</th><th>Before</th><th>After</th></tr></thead><tbody>`;
      for (const e of dayEntries) {
        const typeClass = `type-${String(e.changeType).replace(/[^a-z0-9_]/gi, '_')}`;
        const title = [e.instruction, e.summary].filter(Boolean).join(' — ');
        html += `<tr>
<td>${e.no}</td>
<td>${escapeHtml(e.timeLabel)}</td>
<td><span class="type-badge ${typeClass}">${escapeHtml(String(e.changeType).replace(/_/g, ' '))}</span></td>
<td>${escapeHtml(title)}</td>
<td><div class="diff-old">${escapeHtml(e.previousText)}</div></td>
<td><div class="diff-new">${escapeHtml(e.newText)}</div></td>
</tr>`;
      }
      html += `</tbody></table></div>`;
    }
  }

  html += `<div class="signature"><strong>SHA-256</strong><br><code>${signatureHash}</code></div>`;
  html += `<div class="footer">Dastavezai · ${escapeHtml(dateStr)}</div></body></html>`;

  return html;
}
