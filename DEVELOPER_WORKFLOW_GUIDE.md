# Dastavezai — Developer Workflow Guide

> **Complete reference for every feature, workflow, API endpoint, and code location.**
> Last updated: February 12, 2026

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Chat (AI Legal Assistant)](#2-chat-ai-legal-assistant)
3. [Draft/Document Generation](#3-draftdocument-generation)
4. [Document Editing (OCR + AI Editor)](#4-document-editing-ocr--ai-editor)
5. [Template System](#5-template-system)
6. [Inline Suggestions](#6-inline-suggestions)
7. [Case Search](#7-case-search)
8. [Complaint Generation](#8-complaint-generation)
9. [Authentication & Security](#9-authentication--security)
10. [Admin Panel](#10-admin-panel)
11. [File Upload & Management](#11-file-upload--management)
12. [Subscription & Payments](#12-subscription--payments)
13. [Legal Analysis ("Learn More")](#13-legal-analysis-learn-more)
14. [Knowledge Base & RAG](#14-knowledge-base--rag)
15. [Profile Management](#15-profile-management)
16. [Contact Form](#16-contact-form)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (React + Vite)                     │
│  client/src/App.jsx → Routes:                               │
│    /login       → Login.jsx                                 │
│    /chat        → ChatPage.jsx (main hub)                   │
│    /profile     → Profile.jsx                               │
│    /subscription→ Subscription.jsx                          │
│    /admin/*     → AdminDashboard.jsx                        │
│  UI: Chakra UI  │  State: React Context (AuthContext)       │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP / REST
┌────────────────────────▼────────────────────────────────────┐
│              SERVER (Node.js + Express)                      │
│  server/index.js → Route mounts:                            │
│    /api/auth         → routes/auth.js                       │
│    /api/chat         → routes/chat.js                       │
│    /api/files        → routes/fileRoutes.js                 │
│    /api/draft        → routes/draftRoutes.js                │
│    /api/templates    → routes/templateRoutes.js             │
│    /api/cases        → routes/caseRoutes.js                 │
│    /api/admin        → routes/adminRoutes.js                │
│    /api/subscription → routes/subscription.js               │
│    /api/profile      → routes/profile.js                    │
│    /api/knowledge    → routes/knowledgeRoutes.js            │
│    /api/legal        → routes/legalRoutes.js                │
│    /api/contact      → routes/contactRoutes.js              │
│                                                             │
│  AI Engine: LLaMA (Ollama local) ──failover──▶ Gemini API  │
│  OCR: Tesseract.js  │  DOCX: docx library                  │
│  Middleware: JWT, CSRF, Rate Limit, Feature Access          │
└───────┬──────────────┬──────────────┬───────────────────────┘
        │              │              │
   ┌────▼────┐   ┌─────▼─────┐  ┌────▼────┐
   │ MongoDB │   │   Redis   │  │Cloudinary│
   │(Atlas)  │   │ (Session/ │  │ (File    │
   │         │   │  State)   │  │  Storage)│
   └─────────┘   └───────────┘  └──────────┘
```

### Key Config Files
| File | Purpose |
|------|---------|
| `server/index.js` | Express app setup, route mounting, middleware stack |
| `server/config/db.js` | MongoDB connection (Mongoose) |
| `server/config/swagger.js` | Swagger/OpenAPI documentation |
| `server/.env` / `server/env.example` | Environment variables |
| `client/vite.config.js` | Vite dev server, proxy to backend |
| `client/src/main.jsx` | React app entry point |

---

## 2. Chat (AI Legal Assistant)

### Flow Diagram
```
User Message
    │
    ▼
POST /api/chat/message
    │
    ▼
┌─ Middleware ──────────────────────────────┐
│ authenticateJWT → rateLimiter → validate  │
└───────────────────────┬───────────────────┘
                        ▼
            ┌── Redis State Check ──┐
            │ pending_missing?      │──▶ Continue field collection
            │ pending_confirmation? │──▶ Handle yes/no for template
            │ pending_template?     │──▶ Template selection
            │ pending_ai_document?  │──▶ AI doc generation
            │ pending_freeform?     │──▶ Freeform draft
            └──────────┬───────────┘
                       ▼ (no pending state)
            ┌── Intent Classification ──┐
            │ IntentClassifier.classify()│
            │ → DOCUMENT_REQUEST        │──▶ handleDocumentRequest()
            │ → LEGAL_INFORMATION       │──▶ handleLegalInformation()
            │ → DOCUMENT_MODIFICATION   │──▶ handleDocumentModification()
            │ → CONVERSATIONAL          │──▶ handleConversationalChat()
            └───────────────────────────┘
```

### Code Locations
| What | Where |
|------|-------|
| Main handler | `server/controllers/chatController.js` → `sendMessage()` (L2991) |
| Intent classifier | `server/services/intentClassifier.js` |
| Redis state keys | `pending_missing:{userId}`, `pending_confirmation:{userId}`, etc. |
| Chat history | `server/controllers/chatController.js` → `getChatHistory()` (L4243) |
| Exit doc mode | `server/controllers/chatController.js` → `exitDocumentMode()` (L4353) |
| Language detection | `getLanguageInstruction()` and `wrapPromptWithLanguage()` in chatController |
| LLM calls | `callOllama()` (local LLaMA) → `callGemini()` (fallback) |
| Client component | `client/src/pages/ChatPage.jsx` (3445 lines) |
| Message rendering | `client/src/components/ChatMessage.jsx` |

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/chat/message` | Send message, get AI response |
| `POST` | `/api/chat/stream` | SSE streaming response |
| `GET` | `/api/chat/history` | Get conversation history |
| `DELETE` | `/api/chat/clear` | Clear history |
| `POST` | `/api/chat/exit-document-mode` | Reset all pending Redis states |
| `POST` | `/api/chat/rate-draft` | Rate a generated draft |

---

## 3. Draft/Document Generation

### Flow Diagram (Template-Based)
```
User: "I need a rental agreement"
    │
    ▼
Intent: DOCUMENT_REQUEST
    │
    ▼
findBestTemplate() ──▶ Match from 660 templates
    │
    ▼
┌── Template Found? ──┐
│ YES                  │ NO ──▶ AI generates from scratch
│                      │        via generateDocumentInline()
▼                      │
Show template match    │
"Use Template" or      │
"AI Generate"          │
    │                  │
    ▼                  │
GET /api/draft/schema  │
    │                  │
    ▼                  │
DocumentFieldsModal    │
(collect field values) │
    │                  │
    ▼                  │
POST /api/draft/form-generate
    │
    ▼
generateFromForm()
  1. Read DOCX text (mammoth/docx)
  2. Replace {{field}} placeholders
  3. Replace dot/underscore blanks (sequential)
  4. writeDocxFromText(text, title, outDir, designConfig, skipTitle=true)
    │
    ▼
Download link returned → user downloads DOCX
```

### Code Locations
| What | Where |
|------|-------|
| Template matching | `server/utils/templateIndex.js` → `findBestTemplate()` |
| Template loading | `server/utils/templateIndex.js` → `loadTemplates()` |
| Schema extraction | `server/controllers/draftController.js` → `getTemplateSchema()` (L195) |
| Placeholder detection | `server/controllers/draftController.js` → `extractPlaceholdersFromTemplate()` (L107) |
| Form-based generation | `server/controllers/draftController.js` → `generateFromForm()` (L275) |
| DOCX writer | `server/utils/docxWriter.js` → `writeDocxFromText(text, title, outDir, designConfig, skipTitle)` |
| Fields modal | `client/src/components/DocumentFieldsModal.jsx` |
| Template browser | `client/src/components/TemplateBrowser.jsx` |
| Design selector | `client/src/components/TemplateDesignSelector.jsx` |

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/draft/` | Free-form AI draft generation |
| `GET` | `/api/draft/schema?templatePath=...` | Get template field schema |
| `POST` | `/api/draft/form-generate` | Generate from filled form |

---

## 4. Document Editing (OCR + AI Editor)

### Flow Diagram
```
User uploads file (PDF/DOCX/Image)
    │
    ▼
POST /api/files/upload (multer, 10MB)
    │
    ▼
File stored (Cloudinary or local)
MongoDB File record created
    │
    ▼
POST /api/files/:fileId/edit/start
    │
    ▼
createEditSession()
  - Extract text (OCR for images, pdf-parse for PDF, mammoth for DOCX)
  - Initialize undo/redo stack
  - Document structure analysis (sections, clauses, risks, suggestions)
    │
    ▼
┌── Editing Loop ──┐
│                   │
│  AI Edit:         │  Manual Edit:
│  POST /edit/apply │  POST /edit/manual
│  LLM rewrites    │  Direct text replace
│  section         │
│                   │
│  Undo: POST /edit/undo
│  Redo: POST /edit/redo
│  Autosave: POST /edit/autosave
│                   │
└───────┬───────────┘
        ▼
GET or POST /api/files/edit/download?format=docx|pdf|rtf|html|md
    │
    ▼
DesignSuggestionModal (optional)
  - POST /api/templates/designs/match
  - Suggests template designs based on content
    │
    ▼
Export: generateDocx/Pdf/Rtf/Html/Markdown
    │
    ▼
File download via browser
```

### Code Locations
| What | Where |
|------|-------|
| Upload handler | `server/controllers/fileController.js` → `uploadFile()` (L437) |
| OCR/analysis | `server/controllers/fileController.js` → `analyzeFile()` (L534) |
| Edit session start | `server/controllers/fileController.js` → `startEditSession()` (L826) |
| AI edit | `server/controllers/fileController.js` → `applyDocumentEdit()` (L889) |
| Manual edit | `server/controllers/fileController.js` → `applyManualDocumentEdit()` (L1001) |
| Undo/Redo | `server/controllers/fileController.js` → `undoDocumentEdit()` (L1236) / `redoDocumentEdit()` (L1260) |
| Download | `server/controllers/fileController.js` → `downloadEditedDocument()` (L1063) |
| Edit service | `server/services/documentEditService.js` |
| Side pane editor | `client/src/components/DocumentViewer.jsx` |
| Full-screen editor | `client/src/components/FullPageEditor.jsx` |
| Design suggestion | `client/src/components/DesignSuggestionModal.jsx` |
| File service | `client/src/services/fileService.js` |

### Smart Scan & Document Analysis

Smart Scan automatically analyzes uploaded documents to detect type, extract risks, and generate AI suggestions. This runs during `createEditSession()` and populates the suggestions sidebar.

**Document Type Detection** (`server/services/documentParserService.js` → `detectDocumentType()` L58):
- Parses text to identify legal document type (21 patterns: Deed, Will, Agreement, Notice, Affidavit, etc.)
- Returns type string or "unknown" if no pattern matches
- Uses regex patterns on section headers and clause markers

**Risk Analysis** (`server/services/documentParserService.js` → `analyzeDocumentRisks()` L440):
- Analyzes document structure for common risks: missing clauses, ambiguous language, compliance gaps
- Returns object: `{ risks: [], suggestions: [] }`
- Risk severity: `'info'`, `'warning'`, or `'critical'` (MongoDB enum)

**Smart Suggestions Aggregation** (`server/controllers/fileController.js` L1715+):
- Combines risk analysis, section suggestions, and LLM-generated suggestions
- All suggestions stored with schema: `{ type, severity, title, description, suggestionId }`
- Applied sanitization converts invalid severity values to valid enum
- LLM responses use JSON recovery for incomplete/truncated responses (finds last complete `}`)

**Suggestion Severity Handling** (`server/controllers/fileController.js` → `sanitizeSeverity()` L1705):
- Guard function ensures all suggestions match MongoDB enum `['info', 'warning', 'critical']`
- Maps invalid values: `'medium'` → `'warning'`, others → `'info'`
- Applied to all 3 suggestion sources: risk analysis, section suggestions, AI suggestions

### Export Improvements

**PDF Generation** (`server/services/documentEditService.js` → `generateSimpleHtml()` L980):
- Fixed: No longer duplicates title in PDF body
- Skips any line matching the document title to prevent duplication
- Title rendered as template `<h1>`, body as `<p>` tags

**DOCX Generation** (`server/utils/htmlToDocx.js` → `htmlToParagraphs()` L143):
- Title styling from template now applied to h1 headings
- Signature: `htmlToParagraphs(html, titleStyle = null)`
- Title style includes: font family, 1.5x body size, CENTER alignment
- Both prepended and extracted headings receive full template styling

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/files/upload` | Upload file |
| `POST` | `/api/files/analyze/:fileId` | OCR/analyze |
| `GET` | `/api/files/download/:filename` | Download original file |
| `POST` | `/api/files/:fileId/edit/start` | Start edit session |
| `POST` | `/api/files/edit/apply` | AI-powered edit |
| `POST` | `/api/files/edit/manual` | Direct text replacement |
| `POST` | `/api/files/edit/undo` | Undo |
| `POST` | `/api/files/edit/redo` | Redo |
| `POST` | `/api/files/edit/autosave` | Autosave |
| `GET` | `/api/files/edit/undo-redo-state` | Undo/redo availability |
| `GET` | `/api/files/edit/diff` | Diff between versions |
| `GET` | `/api/files/edit/sessions` | List sessions |
| `POST` | `/api/files/edit/sessions/:sessionId/load` | Load session |
| `POST` | `/api/files/edit/fill-variables` | Fill template variables |
| `POST` | `/api/files/edit/apply-chunked` | Large doc chunked edit |
| `GET` | `/api/files/edit/status` | Session status |
| `GET` | `/api/files/edit/analysis` | Document structure |
| `GET/POST` | `/api/files/edit/download` | Export (GET=plain, POST=with design) |
| `POST` | `/api/files/edit/clear` | Clear session |

---

## 5. Template System

### Flow Diagram
```
TemplateBrowser opens
    │
    ▼
GET /api/templates/categories ──▶ Category list with counts
    │
    ▼
User selects category
    │
    ▼
GET /api/templates/preview?category=X ──▶ Template list
    │
    ▼
User selects template
    │
    ▼
Template metadata loaded from JSON sidecar
  - title, description, description_hi
  - fields[] with key, label, type, placeholder
  - placeholder_order[]
    │
    ▼
DocumentFieldsModal renders fields
    │
    ▼
Form submitted → POST /api/draft/form-generate
```

### Template File Structure
```
server/normalized_templates/
├── Adoption Drafts/
│   ├── Simple-Adoption-Deed.json      ← metadata
│   ├── Simple-Adoption-Deed.docx      ← actual template
│   └── ...
├── Affidavit Formats/
│   ├── General/
│   │   ├── simple-affidavit.json
│   │   └── simple-affidavit.docx
│   └── Court-Specific/
│       └── ...
├── ... (19 categories, 660 templates total)
```

### JSON Metadata Schema
```json
{
  "title": "Simple Adoption Deed",
  "filename": "Simple-Adoption-Deed.docx",
  "category": "Adoption Drafts",
  "subcategory": null,
  "description": "English description for users",
  "description_hi": "Hindi description for users",
  "fields": [
    {
      "key": "adopter_name",
      "label": "Adopter's Full Name",
      "type": "text|date|number|textarea",
      "required": true,
      "placeholder": "e.g., Rajesh Kumar"
    }
  ],
  "placeholder_order": ["adopter_name", "child_name", ...]
}
```

### Code Locations
| What | Where |
|------|-------|
| Template controller | `server/controllers/templateController.js` (391 lines) |
| Design controller | `server/controllers/templateDesignController.js` |
| Routes | `server/routes/templateRoutes.js` |
| Template index | `server/utils/templateIndex.js` |
| Template renderer | `server/utils/templateRender.js` |
| Template browser UI | `client/src/components/TemplateBrowser.jsx` |
| Design selector UI | `client/src/components/TemplateDesignSelector.jsx` |

---

## 6. Inline Suggestions

### Flow Diagram
```
AI generates response
    │
    ▼
Response includes suggestedActions[]
  { type, label, icon, action, description }
    │
    ▼
SuggestedActions.jsx renders buttons
    │
    ▼
User clicks action
    │
    ▼
onActionClick(action)
  → Sets intentOverride
  → Opens modal (TemplateBrowser, ComplaintForm, etc.)
  → Sends follow-up message
```

### Action Types
| Type | Label | Effect |
|------|-------|--------|
| `CREATE_DOCUMENT` | Create Document | Opens document creation flow |
| `GUIDE_ME` | Guide Me | Situational guidance |
| `BROWSE_TEMPLATES` | Browse Templates | Opens TemplateBrowser modal |
| `DOC_RENT_AGREEMENT` | Rent Agreement | Quick-start rental agreement |
| `DOC_LEGAL_NOTICE` | Legal Notice | Quick-start legal notice |
| `DOC_AFFIDAVIT` | Affidavit | Quick-start affidavit |
| `USE_TEMPLATE` | Use Template | Template-based generation |
| `USE_AI_GENERATE` | AI Generate | Free-form AI generation |
| `GENERATE_COMPLAINT` | File Complaint | Opens complaint form |
| `LEARN_MORE_LAW` | Learn More | In-depth legal analysis |

### Code Locations
| What | Where |
|------|-------|
| Actions model | `server/models/InlineActionResponse.js` |
| Client component | `client/src/components/SuggestedActions.jsx` (130 lines) |
| Action handler | `client/src/pages/ChatPage.jsx` → inline action click handlers |

---

## 7. Case Search

### Flow Diagram
```
User enters query
    │
    ▼
GET /api/cases/search?q=query&limit=5
    │
    ▼
searchCases()
  1. Lazy-load combined_legal_cases.csv into memory
  2. Tokenize query
  3. Score each case (full-text + per-token matching)
  4. Sort by relevance, return top N
```

### Code Locations
| What | Where |
|------|-------|
| Controller | `server/controllers/caseSearchController.js` (68 lines) |
| Route | `server/routes/caseRoutes.js` → `GET /api/cases/search` |
| Data source | `combined_legal_cases.csv` (title, citation, summary) |

---

## 8. Complaint Generation

### Flow Diagram
```
User clicks "Generate Complaint"
    │
    ▼
ComplaintFormModal opens
  Collects: type, against, date, location,
  description, evidence, outcome, urgency
    │
    ▼
POST /api/chat/generate-complaint
    │
    ▼
generateComplaint() (chatController.js L4431)
  1. Creates InlineActionResponse record
  2. Builds structured prompt for LLM
  3. LLM generates formal complaint
  4. DOCX created via writeDocxFromText()
  5. Download link returned
```

### Supported Complaint Types
Consumer, Police/FIR, Workplace Harassment, Defamation, Property Dispute, Service Deficiency, Banking, Insurance, Online Fraud, General

### Code Locations
| What | Where |
|------|-------|
| Handler | `server/controllers/chatController.js` → `generateComplaint()` (L4431) |
| Route | `server/routes/chat.js` → `POST /api/chat/generate-complaint` |
| Client | `client/src/components/ComplaintFormModal.jsx` |

---

## 9. Authentication & Security

### Flow Diagram
```
                    ┌──────────────┐
                    │  check-email │
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
           ┌────── │ Email exists? │──────┐
           │ YES   └───────────────┘  NO  │
           ▼                              ▼
    ┌──────────┐                  ┌───────────┐
    │  Login   │                  │  Sign Up  │
    │ email+pw │                  │ OTP verify│
    └────┬─────┘                  └─────┬─────┘
         │                              │
         │  ┌──────────┐                │
         ├─▶│  2FA?    │                │
         │  └────┬─────┘                │
         │       │ YES                  │
         │  ┌────▼─────┐               │
         │  │verify-2fa│               │
         │  └────┬─────┘               │
         │       │                      │
         ▼       ▼                      ▼
    ┌────────────────────────────────────────┐
    │  JWT Tokens: access (15min) + refresh  │
    │  HttpOnly cookies                      │
    └────────────────────────────────────────┘
```

### Middleware Stack (order matters)
1. `helmet()` — Security headers
2. `cors()` — Cross-origin config
3. `express.json()` — Body parsing
4. `csrfProtection` — CSRF token validation
5. `authenticateJWT` — JWT token extraction & validation
6. `rateLimiter` — Per-endpoint rate limiting
7. `featureAccess` — Tier-based feature gating
8. `validateRequest` — Input validation (express-validator)

### Code Locations
| What | Where |
|------|-------|
| Auth controller | `server/controllers/authController.js` (430 lines) |
| Routes | `server/routes/auth.js` (69 lines) |
| JWT middleware | `server/middleware/auth.js` |
| Admin check | `server/middleware/adminMiddleware.js` |
| CSRF | `server/middleware/csrf.js` |
| Security headers | `server/middleware/security.js` |
| Feature access | `server/middleware/featureAccess.js` |
| Validators | `server/middleware/validators.js` |
| User model | `server/models/User.js` |

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/auth/check-email` | Check email, send OTP if new |
| `POST` | `/api/auth/signup` | Register (OTP required) |
| `POST` | `/api/auth/login` | Login (rate: 15/5min) |
| `POST` | `/api/auth/google` | Google OAuth |
| `POST` | `/api/auth/verify-2fa` | 2FA verification |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `POST` | `/api/auth/forgot-password` | Request password reset |
| `POST` | `/api/auth/verify-reset-otp` | Verify reset OTP |
| `POST` | `/api/auth/reset-password` | Reset password |
| `GET` | `/api/auth/user` | Get current user |
| `POST` | `/api/auth/logout` | Logout |
| `POST` | `/api/auth/2fa/toggle` | Toggle 2FA |

---

## 10. Admin Panel

### Feature Access Matrix (from screenshot)
Controls which features are available per tier (Basic/Pro/Premium):

| Feature | Slug | Controller |
|---------|------|------------|
| Inline Suggestions | `inlineSuggestions` | Built into chat responses |
| Auto Intent Detection | `autoIntentDetection` | IntentClassifier service |
| Draft Generation | `draftGeneration` | draftController |
| Document Editing | `documentEditing` | fileController |
| Complaint Generation | `complaintGeneration` | chatController |
| Template Browsing | `templateBrowsing` | templateController |
| Case Search | `caseSearch` | caseSearchController |
| In-depth Legal Review | `legalReview` | chatController |
| Template Design Selection | `templateDesignSelection` | templateDesignController |
| Learn More About Law | `learnMoreLaw` | chatController |

### Code Locations
| What | Where |
|------|-------|
| Controller | `server/controllers/adminController.js` (215 lines) |
| Routes | `server/routes/adminRoutes.js` |
| Client | `client/src/pages/AdminDashboard.jsx` |
| Service | `client/src/services/adminService.js` |

### API Endpoints (all require `isAdmin` middleware)
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/admin/users` | Paginated user list |
| `DELETE` | `/api/admin/users/:id` | Remove user |
| `PUT` | `/api/admin/users/:id/tier` | Change user tier |
| `GET` | `/api/admin/financial-stats` | Revenue stats |
| `PUT` | `/api/admin/subscription-price` | Update pricing |
| `GET/PUT` | `/api/admin/settings/free-message-limit` | Message limit |
| `GET/PUT` | `/api/admin/feature-access` | Feature matrix |
| `GET/POST/PUT/DELETE` | `/api/admin/template-designs/*` | Design CRUD |

---

## 11. File Upload & Management

### Supported File Types
| Category | MIME Types |
|----------|-----------|
| Images | JPEG, PNG, GIF, WebP, BMP |
| Documents | PDF, DOC, DOCX, TXT, MD |
| Spreadsheets | XLS, XLSX, CSV |
| Data | JSON |

### Upload Flow
```
Client: FileUpload component
    │
    ▼
POST /api/files/upload (multipart/form-data, 10MB max)
    │
    ▼
Multer (memory storage) → type validation
    │
    ▼
Cloudinary upload (or local fs if CLOUDINARY_DISABLE=true)
    │
    ▼
MongoDB File record: { userId, fileName, filePath, mimeType, size, cloudinaryId }
    │
    ▼
(For PDF/DOCX) Auto-start edit session → open editing pane
```

### Code Locations
| What | Where |
|------|-------|
| Upload handler | `server/controllers/fileController.js` → `uploadFile()` (L437) |
| File analysis | `server/controllers/fileController.js` → `analyzeFile()` (L534) |
| Routes | `server/routes/fileRoutes.js` |
| Client service | `client/src/services/fileService.js` |
| Auto-edit start | `client/src/pages/ChatPage.jsx` → `handleFileUpload()` (L2345) |

---

## 12. Subscription & Payments

### Flow Diagram
```
GET /api/subscription/price
    │
    ▼
User sees pricing (₹499 default)
    │
    ▼
Optional: validate coupon
    │
    ▼
POST /api/subscription/order
  → Razorpay order created
    │
    ▼
Razorpay checkout opens in browser
    │
    ▼
POST /api/subscription/verify
  → Signature validation
  → User upgraded to premium
    │
    ▼
Webhook: POST /api/subscription/webhook
  → Async event confirmation
```

### Code Locations
| What | Where |
|------|-------|
| Controller | `server/controllers/subscriptionController.js` (403 lines) |
| Routes | `server/routes/subscription.js` |
| Client | `client/src/pages/Subscription.jsx` |
| Service | `client/src/services/subscriptionService.js` |

---

## 13. Legal Analysis ("Learn More")

### Flow
```
User clicks "Learn More About This Law"
    │
    ▼
POST /api/chat/legal-analysis
    │
    ▼
generateLegalAnalysis() (chatController.js L4696)
  1. Extract law/section refs from conversation
  2. Create InlineActionResponse record
  3. LLM generates comprehensive analysis
  4. Returns: sections, case law, tips, examples
```

### Code Locations
| What | Where |
|------|-------|
| Handler | `server/controllers/chatController.js` → `generateLegalAnalysis()` (L4696) |
| RAG utility | `server/utils/legalRAG.js` → `enhancePromptWithLegalContext()` |
| Client | `client/src/components/LegalGuidanceModal.jsx` |

---

## 14. Knowledge Base & RAG

### Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/knowledge/laws` | Add law |
| `POST` | `/api/knowledge/cases` | Add case |
| `POST` | `/api/knowledge/sections` | Add section |
| `GET` | `/api/knowledge/search?q=...` | Search knowledge |
| `GET` | `/api/knowledge/stats` | Stats |
| `POST` | `/api/legal/process-all` | Admin: ingest all documents |

### Code Locations
| What | Where |
|------|-------|
| Controller | `server/controllers/knowledgeController.js` (164 lines) |
| Routes | `server/routes/knowledgeRoutes.js` |
| RAG service | `server/services/documentIngestion.js` |
| Legal routes | `server/routes/legalRoutes.js` |
| Knowledge utility | `server/utils/knowledgeBase.js` |

---

## 15. Profile Management

### Features
- View/update name
- Profile image upload (Cloudinary)
- Multi-step email change (verify old → verify new)
- Password change with OTP

### API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/profile/info` | Get profile |
| `PUT` | `/api/profile/info` | Update name |
| `POST` | `/api/profile/profile-image` | Upload avatar |
| `POST` | `/api/profile/email/initiate-change` | Start email change |
| `POST` | `/api/profile/email/verify-current` | Verify current email OTP |
| `POST` | `/api/profile/email/initiate-new` | Send OTP to new email |
| `POST` | `/api/profile/email/complete-change` | Complete email change |
| `POST` | `/api/profile/password/initiate-change` | Start password change |
| `POST` | `/api/profile/password/complete-change` | Complete password change |

### Code Locations
| What | Where |
|------|-------|
| Controller | `server/controllers/profileController.js` (315 lines) |
| Routes | `server/routes/profile.js` |
| Client | `client/src/pages/Profile.jsx` |

---

## 16. Contact Form

Simple contact submission → email to company.

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `/api/contact/` | Submit contact form |

### Code Locations
| What | Where |
|------|-------|
| Controller | `server/controllers/contactController.js` |
| Route | `server/routes/contactRoutes.js` |

---

## Models (MongoDB Collections)

| Model | File | Purpose |
|-------|------|---------|
| `User` | `server/models/User.js` | Users with auth, tier, 2FA |
| `Chat` | `server/models/Chat.js` | Conversation messages |
| `File` | `server/models/File.js` | Uploaded files metadata |
| `Subscription` | `server/models/Subscription.js` | Payment records |
| `SubscriptionPrice` | `server/models/SubscriptionPrice.js` | Dynamic pricing |
| `FreeMessageLimit` | `server/models/FreeMessageLimit.js` | Free tier limits |
| `FeatureAccessMatrix` | `server/models/FeatureAccessMatrix.js` | Tier-based feature gates |
| `TemplateDesign` | `server/models/TemplateDesign.js` | Visual design configs |
| `InlineActionResponse` | `server/models/InlineActionResponse.js` | Action lifecycle tracking |
| `Coupon` | `server/models/Coupon.js` | Discount coupons |
| `Law` / `LegalCase` / `LegalSection` | `server/models/` | Knowledge base |
| `ContactMessage` | `server/models/ContactMessage.js` | Contact submissions |

---

## Environment Variables Reference

See `server/env.example` for the complete list. Key variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/dastavezai` |
| `JWT_SECRET` | JWT signing key | (required) |
| `OLLAMA_BASE_URL` | Local LLaMA endpoint | `http://localhost:11434` |
| `GEMINI_API_KEY` | Google Gemini API key | (fallback AI) |
| `RAZORPAY_KEY_ID` | Razorpay payment key | (for subscriptions) |
| `REDIS_URL` | Redis connection | `redis://localhost:6379` |
| `CLOUDINARY_*` | Cloudinary credentials | (file storage) |
| `SMTP_*` | Email server config | (for OTPs) |
| `SUBSCRIPTION_DISABLE` | Skip subscription checks | `true` (dev) |
| `CLOUDINARY_DISABLE` | Use local file storage | `true` (dev) |
