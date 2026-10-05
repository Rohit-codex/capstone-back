// client/src/components/DocumentSummary.jsx
//
// Renders the AI-generated ~2-page document summary inside the existing
// DocumentViewer sidebar. Drop this component at the TOP of the sidebar,
// above the existing suggestions list.
//
// Usage (in DocumentViewer.jsx or wherever the edit session data is displayed):
//   import DocumentSummary from './DocumentSummary';
//   <DocumentSummary summary={editSession.summary} />

import { useState } from "react";

// ─── Severity config (matches server-side enum) ───────────────────────────────
const SEVERITY = {
  critical: { color: "#DC2626", bg: "#FEF2F2", border: "#FCA5A5", label: "Critical" },
  warning:  { color: "#D97706", bg: "#FFFBEB", border: "#FCD34D", label: "Warning"  },
  info:     { color: "#2563EB", bg: "#EFF6FF", border: "#93C5FD", label: "Info"     },
};

// ─── Small reusable atoms ─────────────────────────────────────────────────────

function SeverityBadge({ severity }) {
  const cfg = SEVERITY[severity] || SEVERITY.info;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px",
      borderRadius: 4, background: cfg.bg, color: cfg.color,
      border: `1px solid ${cfg.border}`, letterSpacing: 0.3,
      textTransform: "uppercase", whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function SectionHeader({ icon, title, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      marginBottom: 10, paddingBottom: 8,
      borderBottom: "1px solid var(--color-border-tertiary)",
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", flex: 1 }}>
        {title}
      </span>
      {count !== undefined && (
        <span style={{
          fontSize: 11, background: "var(--color-background-secondary)",
          border: "1px solid var(--color-border-tertiary)",
          borderRadius: 10, padding: "1px 7px", color: "var(--color-text-secondary)",
        }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Card({ children, style = {} }) {
  return (
    <div style={{
      background: "var(--color-background-primary)",
      border: "1px solid var(--color-border-tertiary)",
      borderRadius: 10, padding: "14px 16px", marginBottom: 12,
      ...style,
    }}>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  if (!value || value === "Not specified" || value === "Not applicable") return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 7, fontSize: 13 }}>
      <span style={{ color: "var(--color-text-secondary)", minWidth: 110, flexShrink: 0 }}>
        {label}
      </span>
      <span style={{ color: "var(--color-text-primary)", fontWeight: 500, lineHeight: 1.4 }}>
        {value}
      </span>
    </div>
  );
}

function CollapsibleSection({ title, icon, count, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", background: "none", border: "none", cursor: "pointer",
          padding: 0, textAlign: "left",
        }}
      >
        <SectionHeader icon={icon} title={title} count={count} />
      </button>
      {open && <div style={{ marginTop: 4 }}>{children}</div>}
    </Card>
  );
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────
function SummarySkeleton() {
  const bar = (w, h = 12, mb = 8) => (
    <div style={{
      width: w, height: h, background: "var(--color-background-secondary)",
      borderRadius: 6, marginBottom: mb,
      animation: "summaryPulse 1.4s ease-in-out infinite",
    }} />
  );
  return (
    <div style={{ padding: "0 0 16px" }}>
      <style>{`
        @keyframes summaryPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      {bar("60%", 18, 16)}
      {bar("90%")} {bar("80%")} {bar("70%", 12, 20)}
      {bar("50%", 14, 12)}
      {bar("95%")} {bar("88%")} {bar("75%")}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function DocumentSummary({ summary, isLoading = false }) {
  const [copied, setCopied] = useState(false);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: "16px 0 8px" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>
          AI Summary
        </div>
        <SummarySkeleton />
      </div>
    );
  }

  // ── No summary ─────────────────────────────────────────────────────────────
  if (!summary) return null;

  // ── Error state ────────────────────────────────────────────────────────────
  if (summary.error && summary.documentTitle === "Summary Unavailable") {
    return (
      <Card style={{ borderColor: "#FCA5A5", background: "#FEF2F2" }}>
        <div style={{ fontSize: 13, color: "#991B1B", fontWeight: 500 }}>
          Summary could not be generated
        </div>
        <div style={{ fontSize: 12, color: "#B91C1C", marginTop: 4 }}>
          {summary.error}
        </div>
      </Card>
    );
  }

  const criticalCount = (summary.riskFlags || []).filter((r) => r.severity === "critical").length;
  const warningCount  = (summary.riskFlags || []).filter((r) => r.severity === "warning").length;

  // ── Copy plain-text summary to clipboard ──────────────────────────────────
  const handleCopy = () => {
    const text = buildPlainText(summary);
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{ paddingBottom: 8 }}>

      {/* ── Header bar ───────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 14,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          AI Document Summary
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {criticalCount > 0 && (
            <span style={{ fontSize: 11, background: "#FEF2F2", color: "#DC2626", border: "1px solid #FCA5A5", borderRadius: 10, padding: "1px 8px", fontWeight: 600 }}>
              {criticalCount} critical
            </span>
          )}
          {warningCount > 0 && (
            <span style={{ fontSize: 11, background: "#FFFBEB", color: "#D97706", border: "1px solid #FCD34D", borderRadius: 10, padding: "1px 8px", fontWeight: 600 }}>
              {warningCount} warning
            </span>
          )}
          <button
            onClick={handleCopy}
            title="Copy summary as plain text"
            style={{
              background: "none", border: "1px solid var(--color-border-tertiary)",
              borderRadius: 6, padding: "3px 10px", cursor: "pointer",
              fontSize: 11, color: "var(--color-text-secondary)",
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* ── Document identity ─────────────────────────────────────────────── */}
      <Card>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--color-text-primary)", marginBottom: 12, lineHeight: 1.3 }}>
          {summary.documentTitle || "Untitled Document"}
        </div>
        <InfoRow label="Document type"    value={summary.documentType} />
        <InfoRow label="Jurisdiction"     value={summary.jurisdiction} />
        <InfoRow label="Effective date"   value={summary.effectiveDate} />
        <InfoRow label="Expiry / validity" value={summary.expiryDate} />
        {summary.generationTimeSeconds > 0 && (
          <div style={{ fontSize: 11, color: "var(--color-text-secondary)", marginTop: 8 }}>
            Generated in {summary.generationTimeSeconds}s
          </div>
        )}
      </Card>

      {/* ── Parties ───────────────────────────────────────────────────────── */}
      {summary.parties?.length > 0 && (
        <CollapsibleSection icon="👥" title="Parties" count={summary.parties.length}>
          {summary.parties.map((p, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 7, fontSize: 13 }}>
              <span style={{ color: "var(--color-text-secondary)", minWidth: 90, flexShrink: 0 }}>{p.role}</span>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>{p.name}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── Executive summary ─────────────────────────────────────────────── */}
      {summary.executiveSummary && (
        <Card>
          <SectionHeader icon="📋" title="Executive summary" />
          <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6, margin: 0 }}>
            {summary.executiveSummary}
          </p>
        </Card>
      )}

      {/* ── Key provisions ────────────────────────────────────────────────── */}
      {summary.keyProvisions?.length > 0 && (
        <CollapsibleSection icon="📄" title="Key provisions" count={summary.keyProvisions.length} defaultOpen={true}>
          {summary.keyProvisions.map((p, i) => (
            <div key={i} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>
                {p.heading}
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-secondary)", lineHeight: 1.55 }}>
                {p.summary}
              </div>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── Financial terms ───────────────────────────────────────────────── */}
      {summary.financialTerms && (
        (() => {
          const { amounts, paymentSchedule, penalties } = summary.financialTerms;
          const hasContent = amounts?.length > 0 || (paymentSchedule && paymentSchedule !== "Not applicable") || (penalties && penalties !== "None specified");
          if (!hasContent) return null;
          return (
            <CollapsibleSection icon="💰" title="Financial terms" defaultOpen={true}>
              {amounts?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  {amounts.map((a, i) => (
                    <div key={i} style={{ fontSize: 13, color: "var(--color-text-primary)", marginBottom: 4, paddingLeft: 12, borderLeft: "2px solid var(--color-border-tertiary)" }}>
                      {a}
                    </div>
                  ))}
                </div>
              )}
              <InfoRow label="Payment"  value={paymentSchedule} />
              <InfoRow label="Penalties" value={penalties} />
            </CollapsibleSection>
          );
        })()
      )}

      {/* ── Obligations ───────────────────────────────────────────────────── */}
      {summary.obligationsAndRights && (
        (() => {
          const { partyA, partyB } = summary.obligationsAndRights;
          if (!partyA?.length && !partyB?.length) return null;
          return (
            <CollapsibleSection icon="⚖️" title="Obligations & rights" defaultOpen={false}>
              {partyA?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
                    {summary.parties?.[0]?.role || "Party A"}
                  </div>
                  {partyA.map((o, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--color-text-primary)", marginBottom: 4, display: "flex", gap: 6 }}>
                      <span style={{ color: "var(--color-text-secondary)", flexShrink: 0 }}>•</span>
                      <span>{o}</span>
                    </div>
                  ))}
                </div>
              )}
              {partyB?.length > 0 && (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-secondary)", marginBottom: 6 }}>
                    {summary.parties?.[1]?.role || "Party B"}
                  </div>
                  {partyB.map((o, i) => (
                    <div key={i} style={{ fontSize: 12, color: "var(--color-text-primary)", marginBottom: 4, display: "flex", gap: 6 }}>
                      <span style={{ color: "var(--color-text-secondary)", flexShrink: 0 }}>•</span>
                      <span>{o}</span>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>
          );
        })()
      )}

      {/* ── Critical dates ────────────────────────────────────────────────── */}
      {summary.criticalDates?.length > 0 && (
        <CollapsibleSection icon="📅" title="Critical dates" count={summary.criticalDates.length} defaultOpen={false}>
          {summary.criticalDates.map((d, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: "var(--color-text-secondary)" }}>{d.event}</span>
              <span style={{ color: "var(--color-text-primary)", fontWeight: 500, whiteSpace: "nowrap", marginLeft: 12 }}>{d.date}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── Risk flags ────────────────────────────────────────────────────── */}
      {summary.riskFlags?.length > 0 && (
        <CollapsibleSection icon="🚩" title="Risk flags" count={summary.riskFlags.length} defaultOpen={true}>
          {summary.riskFlags
            .sort((a, b) => {
              const order = { critical: 0, warning: 1, info: 2 };
              return (order[a.severity] ?? 2) - (order[b.severity] ?? 2);
            })
            .map((rf, i) => {
              const cfg = SEVERITY[rf.severity] || SEVERITY.info;
              return (
                <div key={i} style={{
                  display: "flex", gap: 10, marginBottom: 10, padding: "10px 12px",
                  background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8,
                }}>
                  <div style={{ paddingTop: 1 }}>
                    <SeverityBadge severity={rf.severity} />
                  </div>
                  <div style={{ fontSize: 12, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
                    {rf.flag}
                  </div>
                </div>
              );
            })}
        </CollapsibleSection>
      )}

      {/* ── Missing clauses ───────────────────────────────────────────────── */}
      {summary.missingClauses?.length > 0 && (
        <CollapsibleSection icon="📭" title="Missing clauses" count={summary.missingClauses.length} defaultOpen={false}>
          {summary.missingClauses.map((c, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--color-text-primary)", marginBottom: 6, display: "flex", gap: 6 }}>
              <span style={{ color: "#D97706", flexShrink: 0 }}>!</span>
              <span>{c}</span>
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── Legal references ──────────────────────────────────────────────── */}
      {summary.legalReferences?.length > 0 && (
        <CollapsibleSection icon="⚖️" title="Legal references" count={summary.legalReferences.length} defaultOpen={false}>
          {summary.legalReferences.map((ref, i) => (
            <div key={i} style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 5, paddingLeft: 8, borderLeft: "2px solid var(--color-border-tertiary)" }}>
              {ref}
            </div>
          ))}
        </CollapsibleSection>
      )}

      {/* ── Conclusion ────────────────────────────────────────────────────── */}
      {summary.conclusion && (
        <Card style={{ borderColor: "var(--color-border-secondary)", background: "var(--color-background-secondary)" }}>
          <SectionHeader icon="💡" title="Conclusion" />
          <p style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.6, margin: 0 }}>
            {summary.conclusion}
          </p>
        </Card>
      )}

    </div>
  );
}

// ─── Utility: flatten summary to plain text for copy ─────────────────────────
function buildPlainText(s) {
  const lines = [];
  lines.push(`DOCUMENT SUMMARY — ${s.documentTitle}`);
  lines.push(`Type: ${s.documentType} | Jurisdiction: ${s.jurisdiction}`);
  lines.push(`Effective: ${s.effectiveDate} | Expiry: ${s.expiryDate}`);
  lines.push('');

  if (s.parties?.length) {
    lines.push('PARTIES');
    s.parties.forEach((p) => lines.push(`  ${p.role}: ${p.name}`));
    lines.push('');
  }

  if (s.executiveSummary) {
    lines.push('EXECUTIVE SUMMARY');
    lines.push(s.executiveSummary);
    lines.push('');
  }

  if (s.keyProvisions?.length) {
    lines.push('KEY PROVISIONS');
    s.keyProvisions.forEach((p) => {
      lines.push(`  ${p.heading}`);
      lines.push(`    ${p.summary}`);
    });
    lines.push('');
  }

  if (s.riskFlags?.length) {
    lines.push('RISK FLAGS');
    s.riskFlags.forEach((rf) => lines.push(`  [${rf.severity.toUpperCase()}] ${rf.flag}`));
    lines.push('');
  }

  if (s.conclusion) {
    lines.push('CONCLUSION');
    lines.push(s.conclusion);
  }

  lines.push(`\nGenerated by Dastavezai on ${new Date(s.generatedAt).toLocaleString('en-IN')}`);
  return lines.join('\n');
}
