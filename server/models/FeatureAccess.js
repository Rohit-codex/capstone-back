import mongoose from 'mongoose';


const featureTierSchema = new mongoose.Schema({
  enabled: { type: Boolean, default: false },
  limit: { type: Number, default: null },
}, { _id: false });

const featureRowSchema = new mongoose.Schema({
  featureKey: { 
    type: String, 
    required: true,
    trim: true
  },
  featureLabel: { 
    type: String, 
    required: true 
  },
  category: {
    type: String,
    enum: ['chat', 'documents', 'suggestions', 'editing', 'search', 'support'],
    default: 'chat'
  },
  description: { type: String, default: '' },
  basic: { type: featureTierSchema, default: () => ({}) },
  pro: { type: featureTierSchema, default: () => ({}) },
  premium: { type: featureTierSchema, default: () => ({}) },
}, { _id: false });

const featureAccessSchema = new mongoose.Schema({
  
  key: { type: String, default: 'feature_matrix', unique: true },
  features: [featureRowSchema],
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });


featureAccessSchema.statics.getMatrix = async function () {
  let matrix = await this.findOne({ key: 'feature_matrix' });
  if (!matrix) {
    matrix = await this.create({
      key: 'feature_matrix',
      features: getDefaultFeatures(),
    });
  }
  return matrix;
};

featureAccessSchema.statics.updateMatrix = async function (features, adminId) {
  return this.findOneAndUpdate(
    { key: 'feature_matrix' },
    { $set: { features, updatedBy: adminId } },
    { upsert: true, new: true, runValidators: true }
  );
};

featureAccessSchema.statics.isFeatureEnabled = async function (featureKey, userTier) {
  const matrix = await this.getMatrix();
  const feature = matrix.features.find(f => f.featureKey === featureKey);
  if (!feature) return false;
  const tierConfig = feature[userTier];
  return tierConfig?.enabled ?? false;
};

featureAccessSchema.statics.getFeatureLimit = async function (featureKey, userTier) {
  const matrix = await this.getMatrix();
  const feature = matrix.features.find(f => f.featureKey === featureKey);
  if (!feature) return 0;
  const tierConfig = feature[userTier];
  if (!tierConfig?.enabled) return 0;
  return tierConfig.limit;
};

function getDefaultFeatures() {
  return [
    {
      featureKey: 'inline_suggestions',
      featureLabel: 'Inline Suggestions',
      category: 'suggestions',
      description: 'Show contextual action buttons below AI responses',
      basic: { enabled: false, limit: null },
      pro: { enabled: true, limit: null },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'auto_intent_detection',
      featureLabel: 'Auto Intent Detection',
      category: 'chat',
      description: 'Automatically detect user intent (draft, complaint, etc.)',
      basic: { enabled: true, limit: null },
      pro: { enabled: true, limit: null },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'draft_generation',
      featureLabel: 'Draft Generation',
      category: 'documents',
      description: 'Generate legal document drafts',
      basic: { enabled: true, limit: 3 },
      pro: { enabled: true, limit: 10 },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'document_editing',
      featureLabel: 'Document Editing',
      category: 'editing',
      description: 'Edit generated documents inline',
      basic: { enabled: true, limit: 2 },
      pro: { enabled: true, limit: 10 },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'complaint_generation',
      featureLabel: 'Complaint Generation',
      category: 'documents',
      description: 'Generate structured complaint/FIR documents',
      basic: { enabled: true, limit: 2 },
      pro: { enabled: true, limit: 10 },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'template_browsing',
      featureLabel: 'Template Browsing',
      category: 'documents',
      description: 'Browse and use document templates',
      basic: { enabled: true, limit: null },
      pro: { enabled: true, limit: null },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'case_search',
      featureLabel: 'Case Search',
      category: 'search',
      description: 'Search related legal cases',
      basic: { enabled: false, limit: null },
      pro: { enabled: true, limit: 5 },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'legal_review',
      featureLabel: 'In-depth Legal Review',
      category: 'support',
      description: 'Comprehensive legal analysis and review',
      basic: { enabled: false, limit: null },
      pro: { enabled: false, limit: null },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'template_design_selection',
      featureLabel: 'Template Design Selection',
      category: 'documents',
      description: 'Choose from multiple document design templates',
      basic: { enabled: false, limit: null },
      pro: { enabled: true, limit: null },
      premium: { enabled: true, limit: null },
    },
    {
      featureKey: 'learn_more_law',
      featureLabel: 'Learn More About Law',
      category: 'search',
      description: 'Get detailed legal information and case law',
      basic: { enabled: false, limit: null },
      pro: { enabled: true, limit: null },
      premium: { enabled: true, limit: null },
    },
  ];
}

export default mongoose.model('FeatureAccess', featureAccessSchema);
