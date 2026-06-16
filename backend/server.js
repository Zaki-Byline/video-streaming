import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import './config/loadEnv.js';
import { isOpenAiConfigured } from './config/loadEnv.js';
import config from './config/config.js';
import pool from './config/database.js';
import authRoutes from './routes/authRoutes.js';
import videoRoutes from './routes/videoRoutes.js';
import redirectRoutes from './routes/redirectRoutes.js';
import streamingRoutes from './routes/streamingRoutes.js';
import captionRoutes from './routes/captionRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import cloudflareRoutes from './routes/cloudflareRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Trust proxy - important for detecting HTTPS behind reverse proxy (A2Hosting, nginx, etc.)
// This allows Express to read X-Forwarded-* headers
app.set('trust proxy', true);

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow requests from frontend URL or any localhost/127.0.0.1
    const allowedOrigins = [
      config.urls.frontend,
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      'https://kodeit-videos.legatolxp.online',
      'https://qr.kodeit.online',
    ];
    
    if (allowedOrigins.includes(origin) || origin.includes('localhost') || origin.includes('127.0.0.1')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins for development
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Range', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges', 'Content-Type']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use('/video-storage', express.static(path.join(__dirname, '../video-storage')));
app.use('/qr-codes', express.static(path.join(__dirname, '../qr-codes')));
app.use('/thumbnails', express.static(path.join(__dirname, '../video-storage/thumbnails')));
// Serve uploaded videos from backend/upload folder
app.use('/upload', express.static(path.join(__dirname, 'upload')));
// Serve subtitles folder (for generated subtitles)
app.use('/subtitles', express.static(path.join(__dirname, '../subtitles'), {
  setHeaders: (res, path) => {
    if (path.endsWith('.vtt')) {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  }
}));
// Serve captions with proper CORS headers
app.use('/video-storage/captions', express.static(path.join(__dirname, '../video-storage/captions'), {
  setHeaders: (res, path) => {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
}));

// Log all API requests
app.use('/api', (req, res, next) => {
  console.log('[API] Request:', {
    method: req.method,
    path: req.path,
    url: req.url,
    originalUrl: req.originalUrl
  });
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/captions', captionRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cloudflare', cloudflareRoutes);

// Streaming route /api/s/:slug
app.use('/api', streamingRoutes);

// Redirect routes (must be after API routes but before catch-all)
app.use('/', redirectRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    openai: isOpenAiConfigured() ? 'configured' : 'missing_api_key'
  });
});

// Root route handler
app.get('/', (req, res) => {
  res.json({
    message: 'Video Streaming API Server',
    version: '1.0.0',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      videos: '/api/videos',
      captions: '/api/captions',
      admin: '/api/admin',
      users: '/api/users',
      streaming: '/api/s/:slug'
    },
    documentation: 'This is a backend API server. Use the frontend application or API endpoints.'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Test database connection
async function testDatabaseConnection() {
  try {
    console.log('\n🔍 Testing database connection...');
    console.log(`   Host: ${config.database.host}`);
    console.log(`   Database: ${config.database.database}`);
    console.log(`   User: ${config.database.user}`);
    
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    // Test query to verify database exists and is accessible
    const [rows] = await pool.execute('SELECT DATABASE() as current_db, VERSION() as version');
    const dbInfo = rows[0];
    
    console.log('✅ Database connection successful!');
    console.log(`   Connected to: ${dbInfo.current_db}`);
    console.log(`   MySQL Version: ${dbInfo.version}`);
    
    // Check if tables exist
    const [tables] = await pool.execute(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = ?
    `, [config.database.database]);
    
    const tableCount = tables[0].count;
    console.log(`   Tables found: ${tableCount}`);
    
    if (tableCount === 0) {
      console.log('⚠️  Warning: No tables found. Run database/schema.sql to create tables.');
    } else {
      console.log('✅ Database schema is ready!');
    }

    if (!isOpenAiConfigured()) {
      console.log('⚠️  OPENAI_API_KEY is not set — AI video descriptions will not work.');
      console.log('   Local: set OPENAI_API_KEY in backend/.env');
      console.log('   cPanel: Setup Node.js App → Environment Variables → OPENAI_API_KEY');
    } else {
      console.log(`✅ OpenAI configured (model: ${config.openai.model})`);
    }
    
    return true;
  } catch (error) {
    console.error('\n❌ Database connection failed!');
    console.error(`   Error: ${error.message}`);
    console.error(`   Code: ${error.code || 'N/A'}`);
    
    if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('\n💡 Solution: Create the database first:');
      console.error(`   mysql -u ${config.database.user} -p < database/schema.sql`);
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Solution: Make sure MySQL server is running');
    } else if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n💡 Solution: Check your database credentials in .env file');
    }
    
    return false;
  }
}

// Start server
const PORT = config.port;

// Test database connection before starting server
testDatabaseConnection().then((connected) => {
  if (connected) {
    const server = app.listen(PORT, () => {
      console.log('\n' + '='.repeat(50));
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📁 Video storage: ${config.upload.uploadPath}`);
      console.log(`🌐 Frontend URL: ${config.urls.frontend}`);
      console.log(`📦 CDN Mode: ${config.cdn.useCdn ? 'Enabled' : 'Disabled'}`);
      console.log('='.repeat(50) + '\n');
    });

    // Handle port already in use error
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ Port ${PORT} is already in use!`);
        console.error(`\n💡 Solution: Kill the process using port ${PORT}`);
        console.error(`   Run: npm run kill-port`);
        console.error(`   Or manually: netstat -ano | findstr :${PORT}`);
        console.error(`   Then: taskkill /PID <PID> /F\n`);
        process.exit(1);
      } else {
        throw error;
      }
    });
  } else {
    console.error('\n⚠️  Server not started due to database connection failure.');
    console.error('   Please fix the database connection and restart the server.\n');
    process.exit(1);
  }
}).catch((error) => {
  console.error('\n❌ Fatal error during startup:', error);
  process.exit(1);
});

