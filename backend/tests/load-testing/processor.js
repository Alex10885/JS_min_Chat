// Load testing custom processor for Artillery
// This file contains custom functions and logic for load testing scenarios

class ArtilleryProcessor {

  constructor() {
    this.sessionData = new Map();
    this.testUsers = [];
  }

  // Initialize test data before test starts
  async init() {
    console.log('Initializing Artillery load test processor...');

    // Generate test users for load testing
    for (let i = 1; i <= 100; i++) {
      this.testUsers.push({
        nickname: `load_test_user_${i}`,
        email: `load_test_${i}@example.com`,
        password: 'loadPass123',
        token: null
      });
    }

    console.log(`Generated ${this.testUsers.length} test users`);
  }

  // Clean up after test completes
  async cleanup() {
    console.log('Cleaning up Artillery load test processor...');
    this.sessionData.clear();
    this.testUsers = [];
  }

  // Custom function to get a random user
  getRandomUser(context, events, done) {
    const user = this.testUsers[Math.floor(Math.random() * this.testUsers.length)];
    context.vars.randomUser = user;
    return done();
  }

  // Generate unique nickname for registration
  generateUniqueNickname(context, events, done) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    context.vars.uniqueNickname = `load_user_${timestamp}_${random}`;
    return done();
  }

  // Generate unique email for registration
  generateUniqueEmail(context, events, done) {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 10000);
    context.vars.uniqueEmail = `load_test_${timestamp}_${random}@example.com`;
    return done();
  }

  // Store user session data
  storeUserToken(context, events, done) {
    const token = context.vars.token;
    const nickname = context.vars.randomUser?.nickname || context.vars.uniqueNickname;

    if (token && nickname) {
      this.sessionData.set(nickname, { token, timestamp: Date.now() });
      console.log(`Stored token for user: ${nickname}`);
    }

    return done();
  }

  // Get stored user token
  getStoredToken(context, events, done) {
    const nickname = context.vars.userNickname || context.vars.uniqueNickname;
    const sessionData = this.sessionData.get(nickname);

    if (sessionData && (Date.now() - sessionData.timestamp) < 3600000) { // 1 hour expiry
      context.vars.storedToken = sessionData.token;
    }

    return done();
  }

  // Simulate user typing/thinking time
  thinkingTime(context, events, done) {
    // Random delay between 1-5 seconds to simulate user behavior
    const delay = Math.floor(Math.random() * 4000) + 1000;
    setTimeout(() => {
      return done();
    }, delay);
  }

  // Log request details for debugging
  logRequest(context, events, done) {
    const { request } = context;
    console.log(`[LOAD_TEST] ${request.method} ${request.url} - Status: ${context.response?.statusCode}`);

    return done();
  }

  // Validate response times
  checkResponseTime(context, events, done) {
    const responseTime = context.response?.timings?.duration || 0;
    const maxAcceptableTime = 5000; // 5 seconds

    if (responseTime > maxAcceptableTime) {
      console.warn(`[PERF_WARNING] Slow response: ${responseTime}ms for ${context.request.url}`);
    }

    context.vars.responseTime = responseTime;
    return done();
  }

  // Check for memory leaks or excessive resource usage
  checkMemoryUsage(context, events, done) {
    const usage = process.memoryUsage();
    const mb = 1024 * 1024;

    if (usage.heapUsed > 500 * mb) {
      console.warn(`[MEMORY_WARNING] High memory usage: ${Math.round(usage.heapUsed / mb)} MB`);
    }

    return done();
  }

  // Simulate browser user agent for more realistic testing
  setUserAgent(context, events, done) {
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    ];

    context.request.headers['User-Agent'] = userAgents[Math.floor(Math.random() * userAgents.length)];
    return done();
  }

  // Simulate authentication failures for security testing
  simulateAuthFailure(context, events, done) {
    const failureTypes = [
      { identifier: 'wrong_user', password: 'testpass123' },
      { identifier: 'test_user', password: 'wrong_password' },
      { identifier: 'admin', password: 'admin123' },
      { identifier: 'guest', password: 'guest' },
      { identifier: 'user@domain.com', password: 'password' }
    ];

    context.vars.authFailureData = failureTypes[Math.floor(Math.random() * failureTypes.length)];
    return done();
  }

  // Count rate limited requests
  countRateLimits(context, events, done) {
    if (context.response?.statusCode === 429) {
      this.rateLimitCount = (this.rateLimitCount || 0) + 1;
      console.log(`[RATE_LIMIT] Request ${this.rateLimitCount} was rate limited`);
    }

    return done();
  }

  // Generate realistic session behavior patterns
  simulateUserBehavior(context, events, done) {
    // Simulate different user behavioral patterns
    const behaviors = ['intensive', 'moderate', 'light'];

    const behaviorType = behaviors[Math.floor(Math.random() * behaviors.length)];

    switch (behaviorType) {
      case 'intensive':
        // Frequent requests, short delays
        context.vars.requestDelay = Math.floor(Math.random() * 500) + 100; // 100-600ms
        context.vars.requestCount = Math.floor(Math.random() * 5) + 5; // 5-10 requests
        break;

      case 'moderate':
        // Moderate requests, medium delays
        context.vars.requestDelay = Math.floor(Math.random() * 3000) + 1000; // 1-4 seconds
        context.vars.requestCount = Math.floor(Math.random() * 3) + 2; // 2-5 requests
        break;

      case 'light':
        // Few requests, long delays
        context.vars.requestDelay = Math.floor(Math.random() * 10000) + 5000; // 5-15 seconds
        context.vars.requestCount = Math.floor(Math.random() * 2) + 1; // 1-3 requests
        break;
    }

    return done();
  }
}

// Export for Artillery
const processor = new ArtilleryProcessor();

module.exports = {
  init: processor.init.bind(processor),
  cleanup: processor.cleanup.bind(processor),

  // Function mappings for Artillery
  getRandomUser: processor.getRandomUser.bind(processor),
  generateUniqueNickname: processor.generateUniqueNickname.bind(processor),
  generateUniqueEmail: processor.generateUniqueEmail.bind(processor),
  storeUserToken: processor.storeUserToken.bind(processor),
  getStoredToken: processor.getStoredToken.bind(processor),
  thinkingTime: processor.thinkingTime.bind(processor),
  logRequest: processor.logRequest.bind(processor),
  checkResponseTime: processor.checkResponseTime.bind(processor),
  checkMemoryUsage: processor.checkMemoryUsage.bind(processor),
  setUserAgent: processor.setUserAgent.bind(processor),
  simulateAuthFailure: processor.simulateAuthFailure.bind(processor),
  countRateLimits: processor.countRateLimits.bind(processor),
  simulateUserBehavior: processor.simulateUserBehavior.bind(processor)
};