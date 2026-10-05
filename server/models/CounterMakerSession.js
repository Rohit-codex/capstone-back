import mongoose from 'mongoose';

const CounterMakerSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  complaintFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DocumentSession',
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  counterFacts: {
    type: String
  },
  draft: {
    title: { type: String },
    content: { type: String },
    analysis: { type: String }
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

CounterMakerSessionSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

export default mongoose.model('CounterMakerSession', CounterMakerSessionSchema);
