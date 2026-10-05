import mongoose from 'mongoose';

const PrecedenceSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentSession',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  analysisReport: {
    legalIssues: [{ type: String }],
    precedents: [{
      caseName: { type: String },
      citation: { type: String },
      court: { type: String },
      year: { type: String },
      relevance: { type: String },
      summary: { type: String }
    }],
    overallSummary: { type: String }
  },
  error: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

PrecedenceSessionSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('PrecedenceSession', PrecedenceSessionSchema);
