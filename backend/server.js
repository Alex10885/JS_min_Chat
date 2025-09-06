require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const winston = require('winston');
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

// Authentication endpoints
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

app.get('/channels', async (req, res) => {
  try {
    const channels = await Channel.find().sort({ position: 1, createdAt: 1 });
    res.json(channels);
  } catch (error) {
    logger.error('Error fetching channels:', error);
    res.status(500).json({ error: 'Failed to fetch channels' });
  }
});

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

  // Disconnect
  socket.on('disconnect', async () => {
    logger.info(`User ${socket.nickname} disconnected`);

    try {
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