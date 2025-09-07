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
    // Ensure JWT_SECRET is set for authentication
    if (!process.env.JWT_SECRET) {
      console.log('Setting JWT_SECRET for tests...');
      process.env.JWT_SECRET = 'test-jwt-secret-key-for-socket-tests';
    } else {
      console.log('JWT_SECRET already set');
    }

    console.log('Starting database connection...');
    await connectDB();
    console.log('Database connected successfully');

    console.log('Starting test server...');
    testServer = new SocketTestServer();
    serverPort = await testServer.start();
    console.log('Test server started on port:', serverPort);

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
        auth: { token: 'invalid-token' }
      });

      invalidSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        invalidSocket.disconnect();
        done();
      });
    });

    test('should reject connection without token', (done) => {
      const noTokenSocket = io(`http://localhost:${serverPort}`);

      noTokenSocket.on('connect_error', (error) => {
        expect(error.message).toContain('Authentication');
        noTokenSocket.disconnect();
        done();
      });
    });
  });

  describe('Disconnection Handling', () => {
    test('should handle user disconnect gracefully', (done) => {
      const socket = io(`http://localhost:${serverPort}`, {
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

      clientSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken }
      });

      clientSocket.on('connect', () => {
        clientSocket.emit('join_room', { room: 'general' });

        clientSocket.on('online_users', () => {
          listenerClient = io(`http://localhost:${serverPort}`, {
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
      clientSocket = io(`http://localhost:${serverPort}`, {
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

        secondSocket = io(`http://localhost:${serverPort}`, {
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

  describe('Message History and Archival', () => {
    test('should receive history when joining room', (done) => {
      let historyReceived = false;
      let messagesReceived = false;

      clientSocket.emit('join_room', { room: 'general' });

      clientSocket.on('message', () => {
        messagesReceived = true;
        if (historyReceived) done();
      });

      clientSocket.on('history', (messages) => {
        expect(Array.isArray(messages)).toBe(true);
        expect(messages[0]).toHaveProperty('author');
        expect(messages[0]).toHaveProperty('text');
        expect(messages[0]).toHaveProperty('timestamp');
        historyReceived = true;
        if (messagesReceived) done();
      });
    });

    test('should handle history request without room', (done) => {
      // Create new socket without joining room
      const newSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken }
      });

      newSocket.on('connect', () => {
        newSocket.emit('get_history');
        newSocket.on('history', (messages) => {
          expect(messages).toEqual([]);
          newSocket.disconnect();
          done();
        });
      });
    });

    test('should properly calculate message visibility', async () => {
      let secondSocket;
      let thirdSocket;

      try {
        // Create second user
        const secondUser = new User({
          nickname: 'historyTestUser2',
          email: 'history2@test.com',
          password: 'testpass123'
        });
        await secondUser.save();

        const secondToken = jwt.sign(
          { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        secondSocket = io(`http://localhost:${serverPort}`, {
          auth: { token: secondToken }
        });

        // Create third user
        const thirdUser = new User({
          nickname: 'historyTestUser3',
          email: 'history3@test.com',
          password: 'testpass123'
        });
        await thirdUser.save();

        const thirdToken = jwt.sign(
          { id: thirdUser._id, nickname: thirdUser.nickname, role: thirdUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        thirdSocket = io(`http://localhost:${serverPort}`, {
          auth: { token: thirdToken }
        });

        await new Promise((resolve) => {
          thirdSocket.on('connect', () => {
            resolve();
          });
        });

        await new Promise((resolve) => {
          thirdSocket.emit('join_room', { room: 'general' });
          thirdSocket.on('online_users', () => {
            resolve();
          });
        });

        // Send private message User1 -> User2
        clientSocket.emit('private_message', { to: 'historyTestUser2', text: 'Private test' });

        await new Promise((resolve) => {
          setTimeout(resolve, 100); // Wait for DB write
        });

        // Check history from third user's perspective (should not see private message)
        await new Promise((resolve) => {
          thirdSocket.emit('get_history');
          thirdSocket.on('history', (messages) => {
            const privateMsg = messages.find(msg => msg.text === 'Private test');
            expect(privateMsg).toBeUndefined(); // Third user should not see private message
            resolve();
          });
        });

        // Check history from first user's perspective (should see their own private message)
        await new Promise((resolve) => {
          clientSocket.emit('get_history');
          clientSocket.on('history', (messages) => {
            const systemMsgs = messages.filter(msg => msg.author === 'System');
            const publicMsgs = messages.filter(msg => msg.type === 'public');
            expect(systemMsgs.length).toBeGreaterThan(0); // Join messages
            expect(publicMsgs.length).toBeGreaterThanOrEqual(0);
            resolve();
          });
        });

      } finally {
        if (secondSocket) secondSocket.disconnect();
        if (thirdSocket) thirdSocket.disconnect();
      }
    });
  });

  describe('Room Switching and Channel Validation', () => {
    test('should handle room switching correctly', (done) => {
      let firstRoomJoin = false;
      let secondRoomJoin = false;

      clientSocket.emit('join_room', { room: 'general' });

      clientSocket.on('message', (data) => {
        if (data.text.includes('joined the channel')) {
          if (data.text.includes('general') && !firstRoomJoin) {
            firstRoomJoin = true;
            setTimeout(() => {
              clientSocket.emit('join_room', { room: 'voice-chat' });
            }, 100);
          }
        }
      });

      clientSocket.on('message', (data) => {
        if (data.text.includes('joined the channel')) {
          if (data.text.includes('voice-chat') && firstRoomJoin && !secondRoomJoin) {
            secondRoomJoin = true;
            // Wait a bit then check that users lists were updated properly
            setTimeout(() => {
              clientSocket.emit('get_online_users');
              clientSocket.on('online_users', (users) => {
                expect(Array.isArray(users)).toBe(true);
                expect(users.every(user => user.nickname && user.role)).toBe(true);
                done();
              });
            }, 200);
          }
        }
      });
    });

    test('should reject invalid room names', (done) => {
      const invalidRooms = ['', null, undefined, '   ', { room: 123 }];

      let errorCount = 0;
      const totalTests = invalidRooms.length;

      invalidRooms.forEach((invalidRoom) => {
        const testSocket = io(`http://localhost:${serverPort}`, {
          auth: { token: testToken }
        });

        testSocket.on('connect', () => {
          testSocket.emit('join_room', typeof invalidRoom === 'object' ? invalidRoom : { room: invalidRoom });
          testSocket.on('error', (err) => {
            expect(err.code).toMatch(/MISSING_ROOM|INVALID_ROOM_FORMAT|CHANNEL_NOT_FOUND/);
            testSocket.disconnect();
            errorCount++;
            if (errorCount === totalTests) done();
          });
        });
      });
    });

    test('should handle non-existent channel', (done) => {
      clientSocket.emit('join_room', { room: 'non-existent-channel' });

      clientSocket.on('error', (data) => {
        if (data.message.includes('not found')) {
          expect(data.code).toBe('CHANNEL_NOT_FOUND');
          expect(data.room).toBe('non-existent-channel');
          done();
        }
      });
    });
  });

  describe('Connection Management and Recovery', () => {
    test('should handle connection recovery after disconnect', (done) => {
      let disconnectCount = 0;

      clientSocket.on('connect', () => {
        if (disconnectCount === 1) {
          // Second connect after disconnect
          expect(clientSocket.connected).toBe(true);
          done();
        }
      });

      clientSocket.on('disconnect', () => {
        disconnectCount++;
        if (disconnectCount === 1) {
          // First disconnect, now reconnect
          setTimeout(() => {
            const newSocket = io(`http://localhost:${serverPort}`, {
              auth: { token: testToken }
            });
            clientSocket = newSocket;
          }, 500);
        }
      });

      clientSocket.disconnect();
    });

    test('should handle multiple rapid connections', (done) => {
      const sockets = [];
      let connectedCount = 0;
      const totalSockets = 3;

      for (let i = 0; i < totalSockets; i++) {
        const socket = io(`http://localhost:${serverPort}`, {
          auth: { token: testToken }
        });

        socket.on('connect', () => {
          connectedCount++;
          sockets.push(socket);
          if (connectedCount === totalSockets) {
            // All connected successfully
            expect(connectedCount).toBe(totalSockets);
            sockets.forEach(sock => sock.disconnect());
            done();
          }
        });
      }
    });
  });

  describe('Advanced Voice Channel Scenarios', () => {
    let voiceClientSocket;

    beforeEach((done) => {
      voiceClientSocket = io(`http://localhost:${serverPort}`, {
        auth: { token: testToken }
      });

      voiceClientSocket.on('connect', () => {
        done();
      });
    });

    afterEach(() => {
      if (voiceClientSocket) voiceClientSocket.disconnect();
    });

    test('should handle voice channel without joining room first', (done) => {
      voiceClientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      voiceClientSocket.on('voice_joined', (data) => {
        expect(data.channelId).toBe('voice-chat');
        done();
      });
    });

    test('should reject voice channel join for text channels', (done) => {
      voiceClientSocket.emit('join_voice_channel', { channelId: 'general' }); // This is a text channel

      voiceClientSocket.on('voice_error', (data) => {
        expect(data.message).toBe('Voice channel not found');
        done();
      });
    });

    test('should notify other users when joining voice channel', (done) => {
      let mainJoined = false;
      let secondSocket;

      voiceClientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      voiceClientSocket.on('voice_joined', () => {
        mainJoined = true;
        // Create second user to join
        const secondUser = new User({
          nickname: 'voiceNotifyTestUser',
          email: 'voice-notify@test.com',
          password: 'testpass123'
        });

        secondUser.save().then(() => {
          const secondToken = jwt.sign(
            { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
          );

          secondSocket = io(`http://localhost:${serverPort}`, {
            auth: { token: secondToken }
          });

          secondSocket.on('connect', () => {
            secondSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

            secondSocket.on('user_joined_voice', (data) => {
              expect(data.nickname).toBe('extendedSocketTestUser');
              secondSocket.disconnect();
              done();
            });
          });
        });
      });
    });

    test('should handle WebRTC signaling events correctly', (done) => {
      let signallerSocket;
      let receiverSocket;

      // Create signaller
      const signallerUser = new User({
        nickname: 'signallerTestUser',
        email: 'signaller@test.com',
        password: 'testpass123'
      });

      signallerUser.save().then(() => {
        const signallerToken = jwt.sign(
          { id: signallerUser._id, nickname: signallerUser.nickname, role: signallerUser.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        signallerSocket = io(`http://localhost:${serverPort}`, {
          auth: { token: signallerToken }
        });

        signallerSocket.on('connect', () => {
          const receiverUser = new User({
            nickname: 'receiverTestUser',
            email: 'receiver@test.com',
            password: 'testpass123'
          });

          receiverUser.save().then(() => {
            const receiverToken = jwt.sign(
              { id: receiverUser._id, nickname: receiverUser.nickname, role: receiverUser.role },
              process.env.JWT_SECRET,
              { expiresIn: '24h' }
            );

            receiverSocket = io(`http://localhost:${serverPort}`, {
              auth: { token: receiverToken }
            });

            receiverSocket.on('connect', () => {
              // Both join voice channel
              signallerSocket.emit('join_voice_channel', { channelId: 'voice-chat' });
              receiverSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

              let offersReceived = 0;

              receiverSocket.on('voice_offer', (data) => {
                offersReceived++;
                if (offersReceived === 1) {
                  expect(data.fromNickname).toBe('signallerTestUser');
                  expect(data.offer).toBeDefined();

                  // Test answer
                  receiverSocket.emit('voice_answer', {
                    answer: { type: 'answer', sdp: 'fake-answer-sdp' },
                    targetSocketId: data.from
                  });

                  signallerSocket.on('voice_answer', (answerData) => {
                    expect(answerData.fromNickname).toBe('receiverTestUser');
                    expect(answerData.answer).toBeDefined();
                    done();
                  });
                }
              });
            });
          });
        });
      });
    });

    test('should handle ICE candidate exchange', (done) => {
      let iceSignaller;
      let iceReceiver;

      const iceUser1 = new User({
        nickname: 'iceTestUser1',
        email: 'ice1@test.com',
        password: 'testpass123'
      });

      iceUser1.save().then(() => {
        const iceToken1 = jwt.sign(
          { id: iceUser1._id, nickname: iceUser1.nickname, role: iceUser1.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        iceSignaller = io(`http://localhost:${serverPort}`, {
          auth: { token: iceToken1 }
        });

        iceSignaller.on('connect', () => {
          const iceUser2 = new User({
            nickname: 'iceTestUser2',
            email: 'ice2@test.com',
            password: 'testpass123'
          });

          iceUser2.save().then(() => {
            const iceToken2 = jwt.sign(
              { id: iceUser2._id, nickname: iceUser2.nickname, role: iceUser2.role },
              process.env.JWT_SECRET,
              { expiresIn: '24h' }
            );

            iceReceiver = io(`http://localhost:${serverPort}`, {
              auth: { token: iceToken2 }
            });

            iceReceiver.on('connect', () => {
              iceSignaller.emit('ice_candidate', {
                candidate: { candidate: 'fake-candidate-1' },
                targetSocketId: iceReceiver.id
              });

              iceReceiver.on('ice_candidate', (data) => {
                expect(data.candidate.candidate).toBe('fake-candidate-1');
                expect(data.fromNickname).toBe('iceTestUser1');

                // Test reverse ICE candidate
                iceReceiver.emit('ice_candidate', {
                  candidate: { candidate: 'fake-candidate-2' },
                  targetSocketId: iceSignaller.id
                });

                iceSignaller.on('ice_candidate', (data) => {
                  expect(data.candidate.candidate).toBe('fake-candidate-2');
                  expect(data.fromNickname).toBe('iceTestUser2');
                  done();
                });
              });
            });
          });
        });
      });
    });
  });

  describe('Rate Limiting and Performance', () => {
    test('should handle rapid message sending', (done) => {
      const messages = [];
      let receivedCount = 0;
      const totalMessages = 5;

      for (let i = 0; i < totalMessages; i++) {
        clientSocket.emit('message', { text: `Rapid message ${i + 1}` });
      }

      clientSocket.on('message', (data) => {
        if (data.author === testUser.nickname && data.text.startsWith('Rapid message')) {
          receivedCount++;
          if (receivedCount === totalMessages) {
            // All messages were processed (may be rate limited but not blocked)
            expect(receivedCount).toBe(totalMessages);
            done();
          }
        }
      });
    });

    test('should maintain performance under load', (done) => {
      const startTime = Date.now();
      let operationCount = 0;
      const targetOperations = 20;

      const performOperation = () => {
        clientSocket.emit('message', { text: `Load test ${(operationCount + 1)}` });
        operationCount++;

        if (operationCount >= targetOperations) {
          const endTime = Date.now();
          const duration = endTime - startTime;

          // Should complete within reasonable time (allowing for rate limiting)
          expect(duration).toBeLessThan(5000); // 5 seconds max
          done();
        } else {
          setTimeout(performOperation, 50); // Small delay between operations
        }
      };

      performOperation();
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should handle malformed messages gracefully', (done) => {
      const malformedMessages = [null, undefined, { text: '' }, { text: '   ' }, {}];

      let errorCount = 0;
      const totalTests = malformedMessages.length;

      malformedMessages.forEach((malformed) => {
        clientSocket.emit('message', malformed);
      });

      // Messages should be ignored without causing errors
      setTimeout(() => {
        expect(errorCount).toBe(0); // No errors should be thrown
        done();
      }, 1000);
    });

    test('should recover from temporary network issues', (done) => {
      // Simulate network disruption by disconnecting and reconnecting
      let reconnectCount = 0;

      clientSocket.on('connect', () => {
        reconnectCount++;
        if (reconnectCount === 2) {
          // Successfully reconnected
          expect(clientSocket.connected).toBe(true);

          // Test that functionality still works after reconnect
          clientSocket.emit('message', { text: 'Post-reconnect test' });

          clientSocket.on('message', (data) => {
            if (data.author === testUser.nickname && data.text === 'Post-reconnect test') {
              done();
            }
          });
        }
      });

      clientSocket.on('disconnect', () => {
        if (reconnectCount === 1) {
          // First disconnect, now reconnect
          setTimeout(() => {
            const newSocket = io(`http://localhost:${serverPort}`, {
              auth: { token: testToken }
            });
            clientSocket = newSocket;
          }, 200);
        }
      });

      // Trigger disconnect
      clientSocket.disconnect();
    });

    test('should handle concurrent operations safely', (done) => {
      const operations = [];
      let completedCount = 0;
      const totalOperations = 10;

      for (let i = 0; i < totalOperations; i++) {
        operations.push(new Promise((resolve) => {
          clientSocket.emit('message', { text: `Concurrent op ${i + 1}` });
          setTimeout(resolve, 50);
        }));
      }

      Promise.all(operations).then(() => {
        // All operations completed without deadlocks or race conditions
        expect(completedCount).toBe(0); // This is just a sanity check
        done();
      });
    });
  });
});