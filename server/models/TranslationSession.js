import mongoose from 'mongoose';

const translationSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  guestId: {
    type: String,
    default: null
  },
  fileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'File',
    required: true
  },
  targetLanguage: {
    type: String,
    default: 'Hindi'
  },
  isInPlace: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: 'pending'
  },
  originalText: {
    type: String,
    default: null
  },
  translatedText: {
    type: String,
    default: null
  },
  translatedDict: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  translatedImageBase64: {
    type: String,
    default: null
  },
  originalBlocks: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  imageDimensions: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  landRecordData: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  usageCount: {
    type: Number,
    default: 0
  },
  maxUsage: {
    type: Number,
    default: 0
  },
  errorDetails: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

const TranslationSession = mongoose.model('TranslationSession', translationSessionSchema);

export default TranslationSession;
