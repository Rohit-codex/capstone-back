import TemplateDesign from '../models/TemplateDesign.js';
import { AppError } from '../utils/errors.js';
import fs from 'fs/promises';
import path from 'path';
import multer from 'multer';
import os from 'os';
import { extractDocxFormatting, extractDocxImages } from '../utils/docxFormatExtractor.js';

function validateImages(images) {
  if (!images || !Array.isArray(images)) return;
  
  
  if (images.length > 10) {
    throw new AppError('Maximum 10 images allowed per template design', 400);
  }
  
  
  let totalSize = 0;
  for (const img of images) {
    if (img.data) {
      
      const base64Data = img.data.includes(',') ? img.data.split(',')[1] : img.data;
      
      const estimatedBytes = (base64Data.length * 0.75);
      totalSize += estimatedBytes;
    }
  }
  
  const maxSize = 10 * 1024 * 1024;
  if (totalSize > maxSize) {
    const totalMB = (totalSize / (1024 * 1024)).toFixed(2);
    throw new AppError(`Total image size (${totalMB}MB) exceeds 10MB limit`, 400);
  }
}

export const getTemplateDesigns = async (req, res) => {
  try {
    const { category, activeOnly } = req.query;
    const query = {};
    if (category) {
      query.$or = [
        { categories: category },
        { isUniversal: true }
      ];
    }
    if (activeOnly === 'true') {
      query.isActive = true;
    }
    const designs = await TemplateDesign.find(query)
      .sort({ sortOrder: 1, createdAt: -1 })
      .lean();
    res.json({ success: true, designs });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching template designs', 500);
  }
};

export const getTemplateDesignCategories = async (req, res) => {
  try {
    const templatesDir = path.resolve(process.cwd(), 'normalized_templates');
    let categories = [];
    try {
      const entries = await fs.readdir(templatesDir, { withFileTypes: true });
      categories = entries
        .filter(e => e.isDirectory())
        .map(e => e.name)
        .sort();
    } catch (_) {
      
      categories = [
        'Adoption Drafts', 'Affidavit Formats', 'Arbitration Agreement',
        'Bond Drafts', 'Criminal Pleadings Drafts', 'Deeds',
        'Family Law Drafts', 'Legal Notice', 'MVA Drafts',
        'NI Drafts', 'Power of Attorney Drafts', 'Rent Drafts',
        'RTI Drafts', 'SLP Formats', 'SRA Drafts',
        'Will & Gift Deed', 'Writ Drafts'
      ];
    }
    res.json({ success: true, categories });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching categories', 500);
  }
};

export const createTemplateDesign = async (req, res) => {
  try {
    const { name, description, categories, isUniversal, config, previewImage, isDefault } = req.body;
    if (!name) throw new AppError('Design name is required', 400);

    
    if (config?.images) {
      validateImages(config.images);
    }

    const design = new TemplateDesign({
      name,
      description,
      categories: categories || [],
      isUniversal: isUniversal || false,
      config: config || {},
      previewImage,
      isDefault: isDefault || false,
      createdBy: req.user.id,
    });

    await design.save();
    res.status(201).json({ success: true, design });
  } catch (error) {
    throw new AppError(error.message || 'Error creating template design', 500);
  }
};

export const updateTemplateDesign = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    
    if (updates.config?.images) {
      validateImages(updates.config.images);
    }

    const design = await TemplateDesign.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!design) throw new AppError('Template design not found', 404);

    res.json({ success: true, design });
  } catch (error) {
    throw new AppError(error.message || 'Error updating template design', 500);
  }
};

export const deleteTemplateDesign = async (req, res) => {
  try {
    const { id } = req.params;
    const design = await TemplateDesign.findByIdAndDelete(id);
    if (!design) throw new AppError('Template design not found', 404);
    res.json({ success: true, message: 'Template design deleted' });
  } catch (error) {
    throw new AppError(error.message || 'Error deleting template design', 500);
  }
};

export const getActiveDesignsForCategory = async (req, res) => {
  try {
    const { category } = req.query;
    const query = {
      isActive: true,
      $or: [
        { isUniversal: true },
        ...(category ? [{ categories: category }] : [])
      ]
    };
    const designs = await TemplateDesign.find(query)
      .select('name description previewImage config isDefault sortOrder categories')
      .sort({ isDefault: -1, sortOrder: 1 })
      .lean();
    res.json({ success: true, designs });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching designs', 500);
  }
};

export const matchDesignsToDocument = async (req, res) => {
  try {
    const { title, content } = req.body;
    
    if (!title && !content) {
      return res.json({ success: true, designs: [], matchedCategory: null });
    }
    
    
    const searchText = `${title || ''} ${(content || '').substring(0, 500)}`.toLowerCase();
    
    
    const templatesDir = path.resolve(process.cwd(), 'normalized_templates');
    let categories = [];
    try {
      const entries = await fs.readdir(templatesDir, { withFileTypes: true });
      categories = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch (_) {
      categories = [
        'Adoption Drafts', 'Affidavit Formats', 'Arbitration Agreement',
        'BNS Drafts', 'Bond Drafts', 'Criminal Pleadings Drafts', 'Deeds',
        'Family Law Drafts', 'Legal Notice', 'MVA Drafts', 'NI Drafts',
        'Power of Attorney Drafts', 'Rent Drafts', 'Rental Agreements',
        'RTI Drafts', 'SLP Formats', 'SRA Drafts', 'Will & Gift Deed', 'Writ Drafts'
      ];
    }
    
    
    const categoryKeywords = {
      'Adoption Drafts': ['adoption', 'adopt', 'adopted', 'adoptive', 'child adoption'],
      'Affidavit Formats': ['affidavit', 'sworn', 'oath', 'declaration', 'deponent'],
      'Arbitration Agreement': ['arbitration', 'arbitrator', 'dispute resolution', 'mediation'],
      'BNS Drafts': ['bns', 'bharatiya nyaya', 'criminal', 'penal'],
      'Bond Drafts': ['bond', 'surety', 'indemnity', 'guarantee', 'bail bond'],
      'Criminal Pleadings Drafts': ['criminal', 'fir', 'bail', 'anticipatory', 'quashing', 'complaint', 'charge sheet'],
      'Deeds': ['deed', 'conveyance', 'transfer', 'sale deed', 'mortgage', 'lease deed', 'agreement'],
      'Family Law Drafts': ['family', 'divorce', 'custody', 'maintenance', 'matrimonial', 'alimony', 'marriage', 'domestic violence'],
      'Legal Notice': ['legal notice', 'notice', 'demand', 'cease and desist', 'reply to notice'],
      'MVA Drafts': ['mva', 'motor vehicle', 'accident', 'vehicle', 'motor accident', 'compensation'],
      'NI Drafts': ['negotiable instrument', 'cheque', 'bounce', 'dishonour', 'promissory note', 'bill of exchange'],
      'Power of Attorney Drafts': ['power of attorney', 'poa', 'attorney', 'authorisation', 'authorization', 'proxy'],
      'Rent Drafts': ['rent', 'rental', 'tenant', 'landlord', 'lease', 'eviction', 'tenancy'],
      'Rental Agreements': ['rental agreement', 'rent agreement', 'lease agreement', 'tenancy agreement'],
      'RTI Drafts': ['rti', 'right to information', 'information', 'public authority', 'transparency'],
      'SLP Formats': ['slp', 'special leave', 'supreme court', 'petition'],
      'SRA Drafts': ['sra', 'sarfaesi', 'securitization', 'recovery', 'debt recovery'],
      'Will & Gift Deed': ['will', 'testament', 'gift', 'gift deed', 'probate', 'succession', 'inheritance', 'bequest'],
      'Writ Drafts': ['writ', 'habeas corpus', 'mandamus', 'certiorari', 'prohibition', 'quo warranto', 'fundamental rights']
    };
    
    
    const scored = [];
    for (const category of categories) {
      const keywords = categoryKeywords[category] || [category.toLowerCase().replace(/\s*(drafts?|formats?|agreements?)\s*/gi, ' ').trim().split(/\s+/)];
      let score = 0;
      const keywordArr = Array.isArray(keywords) ? keywords : [keywords];
      
      for (const keyword of keywordArr) {
        const kw = typeof keyword === 'string' ? keyword.toLowerCase() : '';
        if (!kw) continue;
        
        
        if ((title || '').toLowerCase().includes(kw)) {
          score += kw.split(' ').length > 1 ? 10 : 5;
        }
        
        if (searchText.includes(kw)) {
          score += kw.split(' ').length > 1 ? 4 : 2;
        }
      }
      
      if (score > 0) {
        scored.push({ category, score });
      }
    }
    
    
    scored.sort((a, b) => b.score - a.score);
    const topCategory = scored.length > 0 ? scored[0].category : null;
    const matchedCategories = scored.filter(s => s.score >= 2).slice(0, 3).map(s => s.category);
    
    if (!topCategory) {
      
      const universalDesigns = await TemplateDesign.find({ isActive: true, isUniversal: true })
        .select('name description previewImage config isDefault sortOrder categories')
        .sort({ isDefault: -1, sortOrder: 1 })
        .lean();
      return res.json({ success: true, designs: universalDesigns, matchedCategory: null, matchedCategories: [] });
    }
    
    
    const query = {
      isActive: true,
      $or: [
        { isUniversal: true },
        { categories: { $in: matchedCategories } }
      ]
    };
    
    const designs = await TemplateDesign.find(query)
      .select('name description previewImage config isDefault sortOrder categories')
      .sort({ isDefault: -1, sortOrder: 1 })
      .lean();
    
    res.json({
      success: true,
      designs,
      matchedCategory: topCategory,
      matchedCategories,
      confidence: scored[0]?.score || 0
    });
  } catch (error) {
    console.error('Error matching designs:', error);
    throw new AppError(error.message || 'Error matching designs to document', 500);
  }
};

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const tmpDir = path.join(os.tmpdir(), 'docx-analysis');
    await fs.mkdir(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      cb(null, true);
    } else {
      cb(new AppError('Only .docx files are supported', 400), false);
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

export const uploadMiddleware = upload.single('file');

export const analyzeUploadedDocument = async (req, res) => {
  try {
    if (!req.file) {
      throw new AppError('No file uploaded', 400);
    }

    const filePath = req.file.path;
    console.log('📄 Analyzing document:', filePath);

    const config = await analyzeDocxFormatting(filePath);

    await fs.unlink(filePath).catch(err => console.warn('Failed to delete temp file:', err));

    res.json({
      success: true,
      config,
      message: 'Document analyzed successfully. Please verify margins and borders.'
    });
  } catch (error) {
    console.error('Error analyzing document:', error);
    throw new AppError(error.message || 'Error analyzing document', 500);
  }
};

async function analyzeDocxFormatting(filePath) {
  const buffer = await fs.readFile(filePath);

  
  const meta = await extractDocxFormatting(buffer);
  
  const images = await extractDocxImages(buffer);

  
  const alignMap = { left: 'left', center: 'center', right: 'right', both: 'justify', justify: 'justify' };
  const bodyAlignment = alignMap[meta.bodyAlignment] || 'left';

  
  const heading1 = meta.headingStyles?.Heading1 || {};
  const headingSize = heading1.fontSize || meta.defaultFontSize + 4;

  
  const titleBold = heading1.bold !== undefined ? heading1.bold : true;

  
  const primaryColor = meta.colors?.textColor && meta.colors.textColor !== '000000'
    ? `#${meta.colors.textColor}` : '#000000';
  const accentColor = meta.colors?.accentColor && meta.colors.accentColor !== '000000'
    ? `#${meta.colors.accentColor}` : '#1a1a1a';

  return {
    fontFamily: meta.defaultFont || 'Times New Roman',
    fontSize: meta.defaultFontSize || 12,
    headingSize,
    titleAlignment: bodyAlignment === 'center' ? 'center' : 'left',
    bodyAlignment,
    titleBold,
    titleUnderline: false,
    lineSpacing: meta.lineSpacing || 1.15,
    margins: {
      top: meta.margins.top,
      bottom: meta.margins.bottom,
      left: meta.margins.left,
      right: meta.margins.right,
    },
    borderStyle: meta.borderStyle || 'none',
    watermarkText: '',
    watermarkOpacity: 0.15,
    colorScheme: { primary: primaryColor, accent: accentColor },
    images,
    
    _meta: {
      pageSize: meta.pageSize,
      detectedFonts: meta.detectedFonts,
      detectedFontSizes: meta.detectedFontSizes,
      headerText: meta.headerText,
      footerText: meta.footerText,
    },
  };
}
