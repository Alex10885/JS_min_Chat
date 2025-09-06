const mongoose = require('mongoose');

let originalMongoUri;

beforeAll(async () => {
  // Save original MongoDB URI
  originalMongoUri = process.env.MONGODB_URI;

  // Use test database (assuming MongoDB is running locally)
  // In production CI/CD, you would set this to a test MongoDB instance
  process.env.NODE_ENV = 'test';
  process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_js_test';
  process.env.JWT_SECRET = 'test-jwt-secret';

  // Connect to test database
  await mongoose.connect(process.env.MONGODB_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
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