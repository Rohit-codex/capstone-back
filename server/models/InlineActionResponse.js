import mongoose from 'mongoose';

const InlineActionResponseSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  actionType: {
    type: String,
    required: true,
    enum: [
      'GENERATE_COMPLAINT',
      'LEARN_MORE_LAW',
      'CASE_SEARCH',
      'BROWSE_TEMPLATES',
      'DOCUMENT_REQUEST',
      'LEGAL_INFORMATION',
      'CREATE_DOCUMENT',
      'GUIDE_ME',
      'OTHER'
    ],
    index: true
  },
  
  actionContext: {
    
    originalMessage: String,
    
    
    aiResponseExcerpt: String,
    
    
    lawSections: [String],
    
    
    documentType: String,
    
    
    metadata: mongoose.Schema.Types.Mixed
  },
  
  userResponses: {
    
    
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  generatedContent: {
    
    content: String,
    
    
    downloadUrl: String,
    
    
    fileName: String,
    fileType: String
  },
  
  status: {
    type: String,
    enum: ['pending', 'completed', 'abandoned'],
    default: 'pending',
    index: true
  },
  
  
  completedAt: Date,
  
  
  abandonedAt: Date
  
}, {
  timestamps: true
});


InlineActionResponseSchema.index({ userId: 1, createdAt: -1 });
InlineActionResponseSchema.index({ actionType: 1, status: 1 });


InlineActionResponseSchema.virtual('duration').get(function() {
  if (this.completedAt) {
    return this.completedAt - this.createdAt;
  }
  return null;
});


InlineActionResponseSchema.methods.markCompleted = function(generatedContent) {
  this.status = 'completed';
  this.completedAt = new Date();
  if (generatedContent) {
    this.generatedContent = generatedContent;
  }
  return this.save();
};


InlineActionResponseSchema.methods.markAbandoned = function() {
  this.status = 'abandoned';
  this.abandonedAt = new Date();
  return this.save();
};


InlineActionResponseSchema.statics.getUserRecentActions = function(userId, limit = 10) {
  return this.find({ userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
};


InlineActionResponseSchema.statics.getActionTypeStats = async function(actionType, dateRange) {
  const query = { actionType };
  if (dateRange?.start && dateRange?.end) {
    query.createdAt = { $gte: dateRange.start, $lte: dateRange.end };
  }
  
  const total = await this.countDocuments(query);
  const completed = await this.countDocuments({ ...query, status: 'completed' });
  const abandoned = await this.countDocuments({ ...query, status: 'abandoned' });
  
  return {
    actionType,
    total,
    completed,
    abandoned,
    pending: total - completed - abandoned,
    completionRate: total > 0 ? (completed / total * 100).toFixed(2) : 0
  };
};

const InlineActionResponse = mongoose.model('InlineActionResponse', InlineActionResponseSchema);

export default InlineActionResponse;
