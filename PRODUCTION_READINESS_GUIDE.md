# Dastavezai — Production Readiness Guide

> **Exact changes needed to take the project from local development to production.**
> Last updated: February 12, 2026

---

## Quick Summary

The codebase has good infrastructure for production (Redis client with TLS, Cloudinary upload with retry, MongoDB via env var). The main blockers are:

1. **6 files hardcode Ollama `localhost:11434`** without Gemini switching
2. **Credentials committed** in `env.example` — need rotation
3. **Debug endpoints** exposed without auth
4. **Client bundle** has baked-in `localhost:5000`
5. **Environment flags** need flipping

---

## Table of Contents

1. [Environment Variables (Complete Production Config)](#1-environment-variables)
2. [AI Provider: Ollama → Gemini (All 6 Files)](#2-ai-provider-switch)
3. [Redis: Enable Production](#3-redis)
4. [Cloudinary: Enable Production](#4-cloudinary)
5. [MongoDB: Atlas Connection](#5-mongodb)
6. [Subscription Paywall: Enable](#6-subscription)
7. [Security: Debug Endpoints & Credentials](#7-security)
8. [Client: Production Build](#8-client-build)
9. [Deployment: Docker & Cloud Run](#9-deployment)
10. [Production Checklist](#10-checklist)

---

## 1. Environment Variables

### Server Production `.env`

Create `server/.env` with these values (replace placeholders):

```dotenv
NODE_ENV=production
PORT=5000

# MongoDB Atlas
MONGODB_URI=mongodb+srv://USER:NEW_PASSWORD@cluster.mongodb.net/dastavez?retryWrites=true&w=majority

# JWT (MUST generate new secrets — old ones are committed in env.example)
JWT_SECRET=<generate-64-char-random-string>
JWT_REFRESH_SECRET=<generate-64-char-random-string>

# AI Provider — switch to Gemini
GEMINI_DISABLE=false
GEMINI_API_KEY=<your-google-gemini-api-key>
GEMINI_MODEL=gemini-1.5-flash
OLLAMA_BASE_URL=                        # leave empty — not used in production

# Redis
REDIS_DISABLE=false
REDIS_URL=rediss://default:PASSWORD@host:port
REDIS_TLS=true

# Cloudinary
CLOUDINARY_DISABLE=false
CLOUDINARY_CLOUD_NAME=<your-cloud-name>
CLOUDINARY_API_KEY=<your-api-key>
CLOUDINARY_API_SECRET=<your-api-secret>

# Subscriptions (Razorpay)
SUBSCRIPTION_DISABLE=false
RAZORPAY_KEY_ID=<production-key>
RAZORPAY_KEY_SECRET=<production-secret>

# CORS
CORS_ORIGINS=https://yourdomain.com,https://www.yourdomain.com
FRONTEND_URL=https://yourdomain.com

# Email (SMTP)
EMAIL_USER=<production-email@gmail.com>
EMAIL_PASS=<gmail-app-password>
COMPANY_EMAIL=support@yourdomain.com

# Security
CSRF_SECRET=<generate-32-char-random-string>
```

### Client Production `.env`

Create `client/.env.production`:

```dotenv
VITE_API_URL=https://api.yourdomain.com
VITE_RAZORPAY_KEY_ID=<production-razorpay-key>
```

---

## 2. AI Provider Switch: Ollama → Gemini

**Current state:** 6 files call `http://localhost:11434/api/generate` (local Ollama) with no Gemini switching. Only `fileController.js` has a proper `GEMINI_DISABLE` flag.

> **Note on Smart Scan:** The smart scan feature (in `fileController.js` smart suggestions endpoint) is already production-ready. It includes:
> - Document type detection (21 legal document patterns)
> - Risk analysis with proper MongoDB severity enum (`'info'`, `'warning'`, `'critical'`)
> - LLM suggestion aggregation with JSON parsing recovery (handles truncated responses)
> - Severity sanitization guard to prevent invalid enum values
> - Template-applied title styling in DOCX/PDF exports
> Simply set `GEMINI_DISABLE=false` and provide `GEMINI_API_KEY` to enable production AI suggestions.

### File 1: `server/controllers/chatController.js`

**Lines 76-95** — `callLocalLLM()` function:
```javascript
// CURRENT (line 79):
const response = await axios.post('http://localhost:11434/api/generate', { ... });
```
**Change needed:** Make it check `GEMINI_DISABLE` env var. At the top of the file, add:
```javascript
const GEMINI_DISABLED = process.env.GEMINI_DISABLE === 'true';
```
Then in `callLocalLLM()`, add Gemini fallback:
```javascript
async function callLocalLLM(prompt, model = 'llama3.1:8b') {
  if (!GEMINI_DISABLED) {
    return await callGeminiAPI(prompt);  // Gemini is the primary in production
  }
  // existing Ollama code as fallback for dev
  try {
    const response = await axios.post(
      process.env.OLLAMA_BASE_URL || 'http://localhost:11434/api/generate', ...
    );
  } catch (err) {
    return await callGeminiAPI(prompt);  // fallback
  }
}
```

**Lines 2905-2930** — Streaming handler:
```javascript
// CURRENT (line 2923):
const response = await axios.post('http://localhost:11434/api/generate', {
  model: 'llama3.1:8b', prompt, stream: true
}, { responseType: 'stream' });
```
**Change needed:** Add Gemini streaming path:
```javascript
if (!GEMINI_DISABLED) {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });
  const result = await model.generateContentStream(prompt);
  for await (const chunk of result.stream) {
    res.write(`data: ${JSON.stringify({ text: chunk.text() })}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  return res.end();
}
```

### File 2: `server/controllers/draftController.js`

**Lines 28-39** — `callLocalLLM()`:
```javascript
// CURRENT (line 30):
const res = await axios.post('http://localhost:11434/api/generate', ...);
```
**Change needed:** Same pattern — add `GEMINI_DISABLED` check at top, route to Gemini when flag is false.

### File 3: `server/controllers/fileController.js`

**Lines 72-85** — already has `GEMINI_DISABLED` flag at line 51.
**Status: Already production-ready** ✅ — just set `GEMINI_DISABLE=false` in env.

### File 4: `server/services/intentClassifier.js`

**Lines 262-275** — `callLocalLLaMA()`:
```javascript
// CURRENT (line 266):
const response = await axios.post('http://localhost:11434/api/generate', ...);
```
**Change needed:** Add switching logic. There's already a commented-out `callGemini()` function around lines 305-320 — uncomment it and add:
```javascript
async classify(message, context) {
  // ...
  const response = GEMINI_DISABLED
    ? await this.callLocalLLaMA(prompt)
    : await this.callGemini(prompt);
}
```

### File 5: `server/services/documentExtractor.js`

**Lines 176-187** — `callLocalLLaMA()`:
```javascript
// CURRENT (line 178):
const response = await axios.post('http://localhost:11434/api/generate', ...);
```
**Change needed:** Same switching pattern. Has commented-out Gemini code around lines 440-455.

### File 6: `server/utils/templateIndex.js`

**Line 574** — Template description generation:
```javascript
const response = await axios.post('http://localhost:11434/api/generate', ...);
```
**Change needed:** Add Gemini alternative. This is a one-time script-like function, so wrapping in the same pattern works.

---

## 3. Redis

### Current: `REDIS_DISABLE=true` (in-memory shim)

**File:** `server/utils/redisClient.js`

The Redis client code is **already production-ready**:
- Supports `REDIS_URL` (full URL with auth)
- Auto-detects TLS from `rediss://` scheme
- Has reconnect strategies
- In-memory shim for dev mode

### Production changes:
```dotenv
REDIS_DISABLE=false
REDIS_URL=rediss://default:PASSWORD@host:6380
```

No code changes needed.

### Files using Redis (for reference):
| File | Usage |
|------|-------|
| `chatController.js` (L8) | Chat session/state caching |
| `subscriptionController.js` (L9) | Price caching |
| `draftController.js` (L10) | Pending document storage |
| `fileController.js` (L7) | File operation caching |
| `intentClassifier.js` (L2) | LLM timeout metrics |
| `featureAccess.js` (L2) | Feature gate caching |
| `csrfToken.js` (L2) | CSRF token storage |
| `payment.js` (L3) | Payment session data |

---

## 4. Cloudinary

### Current: `CLOUDINARY_DISABLE=true` (local filesystem)

**File:** `server/utils/fileHandler.js`

The Cloudinary code is **already production-ready**:
- `uploadToCloudinaryWithRetry()` with exponential backoff
- Falls back to local storage when disabled
- Handles all file types

### Production changes:
```dotenv
CLOUDINARY_DISABLE=false
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
```

No code changes needed.

---

## 5. MongoDB

### Current: `mongodb://localhost:27017/dastavez` fallback

**Files:**
- `server/index.js` (L96): `mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/dastavez')`
- `server/config/db.js` (L6): `await mongoose.connect(process.env.MONGODB_URI)`

### Production changes:
```dotenv
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/dastavez?retryWrites=true&w=majority
```

No code changes needed — already reads from env var.

---

## 6. Subscription Paywall

### Current: `SUBSCRIPTION_DISABLE=true`

**File:** `server/controllers/fileController.js` (L48-49)

```javascript
const SUBSCRIPTION_DISABLED = process.env.SUBSCRIPTION_DISABLE === 'true';
```

Used at lines 469 and 588 to skip subscription enforcement.

### Production changes:
```dotenv
SUBSCRIPTION_DISABLE=false
RAZORPAY_KEY_ID=rzp_live_...
RAZORPAY_KEY_SECRET=...
```

---

## 7. Security Fixes

### 7a. Remove Debug Endpoints

**File:** `server/index.js` — Lines 174-270

These endpoints are **unauthenticated** and expose sensitive info:

| Endpoint | Line | Exposed Info |
|----------|------|--------------|
| `GET /api/debug-templates` | 174 | Template filesystem paths |
| `GET /api/debug/status` | 195 | API key presence, DB state, Redis status |
| `GET /api/debug/log-test` | 235 | Log injection vector |
| `GET /api/debug-token` | 248 | Decoded JWT payload |

**Fix:** Wrap in environment guard:
```javascript
// In server/index.js, around line 174:
if (process.env.NODE_ENV !== 'production') {
  // ... all debug endpoints here ...
}
```

### 7b. Rotate Committed Credentials

**File:** `server/env.example` — Contains REAL credentials:

| Line | What | Action |
|------|------|--------|
| L8 | Redis Cloud password: `9iwDZ3fYOlchYBJfg2mHRODiwhtmt9gZ` | **Rotate in Redis Cloud dashboard** |
| L12 | JWT Secret: `Chillu786` | **Generate new 64-char random secret** |
| L15 | MongoDB Atlas password: `qodEXMOIgylWENXF` | **Rotate in Atlas dashboard** |
| L55 | Razorpay keys | **Rotate if these are real** |

**After rotation:** Replace all values in `env.example` with placeholders:
```dotenv
REDIS_URL=redis://default:YOUR_REDIS_PASSWORD@your-host:port
JWT_SECRET=YOUR_JWT_SECRET_HERE
MONGODB_URI=mongodb+srv://user:YOUR_PASSWORD@cluster/dbname
```

### 7c. CORS Tightening

**File:** `server/index.js` — CORS config

In production, restrict origins:
```javascript
const corsOptions = {
  origin: process.env.CORS_ORIGINS?.split(',') || ['https://yourdomain.com'],
  credentials: true,
};
```

### 7d. HTTPS Enforcement

Ensure reverse proxy (Cloud Run / Nginx) terminates TLS. Add HSTS header:
```javascript
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}
```

---

## 8. Client Production Build

### Steps:
```bash
cd client

# Set production API URL
echo "VITE_API_URL=https://api.yourdomain.com" > .env.production
echo "VITE_RAZORPAY_KEY_ID=rzp_live_..." >> .env.production

# Build
npm run build
```

This creates `client/dist/` with the production API URL baked in.

**Critical:** The current `client/dist/` has `http://localhost:5000` hardcoded. You **MUST** rebuild before deploying.

---

## 9. Deployment

### Docker (Cloud Run)

```bash
# Build Docker image
cd server
docker build -t dastavezai-server .

# Push to Container Registry
docker tag dastavezai-server gcr.io/PROJECT_ID/dastavezai-server
docker push gcr.io/PROJECT_ID/dastavezai-server

# Deploy to Cloud Run
gcloud run deploy dastavezai-server \
  --image gcr.io/PROJECT_ID/dastavezai-server \
  --region asia-south2 \
  --memory 1Gi \
  --cpu 1 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production,GEMINI_DISABLE=false,REDIS_DISABLE=false,CLOUDINARY_DISABLE=false,SUBSCRIPTION_DISABLE=false" \
  --set-secrets "JWT_SECRET=jwt-secret:latest,MONGODB_URI=mongodb-uri:latest,GEMINI_API_KEY=gemini-key:latest,REDIS_URL=redis-url:latest,..."
```

### Alternative: Railway/Render/Heroku

1. Push to Git
2. Set environment variables in dashboard
3. Build command: `npm install`
4. Start command: `npm start` (reads `Procfile`)

### Serving Client

Option A: **CDN/Static hosting** (Vercel, Netlify, Firebase Hosting)
- Build client with `npm run build`
- Deploy `client/dist/`
- Configure SPA fallback (`_redirects` or `vercel.json`)

Option B: **Serve from Express** (if monolithic)
- Add to `server/index.js`:
```javascript
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}
```

---

## 10. Production Checklist

### P0 — Blocking (Must Do)

- [ ] Rotate all committed credentials (Redis, JWT, MongoDB, Razorpay)
- [ ] Replace `env.example` values with placeholders
- [ ] Add `GEMINI_DISABLE` switching to `chatController.js`, `draftController.js`, `intentClassifier.js`, `documentExtractor.js`, `templateIndex.js`
- [ ] Set `GEMINI_DISABLE=false` and provide `GEMINI_API_KEY`
- [ ] Rebuild client with production `VITE_API_URL`
- [ ] Wrap debug endpoints in `NODE_ENV !== 'production'` guard
- [ ] Verify smart scan endpoint returns valid suggestions with correct severity enum values

### P1 — Important

- [ ] Set `REDIS_DISABLE=false` and provide `REDIS_URL`
- [ ] Set `CLOUDINARY_DISABLE=false` and provide credentials
- [ ] Set `SUBSCRIPTION_DISABLE=false` and provide Razorpay keys
- [ ] Configure Cloud Run secrets (don't pass via `--set-env-vars`)
- [ ] Set up proper CORS origins for production domain
- [ ] Enable HTTPS/HSTS
- [ ] Set up MongoDB Atlas IP whitelist
- [ ] Configure rate limiting for production load

### P2 — Nice to Have

- [ ] Set up monitoring (Sentry/LogRocket for errors)
- [ ] Configure log aggregation (Cloud Logging)
- [ ] Set up CI/CD pipeline (GitHub Actions → Cloud Build)
- [ ] Add health check endpoint (beyond debug)
- [ ] Set up MongoDB backup schedule
- [ ] Configure CDN for static assets
- [ ] Set up uptime monitoring

---

## Files Changed Summary

| File | Change | Effort |
|------|--------|--------|
| `server/.env` | All env vars | Config only |
| `client/.env.production` | API URL | Config only |
| `server/controllers/chatController.js` L76-95, L2905-2930 | Add Gemini switching | Medium |
| `server/controllers/draftController.js` L28-39 | Add Gemini switching | Low |
| `server/services/intentClassifier.js` L262-275 | Uncomment Gemini, add switch | Low |
| `server/services/documentExtractor.js` L176-187 | Uncomment Gemini, add switch | Low |
| `server/utils/templateIndex.js` L574 | Add Gemini alternative | Low |
| `server/index.js` L174-270 | Wrap debug endpoints | Low |
| `server/env.example` | Replace real creds with placeholders | Low |
