const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const helmet = require('helmet');
const cors = require('cors');
const session = require('express-session');

// Import configurations
const config = require('../config');
const sessionConfig = require('../config/session');
const swaggerSpec = require('../config/swagger');

// Import middleware
const {
  authenticateSession
} = require('../middleware/auth');
const {
  errorHandler,
  requestLogger,
  debugLogger,
  notFoundHandler
} = require('../middleware/errorHandler');

// Import security middleware
const { geographicRateLimiter, sessionFingerprint, checkSessionInactivity } = require('../middleware/security');

// Import rate limiters
const {
  generalRateLimiter
} = require('../config/rateLimit');

// Import routes
const authRoutes = require('../routes/auth');
const userRoutes = require('../routes/users');
const channelRoutes = require('../routes/channels');

// Import services
const channelService = require('../services/channelService');
const { connectDB } = require('../../db/connection');

// Import utils
const SocketService = require('../services/socketService');

class Server {
  constructor(options = {}) {
    this.app = null;
    this.server = null;
    this.io = null;
    this.socketService = null;
    this.logger = null;

    this.port = options.port || config.server.port;
    this.host = options.host || config.server.host;
    this.nodeEnv = options.nodeEnv || config.server.nodeEnv;

    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      throw new Error('Server already initialized');
    }

    try {
      await this._setupLogger();
      await this._setupDatabase();
      await this._setupExpress();
      await this._setupSecurity();
      await this._setupMiddleware();
      await this._setupRoutes();
      await this._setupSocketIO();
      await this._setupChannels();
      await this._setupErrorHandling();
      await this._setupSwagger();

      this.initialized = true;
      this.logger.info('Server initialized successfully');

    } catch (error) {
      this.logger?.error('Failed to initialize server:', error);
      throw error;
    }
  }

  async _setupLogger() {
    this.logger = winston.createLogger({
      level: config.logger.level,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: { service: 'chat-server' },
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
  }

  async _setupDatabase() {
    await connectDB();
    this.logger.info('Database connected');

    // Initialize Redis connection
    const { connect } = require('../config/redis');
    await connect();
    this.logger.info('Redis connected');
  }

  async _setupExpress() {
    this.app = express();
    this.server = http.createServer(this.app);

    // Basic middleware
    this.app.use(express.json({ limit: '20mb', strict: false }));
    this.app.use(express.urlencoded({ extended: true, limit: '20mb' }));

    this.logger.info('Express app initialized');
  }

  async _setupSecurity() {
    // CORS
    this.app.use(cors({
      origin: config.security.corsOrigins,
      credentials: true
    }));

    // Helmet with CSP
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"]
        }
      },
      crossOriginEmbedderPolicy: false
    }));

    // Session
    this.app.use(session(sessionConfig));

    this.logger.info('Security middleware configured');
  }

  async _setupMiddleware() {
    // Geographic rate limiting and session fingerprinting (early in pipeline)
    this.app.use(geographicRateLimiter);
    this.app.use(sessionFingerprint);
    this.app.use(checkSessionInactivity); // Check for session inactivity and destroy expired sessions

    // Session authentication (before rate limiting)
    this.app.use(authenticateSession);

    // Rate limiting
    this.app.use(generalRateLimiter);

    // Request logging
    this.app.use(requestLogger);
    this.app.use(debugLogger);

    this.logger.info('Application middleware configured');
  }

  async _setupRoutes() {
    // Authentication routes
    this.app.use('/api', authRoutes);

    // User management routes
    this.app.use('/api/users', userRoutes);

    // Channel routes
    this.app.use('/api/channels', channelRoutes);

    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        connections: this.socketService?.onlineUsers?.size || 0
      });
    });

    // Rate limit reset (development)
    this.app.post('/api/reset-ratelimit', (req, res) => {
      try {
        if (this.nodeEnv === 'development') {
          res.json({ success: true, message: 'Rate limiting reset for development' });
        } else {
          res.status(403).json({ success: false, message: 'Not allowed in production' });
        }
      } catch (error) {
        res.status(500).json({ success: false, error: 'Failed to reset rate limiting' });
      }
    });

    this.logger.info('Routes configured');
  }

  async _setupSocketIO() {
    this.io = socketIo(this.server, {
      cors: {
        origin: config.security.corsOrigins,
        methods: ["GET", "POST"],
        allowedHeaders: ["authorization", "content-type"],
        credentials: true
      },
      transports: ['websocket', 'polling'],
      connectTimeout: 20000,
      pingTimeout: 5000,
      pingInterval: 10000
    });

    // Socket authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const { csrfToken, sessionId: _sessionId } = socket.handshake.auth;
        const session = socket.request.session;

        if (!session || !session.authenticated || !session.userId) {
          return next(new Error('Session authentication required'));
        }

        if (!csrfToken || !session.csrfToken || csrfToken !== session.csrfToken) {
          return next(new Error('CSRF validation failed'));
        }

        const user = await require('../models/User').findById(session.userId);
        if (!user) {
          return next(new Error('User not found in session'));
        }

        // Check if user is banned
        if (user.isBanned()) {
          socket.emit('banned', {
            reason: user.banReason || 'You have been banned from the server',
            expires: user.banExpires
          });
          return next(new Error('User is banned'));
        }

        socket.userId = session.userId;
        socket.nickname = session.nickname;
        socket.role = session.role || 'member';

        return next();
      } catch (error) {
        this.logger.error('Socket authentication error:', error);
        return next(new Error('Socket authentication failed'));
      }
    });

    // Initialize socket service
    this.socketService = new SocketService(this.io);

    this.logger.info('Socket.IO configured');
  }

  async _setupChannels() {
    await channelService.createDefaultChannels();
    this.logger.info('Default channels created');
  }

  async _setupErrorHandling() {
    // Global error handler
    this.app.use(errorHandler);

    // 404 handler
    this.app.use(notFoundHandler);

    this.logger.info('Error handling configured');
  }

  async _setupSwagger() {
    const swaggerUi = require('swagger-ui-express');

    this.app.use('/api-docs', (req, res, next) => {
      res.removeHeader('Content-Security-Policy');
      next();
    }, swaggerUi.serve, swaggerUi.setup(swaggerSpec));

    this.app.get('/api-docs.json', (req, res) => {
      res.removeHeader('Content-Security-Policy');
      res.setHeader('Content-Type', 'application/json');
      res.send(swaggerSpec);
    });

    this.logger.info('Swagger configured');
  }

  async start() {
    if (!this.initialized) {
      await this.initialize();
    }

    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.port, this.host, () => {
          this.logger.info(`Server running on port ${this.port}`);
          console.log(`Server running on port ${this.port}`);
          resolve();
        });
      } catch (error) {
        this.logger.error('Failed to start server:', error);
        reject(error);
      }
    });
  }

  async shutdown() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            this.logger?.error('Server close error:', err);
          } else {
            this.logger?.info('Server shut down successfully');
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getApp() {
    return this.app;
  }

  getServer() {
    return this.server;
  }

  getIO() {
    return this.io;
  }
}

module.exports = Server;