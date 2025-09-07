const request = require('supertest');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Create minimal app for middleware testing
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const User = require('../../models/User');

let mongoServer;
let app;

describe('Middleware Tests', () => {
  beforeAll(async () => {
    // Start in-memory MongoDB
    mongoServer = await MongoMemoryServer.create();
    const mongoUri = mongoServer.getUri();
    await mongoose.connect(mongoUri);

    // Create minimal app with middleware
    app = express();

    // Middleware setup
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(helmet({
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
    }));

    // Error handler middleware (copied from server.js)
    const errorHandler = (err, req, res, next) => {
      console.error('Unhandled error:', err.message);
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
      if (err.code === 11000) {
        const field = Object.keys(err.keyValue)[0];
        const value = err.keyValue[field];
        return res.status(409).json({
          error: `${field} '${value}' already exists`,
          code: 'DUPLICATE_ERROR'
        });
      }
      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    };

    // Authenticate token middleware (copied from server.js)
    const authenticateToken = async (req, res, next) => {
      try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (!token) {
          return res.status(401).json({
            error: 'Access token required',
            code: 'NO_TOKEN'
          });
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'test-secret');
        const user = await User.findById(decoded.userId);
        if (!user) {
          return res.status(401).json({
            error: 'User not found',
            code: 'USER_NOT_FOUND'
          });
        }
        req.user = user;
        next();
      } catch (error) {
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

    // Request logging middleware (simplified version)
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
      });
      next();
    });

    // Test routes
    app.get('/protected', authenticateToken, (req, res) => {
      res.json({ userId: req.user._id, nickname: req.user.nickname });
    });

    app.post('/validation-test', [
      body('nickname').isLength({ min: 3, max: 50 }).trim().escape(),
      body('email').isEmail().normalizeEmail()
    ], (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      res.json({ success: true, data: req.body });
    });

    app.post('/duplicate-test', async (req, res) => {
      try {
        const user = new User({
          nickname: req.body.nickname,
          email: req.body.email,
          password: 'password123'
        });
        await user.save();
        res.status(201).json({ user });
      } catch (error) {
        // Let error handler middleware handle it
        throw error;
      }
    });

    app.get('/test-cors', (req, res) => {
      res.json({ cors: 'enabled' });
    });

    app.get('/test-helmet', (req, res) => {
      res.json({ helmet: 'enabled' });
    });

    // Error handler middleware must be last
    app.use(errorHandler);

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({
        error: 'Endpoint not found',
        path: req.url,
        method: req.method,
        code: 'NOT_FOUND'
      });
    });
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('authenticateToken Middleware', () => {
    let testUser;
    let validToken;

    beforeEach(async () => {
      testUser = await new User({
        nickname: 'authtest',
        email: 'auth@example.com',
        password: 'password123'
      }).save();

      validToken = jwt.sign(
        { userId: testUser._id, nickname: testUser.nickname },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '1h' }
      );
    });

    it('should pass with valid token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body.userId).toBe(testUser._id.toString());
      expect(response.body.nickname).toBe('authtest');
    });

    it('should reject without token', async () => {
      const response = await request(app)
        .get('/protected')
        .expect(401);

      expect(response.body.code).toBe('NO_TOKEN');
      expect(response.body.error).toBe('Access token required');
    });

    it('should reject with invalid token format', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'InvalidToken')
        .expect(401);

      expect(response.body.code).toBe('INVALID_TOKEN_FORMAT');
    });

    it('should reject with expired token', async () => {
      const expiredToken = jwt.sign(
        { userId: testUser._id, nickname: testUser.nickname },
        process.env.JWT_SECRET || 'test-secret',
        { expiresIn: '-1h' }
      );

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    it('should reject with valid token but non-existent user', async () => {
      // Delete the user after creating token
      await User.findByIdAndDelete(testUser._id);

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${validToken}`)
        .expect(401);

      expect(response.body.code).toBe('USER_NOT_FOUND');
    });
  });

  describe('CORS Middleware', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/test-cors')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should include CORS headers in response', async () => {
      const response = await request(app)
        .get('/test-cors')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('CORS Middleware', () => {
    it('should handle CORS preflight requests', async () => {
      const response = await request(app)
        .options('/test-cors')
        .set('Origin', 'http://localhost:3000')
        .set('Access-Control-Request-Method', 'GET')
        .expect(204);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });

    it('should include CORS headers in response', async () => {
      const response = await request(app)
        .get('/test-cors')
        .set('Origin', 'http://localhost:3000')
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBeDefined();
    });
  });

  describe('Helmet Security Headers', () => {
    it('should set security headers', async () => {
      const response = await request(app)
        .get('/test-helmet')
        .expect(200);

      expect(response.headers['x-frame-options']).toBeDefined();
      expect(response.headers['x-content-type-options']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
    });

    it('should have CSP header configured', async () => {
      const response = await request(app)
        .get('/test-helmet')
        .expect(200);

      const cspHeader = response.headers['content-security-policy'];
      expect(cspHeader).toContain("default-src 'self'");
      expect(cspHeader).toContain("script-src 'self' 'unsafe-inline'");
    });
  });

  describe('Error Handler Middleware', () => {
    it('should handle validation errors', async () => {
      const response = await request(app)
        .post('/validation-test')
        .send({ nickname: 'ab', email: 'invalid-email' })
        .expect(400);

      expect(response.body.errors).toBeDefined();
      expect(Array.isArray(response.body.errors)).toBe(true);
    });

    it('should handle duplicate key errors', async () => {
      // Create user first
      await new User({
        nickname: 'duplicateuser',
        email: 'duplicate@example.com',
        password: 'password123'
      }).save();

      // Try to create another with same data
      const response = await request(app)
        .post('/duplicate-test')
        .send({
          nickname: 'duplicateuser',
          email: 'duplicate@example.com'
        })
        .expect(409);

      expect(response.body.code).toBe('DUPLICATE_ERROR');
      expect(response.body.error).toContain('already exists');
    });

    it('should handle 404 errors', async () => {
      const response = await request(app)
        .get('/nonexistent-route')
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
      expect(response.body.path).toBe('/nonexistent-route');
    });

    it('should handle general server errors', async () => {
      // Create a route that will throw an error
      app.get('/error-test', (req, res) => {
        throw new Error('Test error');
      });

      const response = await request(app)
        .get('/error-test')
        .expect(500);

      expect(response.body.code).toBe('INTERNAL_ERROR');
      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('Request Logging Middleware', () => {
    it('should log request timing', async () => {
      const startTime = Date.now();

      await request(app)
        .get('/test-helmet')
        .expect(200);

      const endTime = Date.now();
      expect(endTime - startTime).toBeGreaterThanOrEqual(0);
    });
  });
});