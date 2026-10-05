
export const devConfig = {
  
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/dastavez',
  
  
  JWT_SECRET: process.env.JWT_SECRET || 'dastavez-super-secret-jwt-key-2024',
  
  
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: process.env.REDIS_PORT || 6379,
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || undefined,
  
  
  EMAIL_USER: process.env.EMAIL_USER || 'your-email@gmail.com',
  EMAIL_PASS: process.env.EMAIL_PASS || 'your-app-password',
  EMAIL_HOST: process.env.EMAIL_HOST || 'smtp.gmail.com',
  EMAIL_PORT: process.env.EMAIL_PORT || 587,
  
  
  GOOGLE_AI_API_KEY: process.env.GOOGLE_AI_API_KEY || 'your-google-ai-api-key',
  
  
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  
  
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3000',
};

export default devConfig;
