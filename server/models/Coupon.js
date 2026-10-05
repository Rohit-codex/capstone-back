import mongoose from 'mongoose';

const couponSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  discountPercentage: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  maxUses: {
    type: Number,
    required: true,
    min: 1
  },
  currentUses: {
    type: Number,
    default: 0
  },
  validFrom: {
    type: Date,
    required: true
  },
  validUntil: {
    type: Date,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  usedBy: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    usedAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});




couponSchema.methods.isValid = function() {
  const now = new Date();
  return (
    this.isActive &&
    this.currentUses < this.maxUses &&
    now >= this.validFrom &&
    now <= this.validUntil
  );
};


couponSchema.methods.hasUserUsed = function(userId) {
  return this.usedBy.some(usage => usage.user.toString() === userId.toString());
};


couponSchema.methods.apply = async function(userId) {
  if (!this.isValid()) {
    throw new Error('Coupon is not valid');
  }
  
  if (this.hasUserUsed(userId)) {
    throw new Error('Coupon already used by this user');
  }

  this.currentUses += 1;
  this.usedBy.push({ user: userId });
  
  if (this.currentUses >= this.maxUses) {
    this.isActive = false;
  }

  await this.save();
  return this.discountPercentage;
};

const Coupon = mongoose.model('Coupon', couponSchema);

export default Coupon; 