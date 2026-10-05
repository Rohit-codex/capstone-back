import mongoose from 'mongoose';
import path from 'path';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import MessageCount from '../models/MessageCount.js';
import InlineActionResponse from '../models/InlineActionResponse.js';
import redis from '../utils/redisClient.js';
import { getMessageLimitForTier } from '../models/SubscriptionPrice.js';
import { callLocalLLM, writeDocxFromText } from './chatController.js';

export const generateComplaint = async (req, res) => {
  try {
    const { complaintData, actionContext, designConfig } = req.body;
    const userId = req.user.id;
    const slug = req.headers['x-chat-slug'] || req.query.slug || req.body.slug || 'default';
    
    console.log('📝 Generating complaint');
    console.log('  - userId:', userId);
    console.log('  - complaintType:', complaintData?.complaintType);
    console.log('  - againstWhom:', complaintData?.againstWhom);
    
    
    if (!complaintData || !complaintData.complaintType || !complaintData.description) {
      return res.status(400).json({
        success: false,
        message: 'Missing required complaint data'
      });
    }
    
    
    const actionResponse = new InlineActionResponse({
      userId: new mongoose.Types.ObjectId(userId),
      actionType: 'GENERATE_COMPLAINT',
      actionContext: {
        originalMessage: actionContext?.originalMessage || '',
        aiResponseExcerpt: actionContext?.aiResponseExcerpt || '',
        metadata: actionContext
      },
      userResponses: complaintData,
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
    
    
    const complaintTypeLabels = {
      'consumer': 'Consumer Complaint',
      'police': 'Police Complaint (First Information Report)',
      'workplace': 'Workplace Harassment Complaint',
      'defamation': 'Defamation Complaint',
      'property': 'Property Dispute Complaint',
      'service': 'Service Deficiency Complaint',
      'banking': 'Banking Complaint',
      'insurance': 'Insurance Claim Complaint',
      'online_fraud': 'Online Fraud Complaint',
      'other': 'General Complaint'
    };
    
    const complaintTypeLabel = complaintTypeLabels[complaintData.complaintType] || 'Legal Complaint';
    
    const complaintPrompt = `Generate a formal, professional ${complaintTypeLabel} with the following details:
 
**COMPLAINANT INFORMATION:**
This will be provided by the user separately (name, address, contact details).
 
**RESPONDENT/AGAINST:**
${complaintData.againstWhom}
 
**DATE OF INCIDENT:**
${complaintData.incidentDate}
 
${complaintData.location ? `**LOCATION OF INCIDENT:**\n${complaintData.location}\n\n` : ''}
 
**DETAILED DESCRIPTION OF INCIDENT:**
${complaintData.description}
 
${complaintData.evidence && complaintData.evidence.length > 0 ? `**AVAILABLE EVIDENCE:**\n${complaintData.evidence.join(', ')}\n\n` : ''}
 
**DESIRED OUTCOME/RELIEF SOUGHT:**
${complaintData.desiredOutcome}
 
**URGENCY:**
${complaintData.urgency.toUpperCase()}
 
**INSTRUCTIONS:**
1. Generate a complete, formal legal complaint following standard Indian legal format
2. Include the following sections in order:
   - Title and Reference Number (use placeholder: [COMPLAINT NO: ___])
   - To: [Appropriate Authority - suggest based on complaint type]
   - Subject Line (concise, professional)
   - Complainant Details (use placeholder: [COMPLAINANT NAME, ADDRESS, CONTACT])
   - Respondent/Against Whom details (use provided information)
   - Date and Location of Incident
   - Factual Background and Chronology of Events (numbered, chronological)
   - Specific Grievances and Violations (numbered list)
   - Applicable Legal Provisions (relevant sections, acts, rules)
   - Supporting Evidence (if mentioned, create structured list)
   - Relief Sought (be specific based on desired outcome)
   - Declaration and Verification Statement
   - Signature Block (placeholders)
   
3. Use professional, formal legal language appropriate for Indian courts/authorities
4. Include relevant legal provisions based on the complaint type
5. Structure the complaint clearly with headings and numbered paragraphs
6. Add [PLACEHOLDER] markers where user needs to fill personal details
7. Make it ready to print and submit to relevant authority
 
Generate the complete complaint document now:`;
    
    console.log('🤖 Calling local Llama model for complaint generation...');
    const complaintText = await callLocalLLM(complaintPrompt);
    
    if (!complaintText || complaintText.includes('Error')) {
      throw new Error('Failed to generate complaint from local model');
    }
    
    console.log('✅ Complaint text generated, length:', complaintText.length);
    console.log('🔍 First 200 chars:', complaintText.substring(0, 200));
    
    
    const documentTitle = `${complaintTypeLabel.replace(/\s+/g, '_')}_${Date.now()}`;
    console.log('💾 Creating DOCX file with title:', documentTitle);
    
    const { filePath, fileSize } = await writeDocxFromText(
      complaintText, 
      documentTitle, 
      'uploads',
      designConfig || null
    );
    
    console.log(`✅ Complaint document saved: ${filePath}, size: ${fileSize} bytes`);
    
    
    const fileName = path.basename(filePath);
    const downloadUrl = `/api/files/download/${fileName}`;
    
    
    await actionResponse.markCompleted({
      content: complaintText,
      downloadUrl,
      fileName,
      fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize
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
              { 
                role: 'user', 
                content: `Generate ${complaintTypeLabel}: Against ${complaintData.againstWhom}` 
              },
              { 
                role: 'assistant', 
                content: `I've generated your ${complaintTypeLabel}. The document is ready for download.` 
              }
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
    
    
    const lang = req?.preferredLanguage || 'en';
    const postComplaintActions = lang === 'hi' ? [
      { type: 'action', label: 'यही शिकायत फिर से बनाएं', icon: '🔄', action: 'REGENERATE_SAME', description: 'वही शिकायत नए डेटा के साथ बनाएं' },
      { type: 'action', label: 'शिकायत संपादित करें', icon: '✏️', action: 'EDIT_DOCUMENT', description: 'मौजूदा शिकायत को संपादित करें' },
      { type: 'action', label: 'बाहर निकलें', icon: '✖️', action: 'EXIT_DOCUMENT_MODE', description: 'दस्तावेज़ मोड से बाहर निकलें' }
    ] : [
      { type: 'action', label: 'Regenerate Same', icon: '🔄', action: 'REGENERATE_SAME', description: 'Generate the same complaint with new data' },
      { type: 'action', label: 'Edit Document', icon: '✏️', action: 'EDIT_DOCUMENT', description: 'Edit the current complaint' },
      { type: 'action', label: 'Exit', icon: '✖️', action: 'EXIT_DOCUMENT_MODE', description: 'Exit document mode' }
    ];
    
    return res.json({
      success: true,
      response: `I've generated your ${complaintTypeLabel}. The document includes all necessary sections with your provided information and relevant legal provisions. Please review and fill in the [PLACEHOLDER] fields with your personal details before submission.`,
      file: {
        fileUrl: downloadUrl,
        fileName,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        size: fileSize
      },
      document: {
        preview: complaintText.substring(0, 500),
        fullContent: complaintText
      },
      complaintData: {
        complaintType: complaintData.complaintType,
        againstWhom: complaintData.againstWhom,
        incidentDate: complaintData.incidentDate,
        location: complaintData.location,
        description: complaintData.description,
        evidence: complaintData.evidence,
        desiredOutcome: complaintData.desiredOutcome,
        urgency: complaintData.urgency
      },
      suggestedActions: postComplaintActions,
      mode: 'document_ready',
      remainingMessages: isPremium ? null : remainingMessages,
      subscriptionStatus: user.subscriptionStatus
    });
    
  } catch (error) {
    console.error('Complaint generation error:', error);
    
    
    try {
      const actionResponse = await InlineActionResponse.findOne({
        userId: req.user.id,
        actionType: 'GENERATE_COMPLAINT',
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
      message: 'Failed to generate complaint. Please try again.',
      error: error.message
    });
  }
};
