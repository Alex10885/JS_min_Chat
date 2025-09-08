const { redisManager } = require('../config/redis');
const config = require('../config');
const winston = require('winston');

class CacheService {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });

    this.cacheStats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0
    };
  }

  /**
   * Cache user data with automatic TTL
   * @param {string} userId - User ID
   * @param {Object} userData - User data to cache
   * @param {number} ttl - Time to live in seconds (optional, uses default)
   * @returns {Promise<boolean>} - Success status
   */
  async cacheUser(userId, userData, ttl = config.redis.cacheTTL) {
    try {
      const cacheKey = `${config.redis.userPrefix}${userId}`;
      await redisManager.setCache(cacheKey, userData, ttl);
      this.cacheStats.sets++;

      // Store user channel memberships for invalidation
      if (userData.channels) {
        const memberKey = `${config.redis.userPrefix}${userId}:channels`;
        await redisManager.setCache(memberKey, userData.channels, ttl);

        // Update reverse mapping (channel -> users)
        for (const channelId of userData.channels) {
          const membershipKey = `${config.redis.keyPrefix}channel:${channelId}:members`;
          await this.addUserToChannelCache(channelId, userId);
        }
      }

      this.logger.debug(`User data cached: ${cacheKey}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error caching user data:', error);
      return false;
    }
  }

  /**
   * Get cached user data with hit/miss tracking
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} - Cached user data or null
   */
  async getCachedUser(userId) {
    try {
      const cacheKey = `${config.redis.userPrefix}${userId}`;
      const cachedData = await redisManager.getCache(cacheKey);

      if (cachedData) {
        this.cacheStats.hits++;
        this.logger.debug(`Cache hit for user: ${userId}`);
      } else {
        this.cacheStats.misses++;
        this.logger.debug(`Cache miss for user: ${userId}`);
      }

      return cachedData;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error retrieving cached user data:', error);
      return null;
    }
  }

  /**
   * Invalidate user cache and related entries
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async invalidateUserCache(userId) {
    try {
      const cacheKey = `${config.redis.userPrefix}${userId}`;

      // Get user's channels before invalidating
      const membershipsKey = `${config.redis.userPrefix}${userId}:channels`;
      const channels = await redisManager.getCache(membershipsKey) || [];

      // Remove user from all channel membership caches
      for (const channelId of channels) {
        await this.removeUserFromChannelCache(channelId, userId);
      }

      // Delete all user-related cache entries
      await redisManager.deleteCache(cacheKey);
      await redisManager.deleteCache(membershipsKey);

      // Delete pattern-based entries (messages, activity, etc.)
      const userPattern = `${config.redis.userPrefix}${userId}:*`;
      await redisManager.clearCache(userPattern);

      this.cacheStats.deletes++;
      this.logger.debug(`User cache invalidated: ${userId}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error invalidating user cache:', error);
      return false;
    }
  }

  /**
   * Cache user activity and status
   * @param {string} userId - User ID
   * @param {Object} activity - Activity data (online status, last seen, etc.)
   * @returns {Promise<boolean>} - Success status
   */
  async cacheUserActivity(userId, activity) {
    try {
      const activityKey = `${config.redis.userPrefix}${userId}:activity`;
      await redisManager.setCache(activityKey, activity, config.redis.cacheTTL * 2); // Longer TTL for activity
      this.logger.debug(`User activity cached: ${userId}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error caching user activity:', error);
      return false;
    }
  }

  /**
   * Get cached user activity
   * @param {string} userId - User ID
   * @returns {Promise<Object|null>} - Cached activity data
   */
  async getCachedUserActivity(userId) {
    try {
      const activityKey = `${config.redis.userPrefix}${userId}:activity`;
      const activity = await redisManager.getCache(activityKey);

      if (activity) {
        this.cacheStats.hits++;
      } else {
        this.cacheStats.misses++;
      }

      return activity;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error retrieving cached user activity:', error);
      return null;
    }
  }

  /**
   * Cache channel data and memberships
   * @param {string} channelId - Channel ID
   * @param {Object} channelData - Channel data
   * @returns {Promise<boolean>} - Success status
   */
  async cacheChannel(channelId, channelData) {
    try {
      const cacheKey = `${config.redis.keyPrefix}channel:${channelId}`;
      await redisManager.setCache(cacheKey, channelData, config.redis.cacheTTL);

      if (channelData.members) {
        const membershipKey = `${cacheKey}:members`;
        await redisManager.setCache(membershipKey, channelData.members, config.redis.cacheTTL);
      }

      this.cacheStats.sets++;
      this.logger.debug(`Channel data cached: ${channelId}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error caching channel data:', error);
      return false;
    }
  }

  /**
   * Get cached channel data
   * @param {string} channelId - Channel ID
   * @returns {Promise<Object|null>} - Cached channel data
   */
  async getCachedChannel(channelId) {
    try {
      const cacheKey = `${config.redis.keyPrefix}channel:${channelId}`;
      const channelData = await redisManager.getCache(cacheKey);

      if (channelData) {
        this.cacheStats.hits++;
      } else {
        this.cacheStats.misses++;
      }

      return channelData;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error retrieving cached channel data:', error);
      return null;
    }
  }

  /**
   * Add user to channel membership cache
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async addUserToChannelCache(channelId, userId) {
    try {
      const membershipKey = `${config.redis.keyPrefix}channel:${channelId}:members`;
      let members = await redisManager.getCache(membershipKey) || [];

      if (!members.includes(userId)) {
        members.push(userId);
        await redisManager.setCache(membershipKey, members, config.redis.cacheTTL);
      }

      return true;
    } catch (error) {
      this.logger.error('Error adding user to channel cache:', error);
      return false;
    }
  }

  /**
   * Remove user from channel membership cache
   * @param {string} channelId - Channel ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} - Success status
   */
  async removeUserFromChannelCache(channelId, userId) {
    try {
      const membershipKey = `${config.redis.keyPrefix}channel:${channelId}:members`;
      let members = await redisManager.getCache(membershipKey) || [];

      members = members.filter(id => id !== userId);
      await redisManager.setCache(membershipKey, members, config.redis.cacheTTL);

      return true;
    } catch (error) {
      this.logger.error('Error removing user from channel cache:', error);
      return false;
    }
  }

  /**
   * Invalidate channel cache and related entries
   * @param {string} channelId - Channel ID
   * @returns {Promise<boolean>} - Success status
   */
  async invalidateChannelCache(channelId) {
    try {
      const channelKey = `${config.redis.keyPrefix}channel:${channelId}`;

      // Get members before invalidating
      const membershipKey = `${channelKey}:members`;
      const members = await redisManager.getCache(membershipKey) || [];

      // Remove channel from all user membership caches
      for (const userId of members) {
        const userChannelsKey = `${config.redis.userPrefix}${userId}:channels`;
        let userChannels = await redisManager.getCache(userChannelsKey) || [];
        userChannels = userChannels.filter(id => id !== channelId);
        await redisManager.setCache(userChannelsKey, userChannels, config.redis.cacheTTL);
      }

      // Delete channel cache entries
      await redisManager.deleteCache(channelKey);
      await redisManager.deleteCache(membershipKey);

      // Clear message cache for the channel
      const messagePattern = `${config.redis.keyPrefix}messages:${channelId}:*`;
      await redisManager.clearCache(messagePattern);

      this.cacheStats.deletes++;
      this.logger.debug(`Channel cache invalidated: ${channelId}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error invalidating channel cache:', error);
      return false;
    }
  }

  /**
   * Cache message for offline delivery
   * @param {string} messageId - Message ID
   * @param {Object} messageData - Message data
   * @param {string} channelId - Channel ID (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async cacheMessage(messageId, messageData, channelId = null) {
    try {
      const cacheKey = `${config.redis.keyPrefix}messages:${channelId || 'direct'}:${messageId}`;
      await redisManager.setCache(cacheKey, messageData, config.redis.cacheTTL);

      // Cache recent messages list for channel
      if (channelId) {
        const listKey = `${config.redis.keyPrefix}messages:${channelId}:list`;
        await this.addToRecentMessagesCache(listKey, messageId);
      }

      this.cacheStats.sets++;
      this.logger.debug(`Message cached: ${messageId}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error caching message:', error);
      return false;
    }
  }

  /**
   * Add message to recent messages cache (LRU-style)
   * @param {string} listKey - Redis key for messages list
   * @param {string} messageId - Message ID
   * @returns {Promise<boolean>} - Success status
   */
  async addToRecentMessagesCache(listKey, messageId) {
    try {
      // Use Redis list with fixed size (recent 50 messages per channel)
      const maxSize = 50;

      // Add to list (left push)
      await redisManager.client.lpush(listKey, messageId);

      // Trim to keep only recent messages
      await redisManager.client.ltrim(listKey, 0, maxSize - 1);

      // Set TTL for the list
      await redisManager.client.expire(listKey, config.redis.cacheTTL);

      return true;
    } catch (error) {
      this.logger.error('Error managing recent messages cache:', error);
      return false;
    }
  }

  /**
   * Get recent messages cache for channel
   * @param {string} channelId - Channel ID
   * @returns {Promise<Array>} - Array of message IDs
   */
  async getRecentMessagesCache(channelId) {
    try {
      const listKey = `${config.redis.keyPrefix}messages:${channelId}:list`;
      const messages = await redisManager.client.lrange(listKey, 0, -1);

      if (messages && messages.length > 0) {
        this.cacheStats.hits++;
        return messages;
      } else {
        this.cacheStats.misses++;
        return [];
      }
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error retrieving recent messages cache:', error);
      return [];
    }
  }

  /**
   * Clear all cache entries (emergency cleanup)
   * @returns {Promise<boolean>} - Success status
   */
  async clearAllCache() {
    try {
      // Clear all cache keys (but keep sessions)
      const patterns = [
        `${config.redis.userPrefix}*`,
        `${config.redis.cachePrefix}*`,
        `${config.redis.keyPrefix}channel:*`,
        `${config.redis.keyPrefix}messages:*`
      ];

      for (const pattern of patterns) {
        await redisManager.clearCache(pattern.replace(/\*/g, '*'));
      }

      this.logger.info('All cache cleared');
      return true;
    } catch (error) {
      this.logger.error('Error clearing cache:', error);
      return false;
    }
  }

  /**
   * Get cache performance statistics
   * @returns {Object} - Cache statistics
   */
  getCacheStats() {
    const stats = { ...this.cacheStats };
    const total = stats.hits + stats.misses;
    stats.hitRate = total > 0 ? (stats.hits / total * 100).toFixed(2) + '%' : '0%';
    stats.totalOperations = total + stats.sets + stats.deletes;
    return stats;
  }

  /**
   * Warm up cache with frequently accessed data
   * @param {Array} userIds - User IDs to preload
   * @param {Array} channelIds - Channel IDs to preload
   * @returns {Promise<boolean>} - Success status
   */
  async warmupCache(userIds = [], channelIds = []) {
    try {
      this.logger.info('Starting cache warmup...');

      // Load critical user data
      for (const userId of userIds) {
        // This would typically fetch from DB and cache
        this.logger.debug(`Warming up user cache: ${userId}`);
      }

      // Load critical channel data
      for (const channelId of channelIds) {
        // This would typically fetch from DB and cache
        this.logger.debug(`Warming up channel cache: ${channelId}`);
      }

      this.logger.info('Cache warmup completed');
      return true;
    } catch (error) {
      this.logger.error('Error during cache warmup:', error);
      return false;
    }
  }

  /**
   * Cache query result with TTL for database optimization
   * @param {string} queryKey - Unique key for the query
   * @param {Object|Array} result - Query result to cache
   * @param {number} ttl - Time to live in seconds (default: 5 minutes)
   * @returns {Promise<boolean>} - Success status
   */
  async cacheQueryResult(queryKey, result, ttl = 300) {
    try {
      const cacheKey = `${config.redis.queryPrefix}query:${queryKey}`;
      await redisManager.setCache(cacheKey, result, ttl);

      this.cacheStats.sets++;
      this.logger.debug(`Query result cached: ${queryKey}`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error caching query result:', error);
      return false;
    }
  }

  /**
   * Get cached query result
   * @param {string} queryKey - Query key
   * @returns {Promise<Object|Array|null>} - Cached result or null
   */
  async getCachedQueryResult(queryKey) {
    try {
      const cacheKey = `${config.redis.queryPrefix}query:${queryKey}`;
      const result = await redisManager.getCache(cacheKey);

      if (result !== null) {
        this.cacheStats.hits++;
        this.logger.debug(`Query cache hit: ${queryKey}`);
      } else {
        this.cacheStats.misses++;
        this.logger.debug(`Query cache miss: ${queryKey}`);
      }

      return result;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error retrieving cached query result:', error);
      return null;
    }
  }

  /**
   * Batch cache multiple channels for optimized queries
   * @param {Array} channels - Array of channel objects
   * @returns {Promise<boolean>} - Success status
   */
  async batchCacheChannels(channels) {
    try {
      const pipeline = redisManager.client.multi();

      for (const channel of channels) {
        const cacheKey = `${config.redis.keyPrefix}channel:${channel.id}`;
        pipeline.setex(cacheKey, config.redis.cacheTTL, JSON.stringify(channel));
      }

      await pipeline.exec();
      this.cacheStats.sets += channels.length;
      this.logger.debug(`Batch cached ${channels.length} channels`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error batch caching channels:', error);
      return false;
    }
  }

  /**
   * Batch get cached channels
   * @param {Array} channelIds - Array of channel IDs
   * @returns {Promise<Object>} - Map of found channels
   */
  async batchGetCachedChannels(channelIds) {
    try {
      const pipeline = redisManager.client.multi();
      const channelMap = new Map();

      for (const channelId of channelIds) {
        const cacheKey = `${config.redis.keyPrefix}channel:${channelId}`;
        pipeline.get(cacheKey);
      }

      const results = await pipeline.exec();

      channelIds.forEach((channelId, index) => {
        const result = results[index];
        if (result && result[1]) {
          try {
            const channel = JSON.parse(result[1]);
            channelMap.set(channelId, channel);
            this.cacheStats.hits++;
          } catch (parseError) {
            this.logger.warn(`Parse error for channel ${channelId}:`, parseError);
            this.cacheStats.errors++;
          }
        } else {
          this.cacheStats.misses++;
        }
      });

      this.logger.debug(`Batch retrieved ${channelMap.size}/${channelIds.length} channels from cache`);
      return channelMap;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error batch getting cached channels:', error);
      return new Map();
    }
  }

  /**
   * Expose connection monitor metrics to parent services
   * @returns {Object} - Connection metrics
   */
  getConnectionMetrics() {
    try {
      // Import the connection monitor when needed
      const { connectionMonitor } = require('../../db/connection');
      return connectionMonitor.getMetrics();
    } catch (error) {
      this.logger.error('Error getting connection metrics:', error);
      return {};
    }
  }

  /**
   * Cache channel messages with pagination support
   * @param {string} channelId - Channel ID
   * @param {Array} messages - Messages to cache
   * @param {number} page - Page number
   * @param {number} limit - Messages per page
   * @returns {Promise<boolean>} - Success status
   */
  async cacheChannelMessages(channelId, messages, page = 1, limit = 100) {
    try {
      const cacheKey = `${config.redis.keyPrefix}channel:${channelId}:messages:page${page}:limit${limit}`;
      await redisManager.setCache(cacheKey, messages, config.redis.cacheTTL);

      // Also add to recent messages list
      const recentKey = `${config.redis.keyPrefix}messages:${channelId}:recent`;
      if (messages.length > 0) {
        await this.addToRecentMessagesCache(recentKey, messages[0].id);
      }

      this.cacheStats.sets++;
      this.logger.debug(`Channel messages cached: ${channelId} (${messages.length} messages)`);
      return true;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error caching channel messages:', error);
      return false;
    }
  }

  /**
   * Get cached channel messages
   * @param {string} channelId - Channel ID
   * @param {number} page - Page number
   * @param {number} limit - Messages per page
   * @returns {Promise<Array|null>} - Cached messages or null
   */
  async getCachedChannelMessages(channelId, page = 1, limit = 100) {
    try {
      const cacheKey = `${config.redis.keyPrefix}channel:${channelId}:messages:page${page}:limit${limit}`;
      const messages = await redisManager.getCache(cacheKey);

      if (messages) {
        this.cacheStats.hits++;
        this.logger.debug(`Channel messages cache hit: ${channelId}`);
      } else {
        this.cacheStats.misses++;
        this.logger.debug(`Channel messages cache miss: ${channelId}`);
      }

      return messages;
    } catch (error) {
      this.cacheStats.errors++;
      this.logger.error('Error retrieving cached channel messages:', error);
      return null;
    }
  }

  /**
   * Get memory usage information from Redis
   * @returns {Promise<Object>} - Memory usage data
   */
  async getMemoryInfo() {
    try {
      if (!redisManager.isClientReady()) {
        throw new Error('Redis client not ready');
      }

      const info = await redisManager.client.info('memory');
      const usedMemory = parseInt(info.split('\n').find(line => line.startsWith('used_memory:')).split(':')[1]);
      const peakMemory = parseInt(info.split('\n').find(line => line.startsWith('used_memory_peak:')).split(':')[1]);

      return {
        used: usedMemory,
        peak: peakMemory,
        usagePercent: Math.round((usedMemory / peakMemory) * 100)
      };
    } catch (error) {
      this.logger.error('Error getting Redis memory info:', error);
      throw error;
    }
  }
}

// Export singleton instance
const cacheService = new CacheService();

module.exports = {
  cacheService,
  // Convenience exports
  cacheUser: (userId, data, ttl) => cacheService.cacheUser(userId, data, ttl),
  getCachedUser: (userId) => cacheService.getCachedUser(userId),
  invalidateUserCache: (userId) => cacheService.invalidateUserCache(userId),
  cacheChannel: (channelId, data) => cacheService.cacheChannel(channelId, data),
  getCachedChannel: (channelId) => cacheService.getCachedChannel(channelId),
  invalidateChannelCache: (channelId) => cacheService.invalidateChannelCache(channelId),
  cacheMessage: (messageId, data, channelId) => cacheService.cacheMessage(messageId, data, channelId),
  getRecentMessagesCache: (channelId) => cacheService.getRecentMessagesCache(channelId),
  clearAllCache: () => cacheService.clearAllCache(),
  getCacheStats: () => cacheService.getCacheStats(),
  warmupCache: (userIds, channelIds) => cacheService.warmupCache(userIds, channelIds),
  getMemoryInfo: () => cacheService.getMemoryInfo(),
  // Query result caching exports
  cacheQueryResult: (queryKey, result, ttl) => cacheService.cacheQueryResult(queryKey, result, ttl),
  getCachedQueryResult: (queryKey) => cacheService.getCachedQueryResult(queryKey),
  // Batch operations exports
  batchCacheChannels: (channels) => cacheService.batchCacheChannels(channels),
  batchGetCachedChannels: (channelIds) => cacheService.batchGetCachedChannels(channelIds),
  // Channel messages caching exports
  cacheChannelMessages: (channelId, messages, page, limit) => cacheService.cacheChannelMessages(channelId, messages, page, limit),
  getCachedChannelMessages: (channelId, page, limit) => cacheService.getCachedChannelMessages(channelId, page, limit),
  // Connection monitoring exports
  getConnectionMetrics: () => cacheService.getConnectionMetrics()
};