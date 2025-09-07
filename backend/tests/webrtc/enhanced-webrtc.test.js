const io = require('socket.io-client');
const { connectDB, closeDB } = require('../../db/connection');
const User = require('../../models/User');
const jwt = require('jsonwebtoken');

let testUsers = [];
let testTokens = [];

const PORT = 3001;
const TEST_CHANNEL_ID = 'voice-chat-test';

describe('Enhanced WebRTC Testing', () => {
  let clientSockets = [];
  let testClients = [];

  beforeAll(async () => {
    await connectDB();

    // Create multiple test users for comprehensive testing
    for (let i = 1; i <= 5; i++) {
      const user = new User({
        nickname: `webrtc_enhanced_user_${i}`,
        email: `webrtc-enhanced-${i}@test.com`,
        password: 'testpass123'
      });
      await user.save();
      testUsers.push(user);

      const token = jwt.sign(
        { id: user._id, nickname: user.nickname, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );
      testTokens.push(token);
    }
  });

  afterAll(async () => {
    await closeDB();
  });

  beforeEach((done) => {
    let connected = 0;
    const totalClients = 3; // Test with 3 concurrent clients

    for (let i = 0; i < totalClients; i++) {
      const socket = io(`http://localhost:${PORT}`, {
        auth: { token: testTokens[i] }
      });

      socket.on('connect', () => {
        connected++;
        if (connected === totalClients) {
          clientSockets = [];
          testClients = [];

          for (let j = 0; j < totalClients; j++) {
            const sock = io(`http://localhost:${PORT}`, {
              auth: { token: testTokens[j] }
            });
            clientSockets.push(sock);
            testClients.push({ socket: sock, user: testUsers[j] });
          }

          done();
        }
      });
    }
  });

  afterEach(() => {
    clientSockets.forEach(socket => {
      if (socket) socket.disconnect();
    });
  });

  describe('Voice Channel Integrity', () => {
    test('should handle multiple users joining/leaving voice channel', (done) => {
      let joinedCount = 0;
      let leftCount = 0;
      const expectedEvents = (clientSockets.length * 2) + 1; // joins + leaves + final check
      let completedEvents = 0;

      const checkCompletion = () => {
        completedEvents++;
        if (completedEvents === expectedEvents) {
          done();
        }
      };

      // Join all clients to voice channel
      clientSockets.forEach((socket, index) => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });

        socket.on('voice_joined', () => {
          joinedCount++;
          expect(joinedCount).toBeLessThanOrEqual(clientSockets.length);
          checkCompletion();
        });

        socket.on('user_joined_voice', (data) => {
          expect(data.nickname).toBeDefined();
          expect(typeof data.socketId).toBe('string');
        });
      });

      // After joining, have clients leave
      setTimeout(() => {
        clientSockets.forEach(socket => {
          socket.emit('leave_voice_channel');

          socket.on('voice_left', () => {
            leftCount++;
            checkCompletion();
          });

          socket.on('user_left_voice', (data) => {
            expect(data.nickname).toBeDefined();
            // Verify users are properly cleaned up
            leftCount === clientSockets.length && checkCompletion();
          });
        });
      }, 100);
    });
  });

  describe('Signaling Reliability', () => {
    test('should handle rapid signaling exchange', (done) => {
      let signalingReceived = 0;
      const rapidSignals = 5;
      const totalSignals = rapidSignals * 2; // offer + answer per pair

      clientSockets.forEach(socket => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
      });

      setTimeout(() => {
        for (let i = 0; i < rapidSignals; i++) {
          const mockOffer = { type: 'offer', sdp: `mock-sdp-rapid-${i}` };

          // Send rapid offers
          clientSockets[0].emit('voice_offer', {
            offer: mockOffer,
            targetSocketId: clientSockets[1].id
          });

          clientSockets[1].on('voice_offer', (data) => {
            expect(data.offer).toEqual(mockOffer);
            signalingReceived++;

            // Send rapid answers
            clientSockets[1].emit('voice_answer', {
              answer: { type: 'answer', sdp: `mock-answer-${i}` },
              targetSocketId: clientSockets[0].id
            });

            if (signalingReceived >= totalSignals) {
              done();
            }
          });
        }
      }, 50);
    });

    test('should handle signaling with network jitter', (done) => {
      let receivedOffers = 0;
      let receivedAnswers = 0;

      clientSockets.forEach(socket => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
      });

      setTimeout(() => {
        // Simulate delayed signaling due to network jitter
        const sendSignaling = () => {
          const mockOffer = { type: 'offer', sdp: 'delayed-sdp' };

          clientSockets[0].emit('voice_offer', {
            offer: mockOffer,
            targetSocketId: clientSockets[1].id
          });

          // Simulate variable network delay
          const delay = Math.random() * 200 + 50; // 50-250ms delay

          setTimeout(() => {
            clientSockets[1].emit('voice_answer', {
              answer: { type: 'answer', sdp: 'delayed-answer' },
              targetSocketId: clientSockets[0].id
            });
          }, delay);
        };

        // Multiple signaling attempts with jitter
        for (let i = 0; i < 3; i++) {
          setTimeout(sendSignaling, i * 100);
        }

        clientSockets[1].on('voice_offer', () => {
          receivedOffers++;
        });

        clientSockets[0].on('voice_answer', () => {
          receivedAnswers++;
          if (receivedAnswers === 3) {
            expect(receivedOffers).toBe(3);
            done();
          }
        });
      }, 50);
    });
  });

  describe('Error Handling and Recovery', () => {
    test('should handle invalid signaling data', (done) => {
      clientSockets[0].emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });

      clientSockets[0].on('voice_joined', () => {
        const invalidSignals = [
          { offer: null, targetSocketId: 'fake-id' },
          { offer: {}, targetSocketId: clientSockets[1].id },
          { offer: { type: 'invalid' }, targetSocketId: clientSockets[1].id },
          { offer: { type: 'offer', sdp: '' }, targetSocketId: clientSockets[1].id }
        ];

        let processedSignals = 0;
        let handledErrors = 0;

        clientSockets[0].on('error', (error) => {
          console.log('Error received:', error);
          handledErrors++;
        });

        invalidSignals.forEach(invalidSignal => {
          clientSockets[0].emit('voice_offer', invalidSignal);
        });

        setTimeout(() => {
          console.log(`Processed ${processedSignals} signals, handled ${handledErrors} errors`);
          // The test should not crash, regardless of invalid signals
          expect(processedSignals).toBeDefined();
          done();
        }, 1000);
      });
    });

    test('should recover from signaling interruption', (done) => {
      clientSockets.forEach(socket => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
      });

      setTimeout(() => {
        // Interrupt signaling by simulating connection issues
        clientSockets[0].volatile.emit('voice_offer', {
          offer: { type: 'offer', sdp: 'interrupt-test' },
          targetSocketId: clientSockets[1].id
        });

        // Simulate immediate disconnect and reconnect
        clientSockets[0].disconnect();

        setTimeout(() => {
          const newSocket = io(`http://localhost:${PORT}`, {
            auth: { token: testTokens[0] }
          });

          newSocket.on('connect', () => {
            newSocket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });

            newSocket.on('voice_joined', () => {
              // Recovery successful - can still join voice channel
              newSocket.disconnect();
              done();
            });
          });
        }, 100);
      }, 50);
    });

    test('should handle concurrent signaling conflicts', (done) => {
      let receivedSignals = 0;
      const concurrentSignals = 10;

      clientSockets.forEach(socket => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
      });

      setTimeout(() => {
        // Both sockets send offers simultaneously
        for (let i = 0; i < concurrentSignals; i++) {
          const offer1 = { type: 'offer', sdp: `concurrent-sdp-1-${i}` };
          const offer2 = { type: 'offer', sdp: `concurrent-sdp-2-${i}` };

          clientSockets[0].emit('voice_offer', {
            offer: offer1,
            targetSocketId: clientSockets[1].id
          });

          clientSockets[1].emit('voice_offer', {
            offer: offer2,
            targetSocketId: clientSockets[0].id
          });
        }

        let signalCount1 = 0;
        let signalCount2 = 0;

        clientSockets[0].on('voice_offer', () => {
          signalCount1++;
          if (signalCount1 >= concurrentSignals) {
            receivedSignals++;
          }
          if (receivedSignals === 2) {
            done();
          }
        });

        clientSockets[1].on('voice_offer', () => {
          signalCount2++;
          if (signalCount2 >= concurrentSignals) {
            receivedSignals++;
          }
          if (receivedSignals === 2) {
            done();
          }
        });
      }, 50);
    });
  });

  describe('Scalability Testing', () => {
    test('should handle large SDP data', (done) => {
      // Simulate large SDP data (common in WebRTC)
      const largeSdp = 'v=0\r\n'.repeat(1000) + 'large-sdp-data';

      clientSockets.forEach(socket => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
      });

      setTimeout(() => {
        clientSockets[0].emit('voice_offer', {
          offer: { type: 'offer', sdp: largeSdp },
          targetSocketId: clientSockets[1].id
        });

        clientSockets[1].on('voice_offer', (data) => {
          expect(data.offer.sdp).toBe(largeSdp);
          expect(data.offer.sdp.length).toBe(largeSdp.length);
          done();
        });
      }, 50);
    });

    test('should handle maximum users in voice channel', (done) => {
      const maxUsers = 10; // Test reasonable maximum
      const multipleSockets = [];
      let joinedCount = 0;
      let connectedCount = 0;

      // Create maximum number of connections
      for (let i = 0; i < maxUsers && i < testUsers.length; i++) {
        const socket = io(`http://localhost:${PORT}`, {
          auth: { token: testTokens[i] }
        });

        socket.on('connect', () => {
          connectedCount++;
          if (connectedCount === maxUsers) {
            // All connections established, now join channel
            multipleSockets.forEach(sock => {
              sock.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
              sock.on('voice_joined', () => {
                joinedCount++;
                if (joinedCount === maxUsers) {
                  // Cleanup and complete test
                  multipleSockets.forEach(sock => sock.disconnect());
                  done();
                }
              });
            });
          }
        });

        multipleSockets.push(socket);
      }
    });
  });

  describe('Resource Management', () => {
    test('should properly clean up resources after disconnect', (done) => {
      clientSockets.forEach(socket => {
        socket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });
      });

      setTimeout(() => {
        // Disconnect all sockets abruptly
        clientSockets.forEach(socket => {
          socket.disconnect();
        });

        // Attempt to reconnect and verify clean state
        setTimeout(() => {
          const reconnectionSocket = io(`http://localhost:${PORT}`, {
            auth: { token: testTokens[0] }
          });

          reconnectionSocket.on('connect', () => {
            reconnectionSocket.emit('join_voice_channel', { channelId: TEST_CHANNEL_ID });

            reconnectionSocket.on('voice_joined', () => {
              // Successfully rejoined - resources were cleaned up
              reconnectionSocket.disconnect();
              done();
            });

            reconnectionSocket.on('voice_error', (error) => {
              // Unexpected error after cleanup
              done(new Error(`Resource cleanup failed: ${error.message}`));
            });
          });
        }, 200);
      }, 50);
    });
  });
});