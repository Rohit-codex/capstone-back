import mongoose from 'mongoose';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import MessageCount from '../models/MessageCount.js';
import InlineActionResponse from '../models/InlineActionResponse.js';
import redis from '../utils/redisClient.js';
import { getMessageLimitForTier } from '../models/SubscriptionPrice.js';
import { logError } from '../utils/errorCodes.js';
import { callLocalLLM } from './chatController.js';

export const generateLegalAnalysis = async (req, res) => {
  try {
    const { lawReference, previousMessage, previousResponse } = req.body;
    const userId = req.user.id;
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    
    console.log('⚖️ Generating in-depth legal analysis');
    console.log('  - userId:', userId);
    console.log('  - lawReference:', lawReference);
    console.log('  - previousMessage length:', previousMessage?.length || 0);
    console.log('  - previousResponse length:', previousResponse?.length || 0);
    
    if (!lawReference && !previousResponse) {
      return res.status(400).json({
        success: false,
        message: 'Law reference or previous response required'
      });
    }
    
    
    let analysisSubject = lawReference;
    if (!analysisSubject && previousResponse) {
      
      const sectionMatch = previousResponse.match(/Section\s+\d+[A-Z]?/gi);
      const actMatch = previousResponse.match(/(IPC|CrPC|CPC|IT Act|Consumer Protection Act|[A-Z][a-z]+\s+Act,?\s+\d{4})/gi);
      
      if (sectionMatch && sectionMatch.length > 0) {
        analysisSubject = sectionMatch[0];
        if (actMatch && actMatch.length > 0) {
          analysisSubject += ` of ${actMatch[0]}`;
        }
      } else if (actMatch && actMatch.length > 0) {
        analysisSubject = actMatch[0];
      } else {
        analysisSubject = 'the law mentioned in our previous conversation';
      }
    }
    
    
    const actionResponse = new InlineActionResponse({
      userId: new mongoose.Types.ObjectId(userId),
      actionType: 'LEARN_MORE_LAW',
      actionContext: {
        originalMessage: previousMessage || '',
        aiResponseExcerpt: previousResponse ? previousResponse.substring(0, 500) : '',
        lawSections: [analysisSubject],
        metadata: { lawReference }
      },
      status: 'pending'
    });
    
    await actionResponse.save();
    
    
    const user = await User.findById(new mongoose.Types.ObjectId(userId)).select('subscriptionStatus').lean();
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    
    const analysisPrompt = `Provide an exhaustive, in-depth legal analysis of ${analysisSubject} for Indian law with the following structure:
 
## 📋 Overview
Provide a concise 2-3 sentence summary of what this law/section covers and its primary purpose.
 
## 🔑 Key Provisions (Table Format)
Create a detailed table with these columns:
| Provision/Sub-section | Description | Penalty/Consequence | Applicability |
|----------------------|-------------|---------------------|---------------|
[Fill with at least 4-6 key provisions]
 
## 💼 Practical Applications & Real-World Scenarios
 
### Scenario 1: [Common situation title]
- **Facts:** [Describe a realistic fact pattern]
- **Legal Analysis:** [How this law applies]
- **Outcome:** [Expected legal result]
- **Practical Tip:** [Advice for handling similar situations]
 
### Scenario 2: [Another common situation]
[Repeat structure]
 
### Scenario 3: [Complex/edge case]
[Repeat structure]
 
[Include 3-5 scenarios covering different contexts]
 
## 📚 Relevant Case Law (Table Format)
| Case Name | Year | Court | Key Holding | Relevance |
|-----------|------|-------|-------------|-----------|
[Include at least 3-5 landmark cases]
 
## 👥 Who Can Use This Law / Eligibility
 
**Eligible Persons/Entities:**
- [List who can invoke/use this provision]
 
**Procedural Requirements:**
- [Step-by-step procedure]
 
**Time Limitations:**
- Limitation period: [specify]
- Important deadlines: [specify]
 
**Documents Required:**
- [List necessary documentation]
 
## ⚠️ Common Misconceptions & Confusions
 
**This law is often confused with:**
1. [Similar law/provision] - **Key Difference:** [Explain]
2. [Another related provision] - **Key Difference:** [Explain]
 
**Common Mistakes to Avoid:**
- [List 3-5 common errors people make]
 
## 🆕 Recent Amendments & Updates
[If applicable, list recent changes, their effective dates, and impact]
[If no recent amendments: State "No significant amendments in the past 5 years"]
 
## ⚡ Practical Tips for Legal Practitioners
 
1. **Documentation:** [What to document]
2. **Evidence Collection:** [What evidence is crucial]
3. **Timing Considerations:** [When to act]
4. **Common Pitfalls:** [What to avoid]
5. **Strategic Approach:** [Best practices]
 
## 🔗 Related Laws & Cross-References
- [List related sections, acts, rules that interact with this provision]
 
## ❓ Frequently Asked Questions
 
**Q1: [Most common question]**
A: [Clear answer]
 
**Q2: [Second common question]**
A: [Clear answer]
 
[Include 4-6 FAQs]
 
## 📊 Statistical Context
[If available, include statistics about how often this law is invoked, conviction rates, typical penalties awarded, etc.]
 
---
 
**IMPORTANT:** 
- Use proper Markdown formatting with tables, bullet points, numbered lists
- Make tables readable and well-structured
- Include specific section numbers and act names
- Provide citations for case law
- Use bold (**text**) for emphasis
- Keep language clear but professional
`;
    
    console.log('🤖 Calling local Llama model for legal analysis...');
    const analysisText = await callLocalLLM(analysisPrompt);
    
    if (!analysisText || analysisText.includes('Error')) {
      throw new Error('Failed to generate legal analysis from local model');
    }
    
    
    await actionResponse.markCompleted({
      content: analysisText
    });
    
    
    let remainingMessages = null;
    const limit = await getMessageLimitForTier(user.subscriptionStatus);
    const isPremium = limit === -1;
    if (limit !== -1) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      let mc = await MessageCount.findOne({
        userId: new mongoose.Types.ObjectId(userId),
        date: today
      });
      if (!mc) {
        mc = new MessageCount({ userId: new mongoose.Types.ObjectId(userId), date: today, count: 0 });
      }
      mc.count += 1;
      await mc.save();
      remainingMessages = Math.max(0, limit - mc.count);
    }
    
    
    await Chat.findOneAndUpdate(
      { userId: new mongoose.Types.ObjectId(userId), slug },
      { 
        $push: { 
          messages: { 
            $each: [
              { role: 'user', content: `Provide detailed analysis of ${analysisSubject}` },
              { role: 'assistant', content: analysisText }
            ] 
          } 
        } 
      },
      { upsert: true }
    );
    
    
    try {
      await redis.del(`chat:${userId}:${slug}`);
    } catch (err) {
      console.warn('Cache clear failed:', err.message);
    }
    
    return res.json({
      success: true,
      response: analysisText,
      mode: 'legal_analysis',
      analysisSubject,
      remainingMessages: isPremium ? null : remainingMessages,
      subscriptionStatus: user.subscriptionStatus
    });
    
  } catch (error) {
    console.error('Legal analysis generation error:', error);
    logError('INFO001', error, { context: 'learn_more_law', userId: req.user?.id });
    
    
    try {
      const actionResponse = await InlineActionResponse.findOne({
        userId: req.user.id,
        actionType: 'LEARN_MORE_LAW',
        status: 'pending'
      }).sort({ createdAt: -1 });
      
      if (actionResponse) {
        await actionResponse.markAbandoned();
      }
    } catch (err) {
      console.warn('Failed to mark action as abandoned:', err.message);
    }
    
    return res.status(500).json({
      success: false,
      message: 'Failed to generate legal analysis. Please try again.',
      error: error.message
    });
  }
};
