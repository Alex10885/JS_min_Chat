const mongoose = require('mongoose');
const { exec } = require('child_process');
const { connectDB, closeDB } = require('../db/connection');
const { TestFixtures } = require('./shared/testFixtures');


let originalMongoUri;
let mongodProcess;

beforeAll(async () => {
    // Enable garbage collection for performance optimization
    if (global.gc) {
      global.gc();
    }

    // Save original MongoDB URI
    originalMongoUri = process.env.MONGODB_URI;

    // Check if mongod is running
    const isMongodRunning = () => {
      return new Promise((resolve) => {
        exec('pgrep mongod', (error) => {
          resolve(!error);
        });
      });
    };

    // If mongod is not running, start it
    if (!(await isMongodRunning())) {
      console.log('Starting mongod...');
      mongodProcess = exec('mongod --port 27017 --dbpath /tmp/mongodb_test --logpath /tmp/mongod_test.log --fork', (error) => {
        if (error) {
          console.error('Failed to start mongod:', error);
          throw error;
        }
      });
      // Wait a bit for mongod to start
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      console.log('mongod is already running');
    }

    // Set test environment variables
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URI = 'mongodb://localhost:27017/chatjs_test';
    process.env.JWT_SECRET = 'your_super_secure_jwt_secret_key_here_replace_in_production';

    // Connect to local test database
    await connectDB();

    // Setup reusable fixtures for faster test execution
    console.log('Setting up test fixtures...');
    await TestFixtures.setup();
});

afterAll(async () => {
     // console.log('Cleaning up test fixtures...'); // Disabled to avoid mocking issues
     await TestFixtures.cleanup();
     await closeDB();

     // Stop mongod if we started it
     if (mongodProcess) {
       console.log('Stopping mongod...');
       exec('pkill -f mongod');
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