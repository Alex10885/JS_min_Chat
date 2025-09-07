const io = require('socket.io-client');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const { connectDB, closeDB } = require('../db/connection');
const User = require('../models/User');
const Message = require('../models/Message');
const Channel = require('../models/Channel');
const SocketTestServer = require('./socket-server.test');

let testServer;
let testUser;
let testToken;
let clientSocket;
const PORT = 3003; // Use running server port

let serverPort;



describe('Socket.IO Integration Tests', () => {
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

  beforeEach((done) => {
    clientSocket = io(`http://localhost:${serverPort}`, {
      auth: { token: testToken },
      forceNew: true
    });

    clientSocket.on('connect', () => {
      done();
    });

    clientSocket.on('connect_error', (error) => {
      console.error('Connection error:', error.message);
      done.fail(new Error(`Failed to connect: ${error.message}`));
    });
  });

  afterEach(() => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
  });

  describe('Authentication', () => {
    test('should connect with valid token', (done) => {
      expect(clientSocket.connected).toBe(true);
      done();
    });

    test('should receive user data on connection', (done) => {
      const newSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      newSocket.on('connect', () => {
        expect(newSocket.id).toBeDefined();
        newSocket.disconnect();
        done();
      });

      newSocket.on('connect_error', (error) => {
        done.fail(new Error(`Connection failed: ${error.message}`));
      });
    });
  });

  describe('Channel Joining', () => {
    test('should join text channel', (done) => {
      clientSocket.emit('join_room', { room: 'general' });

      clientSocket.on('message', (data) => {
        if (data.author === 'System' && data.text.includes('joined the channel')) {
          expect(data.author).toBe('System');
          expect(data.room || data.channel).toBe('general');
          done();
        }
      });
    });

    test('should receive online users list', (done) => {
      clientSocket.emit('join_room', { room: 'general' });

      clientSocket.on('online_users', (users) => {
        expect(Array.isArray(users)).toBe(true);
        expect(users.length).toBeGreaterThan(0);
        expect(users[0]).toHaveProperty('nickname');
        expect(users[0]).toHaveProperty('role');
        done();
      });
    });

    test('should handle invalid room name', (done) => {
      clientSocket.emit('join_room', { room: '' });

      clientSocket.on('error', (data) => {
        expect(data.code).toBe('INVALID_ROOM_FORMAT');
        done();
      });
    });

    test('should handle non-existent channel', (done) => {
      clientSocket.emit('join_room', { room: 'nonexistent-channel' });

      clientSocket.on('error', (data) => {
        expect(data.code).toBe('CHANNEL_NOT_FOUND');
        done();
      });
    });
  });

  describe('Message Handling', () => {
    beforeEach((done) => {
      clientSocket.emit('join_room', { room: 'general' });
      setTimeout(done, 100); // Wait for room join
    });

    test('should send public message', (done) => {
      const messageText = 'Hello from Socket.IO test!';

      clientSocket.emit('message', { text: messageText });

      clientSocket.on('message', (data) => {
        if (data.author === testUser.nickname && data.text === messageText) {
          expect(data.author).toBe(testUser.nickname);
          expect(data.room || data.channel).toBe('general');
          expect(data.text).toBe(messageText);
          done();
        }
      });
    });

    test('should receive message history', (done) => {
      clientSocket.emit('join_room', { room: 'general' });

      clientSocket.on('history', (messages) => {
        expect(Array.isArray(messages)).toBe(true);
        done();
      });
    });
  });

  describe('Private Messages', () => {
    let secondClient;

    beforeEach((done) => {
      // Create second test user
      const secondUser = new User({
        nickname: 'socketTestUser2',
        email: 'socket2@test.com',
        password: 'testpass123',
        status: 'online'
      });

      secondUser.save().then(() => {
        const secondToken = jwt.sign(
          { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        secondClient = io(`http://localhost:${serverPort}`, {
          auth: { token: secondToken },
          forceNew: true
        });

        secondClient.on('connect', () => {
          secondClient.emit('join_room', { room: 'general' });
          done();
        });

        secondClient.on('connect_error', (error) => {
          done.fail(new Error(`Second client connection failed: ${error.message}`));
        });
      });
    });

    afterEach(() => {
      if (secondClient) {
        secondClient.disconnect();
      }
    });

    test('should send private message', (done) => {
      const privateMessage = 'Private message from Socket.IO test';

      clientSocket.emit('private_message', {
        to: 'socketTestUser2',
        text: privateMessage
      });

      // Check if sent message is received by sender (without target)
      clientSocket.on('private_message', (data) => {
        if (data.text === privateMessage) {
          expect(data.author).toBe(testUser.nickname);
          expect(data.room || data.channel).toBe('general');
          expect(data.text).toBe(privateMessage);
          expect(data.target).toBeUndefined(); // Should be null for sender
          done();
        }
      });

      // Check if target receives the message
      secondClient.on('private_message', (data) => {
        if (data.text === privateMessage) {
          expect(data.author).toBe(testUser.nickname);
          expect(data.target).toBe('socketTestUser2');
          done();
        }
      });
    });
  });

  describe('Voice Channels', () => {
    test('should join voice channel', (done) => {
      clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      clientSocket.on('voice_joined', (data) => {
        expect(data.channelId).toBe('voice-chat');
        done();
      });
    });

    test('should leave voice channel', (done) => {
      // First join
      clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      clientSocket.on('voice_joined', () => {
        // Then leave
        clientSocket.emit('leave_voice_channel');

        clientSocket.on('voice_left', () => {
          done();
        });
      });
    });

    test('should handle user joined/left voice events', (done) => {
      let secondClient;

      // Create second user
      const secondUser = new User({
        nickname: 'voiceTestUser2',
        email: 'voice2@test.com',
        password: 'testpass123',
        status: 'online'
      });

      secondUser.save().then(() => {
        const secondToken = jwt.sign(
          { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        secondClient = io(`http://localhost:${serverPort}`, {
          auth: { token: secondToken },
          forceNew: true
        });

        secondClient.on('connect', () => {
          clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

          clientSocket.on('voice_joined', () => {
            // Second user joins
            secondClient.emit('join_voice_channel', { channelId: 'voice-chat' });

            // First user should see second user joining
            clientSocket.on('user_joined_voice', (data) => {
              expect(data.nickname).toBe('voiceTestUser2');
              secondClient.disconnect();
              done();
            });
          });
        });

        secondClient.on('connect_error', (error) => {
          done.fail(new Error(`Voice client connection failed: ${error.message}`));
        });
      });
    });
  });

  describe('Speaking Events', () => {
    test('should broadcast speaking status', (done) => {
      const secondUser = new User({
        nickname: 'speakingTestUser',
        email: 'speaking@test.com',
        password: 'test123',
        status: 'online'
      });

      secondUser.save().then(() => {
        const secondToken = jwt.sign(
          { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        const listenerClient = io(`http://localhost:${serverPort}`, {
          auth: { token: secondToken },
          forceNew: true
        });

        listenerClient.on('connect', () => {
          listenerClient.emit('join_room', { room: 'general' });

          listenerClient.on('online_users', () => {
            clientSocket.emit('speaking', { speaking: true });

            listenerClient.on('speaking', (data) => {
              expect(data.nickname).toBe(testUser.nickname);
              expect(data.speaking).toBe(true);
              listenerClient.disconnect();
              done();
            });
          });
        });

        listenerClient.on('connect_error', (error) => {
          done.fail(new Error(`Speaking client connection failed: ${error.message}`));
        });
      });
    });
  });

  describe('Disconnect Handling', () => {
    test('should handle disconnect gracefully', (done) => {
      clientSocket.on('disconnect', () => {
        done();
      });

      clientSocket.disconnect();
    });
  });
});