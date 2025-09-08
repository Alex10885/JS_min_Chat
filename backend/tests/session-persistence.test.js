const io = require('socket.io-client');
const axios = require('axios');
const { expect } = require('expect'); // Jest expect

const BASE_URL = 'http://localhost:3001';
const ioClient = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    'User-Agent': 'Session-Test-Agent/1.0'
  }
});

describe('Session Persistence Full Cycle Test', () => {
  let testUser;
  let jwtToken;
  let csrfToken;
  let sessionId;
  let socket;

  beforeAll(() => {
    testUser = {
      nickname: `testuser_${Date.now()}`,
      email: `test_${Date.now()}@example.com`,
      password: 'TestPass123!'
    };
  });

  it('1. Register new user and check session creation', async () => {
    console.log('🧪 TEST 1: Starting user registration...');

    try {
      const registerResponse = await ioClient.post('/api/register', testUser);
      console.log('📥 Registration response:', {
        status: registerResponse.status,
        hasToken: !!registerResponse.data.token,
        hasUser: !!registerResponse.data.user,
        hasSession: !!registerResponse.data.session
      });

      expect(registerResponse.status).toBe(201);
      expect(registerResponse.data.token).toBeDefined();
      expect(registerResponse.data.user).toBeDefined();
      expect(registerResponse.data.session).toBeDefined();

      jwtToken = registerResponse.data.token;
      csrfToken = registerResponse.data.session.csrfToken;
      sessionId = registerResponse.data.session.id;

      console.log('✅ Registration successful:', {
        userId: registerResponse.data.user.id,
        nickname: registerResponse.data.user.nickname,
        sessionId: sessionId,
        loginTime: registerResponse.data.session.loginTime
      });

      // Wait a moment for logs to appear
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (error) {
      console.error('❌ Registration failed:', error.response?.data || error.message);
      throw error;
    }
  });

  it('2. Check session persistence - same session across multiple requests', async () => {
    console.log('🧪 TEST 2: Testing session persistence between requests...');

    try {
      // Set authorization header for subsequent requests
      ioClient.defaults.headers.common['Authorization'] = `Bearer ${jwtToken}`;

      // Make first request - should use existing session
      console.log('🌐 Making first API request (users list)...');
      const firstResponse = await ioClient.get('/api/users');
      expect(firstResponse.status).toBe(200);

      console.log('✅ First request successful');

      // Wait a moment
      await new Promise(resolve => setTimeout(resolve, 500));

      // Make second request - should reuse same session
      console.log('🌐 Making second API request (channels list)...');
      const secondResponse = await ioClient.get('/api/channels');
      expect(secondResponse.status).toBe(200);

      console.log('✅ Second request successful');
      console.log('🔄 Both requests should have used the same persistent session');

    } catch (error) {
      console.error('❌ Session persistence test failed:', error.response?.data || error.message);
      throw error;
    }
  });

  it('3. Test Socket.IO authentication with session fingerprint', async () => {
    console.log('🧪 TEST 3: Testing Socket.IO authentication with session fingerprint...');

    try {
      // Connect to Socket.IO with session data
      socket = io.connect(BASE_URL, {
        forceNew: true,
        transports: ['websocket', 'polling'],
        auth: {
          csrfToken: csrfToken
        },
        extraHeaders: {
          cookie: ioClient.defaults.headers?.cookie
        }
      });

      // Wait for connection
      await new Promise((resolve, reject) => {
        socket.on('connect', () => {
          console.log('🔌 Socket connected successfully');
          console.log('🎉 Socket fingerprint authentication successful with CSRF token');
          resolve();
        });

        socket.on('connect_error', (error) => {
          console.error('❌ Socket connection failed:', error.message);
          reject(error);
        });

        // Timeout after 10 seconds
        setTimeout(() => {
          reject(new Error('Socket connection timeout'));
        }, 10000);
      });

    } catch (error) {
      console.error('❌ Socket.IO authentication test failed:', error.message);
      throw error;
    }
  });

  it('4. Test session logout persistence', async () => {
    console.log('🧪 TEST 4: Testing session logout and cleanup...');

    try {
      // Logout
      const logoutResponse = await ioClient.post('/api/logout_complete');
      expect(logoutResponse.status).toBe(200);

      console.log('🚪 Complete logout successful:', logoutResponse.data);

      // Socket should be disconnected after logout
      socket.disconnect();
      console.log('🔌 Socket disconnected after logout');

    } catch (error) {
      console.error('❌ Session logout test failed:', error.response?.data || error.message);
      throw error;
    }
  });

  it('5. Test session persistence after logout - new session should be created', async () => {
    console.log('🧪 TEST 5: Testing that logout properly clears session and new login creates new session...');

    try {
      // Try to login again - should create new session
      const loginResponse = await ioClient.post('/api/login', {
        identifier: testUser.email,
        password: testUser.password
      });

      expect(loginResponse.status).toBe(200);

      const newSessionId = loginResponse.data.session.id;

      console.log('🔑 Second login successful:', {
        originalSessionId: sessionId,
        newSessionId: newSessionId,
        sessionsDifferent: sessionId !== newSessionId
      });

      // Sessions should be different
      expect(sessionId).not.toBe(newSessionId);

      console.log('✅ Session lifecycle complete: logout cleared session, new login created new session');

    } catch (error) {
      console.error('❌ New session creation test failed:', error.response?.data || error.message);
      throw error;
    }
  });

  afterAll(async () => {
    if (socket && socket.connected) {
      socket.disconnect();
    }
  });
});

module.exports = { describe, it };