import mongoose from 'mongoose';

const researchSessionSchema = new mongoose.Schema({
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
  agent1Data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  agent2Data: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  agent3Summary: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  chatHistory: [{
    role: { type: String, enum: ['user', 'assistant'] },
    content: { type: String },
    timestamp: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

const ResearchSession = mongoose.model('ResearchSession', researchSessionSchema);

export default ResearchSession;
