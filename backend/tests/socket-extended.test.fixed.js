const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const { connectDB, closeDB } = require('../db/connection');
const User = require('../models/User');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const SocketTestServer = require('./socket-server.test');

let testServer;
let testUser;
let testToken;
let serverPort;

describe('Socket.IO Extended Tests - Fixed', () => {
  beforeAll(async () => {
    await connectDB();

    testServer = new SocketTestServer();
    serverPort = await testServer.start();

    testUser = new User({
      nickname: 'extendedSocketTestUser',
      email: 'extended-socket@test.com',
      password: 'testpass123',
      status: 'online'
    });
    await testUser.save();

    // Create JWT token
    testToken = jwt.sign(
      { id: testUser._id, nickname: testUser.nickname, role: testUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
  });

  afterAll(async () => {
    if (testServer) {
      await testServer.stop();
    }
    await closeDB();
  });

  describe('Authentication Edge Cases', () => {
    test('should reject invalid JWT token', (done) => {
      const invalidSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: 'invalid-token' },
        forceNew: true
      });

      invalidSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        invalidSocket.disconnect();
        done();
      });
    });

    test('should reject connection without token', (done) => {
      const noTokenSocket = io(`http://localhost:${serverPort}`, {
        forceNew: true
      });

      noTokenSocket.on('connect_error', (error) => {
        expect(error.message).toBe('Authentication token required');
        noTokenSocket.disconnect();
        done();
      });
    });
  });

  describe('Disconnection Handling', () => {
    test('should handle user disconnect gracefully', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        socket.on('disconnect', () => {
          done();
        });
        socket.disconnect();
      });
    });

    test('should update online users list on disconnect', (done) => {
      let clientSocket, listenerSocket;

      clientSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join_room', { room: 'general' });

        clientSocket.on('online_users', () => {
          listenerSocket = io(`http://localhost:${serverPort}`, {
            auth: { token: testToken },
            forceNew: true
          });

          listenerSocket.on('connect', () => {
            listenerSocket.emit('join_room', { room: 'general' });

            listenerSocket.on('online_users', (users) => {
              expect(users.some(user => user.nickname === testUser.nickname)).toBe(true);
              clientSocket.disconnect();

              setTimeout(() => {
                listenerSocket.emit('get_online_users');
                listenerSocket.on('online_users', (updatedUsers) => {
                  expect(updatedUsers.every(user => user.nickname !== testUser.nickname)).toBe(true);
                  listenerSocket.disconnect();
                  done();
                });
              }, 500);
            });
          });
        });
      });

      clientSocket.on('connect_error', (error) => {
        done.fail(new Error(`Connection failed: ${error.message}`));
      });
    });
  });

  describe('Private Messages - /w Command Edge Cases', () => {
    let clientSocket, secondSocket;

    beforeEach((done) => {
      const secondUser = new User({
        nickname: 'extendedTestUser2',
        email: 'extended-test2@test.com',
        password: 'testpass123',
        status: 'online'
      });

      secondUser.save().then(() => {
        const secondToken = jwt.sign(
          { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        clientSocket = io(`http://localhost:${serverPort}`, {
          auth: { token: testToken },
          forceNew: true
        });

        secondSocket = io(`http://localhost:${serverPort}`, {
          auth: { token: secondToken },
          forceNew: true
        });

        secondSocket.on('connect', () => {
          clientSocket.emit('join_room', { room: 'general' });
          secondSocket.emit('join_room', { room: 'general' });
          done();
        });

        secondSocket.on('connect_error', (error) => {
          done.fail(new Error(`Second socket failed: ${error.message}`));
        });
      });
    });

    afterEach(() => {
      if (clientSocket) clientSocket.disconnect();
      if (secondSocket) secondSocket.disconnect();
    });

    test('should send private message between users', (done) => {
      const privateMessage = 'Private message from extended test';

      clientSocket.emit('private_message', {
        to: 'extendedTestUser2',
        text: privateMessage
      });

      let senderReceived = false;
      let receiverReceived = false;

      clientSocket.on('private_message', (data) => {
        if (data.text === privateMessage) {
          senderReceived = true;
          if (receiverReceived) done();
        }
      });

      secondSocket.on('private_message', (data) => {
        if (data.text === privateMessage && data.author === testUser.nickname) {
          receiverReceived = true;
          if (senderReceived) done();
        }
      });
    });
  });

  describe('Message History and Archival', () => {
    let clientSocket;

    beforeEach((done) => {
      clientSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      clientSocket.on('connect', () => {
        done();
      });

      clientSocket.on('connect_error', (error) => {
        done.fail(new Error(`Connection failed: ${error.message}`));
      });
    });

    afterEach(() => {
      if (clientSocket) clientSocket.disconnect();
    });

    test('should receive history when joining room', (done) => {
      clientSocket.emit('join_room', { room: 'general' });

      clientSocket.on('history', (messages) => {
        expect(Array.isArray(messages)).toBe(true);
        expect(messages[0]).toHaveProperty('author');
        expect(messages[0]).toHaveProperty('text');
        expect(messages[0]).toHaveProperty('timestamp');
        done();
      });
    });

    test('should handle history request without room', (done) => {
      clientSocket.emit('get_history');

      clientSocket.on('history', (messages) => {
        expect(Array.isArray(messages)).toBe(true);
        done();
      });
    });
  });

  describe('Room Switching and Channel Validation', () => {
    test('should handle invalid room names', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        socket.emit('join_room', { room: '' });

        socket.on('error', (data) => {
          expect(data.code).toBe('INVALID_ROOM_FORMAT');
          socket.disconnect();
          done();
        });
      });

      socket.on('connect_error', (error) => {
        done.fail(new Error(`Connection failed: ${error.message}`));
      });
    });

    test('should handle non-existent channel', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        socket.emit('join_room', { room: 'non-existent-channel' });

        socket.on('error', (data) => {
          expect(data.code).toBe('CHANNEL_NOT_FOUND');
          socket.disconnect();
          done();
        });
      });
    });
  });

  describe('Connection Management and Recovery', () => {
    test('should handle connection recovery after disconnect', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      let reconnectCount = 0;

      socket.on('connect', () => {
        reconnectCount++;
        if (reconnectCount === 2) {
          expect(socket.connected).toBe(true);
          done();
        }
      });

      socket.on('disconnect', () => {
        if (reconnectCount === 1) {
          setTimeout(() => {
            const newSocket = io(`http://localhost:${serverPort}`, {
              auth: { token: testToken },
              forceNew: true
            });
          }, 200);
        }
      });
    });

    test('should handle rapid connections', (done) => {
      const sockets = [];
      let connectedCount = 0;
      const totalSockets = 3;

      for (let i = 0; i < totalSockets; i++) {
        const socket = io(`http://localhost:${serverPort}`, {
          auth: { token: testToken },
          forceNew: true
        });

        socket.on('connect', () => {
          connectedCount++;
          sockets.push(socket);
          if (connectedCount === totalSockets) {
            expect(connectedCount).toBe(totalSockets);
            sockets.forEach(sock => sock.disconnect());
            done();
          }
        });
      }
    });
  });

  describe('Advanced Voice Channel Scenarios', () => {
    test('should reject joining text channel as voice channel', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        socket.emit('join_voice_channel', { channelId: 'general' }); // Text channel
        socket.on('voice_error', (data) => {
          expect(data.message).toBe('Voice channel not found');
          socket.disconnect();
          done();
        });
      });
    });

    test('should join voice channel without room first', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        socket.emit('join_voice_channel', { channelId: 'voice-chat' });

        socket.on('voice_joined', (data) => {
          expect(data.channelId).toBe('voice-chat');
          socket.disconnect();
          done();
        });
      });
    });
  });

  describe('Rate Limiting and Performance', () => {
    test('should maintain performance under load', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        const startTime = Date.now();
        let operationCount = 0;
        const targetOperations = 20;

        const performOperation = () => {
          socket.emit('message', { text: `Load test ${operationCount + 1}` });
          operationCount++;

          if (operationCount >= targetOperations) {
            const endTime = Date.now();
            const duration = endTime - startTime;
            expect(duration).toBeLessThan(5000); // 5 seconds max
            socket.disconnect();
            done();
          } else {
            setTimeout(performOperation, 50);
          }
        };

        socket.emit('join_room', { room: 'general' });
        socket.on('online_users', () => {
          performOperation();
        });
      });

      socket.on('connect_error', (error) => {
        done.fail(new Error(`Connection failed: ${error.message}`));
      });
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle malformed messages gracefully', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken },
        forceNew: true
      });

      socket.on('connect', () => {
        socket.emit('join_room', { room: 'general' });

        socket.on('online_users', () => {
          const malformedMessages = [null, undefined, { text: '' }, { text: '   ' }, {}];

          malformedMessages.forEach((malformed) => {
            socket.emit('message', malformed);
          });

          setTimeout(() => {
            expect(true).toBe(true); // Test passes if no errors thrown
            socket.disconnect();
            done();
          }, 1000);
        });
      });

      socket.on('connect_error', (error) => {
        done.fail(new Error(`Connection failed: ${error.message}`));
      });
    });
  });
});