import DocumentSession from '../models/DocumentSession.js';
import { documentExtractor } from './documentExtractor.js';

function normalizeTemplateSchema(schema) {
  if (!schema) return [];
  if (Array.isArray(schema)) return schema;
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema);
    } catch {
      try {
        return eval(`(${schema})`);
      } catch (err) {
        console.warn('Failed to parse template schema string', err?.message || err);
        return [];
      }
    }
  }
  return [];
}

export async function getOrCreateDocumentSession(userId, template, slug = 'default') {
  try {
    let session = await DocumentSession.findOne({
      userId,
      slug,
      status: 'active'
    });

    if (!session) {
      const parsedSchema = normalizeTemplateSchema(template.schema);
      const requiredFields = parsedSchema.filter(f => f.required);
      
      session = new DocumentSession({
        userId,
        slug,
        template: {
          relPath: template.relPath,
          displayTitle: template.displayTitle,
          schema: parsedSchema
        },
        requiredFields,
        missingFields: requiredFields.map(f => ({ key: f.key, label: f.label || f.key })),
        accumulatedData: new Map(),
        conversationHistory: []
      });

      await session.save();
      console.log(`📋 Created new DocumentSession for user ${userId} [slug: ${slug}]:`, {
        template: template.displayTitle,
        requiredFields: requiredFields.length
      });
    }

    return session;
  } catch (error) {
    console.error('Error managing document session:', error);
    throw error;
  }
}

export async function accumulateExtractedFields(userId, newExtractedData, slug = 'default') {
  try {
    let session = await DocumentSession.findOne({ userId, slug, status: 'active' });
    
    // Fallback: if not found by exact slug, check if default session exists
    if (!session && slug !== 'default') {
      session = await DocumentSession.findOne({ userId, status: 'active' });
    }

    if (!session) {
      throw new Error('No active document session found');
    }

    const previouslyFilled = new Set();
    for (const [k, v] of session.accumulatedData.entries()) {
      if (v && v !== null && v !== undefined && String(v).trim().length > 0) {
        previouslyFilled.add(k);
      }
    }

    for (const [key, value] of Object.entries(newExtractedData || {})) {
      if (value && value !== null && value !== undefined && value !== '') {
        session.accumulatedData.set(key, value);
      }
    }

    const stillMissing = [];
    const newlyFilledFields = [];

    for (const requiredField of session.requiredFields) {
      const storedValue = session.accumulatedData.get(requiredField.key);
      const hasValue = storedValue && storedValue !== null && storedValue !== undefined && String(storedValue).trim().length > 0;
      
      if (hasValue) {
        if (!previouslyFilled.has(requiredField.key)) {
          newlyFilledFields.push(requiredField.key);
        }
      } else {
        stillMissing.push(requiredField.key);
      }
    }

    session.missingFields = stillMissing.map(key => {
      const field = session.requiredFields.find(f => f.key === key);
      return { key, label: field?.label || key };
    });

    session.markModified('accumulatedData');
    session.markModified('missingFields');
    session.turnCount += 1;

    await session.save();

    console.log(`📝 Updated DocumentSession for user ${userId} [slug: ${slug}]:`, {
      newlyFilled: newlyFilledFields,
      stillMissing: stillMissing.length,
      turn: session.turnCount
    });

    return {
      session,
      newlyFilledFields,
      stillMissing,
      isComplete: stillMissing.length === 0
    };
  } catch (error) {
    console.error('Error accumulating extracted fields:', error);
    throw error;
  }
}

export async function recordSessionTurn(userId, userMessage, assistantResponse, extractedThisTurn, stillMissing, slug = 'default') {
  try {
    const session = await DocumentSession.findOne({ userId, slug, status: 'active' });
    
    if (!session) return;

    session.conversationHistory.push({
      turn: session.turnCount,
      userMessage,
      assistantResponse,
      extractedThisTurn: new Map(Object.entries(extractedThisTurn || {})),
      stillMissing,
      timestamp: new Date()
    });

    await session.save();
  } catch (error) {
    console.warn('Error recording session turn:', error?.message || error);
  }
}

export async function getSessionAccumulatedData(userId, slug = 'default') {
  try {
    const session = await DocumentSession.findOne({ userId, slug, status: 'active' });
    
    if (!session) {
      return null;
    }

    return Object.fromEntries(session.accumulatedData);
  } catch (error) {
    console.error('Error retrieving session data:', error);
    throw error;
  }
}

export async function completeDocumentSession(userId, slug = 'default') {
  try {
    const session = await DocumentSession.findOne({ userId, slug, status: 'active' });
    
    if (!session) return;

    session.status = 'completed';
    await session.save();

    console.log(`✅ Completed DocumentSession for user ${userId} [slug: ${slug}]`);

    return session;
  } catch (error) {
    console.error('Error completing session:', error);
    throw error;
  }
}

export async function getSessionInfo(userId, slug = 'default') {
  try {
    const session = await DocumentSession.findOne({ userId, slug, status: 'active' });
    
    if (!session) {
      return null;
    }

    return {
      template: session.template.displayTitle,
      totalRequiredFields: session.requiredFields.length,
      filledFields: session.accumulatedData.size,
      missingFields: session.missingFields,
      progress: `${session.accumulatedData.size}/${session.requiredFields.length}`,
      turn: session.turnCount,
      accumulatedData: Object.fromEntries(session.accumulatedData)
    };
  } catch (error) {
    console.error('Error getting session info:', error);
    return null;
  }
}

export async function abandonDocumentSession(userId, slug = 'default') {
  try {
    const query = slug ? { userId, slug, status: 'active' } : { userId, status: 'active' };
    const session = await DocumentSession.findOne(query);
    
    if (!session) return;

    session.status = 'abandoned';
    await session.save();

    console.log(`❌ Abandoned DocumentSession for user ${userId} [slug: ${slug}]`);
  } catch (error) {
    console.error('Error abandoning session:', error);
  }
}
