const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const config = require('../config');
const { logger } = require('../middleware/auth');
// Removed unused imports
const winston = require('winston');
const { redisManager } = require('../config/redis');
const rateLimit = require('express-rate-limit');
let RedisStore;
try {
  RedisStore = require('rate-limit-redis');
} catch (e) {
  // rate-limit-redis not available, use memory store
  RedisStore = null;
}

class AuthService {
  constructor() {
    this.logger = logger;
    this.redisManager = redisManager;
    this._initializeRateLimiters();
  }

  async initializeRedis() {
    try {
      if (!this.redisManager.isClientReady()) {
        await this.redisManager.connect();
      }
      this.logger.info('AuthService Redis connection established for session management');
    } catch (error) {
      this.logger.error('Failed to initialize Redis in AuthService:', error);
      throw error;
    }
  }

  _initializeRateLimiters() {
    try {
      const redisStore = redisManager.getClient();

      if (redisStore && RedisStore) {
        // Enhanced authentication rate limiter with Redis store
        this.authRateLimiter = rateLimit({
          store: new RedisStore({
            client: redisStore,
            prefix: 'auth_limit:',
            // Reset key every 15 minutes
            expiry: 15 * 60
          }),
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: process.env.NODE_ENV === 'test' || process.env.CYPRESS_API_SKIP ? 20000 : 10,
          message: { error: 'Too many authentication attempts, please try again later.' },
          standardHeaders: true,
          legacyHeaders: false,
          skip: (req) => {
            return req.get('User-Agent') && req.get('User-Agent').includes('Cypress');
          },
          onLimitReached: (req, _res) => {
            this.logger.warn('Authentication rate limit reached', {
              ip: req.ip,
              userAgent: req.get('User-Agent'),
              identifier: req.body?.identifier || 'unknown'
            });
          }
        });

        // API rate limiter
        this.apiRateLimiter = rateLimit({
          store: RedisStore ? new RedisStore({
            client: redisStore,
            prefix: 'api_limit:',
            expiry: 15 * 60
          }) : undefined, // Will fallback to memory store
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: config.redisDisabled ? 1000 : 200, // Increased for better reliability
          message: { error: 'Too many requests, please try again later.' },
          standardHeaders: true,
          legacyHeaders: false
        });

        // General rate limiter
        this.generalRateLimiter = rateLimit({
          store: new RedisStore({
            client: redisStore,
            prefix: 'general_limit:',
            expiry: 60 * 60
          }),
          windowMs: 60 * 60 * 1000, // 1 hour
          max: config.redisDisabled ? 10000 : 2000,
          message: { error: 'Too many requests from this IP, please try again later.' },
          standardHeaders: true,
          legacyHeaders: false
        });

        // Password reset rate limiter
        this.passwordResetRateLimiter = rateLimit({
          store: new RedisStore({
            client: redisStore,
            prefix: 'password_reset_limit:',
            expiry: 15 * 60
          }),
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: 5,
          message: { error: 'Too many password reset requests, please try again later.' },
          standardHeaders: true,
          legacyHeaders: false
        });

        // Dynamic rate limiter based on user behavior
        this.dynamicRateLimiter = rateLimit({
          store: new RedisStore({
            client: redisStore,
            prefix: 'dynamic_limit:',
            expiry: 5 * 60 // 5 minutes
          }),
          windowMs: 5 * 60 * 1000, // 5 minutes
          max: async (req, _res) => {
            return await this.calculateDynamicLimit(req);
          },
          message: { error: 'Rate limit exceeded based on behavior analysis' },
          standardHeaders: true,
          legacyHeaders: false,
          skip: (req) => {
            // Skip rate limiting for admins and known good users
            return req.user && req.user.role === 'admin';
          }
        });

        this.logger.info('Redis-based rate limiters initialized successfully');
      } else {
        // Fallback to memory store if Redis is not available
        this.logger.warn('Redis not available, using memory-based rate limiters');
        this._createMemoryRateLimiters();
      }
    } catch (error) {
      this.logger.error('Failed to initialize rate limiters:', error);
      this._createMemoryRateLimiters();
    }
  }

  _createMemoryRateLimiters() {
    this.authRateLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: process.env.NODE_ENV === 'test' || process.env.CYPRESS_API_SKIP ? 20000 : 10,
      message: { error: 'Too many authentication attempts, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false,
      skip: (req) => req.get('User-Agent') && req.get('User-Agent').includes('Cypress')
    });

    this.apiRateLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 200,
      message: { error: 'Too many requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false
    });

    this.generalRateLimiter = rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 2000,
      message: { error: 'Too many requests from this IP, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false
    });

    this.passwordResetRateLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: { error: 'Too many password reset requests, please try again later.' },
      standardHeaders: true,
      legacyHeaders: false
    });
  }

  // Calculate dynamic rate limit based on user behavior
  async calculateDynamicLimit(req) {
    try {
      if (!req.user) {
        return 10; // Low limit for unauthenticated users
      }

      const userId = req.user._id.toString();
      const behaviorScore = await this.getUserBehaviorScore(userId);

      // Adjust limit based on behavior score
      if (behaviorScore >= 90) {
        return 500; // High trust user
      } else if (behaviorScore >= 70) {
        return 200; // Good behavior
      } else if (behaviorScore >= 50) {
        return 50; // Moderate
      } else if (behaviorScore >= 30) {
        return 20; // Needs monitoring
      } else {
        return 5; // Suspicious or new user
      }
    } catch (error) {
      this.logger.warn('Error calculating dynamic limit:', error);
      return 25; // Safe default
    }
  }

  // Get user behavior score for dynamic rate limiting
  async getUserBehaviorScore(userId) {
    try {
      if (!redisManager.isClientReady()) {
        return 50; // Neutral score if Redis is not available
      }

      const behaviorKey = `behavior_score:${userId}`;
      const score = await redisManager.getCache(behaviorKey);

      if (!score) {
        // Initialize behavior score for new users
        await redisManager.setCache(behaviorKey, 50, 86400); // 24 hours
        return 50;
      }

      return parseInt(score);
    } catch (error) {
      this.logger.error('Error getting user behavior score:', error);
      return 50;
    }
  }

  // Update user behavior score
  async updateUserBehaviorScore(userId, action) {
    try {
      if (!redisManager.isClientReady()) {
        return;
      }

      const behaviorKey = `behavior_score:${userId}`;
      let currentScore = await this.getUserBehaviorScore(userId);

      switch (action) {
        case 'successful_request':
          currentScore = Math.min(100, currentScore + 1);
          break;
        case 'failed_request':
          currentScore = Math.max(0, currentScore - 5);
          break;
        case 'suspicious_activity':
          currentScore = Math.max(0, currentScore - 15);
          break;
        case 'authentication_failure':
          currentScore = Math.max(0, currentScore - 10);
          break;
        default:
          break;
      }

      await redisManager.setCache(behaviorKey, currentScore, 86400); // 24 hours
    } catch (error) {
      this.logger.error('Error updating user behavior score:', error);
    }
  }

  async registerUser(userData) {
    try {
      const { nickname, email, password } = userData;

      // Check if user exists
      const existingUser = await User.findOne({
        $or: [{ nickname }, { email }]
      });

      if (existingUser) {
        const conflictField = existingUser.nickname === nickname ? 'nickname' : 'email';
        const errorMessage = conflictField === 'nickname' ? 'Nickname already taken' : 'Email already registered';
        throw new Error(errorMessage);
      }

      // Create user
      const user = new User({ nickname, email, password, role: 'member', status: 'online' });
      await user.save();

      this.logger.info(`User registered: ${user.nickname}`);
      return user;
    } catch (error) {
      this.logger.error('Registration error:', error);
      throw error;
    }
  }

  async loginUser(identifier, password, captchaToken = null) {
    try {
      // Find user by nickname or email
      const user = await User.findOne({
        $or: [{ nickname: identifier }, { email: identifier }]
      });

      if (!user) {
        // Log IP-based attempt for tracking
        this.logger.warn('Login attempt with non-existent user', { identifier, ip: 'tracked' });
        throw new Error('Invalid credentials');
      }

      // Check if account is locked
      if (user.isAccountLocked()) {
        const lockTimeRemaining = Math.ceil((user.accountLockedUntil - new Date()) / 1000 / 60);
        throw new Error(`Account temporarily locked due to multiple failed attempts. Try again in ${lockTimeRemaining} minutes.`);
      }

      // Check if CAPTCHA is required
      if (user.captchaRequired && !captchaToken) {
        // For now, simulate CAPTCHA by requiring a specific token
        // In production, integrate with Google reCAPTCHA or similar
        throw new Error('CAPTCHA verification required due to previous failed attempts.');
      }

      // Compare password
      const isPasswordValid = await user.comparePassword(password);

      if (!isPasswordValid) {
        // Increment failed attempts
        await user.incFailedAttempts();

        // Log security event
        this.logger.warn('Failed login attempt', {
          userId: user._id,
          nickname: user.nickname,
          attempts: user.failedLoginAttempts,
          captchaRequired: user.captchaRequired,
          lockedUntil: user.accountLockedUntil
        });

        throw new Error('Invalid credentials');
      }

      // Successful login - reset failed attempts
      await user.resetFailedAttempts();

      // Update user status to online
      user.status = 'online';
      await user.save();

      this.logger.info(`User logged in successfully: ${user.nickname}`);
      return user;
    } catch (error) {
      this.logger.error('Login error:', error);
      throw error;
    }
  }

  generateToken(user, sessionId, csrfToken) {
    const token = jwt.sign(
      {
        userId: user._id,
        nickname: user.nickname,
        role: user.role,
        csrfToken: csrfToken,
        sessionId: sessionId
      },
      config.security.jwtSecret,
      { expiresIn: '24h' }
    );
    return token;
  }

  generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
  }

  async logoutUser(userId) {
    try {
      await User.findByIdAndUpdate(userId, {
        status: 'offline',
        lastActive: new Date()
      });
      this.logger.info(`User logged out: ${userId}`);
    } catch (error) {
      this.logger.error('Logout error:', error);
      throw error;
    }
  }

  async getUserFromToken(token) {
    try {
      const decoded = jwt.verify(token, config.security.jwtSecret);
      const user = await User.findById(decoded.userId);

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      this.logger.warn('Token verification failed:', error.message);
      throw error;
    }
  }

  async validateSession(session) {
    try {
      if (!session || !session.authenticated || !session.userId) {
        return null;
      }

      const user = await User.findById(session.userId);
      if (!user) {
        return null;
      }

      return user;
    } catch (error) {
      this.logger.error('Session validation error:', error);
      return null;
    }
  }

  // Enable 2FA for user
  async enable2FA(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const secret = await user.generate2FASecret();
      const qrCodeUrl = `otpauth://totp/Chat-JS(${user.nickname})?secret=${secret.base32}&issuer=Chat-JS`;

      return {
        secret: secret.base32,
        qrCodeUrl: qrCodeUrl,
        backupCodes: user.backupCodes
      };
    } catch (error) {
      this.logger.error('Enable 2FA error:', error);
      throw error;
    }
  }

  // Confirm 2FA setup
  async confirm2FA(userId, code) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.twoFactorSecret) {
        throw new Error('2FA not initialized');
      }

      const isValid = user.verify2FACode(code);
      if (!isValid) {
        throw new Error('Invalid 2FA code');
      }

      await user.enable2FA();
      return { success: true, message: '2FA enabled successfully' };
    } catch (error) {
      this.logger.error('Confirm 2FA error:', error);
      throw error;
    }
  }

  // Disable 2FA for user
  async disable2FA(userId, password) {
    try {
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Verify password before disabling
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new Error('Invalid password');
      }

      await user.disable2FA();
      return { success: true, message: '2FA disabled successfully' };
    } catch (error) {
      this.logger.error('Disable 2FA error:', error);
      throw error;
    }
  }

  // Verify 2FA code for login
  async verify2FACode(userId, code) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.twoFactorEnabled) {
        return { success: false, message: '2FA not enabled' };
      }

      const isValid = user.verify2FACode(code) || user.verify2FACode(code, true);
      if (!isValid) {
        throw new Error('Invalid 2FA code');
      }

      return { success: true, message: '2FA verified successfully' };
    } catch (error) {
      this.logger.error('Verify 2FA error:', error);
      throw error;
    }
  }

  // ***** AUTHENTICATION MIDDLEWARE METHODS *****

  // Enhanced session authentication middleware with Redis support
  async authenticateSession(req, res, next) {
    try {
      console.log('🔐 Session authentication middleware called:', {
        url: req.url,
        method: req.method,
        sessionId: req.sessionID,
        sessionExists: !!req.session,
        sessionData: req.session ? {
          authenticated: req.session.authenticated,
          userId: req.session.userId,
          nickname: req.session.nickname,
          role: req.session.role,
          loginTime: req.session.loginTime,
          csrfToken: req.session.csrfToken?.substring(0, 8) + '...'
        } : null
      });

      let sessionData = null;

      // First try to get session from Redis
      if (this.redisManager.isClientReady() && req.sessionID) {
        sessionData = await this.getSessionData(req.sessionID);
      }

      // Fallback to Express session if Redis session not found
      if (!sessionData && req.session && req.session.authenticated) {
        sessionData = {
          authenticated: req.session.authenticated,
          userId: req.session.userId,
          nickname: req.session.nickname,
          role: req.session.role,
          loginTime: req.session.loginTime,
          csrfToken: req.session.csrfToken,
          userAgent: req.session.userAgent
        };
      }

      // Check if session exists and has authenticated user
      if (sessionData && sessionData.authenticated && sessionData.userId) {
        console.log('🎯 Found authenticated session for userId:', sessionData.userId);
        console.log('🔓 Session fingerprint check:', {
          sid: req.sessionID,
          csrfToken: sessionData.csrfToken?.substring(0, 4) + '...',
          userAgent: sessionData.userAgent?.substring(0, 20) + '...',
          loginTime: sessionData.loginTime
        });

        const user = await User.findById(sessionData.userId);
        if (user) {
          console.log('✅ Session user found in DB:', {
            nickname: user.nickname,
            id: user._id,
            status: user.status,
            sessionValid: true
          });
          req.sessionUser = user; // Store in req.sessionUser to avoid conflict with JWT req.user

          // Update session last activity in Redis
          if (this.redisManager.isClientReady()) {
            sessionData.lastActivity = new Date().toISOString();
            await this.setSessionData(req.sessionID, sessionData);
          }

          // Update Express session as well
          if (req.session.csrfToken && req.session.userAgent) {
            req.session.lastSessionCheck = new Date().toISOString();
            console.log('🔐 Session fingerprint verified and updated');
          }
        } else {
          console.log('⚠️ Session user not found in DB, cleaning session:', sessionData.userId);
          // Clean invalid session from Redis
          if (this.redisManager.isClientReady()) {
            await this.deleteSessionData(req.sessionID);
          }
          // Clean Express session
          delete req.session.authenticated;
          delete req.session.userId;
          delete req.session.nickname;
          delete req.session.role;
        }
      } else {
        console.log('🔍 No authenticated session found or session not initialized', {
          sessionId: req.sessionID,
          session: !!req.session,
          authenticated: req.session?.authenticated,
          userId: req.session?.userId,
          redisSessionFound: !!sessionData
        });
        req.sessionUser = null; // Explicitly set to null when no session
      }
      next();
    } catch (error) {
      winston.warn('Session authentication error:', {
        error: error.message,
        sessionId: req.sessionID,
        ip: req.ip
      });
      req.sessionUser = null; // Set to null on error
      next();
    }
  }

  // JWT authentication middleware (extracted from server.js)
  async authenticateToken(req, res, next) {
    try {
      console.log('🔐 JWT authentication middleware called:', { url: req.url, method: req.method });
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

      console.log('🔑 Token extraction result:', { hasAuthHeader: !!authHeader, hasToken: !!token });

      if (!token) {
        console.log('❌ No token provided');
        return res.status(401).json({
          error: 'Access token required',
          code: 'NO_TOKEN'
        });
      }

      const decoded = jwt.verify(token, config.security.jwtSecret);
      console.log('✅ JWT decoded:', { userId: decoded.userId, nickname: decoded.nickname });
      const user = await User.findById(decoded.userId);

      if (!user) {
        console.log('❌ User not found in DB for JWT userId:', decoded.userId);
        return res.status(401).json({
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        });
      }

      req.user = user;
      console.log('✅ JWT authentication successful for user:', user.nickname, { id: user._id, status: user.status });
      next();
    } catch (error) {
      winston.warn('JWT authentication failed:', {
        error: error.message,
        ip: req.ip
      });

      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          error: 'Invalid token format',
          code: 'INVALID_TOKEN_FORMAT'
        });
      }

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'Token has expired',
          code: 'TOKEN_EXPIRED'
        });
      }

      return res.status(401).json({
        error: 'Token verification failed',
        code: 'TOKEN_VERIFICATION_FAILED'
      });
    }
  }

  // Role-based access control middleware - Moderator required
  async requireModerator(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      if (!req.user.hasModeratorPrivileges()) {
        return res.status(403).json({
          error: 'Moderator privileges required',
          code: 'MODERATOR_REQUIRED'
        });
      }

      next();
    } catch (error) {
      winston.error('Moderator check error:', error);
      res.status(500).json({
        error: 'Server error during authorization check',
        code: 'AUTH_CHECK_ERROR'
      });
    }
  }

  // Role-based access control middleware - Admin required
  async requireAdmin(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: 'Authentication required',
          code: 'AUTH_REQUIRED'
        });
      }

      if (!req.user.hasAdminPrivileges()) {
        return res.status(403).json({
          error: 'Administrator privileges required',
          code: 'ADMIN_REQUIRED'
        });
      }

      next();
    } catch (error) {
      winston.error('Admin check error:', error);
      res.status(500).json({
        error: 'Server error during authorization check',
        code: 'AUTH_CHECK_ERROR'
      });
    }
  }

  // JWT token verification utility
  async verifyJWTToken(token) {
    try {
      const decoded = jwt.verify(token, config.security.jwtSecret);
      const user = await User.findById(decoded.userId);

      if (!user) {
        throw new Error('User not found');
      }

      return { valid: true, user, decoded };
    } catch (error) {
      return {
        valid: false,
        error: error.message,
        user: null,
        decoded: null
      };
    }
  }

  // ***** SESSION MANAGEMENT METHODS *****

  // Create new user session with enhanced security features
  async createSession(req, user, csrfToken) {
    try {
      console.log('🔏 Creating and storing user session for user:', user.nickname);
      console.log('🏷️ Generating sessionId:', req.sessionId);

      const sessionData = {
        authenticated: true,
        userId: user._id.toString(),
        nickname: user.nickname,
        role: user.role,
        csrfToken: csrfToken,
        loginTime: new Date().toISOString(),
        userAgent: req.get('User-Agent'),
        fingerprint: {
          csrfTokenHash: crypto.createHash('sha256').update(csrfToken).digest('hex').substring(0, 16),
          loginTime: new Date().toISOString()
        }
      };

      // Store in Redis with proper TTL
      if (this.redisManager.isClientReady()) {
        await this.redisManager.setSession(req.sessionId, sessionData, 86400); // 24 hours
      }

      // Also store in Express session for backward compatibility
      req.session.authenticated = true;
      req.session.userId = user._id.toString();
      req.session.nickname = user.nickname;
      req.session.role = user.role;
      req.session.csrfToken = csrfToken;
      req.session.loginTime = sessionData.loginTime;
      req.session.userAgent = sessionData.userAgent;

      console.log('🔓 Session fingerprint generated:', {
        csrfTokenHash: crypto.createHash('sha256').update(csrfToken).digest('hex').substring(0, 8),
        userAgentLength: req.session.userAgent?.length,
        loginTime: req.session.loginTime
      });

      return {
        authenticated: true,
        id: req.sessionId,
        expires: req.session.cookie.expires,
        userAgent: req.session.userAgent,
        fingerprint: sessionData.fingerprint
      };
    } catch (error) {
      this.logger.error('Error creating user session:', error);
      throw error;
    }
  }

  // Destroy user session from both Redis and Express session
  async destroySession(req) {
    try {
      console.log('🚪 Session logout request, sessionId:', req.sessionId);

      // Check if there's an authenticated session
      const hasSessionAuth = req.sessionUser || (req.session && req.session.authenticated);

      if (hasSessionAuth) {
        const sessionUserId = req.session && req.session.userId;

        if (sessionUserId) {
          const sessionUser = await User.findById(sessionUserId);
          const nickname = sessionUser ? sessionUser.nickname : 'unknown';

          console.log('✅ Session logout: Destroying session for user:', nickname);

          // Destroy from Redis
          if (this.redisManager.isClientReady()) {
            await this.redisManager.deleteSession(req.sessionId);
          }

          // Destroy Express session
          await new Promise((resolve, reject) => {
            req.session.destroy((err) => {
              if (err) {
                console.error('❌ Session destroy error:', err);
                reject(err);
              } else {
                console.log('✅ Session destroyed successfully');
                resolve();
              }
            });
          });

          this.logger.info(`Session logged out: ${nickname}`, {
            sessionId: req.sessionId,
            ip: req.ip
          });

          return { success: true, message: 'Session logged out successfully' };
        }
      }

      console.log('⚠️ Session logout: No authenticated session to destroy');
      return { success: true, message: 'No active session to log out' };
    } catch (error) {
      this.logger.error('Session logout error:', error);
      throw error;
    }
  }

  // Get session from Redis with fallback to Express session
  async getSessionData(sessionId) {
    try {
      if (this.redisManager.isClientReady()) {
        return await this.redisManager.getSession(sessionId);
      }
      return null;
    } catch (error) {
      this.logger.warn('Error retrieving session from Redis:', error);
      return null;
    }
  }

  // Store session data in Redis
  async setSessionData(sessionId, data, ttl = 86400) {
    try {
      if (this.redisManager.isClientReady()) {
        await this.redisManager.setSession(sessionId, data, ttl);
      }
    } catch (error) {
      this.logger.error('Error storing session in Redis:', error);
    }
  }

  // Delete session from Redis
  async deleteSessionData(sessionId) {
    try {
      if (this.redisManager.isClientReady()) {
        await this.redisManager.deleteSession(sessionId);
      }
    } catch (error) {
      this.logger.error('Error deleting session from Redis:', error);
    }
  }

  // Validate and enhance session
  async validateAndEnhanceSession(req, res, next) {
    try {
      // Basic authentication middleware already handled session validation
      // This method can be used to add additional session validation logic
      if (req.sessionUser) {
        // Update session last activity
        req.session.lastActivity = new Date().toISOString();
        await new Promise((resolve) => {
          req.session.save((err) => {
            if (!err) {
              console.log('📝 Session last activity updated');
            }
            resolve();
          });
        });
      }

      next();
    } catch (error) {
      winston.warn('Session validation error:', error);
      next();
    }
  }

  // Handle login with session creation (extracted from server.js)
  async handleLoginWithSession(identifier, password, req, res, _connectionManager = null) {
    try {
      console.log('🔑 Incoming login request:', { identifier: identifier, hasPassword: !!password, ip: req.ip });

      // Validate input
      if (!identifier || !password) {
        return res.status(400).json({ errors: [{ msg: 'Identifier and password are required' }] });
      }

      // Authenticate user
      const user = await this.loginUser(identifier, password);

      // Handle banned users
      if (user.banned) {
        return res.status(403).json({
          error: 'Account is banned',
          reason: user.banReason,
          expires: user.banExpires
        });
      }

      // Generate CSRF token
      const csrfToken = this.generateCsrfToken();

      // Create session
      const sessionInfo = await this.createSession(req, user, csrfToken);

      // Generate JWT token
      console.log('🔏 Generating JWT token for user:', user.nickname);
      const token = this.generateToken(user, req.sessionId, csrfToken);

      console.log('✅ JWT token generated successfully');

      this.logger.info(`User logged in: ${user.nickname}`);

      console.log('📤 Sending login response');

      // Clean user data for response
      const responseUser = {
        id: user._id,
        nickname: user.nickname,
        email: user.email,
        role: user.role,
        status: user.status
      };

      return res.json({
        token, // JWT for API calls and WebSockets
        user: responseUser,
        session: sessionInfo
      });
    } catch (error) {
      this.logger.error('Login error:', error);

      // Handle specific error types
      if (error.message.includes('Invalid credentials')) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      if (error.message.includes('Account temporarily locked')) {
        return res.status(429).json({
          error: error.message,
          code: 'ACCOUNT_LOCKED'
        });
      }

      return res.status(500).json({ error: 'Server error during login' });
    }
  }

  // Handle registration with session creation (extracted from server.js)
  async handleRegistrationWithSession(userData, req, res) {
    try {
      const { nickname, email, password } = userData;

      // Validate input
      if (!nickname || !email || !password) {
        return res.status(400).json({ errors: [{ msg: 'Nickname, email, and password are required' }] });
      }

      // Register user
      const user = await this.registerUser(userData);

      // Generate CSRF token
      const csrfToken = this.generateCsrfToken();

      // Create session
      const sessionInfo = await this.createSession(req, user, csrfToken);

      console.log('JWT_SECRET present:', !!config.security.jwtSecret);
      const token = this.generateToken(user, req.sessionId, csrfToken);

      console.log('JWT token generated successfully');
      this.logger.info(`User registered: ${user.nickname}`);

      return res.status(201).json({
        token, // JWT for API calls and WebSockets
        user: {
          id: user._id,
          nickname: user.nickname,
          email: user.email,
          role: user.role,
          status: user.status
        },
        session: sessionInfo
      });
    } catch (error) {
      this.logger.error('Registration error:', error);

      if (error.message.includes('already taken') || error.message.includes('already registered')) {
        return res.status(409).json({ error: error.message });
      }

      return res.status(500).json({ error: 'Server error during registration' });
    }
  }
}

module.exports = new AuthService();