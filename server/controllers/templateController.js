import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { docxToHtml } from '../utils/docxFormatExtractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BASE_DIR = path.join(__dirname, '..', 'normalized_templates');

function readJsonMetadataForTemplate(templatePath) {
  const jsonPath = templatePath.replace(/\.(docx|rtf)$/i, '.json');
  try {
    if (!fs.existsSync(jsonPath)) return null;
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function readDescriptionFiles(templatePath) {
  const basePath = templatePath.replace(/\.(docx|rtf)$/i, '');
  const enPath = `${basePath}.desc.en.txt`;
  const hiPath = `${basePath}.desc.hi.txt`;
  const out = { en: '', hi: '' };

  try {
    if (fs.existsSync(enPath)) out.en = fs.readFileSync(enPath, 'utf-8').trim();
  } catch {}

  try {
    if (fs.existsSync(hiPath)) out.hi = fs.readFileSync(hiPath, 'utf-8').trim();
  } catch {}

  return out;
}

function formatCategoryPath(pathStr) {
  return pathStr
    .split('/').filter(Boolean)
    .map((seg) => formatCategoryName(seg))
    .join(' / ');
}

function listTemplateFilesRecursive(dir, relBase = '') {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const out = [];

  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const abs = path.join(dir, ent.name);
    const rel = path.join(relBase, ent.name).replace(/\\/g, '/');
    if (ent.isDirectory()) {
      out.push(...listTemplateFilesRecursive(abs, rel));
    } else if (ent.isFile() && (ent.name.toLowerCase().endsWith('.docx') || ent.name.toLowerCase().endsWith('.rtf'))) {
      out.push({ abs, rel });
    }
  }

  return out;
}

function safeResolveCategory(category) {
  const resolved = path.resolve(BASE_DIR, category || '');
  if (!resolved.startsWith(BASE_DIR)) {
    throw new Error('Invalid category path');
  }
  return resolved;
}

function readTemplatePreview(filePath, maxChars = 600) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const cleaned = raw.replace(/\s+/g, ' ').trim();
    return cleaned.slice(0, maxChars) + (cleaned.length > maxChars ? '...' : '');
  } catch (err) {
    return '';
  }
}

function formatCategoryName(slug) {
  return slug
    .split(/[-_]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export const listCategories = (req, res) => {
  try {
    if (!fs.existsSync(BASE_DIR)) {
      return res.json({ categories: [] });
    }

    const dirents = fs.readdirSync(BASE_DIR, { withFileTypes: true });
    const categories = dirents
      .filter(d => d.isDirectory())
      .map(d => {
        const catPath = path.join(BASE_DIR, d.name);
        let count = 0;
        try {
          count = listTemplateFilesRecursive(catPath).length;
        } catch (e) {
          
        }
        return {
          name: formatCategoryName(d.name),
          slug: d.name,
          templateCount: count
        };
      })
      .filter(c => c.templateCount > 0);

    return res.json({ categories });
  } catch (err) {
    console.error('Error listing categories:', err);
    return res.status(500).json({ message: 'Failed to list categories.' });
  }
};

export const previewTemplates = (req, res) => {
  try {
    const { category, limit = 10, search } = req.query;
    const safeLimit = Math.min(parseInt(limit, 10) || 10, 50);

    if (!fs.existsSync(BASE_DIR)) {
      return res.json({ templates: [] });
    }

    let fileEntries = [];

    if (category) {
      
      const catPath = safeResolveCategory(category);
      if (!fs.existsSync(catPath)) {
        return res.json({ templates: [] });
      }
      const files = listTemplateFilesRecursive(catPath, category);
      fileEntries = files.map(({ abs, rel }) => {
        const meta = readJsonMetadataForTemplate(abs);
        const desc = readDescriptionFiles(abs);
        const metaTitle = meta?.title ? meta.title.replace(/\s+/g, ' ').trim() : '';
        const name = metaTitle || path.basename(rel, path.extname(rel)).replace(/[-_]/g, ' ');
        const categoryPath = path.posix.dirname(rel).split('/').slice(0, -1).join('/');
        return {
          category: categoryPath || category,
          categoryName: formatCategoryPath(categoryPath || category),
          name,
          fileName: path.basename(rel),
          relPath: rel,
          fullPath: abs,
          descriptionEn: desc.en || meta?.description || '',
          descriptionHi: desc.hi || meta?.description || ''
        };
      });
    } else {
      
      const dirents = fs.readdirSync(BASE_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
      dirents.forEach(d => {
        const catPath = path.join(BASE_DIR, d.name);
        try {
          const files = listTemplateFilesRecursive(catPath, d.name);
          files.forEach(({ abs, rel }) => {
            const meta = readJsonMetadataForTemplate(abs);
            const desc = readDescriptionFiles(abs);
            const metaTitle = meta?.title ? meta.title.replace(/\s+/g, ' ').trim() : '';
            const name = metaTitle || path.basename(rel, path.extname(rel)).replace(/[-_]/g, ' ');
            const categoryPath = path.posix.dirname(rel).split('/').slice(0, -1).join('/');
            fileEntries.push({
              category: categoryPath || d.name,
              categoryName: formatCategoryPath(categoryPath || d.name),
              name,
              fileName: path.basename(rel),
              relPath: rel,
              fullPath: abs,
              descriptionEn: desc.en || meta?.description || '',
              descriptionHi: desc.hi || meta?.description || ''
            });
          });
        } catch (e) {
          
        }
      });
    }

    
    if (search) {
      const s = search.toLowerCase();
      fileEntries = fileEntries.filter(e => 
        e.name.toLowerCase().includes(s) || 
        e.categoryName.toLowerCase().includes(s)
      );
    }

    
    const previews = fileEntries.slice(0, safeLimit).map(e => ({
      category: e.category,
      categoryName: e.categoryName,
      name: e.name,
      relPath: e.relPath,
      previewEn: e.descriptionEn || '',
      previewHi: e.descriptionHi || '',
      preview: e.descriptionEn || e.descriptionHi || ''
    }));

    return res.json({ 
      templates: previews,
      total: fileEntries.length,
      showing: previews.length
    });
  } catch (err) {
    console.error('Error loading template previews:', err);
    return res.status(500).json({ message: 'Failed to load template previews.' });
  }
};

export const getTemplateContent = (req, res) => {
  try {
    const { category, filename } = req.params;
    
    if (!category || !filename) {
      return res.status(400).json({ message: 'Category and filename required.' });
    }

    const catPath = safeResolveCategory(category);
    const filePath = path.join(catPath, filename);
    
    
    if (!filePath.startsWith(BASE_DIR)) {
      return res.status(400).json({ message: 'Invalid path.' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Template not found.' });
    }

    const meta = readJsonMetadataForTemplate(filePath);
    const desc = readDescriptionFiles(filePath);
    const metaTitle = meta?.title ? meta.title.replace(/\s+/g, ' ').trim() : '';
    const name = metaTitle || path.basename(filename, path.extname(filename)).replace(/[-_]/g, ' ');
    
    return res.json({
      category,
      categoryName: formatCategoryName(category),
      name,
      fileName: filename,
      content: meta?.description || '',
      descriptionEn: desc.en || meta?.description || '',
      descriptionHi: desc.hi || meta?.description || ''
    });
  } catch (err) {
    console.error('Error getting template content:', err);
    return res.status(500).json({ message: 'Failed to load template.' });
  }
};

export const listAllTemplates = (req, res) => {
  try {
    if (!fs.existsSync(BASE_DIR)) {
      return res.json({ templates: [], categories: [] });
    }

    const templates = [];
    const categoriesSet = new Set();

    const dirents = fs.readdirSync(BASE_DIR, { withFileTypes: true }).filter(d => d.isDirectory());
    
    dirents.forEach(d => {
      const catPath = path.join(BASE_DIR, d.name);
      const categoryName = formatCategoryName(d.name);
      
      try {
        const files = listTemplateFilesRecursive(catPath, d.name);
        files.forEach(({ abs, rel }) => {
          const meta = readJsonMetadataForTemplate(abs);
          const desc = readDescriptionFiles(abs);
          const metaTitle = meta?.title ? meta.title.replace(/\s+/g, ' ').trim() : '';
          const displayTitle = metaTitle || path.basename(rel, path.extname(rel)).replace(/[-_]/g, ' ');
          const relPath = rel.replace(/\\/g, '/');
          const categoryPath = path.posix.dirname(relPath).split('/').slice(0, -1).join('/');
          const categoryName = formatCategoryPath(categoryPath || d.name);

          const keywords = [displayTitle, meta?.description || '', desc.en || '', desc.hi || '']
            .join(' ')
            .toLowerCase()
            .split(/\s+/)
            .filter(w => w.length > 2);
          
          templates.push({
            displayTitle,
            category: categoryName,
            categorySlug: categoryPath || d.name,
            fileName: path.basename(relPath),
            relPath,
            keywords,
            descriptionEn: desc.en || meta?.description || '',
            descriptionHi: desc.hi || meta?.description || ''
          });
          
          categoriesSet.add(categoryName);
        });
      } catch (e) {
        
      }
    });

    return res.json({ 
      templates,
      categories: Array.from(categoriesSet),
      total: templates.length
    });
  } catch (err) {
    console.error('Error listing all templates:', err);
    return res.status(500).json({ message: 'Failed to list templates.' });
  }
};

export const previewSingleTemplate = (req, res) => {
  try {
    
    const relPath = req.params[0];
    
    if (!relPath) {
      return res.status(400).json({ message: 'Template path required.' });
    }

    
    const decodedPath = decodeURIComponent(relPath);
    const filePath = path.join(BASE_DIR, decodedPath);
    
    
    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(BASE_DIR))) {
      return res.status(400).json({ message: 'Invalid path.' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Template not found.' });
    }

    const meta = readJsonMetadataForTemplate(filePath);
    const desc = readDescriptionFiles(filePath);
    const fallback = (meta?.description || '').trim();
    const previewEn = (desc.en || fallback).trim();
    const previewHi = (desc.hi || fallback).trim();
    
    return res.json({
      previewEn,
      previewHi,
      preview: previewEn || previewHi || 'Preview not available',
      fullLength: (previewEn || previewHi || '').length
    });
  } catch (err) {
    console.error('Error previewing template:', err);
    return res.status(500).json({ message: 'Failed to preview template.' });
  }
};

export const loadTemplateAsHtml = async (req, res) => {
  try {
    
    const relPath = decodeURIComponent(req.params[0] || '');
    if (!relPath) {
      return res.status(400).json({ message: 'relPath is required.' });
    }

    const filePath = path.resolve(BASE_DIR, relPath);
    
    if (!filePath.startsWith(path.resolve(BASE_DIR))) {
      return res.status(403).json({ message: 'Access denied.' });
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ message: 'Template file not found.' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath, ext);
    let htmlContent = '';

    if (ext === '.docx') {
      const buffer = fs.readFileSync(filePath);
      htmlContent = await docxToHtml(buffer);
    } else {
      
      const raw = fs.readFileSync(filePath, 'utf-8');
      const lines = raw.split(/\r?\n/);
      htmlContent = lines
        .map(l => (l.trim() ? `<p>${l.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>` : '<p><br/></p>'))
        .join('\n');
    }

    return res.json({ htmlContent, fileName });
  } catch (err) {
    console.error('Error loading template as HTML:', err);
    return res.status(500).json({ message: 'Failed to load template.' });
  }
};
