const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const { connectDB, closeDB } = require('../db/connection');
const { TestFixtures } = require('./shared/testFixtures');

let originalMongoUri;
let mongod;

beforeAll(async () => {
    // Enable garbage collection for performance optimization
    if (global.gc) {
      global.gc();
    }

    // Save original MongoDB URI
    originalMongoUri = process.env.MONGODB_URI;

    // Start in-memory MongoDB server for tests with compatible version
    mongod = await MongoMemoryServer.create({
      binary: {
        version: '6.0.9' // Compatible version for debian-x64
      }
    });
    const mongoUri = mongod.getUri();

    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = mongoUri;
    process.env.JWT_SECRET = 'your_super_secure_jwt_secret_key_here_replace_in_production';

    // Connect to in-memory test database
    await connectDB();

    // Setup reusable fixtures for faster test execution
    console.log('Setting up test fixtures...');
    await TestFixtures.setup();
});

afterAll(async () => {
     // console.log('Cleaning up test fixtures...'); // Disabled to avoid mocking issues
     await TestFixtures.cleanup();
     await closeDB();

     // Stop the in-memory MongoDB server
     if (mongod) {
       await mongod.stop();
     }

     // Restore original URI if needed
     process.env.MONGODB_URI = originalMongoUri;

     // Final garbage collection
     if (global.gc) {
       global.gc();
     }
 });

afterEach(async () => {
    // Clear all collections after each test
    if (mongoose.connection.readyState === 1) { // Connected
      const collections = mongoose.connection.collections;
      for (const key in collections) {
        await collections[key].deleteMany({});
      }
    }
 });

// Global test timeouts and stabilization
jest.setTimeout(30000);  // 30 second global timeout
process.env.NODE_TEST_TIMEOUT = 25000;  // Custom env for HTTP tests

// Increase socket timeout for database operations
mongoose.set('bufferCommands', false);  // Disable mongoose buffering
mongoose.set('maxTimeMS', 20000);      // 20 second limit for operations