const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { body, validationResult } = require('express-validator');

// Import models
const User = require('../../models/User');
const Message = require('../../models/Message');
const Channel = require('../../models/Channel');

// Import DB connection
const { connectDB, closeDB } = require('../../db/connection');

// Create test app
const app = express();
app.use(cors());
app.use(express.json());

// Auth routes
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

    // Check if user exists
    const existingUser = await User.findOne({
      $or: [{ nickname }, { email }]
    });

    if (existingUser) {
      return res.status(400).json({
        error: existingUser.nickname === nickname ? 'Nickname already taken' : 'Email already registered'
      });
    }

    // Create user
    const user = new User({ nickname, email, password, role: 'member' });
    await user.save();

    const token = jwt.sign(
      { id: user._id, nickname: user.nickname, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

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

    res.json({
      token,
      user: {
        id: user._id,
        nickname: user.nickname,
        role: user.role
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error during login' });
  }
});

// Channel routes
app.get('/channels', async (req, res) => {
  try {
    const channels = await Channel.find().sort({ position: 1, createdAt: 1 });
    res.json(channels);
  } catch (error) {
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

    res.status(201).json(channel);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create channel' });
  }
});

describe('Authentication Routes', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await closeDB();
  });

  describe('POST /register', () => {
    it('should register a new user successfully', async () => {
      const userData = {
        nickname: 'testuser',
        email: 'test@example.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/register')
        .send(userData)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.nickname).toBe(userData.nickname);
      expect(response.body.user.email).toBe(userData.email);
      expect(response.body.user.role).toBe('member');
    });

    it('should return 400 for invalid data', async () => {
      const invalidData = {
        nickname: 'ab', // too short
        email: 'invalid-email',
        password: '123' // too short
      };

      const response = await request(app)
        .post('/register')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should return 400 for duplicate nickname', async () => {
      const userData1 = {
        nickname: 'duplicateuser',
        email: 'duplicate1@example.com',
        password: 'password123'
      };

      const userData2 = {
        nickname: 'duplicateuser',
        email: 'duplicate2@example.com',
        password: 'password123'
      };

      // Create first user
      await request(app)
        .post('/register')
        .send(userData1)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/register')
        .send(userData2)
        .expect(400);

      expect(response.body.error).toBe('Nickname already taken');
    });
  });

  describe('POST /login', () => {
    beforeEach(async () => {
      // Create a test user
      const userData = {
        nickname: 'logintest',
        email: 'login@example.com',
        password: 'password123'
      };

      await request(app)
        .post('/register')
        .send(userData)
        .expect(201);
    });

    it('should login successfully with correct credentials', async () => {
      const loginData = {
        identifier: 'logintest',
        password: 'password123'
      };

      const response = await request(app)
        .post('/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.nickname).toBe('logintest');
    });

    it('should return 401 for invalid credentials', async () => {
      const loginData = {
        identifier: 'logintest',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error).toBe('Invalid credentials');
    });
  });
});

describe('Channel Routes', () => {
  beforeAll(async () => {
    await connectDB();
  });

  afterAll(async () => {
    await closeDB();
  });

  describe('GET /channels', () => {
    it('should return empty array when no channels exist', async () => {
      const response = await request(app)
        .get('/channels')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should return channels when they exist', async () => {
      // Create a test channel
      const channelData = {
        name: 'Test Channel',
        type: 'text'
      };

      await request(app)
        .post('/channels')
        .send(channelData)
        .expect(201);

      const response = await request(app)
        .get('/channels')
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);
      expect(response.body[0]).toHaveProperty('name', 'Test Channel');
      expect(response.body[0]).toHaveProperty('type', 'text');
    });
  });

  describe('POST /channels', () => {
    it('should create a channel successfully', async () => {
      const channelData = {
        name: 'New Test Channel',
        type: 'text',
        description: 'A test channel'
      };

      const response = await request(app)
        .post('/channels')
        .send(channelData)
        .expect(201);

      expect(response.body).toHaveProperty('id');
      expect(response.body).toHaveProperty('name', channelData.name);
      expect(response.body).toHaveProperty('type', channelData.type);
      expect(response.body).toHaveProperty('description', channelData.description);
    });

    it('should return 400 for invalid channel data', async () => {
      const invalidData = {
        name: '', // empty name
        type: 'invalid' // invalid type
      };

      const response = await request(app)
        .post('/channels')
        .send(invalidData)
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });

    it('should return 400 for duplicate channel name', async () => {
      const channelData = {
        name: 'Duplicate Channel',
        type: 'text'
      };

      // Create first channel
      await request(app)
        .post('/channels')
        .send(channelData)
        .expect(201);

      // Try to create duplicate
      const response = await request(app)
        .post('/channels')
        .send(channelData)
        .expect(400);

      expect(response.body.error).toBe('Channel already exists');
    });
  });
});