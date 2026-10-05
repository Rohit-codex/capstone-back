import mongoose from 'mongoose';

const chatSchema = new mongoose.Schema({
  userId: {
    type: String,
    required: true
  },
  slug: {
    type: String,
    required: true,
    default: 'default'
  },
  title: {
    type: String,
    default: 'New Conversation'
  },
  activeFileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    default: null
  },
  researchSessionId: {
    type: String,
    default: null
  },
  chronologySessionId: {
    type: String,
    default: null
  },
  bulkReviewSessionId: {
    type: String,
    default: null
  },
  reviewFileIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File'
  }],
  chronologyFileIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File'
  }],
  messages: [{
    role: {
      type: String,
      required: true,
      enum: ['user', 'assistant']
    },
    content: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    
    suggestedActions: {
      type: Array,
      default: undefined
    },
    mode: {
      type: String,
      default: undefined
    },
    file: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined
    },
    missingFields: {
      type: Array,
      default: undefined
    },
    templatePath: {
      type: String,
      default: undefined
    },
    templateTitle: {
      type: String,
      default: undefined
    },
    hidden: {
      type: Boolean,
      default: false
    }
  }]
}, {
  timestamps: true
});

chatSchema.index({ userId: 1, slug: 1 }, { unique: true });

const Chat = mongoose.model('Chat', chatSchema);

export default Chat;