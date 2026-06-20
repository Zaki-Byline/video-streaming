import './loadEnv.js';

export default {
  port: process.env.PORT || 5000,
  nodeEnv: process.env.NODE_ENV || 'development',
  
  database: {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'video_delivery',
    port: process.env.DB_PORT || 3306
  },
  
  jwt: {
    secret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    sessionExpiresIn: process.env.JWT_SESSION_EXPIRES_IN || '8h'
  },

  auth: {
    cookieName: process.env.AUTH_COOKIE_NAME || 'auth_token',
    // Set COOKIE_CROSS_ORIGIN=true when frontend and API are on different domains
    crossOrigin: process.env.COOKIE_CROSS_ORIGIN === 'true'
  },
  
  upload: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 1073741824, // 1GB
    uploadPath: process.env.UPLOAD_PATH || '../video-storage'
  },
  
  cdn: {
    useCdn: process.env.USE_CDN === 'true',
    cdnBaseUrl: process.env.CDN_BASE_URL || 'https://cdn.myorg.org/',
    localBaseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:5000/video-storage/'
  },
  
  urls: {
    frontend: process.env.FRONTEND_URL || 'http://localhost:5173',
    // Comma-separated list of allowed frontend origins for CORS (e.g. multiple domains)
    frontendOrigins: (process.env.FRONTEND_URLS || process.env.FRONTEND_URL || 'http://localhost:5173')
      .split(',')
      .map((url) => url.trim())
      .filter(Boolean),
    base: process.env.BASE_URL || 'http://localhost:5000'
  },

  openai: {
    get apiKey() {
      return process.env.OPENAI_API_KEY?.trim() || '';
    },
    get model() {
      return process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
    }
  }
};
