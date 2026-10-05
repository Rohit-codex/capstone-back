// server/config/featureFlags.js
// ─── SINGLE SOURCE OF TRUTH for all subscription tiers ───────────────────────
// Every feature key used across the app must be defined here.
// Backend middleware + Frontend hooks both read from this config (frontend
// gets it via GET /api/subscriptions/features).

export const TIERS = {
  FREE: 'free',
  BASIC: 'basic',
  PREMIUM: 'premium',
  ENTERPRISE: 'enterprise',
};

export const TIER_RANK = {
  free: 0,
  basic: 1,
  premium: 2,
  enterprise: 3,
};

// ─── Feature definitions ───────────────────────────────────────────────────────
// minTier: minimum tier required to access the feature
// watermark: true = file is generated with a watermark if used on this tier
// description: shown in upgrade prompts
export const FEATURES = {
  // ── Chat & Q&A ──────────────────────────────────────────────────────────────
  CHAT_QA: {
    key: 'CHAT_QA',
    label: 'Chat Q&A',
    description: 'Ask legal questions and get AI-powered answers.',
    minTier: TIERS.FREE,
    watermark: false,
    category: 'Core',
  },

  // ── Document Upload ──────────────────────────────────────────────────────────
  DOCUMENT_UPLOAD: {
    key: 'DOCUMENT_UPLOAD',
    label: 'Document Upload',
    description: 'Upload and store legal documents.',
    minTier: TIERS.FREE,
    watermark: false,
    category: 'Core',
  },

  // ── Draft Generation (Free = watermarked, Basic+ = clean) ───────────────────
  DRAFT_GENERATION: {
    key: 'DRAFT_GENERATION',
    label: 'Draft Generation',
    description: 'Generate legal document drafts using AI.',
    minTier: TIERS.FREE,
    watermark: true,          // watermark applied on FREE tier, removed on BASIC+
    watermarkRemovedAt: TIERS.BASIC,
    category: 'Drafting',
  },

  BASIC_EDITING: {
    key: 'BASIC_EDITING',
    label: 'Basic Document Editing',
    description: 'Edit and make changes to generated documents.',
    minTier: TIERS.FREE,
    watermark: true,
    watermarkRemovedAt: TIERS.BASIC,
    category: 'Drafting',
  },

  // ── Basic tier features ──────────────────────────────────────────────────────
  CLEAN_DOWNLOAD: {
    key: 'CLEAN_DOWNLOAD',
    label: 'Watermark-Free Downloads',
    description: 'Download documents without watermarks.',
    minTier: TIERS.BASIC,
    watermark: false,
    category: 'Core',
  },

  // ── Smart Scan / Analysis ─────────────────────────────────────────────────── 
  // Available from Basic but premium gets deeper analysis
  SMART_SCAN: {
    key: 'SMART_SCAN',
    label: 'Smart Document Scan',
    description: 'AI-powered document scanning and risk detection.',
    minTier: TIERS.BASIC,
    watermark: false,
    category: 'Analysis',
  },

  COUNTER_AFFIDAVIT: {
    key: 'COUNTER_AFFIDAVIT',
    label: 'Counter Affidavit Generator',
    description: 'Generate court-ready counter affidavits.',
    minTier: TIERS.BASIC,
    watermark: false,
    category: 'Drafting',
  },

  SOF_GENERATION: {
    key: 'SOF_GENERATION',
    label: 'Statement of Facts',
    description: 'Auto-generate Statements of Facts from documents.',
    minTier: TIERS.BASIC,
    watermark: false,
    category: 'Drafting',
  },

  // ── Premium tier features ────────────────────────────────────────────────────
  WRIT_COUNTER: {
    key: 'WRIT_COUNTER',
    label: 'Writ Counter Affidavit',
    description: 'AI-generated writ-specific counter affidavits for all writ types.',
    minTier: TIERS.PREMIUM,
    watermark: false,
    category: 'Advanced Drafting',
  },

  DOCUMENT_SUMMARY: {
    key: 'DOCUMENT_SUMMARY',
    label: 'AI Document Summary',
    description: 'Deep 12-field structured document summaries with risk flags.',
    minTier: TIERS.PREMIUM,
    watermark: false,
    category: 'Analysis',
  },

  WORKFLOWS: {
    key: 'WORKFLOWS',
    label: 'Custom Workflows',
    description: 'Build and run repeatable AI workflows on your documents.',
    minTier: TIERS.PREMIUM,
    watermark: false,
    category: 'Automation',
  },

  RAG_RESEARCH: {
    key: 'RAG_RESEARCH',
    label: 'Legal RAG Research',
    description: 'Deep AI research using Indian case law and statutes.',
    minTier: TIERS.PREMIUM,
    watermark: false,
    category: 'Research',
  },

  ADVANCED_EDITING: {
    key: 'ADVANCED_EDITING',
    label: 'Advanced Document Editing',
    description: 'Full-featured document editor with tracked changes.',
    minTier: TIERS.PREMIUM,
    watermark: false,
    category: 'Drafting',
  },

  // ── Enterprise tier features ─────────────────────────────────────────────────
  ORG_MANAGEMENT: {
    key: 'ORG_MANAGEMENT',
    label: 'Organization Management',
    description: 'Manage team members, roles, and access permissions.',
    minTier: TIERS.ENTERPRISE,
    watermark: false,
    category: 'Enterprise',
  },

  DESIGNATION_ACCESS_CONTROL: {
    key: 'DESIGNATION_ACCESS_CONTROL',
    label: 'Designation-Based Access Control',
    description: 'Grant or deny feature access based on employee designation and clearance level.',
    minTier: TIERS.ENTERPRISE,
    watermark: false,
    category: 'Enterprise',
  },

  TEAM_SHARING: {
    key: 'TEAM_SHARING',
    label: 'Team Document Sharing',
    description: 'Share documents and workflows across your organization.',
    minTier: TIERS.ENTERPRISE,
    watermark: false,
    category: 'Enterprise',
  },

  AUDIT_LOGS: {
    key: 'AUDIT_LOGS',
    label: 'Audit Logs',
    description: 'Full audit trail of all document and user actions.',
    minTier: TIERS.ENTERPRISE,
    watermark: false,
    category: 'Enterprise',
  },

  BULK_PROCESSING: {
    key: 'BULK_PROCESSING',
    label: 'Bulk Document Processing',
    description: 'Process multiple documents simultaneously.',
    minTier: TIERS.ENTERPRISE,
    watermark: false,
    category: 'Enterprise',
  },
};

// ─── Helper: check if a tier can access a feature ────────────────────────────
export function canAccess(userTier, featureKey) {
  const feature = FEATURES[featureKey];
  if (!feature) return false;
  return TIER_RANK[userTier] >= TIER_RANK[feature.minTier];
}

// ─── Helper: should watermark be applied ─────────────────────────────────────
export function shouldWatermark(userTier, featureKey) {
  const feature = FEATURES[featureKey];
  if (!feature || !feature.watermark) return false;
  if (feature.watermarkRemovedAt) {
    return TIER_RANK[userTier] < TIER_RANK[feature.watermarkRemovedAt];
  }
  return feature.watermark;
}

// ─── Helper: get all features accessible at a given tier ─────────────────────
export function getAccessibleFeatures(userTier) {
  return Object.values(FEATURES).filter(f =>
    TIER_RANK[userTier] >= TIER_RANK[f.minTier]
  );
}

// ─── Tier display metadata (for pricing page / upgrade modal) ─────────────────
export const TIER_META = {
  [TIERS.FREE]: {
    label: 'Free',
    color: '#6B7280',
    badge: 'bg-gray-100 text-gray-600',
    price: '₹0/month',
    tagline: 'Get started with AI legal drafting',
  },
  [TIERS.BASIC]: {
    label: 'Basic',
    color: '#2563EB',
    badge: 'bg-blue-100 text-blue-700',
    price: '₹999/month',
    tagline: 'Core tools for individual practitioners',
  },
  [TIERS.PREMIUM]: {
    label: 'Premium',
    color: '#7C3AED',
    badge: 'bg-purple-100 text-purple-700',
    price: '₹2,999/month',
    tagline: 'Advanced AI for serious legal work',
  },
  [TIERS.ENTERPRISE]: {
    label: 'Enterprise',
    color: '#D97706',
    badge: 'bg-amber-100 text-amber-700',
    price: 'Custom pricing',
    tagline: 'Full platform access for legal teams',
  },
};
