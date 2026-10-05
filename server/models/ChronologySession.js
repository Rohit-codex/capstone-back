import mongoose from 'mongoose';

const chronologySessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  guestId: {
    type: String,
    default: null
  },
  files: [{
    editSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EditSession'
    },
    fileName: String,
    fileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'File'
    }
  }],
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'completed_with_errors', 'failed'],
    default: 'pending'
  },
  events: [{
    date: { type: String },
    event: { type: String },
    significance: { type: String, default: '' },
    sourceFile: { type: String },
    category: {
      type: String,
      enum: ['court_date', 'deadline', 'execution', 'breach', 'filing', 'notice', 'hearing', 'order', 'other'],
      default: 'other'
    }
  }],
  summary: {
    type: String,
    default: ''
  },
  chatHistory: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: { type: String },
    timestamp: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

const ChronologySession = mongoose.model('ChronologySession', chronologySessionSchema);

export default ChronologySession;
