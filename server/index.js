// Dastavezai API Server - v2.1.0
import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import 'dotenv/config';

import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import helmet from 'helmet';
import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import profileRoutes from './routes/profile.js';
import contactRoutes from './routes/contactRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import draftRoutes from './routes/draftRoutes.js';
import caseRoutes from './routes/caseRoutes.js';
import fileRoutes from './routes/fileRoutes.js';
import knowledgeRoutes from './routes/knowledgeRoutes.js';
import legalRoutes from './routes/legalRoutes.js';
import templateRoutes from './routes/templateRoutes.js';
import researchRoutes from './routes/researchRoutes.js';
import bulkReviewRoutes from './routes/bulkReviewRoutes.js';
import lawyerRoutes from './routes/lawyerRoutes.js';
import chronologyRoutes from './routes/chronologyRoutes.js';
import precedenceRoutes from './routes/precedenceRoutes.js';
import counterMakerRoutes from './routes/counterMakerRoutes.js';
import ocrRoutes from './routes/ocrRoutes.js';
import translationRoutes from './routes/translationRoutes.js';
import biharBhumiRoutes from './routes/biharBhumiRoutes.js';
import { authenticateJWT } from './middleware/auth.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { errorHandler } from './middleware/errorHandler.js';
import templates from './utils/templateIndex.js';
import fs from 'fs/promises';
import { scheduleCleanup } from './utils/fileHandler.js';
import redis from './utils/redisClient.js';
import { logger, logMiddleware } from './utils/logger.js';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import seedDeptUser from './scripts/seedDeptUser.js';
import seedAdminUser from './scripts/seedAdminUser.js';
import seedTestUser from './scripts/seedTestUser.js';
import { isAdobePdfConfigured } from './services/adobePdfService.js';


scheduleCleanup();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const app = express();
// Behind Railway/proxy, trust first hop so rate-limit gets real client IP from X-Forwarded-For.
app.set('trust proxy', 1);


const corsOriginsEnv = process.env.CORS_ORIGINS || '';
const allowedOrigins = corsOriginsEnv
  .split(',')
  .map(o => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

const isProd = process.env.NODE_ENV === 'production';
const secureOrigins = isProd
  ? allowedOrigins.filter(o => o.startsWith('https://'))
  : allowedOrigins;

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (secureOrigins.length === 0) return callback(null, true);
    const isAllowed = secureOrigins.includes(origin);
    if (isAllowed) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },  credentials: true
}));
app.use(helmet());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(logMiddleware);

if (isProd && process.env.HTTPS_REDIRECT === 'true') {
  app.use((req, res, next) => {
    const proto = req.headers['x-forwarded-proto'];
    if (proto && proto !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }
    next();
  });
}

const llmProvider = (process.env.LLM_PROVIDER || '').toLowerCase();
const requiredEnv = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'MONGODB_URI'];
if (llmProvider === 'groq') {
  requiredEnv.push('GROQ_API_KEY');
} else if (llmProvider === 'openrouter') {
  requiredEnv.push('OPENROUTER_API_KEY');
} else if (llmProvider === 'ollama') {
  // No API key required for local Ollama.
} else {
  requiredEnv.push('GEMINI_API_KEY');
}
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    logger.warn(`Missing env: ${key}`);
  }
});



app.use((req, res, next) => {
  const rid = Math.random().toString(36).slice(2, 10);
  const start = Date.now();
  req.requestId = rid;
  res.setHeader('X-Request-ID', rid);
  console.log(`➡️  [${rid}] ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    console.log(`⬅️  [${rid}] ${req.method} ${req.originalUrl} → ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});


const PORT = process.env.PORT || 5000;

const startServer = () => {
  app.listen(PORT, () => {
    const isDev = process.env.NODE_ENV === 'development';
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`🔗 API Base URL: http://localhost:${PORT}/api`);
    console.log(`🔐 JWT Secret configured: ${process.env.JWT_SECRET ? 'Yes' : 'No (using fallback)'}`);

    if (isDev) {
      console.log('\n⚠️  DEVELOPMENT MODE - Security Features Bypassed:');
      console.log('   ✓ JWT tokens: 24h expiration (vs 20m in production)');
      console.log('   ✓ Token expiration: Ignored for convenience');
      console.log('   ✓ CSRF validation: Disabled');
      console.log('   ✓ All Phase 1 & Phase 2 security: Relaxed for testing');
      console.log('   ⚡ Production will enforce all security features\n');
    }
  });
};

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dastavez')
  .then(async () => {
    console.log('✅ Connected to MongoDB');
    
    // Drop stale unique index that blocks multiple chat sessions per user
    try {
      await mongoose.connection.db.collection('chats').dropIndex('userId_1');
      console.log('🗑️  Dropped stale unique index: chats.userId_1');
    } catch (indexErr) {
      if (indexErr.codeName !== 'IndexNotFound' && indexErr.code !== 26) {
        console.warn('⚠️  Index cleanup warning:', indexErr.message);
      }
    }

    // Drop stale non-sparse companySlug index so Mongoose recreates it as sparse
    // (allows multiple users to have companySlug: null without duplicate key errors)
    try {
      await mongoose.connection.db.collection('users').dropIndex('companySlug_1');
      console.log('🗑️  Dropped stale unique index: users.companySlug_1 (will be recreated as sparse)');
    } catch (indexErr) {
      if (indexErr.codeName !== 'IndexNotFound' && indexErr.code !== 26) {
        console.warn('⚠️  Index cleanup warning (companySlug):', indexErr.message);
      }
    }

    const docxEnabled = (process.env.DOCX_CONVERSION_ENABLED || 'false').toLowerCase() === 'true';
    const adobeReady = isAdobePdfConfigured();
    console.log('🧾 [DOCX-Pipeline] Startup readiness:', {
      docxConversionEnabled: docxEnabled,
      adobePdfReady: adobeReady,
      ocrLocale: process.env.ADOBE_PDF_EXPORT_OCR_LOCALE || 'EN_US',
      mode: (docxEnabled && adobeReady) ? 'PDF→DOCX ACTIVE' : 'PDF→DOCX INACTIVE',
    });
    await seedDeptUser();
    await seedAdminUser();
    await seedTestUser();
    startServer();
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });


const serveUploadFile = async (req, res) => {
  try {
    const rawPath = String(req.params.filePath || req.params.filename || '').trim();
    const normalizedPath = rawPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const pathSegments = normalizedPath.split('/').filter(Boolean);
    const hasTraversal = pathSegments.some((seg) => seg === '..');
    if (!normalizedPath || hasTraversal) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    const baseUploads = path.join(__dirname, 'uploads');
    const candidates = [
      path.join(baseUploads, normalizedPath),
      path.join(baseUploads, 'files', normalizedPath),
      path.join(baseUploads, 'generated', normalizedPath),
      path.join(baseUploads, 'drafts', normalizedPath),
    ];
    let filePath = null;
    for (const p of candidates) {
      const resolved = path.resolve(p);
      if (!resolved.startsWith(path.resolve(baseUploads))) continue;
      try {
        const stat = await fs.stat(resolved);
        if (stat.isFile()) {
          filePath = resolved;
          break;
        }
      } catch (_) { /* ignore */ }
    }
    if (!filePath) return res.status(404).json({ error: 'File not found' });
    
    
    const ext = path.extname(filePath).toLowerCase();
    let contentType = 'application/octet-stream';
    
    if (ext === '.docx') {
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (ext === '.pdf') {
      contentType = 'application/pdf';
    } else if (ext === '.doc') {
      contentType = 'application/msword';
    } else if (ext === '.txt') {
      contentType = 'text/plain';
    } else if (['.jpg', '.jpeg'].includes(ext)) {
      contentType = 'image/jpeg';
    } else if (ext === '.png') {
      contentType = 'image/png';
    }
    
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(path.basename(filePath))}"`);
    res.setHeader('Content-Transfer-Encoding', 'binary');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    
    
    const fileBuffer = await fs.readFile(filePath);
    console.log(`📥 Serving file: ${path.basename(filePath)} (${fileBuffer.length} bytes, type: ${contentType})`);
    res.send(fileBuffer);
    
  } catch (error) {
    console.error('File download error:', error);
    res.status(500).json({ error: 'Failed to download file' });
  }
};

app.get('/uploads/:filename', serveUploadFile);
app.get('/uploads/*', (req, res) => {
  req.params.filePath = req.params[0];
  return serveUploadFile(req, res);
});


app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { 
  customCss: '.swagger-ui .topbar { display: none }' 
}));


app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/files', fileRoutes);
app.use('/api/draft', draftRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/studio', researchRoutes);
app.use('/api/bulk-review', bulkReviewRoutes);
app.use('/api/lawyers', lawyerRoutes);
app.use('/api/chronology', chronologyRoutes);
app.use('/api/precedence', precedenceRoutes);
app.use('/api/counter-maker', counterMakerRoutes);
app.use('/api/ocr', ocrRoutes);
app.use('/api/translation', translationRoutes);
app.use('/api/bihar-bhumi', biharBhumiRoutes);


app.get('/api/debug-templates', async (req, res) => {
  const root = templates.getTemplatesRoot?.() || 'unknown';
  let exists = false;
  let entries = [];
  try {
    const stat = await fs.stat(root);
    exists = stat.isDirectory();
    if (exists) {
      const list = await fs.readdir(root, { withFileTypes: true });
      entries = list.slice(0, 10).map(e => ({ name: e.name, type: e.isDirectory() ? 'dir' : 'file' }));
    }
  } catch (_) {}
  res.json({ root, exists, entries });
});


app.get('/api/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});


app.get('/api/debug/status', async (req, res) => {
  const tplRoot = templates.getTemplatesRoot?.() || 'unknown';
  let tplCount = 0;
  try {
    const loaded = await templates.loadTemplates?.();
    tplCount = Array.isArray(loaded) ? loaded.length : 0;
  } catch (e) {}

  let redisOk = false;
  try {
    await redis.set('debug:ping', '1', 'EX', 5);
    redisOk = true;
  } catch (e) {}

  const mongoState = mongoose.connection?.readyState ?? -1;

  res.json({
    time: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'development',
    requestId: req.requestId,
    api: '/api',
    gemini: {
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      disabled: String(process.env.GEMINI_DISABLE || '').toLowerCase() === 'true'
    },
    templates: {
      root: tplRoot,
      count: tplCount
    },
    mongo: {
      readyState: mongoState
    },
    redis: {
      ok: redisOk
    }
  });
});


app.get('/api/debug/log-test', (req, res) => {
  console.error(`[${req.requestId}] Test error log`);
  console.warn(`[${req.requestId}] Test warn log`);
  console.log(`[${req.requestId}] Test info log`);
  res.json({ ok: true, requestId: req.requestId });
});


app.get('/api/protected', authenticateJWT, (req, res) => {
  res.json({ message: 'This is a protected route', user: req.user });
});


app.get('/api/debug-token', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.json({ error: 'No Authorization header' });
  }
  
  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.json({ error: 'No token in header' });
  }
  
  try {
    const decoded = jwt.decode(token);
    res.json({ 
      success: true, 
      tokenLength: token.length,
      decoded: decoded,
      expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : 'No expiration',
      isExpired: decoded.exp ? decoded.exp < Date.now() / 1000 : 'Unknown'
    });
  } catch (error) {
    res.json({ error: 'Token decode failed', message: error.message });
  }
});


app.use(errorHandler);


 

app.use(errorHandler);

 
app.use(errorHandler);


 

app.use(errorHandler);


 