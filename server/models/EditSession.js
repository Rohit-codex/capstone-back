import mongoose from 'mongoose';

const editChangeSchema = new mongoose.Schema({
  instruction: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  previousText: { type: String, required: true },
  newText: { type: String, required: true },
  summary: { type: String },
  changeType: { 
    type: String, 
    enum: ['ai_edit', 'manual_edit', 'undo', 'redo', 'autosave'],
    default: 'manual_edit'
  },
  
  diff: {
    additions: [{ start: Number, end: Number, text: String }],
    deletions: [{ start: Number, end: Number, text: String }]
  }
}, { _id: true });

const editSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    index: true
  },
  fileName: { type: String, required: true },
  fileType: { type: String },
  
  
  originalText: { type: String, required: true },
  currentText: { type: String, required: true },
  htmlContent: { type: String, default: '' },
  
  
  scanStatus: {
    type: String,
    enum: ['none', 'scanning', 'scanned', 'failed'],
    default: 'none'
  },
  formatMetadata: {
    type: mongoose.Schema.Types.Mixed,
    default: null
    
  },
  scanResults: {
    type: mongoose.Schema.Types.Mixed,
    default: null
    
  },
  smartSuggestions: [{
    suggestionId: { type: String, required: true },
    type: { type: String, enum: ['legal_compliance', 'clause_improvement', 'formatting', 'risk_warning', 'missing_clause', 'language'] },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info' },
    title: { type: String, required: true },
    description: { type: String },
    clauseRef: { type: String },
    originalText: { type: String },
    suggestedText: { type: String },
    status: { type: String, enum: ['pending', 'applied', 'dismissed'], default: 'pending' }
  }],
  ocrText: { type: String, default: '' },
  ocrConfidence: { type: Number, default: 0 },
  layoutModel: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  documentGraph: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  fidelityEdits: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  fidelityOffsets: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  docxStatus: {
    type: String,
    enum: ['pending', 'ready', 'failed', 'none'],
    default: 'none'
  },
  docxFileUrl: { type: String, default: '' },
  docxHtml: { type: String, default: '' },
  docxError: { type: String, default: '' },
  docxUpdatedAt: { type: Date, default: null },
  // Path to the original (first-ever) DOCX for this session — used as structural base during sync
  // to preserve section properties (margins, header/footer) when regenerating after edits.
  originalDocxPath: { type: String, default: '' },
  fidelityObjectEdits: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  fidelityObjectLayer: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  fontCache: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  exportMode: {
    type: String,
    enum: ['fidelity', 'editable'],
    default: 'fidelity'
  },
  
  
  structure: { type: mongoose.Schema.Types.Mixed },
  riskAnalysis: { type: mongoose.Schema.Types.Mixed },
  legalIntelligence: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  
  
  detectedDocType: { type: String, default: '' },
  extractedParties: { type: mongoose.Schema.Types.Mixed, default: null },

  
  precedenceAnalysis: {
    type: [{ caseName: String, citation: String, relevance: String, summary: String }],
    default: []
  },

  statutesReferenced: {
    type: [{
      name: String,
      sections: String,
      relevance: String,
      documentContext: String,
      superseded: { by: String, date: String }
    }],
    default: []
  },

  
  complianceIssues: {
    type: [{ rule: String, description: String, severity: String, fix: String }],
    default: []
  },
  missingClauses: {
    type: [{ clauseType: String, importance: String, suggestedText: String }],
    default: []
  },

  
  clauseFlaws: {
    type: [{ clauseRef: String, originalText: String, issue: String, severity: String, suggestedFix: String }],
    default: []
  },

  
  chronologicalIssues: {
    type: [{ item: String, expectedOrder: String, foundOrder: String, description: String }],
    default: []
  },

  
  outdatedReferences: {
    type: [{ reference: String, currentLaw: String, description: String }],
    default: []
  },
  internalContradictions: {
    type: [{ clause1: String, clause2: String, contradiction: String, resolution: String }],
    default: []
  },

  governmentCompliance: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },

  
  
  
  docxStructure: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  
  
  changes: [editChangeSchema],
  
  
  undoPosition: { type: Number, default: -1 },
  
  
  lastAutosave: { type: Date },
  hasUnsavedChanges: { type: Boolean, default: false },
  
  
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active'
  },
  
  
  activeCollaborators: [{
    odUserId: mongoose.Schema.Types.ObjectId,
    userName: String,
    cursorPosition: Number,
    lastActivity: Date
  }],
  
  
  detectedVariables: [{
    name: String,
    pattern: String,
    position: Number,
    filled: Boolean,
    value: String
  }],
  
  // ── Template matching ──────────────────────────────────────────
  matchedTemplateId: { type: String, default: '' },          // relPath of matched template
  matchedTemplateFields: { type: mongoose.Schema.Types.Mixed, default: null }, // fields array from JSON
  matchedTemplateConfidence: { type: String, enum: ['high', 'medium', 'none', ''], default: '' },
  filledFieldValues: { type: mongoose.Schema.Types.Mixed, default: null },     // {key: value} map
  detectedBlankFields: { type: mongoose.Schema.Types.Mixed, default: null },   // [{key,label,type,required}]

  // ── Smart field extraction for complete documents ─────────────
  extractedDocumentFields: {
    type: [{
      key: String,
      label: String,
      value: String,
      category: { type: String, enum: ['parties', 'court_details', 'personal_details', 'financial_property', 'dates', 'sections_acts'] },
      type: { type: String, default: 'text' },
    }],
    default: null
  },
  isCompleteDocument: { type: Boolean, default: false },

  // ── AI-suggested precedents (auto-discovered when < 2 found) ──
  aiSuggestedPrecedents: {
    type: [{ caseName: String, citation: String, relevance: String, summary: String, court: String, principle: String }],
    default: []
  },

  
  scanLocked: { type: Boolean, default: false },
  scanLockedAt: { type: Date },

  
  createdAt: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
  
  
  expiresAt: { 
    type: Date, 
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    index: { expires: 0 }
  }
});


editSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  this.expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  next();
});


editSessionSchema.index({ userId: 1, updatedAt: -1 });
editSessionSchema.index({ userId: 1, status: 1 });


editSessionSchema.methods.canUndo = function() {
  if (this.changes.length === 0) return false;
  const pos = this.undoPosition === -1 ? this.changes.length - 1 : this.undoPosition;
  return pos >= 0;
};

editSessionSchema.methods.canRedo = function() {
  if (this.undoPosition === -1) return false;
  return this.undoPosition < this.changes.length - 1;
};

editSessionSchema.methods.getUndoText = function() {
  if (!this.canUndo()) return null;
  const pos = this.undoPosition === -1 ? this.changes.length - 1 : this.undoPosition;
  return this.changes[pos].previousText;
};

editSessionSchema.methods.getRedoText = function() {
  if (!this.canRedo()) return null;
  return this.changes[this.undoPosition + 1].newText;
};

const EditSession = mongoose.model('EditSession', editSessionSchema);
export default EditSession;
