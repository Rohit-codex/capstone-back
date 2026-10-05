import mongoose from 'mongoose';

const messageCountSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  count: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});


messageCountSchema.index({ userId: 1, date: 1 }, { unique: true });

const MessageCount = mongoose.model('MessageCount', messageCountSchema);

export default MessageCount; 