import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_ROOTS = [
  path.join(__dirname, '..', 'templates', 'counter-affidavit'),
  path.join(__dirname, '..', 'counter-affidavit-designs'),
];

const designCache = new Map();
let registryCache = null;

function resolveDesignsRoot() {
  for (const root of TEMPLATE_ROOTS) {
    const regPath = path.join(root, 'registry.json');
    if (fs.existsSync(regPath)) return root;
  }
  return null;
}

function loadRegistry() {
  if (registryCache) return registryCache;
  const root = resolveDesignsRoot();
  if (!root) {
    throw new Error('No counter-affidavit templates found (templates/counter-affidavit/registry.json)');
  }
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'registry.json'), 'utf8'));
  registry._root = root;
  registryCache = registry;
  return registry;
}

export function listCounterAffidavitDesigns() {
  const registry = loadRegistry();
  return {
    defaultDesignId: registry.defaultDesignId,
    designs: (registry.designs || []).map((d) => ({
      id: d.id,
      label: d.label || d.id,
      description: d.description || '',
    })),
  };
}

export function getDefaultCounterDesignId() {
  return loadRegistry().defaultDesignId || 'india-formal-affidavit';
}

export function resolveCounterDesignId(requestedId) {
  const registry = loadRegistry();
  const id = String(requestedId || '').trim();
  if (id && (registry.designs || []).some((d) => d.id === id)) return id;
  
  // Validate that defaultDesignId exists in registry
  const defaultId = registry.defaultDesignId;
  if (defaultId && (registry.designs || []).some((d) => d.id === defaultId)) {
    return defaultId;
  }
  
  // Fall back to first registered design or null
  return (registry.designs || [])[0]?.id || null;
}

export function loadCounterAffidavitDesign(designId) {
  const id = resolveCounterDesignId(designId);
  if (process.env.NODE_ENV !== 'production' && designCache.has(id)) {
    designCache.delete(id);
  }
  if (designCache.has(id)) return designCache.get(id);

  const registry = loadRegistry();
  const entry = (registry.designs || []).find((d) => d.id === id);
  if (!entry?.path) {
    throw new Error(`Counter design "${id}" not found in registry`);
  }
  const designPath = path.join(registry._root, entry.path, 'design.json');
  if (!fs.existsSync(designPath)) {
    throw new Error(`Counter design file missing: ${entry.path}/design.json`);
  }
  const design = JSON.parse(fs.readFileSync(designPath, 'utf8'));
  design.id = design.id || id;
  designCache.set(id, design);
  return design;
}

/** Optional: map source document type from Smart Scan to a design id. */
export function suggestCounterDesignId(sourceDocumentType = '') {
  const t = String(sourceDocumentType || '').toLowerCase();
  const registry = loadRegistry();
  const has = (id) => (registry.designs || []).some((d) => d.id === id);
  if (/writ|criminal writ|habeas|mandamus|certiorari|quo warranto/.test(t)) {
    if (has('writ-petition-counter')) return 'writ-petition-counter';
  }
  if (/bail|anticipatory|regular bail|criminal misc|cr\.?\s*m\.?\s*p/.test(t)) {
    if (has('india-formal-affidavit')) return 'india-formal-affidavit';
  }
  if (/\bmjc\b|miscellaneous\s*jurisdiction|show\s*cause/i.test(t)) {
    if (has('mjc-show-cause-counter')) return 'mjc-show-cause-counter';
  }
  if (/\bmjc\s*no\.?/i.test(t)) {
    if (has('mjc-show-cause-counter')) return 'mjc-show-cause-counter';
  }
  return getDefaultCounterDesignId();
}
