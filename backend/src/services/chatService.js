const Message = require('../models/Message');
const Channel = require('../models/Channel');
const User = require('../models/User');
const { logger } = require('../middleware/auth');
const {
  getCachedChannelMessages,
  cacheChannelMessages,
  getConnectionMetrics
} = require('./cacheService');
const { trackQueryPerformance } = require('../../db/connection');

class ChatService {
  constructor() {
    this.logger = logger;
    this.queryCache = new Map(); // Simple in-memory cache for small datasets
  }

  /**
   * Optimized method to get channels without N+1 queries
   * @param {Array} channelIds - Array of channel IDs
   * @returns {Promise<Map>} - Map of channel objects
   */
  async getChannelsBatch(channelIds) {
    if (!channelIds || channelIds.length === 0) {
      return new Map();
    }

    try {
      const channels = await Channel.find({
        id: { $in: channelIds }
      }).select('id name type description');

      // Convert to Map for easy lookup
      const channelMap = new Map();
      for (const channel of channels) {
        channelMap.set(channel.id, channel);
      }

      return channelMap;
    } catch (error) {
      this.logger.error('Error in getChannelsBatch:', error);
      throw error;
    }
  }

  /**
   * Optimized method to check user status (banned/muted) in batch
   * @param {Array} userIds - Array of user IDs
   * @returns {Promise<Map>} - Map of user status objects
   */
  async getUsersStatusBatch(userIds) {
    if (!userIds || userIds.length === 0) {
      return new Map();
    }

    try {
      const users = await User.find({
        nickname: { $in: userIds }
      }).select('nickname isBanned isMuted');

      const userMap = new Map();
      for (const user of users) {
        userMap.set(user.nickname, {
          isBanned: user.isBanned,
          isMuted: user.isMuted,
          exists: true
        });
      }

      // Mark non-existent users
      for (const userId of userIds) {
        if (!userMap.has(userId)) {
          userMap.set(userId, {
            isBanned: false,
            isMuted: false,
            exists: false
          });
        }
      }

      return userMap;
    } catch (error) {
      this.logger.error('Error in getUsersStatusBatch:', error);
      throw error;
    }
  }

  async saveMessage(messageData) {
    try {
      const { author, channel, text, type, target } = messageData;

      const message = new Message({
        author,
        channel,
        text,
        type: type || 'public',
        target
      });

      await message.save();

      this.logger.debug(`Message saved from ${author} in ${channel}`);
      return message;
    } catch (error) {
      this.logger.error('Error saving message:', error);
      throw error;
    }
  }

  async getChannelHistory(channelId, limit = 100, page = 1) {
    try {
      // Check cache first
      const cachedMessages = await getCachedChannelMessages(channelId, page, limit);
      if (cachedMessages) {
        this.logger.debug(`Channel history cache hit for ${channelId}`);
        return cachedMessages;
      }

      // Verify channel exists (batch operation)
      const channels = await this.getChannelsBatch([channelId]);
      const channel = channels.get(channelId);

      if (!channel) {
        throw new Error('Channel not found');
      }

      // Use aggregation pipeline for optimized query
      const history = await Message.aggregate([
        {
          $match: {
            channel: channelId,
            type: { $in: ['public', 'system'] }
          }
        },
        {
          $sort: { timestamp: -1 }
        },
        {
          $limit: limit * page
        },
        {
          $sort: { timestamp: 1 }
        },
        {
          $skip: (page - 1) * limit
        },
        {
          $project: {
            _id: 0, // Exclude MongoDB _id
            author: 1,
            channel: 1,
            text: 1,
            type: 1,
            target: 1,
            timestamp: 1
          }
        }
      ]);

      // Format messages for response
      const formattedHistory = history.map(msg => ({
        author: msg.author,
        room: msg.channel,
        text: msg.text,
        type: msg.type,
        target: msg.target,
        timestamp: msg.timestamp
      }));

      // Cache the result asynchronously (don't wait)
      cacheChannelMessages(channelId, formattedHistory, page, limit).catch(error =>
        this.logger.warn('Failed to cache channel messages:', error.message)
      );

      this.logger.debug(`Retrieved ${formattedHistory.length} messages for channel ${channelId}`);
      return formattedHistory;
    } catch (error) {
      this.logger.error('Error getting channel history:', error);
      throw error;
    }
  }

  async getUserChannelHistory(channelId, userNickname, limit = 100) {
    try {
      const history = await Message.find({
        channel: channelId,
        $or: [
          { type: 'public' },
          { type: 'system' },
          { author: userNickname },
          { target: userNickname }
        ]
      })
        .sort({ timestamp: -1 })
        .limit(limit)
        .sort({ timestamp: 1 });

      return history.map(msg => ({
        author: msg.author,
        room: msg.channel,
        text: msg.text,
        type: msg.type,
        target: msg.target,
        timestamp: msg.timestamp
      }));
    } catch (error) {
      this.logger.error('Error getting user channel history:', error);
      throw error;
    }
  }

  async joinChannel(socket, channelId, io) {
    try {
      // Optimized: Verify channel exists using batch query (removes N+1)
      const channels = await this.getChannelsBatch([channelId]);
      const channel = channels.get(channelId);

      if (!channel) {
        throw new Error('Channel not found');
      }

      // Leave previous room
      if (socket.room) {
        socket.leave(socket.room);
      }

      socket.room = channelId;
      socket.join(socket.room);

      this.logger.info(`User ${socket.nickname} joined room ${socket.room}`, {
        channelId,
        connectionMetrics: getConnectionMetrics()
      });

      // Send system message about joining
      const joinMessage = new Message({
        author: 'System',
        channel: socket.room,
        text: `${socket.nickname} joined the channel.`,
        type: 'system'
      });

      await joinMessage.save();

      io.to(socket.room).emit('message', {
        author: joinMessage.author,
        channel: joinMessage.channel,
        text: joinMessage.text,
        type: joinMessage.type,
        timestamp: joinMessage.timestamp
      });

      // Send message history
      const history = await this.getUserChannelHistory(channelId, socket.nickname);

      return { channel, history };
    } catch (error) {
      this.logger.error('Error joining channel:', error);
      throw error;
    }
  }

  async leaveChannel(socket, io) {
    try {
      if (socket.room) {
        // Create leave message
        const leaveMessage = new Message({
          author: 'System',
          channel: socket.room,
          text: `${socket.nickname} left the channel.`,
          type: 'system'
        });
        await leaveMessage.save();

        io.to(socket.room).emit('message', {
          author: leaveMessage.author,
          room: leaveMessage.channel,
          text: leaveMessage.text,
          type: leaveMessage.type,
          timestamp: leaveMessage.timestamp
        });
      }
    } catch (error) {
      this.logger.error('Error leaving channel:', error);
      throw error;
    }
  }

  async sendPublicMessage(socket, data, io) {
    try {
      // Validate input first
      if (!socket.room || !data.text?.trim()) {
        throw new Error('Invalid message data');
      }

      const trimmedText = data.text.trim();

      // Optimized: Check user status in batch (removes N+1 query)
      const userStatuses = await this.getUsersStatusBatch([socket.nickname]);
      const userStatus = userStatuses.get(socket.nickname);

      if (!userStatus.exists) {
        throw new Error('User not found');
      }

      if (userStatus.isBanned) {
        throw new Error('You are banned and cannot send messages');
      }

      if (userStatus.isMuted) {
        throw new Error('You are muted and cannot send messages');
      }

      // Use connection monitoring for performance tracking
      const connectionMetrics = getConnectionMetrics();

      const message = await this.saveMessage({
        author: socket.nickname,
        channel: socket.room,
        text: trimmedText,
        type: 'public'
      });

      const messageData = {
        author: message.author,
        room: message.channel,
        text: message.text,
        timestamp: message.timestamp,
        status: 'delivered',
        type: message.type,
        connectionStats: {
          activeConnections: connectionMetrics.activeCount,
          availableConnections: connectionMetrics.availableCount
        }
      };

      io.to(socket.room).emit('message', messageData);

      // Log performance metrics occasionally
      if (Math.random() < 0.1) { // 10% sampling
        this.logger.info('Message sent performance', {
          channelId: socket.room,
          author: socket.nickname,
          connectionMetrics
        });
      }

      return messageData;
    } catch (error) {
      this.logger.error('Error sending public message:', error);
      throw error;
    }
  }

  async sendPrivateMessage(socket, data, onlineUsers, io) {
    try {
      const trimmedText = data.text.trim();
      const targetNickname = data.to.trim();

      if (!socket.room || !targetNickname || !trimmedText) {
        throw new Error('Invalid private message data');
      }

      // Optimized: Batch check for both sender and target users
      const userStatuses = await this.getUsersStatusBatch([socket.nickname, targetNickname]);
      const senderStatus = userStatuses.get(socket.nickname);
      const targetStatus = userStatuses.get(targetNickname);

      // Validate sender
      if (!senderStatus.exists) {
        throw new Error('Sender not found');
      }

      if (senderStatus.isBanned) {
        throw new Error('You are banned and cannot send messages');
      }

      if (senderStatus.isMuted) {
        throw new Error('You are muted and cannot send messages');
      }

      // Validate target
      if (!targetStatus || !targetStatus.exists) {
        throw new Error('Target user not found');
      }

      // Validate target nickname format
      if (targetNickname.length === 0 || targetNickname.length > 50) {
        throw new Error('Invalid target user nickname');
      }

      // Prevent self-messaging
      if (targetNickname === socket.nickname) {
        throw new Error('Cannot send private message to yourself');
      }

      // Find target user in same room
      const targetUser = Array.from(onlineUsers.values()).find(
        u => u.nickname === targetNickname && u.room === socket.room
      );

      if (!targetUser) {
        throw new Error(`User '${targetNickname}' is not available in this channel`);
      }

      const message = await this.saveMessage({
        author: socket.nickname,
        channel: socket.room,
        text: trimmedText,
        type: 'private',
        target: targetNickname
      });

      const messageData = {
        author: message.author,
        room: message.channel,
        text: message.text,
        timestamp: message.timestamp,
        type: message.type,
        target: message.target,
        status: 'delivered'
      };

      // Find target socket and send message
      const targetSocketId = Array.from(onlineUsers.keys()).find(
        id => onlineUsers.get(id).nickname === targetNickname
      );

      if (targetSocketId) {
        io.to(targetSocketId).emit('private_message', messageData);
      }

      // Send confirmation to sender (without target for privacy)
      socket.emit('private_message', {
        author: message.author,
        room: message.room,
        text: message.text,
        timestamp: message.timestamp,
        type: message.type,
        target: null, // Hide target from sender's confirmation
        status: 'sent'
      });

      this.logger.info(`Private message sent successfully`, {
        sender: socket.nickname,
        target: targetNickname,
        room: socket.room
      });

      return messageData;
    } catch (error) {
      this.logger.error('Error sending private message:', error);
      throw error;
    }
  }

  async getOnlineUsers(sockets, room) {
    try {
      const roomUsers = Array.from(sockets.values())
        .filter(u => u.room === room)
        .map(u => ({ nickname: u.nickname, role: u.role }));

      return roomUsers;
    } catch (error) {
      this.logger.error('Error getting online users:', error);
      return [];
    }
  }

  async createSystemMessage(channel, message, io) {
    try {
      const systemMessage = await this.saveMessage({
        author: 'System',
        channel,
        text: message,
        type: 'system'
      });

      io.to(channel).emit('message', {
        author: systemMessage.author,
        channel: systemMessage.channel,
        text: systemMessage.text,
        type: systemMessage.type,
        timestamp: systemMessage.timestamp
      });
    } catch (error) {
      this.logger.error('Error creating system message:', error);
      throw error;
    }
  }
}

module.exports = new ChatService();