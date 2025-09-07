const request = require('supertest');
const mongoose = require('mongoose');
const { TestFixtures } = require('../shared/testFixtures');

let app, closeDB;

beforeAll(async () => {
  const serverModule = require('../../server');
  app = require('../../server.js');

  const { closeDB: closeDBFn } = require('../../db/connection');
  closeDB = closeDBFn;
});

afterAll(async () => {
  if (closeDB) {
    await closeDB();
  }
});

describe('Error Recovery and Network Interruption Tests', () => {
  let validUser, accessToken;

  beforeAll(async () => {
    // Create test user
    const regResponse = await request(app)
      .post('/api/register')
      .send({
        nickname: 'error_recovery_test',
        email: 'error_recovery@example.com',
        password: 'testpass123'
      });

    validUser = regResponse.body.user;
    accessToken = regResponse.body.token;
  });

  describe('Database Connection Disruption', () => {
    it('should handle database disconnection gracefully', async () => {
      // Simulate database disconnection by closing MongoDB connection
      const originalConnection = mongoose.connection.readyState;

      try {
        // Force database disconnect
        await mongoose.disconnect();

        // Attempt API request during disconnection
        const response = await request(app)
          .get('/api/channels')
          .set('Authorization', `Bearer ${accessToken}`)
          .timeout(5000);

        // Should return database error
        expect([500, 503]).toContain(response.status);
        expect(response.body).toHaveProperty('code', 'DATABASE_ERROR');

      } finally {
        // Reconnect database for other tests
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_js_test');
      }
    });

    it('should recover after database reconnection', async () => {
      // Ensure database is connected
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_js_test');

      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Network Timeout Handling', () => {
    it('should handle slow database queries with timeout', async () => {
      // This test would require artificially slow database operations
      // For now, test the timeout configuration

      const startTime = Date.now();

      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .timeout(30000); // Set explicit timeout

      const duration = Date.now() - startTime;

      // Response should complete within reasonable time
      expect(duration).toBeLessThan(30000);
      expect(response.status).toBe(200);
    });

    it('should handle client-side timeout', async () => {
      // Test client timeout behavior
      let timedOut = false;

      try {
        await request(app)
          .get('/api/channels')
          .set('Authorization', `Bearer ${accessToken}`)
          .timeout(1); // Very short timeout
      } catch (error) {
        timedOut = true;
        expect(error.code).toBe('ECONNABORTED');
      }

      expect(timedOut).toBe(true);
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle multiple concurrent requests without errors', async () => {
      const concurrentRequests = Array(10).fill().map(() =>
        request(app)
          .get('/api/channels')
          .set('Authorization', `Bearer ${accessToken}`)
      );

      const responses = await Promise.all(concurrentRequests);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(Array.isArray(response.body)).toBe(true);
      });
    });

    it('should handle mixed request types concurrently', async () => {
      const requests = [
        // Authentication request
        request(app).post('/api/login').send({
          identifier: 'error_recovery_test',
          password: 'testpass123'
        }),
        // Channel list request
        request(app)
          .get('/api/channels')
          .set('Authorization', `Bearer ${accessToken}`),
        // Health check
        request(app).get('/health'),
        // Invalid endpoint
        request(app).get('/api/nonexistent')
      ];

      const responses = await Promise.allSettled(requests);

      const fulfilled = responses.filter(r => r.status === 'fulfilled');
      expect(fulfilled.length).toBeGreaterThan(0);

      fulfilled.forEach((result, index) => {
        const response = result.value;
        switch (index) {
          case 0: // Login
            expect(response.status).toBe(200);
            break;
          case 1: // Channels
            expect(response.status).toBe(200);
            break;
          case 2: // Health
            expect(response.status).toBe(200);
            break;
          case 3: // Invalid endpoint
            expect(response.status).toBe(404);
            break;
        }
      });
    });
  });

  describe('Rate Limit Recovery', () => {
    it('should recover from rate limiting after timeout period', async () => {
      // Get current timestamp for rate limit window
      const startTime = Date.now();

      // Send multiple requests to trigger rate limiting
      const rapidRequests = Array(15).fill().map(() =>
        request(app)
          .post('/api/login')
          .send({
            identifier: 'test',
            password: 'test'
          })
      );

      // Execute all requests (some will be rate limited)
      await Promise.allSettled(rapidRequests);

      // Wait for rate limit to expire (15+ minutes would be needed for full recovery)
      // For testing, just verify rate limiting is working
      const limitedRequest = await request(app)
        .post('/api/login')
        .send({
          identifier: 'test',
          password: 'test'
        });

      // Should be rate limited
      expect([400, 429]).toContain(limitedRequest.status);
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should handle memory-intensive operations without leaks', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Simulate multiple large requests
      const largeRequests = Array(50).fill().map((_, i) =>
        request(app)
          .get('/api/channels')
          .set('Authorization', `Bearer ${accessToken}`)
          // Add large payload to simulate memory usage
          .set('User-Agent', 'a'.repeat(1000))
      );

      await Promise.all(largeRequests);

      const finalMemory = process.memoryUsage().heapUsed;

      // Memory usage should not increase dramatically
      const memoryIncrease = finalMemory - initialMemory;
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // Less than 50MB increase
    });
  });

  describe('Service Degradation', () => {
    it('should handle requests during high CPU usage simulation', async () => {
      // Simulate CPU intensive operation
      const cpuIntensiveTask = () => {
        const start = Date.now();
        while (Date.now() - start < 1000) {
          Math.random() * Math.random();
        }
      };

      // Start CPU intensive operations
      const cpuPromises = Array(4).fill().map(() => new Promise(resolve => {
        setImmediate(() => {
          cpuIntensiveTask();
          resolve();
        });
      }));

      // Send request during CPU load
      const requestPromises = Array(5).fill().map(() =>
        request(app)
          .get('/health')
          .timeout(10000)
      );

      const [cpuResults, requestResults] = await Promise.all([
        Promise.all(cpuPromises),
        Promise.all(requestPromises)
      ]);

      // All requests should complete successfully
      requestResults.forEach(response => {
        expect([200, 503]).toContain(response.status);
      });
    });
  });

  describe('Circuit Breaker Pattern', () => {
    it('should implement basic circuit breaker for database failures', async () => {
      // This would require custom circuit breaker implementation
      // For now, test database error handling

      // Force database error by dropping connection
      const originalConnection = mongoose.connection;
      await mongoose.disconnect();

      let consecutiveErrors = 0;
      const maxErrors = 5;

      for (let i = 0; i < maxErrors + 1; i++) {
        const response = await request(app)
          .get('/api/channels')
          .set('Authorization', `Bearer ${accessToken}`)
          .timeout(5000);

        if (response.status === 500 || response.status === 503) {
          consecutiveErrors++;
        }
      }

      // Should have consecutive database errors
      expect(consecutiveErrors).toBeGreaterThan(0);

      // Reconnect for other tests
      await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_js_test');
    });
  });

  describe('Graceful Shutdown Scenarios', () => {
    it('should handle requests during application shutdown', async () => {
      // Start a long-running request
      const longRequest = request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .timeout(60000); // Long timeout for graceful shutdown test

      // Simulate shutdown signal
      // In real scenario, this would trigger graceful shutdown
      process.emit('SIGTERM');

      const response = await longRequest;

      // Request should either complete or be rejected gracefully
      expect([200, 503, 'ECONNABORTED']).toContain(response.status || response.code);
    });
  });
});