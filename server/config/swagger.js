import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Law AI - Legal Assistant API',
      version: '1.0.0',
      description: 'API for legal document generation, AI chat, and document analysis'
    },
    servers: [
      { url: 'http://localhost:5000', description: 'Development' },
      { url: process.env.PRODUCTION_URL || 'https://api.dastavezai.com', description: 'Production' }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            details: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  },
  apis: [
    './routes/auth.js',
    './routes/chat.js',
    './routes/profile.js',
    './routes/subscription.js',
    './routes/adminRoutes.js',
    './routes/fileRoutes.js'
  ]
};

export const swaggerSpec = swaggerJsdoc(options);
