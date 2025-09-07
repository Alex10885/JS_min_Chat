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
const { connectDB, closeDB } = require('./db/connection');
const emailService = require('./services/emailService');

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

// Rate limiting configuration
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth requests per windowMs
  message: { error: 'Too many authentication attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 API requests per windowMs
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Limit each IP to 3 password reset requests per windowMs
  message: { error: 'Too many password reset requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["authorization", "content-type"]
  },
  // Ensure both transports are supported
  transports: ['websocket', 'polling']
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

app.use(express.json({ limit: '10mb' })); // Add payload size limit

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

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
  try {
    console.log('🔐 JWT authentication middleware called:', { url: req.url, method: req.method });
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    console.log('🔑 Token extraction result:', { hasAuthHeader: !!authHeader, hasToken: !!token });

    if (!token) {
      console.log('❌ No token provided');
      return res.status(401).json({
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log('✅ JWT decoded:', { userId: decoded.userId, nickname: decoded.nickname });
    const user = await User.findById(decoded.userId);

    if (!user) {
      console.log('❌ User not found in DB for JWT userId:', decoded.userId);
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    req.user = user;
    console.log('✅ JWT authentication successful for user:', user.nickname, { id: user._id, status: user.status });
    next();
  } catch (error) {
    logger.warn('JWT authentication failed:', {
      error: error.message,
      ip: req.ip
    });

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Invalid token format',
        code: 'INVALID_TOKEN_FORMAT'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    }

    return res.status(401).json({
      error: 'Token verification failed',
      code: 'TOKEN_VERIFICATION_FAILED'
    });
  }
};

// General rate limiting (applied to all HTTP requests)
app.use(generalRateLimiter);

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

// Swagger JSON endpoint
app.get('/api-docs.json', (req, res) => {
  res.removeHeader('Content-Security-Policy');
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
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
  try {
    console.log('🔑 Incoming login request:', { identifier: req.body.identifier, hasPassword: !!req.body.password, ip: req.ip });
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('❌ Login validation errors:', errors.array());
      return res.status(400).json({ errors: errors.array() });
    }

    const { identifier, password } = req.body;
    console.log('🔍 Searching for user with identifier:', identifier);

    // Find user by nickname or email
    const user = await User.findOne({
      $or: [{ nickname: identifier }, { email: identifier }]
    });

    if (!user) {
      console.log('❌ User not found:', identifier);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    console.log('✅ User found:', { nickname: user.nickname, email: user.email, status: user.status });

    // Compare password
    const isPasswordValid = await user.comparePassword(password);
    console.log('🔑 Password validation result:', isPasswordValid);

    if (!isPasswordValid) {
      console.log('❌ Invalid password for user:', user.nickname);
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Update user status to online
    user.status = 'online';
    await user.save();

    // Generate JWT token
    console.log('🔏 Generating JWT token for user:', user.nickname);
    const token = jwt.sign(
      { userId: user._id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    console.log('✅ JWT token generated successfully');

    logger.info(`User logged in: ${user.nickname}`);

    console.log('📤 Sending login response');
    res.json({
      token,
      user: {
        id: user._id,
        nickname: user.nickname,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Server error during login' });
  }
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
app.post('/api/register', authRateLimiter, [
  body('nickname').isLength({ min: 3, max: 50 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { nickname, email, password } = req.body;

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ nickname }, { email }]
    });

    if (existingUser) {
      const conflictField = existingUser.nickname === nickname ? 'nickname' : 'email';
      const errorMessage = conflictField === 'nickname' ? 'Nickname already taken' : 'Email already registered';
      return res.status(409).json({ error: errorMessage });
    }

    // Create user
    const user = new User({ nickname, email, password, role: 'member', status: 'online' });
    await user.save();

    console.log('JWT_SECRET present:', !!process.env.JWT_SECRET);
    const token = jwt.sign(
      { userId: user._id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('JWT token generated successfully');
    logger.info(`User registered: ${user.nickname}`);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        nickname: user.nickname,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Server error during registration' });
  }
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
app.get('/api/channels', authenticateToken, apiRateLimiter, async (req, res) => {
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

// 404 handler (must be before global error handler)
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

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  console.log('🔑 Socket authentication attempt, token present:', !!token);

  if (!token) {
    console.log('❌ Socket authentication failed: No token provided');
    return next(new Error('Authentication token required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId);

    console.log(`✅ Socket auth success: ${decoded.nickname}, user found: ${!!user}`);

    if (!user) {
      console.log('❌ Socket authentication failed: User not found');
      return next(new Error('User not found or not online'));
    }

    // Check if user is marked as offline during authentication
    if (user.status === 'offline') {
      console.log('❌ Socket authentication failed: User is offline');
      return next(new Error('User not found or not online'));
    }

    // Handle user status update based on connection count
    try {
      const userId = decoded.userId;
      const connectionCount = userConnections.get(userId) || 0;
      const newConnectionCount = connectionCount + 1;
      userConnections.set(userId, newConnectionCount);

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

    } catch (statusUpdateError) {
      console.error(`❌ Socket auth: Failed to update user status for ${user.nickname}:`, statusUpdateError.message);
      logger.error(`Status update failed during socket auth`, {
        userId: userId,
        nickname: user.nickname,
        error: statusUpdateError.message,
        socketId: socket.id
      });

      // Don't fail auth due to status update error - proceed with default online status
      console.log(`⚠️ Socket auth: Proceeding with online status despite update failure`);
      user.status = 'online';
      user.lastActive = new Date();
    }

    socket.userId = decoded.userId;
    socket.nickname = decoded.nickname;
    socket.role = decoded.role;
    console.log(`🎉 Socket fully authenticated: ${socket.nickname}`);
    return next();
  } catch (err) {
    console.error('❌ Socket authentication error:', err.message);

    if (err.name === 'JsonWebTokenError') {
      return next(new Error('Invalid authentication token'));
    }

    if (err.name === 'TokenExpiredError') {
      return next(new Error('Authentication token has expired'));
    }

    return next(new Error('Authentication failed'));
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

// Run cleanup every 30 seconds
setInterval(cleanupInactiveConnections, 30000);

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

  // Heartbeat mechanism
  socket.on('heartbeat', () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      user.lastHeartbeat = Date.now();
      console.log(`💓 Heartbeat received from user ${socket.nickname}`);
    }
  });

  // Update heartbeat on user activity
  const updateHeartbeat = () => {
    const user = onlineUsers.get(socket.id);
    if (user) {
      user.lastHeartbeat = Date.now();
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
        return;
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

    } catch (error) {
      logger.error('Error in join_room:', error);
      socket.emit('error', { message: 'Failed to join room' });
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

// Start the server
initializeServer().catch(err => {
  logger.error('Unhandled error during server startup:', err);
  process.exit(1);
});
