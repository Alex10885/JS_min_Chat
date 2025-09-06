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
const { body, validationResult } = require('express-validator');
const { connectDB, closeDB } = require('./db/connection');

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
const io = socketIo(server, {
  cors: {
    origin: true,
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

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
app.post('/register', [
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
      return res.status(400).json({
        error: existingUser.nickname === nickname ? 'Nickname already taken' : 'Email already registered'
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
app.post('/login', async (req, res) => {
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
app.get('/channels', async (req, res) => {
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
app.post('/channels', [
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
  logger.info('Socket authentication attempt, token present:', !!token);

  if (!token) {
    return next(new Error('Authentication token required'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    logger.info(`Decoded token: ${decoded.nickname}, user found: ${!!user}`);

    if (!user) {
      return next(new Error('User not found'));
    }

    socket.userId = decoded.id;
    socket.nickname = decoded.nickname;
    socket.role = decoded.role;
    logger.info(`Socket authenticated for user: ${socket.nickname}`);
    return next();
  } catch (err) {
    logger.error('Socket authentication error:', err.message);
    return next(new Error('Authentication error'));
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
    if (!room) return;

    try {
      // Verify channel exists
      const channel = await Channel.findOne({ id: room });
      if (!channel) {
        socket.emit('error', { message: 'Channel not found' });
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