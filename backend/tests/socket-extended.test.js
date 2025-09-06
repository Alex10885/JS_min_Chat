const io = require('socket.io-client');
const { connectDB, closeDB } = require('../db/connection');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

let testUser;
let testToken;

const PORT = 3001;

describe('Socket.IO Extended Tests', () => {
  beforeAll(async () => {
    await connectDB();

    testUser = new User({
      nickname: 'extendedSocketTestUser',
      email: 'extended-socket@test.com',
      password: 'testpass123'
    });
    await testUser.save();

    testToken = jwt.sign(
      { id: testUser._id, nickname: testUser.nickname, role: testUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
  });

  afterAll(async () => {
    await closeDB();
  });

  describe('Authentication Edge Cases', () => {
    test('should reject invalid JWT token', (done) => {
      const invalidSocket = io(`http://localhost:${PORT}`, {
        auth: { token: 'invalid-token' }
      });

      invalidSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        invalidSocket.disconnect();
        done();
      });
    });

    test('should reject connection without token', (done) => {
      const noTokenSocket = io(`http://localhost:${PORT}`);

      noTokenSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        noTokenSocket.disconnect();
        done();
      });
    });
  });

  describe('Disconnection Handling', () => {
    test('should handle user disconnect gracefully', (done) => {
      const socket = io(`http://localhost:${PORT}`, {
        auth: { token: testToken }
      });

      socket.on('connect', () => {
        socket.on('disconnect', () => {
          done();
        });
        socket.disconnect();
      });
    });

    test('should remove user from online list on disconnect', (done) => {
      let clientSocket;
      let listenerClient;

      clientSocket = io(`http://localhost:${PORT}`, {
        auth: { token: testToken }
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join_room', { room: 'general' });

        clientSocket.on('online_users', () => {
          listenerClient = io(`http://localhost:${PORT}`, {
            auth: { token: testToken }
          });

          listenerClient.on('connect', () => {
            listenerClient.emit('join_room', { room: 'general' });

            listenerClient.on('online_users', (users) => {
              expect(users.some(user => user.nickname === testUser.nickname)).toBe(true);

              clientSocket.disconnect();

              setTimeout(() => {
                listenerClient.emit('get_online_users');

                listenerClient.on('online_users', (updatedUsers) => {
                  expect(updatedUsers.some(user => user.nickname === testUser.nickname)).toBe(false);
                  listenerClient.disconnect();
                  done();
                });
              }, 500);
            });
          });
        });
      });
    });
  });

  describe('Private Messages - /w Command Edge Cases', () => {
    let clientSocket;
    let secondSocket;

    beforeEach((done) => {
      clientSocket = io(`http://localhost:${PORT}`, {
        auth: { token: testToken }
      });

      const secondUser = new User({
        nickname: 'extendedTestUser2',
        email: 'extended-test2@test.com',
        password: 'testpass123'
      });

      secondUser.save().then(() => {
        const secondToken = jwt.sign(
          { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        secondSocket = io(`http://localhost:${PORT}`, {
          auth: { token: secondToken }
        });

        secondSocket.on('connect', () => {
          clientSocket.emit('join_room', { room: 'general' });
          secondSocket.emit('join_room', { room: 'general' });
          done();
        });
      });
    });

    afterEach(() => {
      if (clientSocket) clientSocket.disconnect();
      if (secondSocket) secondSocket.disconnect();
    });

    test('should handle /w command to invalid user', (done) => {
      clientSocket.emit('message', { text: '/w nonexistentuser Hello' });

      clientSocket.on('message', (data) => {
        if (data.author === 'System' && data.text.includes('not found')) {
          expect(data.text).toMatch(/User.*not found/i);
          done();
        }
      });
    });

    test('should handle /w command with invalid format', (done) => {
      clientSocket.emit('message', { text: '/w' });

      clientSocket.on('message', (data) => {
        if (data.author === 'System' && data.text.includes('Usage')) {
          expect(data.text).toMatch(/Usage.*\/w/i);
          done();
        }
      });
    });
  });
});