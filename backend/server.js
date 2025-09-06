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
    origin: true,
    methods: ["GET", "POST"]
  }
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
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    }

    req.user = user;
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

// 404 handler
app.use((req, res) => {
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

// Authentication endpoints
/**
  * @swagger
  * /register:
  *   post:
  *     tags:
  *       - Authentication
  *     summary: Register a new user
  *     description: Creates a new user account with nickname, email, and password
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
  *         description: User registered successfully
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
  *         description: Validation error or user already exists
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ErrorResponse'
  *             examples:
  *               validation:
  *                 value:
  *                   errors: [
  *                     { msg: "Nickname must be at least 3 chars long", param: "nickname" }
  *                   ]
  *               duplicate:
  *                 value:
  *                   error: "Nickname already taken"
  *       500:
  *         description: Server error
  */
app.post('/register', authRateLimiter, [
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

    logger.info(`Registration attempt for nickname: ${nickname}, email: ${email}`);

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ nickname }, { email }]
    });

    logger.info(`Existing user check result: ${existingUser ? `Found user with nickname: ${existingUser.nickname}, email: ${existingUser.email}` : 'No existing user found'}`);

    if (existingUser) {
      const errorMsg = existingUser.nickname === nickname ? 'Nickname already taken' : 'Email already registered';
      return res.status(409).json({
        error: errorMsg,
        field: existingUser.nickname === nickname ? 'nickname' : 'email',
        code: 'DUPLICATE_USER'
      });
    }

    logger.info(`Creating new user with nickname: ${nickname}`);

    // Create user
    const user = new User({ nickname, email, password, role: 'member' });
    await user.save();

    logger.info(`User saved successfully: ${nickname}`);

    const token = jwt.sign(
      { id: user._id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    logger.info(`New user registered: ${nickname} (${email})`);

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
    logger.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      keyValue: error.keyValue
    });
    res.status(500).json({ error: 'Server error during registration' });
  }
});

/**
  * @swagger
  * /login:
  *   post:
  *     tags:
  *       - Authentication
  *     summary: Login user
  *     description: Authenticates user with nickname or email and returns JWT token
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             $ref: '#/components/schemas/LoginRequest'
  *           example:
  *             identifier: "john_doe"
  *             password: "securePass123"
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
  *       401:
  *         description: Invalid credentials
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ErrorResponse'
  *             example:
  *               error: "Invalid credentials"
  *       400:
  *         description: Missing required fields
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ErrorResponse'
  *             example:
  *               error: "Identifier and password required"
  *       500:
  *         description: Server error
  */
app.post('/login', authRateLimiter, async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Identifier and password required' });
    }

    // Find user by nickname or email
    const user = await User.findOne({
      $or: [{ nickname: identifier }, { email: identifier }]
    });

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user._id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Update last active
    user.lastActive = new Date();
    user.status = 'online';
    await user.save();

    logger.info(`User logged in: ${user.nickname}`);

    res.json({
      token,
      user: {
        id: user._id,
        nickname: user.nickname,
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
  * /forgot-password:
  *   post:
  *     tags:
  *       - Authentication
  *     summary: Request password reset
  *     description: Send password reset email for the specified email address
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             required:
  *               - email
  *             properties:
  *               email:
  *                 type: string
  *                 format: email
  *                 description: User email address
  *     responses:
  *       200:
  *         description: Password reset email sent successfully
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 message:
  *                   type: string
  *                 code:
  *                   type: string
  *       400:
  *         description: Invalid email format
  *       404:
  *         description: User not found
  *       429:
  *         description: Too many requests
  *       500:
  *         description: Server error
  */
app.post('/forgot-password', passwordResetRateLimiter, [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid email format',
        details: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { email } = req.body;

    logger.info(`Password reset request for email: ${email}`);

    // Find user by email
    const user = await User.findOne({ email });

    // Don't reveal if user exists or not for security
    if (!user) {
      logger.warn(`Password reset requested for non-existent email: ${email}`);
      return res.status(200).json({
        message: 'If an account with this email exists, a password reset link has been sent.',
        code: 'RESET_EMAIL_SENT'
      });
    }

    // Generate reset token
    const resetToken = user.generateResetToken();
    await user.save();

    // Send email
    try {
      await emailService.sendPasswordResetEmail(user.email, resetToken);

      logger.info(`Password reset email sent to: ${email}`);
      res.json({
        message: 'Password reset email sent successfully',
        code: 'RESET_EMAIL_SENT'
      });
    } catch (emailError) {
      logger.error('Error sending password reset email:', emailError);

      // Clear the token if email fails
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save();

      throw emailError;
    }

  } catch (error) {
    logger.error('Forgot password error:', error);
    res.status(500).json({
      error: 'Failed to process password reset request',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
  * @swagger
  * /reset-password:
  *   post:
  *     tags:
  *       - Authentication
  *     summary: Reset password using token
  *     description: Reset user password using the token received via email
  *     requestBody:
  *       required: true
  *       content:
  *         application/json:
  *           schema:
  *             type: object
  *             required:
  *               - token
  *               - password
  *             properties:
  *               token:
  *                 type: string
  *                 description: Password reset token
  *               password:
  *                 type: string
  *                 minLength: 6
  *                 description: New password
  *     responses:
  *       200:
  *         description: Password reset successfully
  *         content:
  *           application/json:
  *             schema:
  *               type: object
  *               properties:
  *                 message:
  *                   type: string
  *                 code:
  *                   type: string
  *       400:
  *         description: Invalid token or password
  *       410:
  *         description: Token expired
  *       500:
  *         description: Server error
  */
app.post('/reset-password', [
  body('token').trim().isLength({ min: 1 }),
  body('password').isLength({ min: 6 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid input data',
        details: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { token, password } = req.body;

    logger.info(`Password reset attempt with token: ${token.substring(0, 10)}...`);

    // Find user with valid reset token
    const user = await User.findOne({
      resetPasswordToken: crypto
        .createHash('sha256')
        .update(token)
        .digest('hex'),
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      logger.warn('Invalid or expired password reset token');
      return res.status(400).json({
        error: 'Invalid or expired password reset token',
        code: 'INVALID_RESET_TOKEN'
      });
    }

    // Reset password
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;
    await user.save();

    logger.info(`Password reset successful for user: ${user.nickname}`);

    // Send confirmation email
    try {
      await emailService.sendPasswordResetSuccessEmail(user.email);
    } catch (emailError) {
      logger.warn('Failed to send password reset success email:', emailError);
      // Don't fail the request if confirmation email fails
    }

    res.json({
      message: 'Password reset successful',
      code: 'PASSWORD_RESET_SUCCESS'
    });

  } catch (error) {
    logger.error('Reset password error:', error);
    res.status(500).json({
      error: 'Failed to reset password',
      code: 'INTERNAL_ERROR'
    });
  }
});

/**
  * @swagger
  * /channels:
  *   get:
  *     tags:
  *       - Channels
  *     summary: Get all channels
  *     description: Retrieves a list of all available channels (text and voice)
  *     security:
  *       - bearerAuth: []
  *     responses:
  *       200:
  *         description: List of channels retrieved successfully
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
  *                 createdBy: "system"
  *                 position: 0
  *               - id: "voice-chat"
  *                 name: "Voice Chat"
  *                 type: "voice"
  *                 createdBy: "system"
  *                 position: 1
  *       500:
  *         description: Server error
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ErrorResponse'
  */
app.get('/channels', apiRateLimiter, authenticateToken, async (req, res) => {
  try {
    const channels = await Channel.find().sort({ position: 1, createdAt: 1 });
    res.json(channels);
  } catch (error) {
    logger.error('Error fetching channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

/**
  * @swagger
  * /channels:
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
  *             name: "Random Chat"
  *             type: "text"
  *             description: "General discussion channel"
  *     responses:
  *       201:
  *         description: Channel created successfully
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/Channel'
  *             example:
  *               id: "random_chat"
  *               name: "Random Chat"
  *               type: "text"
  *               description: "General discussion channel"
  *               createdBy: "john_doe"
  *               position: 0
  *       400:
  *         description: Validation error or channel already exists
  *         content:
  *           application/json:
  *             schema:
  *               $ref: '#/components/schemas/ErrorResponse'
  *             examples:
  *               validation:
  *                 value:
  *                   errors: [
  *                     { msg: "Channel name is required", param: "name" }
  *                   ]
  *               duplicate:
  *                 value:
  *                   error: "Channel already exists"
  *       500:
  *         description: Server error
  */
app.post('/channels', apiRateLimiter, authenticateToken, [
  body('name').isLength({ min: 1, max: 100 }).trim().escape(),
  body('type').isIn(['text', 'voice'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, type = 'text', description } = req.body;
    const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

    // Check if channel exists
    const existingChannel = await Channel.findOne({ id });
    if (existingChannel) {
      return res.status(400).json({ error: 'Channel already exists' });
    }

    const channelData = {
      id,
      name,
      type,
      description,
      createdBy: req.user?.nickname || 'system'
    };

    const channel = new Channel(channelData);
    await channel.save();

    logger.info(`Channel created: ${name} (${type})`);
    res.status(201).json(channel);
  } catch (error) {
    logger.error('Error creating channel:', error);
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

// Global users map for socket management {socketId: {userId, nickname, room}}
let onlineUsers = new Map();

// Voice channels management
const voiceChannels = new Map(); // channelId -> { socketId: { peerConnection, stream } }

io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  logger.info('Socket authentication attempt, token present:', !!token, {
    remoteAddress: socket.handshake.address,
    userAgent: socket.handshake.headers['user-agent']
  });

  if (!token) {
    logger.warn('Socket authentication failed: No token provided', {
      remoteAddress: socket.handshake.address
    });
    return next(new Error('Authentication token required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    logger.info(`Socket auth success: ${decoded.nickname}, user found: ${!!user}`, {
      userId: decoded.id,
      nickname: decoded.nickname,
      remoteAddress: socket.handshake.address
    });

    if (!user) {
      logger.warn('Socket authentication failed: User not found', {
        userId: decoded.id,
        remoteAddress: socket.handshake.address
      });
      return next(new Error('User not found'));
    }

    if (user.status !== 'online') {
      logger.warn('Socket authentication failed: User not online', {
        userId: user._id,
        nickname: user.nickname,
        status: user.status,
        remoteAddress: socket.handshake.address
      });
      return next(new Error('User account is not active'));
    }

    socket.userId = decoded.id;
    socket.nickname = decoded.nickname;
    socket.role = decoded.role;
    logger.info(`Socket fully authenticated: ${socket.nickname}`);
    return next();
  } catch (err) {
    logger.error('Socket authentication error:', {
      error: err.message,
      stack: err.stack,
      remoteAddress: socket.handshake.address
    });

    if (err.name === 'JsonWebTokenError') {
      return next(new Error('Invalid authentication token'));
    }

    if (err.name === 'TokenExpiredError') {
      return next(new Error('Authentication token has expired'));
    }

    return next(new Error('Authentication failed'));
  }
});

io.on('connection', async (socket) => {
  logger.info(`User ${socket.nickname} connected`);

  // Track online user
  onlineUsers.set(socket.id, {
    userId: socket.userId,
    nickname: socket.nickname,
    role: socket.role,
    room: null
  });

  socket.on('join_room', async (data) => {
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
    if (!socket.room || !data.to || !data.text?.trim()) return;

    try {
      // Find target user in same room
      const targetUser = Array.from(onlineUsers.values()).find(
        u => u.nickname === data.to && u.room === socket.room
      );

      if (!targetUser) {
        socket.emit('error', { message: 'User not online in this channel.' });
        return;
      }

      const message = new Message({
        author: socket.nickname,
        channel: socket.room,
        text: data.text.trim(),
        type: 'private',
        target: data.to
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

      // Send to target user
      const targetSocketId = Array.from(onlineUsers.keys()).find(
        id => onlineUsers.get(id).nickname === data.to
      );
      if (targetSocketId) {
        io.to(targetSocketId).emit('private_message', messageData);
      }

      // Send copy to sender (without target for privacy)
      socket.emit('private_message', { ...messageData, target: null });

    } catch (error) {
      logger.error('Error sending private message:', error);
      socket.emit('error', { message: 'Failed to send private message' });
    }
  });

  // Speaking
  socket.on('speaking', (data) => {
    socket.to(socket.room).emit('speaking', { nickname: socket.nickname, speaking: data.speaking });
  });

  // Voice channel events
  socket.on('join_voice_channel', async (data) => {
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

      // Update user status in database if user exists
      if (socket.userId) {
        await User.findByIdAndUpdate(socket.userId, {
          status: 'offline',
          lastActive: new Date()
        });
      }

    } catch (error) {
      logger.error('Error in disconnect handler:', error);
    }
  });
});

// Initialize database and start server
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