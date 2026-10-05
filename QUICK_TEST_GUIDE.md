 Quick Start: Test the Fixed Context & Placeholder Features

 Prerequisites
- MongoDB running (verify with: `mongo` or check connection in server logs)
- Ollama running locally on localhost:11434 (for local LLM, or configure your LLM endpoint)

 1. Start the Server
```bash
cd server
npm run dev
```

Watch for this log message:
```
🚀 Server running on port 5000
📱 Environment: development
```

 2. Test Scenario: Vehicle Theft Document Request

**Step 1** - Send first message (opens new chat):
```
User Message: "I need legal help with a vehicle theft in Rajiv Chowk, Delhi"
```

Server logs will show:
```
Intent classification: {
  type: 'DOCUMENT_REQUEST',
  confidence: 0.85,
  metadata: { hasContext: false, documentType: 'legal_notice', ... }
}
```

**Step 2** - Send follow-up (context should now be included):
```
User Message: "I have CCTV footage, thief's name, and phone video recordings"
```

Server logs will show:
```
Intent classification: {
  type: 'DOCUMENT_REQUEST',
  confidence: 0.85,
  metadata: { hasContext: true, documentType: 'legal_notice', ... }
}
Template selection result for user [...]: {
  relPath: 'NI Drafts\\Notice-under-section-138...',
  displayTitle: 'Notice Under Section 138...'
}
```

**Step 3** - Request document generation:
```
User Message: "Generate legal notice"
```

**Expected Output** - One of two scenarios:

**Scenario A: Missing Fields (Good - This is the fix!)**
```
Assistant Response:
"Some required information is missing. Please include: Complainant Name, Respondent Name, Incident Date, Location Details."
```

**Then user provides:**
```
User: "Complainant: Raman Kumar, Respondent: Unknown (auto-filled from CCTV), Date: Jan 21 2026, Location: Rajiv Chowk Market"
```

**Then assistant generates with all fields filled**

**Scenario B: All Fields Present**
```
Assistant Response:
"I've prepared your Notice Under Section 138. You can review and download it below."
[File ready for download with all user data filled in]
```

### 3. Verify the Features Work

#### Feature 1: Context Awareness ✓
- [ ] Check server logs for `hasContext: true` after 2nd message
- [ ] Verify `documentType` is correctly detected as 'legal_notice'
- [ ] Try sending vague request like "create it" → system should understand it's about vehicle theft

#### Feature 2: Placeholder Enforcement ✓
- [ ] Try requesting document with incomplete details
- [ ] Verify system asks for specific missing fields (not generic "provide details")
- [ ] Confirm no `.docx` file is generated until all required fields are provided

#### Feature 3: Persistence After Restart ✓
- [ ] Send several related messages
- [ ] Restart server (`ctrl+c` then `npm run dev`)
- [ ] Send a new message that depends on previous context
- [ ] Check logs for `hasContext: true` even after restart
- [ ] Verify correct template is still selected

### 4. Troubleshooting

**Problem: `hasContext: false` for all messages**
```
Solution: Check MongoDB connection
- Verify MongoDB is running: ps aux | grep mongod
- Check logs for "Connected to MongoDB" message
- Verify MONGODB_URI in .env file
```

**Problem: Messages not being saved**
```
Solution: Check Chat collection in MongoDB
db.chats.findOne({ userId: "your_user_id" })
// Should show array of messages with timestamps
```

**Problem: Document always generates with missing fields**
```
Solution: Verify template schema is defined
// Check if template has schema property with required fields
// If not, add schema definition to template
```

**Problem: Intent classifier always falls back to CONVERSATIONAL**
```
Solution: Check Ollama/LLM connection
- Verify Ollama: curl http://localhost:11434/api/tags
- Check timeout: grep "INTENT_LLM_TIMEOUT" server/.env
- Increase timeout if LLM is slow: INTENT_LLM_TIMEOUT_MS=30000
```

### 5. Key Configuration

Add these to your `.env` file to customize behavior:

```bash
# Number of previous messages to use as context (default: 5)
AGENT_HISTORY_LIMIT=5

# Whether to auto-fill missing fields with defaults (default: false)
AGENT_AUTO_FILL_PLACEHOLDERS=false

# LLM timeout for intent classification in milliseconds (default: 15000)
INTENT_LLM_TIMEOUT_MS=15000

# Minimum confidence score to auto-start document generation (default: 0.4)
DOC_AUTO_START_CONFIDENCE=0.4
```

### 6. Expected File Changes

These files were modified:
- ✅ `server/services/conversationService.js` (NEW - 107 lines)
- ✅ `server/services/intentClassifier.js` (MODIFIED - context parameter added)
- ✅ `server/controllers/chatController.js` (MODIFIED - history loading + schema checks)
- ✅ `server/env.example` (MODIFIED - new config vars)

### 7. API Flow Visualization

```
User sends message
    ↓
Load last 5 messages from MongoDB ← NEW
    ↓
Format into context string ← NEW
    ↓
Call intentClassifier(message, context) ← UPDATED (context param added)
    ↓
LLM uses both context + message ← NEW
    ↓
Route to handler (DOCUMENT_REQUEST, LEGAL_INFO, etc)
    ↓
If DOCUMENT_REQUEST:
  ├─ Select template
  ├─ Extract fields
  ├─ Check template schema for required fields ← NEW
  ├─ Compare extracted vs required ← NEW
  ├─ If missing → Ask user to fill ← NEW
  └─ If complete → Generate document
```

### 8. Success Criteria Checklist

- [ ] Context loads from MongoDB after first message
- [ ] Intent classifier receives context in LLM prompt
- [ ] Template schema is checked before document generation
- [ ] User is asked for missing fields before generation
- [ ] No blank/placeholder fields in generated `.docx` files
- [ ] After server restart, context is available immediately
- [ ] System correctly identifies document type from conversation history

---


