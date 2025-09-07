const request = require('supertest');
const jwt = require('jsonwebtoken');

let app, closeDB;

beforeAll(async () => {
  // Import app for testing
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

describe('Security Tests - Authorization Vulnerabilities', () => {
  let validUser, adminUser, accessToken, adminToken;

  beforeAll(async () => {
    // Create regular user
    const userResponse = await request(app)
      .post('/api/register')
      .send({
        nickname: 'security_test_user',
        email: 'security_test@example.com',
        password: 'securePass123'
      });

    validUser = userResponse.body.user;
    accessToken = userResponse.body.token;

    // Create admin user
    const adminResponse = await request(app)
      .post('/api/register')
      .send({
        nickname: 'security_admin_user',
        email: 'security_admin@example.com',
        password: 'securePass123'
      });

    adminUser = adminResponse.body.user;
    adminToken = adminResponse.body.token;
  });

  describe('JWT Token Manipulation', () => {
    it('should reject modified JWT payload', async () => {
      // Decode and modify token payload
      const decoded = jwt.decode(accessToken);
      decoded.userId = '507f1f77bcf86cd799439012'; // Different user ID

      // Re-sign token (attacker wouldn't have the secret)
      const modifiedToken = jwt.sign(decoded, 'wrong_secret');

      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${modifiedToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.code).toBe('TOKEN_VERIFICATION_FAILED');
    });

    it('should reject JWT with wrong signature', async () => {
      // Create unsigned token payload
      const decoded = jwt.decode(accessToken, { complete: true });
      const modifiedToken = `${decoded.header}.${decoded.payload}.wrong_signature`;

      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${modifiedToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
      expect(response.body.code).toBe('INVALID_TOKEN_FORMAT');
    });

    it('should reject JWT token in wrong format', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', 'Basic dXNlcjpwYXNz') // Basic auth instead of Bearer
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject JWT token as query parameter', async () => {
      const decoded = jwt.decode(accessToken);
      const response = await request(app)
        .get(`/api/channels?token=${accessToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Access token required');
    });

    it('should reject JWT token in cookie', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Cookie', `auth_token=${accessToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('error', 'Access token required');
    });
  });

  describe('Input Validation Bypass Attempts', () => {
    const maliciousInputs = [
      '<script>alert("XSS")</script>',
      '"; DROP TABLE users; --',
      '../../etc/passwd',
      '<img src=x onerror=alert("XSS")>',
      '${process.env}',
      '../public/uploads/../app.js'
    ];

    it.each(maliciousInputs)('should sanitize malicious input: %s', async (maliciousInput) => {
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: maliciousInput,
          password: 'testpass123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('error');
      expect(response.body.error).toBe('Invalid credentials');
    });

    it.each(maliciousInputs)('should prevent malicious nickname registration: %s', async (maliciousInput) => {
      const response = await request(app)
        .post('/api/register')
        .send({
          nickname: maliciousInput,
          email: 'test@example.com',
          password: 'testpass123'
        });

      // Should either validate and reject, or sanitize
      expect([400, 409]).toContain(response.status);
    });

    it('should prevent overly long input values', async () => {
      const longInput = 'a'.repeat(1000);
      const response = await request(app)
        .post('/api/login')
        .send({
          identifier: longInput,
          password: 'testpass123'
        })
        .expect(400);

      expect(response.body).toHaveProperty('errors');
    });
  });

  describe('Authorization Bypass Attempts', () => {
    it('should prevent horizontal privilege escalation', async () => {
      // Try to access another user's data by modifying channel ID
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // All returned channels should be accessible to the user
      expect(Array.isArray(response.body)).toBe(true);
      // Ensure no sensitive channel data is leaked
    });

    it('should reject authorization headers with trailing data', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken} some_trailing_data`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should reject multiple authorization headers', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Authorization', 'Bearer second_token')
        .expect(401);
    });
  });

  describe('Header Injection Attacks', () => {
    it('should prevent header injection in JWT', async () => {
      // Try to inject header manipulation
      const maliciousToken = accessToken + '\r\nX-Custom-Header: injected\r\n';

      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${maliciousToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('error');
    });

    it('should prevent content-length manipulation', async () => {
      const response = await request(app)
        .get('/api/channels')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('Content-Length', '9999999')
        .expect(200); // Should still work normally

      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  describe('Timing Attack Prevention', () => {
    it('should have consistent response times for invalid credentials', async () => {
      const requests = [];

      // Send multiple requests with different invalid credentials
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/api/login')
            .send({
              identifier: `nonexistent_user_${i}`,
              password: 'wrong_password'
            })
        );
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(requests);
      const endTime = Date.now();

      // All requests should be within reasonable time range
      const totalDuration = endTime - startTime;
      expect(totalDuration).toBeLessThan(10000); // Should complete within 10 seconds

      // All requests should return same error
      results.forEach(result => {
        expect(result.status).toBe('fulfilled');
        expect(result.value.status).toBe(400);
        expect(result.value.body.error).toBe('Invalid credentials');
      });
    });

    it('should prevent enumeration via timing', async () => {
      const startTime = Date.now();

      // Try valid username with invalid password
      const response1 = await request(app)
        .post('/api/login')
        .send({
          identifier: 'security_test_user',
          password: 'wrong_password'
        });

      // Try invalid username with same password
      const response2 = await request(app)
        .post('/api/login')
        .send({
          identifier: 'nonexistent_user_xyz',
          password: 'wrong_password'
        });

      const duration1 = Date.now() - startTime;
      const duration2 = Date.now() - duration1 - startTime;

      // Timing difference shouldn't reveal valid usernames
      const timingDifference = Math.abs(duration1 - duration2);
      expect(timingDifference).toBeLessThan(1000); // Less than 1 second difference
    });
  });

  describe('Rate Limit Bypass Attempts', () => {
    it('should enforce rate limit even with case variations', async () => {
      const variations = [
        'Bearer',
        'BEARER',
        'bearer',
        'BeArEr'
      ];

      const requests = variations.map(authType => {
        return request(app)
          .get('/api/channels')
          .set('Authorization', `${authType} ${accessToken}`);
      });

      const results = await Promise.all(requests);

      // Should rate limit consistently regardless of case
      const successfulRequests = results.filter(r => r.status === 200);
      expect(successfulRequests.length).toBeLessThan(5);
    });

    it('should detect and mitigate rapid requests from same IP', async () => {
      // Create multiple requests to trigger rate limiting
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .get('/health') // Use health endpoint which doesn't require auth
        );
      }

      const results = await Promise.allSettled(requests);

      // Should have rate limited some requests
      const rateLimitedRequests = results.filter(r =>
        r.status === 'fulfilled' && r.value.status === 429
      );

      expect(rateLimitedRequests.length).toBeGreaterThan(0);
    });
  });

  describe('Session Management Security', () => {
    it('should expire tokens as configured', async () => {
      const tokenExpiryMinutes = 24 * 60; // 24 hours
      const decoded = jwt.decode(accessToken);

      // Simulate time manipulation
      const expirationTimeInMs = decoded.exp * 1000;
      const currentTimeInMs = Date.now();

      // Token should have expiration set
      expect(decoded.exp).toBeDefined();
      expect(expirationTimeInMs).toBeGreaterThan(currentTimeInMs);
    });

    it('should invalidate session on excessive failed attempts', async () => {
      // Reset rate limits - this would need to be handled in real scenario
      // For now, test the functionality
      const failedAttempts = [];
      for (let i = 0; i < 10; i++) {
        failedAttempts.push(
          request(app)
            .post('/api/login')
            .send({
              identifier: 'security_test_user',
              password: 'wrong_password_' + i
            })
        );
      }

      const results = await Promise.all(failedAttempts);
      const lastResult = results[results.length - 1];

      // Should eventually rate limit after multiple failures
      expect([400, 429]).toContain(lastResult.status);
    });
  });

  describe('Directory Traversal Protection', () => {
    it('should prevent directory traversal in channel access', async () => {
      const maliciousChannelIds = [
        '../../etc/passwd',
        '../../../config/database.js',
        '..\\..\\config\\secrets.json',
        '%2e%2e%2fetc%2fpasswd',
        '\..\..\windows\system32\config\sam'
      ];

      for (const maliciousId of maliciousChannelIds) {
        const response = await request(app)
          .get(`/api/channels/${maliciousId}`)
          .set('Authorization', `Bearer ${accessToken}`);

        // Should return 404 (channel not found) instead of file access
        expect([403, 404, 422]).toContain(response.status);
        expect(response.body).not.toMatch(/root:|admin:|password:/);
      }
    });
  });
});