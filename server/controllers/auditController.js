import EditSession from '../models/EditSession.js';
import { AppError } from '../utils/errors.js';
import crypto from 'crypto';
import {
  buildAuditEntries,
  filterAuditEntries,
  groupAuditEntriesByDate,
  renderAuditLogHtml,
  buildFilterSummary,
} from '../utils/auditLogFormat.js';

function parseAuditQuery(query) {
  return {
    from: query.from || query.fromDate || '',
    to: query.to || query.toDate || '',
    type: query.type || query.changeType || 'all',
    q: query.q || query.search || '',
  };
}

function buildSignaturePayload(session, filteredCount, filters) {
  return JSON.stringify({
    sessionId: session._id.toString(),
    fileName: session.fileName || 'Unknown Document',
    changeCount: filteredCount,
    totalCount: (session.changes || []).length,
    filters,
    userId: session.userId.toString(),
  });
}

export const exportAuditLog = async (req, res) => {
  const { sessionId } = req.params;
  const filters = parseAuditQuery(req.query);

  const session = await EditSession.findOne({ _id: sessionId, userId: req.user.id });
  if (!session) throw new AppError('Edit session not found', 404);

  const allEntries = buildAuditEntries(session.changes || []);
  const filtered = filterAuditEntries(allEntries, filters);
  const groups = groupAuditEntriesByDate(filtered);
  const filterSummary = buildFilterSummary(filters);

  const fileName = session.fileName || 'Unknown Document';
  const docType = session.detectedDocType || session.fileType || 'Document';
  const now = new Date();
  const signatureHash = crypto
    .createHash('sha256')
    .update(buildSignaturePayload(session, filtered.length, filters))
    .digest('hex');

  const format = req.query.format || 'html';

  if (format === 'json') {
    return res.json({
      sessionId: session._id,
      fileName,
      docType,
      totalCount: allEntries.length,
      filteredCount: filtered.length,
      filters,
      filterSummary,
      signatureHash,
      groups: groups.map(([dateKey, entries]) => ({
        dateKey,
        dateLabel: entries[0]?.dateLabel,
        entries,
      })),
      entries: filtered,
    });
  }

  const html = renderAuditLogHtml({
    fileName,
    docType,
    sessionId: session._id.toString(),
    sessionCreatedAt: session.createdAt,
    generatedAt: now,
    signatureHash,
    groups,
    filteredCount: filtered.length,
    totalCount: allEntries.length,
    filterSummary,
  });

  if (format === 'pdf') {
    try {
      const { default: puppeteer } = await import('puppeteer');
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle0' });
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' },
      });
      await browser.close();

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="audit_log_${session._id}.pdf"`);
      return res.send(pdfBuffer);
    } catch (pdfErr) {
      console.warn('Puppeteer PDF failed, returning HTML:', pdfErr.message);
    }
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="audit_log_${session._id}.html"`);
  res.send(html);
};

export const verifyAuditLog = async (req, res) => {
  const { sessionId } = req.params;
  const { hash } = req.query;

  if (!hash) throw new AppError('Hash parameter required', 400);

  const session = await EditSession.findById(sessionId);
  if (!session) throw new AppError('Session not found', 404);

  const filters = parseAuditQuery(req.query);
  const allEntries = buildAuditEntries(session.changes || []);
  const filtered = filterAuditEntries(allEntries, filters);

  const expectedHash = crypto
    .createHash('sha256')
    .update(buildSignaturePayload(session, filtered.length, filters))
    .digest('hex');

  res.json({
    valid: hash === expectedHash,
    sessionId: session._id,
    fileName: session.fileName,
    changeCount: filtered.length,
    totalCount: allEntries.length,
  });
};
