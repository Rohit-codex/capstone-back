import mongoose from 'mongoose';


const templateDesignSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  
  categories: [{
    type: String,
    trim: true
  }],
  
  isUniversal: {
    type: Boolean,
    default: false
  },
  
  previewImage: {
    type: String,
    default: null
  },
  
  config: {
    
    fontFamily: { type: String, default: 'Times New Roman' },
    fontSize: { type: Number, default: 12 },
    headingSize: { type: Number, default: 16 },
    lineSpacing: { type: Number, default: 1.15 },
    letterSpacing: { type: Number, default: 0 },
    paragraphSpacing: {
      before: { type: Number, default: 0 },
      after: { type: Number, default: 6 },
    },
    textTransform: {
      type: String,
      enum: ['none', 'uppercase', 'lowercase', 'capitalize'],
      default: 'none'
    },
    wordSpacing: { type: Number, default: 0 },

    
    pageSize: {
      type: String,
      enum: ['A4', 'Legal', 'Letter', 'A5'],
      default: 'A4'
    },
    pageOrientation: {
      type: String,
      enum: ['portrait', 'landscape'],
      default: 'portrait'
    },
    margins: {
      top: { type: Number, default: 1440 },
      bottom: { type: Number, default: 1440 },
      left: { type: Number, default: 1440 },
      right: { type: Number, default: 1440 },
    },
    firstLineIndent: { type: Number, default: 0 },

    
    titleAlignment: { 
      type: String, 
      enum: ['left', 'center', 'right'], 
      default: 'center' 
    },
    titleBold: { type: Boolean, default: true },
    titleUnderline: { type: Boolean, default: false },
    titleItalic: { type: Boolean, default: false },

    
    bodyAlignment: { 
      type: String, 
      enum: ['left', 'center', 'right', 'justified'], 
      default: 'justified' 
    },

    
    headerText: { type: String, default: '' },
    footerText: { type: String, default: '' },
    headerAlignment: {
      type: String,
      enum: ['left', 'center', 'right'],
      default: 'center'
    },
    footerAlignment: {
      type: String,
      enum: ['left', 'center', 'right'],
      default: 'center'
    },
    showHeaderOnFirst: { type: Boolean, default: true },
    showFooterOnFirst: { type: Boolean, default: true },
    pageNumbering: {
      type: String,
      enum: ['none', 'bottom-center', 'bottom-right', 'top-right'],
      default: 'none'
    },

    
    borderStyle: { 
      type: String, 
      enum: ['none', 'single', 'double', 'thick', 'dotted', 'dashed', 'shadow'],
      default: 'none' 
    },
    borderColor: { type: String, default: '#000000' },
    borderWidth: { type: Number, default: 1 },

    
    colorScheme: {
      primary: { type: String, default: '#000000' },
      accent: { type: String, default: '#1a365d' },
      background: { type: String, default: '#ffffff' },
    },

    
    watermarkText: { type: String, default: '' },
    watermarkOpacity: { type: Number, default: 0.1 },

    
    images: [{
      data: { type: String },
      label: { type: String, default: 'Image' },
      position: {
        type: String,
        enum: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right', 'center'],
        default: 'top-right'
      },
      width: { type: Number, default: 80 },
      height: { type: Number, default: 80 },
      opacity: { type: Number, default: 1 },
      isWatermark: { type: Boolean, default: false },
      offsetX: { type: Number, default: 0 },
      offsetY: { type: Number, default: 0 },
      
      placement: {
        type: String,
        enum: ['positioned', 'top-full-width', 'watermark'],
        default: 'positioned'
      },
      stampWidth: { type: Number, default: 100 },
      stampAlign: { type: String, enum: ['left', 'center', 'right'], default: 'center' },
      stampMarginBottom: { type: Number, default: 8 },
    }],
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  sortOrder: {
    type: Number,
    default: 0
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });


templateDesignSchema.pre('save', async function (next) {
  if (this.isDefault && this.isModified('isDefault')) {
    
    const conditions = this.isUniversal
      ? {}
      : { categories: { $in: this.categories } };
    
    await mongoose.model('TemplateDesign').updateMany(
      { ...conditions, _id: { $ne: this._id }, isDefault: true },
      { $set: { isDefault: false } }
    );
  }
  next();
});

export default mongoose.model('TemplateDesign', templateDesignSchema);
