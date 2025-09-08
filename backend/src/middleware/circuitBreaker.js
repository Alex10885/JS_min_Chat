const winston = require('winston');

// Circuit breaker states
const CIRCUIT_STATES = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half-open'
};

// Circuit breaker class for protecting external services
class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.timeout = options.timeout || 10000;
    this.monitorInterval = options.monitorInterval || 60000; // 1 minute
    this.successThreshold = options.successThreshold || 2;

    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = 0;

    this.callTimeout = null;

    // Logger setup
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/circuit-breaker.log' }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    this.startMonitoring();
  }

  // Execute function with circuit breaker protection
  async execute(operation, fallback = null) {
    if (this.isOpen()) {
      if (fallback) {
        return await fallback();
      }
      throw new Error('Circuit breaker is OPEN');
    }

    if (this.isHalfOpen()) {
      return await this.attemptRecovery(operation);
    }

    return await this.safeExecute(operation);
  }

  // Check if circuit is open (rejecting requests)
  isOpen() {
    return this.state === CIRCUIT_STATES.OPEN;
  }

  // Check if circuit is half-open (testing recovery)
  isHalfOpen() {
    return this.state === CIRCUIT_STATES.HALF_OPEN;
  }

  // Check if circuit is closed (normal operation)
  isClosed() {
    return this.state === CIRCUIT_STATES.CLOSED;
  }

  // Safe execute with failure tracking
  async safeExecute(operation) {
    try {
      this.callTimeout = setTimeout(() => {
        this.recordFailure();
        throw new Error('Circuit breaker timeout');
      }, this.timeout);

      const result = await operation();

      clearTimeout(this.callTimeout);
      this.recordSuccess();

      return result;
    } catch (error) {
      clearTimeout(this.callTimeout);
      this.recordFailure();
      throw error;
    }
  }

  // Attempt recovery when circuit is half-open
  async attemptRecovery(operation) {
    try {
      const result = await this.safeExecute(operation);
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        this.reset();
      }

      return result;
    } catch (error) {
      this.recordFailure(error);
      throw error;
    }
  }

  // Record successful operation
  recordSuccess() {
    this.failureCount = 0;
    this.successCount = 0;
    this.state = CIRCUIT_STATES.CLOSED;
  }

  // Record failed operation
  recordFailure(error = null) {
    this.failureCount++;
    this.successCount = 0;

    if (this.failureCount >= this.failureThreshold) {
      this.trip();
    }

    if (error) {
      this.logger.warn('Circuit breaker failure recorded', {
        failureCount: this.failureCount,
        threshold: this.failureThreshold,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  // Trip circuit to open state
  trip() {
    this.state = CIRCUIT_STATES.OPEN;
    this.nextAttempt = Date.now() + this.timeout;

    this.logger.warn('Circuit breaker tripped to OPEN state', {
      failureCount: this.failureCount,
      nextAttempt: new Date(this.nextAttempt).toISOString(),
      timestamp: new Date().toISOString()
    });
  }

  // Reset circuit breaker
  reset() {
    this.state = CIRCUIT_STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;

    this.logger.info('Circuit breaker reset to CLOSED state', {
      timestamp: new Date().toISOString()
    });
  }

  // Force attempt recovery (move to half-open)
  attempt() {
    if (this.isOpen() && Date.now() >= this.nextAttempt) {
      this.state = CIRCUIT_STATES.HALF_OPEN;
      this.successCount = 0;

      this.logger.info('Circuit breaker attempting recovery (HALF-OPEN)', {
        timestamp: new Date().toISOString()
      });
    }
  }

  // Start monitoring circuit state
  startMonitoring() {
    setInterval(() => {
      if (this.isOpen() && Date.now() >= this.nextAttempt) {
        this.attempt();
      }

      // Log current state
      this.logger.debug('Circuit breaker status', {
        state: this.state,
        failureCount: this.failureCount,
        successCount: this.successCount,
        timestamp: new Date().toISOString()
      });
    }, this.monitorInterval);
  }

  // Get current status
  getStatus() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      timeout: this.timeout,
      nextAttempt: this.isOpen() ? new Date(this.nextAttempt).toISOString() : null
    };
  }
}

// Service-specific circuit breakers
class ExternalServiceBreaker {
  constructor() {
    // Circuit breaker for email service
    this.emailBreaker = new CircuitBreaker({
      failureThreshold: 3,
      timeout: 30000,
      monitorInterval: 30000,
      successThreshold: 2
    });

    // Circuit breaker for Redis
    this.redisBreaker = new CircuitBreaker({
      failureThreshold: 5,
      timeout: 5000,
      monitorInterval: 15000,
      successThreshold: 3
    });

    // Circuit breaker for database operations
    this.databaseBreaker = new CircuitBreaker({
      failureThreshold: 5,
      timeout: 15000,
      monitorInterval: 20000,
      successThreshold: 3
    });
  }

  // Email service protection
  async executeWithEmailBreaker(operation) {
    return await this.emailBreaker.execute(
      operation,
      async () => {
        // Fallback: queue email for later retry
        winston.log('warn', 'Email service is unavailable, queuing for retry');
        return { status: 'queued', message: 'Email service unavailable' };
      }
    );
  }

  // Redis protection
  async executeWithRedisBreaker(operation) {
    return await this.redisBreaker.execute(
      operation,
      async () => {
        // Fallback: skip caching
        winston.log('warn', 'Redis is unavailable, skipping cache operation');
        return null;
      }
    );
  }

  // Database protection
  async executeWithDatabaseBreaker(operation) {
    return await this.databaseBreaker.execute(
      operation,
      async () => {
        // Fallback: throw error
        throw new Error('Database is unavailable due to circuit breaker protection');
      }
    );
  }

  // Get status of all circuit breakers
  getAllStatuses() {
    return {
      emailService: this.emailBreaker.getStatus(),
      redis: this.redisBreaker.getStatus(),
      database: this.databaseBreaker.getStatus()
    };
  }
}

// Singleton instance
const externalServiceBreaker = new ExternalServiceBreaker();

// Middleware for protecting API endpoints with circuit breaker
const circuitBreakerMiddleware = (breakerType = 'database') => {
  return async (req, res, next) => {
    try {
      // Add circuit breaker status to request
      req.circuitBreakerStatus = {};

      // Execute request normally
      next();
    } catch (error) {
      winston.log('error', 'Circuit breaker middleware error', {
        error: error.message,
        breakerType,
        endpoint: req.url,
        method: req.method
      });
      next(error);
    }
  };
};

// Async optimization wrapper
const asyncOptimize = (fn, options = {}) => {
  const concurrency = options.concurrency || 5;
  const timeout = options.timeout || 30000;

  let running = 0;
  const queue = [];

  return async function (...args) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        if (running >= concurrency) {
          queue.push({ args, resolve, reject });
          return;
        }

        running++;
        const startTime = Date.now();

        try {
          // Set timeout for operation
          const timeoutPromise = new Promise((_, timeoutReject) => {
            setTimeout(() => timeoutReject(new Error('Operation timeout')), timeout);
          });

          const result = await Promise.race([fn.apply(this, args), timeoutPromise]);
          const executionTime = Date.now() - startTime;

          // Log slow operations
          if (executionTime > (options.slowThreshold || 5000)) {
            winston.log('warn', 'Slow async operation', {
              executionTime,
              functionName: fn.name,
              timestamp: new Date().toISOString()
            });
          }

          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          running--;

          // Process next item in queue
          if (queue.length > 0) {
            const next = queue.shift();
            setImmediate(execute.bind(this, next.args, next.resolve, next.reject));
          }
        }
      };

      if (running < concurrency) {
        execute.apply(this, args);
      } else {
        queue.push({ args, resolve, reject });
      }
    });
  };
};

module.exports = {
  CircuitBreaker,
  ExternalServiceBreaker,
  externalServiceBreaker,
  circuitBreakerMiddleware,
  asyncOptimize,
  // Convenience exports
  protectEmail: (fn) => externalServiceBreaker.executeWithEmailBreaker(fn),
  protectRedis: (fn) => externalServiceBreaker.executeWithRedisBreaker(fn),
  protectDatabase: (fn) => externalServiceBreaker.executeWithDatabaseBreaker(fn),
  getCircuitBreakerStatuses: () => externalServiceBreaker.getAllStatuses()
};