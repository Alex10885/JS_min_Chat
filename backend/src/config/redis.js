const Redis = require('ioredis');
const config = require('./index');
const winston = require('winston');

class RedisManager {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.memoryCheckInterval = null;
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.json(),
      transports: [
        new winston.transports.Console({
          format: winston.format.simple()
        })
      ]
    });
  }

  async connect() {
    try {
      if (config.redis.enableCluster) {
        this.client = new Redis.Cluster([
          {
            host: config.redis.host,
            port: config.redis.port,
            password: config.redis.password,
            db: config.redis.db
          }
        ], {
          redisOptions: {
            keyPrefix: config.redis.keyPrefix,
            connectTimeout: config.redis.connectTimeout,
            commandTimeout: config.redis.commandTimeout,
            maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
            retryDelayOnFailover: config.redis.retryDelayOnFailover
          },
          clusterOptions: config.redis.cluster
        });
      } else {
        this.client = new Redis({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          db: config.redis.db,
          keyPrefix: config.redis.keyPrefix,
          connectTimeout: config.redis.connectTimeout,
          commandTimeout: config.redis.commandTimeout,
          maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
          retryDelayOnFailover: config.redis.retryDelayOnFailover
        });
      }

      this.client.on('connect', () => {
        this.isConnected = true;
        this.logger.info('Redis connected successfully');
      });

      this.client.on('error', (error) => {
        this.logger.error('Redis connection error:', error.message);
        this.isConnected = false;
      });

      this.client.on('ready', () => {
        this.logger.info('Redis client ready');
        this.startMemoryMonitoring();
      });

      this.client.on('close', () => {
        this.logger.info('Redis connection closed');
        this.isConnected = false;
        this.stopMemoryMonitoring();
      });

      // Wait for connection
      await this.client.ping();

      return this.client;
    } catch (error) {
      this.logger.error('Failed to connect to Redis:', error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.client) {
      this.stopMemoryMonitoring();
      await this.client.quit();
      this.isConnected = false;
      this.logger.info('Redis connection closed');
    }
  }

  getClient() {
    return this.client;
  }

  isClientReady() {
    return this.client && this.isConnected;
  }

  startMemoryMonitoring() {
    if (!config.redis.memoryMonitoring.enabled) {
      return;
    }

    this.memoryCheckInterval = setInterval(async () => {
      try {
        if (!this.isClientReady()) {
          return;
        }

        const memoryInfo = await this.client.info('memory');
        const usedMemory = parseInt(memoryInfo.split('\n')
          .find(line => line.startsWith('used_memory:'))
          .split(':')[1]);
        const maxMemory = await this.client.config('GET', 'maxmemory');

        if (maxMemory && maxMemory[1] !== '0') {
          const memoryPercentage = usedMemory / parseInt(maxMemory[1]);

          if (memoryPercentage >= config.redis.memoryMonitoring.thresholds.critical) {
            this.logger.error(`Redis memory usage critical: ${(memoryPercentage * 100).toFixed(2)}%`);
            // Trigger critical memory handling
            await this.handleMemoryPressure(true);
          } else if (memoryPercentage >= config.redis.memoryMonitoring.thresholds.warning) {
            this.logger.warn(`Redis memory usage high: ${(memoryPercentage * 100).toFixed(2)}%`);
            // Trigger warning memory handling
            await this.handleMemoryPressure(false);
          }
        }
      } catch (error) {
        this.logger.error('Error monitoring Redis memory:', error.message);
      }
    }, config.redis.memoryMonitoring.checkInterval);
  }

  stopMemoryMonitoring() {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
      this.memoryCheckInterval = null;
    }
  }

  async handleMemoryPressure(isCritical) {
    try {
      // Implement memory pressure handling logic
      if (isCritical) {
        // Aggressive cache cleanup
        await this.client.keys(`${config.redis.cachePrefix}*`)
          .then(keys => {
            if (keys.length > 0) {
              return this.client.del(keys);
            }
          });

        // Expire old sessions
        await this.client.keys(`${config.redis.sessionPrefix}*`)
          .then(async (keys) => {
            for (const key of keys) {
              const ttl = await this.client.ttl(key);
              if (ttl === -1 || ttl > 36000) { // Sessions older than 10 hours
                await this.client.expire(key, 3600); // Set to 1 hour
              }
            }
          });
      } else {
        // Normal cleanup - remove expired cache items
        await this.client.keys(`${config.redis.cachePrefix}*`)
          .then(async (keys) => {
            for (const key of keys) {
              const ttl = await this.client.ttl(key);
              if (ttl === -2) { // Expired keys
                await this.client.del(key);
              }
            }
          });
      }

      this.logger.info(`Memory pressure handling completed (critical: ${isCritical})`);
    } catch (error) {
      this.logger.error('Error handling memory pressure:', error.message);
    }
  }

  // Helper methods for common Redis operations
  async setSession(sessionId, data, ttl = config.redis.sessionTTL) {
    if (!this.isClientReady()) {
      throw new Error('Redis client not ready');
    }
    const key = `${config.redis.sessionPrefix}${sessionId}`;
    await this.client.set(key, JSON.stringify(data), 'EX', ttl);
  }

  async getSession(sessionId) {
    if (!this.isClientReady()) {
      return null;
    }
    const key = `${config.redis.sessionPrefix}${sessionId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(sessionId) {
    if (!this.isClientReady()) {
      return;
    }
    const key = `${config.redis.sessionPrefix}${sessionId}`;
    await this.client.del(key);
  }

  async setCache(key, data, ttl = config.redis.cacheTTL) {
    if (!this.isClientReady()) {
      throw new Error('Redis client not ready');
    }
    const cacheKey = `${config.redis.cachePrefix}${key}`;
    await this.client.set(cacheKey, JSON.stringify(data), 'EX', ttl);
  }

  async getCache(key) {
    if (!this.isClientReady()) {
      return null;
    }
    const cacheKey = `${config.redis.cachePrefix}${key}`;
    const data = await this.client.get(cacheKey);
    return data ? JSON.parse(data) : null;
  }

  async deleteCache(key) {
    if (!this.isClientReady()) {
      return;
    }
    const cacheKey = `${config.redis.cachePrefix}${key}`;
    await this.client.del(cacheKey);
  }

  async clearCache(pattern) {
    if (!this.isClientReady()) {
      return;
    }
    const cacheKeyPattern = `${config.redis.cachePrefix}${pattern}`;
    const keys = await this.client.keys(cacheKeyPattern);
    if (keys.length > 0) {
      await this.client.del(keys);
    }
  }
}

// Export a singleton instance
const redisManager = new RedisManager();

module.exports = {
  redisManager,
  client: () => redisManager.getClient(),
  connect: () => redisManager.connect(),
  disconnect: () => redisManager.disconnect(),
  isReady: () => redisManager.isClientReady(),
  // Convenience exports for common operations
  setSession: (sessionId, data, ttl) => redisManager.setSession(sessionId, data, ttl),
  getSession: (sessionId) => redisManager.getSession(sessionId),
  deleteSession: (sessionId) => redisManager.deleteSession(sessionId),
  setCache: (key, data, ttl) => redisManager.setCache(key, data, ttl),
  getCache: (key) => redisManager.getCache(key),
  deleteCache: (key) => redisManager.deleteCache(key),
  clearCache: (pattern) => redisManager.clearCache(pattern)
};