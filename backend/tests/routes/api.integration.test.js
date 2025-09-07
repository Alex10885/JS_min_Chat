const request = require('supertest');
const mongoose = require('mongoose');
const { TestFixtures } = require('../shared/testFixtures');

// Import server module - we'll mock the startup process for tests
let app, server, closeDB;

beforeAll(async () => {
  // Dynamically import server components to avoid startup issues in test environment
  const serverModule = require('../../server');
  app = require('../../server.js'); // Get express app instance

  // Extract mongoose connection for cleanup
  const { closeDB: closeDBFn } = require('../../db/connection');
  closeDB = closeDBFn;
});

afterAll(async () => {
  // Clean up test database and close connections
  await mongoose.connection.dropDatabase();
  await closeDB();
  if (server) {
    server.close();
  }
});

describe('REST API Integration Tests', () => {
  describe('POST /api/register', () => {
    it('should successfully register a new user', async () => {
      const response = await request(app)
        .post('/api/register')
        .send({
          nickname: 'testuser123',
          email: 'test123@example.com',
          password: 'testpass123'
        })
        .expect(201);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user).toHaveProperty('nickname', 'testuser123');
      expect(response.body.user).toHaveProperty('email', 'test123@example.com');
      expect(response.body.user).toHaveProperty('role', 'member');
    });

    it('should return validation errors for invalid input', async () => {
      const response = await request(app)
        .post('/api/register')
        .send({
          nickname: 'a', // too short
          email: 'invalid-email',
          password: '123' // too short
        })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should prevent duplicate user registration', async () => {
      // Register first user
      await request(app)
        .post('/api/register')
        .send({
          nickname: 'duplicate_user',
          email: 'duplicate@example.com',
          password: 'testpass123'
        })
        .expect(201);

      // Try to register duplicate
      const response = await request(app)
        .post('/api/register')
        .send({
          nickname: 'different_nick',
          email: 'duplicate@example.com',
          password: 'testpass123'
        })
        .expect(409);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('POST /api/login', () => {
    let testUser, accessToken;

    beforeAll(async () => {
      // Register a test user first
      const regResponse = await request(app)
        .post('/api/register')
        .send({
          nickname: 'login_test_user',
          email: 'login_test@example.com',
          password: 'testpass123'
        })
        .expect(201);

      testUser = regResponse.body.user;
      accessToken = regResponse.body.token;
    });

    it('should successfully authenticate existing user by nickname', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: 'login_test_user',
          password: 'testpass123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
      expect(response.body.user.nickname).toBe('login_test_user');
    });

    it('should successfully authenticate existing user by email', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: 'login_test@example.com',
          password: 'testpass123'
        })
        .expect(200);

      expect(response.body).toHaveProperty('token');
      expect(response.body).toHaveProperty('user');
    });

    it('should reject invalid credentials', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: 'login_test_user',
          password: 'wrongpassword'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: 'nonexistent_user',
          password: 'password123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error', 'Invalid credentials');
    });
  });

  describe('GET /api/channels', () => {
    let accessToken;

    beforeAll(async () => {
      // Register and login to get token
      const regResponse = await request(app)
        .post('/api/register')
        .send({
          nickname: 'channel_test_user',
          email: 'channel_test@example.com',
          password: 'testpass123'
        })
        .expect(201);

      accessToken = regResponse.body.token;
    });

    it('should return channels list with valid JWT', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      response.body.forEach(channel => {
        expect(channel).toHaveProperty('id');
        expect(channel).toHaveProperty('name');
        expect(channel).toHaveProperty('type');
        expect(channel).toHaveProperty('createdBy');
      });
    });

    it('should include default channels (General, Voice Chat)', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const channelNames = response.body.map(ch => ch.name);
      expect(channelNames).toContain('General');
      expect(channelNames).toEqual(expect.arrayContaining(['General']));
    });

    it('should reject unauthorized request', async () => {
      const response = await request(app)
        .get('/api/channels')
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Access token required');
    });

    it('should reject request with invalid JWT', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', 'Bearer invalid.jwt.token')
        .expect(401);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/login')
        .set('Content-Type', 'application/json')
        .send('{ invalid json: "missing quotes" }')
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should handle requests with missing content-type', async () => {
      const response = await request(app)
        .post('/api/login')
        .send('nickname=test&password=test') // form data without proper content-type
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });

    it('should return 404 for non-existent endpoints', async () => {
      const response = await request(app)
        .get('/api/non-existent-endpoint')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Endpoint not found');
    });
  });

  describe('Security Headers and CORS', () => {
    it('should set proper security headers', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      // Check Content Security Policy
      expect(response.headers).toHaveProperty('content-security-policy');
      expect(response.headers['content-security-policy']).toMatch(/default-src 'self'/);

      // Check Helmet security headers
      expect(response.headers).toHaveProperty('x-content-type-options');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    });

    it('should handle CORS properly', async () => {
      const response = await request(app)
        .options('/api/channels')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(200);

      expect(response.headers).toHaveProperty('access-control-allow-origin');
      expect(response.headers).toHaveProperty('access-control-allow-methods');
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce auth rate limiting', async () => {
      const authRequests = [];
      for (let i = 0; i < 6; i++) {
        authRequests.push(
          request(app)
            .post('/api/login')
            .send({
              identifier: 'test',
              password: 'test'
            })
        );
      }

      const results = await Promise.all(authRequests);
      const limitedRequest = results.find(res => res.status === 429);

      expect(limitedRequest).toBeDefined();
      expect(limitedRequest.body).toHaveProperty('error');
    });
  });

  describe('Health Check Endpoint', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
      expect(typeof response.body.uptime).toBe('number');
    });
  });
});

// Export for external test runners
module.exports = { app };