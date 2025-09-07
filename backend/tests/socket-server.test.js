const http = require('http');
const socketIo = require('socket.io');
const express = require('express');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { connectDB, closeDB } = require('../db/connection');
const User = require('../models/User');
const Channel = require('../models/Channel');
const Message = require('../models/Message');

// Test server for Socket.IO integration tests
class SocketTestServer {
  constructor(port = 0) { // Use 0 to get random available port
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.io = socketIo(this.server, {
      cors: {
        origin: true,
        methods: ["GET", "POST"]
      }
    });

    this.onlineUsers = new Map();
    this.voiceChannels = new Map();

    this.setupExpress();
    this.setupSocketIO();
  }

  setupExpress() {
    this.app.use(cors());
    this.app.use(express.json());

    // Minimal auth route for getting tokens
    this.app.post('/test-login', async (req, res) => {
      try {
        const { nickname } = req.body;
        const user = await User.findOne({ nickname });

        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Set user as online for socket auth
        user.status = 'online';
        await user.save();

        const token = jwt.sign(
          { id: user._id, nickname: user.nickname, role: user.role },
          process.env.JWT_SECRET,
          { expiresIn: '24h' }
        );

        res.json({ token, user: { id: user._id, nickname: user.nickname, role: user.role } });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  setupSocketIO() {
    this.io.use(async (socket, next) => {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error('Authentication token required'));
      }

      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id);

        if (!user || user.status !== 'online') {
          return next(new Error('User not found or not online'));
        }

        socket.userId = decoded.id;
        socket.nickname = decoded.nickname;
        socket.role = decoded.role;
        return next();
      } catch (err) {
        return next(new Error('Authentication failed'));
      }
    });

    this.io.on('connection', (socket) => {
      // Track online user
      this.onlineUsers.set(socket.id, {
        userId: socket.userId,
        nickname: socket.nickname,
        role: socket.role,
        room: null
      });

      socket.on('join_room', async (data) => {
        const { room } = data;
        if (!room || typeof room !== 'string' || room.trim().length === 0) {
          socket.emit('error', {
            message: 'Invalid room name',
            code: 'INVALID_ROOM_FORMAT'
          });
          return;
        }

        try {
          const channel = await Channel.findOne({ id: room });
          if (!channel) {
            socket.emit('error', {
              message: `Channel '${room}' not found`,
              code: 'CHANNEL_NOT_FOUND'
            });
            return;
          }

          // Leave previous room
          if (socket.room) {
            socket.leave(socket.room);
            this.onlineUsers.set(socket.id, { ...this.onlineUsers.get(socket.id), room: null });
          }

          socket.room = room;
          socket.join(socket.room);

          this.onlineUsers.set(socket.id, {
            ...this.onlineUsers.get(socket.id),
            room: socket.room
          });

          // Send join system message
          const joinMessage = new Message({
            author: 'System',
            channel: socket.room,
            text: `${socket.nickname} joined the channel.`,
            type: 'system'
          });
          await joinMessage.save();

          this.io.to(socket.room).emit('message', {
            author: joinMessage.author,
            channel: joinMessage.channel,
            text: joinMessage.text,
            type: joinMessage.type,
            timestamp: joinMessage.timestamp
          });

          // Send online users
          const roomUsers = Array.from(this.onlineUsers.values())
            .filter(u => u.room === socket.room)
            .map(u => ({ nickname: u.nickname, role: u.role }));
          this.io.to(socket.room).emit('online_users', roomUsers);

          // Send message history
          const history = await Message.find({
            channel: socket.room,
            $or: [
              { type: 'public' },
              { type: 'system' },
              { author: socket.nickname },
              { target: socket.nickname }
            ]
          })
            .sort({ timestamp: -1 })
            .limit(100)
            .sort({ timestamp: 1 });

          socket.emit('history', history.map(msg => ({
            author: msg.author,
            room: msg.channel,
            text: msg.text,
            type: msg.type,
            target: msg.target,
            timestamp: msg.timestamp
          })));

        } catch (error) {
          socket.emit('error', { message: 'Failed to join room' });
        }
      });

      socket.on('message', async (data) => {
        if (!socket.room || !data.text?.trim()) return;

        try {
          const message = new Message({
            author: socket.nickname,
            channel: socket.room,
            text: data.text.trim(),
            type: 'public'
          });

          await message.save();

          const messageData = {
            author: message.author,
            room: message.channel,
            text: message.text,
            timestamp: message.timestamp,
            status: 'delivered',
            type: message.type
          };

          this.io.to(socket.room).emit('message', messageData);
        } catch (error) {
          socket.emit('error', { message: 'Failed to send message' });
        }
      });

      socket.on('speaking', (data) => {
        socket.to(socket.room).emit('speaking', {
          nickname: socket.nickname,
          speaking: data.speaking
        });
      });

      socket.on('join_voice_channel', async (data) => {
        const { channelId } = data;
        if (!channelId) return;

        try {
          const channel = await Channel.findOne({ id: channelId, type: 'voice' });
          if (!channel) {
            socket.emit('voice_error', { message: 'Voice channel not found' });
            return;
          }

          if (!this.voiceChannels.has(channelId)) {
            this.voiceChannels.set(channelId, new Map());
          }

          socket.to(channelId).emit('user_joined_voice', {
            nickname: socket.nickname,
            socketId: socket.id
          });

          socket.join(channelId);
          this.voiceChannels.get(channelId).set(socket.id, { peerConnection: null, stream: null });

          socket.voiceChannel = channelId;
          socket.emit('voice_joined', { channelId });

        } catch (error) {
          socket.emit('voice_error', { message: 'Failed to join voice channel' });
        }
      });

      socket.on('leave_voice_channel', () => {
        if (!socket.voiceChannel) return;

        const channelId = socket.voiceChannel;
        const channelPeers = this.voiceChannels.get(channelId);

        if (channelPeers) {
          channelPeers.delete(socket.id);
          if (channelPeers.size === 0) {
            this.voiceChannels.delete(channelId);
          }
        }

        socket.to(channelId).emit('user_left_voice', {
          nickname: socket.nickname,
          socketId: socket.id
        });

        socket.leave(channelId);
        socket.voiceChannel = null;
        socket.emit('voice_left');
      });

      // Voice signaling
      socket.on('voice_offer', (data) => {
        const { offer, targetSocketId } = data;
        socket.to(targetSocketId).emit('voice_offer', {
          offer,
          from: socket.id,
          fromNickname: socket.nickname
        });
      });

      socket.on('voice_answer', (data) => {
        const { answer, targetSocketId } = data;
        socket.to(targetSocketId).emit('voice_answer', {
          answer,
          from: socket.id,
          fromNickname: socket.nickname
        });
      });

      socket.on('ice_candidate', (data) => {
        const { candidate, targetSocketId } = data;
        socket.to(targetSocketId).emit('ice_candidate', {
          candidate,
          from: socket.id,
          fromNickname: socket.nickname
        });
      });

      socket.on('disconnect', async () => {
        // Leave voice channel if in one
        if (socket.voiceChannel) {
          const channelId = socket.voiceChannel;
          const channelPeers = this.voiceChannels.get(channelId);

          if (channelPeers) {
            channelPeers.delete(socket.id);
            if (channelPeers.size === 0) {
              this.voiceChannels.delete(channelId);
            }
          }

          socket.to(channelId).emit('user_left_voice', {
            nickname: socket.nickname,
            socketId: socket.id
          });
        }

        if (socket.room) {
          socket.leave(socket.room);

          const leaveMessage = new Message({
            author: 'System',
            channel: socket.room,
            text: `${socket.nickname} left the channel.`,
            type: 'system'
          });
          await leaveMessage.save();

          this.io.to(socket.room).emit('message', {
            author: leaveMessage.author,
            room: leaveMessage.channel,
            text: leaveMessage.text,
            type: leaveMessage.type,
            timestamp: leaveMessage.timestamp
          });

          const roomUsers = Array.from(this.onlineUsers.values())
            .filter(u => u.room === socket.room && u.userId !== socket.userId)
            .map(u => ({ nickname: u.nickname, role: u.role }));
          this.io.to(socket.room).emit('online_users', roomUsers);
        }

        this.onlineUsers.delete(socket.id);

        if (socket.userId) {
          await User.findByIdAndUpdate(socket.userId, {
            status: 'offline',
            lastActive: new Date()
          });
        }
      });
    });
  }

  async start() {
    console.log(`Starting socket server on port ${this.port}...`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout after 10 seconds'));
      }, 10000);

      this.server.listen(this.port, (err) => {
        clearTimeout(timeout);
        if (err) {
          console.error('Failed to start socket server:', err.message);
          reject(err);
        } else {
          const assignedPort = this.server.address().port;
          console.log(`Socket server successfully started on port ${assignedPort}`);
          resolve(assignedPort);
        }
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        this.onlineUsers.clear();
        this.voiceChannels.clear();
        resolve();
      });
    });
  }

  getPort() {
    return this.server.address()?.port;
  }
}

module.exports = SocketTestServer;