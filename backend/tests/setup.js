const mongoose = require('mongoose');
const { connectDB, closeDB } = require('../db/connection');

let originalMongoUri;

beforeAll(async () => {
   // Save original MongoDB URI
   originalMongoUri = process.env.MONGODB_URI;

   // Use test database (assuming MongoDB is running locally)
   // In production CI/CD, you would set this to a test MongoDB instance
   process.env.NODE_ENV = 'test';
   process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_js_test';
   process.env.JWT_SECRET = 'your_super_secure_jwt_secret_key_here_replace_in_production';

   // Connect to test database
   await connectDB();
});

afterAll(async () => {
   await closeDB();
   // Restore original URI if needed
   process.env.MONGODB_URI = originalMongoUri;
});

afterEach(async () => {
   // Clear all collections after each test
   const collections = mongoose.connection.collections;
   for (const key in collections) {
     await collections[key].deleteMany({});
   }
});

afterEach(async () => {
  // Clear all collections after each test
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});