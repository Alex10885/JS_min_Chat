// Shared test helpers for backend testing

const request = require('supertest');
const jwt = require('jsonwebtoken');
const User = require('../../models/User');
const Channel = require('../../models/Channel');

// User test helpers
class UserTestHelper {
  constructor() {
    this.createdUsers = [];
  }

  async createUser(userData = {}) {
    const defaultData = {
      nickname: `testuser_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      email: `test${Date.now()}@example.com`,
      password: 'password123'
    };

    const finalData = { ...defaultData, ...userData };
    const user = new User(finalData);

    try {
      await user.save();
      this.createdUsers.push(user);
      return user;
    } catch (error) {
      throw new Error(`Failed to create test user: ${error.message}`);
    }
  }

  async getUser(options = {}) {
    if (!this.createdUsers.length && !options.createIfNone) {
      throw new Error('No test users available');
    }

    if (!this.createdUsers.length && options.createIfNone) {
      return this.createUser();
    }

    return options.userId
      ? this.createdUsers.find(u => u._id === options.userId)
      : this.createdUsers[this.createdUsers.length - 1];
  }

  async getToken(user = null) {
    const targetUser = user || await this.getUser();
    return jwt.sign(
      { id: targetUser._id, nickname: targetUser.nickname, role: targetUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
  }

  async cleanup() {
    for (const user of this.createdUsers) {
      try {
        await User.findByIdAndDelete(user._id);
      } catch (error) {
        console.warn(`Failed to cleanup test user ${user._id}:`, error.message);
      }
    }
    this.createdUsers = [];
  }
}

// Channel test helpers
class ChannelTestHelper {
  constructor() {
    this.createdChannels = [];
  }

  async createChannel(channelData = {}) {
    const defaultData = {
      id: `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `Test Channel ${Date.now()}`,
      type: 'text'
    };

    const finalData = { ...defaultData, ...channelData };
    const channel = new Channel(finalData);

    try {
      await channel.save();
      this.createdChannels.push(channel);
      return channel;
    } catch (error) {
      throw new Error(`Failed to create test channel: ${error.message}`);
    }
  }

  async getChannel(options = {}) {
    if (!this.createdChannels.length && !options.createIfNone) {
      throw new Error('No test channels available');
    }

    if (!this.createdChannels.length && options.createIfNone) {
      return this.createChannel();
    }

    return options.channelId
      ? this.createdChannels.find(c => c._id === options.channelId)
      : this.createdChannels[this.createdChannels.length - 1];
  }

  async cleanup() {
    for (const channel of this.createdChannels) {
      try {
        await Channel.findByIdAndDelete(channel._id);
      } catch (error) {
        console.warn(`Failed to cleanup test channel ${channel._id}:`, error.message);
      }
    }
    this.createdChannels = [];
  }
}

// HTTP test helpers
class HTTPTestHelper {
  constructor(app) {
    this.app = app;
    this.authToken = null;
    this.userHelper = new UserTestHelper();
  }

  async authenticate(user = null) {
    const targetUser = user || await this.userHelper.createUser();
    this.authToken = await this.userHelper.getToken(targetUser);
    return targetUser;
  }

  getRequest(options = {}) {
    let req = request(this.app);

    if (this.authToken) {
      req.set('Authorization', `Bearer ${this.authToken}`);
    }

    return req;
  }

  async login(credentials = null) {
    if (credentials) {
      const creds = {
        identifier: credentials.identifier || credentials.email || credentials.nickname,
        password: credentials.password
      };

      return this.getRequest()
        .post('/login')
        .send(creds)
        .then(response => {
          this.authToken = response.body.token;
          return response;
        });
    }

    const user = await this.authenticate();
    return { user };
  }

  async register(userData = {}) {
    const user = await this.userHelper.createUser(userData);

    return this.getRequest()
      .post('/register')
      .send({
        nickname: user.nickname,
        email: user.email,
        password: userData.password || 'password123'
      });
  }

  async cleanup() {
    await this.userHelper.cleanup();
    this.authToken = null;
  }
}

// Database test helpers
class DatabaseTestHelper {
  static async cleanupCollections(collections = null) {
    const mongoose = require('mongoose');
    const connection = mongoose.connection;

    if (!collections) {
      collections = Object.keys(connection.collections);
    }

    for (const collection of collections) {
      try {
        await connection.collections[collection].deleteMany({});
      } catch (error) {
        console.warn(`Failed to cleanup collection ${collection}:`, error.message);
      }
    }
  }

  static isConnected() {
    const mongoose = require('mongoose');
    return mongoose.connection.readyState === 1;
  }

  static async waitForConnection(timeout = 10000) {
    const mongoose = require('mongoose');

    if (mongoose.connection.readyState === 1) {
      return true;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Database connection timeout after ${timeout}ms`));
      }, timeout);

      mongoose.connection.once('connected', () => {
        clearTimeout(timer);
        resolve(true);
      });

      if (mongoose.connection.readyState === 99) { // disconnected
        mongoose.connection.once('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      }
    });
  }
}

// Test fixture helpers
class TestFixtureHelper {
  constructor() {
    this.userHelper = new UserTestHelper();
    this.channelHelper = new ChannelTestHelper();
    this.fixtures = new Map();
  }

  create(name, factory) {
    this.fixtures.set(name, factory);
    return this;
  }

  async load(name) {
    const factory = this.fixtures.get(name);
    if (!factory) {
      throw new Error(`Fixture '${name}' not found`);
    }

    if (typeof factory === 'function') {
      return await factory(this);
    }

    return factory;
  }

  async cleanup() {
    await this.userHelper.cleanup();
    await this.channelHelper.cleanup();
    this.fixtures.clear();
  }
}

// Socket test helpers
class SocketTestHelper {
  constructor(io, port) {
    this.io = io;
    this.port = port;
    this.connectedClients = new Map();
  }

  createClient(options = {}) {
    return new Promise((resolve, reject) => {
      const clientOptions = {
        forceNew: true,
        timeout: 5000,
        ...options
      };

      const client = this.io.connect(`http://localhost:${this.port}`, clientOptions);

      const timeout = setTimeout(() => {
        client.disconnect();
        reject(new Error('Socket connection timeout'));
      }, clientOptions.timeout);

      client.on('connect', () => {
        clearTimeout(timeout);
        this.connectedClients.set(client.id, client);
        resolve(client);
      });

      client.on('connect_error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  async disconnectClient(client) {
    if (client) {
      client.disconnect();
      this.connectedClients.delete(client.id);
    }
  }

  async disconnectAll() {
    for (const client of this.connectedClients.values()) {
      await this.disconnectClient(client);
    }
    this.connectedClients.clear();
  }

  async waitForEvent(client, eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
      let resolved = false;

      const cleanup = () => {
        client.off(eventName, eventHandler);
        clearTimeout(timeoutId);
      };

      const eventHandler = (data) => {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve(data);
        }
      };

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          reject(new Error(`Timeout waiting for event: ${eventName}`));
        }
      }, timeout);

      client.on(eventName, eventHandler);
    });
  }
}

// Assertions helpers
const assertHelpers = {
  assertResponseSuccess: (response, status = 200) => {
    if (response.status !== status) {
      throw new Error(`Expected status ${status}, got ${response.status}. Response: ${JSON.stringify(response.body)}`);
    }
    return response;
  },

  assertHasProperties: (object, properties) => {
    for (const prop of properties) {
      if (!object.hasOwnProperty(prop)) {
        throw new Error(`Object missing property: ${prop}. Object: ${JSON.stringify(object)}`);
      }
    }
    return object;
  },

  assertNotEmpty: (array) => {
    if (!Array.isArray(array) || array.length === 0) {
      throw new Error(`Expected non-empty array, got: ${JSON.stringify(array)}`);
    }
    return array;
  }
};

module.exports = {
  UserTestHelper,
  ChannelTestHelper,
  HTTPTestHelper,
  DatabaseTestHelper,
  TestFixtureHelper,
  SocketTestHelper,
  assertHelpers
};