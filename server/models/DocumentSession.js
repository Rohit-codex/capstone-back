import mongoose from 'mongoose';

const documentSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  slug: {
    type: String,
    default: 'default',
    index: true
  },
  
  
  template: {
    relPath: String,
    displayTitle: String,
    schema: [Object]
  },
  
  
  requiredFields: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  
  
  accumulatedData: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: new Map()
  },
  
  
  fields: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  
  missingFields: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  
  
  status: {
    type: String,
    enum: ['active', 'completed', 'abandoned'],
    default: 'active'
  },
  
  
  turnCount: {
    type: Number,
    default: 0
  },
  
  
  conversationHistory: [{
    turn: Number,
    userMessage: String,
    assistantResponse: String,
    extractedThisTurn: Map,
    stillMissing: [String],
    timestamp: Date
  }],
  
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
    expires: 86400
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});


documentSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const DocumentSession = mongoose.model('DocumentSession', documentSessionSchema);
export default DocumentSession;
