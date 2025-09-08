const User = require('../models/User');
const chatService = require('./chatService');
const channelService = require('./channelService');
const { logger } = require('../middleware/auth');

class SocketService {
  constructor(io) {
    this.io = io;
    this.onlineUsers = new Map();
    this.userConnections = new Map();
    this.voiceChannels = new Map();

    // Setup socket handlers
    this.setupSocketHandlers();
    this.setupCleanup();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('🚀 Socket connection established');
      console.log(`👤 User ${socket.nickname} connected`);

      // Track online user
      this.onlineUsers.set(socket.id, {
        userId: socket.userId,
        nickname: socket.nickname,
        role: socket.role,
        room: null,
        lastHeartbeat: Date.now()
      });

      // Log current active connections count
      console.log(`📊 Active socket connections: ${this.onlineUsers.size} - auth success for ${socket.nickname}`);

      // Setup heartbeat
      this.setupHeartbeat(socket);

      // Register event handlers
      this.registerPublicMessageHandler(socket);
      this.registerPrivateMessageHandler(socket);
      this.registerJoinRoomHandler(socket);
      this.registerGetHistoryHandler(socket);
      this.registerVoiceChannelHandlers(socket);
      this.registerSpeakinHandler(socket);
      this.registerDisconnectHandler(socket);
    });
  }

  setupHeartbeat(socket) {
    const heartbeatInterval = setInterval(() => {
      if (socket.connected) {
        socket.emit('heartbeat_request');
      }
    }, 15000);

    socket.on('heartbeat', () => {
      const user = this.onlineUsers.get(socket.id);
      if (user) {
        const now = Date.now();
        user.lastHeartbeat = now;
        console.log(`💓 Heartbeat received from user ${socket.nickname} at ${new Date(now).toISOString()}`);
      }
    });

    // Handle heartbeat response from client (required for lower level heartbeat)
    socket.on('heartbeat_response', () => {
      const user = this.onlineUsers.get(socket.id);
      if (user) {
        const now = Date.now();
        user.lastHeartbeat = now;
        console.log(`💓 Heartbeat response received from user ${socket.nickname} at ${new Date(now).toISOString()}`);
      } else {
        logger.warn(`Heartbeat response received from unknown socket: ${socket.id}`);
      }
    });

    socket.on('disconnect', () => {
      clearInterval(heartbeatInterval);
    });
  }

  registerPublicMessageHandler(socket) {
    socket.on('message', async (data) => {
      this.updateHeartbeat(socket);
      if (!socket.room || !data.text?.trim()) return;

      try {
        const messageData = await chatService.sendPublicMessage(socket, data, this.io);
        if (messageData) {
          logger.debug(`Message sent from ${socket.nickname} in ${socket.room}`);
        }
      } catch (error) {
        logger.error('Error in public message handler:', error);
        socket.emit('error', { message: error.message });
      }
    });
  }

  registerPrivateMessageHandler(socket) {
    socket.on('private_message', async (data) => {
      this.updateHeartbeat(socket);

      try {
        const messageData = await chatService.sendPrivateMessage(socket, data, this.onlineUsers, this.io);
        if (messageData) {
          logger.debug(`Private message sent by ${socket.nickname}`);
        }
      } catch (error) {
        logger.error('Error in private message handler:', error);
        socket.emit('error', { message: error.message });
      }
    });
  }

  registerJoinRoomHandler(socket) {
    socket.on('join_room', async (data) => {
      this.updateHeartbeat(socket);
      const { room } = data;

      if (!room) {
        socket.emit('error', {
          message: 'Room name is required',
          code: 'MISSING_ROOM',
          timestamp: new Date().toISOString()
        });
        return;
      }

      if (typeof room !== 'string' || room.trim().length === 0) {
        socket.emit('error', {
          message: 'Invalid room name format',
          code: 'INVALID_ROOM_FORMAT',
          timestamp: new Date().toISOString()
        });
        return;
      }

      try {
        const { channel, history } = await chatService.joinChannel(socket, room, this.io);

        // Update tracking
        const user = this.onlineUsers.get(socket.id);
        if (user) {
          user.room = room;
        }

        socket.emit('history', history.map(msg => ({
          author: msg.author,
          room: msg.channel,
          text: msg.text,
          type: msg.type,
          target: msg.target,
          timestamp: msg.timestamp
        })));

        socket.emit('online_users', await chatService.getOnlineUsers(this.onlineUsers, socket.room));
        logger.info(`User ${socket.nickname} joined room ${room}`);

      } catch (error) {
        logger.error('Error joining room:', error);
        socket.emit('error', {
          message: error.message,
          code: 'JOIN_ROOM_FAILED',
          timestamp: new Date().toISOString()
        });
      }
    });
  }

  registerGetHistoryHandler(socket) {
    socket.on('get_history', async () => {
      if (!socket.room) {
        socket.emit('history', []);
        return;
      }

      try {
        const history = await chatService.getUserChannelHistory(socket.room, socket.nickname);
        socket.emit('history', history);
      } catch (error) {
        logger.error('Error getting history:', error);
        socket.emit('error', { message: 'Failed to load message history' });
      }
    });
  }

  registerVoiceChannelHandlers(socket) {
    socket.on('join_voice_channel', async (data) => {
      this.updateHeartbeat(socket);
      const { channelId } = data;
      if (!channelId) return;

      try {
        const channel = await channelService.getChannelById(channelId);
        if (!channel || channel.type !== 'voice') {
          socket.emit('voice_error', { message: 'Voice channel not found' });
          return;
        }

        if (!this.voiceChannels.has(channelId)) {
          this.voiceChannels.set(channelId, new Map());
        }

        const channelPeers = this.voiceChannels.get(channelId);
        socket.to(channelId).emit('user_joined_voice', { nickname: socket.nickname, socketId: socket.id });

        socket.join(channelId);
        channelPeers.set(socket.id, { peerConnection: null, stream: null });
        socket.voiceChannel = channelId;

        socket.emit('voice_joined', { channelId });
        logger.info(`User ${socket.nickname} joined voice channel ${channelId}`);

      } catch (error) {
        logger.error('Error joining voice channel:', error);
        socket.emit('voice_error', { message: 'Failed to join voice channel' });
      }
    });

    socket.on('leave_voice_channel', () => {
      this.updateHeartbeat(socket);
      if (!socket.voiceChannel) return;

      const channelId = socket.voiceChannel;
      const channelPeers = this.voiceChannels.get(channelId);

      if (channelPeers) {
        channelPeers.delete(socket.id);
        if (channelPeers.size === 0) {
          this.voiceChannels.delete(channelId);
        }
      }

      socket.to(channelId).emit('user_left_voice', { nickname: socket.nickname, socketId: socket.id });
      socket.leave(channelId);
      socket.voiceChannel = null;

      socket.emit('voice_left');
      logger.info(`User ${socket.nickname} left voice channel ${channelId}`);
    });

    // WebRTC signaling
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
  }

  registerSpeakinHandler(socket) {
    socket.on('speaking', (data) => {
      this.updateHeartbeat(socket);
      socket.to(socket.room).emit('speaking', { nickname: socket.nickname, speaking: data.speaking });
    });
  }

  registerDisconnectHandler(socket) {
    socket.on('disconnect', async () => {
      logger.info(`User ${socket.nickname} disconnected`);

      try {
        const userId = socket.userId;

        // Decrease connection count
        if (userId) {
          const currentCount = this.userConnections.get(userId) || 0;
          const newCount = Math.max(0, currentCount - 1);
          this.userConnections.set(userId, newCount);

          logger.info(`User ${socket.nickname} disconnected (remaining connections: ${newCount})`, {
            userId: userId,
            socketId: socket.id,
            connectionsLeft: newCount
          });
        }

        // Leave voice channel
        if (socket.voiceChannel) {
          const channelId = socket.voiceChannel;
          const channelPeers = this.voiceChannels.get(channelId);

          if (channelPeers) {
            channelPeers.delete(socket.id);
            if (channelPeers.size === 0) {
              this.voiceChannels.delete(channelId);
            }
          }

          socket.to(channelId).emit('user_left_voice', { nickname: socket.nickname, socketId: socket.id });
        }

        // Leave room
        await chatService.leaveChannel(socket, this.io);

        // Remove from tracking
        this.onlineUsers.delete(socket.id);

        logger.info(`After disconnect, active socket connections: ${this.onlineUsers.size}`);

        // Update user status
        if (userId) {
          const remainingConnections = this.userConnections.get(userId) || 0;
          if (remainingConnections === 0) {
            await User.findByIdAndUpdate(userId, {
              status: 'offline',
              lastActive: new Date()
            });
            console.log(`🔄 User ${socket.nickname} status set to offline (last connection)`);
            logger.info(`User status set to offline (last connection)`, {
              userId: userId,
              nickname: socket.nickname
            });
          } else {
            await User.findByIdAndUpdate(userId, {
              lastActive: new Date()
            });
            console.log(`✅ User ${socket.nickname} still online (${remainingConnections} connections left)`);
          }
        }

      } catch (error) {
        logger.error('Error in disconnect handler:', error);
      }
    });
  }

  updateHeartbeat(socket) {
    const user = this.onlineUsers.get(socket.id);
    if (user) {
      user.lastHeartbeat = Date.now();
    }
  }

  setupCleanup() {
    // Cleanup inactive connections every 30 seconds
    if (process.env.NODE_ENV !== 'test') {
      setInterval(() => {
        this.cleanupInactiveConnections();
      }, 30000);
    }
  }

  cleanupInactiveConnections() {
    const now = Date.now();
    const timeout = 60000; // 60 seconds timeout

    for (const [socketId, user] of this.onlineUsers.entries()) {
      if (now - user.lastHeartbeat > timeout) {
        console.log(`🧹 Cleansing dead connection for user ${user.nickname}`);

        const socket = this.io.sockets.sockets.get(socketId);
        if (socket) {
          socket.disconnect(true);
        }

        const connectionsLeft = (this.userConnections.get(user.userId) || 0) - 1;
        this.userConnections.set(user.userId, Math.max(0, connectionsLeft));

        if (connectionsLeft <= 0) {
          User.findByIdAndUpdate(user.userId, {
            status: 'offline',
            lastActive: new Date()
          }).catch(err => logger.error('Error updating status on cleanup:', err));

          console.log(`🔄 User ${user.nickname} status set to offline (dead connection)`);
        }

        this.onlineUsers.delete(socketId);
      }
    }
  }
}

module.exports = SocketService;