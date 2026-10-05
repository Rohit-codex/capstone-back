import mongoose from 'mongoose';

const bulkReviewSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  guestId: {
    type: String,
    default: null
  },
  fileIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File'
  }],
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'completed_with_errors', 'failed'],
    default: 'pending'
  },
  documents: [{
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File'
    },
    fileName: {
      type: String,
      required: true
    },
    originalText: {
      type: String
    },
    context: {
      type: String
    },
    keyPoints: {
      type: String
    },
    synthesis: {
      type: String
    },
    dates: [{
      date: { type: String },
      event: { type: String },
      significance: { type: String },
      entitiesInvolved: [String]
    }]
  }],
  chatHistory: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: { type: String },
    timestamp: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

const BulkReview = mongoose.model('BulkReview', bulkReviewSchema);

export default BulkReview;
