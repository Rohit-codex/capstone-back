

const ERROR_CATEGORIES = {
  VALIDATION: 'VAL',
  AUTHENTICATION: 'AUTH',
  AI_SERVICE: 'AI',
  DOCUMENT: 'DOC',
  DATABASE: 'DB',
  NETWORK: 'NET',
  SYSTEM: 'SYS',
  TEMPLATE: 'TEMPLATE',
  INTENT: 'INTENT',
  EXTRACTION: 'EXTRACT'
};

export const ERROR_CODES = {
  
  VAL001: {
    code: 'VAL001',
    category: ERROR_CATEGORIES.VALIDATION,
    title: 'Invalid Message Input',
    userMessage: 'Please provide a valid message (non-empty text under 1000 characters).',
    technicalMessage: 'Message validation failed: empty, too long, or invalid format',
    httpStatus: 400,
    severity: 'high',
    userAction: 'Check your message format and try again'
  },
  VAL002: {
    code: 'VAL002',
    category: ERROR_CATEGORIES.VALIDATION,
    title: 'Invalid User ID',
    userMessage: 'User authentication is invalid. Please log in again.',
    technicalMessage: 'Invalid MongoDB ObjectId format for user ID',
    httpStatus: 400,
    severity: 'high',
    userAction: 'Log out and log back in'
  },
  VAL003: {
    code: 'VAL003',
    category: ERROR_CATEGORIES.VALIDATION,
    title: 'Missing Required Fields',
    userMessage: 'Some required information is missing. Please provide complete details.',
    technicalMessage: 'Request missing required fields for document generation',
    httpStatus: 400,
    severity: 'medium',
    userAction: 'Fill in all required information'
  },

  
  AUTH001: {
    code: 'AUTH001',
    category: ERROR_CATEGORIES.AUTHENTICATION,
    title: 'User Not Found',
    userMessage: 'Your account was not found. Please check your login or contact support.',
    technicalMessage: 'User not found in database',
    httpStatus: 404,
    severity: 'high',
    userAction: 'Check login credentials or contact support'
  },
  AUTH002: {
    code: 'AUTH002',
    category: ERROR_CATEGORIES.AUTHENTICATION,
    title: 'Account Inactive',
    userMessage: 'Your account is currently inactive. Please contact support for assistance.',
    technicalMessage: 'User account marked as inactive',
    httpStatus: 403,
    severity: 'high',
    userAction: 'Contact support to reactivate account'
  },
  AUTH003: {
    code: 'AUTH003',
    category: ERROR_CATEGORIES.AUTHENTICATION,
    title: 'Daily Message Limit Reached',
    userMessage: 'You have reached your daily message limit (5 messages). Upgrade to premium for unlimited access, or try again tomorrow.',
    technicalMessage: 'Non-premium user exceeded daily message limit',
    httpStatus: 403,
    severity: 'medium',
    userAction: 'Upgrade to premium or wait until tomorrow'
  },
  AUTH004: {
    code: 'AUTH004',
    category: ERROR_CATEGORIES.AUTHENTICATION,
    title: 'Subscription Required',
    userMessage: 'Premium subscription required for this feature. Please upgrade your plan.',
    technicalMessage: 'Feature requires premium subscription',
    httpStatus: 403,
    severity: 'medium',
    userAction: 'Upgrade to premium subscription'
  },

  
  AI001: {
    code: 'AI001',
    category: ERROR_CATEGORIES.AI_SERVICE,
    title: 'AI Service Unavailable',
    userMessage: 'Our AI service is temporarily unavailable. Please try again in a few moments.',
    technicalMessage: 'Gemini API service down or unreachable',
    httpStatus: 503,
    severity: 'high',
    userAction: 'Wait a few minutes and try again'
  },
  AI002: {
    code: 'AI002',
    category: ERROR_CATEGORIES.AI_SERVICE,
    title: 'AI Service Rate Limited',
    userMessage: 'AI service is experiencing high demand. Please wait a moment and try again.',
    technicalMessage: 'Gemini API rate limit exceeded',
    httpStatus: 429,
    severity: 'medium',
    userAction: 'Wait 30-60 seconds and retry'
  },
  AI003: {
    code: 'AI003',
    category: ERROR_CATEGORIES.AI_SERVICE,
    title: 'AI Configuration Error',
    userMessage: 'AI system configuration issue detected. Our team has been notified.',
    technicalMessage: 'Gemini API key missing or invalid',
    httpStatus: 500,
    severity: 'critical',
    userAction: 'Contact support - this is a system issue'
  },
  AI004: {
    code: 'AI004',
    category: ERROR_CATEGORIES.AI_SERVICE,
    title: 'AI Response Timeout',
    userMessage: 'AI response took too long to generate. Please try a simpler request or try again.',
    technicalMessage: 'Gemini API timeout (20+ seconds)',
    httpStatus: 504,
    severity: 'medium',
    userAction: 'Simplify your request or try again'
  },
  AI005: {
    code: 'AI005',
    category: ERROR_CATEGORIES.AI_SERVICE,
    title: 'AI Content Safety Filter',
    userMessage: 'Your request triggered our safety filters. Please modify your question and try again.',
    technicalMessage: 'Gemini safety filters blocked content',
    httpStatus: 400,
    severity: 'low',
    userAction: 'Rephrase your request to be more specific'
  },

  
  DOC001: {
    code: 'DOC001',
    category: ERROR_CATEGORIES.DOCUMENT,
    title: 'Document Template Not Found',
    userMessage: 'We could not find a template for this type of document. Please specify the document type more clearly.',
    technicalMessage: 'Template not found for document generation request',
    httpStatus: 404,
    severity: 'medium',
    userAction: 'Specify the document type (e.g., "adoption deed", "sale deed", "legal notice")'
  },
  DOC002: {
    code: 'DOC002',
    category: ERROR_CATEGORIES.DOCUMENT,
    title: 'Document Generation Failed',
    userMessage: 'Failed to generate your document due to missing information. Please provide more details.',
    technicalMessage: 'Document generation failed due to incomplete data extraction',
    httpStatus: 422,
    severity: 'medium',
    userAction: 'Provide complete details (names, dates, addresses, etc.)'
  },
  DOC003: {
    code: 'DOC003',
    category: ERROR_CATEGORIES.DOCUMENT,
    title: 'Document Save Failed',
    userMessage: 'Document generated successfully but could not be saved. Please try downloading again.',
    technicalMessage: 'Failed to save document to file system',
    httpStatus: 500,
    severity: 'medium',
    userAction: 'Try generating the document again'
  },
  DOC004: {
    code: 'DOC004',
    category: ERROR_CATEGORIES.DOCUMENT,
    title: 'Document Enhancement Failed',
    userMessage: 'Document was generated but could not be enhanced. Your basic document is still available.',
    technicalMessage: 'AI enhancement of document failed',
    httpStatus: 206,
    severity: 'low',
    userAction: 'Use the generated document as-is or try again'
  },
  DOC005: {
    code: 'DOC005',
    category: ERROR_CATEGORIES.DOCUMENT,
    title: 'Multiple Templates Found',
    userMessage: 'Multiple document templates match your request. Please be more specific about what you need.',
    technicalMessage: 'Multiple templates found, user needs to choose',
    httpStatus: 300,
    severity: 'low',
    userAction: 'Specify which type of document you need exactly'
  },

  
  DB001: {
    code: 'DB001',
    category: ERROR_CATEGORIES.DATABASE,
    title: 'Database Connection Failed',
    userMessage: 'Database connection issue detected. Our team has been notified.',
    technicalMessage: 'MongoDB connection failed',
    httpStatus: 503,
    severity: 'critical',
    userAction: 'Contact support - this is a system issue'
  },
  DB002: {
    code: 'DB002',
    category: ERROR_CATEGORIES.DATABASE,
    title: 'Chat History Save Failed',
    userMessage: 'Your message was received but could not be saved to your chat history.',
    technicalMessage: 'Failed to save chat message to database',
    httpStatus: 500,
    severity: 'medium',
    userAction: 'Your query was processed, but chat history may not be updated'
  },
  DB003: {
    code: 'DB003',
    category: ERROR_CATEGORIES.DATABASE,
    title: 'Message Count Update Failed',
    userMessage: 'Message processed but usage count could not be updated.',
    technicalMessage: 'Failed to update message count in database',
    httpStatus: 500,
    severity: 'low',
    userAction: 'Your message was processed successfully'
  },

  
  NET001: {
    code: 'NET001',
    category: ERROR_CATEGORIES.NETWORK,
    title: 'Cache Service Unavailable',
    userMessage: 'System is running slower than usual. Your request is being processed.',
    technicalMessage: 'Redis cache service unavailable',
    httpStatus: 200,
    severity: 'low',
    userAction: 'No action needed - request will complete normally'
  },
  NET002: {
    code: 'NET002',
    category: ERROR_CATEGORIES.NETWORK,
    title: 'External Service Timeout',
    userMessage: 'External service is taking longer than expected. Please try again.',
    technicalMessage: 'External API timeout or slow response',
    httpStatus: 504,
    severity: 'medium',
    userAction: 'Wait and try again with a simpler request'
  },
  NET003: {
    code: 'NET003',
    category: ERROR_CATEGORIES.NETWORK,
    title: 'Network Connectivity Issue',
    userMessage: 'Network connectivity issue detected. Please check your internet connection.',
    technicalMessage: 'Network connection problems detected',
    httpStatus: 503,
    severity: 'medium',
    userAction: 'Check your internet connection and try again'
  },

  
  SYS001: {
    code: 'SYS001',
    category: ERROR_CATEGORIES.SYSTEM,
    title: 'Unexpected System Error',
    userMessage: 'An unexpected error occurred. Our team has been notified and is investigating.',
    technicalMessage: 'Unhandled system exception occurred',
    httpStatus: 500,
    severity: 'critical',
    userAction: 'Contact support if this persists'
  },
  SYS002: {
    code: 'SYS002',
    category: ERROR_CATEGORIES.SYSTEM,
    title: 'Server Memory Pressure',
    userMessage: 'System is experiencing high load. Please try a simpler request.',
    technicalMessage: 'Server memory or CPU pressure detected',
    httpStatus: 503,
    severity: 'medium',
    userAction: 'Simplify your request or wait a few minutes'
  },
  SYS003: {
    code: 'SYS003',
    category: ERROR_CATEGORIES.SYSTEM,
    title: 'Configuration Error',
    userMessage: 'System configuration issue detected. Please contact support.',
    technicalMessage: 'Missing or invalid system configuration',
    httpStatus: 500,
    severity: 'critical',
    userAction: 'Contact support immediately'
  },

  
  TEMPLATE001: {
    code: 'TEMPLATE001',
    category: ERROR_CATEGORIES.TEMPLATE,
    title: 'Template Processing Failed',
    userMessage: 'Document template could not be processed. Please try a different document type.',
    technicalMessage: 'Template parsing or validation failed',
    httpStatus: 500,
    severity: 'medium',
    userAction: 'Try specifying a different document type'
  },
  TEMPLATE002: {
    code: 'TEMPLATE002',
    category: ERROR_CATEGORIES.TEMPLATE,
    title: 'Template Schema Invalid',
    userMessage: 'Document template has configuration issues. Please contact support.',
    technicalMessage: 'Template schema validation failed',
    httpStatus: 500,
    severity: 'medium',
    userAction: 'Contact support with document type details'
  },

  
  INTENT001: {
    code: 'INTENT001',
    category: ERROR_CATEGORIES.INTENT,
    title: 'Intent Classification Failed',
    userMessage: 'I could not understand what type of request this is. Please be more specific.',
    technicalMessage: 'AI intent classification failed',
    httpStatus: 400,
    severity: 'medium',
    userAction: 'Clarify whether you want a document, legal information, or general help'
  },
  INTENT002: {
    code: 'INTENT002',
    category: ERROR_CATEGORIES.INTENT,
    title: 'Low Confidence Classification',
    userMessage: 'I\'m not sure what you\'re asking for. Could you please rephrase your request?',
    technicalMessage: 'Intent classification confidence below threshold',
    httpStatus: 400,
    severity: 'low',
    userAction: 'Rephrase your request more clearly'
  },

  
  EXTRACT001: {
    code: 'EXTRACT001',
    category: ERROR_CATEGORIES.EXTRACTION,
    title: 'Information Extraction Failed',
    userMessage: 'I could not extract the required information from your message. Please provide details in a clearer format.',
    technicalMessage: 'Field extraction from natural language failed',
    httpStatus: 422,
    severity: 'medium',
    userAction: 'Provide information in format: "I am [Name], [details], on [date], in [location]"'
  },
  EXTRACT002: {
    code: 'EXTRACT002',
    category: ERROR_CATEGORIES.EXTRACTION,
    title: 'Required Fields Missing',
    userMessage: 'Some required information is missing. Please include: [missing fields].',
    technicalMessage: 'Required document fields could not be extracted',
    httpStatus: 422,
    severity: 'medium',
    userAction: 'Provide the missing information'
  },
  EXTRACT003: {
    code: 'EXTRACT003',
    category: ERROR_CATEGORIES.EXTRACTION,
    title: 'Ambiguous Information',
    userMessage: 'Some information in your request is unclear. Please clarify: [ambiguous fields].',
    technicalMessage: 'Extracted information has ambiguous values',
    httpStatus: 422,
    severity: 'low',
    userAction: 'Clarify the ambiguous information'
  }
};

export function getErrorDetails(errorCode) {
  return ERROR_CODES[errorCode] || {
    code: 'UNKNOWN',
    category: 'UNKNOWN',
    title: 'Unknown Error',
    userMessage: 'An unknown error occurred. Please try again or contact support.',
    technicalMessage: `Unknown error code: ${errorCode}`,
    httpStatus: 500,
    severity: 'medium',
    userAction: 'Contact support with error details'
  };
}

export function generateErrorResponse(errorCode, context = {}) {
  const error = getErrorDetails(errorCode);
  
  return {
    success: false,
    error: {
      code: error.code,
      title: error.title,
      message: error.userMessage,
      category: error.category,
      severity: error.severity,
      httpStatus: error.httpStatus,
      userAction: error.userAction,
      timestamp: new Date().toISOString(),
      context: context
    },
    technicalMessage: error.technicalMessage
  };
}

export function logError(errorCode, error, context = {}) {
  const errorDetails = getErrorDetails(errorCode);
  
  const logContext = {
    errorCode: error.code || errorCode,
    severity: errorDetails.severity,
    category: errorDetails.category,
    technicalMessage: errorDetails.technicalMessage,
    originalError: error.message || error,
    timestamp: new Date().toISOString(),
    ...context
  };

  switch (errorDetails.severity) {
    case 'critical':
      console.error('🚨 CRITICAL ERROR:', logContext);
      break;
    case 'high':
      console.error('❌ HIGH SEVERITY ERROR:', logContext);
      break;
    case 'medium':
      console.warn('⚠️ MEDIUM SEVERITY ERROR:', logContext);
      break;
    case 'low':
      console.log('ℹ️ LOW SEVERITY ERROR:', logContext);
      break;
    default:
      console.log('❓ UNKNOWN SEVERITY ERROR:', logContext);
  }
}

export function isCritical(errorCode) {
  const error = getErrorDetails(errorCode);
  return error.severity === 'critical';
}

export function getErrorsByCategory(category) {
  return Object.values(ERROR_CODES).filter(error => error.category === category);
}

export function getErrorsBySeverity(severity) {
  return Object.values(ERROR_CODES).filter(error => error.severity === severity);
}

export default ERROR_CODES;




