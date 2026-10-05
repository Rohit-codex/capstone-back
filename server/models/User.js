import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  password: {
    type: String,
    required: function() {
      
      return !this.googleId;
    },
    select: false
  },
  firstName: {
    type: String,
    required: true,
    trim: true
  },
  lastName: {
    type: String,
    required: function() {
      // Not required when signing up via Google OAuth
      return !this.googleId;
    },
    trim: true,
    default: null
  },
  profileImage: {
    type: String,
    default: null
  },
  profileImagePublicId: {
    type: String,
    default: null
  },
  googleId: {
    type: String,
    sparse: true,
    default: null
  },
  otp: {
    code: String,
    expiresAt: Date
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: Date.now
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  companyName: {
    type: String,
    trim: true,
    default: null
  },
  sector: {
    type: String,
    trim: true,
    default: null
  },
  companySlug: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lastFailedLogin: {
    type: Date
  },
  accountLockedUntil: {
    type: Date
  },
  subscriptionStatus: {
    type: String,
    enum: ['free', 'basic', 'pro', 'premium', 'standard', 'departmental'],
    default: 'free'
  },
  
  userTier: {
    type: String,
    enum: ['basic', 'pro', 'premium', 'standard', 'departmental', 'free'],
    default: 'basic'
  },
  remainingMessages: {
    type: Number,
    default: 5
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  preferences: {
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    aiResponseLanguage: { type: String, enum: ['en', 'hi', 'auto'], default: 'auto' },
    defaultCourt: { type: String, default: '' },
    editorFontSize: { type: Number, default: 14, min: 10, max: 24 },
    theme: { type: String, enum: ['light', 'dark', 'system'], default: 'system' },
    autoSaveInterval: { type: Number, default: 3, min: 1, max: 30 },
    defaultJurisdiction: { type: String, default: '' },
    scanDepth: { type: String, enum: ['basic', 'thorough'], default: 'thorough' },
    showLineNumbers: { type: Boolean, default: false },
  }
}, {
  timestamps: true
});

const User = mongoose.model('User', userSchema);

export default User; 