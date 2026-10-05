import mongoose from 'mongoose';

const apiUsageSchema = new mongoose.Schema({
  apiKeyHash: {
    type: String,
    required: true,
    unique: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  lastUsed: {
    type: Date,
    default: Date.now
  }
});

const ApiUsage = mongoose.model('ApiUsage', apiUsageSchema);

export default ApiUsage;
