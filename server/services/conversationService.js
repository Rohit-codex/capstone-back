import Chat from '../models/Chat.js';

export async function getConversationHistory(userId, limit = null, slug = 'default') {
  if (limit === null) {
    limit = parseInt(process.env.AGENT_HISTORY_LIMIT || '5', 10);
  }
  try {
    let query = { userId };
    if (slug) query.slug = slug;
    
    let chat = await Chat.findOne(query).select('messages').lean();
    if (!chat && slug !== 'default') {
      // Fallback: try finding active chat by userId if exact slug query returns empty
      chat = await Chat.findOne({ userId }).sort({ updatedAt: -1 }).select('messages').lean();
    }

    if (!chat || !chat.messages || chat.messages.length === 0) {
      return [];
    }

    const recentMessages = chat.messages.slice(-limit);
    return recentMessages;
  } catch (error) {
    console.error(`Error retrieving conversation history for user ${userId} [slug: ${slug}]:`, error.message);
    return [];
  }
}

export function formatContextFromHistory(messages = []) {
  if (!messages || messages.length === 0) {
    return '';
  }

  return messages
    .map(msg => {
      const role = msg.role === 'assistant' ? 'Assistant' : 'User';
      const text = msg.content || '';
      return `${role}: ${text}`;
    })
    .join('\n');
}

export async function saveMessage(userId, role, content, slug = 'default') {
  try {
    if (!userId || !role || !content) {
      console.warn('Invalid message parameters:', { userId, role, content: content?.substring(0, 50) });
      return null;
    }

    if (!['user', 'assistant'].includes(role)) {
      console.warn(`Invalid role: ${role}`);
      return null;
    }

    const newMessage = {
      role,
      content: String(content).trim(),
      timestamp: new Date()
    };

    const targetSlug = slug || 'default';
    const firstMsgTitle = role === 'user' ? String(content).trim().substring(0, 35) + '...' : 'New Conversation';

    const chat = await Chat.findOneAndUpdate(
      { userId, slug: targetSlug },
      { 
        $push: { messages: newMessage },
        $setOnInsert: { title: firstMsgTitle }
      },
      { new: true, upsert: true }
    );

    return chat;
  } catch (error) {
    console.error(`Error saving message for user ${userId} [slug: ${slug}]:`, error.message);
    return null;
  }
}

export async function clearConversationHistory(userId, slug = 'default') {
  try {
    const query = slug ? { userId, slug } : { userId };
    await Chat.updateOne(
      query,
      { $set: { messages: [] } }
    );
  } catch (error) {
    console.error(`Error clearing conversation history for user ${userId} [slug: ${slug}]:`, error.message);
  }
}

export async function getFullConversation(userId, slug = 'default') {
  try {
    const query = slug ? { userId, slug } : { userId };
    const chat = await Chat.findOne(query).select('messages').lean();
    return chat?.messages || [];
  } catch (error) {
    console.error(`Error retrieving full conversation for user ${userId} [slug: ${slug}]:`, error.message);
    return [];
  }
}

export const conversationService = {
  getConversationHistory,
  formatContextFromHistory,
  saveMessage,
  clearConversationHistory,
  getFullConversation
};

export default conversationService;
