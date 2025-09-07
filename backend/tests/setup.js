const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../db/connection');
const { TestFixtures } = require('./shared/testFixtures');

let originalMongoUri;

beforeAll(async () => {
   // Enable garbage collection for performance optimization
   if (global.gc) {
     global.gc();
   }

   // Save original MongoDB URI
   originalMongoUri = process.env.MONGODB_URI;

   // Use test database (assuming MongoDB is running locally)
   // In production CI/CD, you would set this to a test MongoDB instance
   process.env.NODE_ENV = 'test';
   process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_js_test';
   process.env.JWT_SECRET = 'your_super_secure_jwt_secret_key_here_replace_in_production';

   // Connect to test database
   await connectDB();

   // Setup reusable fixtures for faster test execution
   console.log('Setting up test fixtures...');
   await TestFixtures.setup();
});

afterAll(async () => {
    // console.log('Cleaning up test fixtures...'); // Disabled to avoid mocking issues
    await TestFixtures.cleanup();
    await closeDB();
    // Restore original URI if needed
    process.env.MONGODB_URI = originalMongoUri;

    // Final garbage collection
    if (global.gc) {
      global.gc();
    }
});

afterEach(async () => {
   // Clear all collections after each test
   const collections = mongoose.connection.collections;
   for (const key in collections) {
     await collections[key].deleteMany({});
   }
});

// Global test timeouts and stabilization
jest.setTimeout(30000);  // 30 second global timeout
process.env.NODE_TEST_TIMEOUT = 25000;  // Custom env for HTTP tests

// Increase socket timeout for database operations
mongoose.set('bufferCommands', false);  // Disable mongoose buffering
mongoose.set('maxTimeMS', 20000);      // 20 second limit for operations