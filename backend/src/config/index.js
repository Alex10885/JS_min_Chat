require('dotenv').config();

const config = {
  server: {
    port: process.env.PORT || 3001,
    nodeEnv: process.env.NODE_ENV || 'development',
    host: '0.0.0.0'
  },
  database: {
    mongoUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/chatjs'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    db: process.env.REDIS_DB || 0,
    keyPrefix: 'chatjs:',
    sessionPrefix: 'session:',
    userPrefix: 'user:',
    cachePrefix: 'cache:',
    queryPrefix: 'query:', // For query result caching
    connectTimeout: 10000,
    commandTimeout: 10000,
    maxRetriesPerRequest: 3,
    retryDelayOnFailover: 100,
    sessionTTL: process.env.REDIS_SESSION_TTL || 3600, // 1 hour
    cacheTTL: process.env.REDIS_CACHE_TTL || 1800, // 30 minutes
    enableCluster: process.env.REDIS_CLUSTER_ENABLED === 'true',
    cluster: process.env.REDIS_CLUSTER_ENABLED === 'true' ? {
      nodeHashing: 'crc32',
      hashSlots: 16384,
      slots: [
        [0, 5460],
        [5461, 10922],
        [10923, 16383]
      ]
    } : null,
    memoryMonitoring: {
      enabled: true,
      thresholds: {
        warning: 0.8, // 80% memory usage
        critical: 0.9  // 90% memory usage
      },
      checkInterval: 300000 // 5 minutes
    }
  },
  security: {
    jwtSecret: process.env.JWT_SECRET,
    sessionSecret: process.env.SESSION_SECRET || 'your-very-long-secure-secret-key-change-in-production',
    corsOrigins: process.env.NODE_ENV === 'production'
      ? (process.env.ALLOWED_ORIGINS?.split(',') || false)
      : ["http://localhost:3003", "http://localhost:3000"]
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxAuth: process.env.NODE_ENV === 'test' ? 20000 : 10,
    maxAuthAuthenticated: process.env.NODE_ENV === 'test' ? 20000 : 50, // Higher limit for authenticated users
    maxAuthAnonymous: process.env.NODE_ENV === 'test' ? 20000 : 5, // Lower limit for anonymous users
    maxApi: 200,
    maxGeneral: 2000,
    maxPasswordReset: 5,
    maxGeographic: 100, // For geographic-based limiting
    enableProgressiveDelay: true
  },
  swagger: {
    title: 'Chat-JS API',
    version: '1.0.0'
  },
  logger: {
    level: 'info'
  }
};

module.exports = config;