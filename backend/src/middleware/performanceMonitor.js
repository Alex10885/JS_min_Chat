const { performance, PerformanceObserver } = require('perf_hooks');
const { getCachedStats } = require('../config/redis');
const winston = require('winston');

// Performance monitoring middleware
class PerformanceMonitor {
  constructor() {
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      transports: [
        new winston.transports.File({ filename: 'logs/performance.log' }),
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        })
      ]
    });

    this.performanceObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      entries.forEach((entry) => {
        this.logPerformanceMetric(entry);
      });
    });

    this.performanceObserver.observe({ type: 'measure' });

    // Metrics storage (simple in-memory for performance)
    this.metrics = {
      responseTimes: [],
      endpointStats: new Map(),
      slowQueries: [],
      memoryUsage: [],
      throughput: 0,
      errors: 0,
      lastResetTime: Date.now()
    };

    this.alerts = {
      slowResponseThreshold: 5000, // 5 seconds
      highErrorRateThreshold: 0.1, // 10%
      highMemoryThreshold: 0.8 // 80%
    };
  }

  // Middleware for API endpoints
  apiPerformanceMiddleware() {
    return (req, res, next) => {
      const startTime = performance.now();
      const startMemory = process.memoryUsage().heapUsed;
      const endpoint = `${req.method} ${req.route?.path || req.url}`;

      // Log incoming request
      this.logger.debug('API Request Started', {
        method: req.method,
        url: req.url,
        endpoint,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        timestamp: new Date().toISOString()
      });

      res.on('finish', () => {
        const endTime = performance.now();
        const endMemory = process.memoryUsage().heapUsed;
        const responseTime = endTime - startTime;
        const memoryDelta = endMemory - startMemory;

        // Store metrics
        this.storeEndpointMetrics(endpoint, responseTime, memoryDelta, res.statusCode);

        // Log detailed performance data
        this.logger.info('API Response Performance', {
          endpoint,
          responseTime: `${responseTime.toFixed(2)}ms`,
          memoryDelta: `${(memoryDelta / 1024 / 1024).toFixed(2)}MB`,
          statusCode: res.statusCode,
          contentLength: res.get('Content-Length') || 0,
          userAgent: req.get('User-Agent'),
          ip: req.ip,
          timestamp: new Date().toISOString()
        });

        // Alert on slow responses
        if (responseTime > this.alerts.slowResponseThreshold) {
          this.logger.warn('⚠️ SLOW RESPONSE ALERT', {
            endpoint,
            responseTime: `${responseTime.toFixed(2)}ms`,
            threshold: `${this.alerts.slowResponseThreshold}ms`,
            recommendation: 'Consider optimization or caching'
          });
        }
      });

      res.on('error', (error) => {
        const endTime = performance.now();
        const responseTime = endTime - startTime;

        this.logger.error('API Request Error', {
          endpoint,
          responseTime: `${responseTime.toFixed(2)}ms`,
          error: error.message,
          stack: error.stack,
          ip: req.ip
        });

        this.metrics.errors++;
      });

      next();
    };
  }

  // Database query performance monitoring middleware
  dbQueryPerformanceMiddleware() {
    return async function dbQueryObserver(query, options) {
      const start = performance.mark('query-start');
      try {
        const result = await query();
        performance.mark('query-end');
        performance.measure('query-duration', 'query-start', 'query-end');

        const entries = performance.getEntriesByName('query-duration');
        if (entries.length > 0) {
          const duration = entries[0].duration;

          winston.log('info', 'Database Query Performance', {
            operation: query.constructor.name,
            collection: options?.collection?.name || 'unknown',
            query: JSON.stringify(options?.query || {}),
            duration: `${duration.toFixed(2)}ms`,
            timestamp: new Date().toISOString()
          });

          // Log slow queries
          if (duration > 1000) {
            winston.log('warn', 'SLOW QUERY ALERT', {
              operation: query.constructor.name,
              collection: options?.collection?.name || 'unknown',
              duration: `${duration.toFixed(2)}ms`,
              query: JSON.stringify(options?.query || {}),
              timestamp: new Date().toISOString(),
              recommendation: 'Consider adding indexes or optimizing query'
            });
          }
        }

        return result;
      } finally {
        performance.clearMarks('query-start');
        performance.clearMarks('query-end');
        performance.clearMeasures('query-duration');
      }
    };
  }

  // Store endpoint metrics for analytics
  storeEndpointMetrics(endpoint, responseTime, memoryDelta, statusCode) {
    // Update response times array (keep last 1000 entries)
    this.metrics.responseTimes.push(responseTime);
    if (this.metrics.responseTimes.length > 1000) {
      this.metrics.responseTimes.shift();
    }

    // Update endpoint statistics
    if (!this.metrics.endpointStats.has(endpoint)) {
      this.metrics.endpointStats.set(endpoint, {
        count: 0,
        totalTime: 0,
        avgTime: 0,
        minTime: responseTime,
        maxTime: responseTime,
        p95Time: 0,
        statusCodes: new Map(),
        memoryUsage: []
      });
    }

    const stats = this.metrics.endpointStats.get(endpoint);
    stats.count++;
    stats.totalTime += responseTime;
    stats.avgTime = stats.totalTime / stats.count;
    stats.minTime = Math.min(stats.minTime, responseTime);
    stats.maxTime = Math.max(stats.maxTime, responseTime);

    // Update status codes
    stats.statusCodes.set(statusCode, (stats.statusCodes.get(statusCode) || 0) + 1);

    // Store memory usage (keep last 100)
    stats.memoryUsage.push(memoryDelta);
    if (stats.memoryUsage.length > 100) {
      stats.memoryUsage.shift();
    }

    // Calculate P95 response time
    const sortedTimes = [...this.metrics.responseTimes].sort((a, b) => a - b);
    const p95Index = Math.floor(sortedTimes.length * 0.95);
    if (sortedTimes[p95Index]) {
      stats.p95Time = sortedTimes[p95Index];
    }
  }

  // Health check endpoint
  getHealthData() {
    const uptime = process.uptime();
    const memory = process.memoryUsage();

    return {
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${Math.floor(uptime % 60)}s`,
      memory: {
        used: `${(memory.heapUsed / 1024 / 1024).toFixed(2)}MB`,
        total: `${(memory.heapTotal / 1024 / 1024).toFixed(2)}MB`,
        percentage: `${((memory.heapUsed / memory.heapTotal) * 100).toFixed(2)}%`
      },
      requests: {
        total: this.metrics.responseTimes.length,
        averageResponseTime: this.calculateAverageResponseTime(),
        p95ResponseTime: this.calculateP95ResponseTime(),
        errors: this.metrics.errors
      },
      endpoints: Array.from(this.metrics.endpointStats.entries()).map(([endpoint, stats]) => ({
        endpoint,
        count: stats.count,
        avgTime: `${stats.avgTime.toFixed(2)}ms`,
        p95Time: `${stats.p95Time.toFixed(2)}ms`,
        minTime: `${stats.minTime.toFixed(2)}ms`,
        maxTime: `${stats.maxTime.toFixed(2)}ms`,
        memoryImpact: `${(stats.memoryUsage.reduce((a, b) => a + b, 0) / stats.memoryUsage.length / 1024 / 1024).toFixed(2)}MB avg`
      }))
    };
  }

  // Performance metrics calculation
  calculateAverageResponseTime() {
    if (this.metrics.responseTimes.length === 0) return 0;
    return this.metrics.responseTimes.reduce((a, b) => a + b, 0) / this.metrics.responseTimes.length;
  }

  calculateP95ResponseTime() {
    if (this.metrics.responseTimes.length === 0) return 0;
    const sorted = [...this.metrics.responseTimes].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.95)] || 0;
  }

  // Alert checking
  checkAlerts() {
    const avgResponseTime = this.calculateAverageResponseTime();
    const errorRate = this.metrics.errors / Math.max(this.metrics.responseTimes.length, 1);

    if (avgResponseTime > this.alerts.slowResponseThreshold) {
      this.logger.warn('🚨 PERFORMANCE ALERT: High average response time', {
        avgTime: `${avgResponseTime.toFixed(2)}ms`,
        threshold: `${this.alerts.slowResponseThreshold}ms`
      });
    }

    if (errorRate > this.alerts.highErrorRateThreshold) {
      this.logger.warn('🚨 ERROR RATE ALERT: High error rate', {
        errorRate: `${(errorRate * 100).toFixed(2)}%`,
        threshold: `${(this.alerts.highErrorRateThreshold * 100).toFixed(2)}%`
      });
    }

    const memoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
    if (memoryUsage > this.alerts.highMemoryThreshold) {
      this.logger.warn('🚨 MEMORY ALERT: High memory usage', {
        usage: `${(memoryUsage * 100).toFixed(2)}%`,
        threshold: `${(this.alerts.highMemoryThreshold * 100).toFixed(2)}%`
      });
    }
  }

  logPerformanceMetric(entry) {
    this.logger.debug('Performance Metric', {
      name: entry.name,
      duration: entry.duration,
      startTime: entry.startTime,
      detail: entry.detail || {}
    });
  }

  // Get detailed stats for monitoring dashboard
  getDetailedStats() {
    // Reset metrics periodically (every hour)
    const now = Date.now();
    if (now - this.metrics.lastResetTime > 3600000) {
      this.resetMetrics();
    }

    return {
      ...this.metrics,
      uptime: process.uptime(),
      cpu: process.cpuUsage(),
      memory: process.memoryUsage(),
      platform: process.platform,
      nodeVersion: process.version,
      pid: process.pid,
      environment: process.env.NODE_ENV
    };
  }

  // Reset metrics (for periodic cleanup)
  resetMetrics() {
    this.metrics.lastResetTime = Date.now();
    this.metrics.responseTimes = [];
    this.metrics.endpointStats.clear();
    this.metrics.slowQueries = [];
    this.metrics.errors = 0;

    this.logger.info('Performance metrics reset');
  }
}

// Export singleton instance
const performanceMonitor = new PerformanceMonitor();

// Health check route handler
const getHealthCheck = (req, res) => {
  try {
    const healthData = performanceMonitor.getHealthData();
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      ...healthData
    });
  } catch (error) {
    performanceMonitor.logger.error('Health check error:', error);
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Performance dashboard endpoint
const getPerformanceDashboard = (req, res) => {
  try {
    const detailedStats = performanceMonitor.getDetailedStats();
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      metrics: detailedStats,
      recommendations: generatePerformanceRecommendations(detailedStats)
    });
  } catch (error) {
    performanceMonitor.logger.error('Performance dashboard error:', error);
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

// Generate performance recommendations
function generatePerformanceRecommendations(metrics) {
  const recommendations = [];

  const avgResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
  if (avgResponseTime > 2000) {
    recommendations.push('Consider optimizing slow API endpoints (>2s avg)');
  }

  const memoryUsage = process.memoryUsage().heapUsed / process.memoryUsage().heapTotal;
  if (memoryUsage > 0.8) {
    recommendations.push('High memory usage detected - consider memory optimization');
  }

  if (metrics.errors / Math.max(metrics.responseTimes.length, 1) > 0.1) {
    recommendations.push('High error rate - investigate error causes');
  }

  if (recommendations.length === 0) {
    recommendations.push('Performance looks good! 👍');
  }

  return recommendations;
}

module.exports = {
  performanceMonitor,
  apiPerformanceMiddleware: () => performanceMonitor.apiPerformanceMiddleware(),
  dbQueryPerformanceMiddleware: () => performanceMonitor.dbQueryPerformanceMiddleware(),
  getHealthCheck,
  getPerformanceDashboard,
  generatePerformanceRecommendations
};