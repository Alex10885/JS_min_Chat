const jwt = require('jsonwebtoken');
const winston = require('winston');
const config = require('../config');
const User = require('../models/User');

const logger = winston.createLogger({
  level: config.logger.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'chat-server-auth' },
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

// Session authentication middleware (works parallel to JWT)
const authenticateSession = async (req, res, next) => {
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

    // Check if session exists and has authenticated user
    if (req.session && req.session.authenticated && req.session.userId) {
      console.log('🎯 Found authenticated session for userId:', req.session.userId);
      console.log('🔓 Session fingerprint check:', {
        sid: req.sessionID,
        csrfToken: req.session.csrfToken?.substring(0, 4) + '...',
        userAgent: req.session.userAgent?.substring(0, 20) + '...',
        loginTime: req.session.loginTime
      });

      const user = await User.findById(req.session.userId);
      if (user) {
        console.log('✅ Session user found in DB:', {
          nickname: user.nickname,
          id: user._id,
          status: user.status,
          sessionValid: true
        });
        req.sessionUser = user; // Store in req.sessionUser to avoid conflict with JWT req.user

        // Update session fingerprint if needed
        if (req.session.csrfToken && req.session.userAgent) {
          req.session.lastSessionCheck = new Date().toISOString();
          console.log('🔐 Session fingerprint verified and updated');
        }
      } else {
        console.log('⚠️ Session user not found in DB, cleaning session:', req.session.userId);
        // Clean invalid session
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
        userId: req.session?.userId
      });
      req.sessionUser = null; // Explicitly set to null when no session
    }
    next();
  } catch (error) {
    logger.warn('Session authentication error:', {
      error: error.message,
      sessionId: req.sessionID,
      ip: req.ip
    });
    req.sessionUser = null; // Set to null on error
    next();
  }
};

// JWT authentication middleware
const authenticateToken = async (req, res, next) => {
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
    logger.warn('JWT authentication failed:', {
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
};

// Role-based access control middleware
const requireModerator = async (req, res, next) => {
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
    logger.error('Moderator check error:', error);
    res.status(500).json({
      error: 'Server error during authorization check',
      code: 'AUTH_CHECK_ERROR'
    });
  }
};

const requireAdmin = async (req, res, next) => {
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
    logger.error('Admin check error:', error);
    res.status(500).json({
      error: 'Server error during authorization check',
      code: 'AUTH_CHECK_ERROR'
    });
  }
};

module.exports = {
  authenticateSession,
  authenticateToken,
  requireModerator,
  requireAdmin,
  logger
};