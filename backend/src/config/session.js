const { redisManager } = require('./redis');

// Custom Redis Session Store
class CustomRedisStore {
  constructor(options = {}) {
    this.prefix = options.prefix || 'session:';
    this.ttl = options.ttl || 3600;
  }

  async get(sessionId, callback) {
    try {
      if (!redisManager.isClientReady()) {
        return callback(null, null);
      }
      const sessionKey = this.prefix + sessionId;
      const sessionData = await redisManager.getCache(sessionKey);
      callback(null, sessionData);
    } catch (error) {
      callback(error);
    }
  }

  async set(sessionId, session, callback) {
    try {
      if (!redisManager.isClientReady()) {
        return callback();
      }
      const sessionKey = this.prefix + sessionId;
      await redisManager.setCache(sessionKey, session, this.ttl);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  async destroy(sessionId, callback) {
    try {
      if (!redisManager.isClientReady()) {
        return callback();
      }
      const sessionKey = this.prefix + sessionId;
      await redisManager.deleteCache(sessionKey);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  all(callback) {
    // For development/debugging only - expensive operation
    callback(null, {});
  }

  length(callback) {
    // For development/debugging only
    callback(null, 0);
  }

  clear(callback) {
    callback(null);
  }

  touch(sessionId, session, callback) {
    // Update TTL on touch (session access)
    this.set(sessionId, session, callback);
  }
}

const RedisStore = CustomRedisStore;
const config = require('./index');

const sessionConfig = {
  secret: config.security.sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new RedisStore({
    client: redisManager.getClient(),
    prefix: config.redis.keyPrefix + config.redis.sessionPrefix,
    ttl: config.redis.sessionTTL, // Use Redis TTL from config
    disableTouch: false, // Allow session touch updates
    touchAfter: 1 * 3600 // Limit session saves to every 1 hour to reduce Redis load
  }),
  cookie: {
    secure: config.server.nodeEnv === 'production', // HTTPS only in production
    httpOnly: true, // Prevent XSS access to cookie
    maxAge: 2 * 60 * 60 * 1000, // 2 hours active session time
    sameSite: 'strict' // Enhanced CSRF protection - stricter than 'lax'
  },
  name: 'chatSession', // Custom name to avoid default 'connect.sid'
  rolling: true, // Extend cookie expiration on each request (sliding expiration)
  rollingExpire: 2 * 60 * 60 * 1000, // Reset maxAge to 2 hours on activity
  unset: 'destroy' // Destroy session on logout
};

module.exports = sessionConfig;