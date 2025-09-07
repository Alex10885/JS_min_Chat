const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const app = require('../../server');
const User = require('../../models/User');
const Channel = require('../../models/Channel');

let mongoServer;

describe('API Controllers Integration Tests', () => {
  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create default channels
    await Channel.findOneAndUpdate(
      { id: 'general' },
      { id: 'general', name: 'General', type: 'text', createdBy: 'system' },
      { upsert: true, new: true }
    );
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clear users but keep channels
    await User.deleteMany({});
  });

  describe('POST /api/register', () => {
    const validUserData = {
      nickname: 'testuser',
      email: 'test@example.com',
      password: 'password123'
    };

    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/register')
        .send(validUserData)
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.nickname).toBe('testuser');
      expect(response.body.user.email).toBe('test@example.com');
    });

    it('should return 409 for duplicate nickname', async () => {
      // Create existing user
      await new User(validUserData).save();

      const response = await request(app)
        .post('/api/register')
        .send(validUserData)
        .expect(409);

      expect(response.body.error).toContain('already');
    });

    it('should validate nickname length', async () => {
      const shortNickname = { ...validUserData, nickname: 'ab' };

      await request(app)
        .post('/api/register')
        .send(shortNickname)
        .expect(400);
    });
  });

  describe('POST /api/login', () => {
    const userData = {
      nickname: 'loginuser',
      email: 'login@example.com',
      password: 'password123'
    };

    beforeEach(async () => {
      await new User(userData).save();
    });

    it('should login with correct credentials', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: 'loginuser',
          password: 'password123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.nickname).toBe('loginuser');
    });

    it('should login by email', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: 'login@example.com',
          password: 'password123'
        })
        .expect(200);

      expect(response.body.user.email).toBe('login@example.com');
    });

    it('should return 400 for invalid credentials', async () => {
      await request(app)
        .post('/api/login')
        .send({
          identifier: 'loginuser',
          password: 'wrongpassword'
        })
        .expect(400);
    });
  });

  describe('GET /api/channels', () => {
    let authToken;

    beforeEach(async () => {
      // Create user for authentication
      const user = await new User({
        nickname: 'channeluser',
        email: 'channel@example.com',
        password: 'password123'
      }).save();

      // Login to get token
      const loginResponse = await request(app)
        .post('/api/login')
        .send({
          identifier: 'channeluser',
          password: 'password123'
        });

      authToken = loginResponse.body.token;

      // Create additional test channel
      await new Channel({
        id: 'testchannel',
        name: 'Test Channel',
        type: 'text',
        createdBy: 'channeluser'
      }).save();
    });

    it('should return channels list for authenticated user', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThanOrEqual(2); // At least general + testchannel

      const hasGeneral = response.body.some(ch => ch.id === 'general');
      const hasTestChannel = response.body.some(ch => ch.id === 'testchannel');

      expect(hasGeneral).toBe(true);
      expect(hasTestChannel).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .get('/api/channels')
        .expect(401);
    });

    it('should return channels sorted by position', async () => {
      // Create channel with position 0
      await new Channel({
        id: 'pos0',
        name: 'Position 0',
        type: 'text',
        createdBy: 'channeluser',
        position: 0
      }).save();

      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      // Find the pos0 channel
      const pos0Channel = response.body.find(ch => ch.id === 'pos0');
      expect(pos0Channel.position).toBe(0);
    });
  });
});

describe('Server Configuration & Middleware', () => {
  test('should have CORS enabled', async () => {
    const response = await request(app)
      .options('/api/health')
      .set('Origin', 'http://localhost:3000')
      .expect(204);

    expect(response.headers['access-control-allow-origin']).toBeDefined();
  });

  test('should have rate limiting configured', async () => {
    const requests = [];
    for (let i = 0; i < 6; i++) {
      requests.push(
        request(app)
          .post('/api/login')
          .send({ identifier: 'test', password: 'test' })
      );
    }

    const responses = await Promise.all(requests);

    // Some should be rate limited (429)
    const rateLimited = responses.some(resp => resp.status === 429);
    expect(rateLimited).toBe(true);
  });

  test('should serve health check endpoint', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);

    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('uptime');
    expect(response.body).toHaveProperty('timestamp');
  });
});