const io = require('socket.io-client');
const { connectDB, closeDB } = require('../db/connection');
const User = require('../models/User');
const jwt = require('jsonwebtoken');

let testUser;
let testToken;

const PORT = 3001;

describe('WebRTC Signaling Tests', () => {
  let clientSocket, secondSocket, secondToken, secondUser;

  beforeAll(async () => {
    await connectDB();

    testUser = new User({
      nickname: 'webrtcSocketTestUser',
      email: 'webrtc-socket@test.com',
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

  beforeEach((done) => {
    // Create second user for WebRTC signaling
    secondUser = new User({
      nickname: 'webrtcTestUser2',
      email: 'webrtc-test2@test.com',
      password: 'testpass123'
    });

    secondUser.save().then(() => {
      secondToken = jwt.sign(
        { id: secondUser._id, nickname: secondUser.nickname, role: secondUser.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      clientSocket = io(`http://localhost:${PORT}`, {
        auth: { token: testToken }
      });

      secondSocket = io(`http://localhost:${PORT}`, {
        auth: { token: secondToken }
      });

      let connected = 0;
      const onConnect = () => {
        connected++;
        if (connected === 2) {
          done();
        }
      };

      clientSocket.on('connect', onConnect);
      secondSocket.on('connect', onConnect);
    });
  });

  afterEach(() => {
    if (clientSocket) clientSocket.disconnect();
    if (secondSocket) secondSocket.disconnect();
  });

  test('should relay voice offer to target socket', (done) => {
    const mockOffer = { type: 'offer', sdp: 'mock-sdp-data' };

    clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

    clientSocket.on('voice_joined', () => {
      secondSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

      secondSocket.on('voice_joined', () => {
        // Second socket listens for offer
        secondSocket.on('voice_offer', (data) => {
          expect(data.offer).toEqual(mockOffer);
          expect(data.from).toBe(clientSocket.id);
          expect(data.fromNickname).toBe(testUser.nickname);
          done();
        });

        // First socket sends offer to second
        clientSocket.emit('voice_offer', {
          offer: mockOffer,
          targetSocketId: secondSocket.id
        });
      });
    });
  });

  test('should relay voice answer to target socket', (done) => {
    const mockAnswer = { type: 'answer', sdp: 'mock-answer-sdp' };

    clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });
    secondSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

    setTimeout(() => {
      secondSocket.on('voice_answer', (data) => {
        expect(data.answer).toEqual(mockAnswer);
        expect(data.from).toBe(clientSocket.id);
        expect(data.fromNickname).toBe(testUser.nickname);
        done();
      });

      clientSocket.emit('voice_answer', {
        answer: mockAnswer,
        targetSocketId: secondSocket.id
      });
    }, 100);
  });

  test('should relay ICE candidate to target socket', (done) => {
    const mockCandidate = { candidate: 'mock-ice-candidate', sdpMLineIndex: 0 };

    clientSocket.emit('join_voice_channel', { channelId: 'voice-chat' });
    secondSocket.emit('join_voice_channel', { channelId: 'voice-chat' });

    setTimeout(() => {
      secondSocket.on('ice_candidate', (data) => {
        expect(data.candidate).toEqual(mockCandidate);
        expect(data.from).toBe(clientSocket.id);
        expect(data.fromNickname).toBe(testUser.nickname);
        done();
      });

      clientSocket.emit('ice_candidate', {
        candidate: mockCandidate,
        targetSocketId: secondSocket.id
      });
    }, 100);
  });
});