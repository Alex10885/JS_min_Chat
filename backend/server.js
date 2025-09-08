require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const winston = require('winston');
const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
// Import crypto for generating secure tokens
const crypto = require('crypto');
const session = require('express-session');
const RedisStore = require('connect-redis');
const { redisManager } = require('./src/config/redis');
const { connectDB, closeDB } = require('./db/connection');
const emailService = require('./services/emailService');
const {
  performanceMonitor,
  apiPerformanceMiddleware,
  getHealthCheck,
  getPerformanceDashboard
} = require('./src/middleware/performanceMonitor');
const {
  externalServiceBreaker,
  circuitBreakerMiddleware,
  asyncOptimize,
  protectEmail,
  getCircuitBreakerStatuses
} = require('./src/middleware/circuitBreaker');

// Import AuthService for extracted authentication logic
const authService = require('./src/services/authService');

// Import models
const User = require('./models/User');
const Message = require('./models/Message');
const Channel = require('./models/Channel');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'chat-server' },
  transports: [
    new winston.transports.File({ filename: 'logs/server.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

const app = express();
const server = http.createServer(app);

// Rate limiters are now handled by AuthService
const io = socketIo(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production'
      ? process.env.ALLOWED_ORIGINS?.split(',') || false
      : ["http://localhost:3003", "http://localhost:3000"],
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"],
    credentials: true
  },
  // Ensure both transports are supported
  transports: ['websocket', 'polling'],
  // Connection settings for better reliability
  connectTimeout: 20000, // 20 seconds
  pingTimeout: 5000, // 5 seconds for ping
  pingInterval: 10000, // 10 seconds between pings
  upgradeTimeout: 10000,
  allowUpgrades: true,
  cookieHttpOnly: true,
  cookieSameSite: 'lax'
});

// Log socket connection errors for debugging
io.engine.on('connection_error', (err) => {
  console.log('🔌 Socket engine connection error:', err.code, err.message);
  logger.error('Socket connection error:', {
    code: err.code,
    message: err.message,
    httpStatus: err.status,
    headers: err.req?.headers
  });
});

// CORS configuration
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') || false
    : true,
  credentials: true
}));

app.use(express.json({ limit: '20mb', strict: false })); // Increased limit and disabled strict parsing for better error tolerance
app.use(express.urlencoded({ extended: true, limit: '20mb' })); // Handle form data with increased limit

// Session configuration with Redis store for enhanced performance
let sessionMiddleware;
try {
  const redisClient = redisManager.getClient();
  if (redisClient && redisManager.isClientReady()) {
    sessionMiddleware = session({
      secret: process.env.SESSION_SECRET || 'your-very-long-secure-secret-key-change-in-production',
      resave: false,
      saveUninitialized: false,
      store: new RedisStore({
        client: redisClient,
        prefix: 'sess:',
        ttl: 86400, // 24 hours
        disableTouch: false // Allow automatic touch
      }),
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      },
      name: 'chatSession',
      rolling: false,
      unset: 'destroy'
    });
    console.log('✅ Redis session store initialized successfully');
  } else {
    // Fallback to memory store if Redis is not available
    console.log('⚠️ Redis not available, using memory-based session store');
    sessionMiddleware = session({
      secret: process.env.SESSION_SECRET || 'your-very-long-secure-secret-key-change-in-production',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000,
        sameSite: 'lax'
      },
      name: 'chatSession',
      rolling: false,
      unset: 'destroy'
    });
  }
} catch (error) {
  console.log('❌ Redis session store initialization failed, using memory store:', error.message);
  sessionMiddleware = session({
    secret: process.env.SESSION_SECRET || 'your-very-long-secure-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    },
    name: 'chatSession',
    rolling: false,
    unset: 'destroy'
  });
}

app.use(sessionMiddleware);

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
      value: e.value
    }));

    return res.status(422).json({
      error: 'Validation failed',
      details: errors,
      code: 'VALIDATION_ERROR'
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    return res.status(409).json({
      error: `${field} '${value}' already exists`,
      code: 'DUPLICATE_ERROR'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token has expired',
      code: 'TOKEN_EXPIRED'
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId: req.id || 'unknown'
  });
};

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      user: req.user?.nickname || 'anonymous',
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });
  });

  next();
});

// Session authentication middleware now uses AuthService

// JWT authentication middleware now uses AuthService

// Role-based access control middleware now uses AuthService

// Error handling middleware

// Use AuthService session authentication middleware
app.use(authService.authenticateSession.bind(authService));

// General rate limiting (applied to all HTTP requests) - using AuthService
app.use(authService.generalRateLimiter);

// Performance monitoring middleware
app.use(apiPerformanceMiddleware());

// Helmet security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// Swagger configuration
const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Chat-JS API',
      version: '1.0.0',
      description: 'REST API for Chat-JS application with real-time messaging and voice channels',
      contact: {
        name: 'Chat-JS Support'
      }
    },
    servers: [
      {
        url: 'http://localhost:3001',
        description: 'Development server'
      }
    ],
    components: {
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'User unique identifier'
            },
            nickname: {
              type: 'string',
              description: 'User nickname',
              minLength: 3,
              maxLength: 50
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address'
            },
            role: {
              type: 'string',
              enum: ['admin', 'member'],
              default: 'member',
              description: 'User role'
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'User creation timestamp'
            },
            lastActive: {
              type: 'string',
              format: 'date-time',
              description: 'Last activity timestamp'
            },
            status: {
              type: 'string',
              enum: ['online', 'offline'],
              description: 'User online status'
            }
          },
          required: ['nickname', 'email', 'password', 'role']
        },
        Channel: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'Channel unique identifier (auto-generated from name)'
            },
            name: {
              type: 'string',
              description: 'Channel display name',
              minLength: 1,
              maxLength: 100
            },
            type: {
              type: 'string',
              enum: ['text', 'voice'],
              description: 'Channel type'
            },
            description: {
              type: 'string',
              description: 'Channel description',
              maxLength: 500
            },
            createdBy: {
              type: 'string',
              description: 'Creator nickname'
            },
            position: {
              type: 'number',
              default: 0,
              description: 'Channel display position'
            }
          },
          required: ['id', 'name', 'type', 'createdBy']
        },
        RegisterRequest: {
          type: 'object',
          required: ['nickname', 'email', 'password'],
          properties: {
            nickname: {
              type: 'string',
              minLength: 3,
              maxLength: 50,
              description: 'Unique username'
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'Valid email address'
            },
            password: {
              type: 'string',
              minLength: 6,
              description: 'User password'
            }
          }
        },
        LoginRequest: {
          type: 'object',
          required: ['identifier', 'password'],
          properties: {
            identifier: {
              type: 'string',
              description: 'Username or email'
            },
            password: {
              type: 'string',
              description: 'User password'
            }
          }
        },
        AuthResponse: {
          type: 'object',
          properties: {
            token: {
              type: 'string',
              description: 'JWT access token'
            },
            user: {
              $ref: '#/components/schemas/User'
            }
          }
        },
        ChannelRequest: {
          type: 'object',
          required: ['name', 'type'],
          properties: {
            name: {
              type: 'string',
              minLength: 1,
              maxLength: 100,
              description: 'Channel display name'
            },
            type: {
              type: 'string',
              enum: ['text', 'voice'],
              description: 'Channel type'
            },
            description: {
              type: 'string',
              maxLength: 500,
              description: 'Optional channel description'
            }
          }
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            error: {
              type: 'string',
              description: 'Error message'
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  msg: { type: 'string' },
                  param: { type: 'string' },
                  location: { type: 'string' }
                }
              },
              description: 'Validation errors array'
            }
          }
        }
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      }
    },
    security: [
      {
        bearerAuth: []
      }
    ]
  },
  apis: ['./server.js'] // Path to the API routes
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

// Swagger UI with CSP disabled for this route
app.use('/api-docs', (req, res, next) => {
  // Disable CSP for Swagger UI
  res.removeHeader('Content-Security-Policy');
  next();
}, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Administrative endpoints - require moderator privileges
console.log('🔧 Administrative API endpoints registered at startup');

// GET /api/admin/users - List all users with moderation info
app.get('/api/admin/users', authService.authenticateToken.bind(authService), authService.requireModerator.bind(authService), authService.apiRateLimiter, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const skip = (page - 1) * limit;

    const users = await User.find({})
      .select('-password -resetPasswordToken -resetPasswordExpires -moderationToken -moderationTokenExpires')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments();

    logger.info(`Admin user list requested by ${req.user.nickname}`, {
      adminId: req.user._id,
      page,
      limit,
      total
    });

    res.json({
      users,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching users for admin:', error);
    res.status(500).json({ error: 'Failed to fetch users', code: 'DATABASE_ERROR' });
  }
});

// POST /api/admin/users/:userId/ban - Ban a user
app.post('/api/admin/users/:userId/ban', authService.authenticateToken.bind(authService), authService.requireModerator.bind(authService), authService.apiRateLimiter, [
  body('reason').isLength({ min: 1, max: 500 }).trim(),
  body('duration').optional().isInt({ min: 1, max: 31536000 }) // Max 1 year in seconds
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const { reason, duration } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent banning yourself
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot ban yourself' });
    }

    // Prevent non-admin from banning admin
    if (user.role === 'admin' && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot ban administrator' });
    }

    await user.ban(reason, duration, req.user._id);

    logger.info(`User ${user.nickname} banned by ${req.user.nickname}`, {
      bannedUserId: userId,
      bannedById: req.user._id,
      reason,
      duration
    });

    res.json({
      message: `User ${user.nickname} has been banned`,
      user: {
        id: user._id,
        nickname: user.nickname,
        banned: true,
        banReason: reason,
        banExpires: user.banExpires
      }
    });
  } catch (error) {
    logger.error('Error banning user:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

// POST /api/admin/users/:userId/unban - Unban a user
app.post('/api/admin/users/:userId/unban', authService.authenticateToken.bind(authService), authService.requireModerator.bind(authService), apiRateLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.banned) {
      return res.status(400).json({ error: 'User is not banned' });
    }

    await user.unban();

    logger.info(`User ${user.nickname} unbanned by ${req.user.nickname}`, {
      unbannedUserId: userId,
      unbannedById: req.user._id
    });

    res.json({
      message: `User ${user.nickname} has been unbanned`,
      user: {
        id: user._id,
        nickname: user.nickname,
        banned: false
      }
    });
  } catch (error) {
    logger.error('Error unbanning user:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

// POST /api/admin/users/:userId/warn - Issue warning to user
app.post('/api/admin/users/:userId/warn', authService.authenticateToken.bind(authService), authService.requireModerator.bind(authService), apiRateLimiter, [
  body('reason').isLength({ min: 1, max: 500 }).trim(),
  body('duration').optional().isInt({ min: 1, max: 31536000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const { reason, duration } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.warn(reason, req.user._id, duration);
    await user.save();

    logger.info(`Warning issued to user ${user.nickname} by ${req.user.nickname}`, {
      warnedUserId: userId,
      warnedById: req.user._id,
      reason,
      duration
    });

    res.json({
      message: `Warning issued to user ${user.nickname}`,
      warning: {
        reason,
        issuedBy: req.user.nickname,
        issuedAt: new Date(),
        expires: duration ? new Date(Date.now() + duration) : null
      },
      user: {
        id: user._id,
        nickname: user.nickname,
        warningsCount: user.getActiveWarningsCount()
      }
    });
  } catch (error) {
    logger.error('Error warning user:', error);
    res.status(500).json({ error: 'Failed to warn user' });
  }
});

// POST /api/admin/users/:userId/role - Change user role
app.post('/api/admin/users/:userId/role', authService.authenticateToken.bind(authService), authService.requireAdmin.bind(authService), apiRateLimiter, [
  body('role').isIn(['member', 'moderator', 'admin'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const { role: newRole } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent modifying your own role in potentially problematic ways
    if (user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Cannot modify your own role' });
    }

    // Prevent non-admin from promoting to admin or demoting admin
    if ((newRole === 'admin' || user.role === 'admin') && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Only administrators can manage admin roles' });
    }

    const oldRole = user.role;
    user.role = newRole;
    await user.save();

    logger.info(`User ${user.nickname} role changed from ${oldRole} to ${newRole} by ${req.user.nickname}`, {
      changedUserId: userId,
      changedById: req.user._id,
      oldRole,
      newRole
    });

    res.json({
      message: `User ${user.nickname} role changed to ${newRole}`,
      user: {
        id: user._id,
        nickname: user.nickname,
        role: newRole
      }
    });
  } catch (error) {
    logger.error('Error changing user role:', error);
    res.status(500).json({ error: 'Failed to change user role' });
  }
});

// POST /api/admin/users/:userId/mute - Mute user
app.post('/api/admin/users/:userId/mute', authService.authenticateToken.bind(authService), authService.requireModerator.bind(authService), apiRateLimiter, [
  body('duration').isInt({ min: 60, max: 86400 }) // 1 minute to 24 hours
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { userId } = req.params;
    const { duration } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await user.mute(duration);

    logger.info(`User ${user.nickname} muted by ${req.user.nickname}`, {
      mutedUserId: userId,
      mutedById: req.user._id,
      duration
    });

    res.json({
      message: `User ${user.nickname} has been muted`,
      user: {
        id: user._id,
        nickname: user.nickname,
        muteExpires: user.muteExpires
      }
    });
  } catch (error) {
    logger.error('Error muting user:', error);
    res.status(500).json({ error: 'Failed to mute user' });
  }
});

// POST /api/admin/users/:userId/unmute - Unmute user
app.post('/api/admin/users/:userId/unmute', authService.authenticateToken.bind(authService), authService.requireModerator.bind(authService), apiRateLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!user.isMuted()) {
      return res.status(400).json({ error: 'User is not muted' });
    }

    await user.unmute();

    logger.info(`User ${user.nickname} unmuted by ${req.user.nickname}`, {
      unmutedUserId: userId,
      unmutedById: req.user._id
    });

    res.json({
      message: `User ${user.nickname} has been unmuted`,
      user: {
        id: user._id,
        nickname: user.nickname,
        muteExpires: null
      }
    });
  } catch (error) {
    logger.error('Error unmuting user:', error);
    res.status(500).json({ error: 'Failed to unmute user' });
  }
});

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get list of all registered users
 *     description: Retrieves a list of all users with their roles and online status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: User's unique identifier
 *                   nickname:
 *                     type: string
 *                     description: User's display name
 *                   role:
 *                     type: string
 *                     enum: [admin, moderator, member]
 *                     description: User's role level
 *                   status:
 *                     type: string
 *                     enum: [online, offline]
 *                     description: User's online status
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     description: User registration date
 *                   lastActive:
 *                     type: string
 *                     format: date-time
 *                     description: Last activity timestamp
 *             example:
 *               - id: "507f1f77bcf86cd799439011"
 *                 nickname: "john_doe"
 *                 role: "member"
 *                 status: "online"
 *                 createdAt: "2024-09-07T10:30:00Z"
 *                 lastActive: "2024-09-07T22:15:00Z"
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 */
console.log('🔧 GET /api/users route registered at startup');
app.get('/api/users', authService.authenticateToken.bind(authService), apiRateLimiter, async (req, res) => {
  try {
    const users = await User.find({})
      .select('_id nickname role status createdAt lastActive')
      .sort({ nickname: 1 });

    logger.info(`Users list requested by ${req.user.nickname}`, {
      userId: req.user._id,
      totalUsers: users.length
    });

    console.log('📤 Returning users data:', users.length);
    res.json(users);
  } catch (error) {
    logger.error('Error fetching users:', error);
    console.error('❌ Error in GET /api/users:', error.message);
    res.status(500).json({ error: 'Failed to fetch users', code: 'DATABASE_ERROR' });
  }
});

// Swagger JSON endpoint
app.get('/api-docs.json', (req, res) => {
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Development and test endpoint to reset rate limiting
app.post('/api/reset-ratelimit', (req, res) => {
  // In a real application, you'd want to get the store from the limiter instance
  // For express-rate-limit v7+, you can access the store like this:
  try {
    const authLimiterStore = authRateLimiter.store;
    if (authLimiterStore && typeof authLimiterStore.resetAll === 'function') {
      authLimiterStore.resetAll();
      console.log('🔄 Rate limiting reset for testing purposes');
      res.json({ success: true, message: 'Rate limiting has been reset' });
    } else {
      // If store doesn't expose resetAll, create a temporary workaround
      console.log('⚠️ Rate limiter store doesn\'t support resetAll - rate limiting will expire naturally');
      res.json({ success: false, message: 'Cannot reset rate limiting automatically, wait for timeout' });
    }
  } catch (error) {
    console.log('❌ Error resetting rate limiting:', error.message);
    res.status(500).json({ success: false, error: 'Failed to reset rate limiting' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Performance monitoring endpoints
app.get('/api/health/detailed', getHealthCheck);

app.get('/api/performance/dashboard', (req, res) => {
  // Check if user is admin/moderator
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  getPerformanceDashboard(req, res);
});

// Performance alerts endpoint
app.get('/api/performance/alerts', (req, res) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Run alerts check
  performanceMonitor.checkAlerts();

  res.json({
    timestamp: new Date().toISOString(),
    alerts_checked: true,
    message: 'Performance alerts checked - see server logs for any alerts'
  });
});

// Circuit breaker status endpoint
app.get('/api/circuit-breaker/status', (req, res) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const status = getCircuitBreakerStatuses();
  res.json({
    timestamp: new Date().toISOString(),
    services: status
  });
});

// Resource usage optimization endpoint
app.get('/api/optimization/status', async (req, res) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'moderator')) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    const optimization = {
      timestamp: new Date().toISOString(),
      async_processes: process._getActiveHandles().length,
      memory_usage: process.memoryUsage(),
      connection_metrics: getCachedStats ? await getCachedStats() : {},
      performance_metrics: performanceMonitor.getDetailedStats ? performanceMonitor.getDetailedStats() : {},
      circuit_breakers: getCircuitBreakerStatuses()
    };

    res.json(optimization);
  } catch (error) {
    logger.error('Error getting optimization status:', error);
    res.status(500).json({ error: 'Failed to get optimization status', message: error.message });
  }
});

// Log middleware to check incoming requests
app.use((req, res, next) => {
  logger.info(`🔍 Incoming request: ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    headers: req.headers
  });
  next();
});












/**
   * @swagger
   * /api/login:
   *   post:
   *     tags:
   *       - Authentication
   *     summary: Login existing user
   *     description: Authenticates and logs in an existing user with JWT token
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/LoginRequest'
   *     responses:
   *       200:
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/AuthResponse'
   *             example:
   *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
   *               user:
   *                 id: "507f1f77bcf86cd799439011"
   *                 nickname: "john_doe"
   *                 email: "john@example.com"
   *                 role: "member"
   *       400:
   *         description: Invalid credentials or validation errors
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *             example:
   *               error: "Invalid credentials"
   *       500:
   *         description: Server error
   */
console.log('🔧 POST /api/login route registered at startup');
app.post('/api/login', [
  body('identifier').isLength({ min: 1, max: 50 }).trim(),
  body('password').isLength({ min: 6, max: 100 })
], async (req, res) => {
  // Use AuthService for login handling
  await authService.handleLoginWithSession(req.body.identifier, req.body.password, req, res);
});

/**
   * @swagger
   * /api/register:
  *   post:
  *     tags:
  *       - Authentication
  *     summary: Register new user
  *     description: Creates a new user account and returns JWT token
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             $ref: '#/components/schemas/RegisterRequest'
  *           example:
  *             nickname: "john_doe"
  *             email: "john@example.com"
  *             password: "securePass123"
  *     responses:
  *       201:
  *         description: Registration successful
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/AuthResponse'
  *             example:
  *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  *               user:
  *                 id: "507f1f77bcf86cd799439011"
  *                 nickname: "john_doe"
  *                 email: "john@example.com"
  *                 role: "member"
  *       400:
  *         description: Validation errors or user already exists
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ErrorResponse'
  *             example:
  *               error: "Nickname already taken"
  *       500:
  *         description: Server error
  */
app.post('/api/register', authService.authRateLimiter, [
  body('nickname').isLength({ min: 3, max: 50 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  // Use AuthService for registration handling
  await authService.handleRegistrationWithSession(req.body, req, res);
});

/**
 * @swagger
 * /api/channels:
 *   get:
 *     tags:
 *       - Channels
 *     summary: Get list of channels
 *     description: Retrieves a list of all available channels
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of channels
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Channel'
 *             example:
 *               - id: "general"
 *                 name: "General"
 *                 type: "text"
 *                 description: ""
 *                 createdBy: "system"
 *                 position: 0
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Access token required"
 *       500:
 *         description: Internal server error
 */
console.log('🔧 GET /api/channels route registered at startup');
app.get('/api/channels', authService.authenticateToken.bind(authService), apiRateLimiter, async (req, res) => {
  console.log('🚀 GET /api/channels endpoint called', { method: req.method, url: req.url, headers: req.headers.authorization ? 'auth header present' : 'no auth header' });
  try {
    const channels = await Channel.find({})
      .select('-_id id name type description createdBy position')
      .sort({ position: 1 });

    logger.info(`Channels list requested by ${req.user.nickname}`, {
      userId: req.user._id,
      channelCount: channels.length
    });

    console.log('📤 Returning channels data:', channels.length);
    res.json(channels);
  } catch (error) {
    logger.error('Error fetching channels:', error);
    console.error('❌ Error in GET /api/channels:', error.message);
    res.status(500).json({ error: 'Failed to fetch channels', code: 'DATABASE_ERROR' });
  }
});

console.log('🔧 POST /api/channels route registered at startup');

/**
 * @swagger
 * /api/channels:
 *   post:
 *     tags:
 *       - Channels
 *     summary: Create a new channel
 *     description: Creates a new text or voice channel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChannelRequest'
 *           example:
 *             name: "NewChannel"
 *             type: "text"
 *             description: "Description of the new channel"
 *     responses:
 *       201:
 *         description: Channel created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Channel'
 *             example:
 *               id: "newchannel"
 *               name: "NewChannel"
 *               type: "text"
 *               description: "Description of the new channel"
 *               createdBy: "john_doe"
 *               position: 10
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Channel name already exists
 *       500:
 *         description: Server error
 */
app.post('/api/channels', authService.authenticateToken.bind(authService), apiRateLimiter, [
  body('name').isLength({ min: 1, max: 100 }).trim().escape(),
  body('type').isIn(['text', 'voice']).trim(),
  body('description').optional().isLength({ max: 500 }).trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, type, description } = req.body;
    const createdBy = req.user.nickname;

    // Create new channel (ID will be auto-generated in pre-save middleware)
    const channel = new Channel({
      name,
      type,
      description,
      createdBy
    });

    await channel.save();

    logger.info(`Channel '${name}' created by ${createdBy}`, {
      channelId: channel.id,
      type,
      userId: req.user._id
    });

    res.status(201).json({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      description: channel.description,
      createdBy: channel.createdBy,
      position: channel.position
    });

  } catch (error) {
    logger.error('Error creating channel:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        error: 'Invalid channel data',
        details: error.message
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Channel name already exists',
        code: 'DUPLICATE_CHANNEL'
      });
    }

    res.status(500).json({
      error: 'Failed to create channel',
      code: 'DATABASE_ERROR'
    });
  }
});

console.log('🔧 POST /api/logout route registered at startup');
app.post('/api/logout', authService.authenticateToken.bind(authService), apiRateLimiter, async (req, res) => {
  try {
    console.log('🚪 Logout request from user:', req.user.nickname, { userId: req.user._id });

    // Disconnect all Socket.IO connections for this user
    const sockets = onlineUsers;
    let disconnectedCount = 0;
    for (const [socketId, socketData] of sockets.entries()) {
      if (socketData.userId === req.user._id.toString()) {
        const socket = io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect();
          disconnectedCount++;
        }
      }
    }

    // Update user status to offline
    await User.findByIdAndUpdate(req.user._id, {
      status: 'offline',
      lastActive: new Date()
    });

    console.log(`✅ User ${req.user.nickname} logged out successfully, ${disconnectedCount} connections disconnected`);
    logger.info(`User logged out: ${req.user.nickname}`, {
      userId: req.user._id,
      disconnectedSockets: disconnectedCount
    });

    res.json({
      success: true,
      message: 'Logged out successfully',
      disconnectedCount
    });
  } catch (error) {
    logger.error('Logout error:', error);
    res.status(500).json({ error: 'Server error during logout' });
  }
});

/**
 * Session logout endpoint - destroys session
 * This complements JWT logout to handle session-based authentication
 */
app.post('/api/logout_session', apiRateLimiter, async (req, res) => {
  try {
    console.log('🚪 Session logout request, sessionId:', req.sessionId);

    // Check if there's an authenticated session or JWT user
    const hasJwtAuth = !!req.user; // From JWT middleware
    const hasSessionAuth = req.sessionUser || (req.session && req.session.authenticated);
    const sessionUserId = req.session && req.session.userId;

    console.log('🤔 Session logout check:', {
      hasJwtAuth,
      hasSessionAuth,
      sessionUserId,
      sessionId: req.sessionId
    });

    if (hasSessionAuth) {
      const sessionUser = sessionUserId ? await User.findById(sessionUserId) : null;
      const nickname = sessionUser ? sessionUser.nickname : 'unknown';

      console.log('✅ Session logout: Destroying session for user:', nickname);

      // Disconnect Socket.IO connections for this session user
      if (sessionUserId) {
        const sockets = onlineUsers;
        let disconnectedCount = 0;
        for (const [socketId, socketData] of sockets.entries()) {
          if (socketData.userId === sessionUserId) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.disconnect();
              disconnectedCount++;
            }
          }
        }

        console.log(`🗑️ Session logout: Disconnected ${disconnectedCount} socket connections`);
      }

      // Destroy the session
      await new Promise((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) {
            console.error('❌ Session destroy error:', err);
            reject(err);
          } else {
            console.log('✅ Session destroyed successfully');
            resolve();
          }
        });
      });

      logger.info(`Session logged out: ${nickname}`, {
        sessionId: req.sessionId,
        ip: req.ip
      });

      res.json({
        success: true,
        message: 'Session logged out successfully',
        type: 'session_logout',
        sessionDestroyed: true
      });
    } else {
      console.log('⚠️ Session logout: No authenticated session to destroy');
      res.json({
        success: true,
        message: 'No active session to log out',
        type: 'session_logout',
        sessionDestroyed: false
      });
    }

  } catch (error) {
    logger.error('Session logout error:', error);
    res.status(500).json({
      error: 'Server error during session logout',
      code: 'SESSION_LOGOUT_ERROR'
    });
  }
});

// Hybrid logout endpoint - handles both JWT and session logout
app.post('/api/logout_complete', apiRateLimiter, async (req, res) => {
  try {
    console.log('🚪 Complete logout request (JWT + Session), sessionId:', req.sessionId);

    const hasJwtAuth = !!req.user;
    const hasSessionAuth = req.sessionUser || (req.session && req.session.authenticated);
    const sessionUserId = req.session && req.session.userId;

    let jwtLogoutResult = null;
    let sessionLogoutResult = null;

    // Handle JWT logout if JWT is provided
    if (hasJwtAuth) {
      try {
        const sockets = onlineUsers;
        let disconnectedCount = 0;
        for (const [socketId, socketData] of sockets.entries()) {
          if (socketData.userId === req.user._id.toString()) {
            const socket = io.sockets.sockets.get(socketId);
            if (socket) {
              socket.disconnect();
              disconnectedCount++;
            }
          }
        }

        await User.findByIdAndUpdate(req.user._id, {
          status: 'offline',
          lastActive: new Date()
        });

        jwtLogoutResult = {
          success: true,
          disconnectedCount
        };
      } catch (jwtError) {
        jwtLogoutResult = {
          success: false,
          error: jwtError.message
        };
      }
    }

    // Handle session logout if session exists
    if (hasSessionAuth) {
      try {
        if (sessionUserId) {
          const sessionUser = await User.findById(sessionUserId);
          console.log('✅ Session logout: Destroying session for user:', sessionUser ? sessionUser.nickname : 'unknown');

          // Disconnect Socket.IO connections for this session user
          const sockets = onlineUsers;
          let disconnectedCount = 0;
          for (const [socketId, socketData] of sockets.entries()) {
            if (socketData.userId === sessionUserId) {
              const socket = io.sockets.sockets.get(socketId);
              if (socket) {
                socket.disconnect();
                disconnectedCount++;
              }
            }
          }
          console.log(`🗑️ Session logout: Disconnected ${disconnectedCount} socket connections`);
        }

        // Destroy the session
        await new Promise((resolve, reject) => {
          req.session.destroy((err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });

        sessionLogoutResult = {
          success: true,
          sessionDestroyed: true
        };
      } catch (sessionError) {
        sessionLogoutResult = {
          success: false,
          error: sessionError.message
        };
      }
    }

    const overallSuccess = (!jwtLogoutResult || jwtLogoutResult.success) &&
                          (!sessionLogoutResult || sessionLogoutResult.success);

    res.json({
      success: overallSuccess,
      message: 'Complete logout processed',
      type: 'complete_logout',
      jwt: jwtLogoutResult,
      session: sessionLogoutResult
    });

  } catch (error) {
    logger.error('Complete logout error:', error);
    res.status(500).json({
      error: 'Server error during complete logout',
      code: 'COMPLETE_LOGOUT_ERROR'
    });
  }
});

//  404 handler (must be before global error handler)
app.use((req, res) => {
  console.warn('❌ Final 404 handler executed - route not found!', { method: req.method, url: req.url });
  logger.warn(`404 - ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    error: 'Endpoint not found',
    path: req.url,
    method: req.method,
    code: 'NOT_FOUND'
  });
});

// Global error handling middleware (must be last)
app.use(errorHandler);









// Global users map for socket management {socketId: {userId, nickname, room}}
let onlineUsers = new Map();

// User connection counter {userId: connectionCount}
let userConnections = new Map();

// Voice channels management
const voiceChannels = new Map(); // channelId -> { socketId: { peerConnection, stream } }

// Improved Socket.IO session middleware with proper res object handling
io.use((socket, next) => {
  // Create a more complete mock res object if missing
  if (!socket.request.res) {
    socket.request.res = {
      setHeader: () => {},
      getHeader: () => {},
      writeHead: () => {},
      end: () => {},
      headersSent: false,
      statusCode: 200
    };
  }

  // Apply session middleware with error handling
  sessionMiddleware(socket.request, socket.request.res, (err) => {
    if (err) {
      console.error('Session middleware error for Socket.IO:', err);
      return next(err);
    }
    next();
  });
});

// Socket.IO authentication middleware
io.use(async (socket, next) => {
  const { csrfToken, sessionId } = socket.handshake.auth;
  let session = socket.request.session;

  // console.log('🔑 Socket authentication attempt with session and CSRF fingerprint check');
  // console.log('🔍 Raw socket auth data:', {
  //   csrfTokenProvided: !!csrfToken,
  //   sessionIdProvided: !!sessionId,
  //   sessionIdLength: sessionId?.length,
  //   sessionIdFromAuth: sessionId
  // });

  // If sessionId is provided in auth, try to recover the session from MongoDB store
  if (sessionId && (!session || !session.authenticated)) {
    // console.log('🔄 Attempting session recovery from MongoDB store using sessionId:', sessionId);

    try {
      // Load session from MongoDB store using the sessionId from JWT auth
      const MongoStoreInstance = sessionMiddleware.store;
      if (MongoStoreInstance && typeof MongoStoreInstance.get === 'function') {
        const sessionData = await new Promise((resolve, reject) => {
          MongoStoreInstance.get(sessionId, (err, data) => {
            if (err) reject(err);
            else resolve(data);
          });
        });

        // console.log('🔄 MongoDB session lookup result:', {
        //   sessionFound: !!sessionData,
        //   sessionAuthenticated: sessionData?.authenticated,
        //   sessionUserId: sessionData?.userId,
        //   sessionCsrfToken: !!sessionData?.csrfToken,
        //   csrfTokenMatches: csrfToken && sessionData?.csrfToken && csrfToken === sessionData.csrfToken
        // });

        if (sessionData && sessionData.authenticated) {
          // Replace socket.request.session with loaded session
          socket.request.session = sessionData;
          session = sessionData;
          console.log('✅ Socket session recovered from MongoDB');
        } else {
          console.log('⚠️ Socket session not found in MongoDB store');
        }
      }
    } catch (error) {
      console.error('❌ Error loading SOCKET session from MongoDB:', error.message);
    }
  }

  console.log('🔓 Fingerprint verification:', {
    sid: socket.request.sessionId,
    providedCsrfToken: csrfToken?.substring(0, 8) + '...',
    sessionCsrfToken: session?.csrfToken?.substring(0, 8) + '...',
    userAgent: socket.request.session?.userAgent?.substring(0, 20) + '...',
    loginTime: session?.loginTime,
    registrationTime: session?.registrationTime
  });

  // Validate session exists and has authentication
  if (!session || !session.authenticated || !session.userId) {
    console.log('❌ Socket authentication failed: No authenticated session found');
    console.log('📋 Session details:', {
      sessionId: socket.request.sessionId,
      session: !!session,
      authenticated: session?.authenticated,
      userId: session?.userId
    });
    return next(new Error('Session authentication required'));
  }

  // Validate CSRF token for additional security (must match session's unique CSRF token)
  if (!csrfToken || !session.csrfToken || csrfToken !== session.csrfToken) {
    console.log('❌ Socket authentication failed: Invalid CSRF token fingerprint');
    console.log('🔒 Fingerprint mismatch details:', {
      provided: csrfToken?.substring(0, 8) + '...',
      expected: session.csrfToken?.substring(0, 8) + '...',
      match: csrfToken === session.csrfToken
    });
    return next(new Error('CSRF validation failed'));
  }

  console.log('✅ Socket fingerprint verification successful');

  try {
    // Verify user exists in database
    const user = await User.findById(session.userId);
    if (!user) {
      console.log('❌ Socket authentication failed: User not found in DB');
      return next(new Error('User not found in session'));
    }

    // Handle user status update based on connection count
    const userId = session.userId;
    const connectionCount = userConnections.get(userId) || 0;
    const newConnectionCount = connectionCount + 1;
    userConnections.set(userId, newConnectionCount);

    // Check if user is banned
    if (user.isBanned()) {
      console.log('❌ Socket authentication failed: User is banned', {
        userId: userId,
        nickname: user.nickname,
        banReason: user.banReason,
        banExpires: user.banExpires
      });
      socket.emit('banned', {
        reason: user.banReason || 'You have been banned from the server',
        expires: user.banExpires
      });
      return next(new Error('User is banned'));
    }

    // Check if user is muted and enforce mute in chat
    const isMuted = user.isMuted();
    console.log('🔇 User mute status checked:', { nickname: user.nickname, isMuted, muteExpires: user.muteExpires });

    // Update user status with connection count tracking
    const updateResult = await User.findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          status: newConnectionCount > 0 ? 'online' : 'offline',
          lastActive: new Date()
        }
      },
      {
        new: true,
        runValidators: true
      }
    );

    if (updateResult) {
      console.log(`🔄 Socket auth: User ${user.nickname} status set to online (connections: ${newConnectionCount})`);
      logger.info(`User status updated to online via socket auth`, {
        userId: userId,
        nickname: user.nickname,
        connections: newConnectionCount,
        socketId: socket.id,
        timestamp: new Date()
      });
    }

    // Override local user object with updated data
    user.status = updateResult ? updateResult.status : 'online';
    user.lastActive = updateResult ? updateResult.lastActive : new Date();

    // Set socket properties for authenticated user
    socket.userId = session.userId;
    socket.nickname = session.nickname;
    socket.role = session.role || 'member';
    console.log(`🎉 Socket authenticated via session: ${socket.nickname} (userId: ${socket.userId})`);
    console.log('Socket authentication successful');
    return next();

  } catch (error) {
    console.error('❌ Socket authentication error:', error.message);
    logger.error(`Socket auth failed: ${error.message}`, {
      socketId: socket.id,
      sessionId: session?.id,
      ip: socket.handshake.address
    });
    return next(new Error('Socket authentication failed'));
  }
});

/**
 * Cleanup inactive connections based on heartbeat
 */
function cleanupInactiveConnections() {
  const now = Date.now();
  const timeout = 60000; // 60 seconds timeout

  for (const [socketId, user] of onlineUsers.entries()) {
    if (now - user.lastHeartbeat > timeout) {
      console.log(`🧹 Cleansing dead connection for user ${user.nickname}`);

      // Force disconnect socket
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }

      // Update user connections count
      const connectionsLeft = (userConnections.get(user.userId) || 0) - 1;
      userConnections.set(user.userId, Math.max(0, connectionsLeft));

      // Set status to offline if last connection
      if (connectionsLeft <= 0) {
        User.findByIdAndUpdate(user.userId, {
          status: 'offline',
          lastActive: new Date()
        }).catch(err => logger.error('Error updating status on cleanup:', err));

        console.log(`🔄 User ${user.nickname} status set to offline (dead connection)`);
        logger.info(`User status set to offline due to dead connection`, {
          userId: user.userId,
          nickname: user.nickname,
          socketId: socketId
        });
      }

      onlineUsers.delete(socketId);
    }
  }
}

// Run cleanup every 30 seconds - DISABLED for test environment
if (process.env.NODE_ENV !== 'test') {
  setInterval(cleanupInactiveConnections, 30000);
}

io.on('connection', async (socket) => {
  console.log('🚀 Socket connection established');
  console.log(`👤 User ${socket.nickname} connected`);

  // Track online user
  onlineUsers.set(socket.id, {
    userId: socket.userId,
    nickname: socket.nickname,
    role: socket.role,
    room: null,
    lastHeartbeat: Date.now()
  });

  // Log current active connections count
  console.log(`📊 Active socket connections: ${onlineUsers.size} - auth success for ${socket.nickname}`);

  // Enhanced heartbeat mechanism with reconnection logic
  socket.on('heartbeat', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      const now = Date.now();
      user.lastHeartbeat = now;
      console.log(`💓 Heartbeat received from user ${socket.nickname} at ${new Date(now).toISOString()}`);
    } else {
      logger.warn(`Heartbeat received from unknown socket: ${socket.id}`);
    }
  });

  // Update heartbeat on user activity
  const updateHeartbeat = () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      user.lastHeartbeat = Date.now();
    }
  };

  // Send heartbeat to client periodically
  const heartbeatInterval = setInterval(() => {
    if (socket.connected) {
      socket.emit('heartbeat_request');
    }
  }, 15000); // Send heartbeat every 15 seconds

  // Clear interval on disconnect
  socket.on('disconnect', () => {
    clearInterval(heartbeatInterval);
    // ... rest of disconnect logic
  });

  // Utility function for retrying database operations
  const retryDatabaseOperation = async (operation, retries = 3) => {
    for (let i = 0; i <= retries; i++) {
      try {
        return await operation();
      } catch (error) {
        if (i === retries) throw error;
        logger.warn(`Database operation failed, retry ${i + 1}/${retries}:`, error.message);
        await new Promise(resolve => setTimeout(resolve, 500 * (i + 1))); // Exponential backoff
      }
    }
  };

  socket.on('join_room', async (data) => {
    updateHeartbeat();
    const { room } = data;
    if (!room) {
      logger.warn('Join room failed: No room specified', {
        userId: socket.userId,
        nickname: socket.nickname
      });
      socket.emit('error', {
        message: 'Room name is required',
        code: 'MISSING_ROOM',
        timestamp: new Date().toISOString()
      });
      return;
    }

    if (typeof room !== 'string' || room.trim().length === 0) {
      logger.warn('Join room failed: Invalid room format', {
        userId: socket.userId,
        nickname: socket.nickname,
        room
      });
      socket.emit('error', {
        message: 'Invalid room name format',
        code: 'INVALID_ROOM_FORMAT',
        timestamp: new Date().toISOString()
      });
      return;
    }

    try {
      await retryDatabaseOperation(async () => {
        // Verify channel exists
        const channel = await Channel.findOne({ id: room });
        if (!channel) {
          logger.warn('Join room failed: Channel not found', {
            userId: socket.userId,
            nickname: socket.nickname,
            room
          });
          socket.emit('error', {
            message: `Channel '${room}' not found`,
            code: 'CHANNEL_NOT_FOUND',
            room,
            timestamp: new Date().toISOString()
          });
          throw new Error('Channel not found');
        }

        // Leave previous room
        if (socket.room) {
          socket.leave(socket.room);
          onlineUsers.set(socket.id, { ...onlineUsers.get(socket.id), room: null });

          // Update online users in previous room
          const previousRoomUsers = Array.from(onlineUsers.values())
            .filter(u => u.room === socket.room)
            .map(u => ({ nickname: u.nickname, role: u.role }));
          io.to(socket.room).emit('online_users', previousRoomUsers);
        }

        socket.room = room;
        socket.join(socket.room);

        // Update user tracking
        onlineUsers.set(socket.id, {
          ...onlineUsers.get(socket.id),
          room: socket.room
        });

        logger.info(`User ${socket.nickname} joined room ${socket.room}`);

        // Send system message about joining
        const joinMessage = new Message({
          author: 'System',
          channel: socket.room,
          text: `${socket.nickname} joined the channel.`,
          type: 'system'
        });
        await joinMessage.save();

        io.to(socket.room).emit('message', {
          author: joinMessage.author,
          channel: joinMessage.channel,
          text: joinMessage.text,
          type: joinMessage.type,
          timestamp: joinMessage.timestamp
        });

        // Send online users in current room
        const roomUsers = Array.from(onlineUsers.values())
          .filter(u => u.room === socket.room)
          .map(u => ({ nickname: u.nickname, role: u.role }));
        io.to(socket.room).emit('online_users', roomUsers);

        // Send message history
        const history = await Message.find({
          channel: socket.room,
          $or: [
            { type: 'public' },
            { type: 'system' },
            { author: socket.nickname },
            { target: socket.nickname }
          ]
        })
          .sort({ timestamp: -1 })
          .limit(100)
          .sort({ timestamp: 1 }); // Resort for chronological order

        socket.emit('history', history.map(msg => ({
          author: msg.author,
          room: msg.channel,
          text: msg.text,
          type: msg.type,
          target: msg.target,
          timestamp: msg.timestamp
        })));
      });

    } catch (error) {
      logger.error('Error in join_room after retries:', error);
      socket.emit('error', {
        message: 'Failed to join room after multiple attempts',
        code: 'JOIN_ROOM_FAILED',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Load history (fallback, if needed)
  socket.on('get_history', async () => {
    if (!socket.room) {
      socket.emit('history', []);
      return;
    }

    try {
      const history = await Message.find({
        channel: socket.room,
        $or: [
          { type: 'public' },
          { type: 'system' },
          { author: socket.nickname },
          { target: socket.nickname }
        ]
      })
        .sort({ timestamp: -1 })
        .limit(100)
        .sort({ timestamp: 1 }); // Resort for chronological order

      socket.emit('history', history.map(msg => ({
        author: msg.author,
        room: msg.channel, // Using channel instead of room for consistency
        text: msg.text,
        type: msg.type,
        target: msg.target,
        timestamp: msg.timestamp
      })));
    } catch (error) {
      logger.error('Error getting history:', error);
      socket.emit('error', { message: 'Failed to load message history' });
    }
  });

  // Public message
  socket.on('message', async (data) => {
    updateHeartbeat();
    if (!socket.room || !data.text?.trim()) return;

    // Check if user is muted
    const currentUser = await User.findById(socket.userId);
    if (currentUser && currentUser.isMuted()) {
      socket.emit('error', {
        message: 'You are muted and cannot send messages',
        code: 'USER_MUTED',
        muteExpires: currentUser.muteExpires
      });
      return;
    }

    try {
      const message = new Message({
        author: socket.nickname,
        channel: socket.room,
        text: data.text.trim(),
        type: 'public'
      });

      await message.save();

      const messageData = {
        author: message.author,
        room: message.channel, // Keeping 'room' for frontend compatibility
        text: message.text,
        timestamp: message.timestamp,
        status: 'delivered',
        type: message.type
      };

      io.to(socket.room).emit('message', messageData);
      logger.debug(`Message saved from ${socket.nickname} in ${socket.room}`);
    } catch (error) {
      logger.error('Error saving message:', error);
      socket.emit('error', { message: 'Failed to send message' });
    }
  });

  // Private message
  socket.on('private_message', async (data) => {
    updateHeartbeat();
    if (!socket.room || !data.to || !data.text?.trim()) return;

    const trimmedText = data.text.trim();
    const targetNickname = data.to.trim();

    try {
      logger.debug(`Private message attempt from ${socket.nickname} to ${targetNickname}`, {
        senderRoom: socket.room,
        senderSocketId: socket.id,
        userId: socket.userId
      });

      // Validate target nickname format
      if (targetNickname.length === 0 || targetNickname.length > 50) {
        socket.emit('error', {
          message: 'Invalid target user nickname',
          code: 'INVALID_TARGET_NICKNAME'
        });
        return;
      }

      // Prevent self-messaging
      if (targetNickname === socket.nickname) {
        socket.emit('error', {
          message: 'Cannot send private message to yourself',
          code: 'SELF_MESSAGE_NOT_ALLOWED'
        });
        return;
      }

      // Find target user in same room with detailed logging
      const targetUser = Array.from(onlineUsers.values()).find(
        u => u.nickname === targetNickname && u.room === socket.room
      );

      logger.debug(`Private message target search result for ${targetNickname}`, {
        targetFound: !!targetUser,
        targetRoom: targetUser?.room,
        senderRoom: socket.room,
        onlineUsersInRoom: Array.from(onlineUsers.values())
          .filter(u => u.room === socket.room)
          .map(u => ({ nickname: u.nickname, room: u.room }))
      });

      if (!targetUser) {
        // Enhanced error message with more context
        const onlineUsersInSenderRoom = Array.from(onlineUsers.values())
          .filter(u => u.room === socket.room)
          .map(u => u.nickname);

        socket.emit('error', {
          message: `User '${targetNickname}' is not available in this channel. Available users: ${onlineUsersInSenderRoom.join(', ') || 'none'}`,
          code: 'TARGET_USER_NOT_IN_ROOM',
          target: targetNickname,
          availableUsers: onlineUsersInSenderRoom,
          senderRoom: socket.room
        });
        return;
      }

      // Create message object
      const message = new Message({
        author: socket.nickname,
        channel: socket.room,
        text: trimmedText,
        type: 'private',
        target: targetNickname
      });
      await message.save();

      const messageData = {
        author: message.author,
        room: message.channel,
        text: message.text,
        timestamp: message.timestamp,
        type: message.type,
        target: message.target,
        status: 'delivered'
      };

      // Send to target user with error handling
      const targetSocketId = Array.from(onlineUsers.keys()).find(
        id => onlineUsers.get(id).nickname === targetNickname
      );

      if (targetSocketId) {
        io.to(targetSocketId).emit('private_message', messageData);
        logger.debug(`Private message sent to target ${targetNickname}`, {
          targetSocketId: targetSocketId,
          sender: socket.nickname,
          room: socket.room,
          messageId: message._id
        });
      } else {
        logger.warn(`Target user ${targetNickname} found in onlineUsers but socket ID not found`, {
          targetNickname,
          room: socket.room,
          onlineUsersCount: onlineUsers.size,
          messageId: message._id
        });
        // Message still saved to database for later delivery if user reconnects
      }

      // Send confirmation to sender (without target for privacy)
      socket.emit('private_message', {
        author: message.author,
        room: message.room,
        text: message.text,
        timestamp: message.timestamp,
        type: message.type,
        target: null, // Hide target from sender's confirmation
        status: 'sent'
      });

      logger.info(`Private message sent successfully`, {
        sender: socket.nickname,
        target: targetNickname,
        room: socket.room,
        messageId: message._id,
        messageLength: trimmedText.length
      });

    } catch (error) {
      logger.error('Error sending private message:', {
        error: error.message,
        sender: socket.nickname,
        target: data.to,
        room: socket.room,
        userId: socket.userId,
        stack: error.stack
      });
      socket.emit('error', {
        message: 'Failed to send private message',
        code: 'PRIVATE_MESSAGE_FAILED'
      });
    }
  });

  // Speaking
  socket.on('speaking', (data) => {
    updateHeartbeat();
    socket.to(socket.room).emit('speaking', { nickname: socket.nickname, speaking: data.speaking });
  });

  // Voice channel events
  socket.on('join_voice_channel', async (data) => {
    updateHeartbeat();
    const { channelId } = data;
    if (!channelId) return;

    try {
      // Verify channel exists and is voice
      const channel = await Channel.findOne({ id: channelId, type: 'voice' });
      if (!channel) {
        socket.emit('voice_error', { message: 'Voice channel not found' });
        return;
      }

      // Initialize voice channel if not exists
      if (!voiceChannels.has(channelId)) {
        voiceChannels.set(channelId, new Map());
      }

      const channelPeers = voiceChannels.get(channelId);

      // Notify others in the channel
      socket.to(channelId).emit('user_joined_voice', { nickname: socket.nickname, socketId: socket.id });

      // Add socket to voice channel room
      socket.join(channelId);
      channelPeers.set(socket.id, { peerConnection: null, stream: null });

      // Update user's voice channel status
      socket.voiceChannel = channelId;

      logger.info(`User ${socket.nickname} joined voice channel ${channelId}`);
      socket.emit('voice_joined', { channelId });

    } catch (error) {
      logger.error('Error joining voice channel:', error);
      socket.emit('voice_error', { message: 'Failed to join voice channel' });
    }
  });

  socket.on('leave_voice_channel', () => {
    updateHeartbeat();
    if (!socket.voiceChannel) return;

    const channelId = socket.voiceChannel;
    const channelPeers = voiceChannels.get(channelId);

    if (channelPeers) {
      channelPeers.delete(socket.id);
      if (channelPeers.size === 0) {
        voiceChannels.delete(channelId);
      }
    }

    // Notify others
    socket.to(channelId).emit('user_left_voice', { nickname: socket.nickname, socketId: socket.id });

    socket.leave(channelId);
    socket.voiceChannel = null;

    logger.info(`User ${socket.nickname} left voice channel ${channelId}`);
    socket.emit('voice_left');
  });

  socket.on('voice_offer', (data) => {
    const { offer, targetSocketId } = data;
    socket.to(targetSocketId).emit('voice_offer', {
      offer,
      from: socket.id,
      fromNickname: socket.nickname
    });
  });

  socket.on('voice_answer', (data) => {
    const { answer, targetSocketId } = data;
    socket.to(targetSocketId).emit('voice_answer', {
      answer,
      from: socket.id,
      fromNickname: socket.nickname
    });
  });

  socket.on('ice_candidate', (data) => {
    const { candidate, targetSocketId } = data;
    socket.to(targetSocketId).emit('ice_candidate', {
      candidate,
      from: socket.id,
      fromNickname: socket.nickname
    });
  });

  // Disconnect
  socket.on('disconnect', async () => {
    logger.info(`User ${socket.nickname} disconnected`);

    try {
      const userId = socket.userId;

      // Decrease connection count for this user
      if (userId) {
        const currentCount = userConnections.get(userId) || 0;
        const newCount = Math.max(0, currentCount - 1);
        userConnections.set(userId, newCount);

        logger.info(`User ${socket.nickname} disconnected (remaining connections: ${newCount})`, {
          userId: userId,
          socketId: socket.id,
          connectionsLeft: newCount
        });
      }

      // Leave voice channel if in one
      if (socket.voiceChannel) {
        const channelId = socket.voiceChannel;
        const channelPeers = voiceChannels.get(channelId);

        if (channelPeers) {
          channelPeers.delete(socket.id);
          if (channelPeers.size === 0) {
            voiceChannels.delete(channelId);
          }
        }

        // Notify others
        socket.to(channelId).emit('user_left_voice', { nickname: socket.nickname, socketId: socket.id });
      }

      if (socket.room) {
        socket.leave(socket.room);

        // Create leave message
        const leaveMessage = new Message({
          author: 'System',
          channel: socket.room,
          text: `${socket.nickname} left the channel.`,
          type: 'system'
        });
        await leaveMessage.save();

        io.to(socket.room).emit('message', {
          author: leaveMessage.author,
          room: leaveMessage.channel,
          text: leaveMessage.text,
          type: leaveMessage.type,
          timestamp: leaveMessage.timestamp
        });

        // Update online users list
        const roomUsers = Array.from(onlineUsers.values())
          .filter(u => u.room === socket.room && u.userId !== socket.userId)
          .map(u => ({ nickname: u.nickname, role: u.role }));
        io.to(socket.room).emit('online_users', roomUsers);
      }

      // Remove from tracking
      onlineUsers.delete(socket.id);

      // Log current connections after disconnect
      logger.info(`After disconnect, active socket connections: ${onlineUsers.size}`);

      // Update user status in database if this was the last connection
      if (userId) {
        const remainingConnections = userConnections.get(userId) || 0;
        if (remainingConnections === 0) {
          await User.findByIdAndUpdate(userId, {
            status: 'offline',
            lastActive: new Date()
          });
          console.log(`🔄 User ${socket.nickname} status set to offline (last connection)`);
          logger.info(`User status set to offline (last connection)`, {
            userId: userId,
            nickname: socket.nickname
          });
        } else {
          // Update lastActive but keep status online
          await User.findByIdAndUpdate(userId, {
            lastActive: new Date()
          });
          console.log(`✅ User ${socket.nickname} still online (${remainingConnections} connections left)`);
          logger.info(`User remains online`, {
            userId: userId,
            nickname: socket.nickname,
            connectionsLeft: remainingConnections
          });
        }
      }

    } catch (error) {
      logger.error('Error in disconnect handler:', error);
    }
 });
});

// Initialize database and start server (duplicate removed)
const initializeServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Create default channels if they don't exist
    const defaultChannels = [
      { id: 'general', name: 'General', type: 'text', createdBy: 'system' },
      { id: 'voice-chat', name: 'Voice Chat', type: 'voice', createdBy: 'system' }
    ];

    for (const channelData of defaultChannels) {
      await Channel.findOneAndUpdate(
        { id: channelData.id },
        channelData,
        { upsert: true, new: true }
      );
    }

    logger.info('Default channels initialized');

    // Start server
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT}`);
      console.log(`Server running on port ${PORT}`);
    });

  } catch (error) {
    logger.error('Failed to initialize server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await closeDB();
  io.close(() => {
    logger.info('Server shut down');
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await closeDB();
  io.close(() => {
    logger.info('Server shut down');
    process.exit(0);
  });
});

// Optimize critical server functions
const optimizedInitializeDatabase = asyncOptimize(initializeServer, {
  concurrency: 1,
  timeout: 60000,
  slowThreshold: 10000
});

// Start the server with async optimization
optimizedInitializeDatabase().catch(err => {
  logger.error('Unhandled error during server startup:', err);
  process.exit(1);
});

// Memory cleanup on long-running operations
setInterval(() => {
  if (global.gc) {
    global.gc();
    logger.debug('Manual garbage collection triggered');
  }
}, 300000); // Every 5 minutes

// Handle uncaught exceptions with circuit breaker protection
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  // Don't exit immediately, let circuit breaker handle recovery
  setTimeout(() => {
    if (externalServiceBreaker.databaseBreaker.failureCount > 10) {
      logger.error('Multiple uncaught exceptions detected, forcing graceful shutdown');
      process.exit(1);
    }
  }, 1000);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log and let circuit breaker handle
});

// Graceful shutdown with resource cleanup
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, starting graceful shutdown...');

  try {
    // Close external service connections
    const circuitStatus = getCircuitBreakerStatuses();
    logger.info('Circuit breaker final status:', circuitStatus);

    // Clean up any remaining resources
    await closeDB();

    // Log final metrics
    const finalMetrics = performanceMonitor.getDetailedStats();

    logger.info('Final performance metrics:', {
      uptime: finalMetrics.uptime,
      totalRequests: finalMetrics.endpointStats
        ? Object.values(finalMetrics.endpointStats).reduce((acc, endpoint) =>
            acc + (endpoint.count || 0), 0)
        : 0,
      memoryPeak: finalMetrics.memory?.heapTotal || 0
    });

    io.close(() => {
      logger.info('Server graceful shutdown complete');
      process.exit(0);
    });
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
});

// Periodic health self-assessment
setInterval(() => {
  const healthData = performanceMonitor.getHealthData();

  // Self-monitor critical metrics
  if (healthData.requests.averageResponseTime > 5000) {
    logger.warn('🚨 Self-monitor: High average response time detected', {
      avgTime: `${healthData.requests.averageResponseTime}ms`,
      threshold: '5000ms',
      timestamp: new Date().toISOString()
    });
  }

  if (healthData.memory.usagePercent > 0.9) {
    logger.warn('🚨 Self-monitor: High memory usage detected', {
      usage: healthData.memory.percentage,
      threshold: '90%',
      timestamp: new Date().toISOString()
    });

    // Trigger proactive cleanup
    if (global.gc) {
      global.gc();
      logger.info('🧹 Proactive garbage collection triggered');
    }
  }

  // Check circuit breaker status
  const circuitStatus = getCircuitBreakerStatuses();
  if (circuitStatus.database?.state === 'open') {
    logger.warn('🚨 Self-monitor: Database circuit breaker is OPEN', circuitStatus.database);
  }

  if (circuitStatus.redis?.state === 'open') {
    logger.warn('🚨 Self-monitor: Redis circuit breaker is OPEN', circuitStatus.redis);
  }

}, 60000); // Check every minute
