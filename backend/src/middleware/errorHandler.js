const winston = require('winston');
const config = require('../config');

const logger = winston.createLogger({
  level: config.logger.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'chat-server-error-handler' },
  transports: [
    new winston.transports.File({ filename: 'logs/server.log' }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    })
  ]
});

// Error handling middleware
const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => ({
      field: e.path,
      message: e.message,
      value: e.value
    }));

    return res.status(422).json({
      error: 'Validation failed',
      details: errors,
      code: 'VALIDATION_ERROR'
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    return res.status(409).json({
      error: `${field} '${value}' already exists`,
      code: 'DUPLICATE_ERROR'
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid or expired token',
      code: 'INVALID_TOKEN'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token has expired',
      code: 'TOKEN_EXPIRED'
    });
  }

  // Default server error
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    requestId: req.id || 'unknown'
  });
};

// Request logging middleware
const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      user: req.user?.nickname || req.sessionUser?.nickname || 'anonymous',
      body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
    });
  });

  next();
};

// Log middleware to check incoming requests
const debugLogger = (req, res, next) => {
  logger.info(`🔍 Incoming request: ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    headers: req.headers
  });
  next();
};

// 404 handler
const notFoundHandler = (req, res) => {
  console.warn('❌ Final 404 handler executed - route not found!', { method: req.method, url: req.url });
  logger.warn(`404 - ${req.method} ${req.url}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.status(404).json({
    error: 'Endpoint not found',
    path: req.url,
    method: req.method,
    code: 'NOT_FOUND'
  });
};

module.exports = {
  errorHandler,
  requestLogger,
  debugLogger,
  notFoundHandler,
  logger
};