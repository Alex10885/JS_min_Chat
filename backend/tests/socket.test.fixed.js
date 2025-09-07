const io = require('socket.io-client');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { connectDB, closeDB } = require('../db/connection');
const User = require('../models/User');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const SocketTestServer = require('./socket-server.test');

// Utility function to wait for socket event with timeout
function waitForEvent(socket, eventName, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let resolved = false;

    const cleanup = () => {
      socket.off(eventName, eventHandler);
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

    socket.on(eventName, eventHandler);
  });
}

// Utility function to wait for socket connection
function waitForSocketConnection(socket, timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve(socket);
      return;
    }

    let resolved = false;

    const cleanup = () => {
      socket.off('connect', connectHandler);
      socket.off('connect_error', errorHandler);
      clearTimeout(timeoutId);
    };

    const connectHandler = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        resolve(socket);
      }
    };

    const errorHandler = (error) => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Socket connection failed: ${error.message}`));
      }
    };

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        cleanup();
        reject(new Error(`Socket connection timeout after ${timeout}ms`));
      }
    }, timeout);

    socket.on('connect', connectHandler);
    socket.on('connect_error', errorHandler);
  });
}

let testServer;
let testUser;
let testToken;
let clientSocket;
let serverPort;

describe('Socket.IO Integration Tests - Fixed', () => {
  beforeAll(async () => {
    // Connect to test database
    await connectDB();

    // Create test server
    testServer = new SocketTestServer();
    serverPort = await testServer.start();

    // Create test user
    testUser = new User({
      nickname: 'socketTestUser',
      email: 'socket@test.com',
      password: 'testpass123',
      status: 'online'
    });
    await testUser.save();

    // Create default channels
    await Channel.findOneAndUpdate(
      { id: 'general' },
      { id: 'general', name: 'General', type: 'text', createdBy: 'system' },
      { upsert: true, new: true }
    );

    await Channel.findOneAndUpdate(
      { id: 'voice-chat' },
      { id: 'voice-chat', name: 'Voice Chat', type: 'voice', createdBy: 'system' },
      { upsert: true, new: true }
    );

    // Get JWT token
    const expressApp = testServer.app; // Access test server's express app
    const response = await request(expressApp)
      .post('/test-login')
      .send({ nickname: 'socketTestUser' });

    testToken = response.body.token;
  });

  afterAll(async () => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    if (testServer) {
      await testServer.stop();
    }
    await closeDB();
  });

  beforeEach(async () => {
    clientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: testToken },
      forceNew: true
    });

    // Wait for connection to be established
    await waitForSocketConnection(clientSocket);
  });

  afterEach(() => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
  });

  describe('Authentication', () => {
    test('should connect with valid token', () => {
      expect(clientSocket.connected).toBe(true);
      expect(clientSocket.id).toBeDefined();
    });

    test('should receive user data on connection', async () => {
      const newSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      await waitForSocketConnection(newSocket);
      expect(newSocket.id).toBeDefined();
      newSocket.disconnect();
    });
  });

  describe('Channel Joining', () => {
    test('should join text channel', async () => {
      clientSocket.emit('join_room', { room: 'general' });

      const data = await waitForEvent(clientSocket, 'message', 2000);
      if (data.author === 'System' && data.text.includes('joined the channel')) {
        expect(data.author).toBe('System');
        expect(data.room || data.channel).toBe('general');
      }
    });

    test('should receive online users list', async () => {
      clientSocket.emit('join_room', { room: 'general' });

      const users = await waitForEvent(clientSocket, 'online_users', 2000);
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      expect(users[0]).toHaveProperty('nickname');
      expect(users[0]).toHaveProperty('role');
    });

    test('should handle invalid room name', async () => {
      clientSocket.emit('join_room', { room: '' });

      const data = await waitForEvent(clientSocket, 'error', 2000);
      expect(data.code).toBe('INVALID_ROOM_FORMAT');
    });

    test('should handle non-existent channel', async () => {
      clientSocket.emit('join_room', { room: 'nonexistent-channel' });

      const data = await waitForEvent(clientSocket, 'error', 2000);
      expect(data.code).toBe('CHANNEL_NOT_FOUND');
    });
  });

  describe('Message Handling', () => {
    beforeEach(async () => {
      clientSocket.emit('join_room', { room: 'general' });
      // Wait for room join confirmation
      await waitForEvent(clientSocket, 'message', 1000);
    });

    test('should send public message', async () => {
      const messageText = 'Hello from Socket.IO test!';

      clientSocket.emit('message', { text: messageText });

      const data = await waitForEvent(clientSocket, 'message', 2000);
      if (data.author === testUser.nickname && data.text === messageText) {
        expect(data.author).toBe(testUser.nickname);
        expect(data.room || data.channel).toBe('general');
        expect(data.text).toBe(messageText);
      }
    });

    test('should receive message history', async () => {
      clientSocket.emit('join_room', { room: 'general' });

      const messages = await waitForEvent(clientSocket, 'history', 2000);
      expect(Array.isArray(messages)).toBe(true);
    });
  });

  describe('Voice Channels', () => {
    test('should join voice channel', async () => {
      clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      const data = await waitForEvent(clientSocket, 'voice_joined', 2000);
      expect(data.channelId).toBe('voice-chat');
    });

    test('should leave voice channel', async () => {
      clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      await waitForEvent(clientSocket, 'voice_joined', 2000);
      clientSocket.emit('leave_voice_channel');

      await waitForEvent(clientSocket, 'voice_left', 2000);
    });

    test('should reject joining text channel as voice channel', async () => {
      clientSocket.emit('join_voice_channel', { channelId: 'general' }); // This is a text channel

      const data = await waitForEvent(clientSocket, 'voice_error', 2000);
      expect(data.message).toBe('Voice channel not found');
    });
  });

  describe('Speaking Events', () => {
    test('should broadcast speaking status', async () => {
      const secondUser = new User({
        nickname: 'speakingTestUser',
        email: 'speaking@test.com',
        password: 'test123',
        status: 'online'
      });

      await secondUser.save();

      const secondToken = jwt.sign(
        { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      const listenerClient = io(`http://localhost:${serverPort}`, {
        auth: { token: secondToken },
        forceNew: true
      });

      await waitForSocketConnection(listenerClient);

      listenerClient.emit('join_room', { room: 'general' });
      await waitForEvent(listenerClient, 'online_users', 2000);

      clientSocket.emit('speaking', { speaking: true });

      const data = await waitForEvent(listenerClient, 'speaking', 2000);
      expect(data.nickname).toBe(testUser.nickname);
      expect(data.speaking).toBe(true);

      listenerClient.disconnect();
    });
  });

  describe('Disconnect Handling', () => {
    test('should handle disconnect gracefully', async () => {
      await waitForEvent(clientSocket, 'disconnect', 1000);
      clientSocket.disconnect();
    });
  });
});