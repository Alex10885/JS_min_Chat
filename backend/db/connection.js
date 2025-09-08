const mongoose = require('mongoose');
const winston = require('winston');
const { performance, PerformanceObserver } = require('perf_hooks');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'database' },
  transports: [
    new winston.transports.File({ filename: 'logs/database.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Connection pool metrics
let connectionMetrics = {
  activeCount: 0,
  inUseCount: 0,
  availableCount: 0,
  createdCount: 0,
  closedCount: 0,
  pendingCount: 0,
  lastHealthCheck: null,
  connectionLifetime: 0,
  averageQueryTime: 0,
  queriesPerSecond: 0
};

class ConnectionPoolMonitor {
  constructor() {
    this.metrics = connectionMetrics;
    this.healthCheckInterval = null;
    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        if (entry.name === 'mongodb-query') {
          this.updateQueryMetrics(entry.duration);
        }
      });
    });
    this.performanceObserver.observe({ type: 'measure' });
  }

  startHealthChecks(intervalMs = 30000) {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, intervalMs);
    logger.info('Connection pool health checks started');
  }

  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      logger.info('Connection pool health checks stopped');
    }
  }

  performHealthCheck() {
    try {
      const stats = mongoose.connection.db.stats();
      this.metrics.lastHealthCheck = new Date();
      logger.info('Connection pool health check passed', {
        activeConnections: this.metrics.activeCount,
        availableConnections: this.metrics.availableCount,
        pendingOperations: this.metrics.pendingCount
      });
    } catch (error) {
      logger.error('Connection pool health check failed:', error);
    }
  }

  updateQueryMetrics(duration) {
    this.metrics.averageQueryTime = (this.metrics.averageQueryTime + duration) / 2;
    this.metrics.queriesPerSecond = 1000 / duration; // approximate
  }

  updatePoolMetrics() {
    if (mongoose.connection.readyState === 1) {
      try {
        const poolSize = mongoose.connection.db.serverConfig.poolSize || 0;
        this.metrics.activeCount = poolSize;
        this.metrics.availableCount = Math.max(0, 20 - this.metrics.inUseCount); // assuming maxPoolSize = 20
        logger.debug('Pool metrics updated', this.metrics);
      } catch (error) {
        logger.warn('Failed to get pool metrics:', error.message);
      }
    }
  }

  getMetrics() {
    this.updatePoolMetrics();
    return { ...this.metrics };
  }
}

// Initialize connection monitor
const connectionMonitor = new ConnectionPoolMonitor();

const connectDB = async (retries = 5) => {
  for (let i = 1; i <= retries; i++) {
    try {
      const startTime = performance.now();

      const conn = await mongoose.connect(process.env.MONGODB_URI, {
        maxPoolSize: 20,           // Maximum 20 connections in the pool
        minPoolSize: 5,            // Maintain minimum 5 connections
        maxIdleTimeMS: 30000,      // Close connections after 30s of inactivity
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000, // Check health every 10 seconds
      });

      const connectTime = performance.now() - startTime;
      connectionMonitor.metrics.connectionLifetime = connectTime;

      logger.info(`MongoDB Connected: ${conn.connection.host} (${connectTime.toFixed(2)}ms)`);

      // Start connection monitoring
      connectionMonitor.startHealthChecks();

      // Handle connection events with enhanced tracking
      mongoose.connection.on('connectionCreated', (data) => {
        connectionMonitor.metrics.createdCount++;
        connectionMonitor.metrics.activeCount++;
        logger.info('Connection created', {
          totalCreated: connectionMonitor.metrics.createdCount,
          activeCount: connectionMonitor.metrics.activeCount
        });
      });

      mongoose.connection.on('connectionClosed', (data) => {
        connectionMonitor.metrics.closedCount++;
        connectionMonitor.metrics.activeCount = Math.max(0, connectionMonitor.metrics.activeCount - 1);
        logger.info('Connection closed', {
          totalClosed: connectionMonitor.metrics.closedCount,
          activeCount: connectionMonitor.metrics.activeCount
        });
      });

      mongoose.connection.on('connectionReady', (data) => {
        logger.debug('Connection ready for use');
      });

      mongoose.connection.on('connectionLeased', (data) => {
        connectionMonitor.metrics.inUseCount++;
        logger.debug(`Connection leased - In use: ${connectionMonitor.metrics.inUseCount}`);
      });

      mongoose.connection.on('connectionReturned', (data) => {
        connectionMonitor.metrics.inUseCount = Math.max(0, connectionMonitor.metrics.inUseCount - 1);
        logger.debug(`Connection returned - Available: ${connectionMonitor.metrics.availableCount}`);
      });

      mongoose.connection.on('error', (err) => {
        logger.error('Database connection error:', err);
      });

      mongoose.connection.on('disconnected', () => {
        connectionMonitor.stopHealthChecks();
        logger.warn('Database disconnected');

        // Enhanced reconnection strategy with exponential backoff
        setTimeout(() => {
          logger.info('Attempting automated reconnection...');
          connectDB(3); // 3 retries on disconnection
        }, 5000);
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('Database reconnected successfully');
        connectionMonitor.startHealthChecks(); // Restart health checks
      });

      mongoose.connection.on('reconnectFailed', (err) => {
        logger.error('Database reconnection failed:', err);
      });

      // Periodic pool status logging
      setInterval(() => {
        const metrics = connectionMonitor.getMetrics();
        logger.info('Connection Pool Status', {
          active: metrics.activeCount,
          inUse: metrics.inUseCount,
          available: metrics.availableCount,
          pending: metrics.pendingCount,
          averageQueryTime: `${metrics.averageQueryTime.toFixed(2)}ms`,
          queriesPerSecond: metrics.queriesPerSecond.toFixed(2)
        });
      }, 60000); // Log every minute

      return conn;
    } catch (error) {
      logger.error(`Database connection attempt ${i}/${retries} failed:`, error);

      if (i === retries) {
        logger.error('Database connection failed after all retries:', error);
        throw error; // Let the caller handle it
      }

      // Exponential backoff for retries
      const delay = Math.min(1000 * Math.pow(2, i - 1), 30000);
      logger.info(`Retrying database connection in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const closeDB = async () => {
  try {
    // Stop health checks before closing
    connectionMonitor.stopHealthChecks();

    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      logger.info('Database connection closed gracefully');
      logger.info('Final connection metrics:', connectionMonitor.getMetrics());
    } else {
      logger.info('Database connection was not open, no need to close');
    }
  } catch (error) {
    logger.error('Error closing database connection:', error);
    // Force close if graceful close fails
    try {
      mongoose.connection.close(true);
      logger.warn('Database connection force closed');
    } catch (forceError) {
      logger.error('Force close failed:', forceError);
    }
  }
};

// Utility function to get connection status
const getConnectionStatus = () => {
  return {
    isConnected: mongoose.connection.readyState === 1,
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host || null,
    database: mongoose.connection.name || null,
    metrics: connectionMonitor.getMetrics()
  };
};

// Middleware function to track query performance (can be used in routes)
const trackQueryPerformance = (queryName) => {
  return async (next) => {
    const start = performance.mark(`${queryName}-start`);
    try {
      const result = await next();
      const end = performance.mark(`${queryName}-end`);
      performance.measure(`${queryName}-duration`, `${queryName}-start`, `${queryName}-end`);
      return result;
    } catch (error) {
      performance.clearMarks(`${queryName}-start`);
      performance.clearMarks(`${queryName}-end`);
      throw error;
    }
  };
};

module.exports = {
  connectDB,
  closeDB,
  getConnectionStatus,
  trackQueryPerformance,
  connectionMonitor
};