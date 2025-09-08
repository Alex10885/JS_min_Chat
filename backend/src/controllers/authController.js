const authService = require('../services/authService');
const { logger } = require('../middleware/auth');

class AuthController {
  constructor() {
    this.logger = logger;
  }

  async login(req, res) {
    try {
      console.log('🔑 Incoming login request:', {
        identifier: req.body.identifier,
        hasPassword: !!req.body.password,
        ip: req.ip
      });

      const { identifier, password, captchaToken } = req.body;

      const user = await authService.loginUser(identifier, password, captchaToken);

      // Setup session
      console.log('🔏 Creating and storing user session');
      console.log('🏷️ Generating sessionId:', req.sessionId);

      req.session.authenticated = true;
      req.session.userId = user._id.toString();
      req.session.nickname = user.nickname;
      req.session.role = user.role;
      req.session.csrfToken = authService.generateCsrfToken();
      req.session.loginTime = new Date().toISOString();

      console.log('🔓 Session fingerprint generated:', {
        csrfTokenHash: authService.generateCsrfToken(), // Show just hash
        loginTime: req.session.loginTime
      });

      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error('❌ Session save error:', err);
            reject(err);
          } else {
            console.log('✅ Session saved successfully');
            logger.info('Session saved during login', {
              userId: req.session.userId,
              nickname: req.session.nickname,
              role: req.session.role,
              ip: req.ip
            });
            resolve();
          }
        });
      });

      const token = authService.generateToken(user, req.sessionId, req.session.csrfToken);

      console.log('📤 Sending login response');
      res.json({
        token,
        user: {
          id: user._id,
          nickname: user.nickname,
          email: user.email,
          role: user.role
        },
        session: {
          authenticated: true,
          id: req.sessionId,
          expires: req.session.cookie.expires
        }
      });
    } catch (error) {
      this.logger.error('Login controller error:', error);
      res.status(400).json({ error: error.message });
    }
  }

  async register(req, res) {
    try {
      const { nickname, email, password } = req.body;

      const user = await authService.registerUser({ nickname, email, password });

      console.log('🔏 Creating and storing registration session');

      // Setup session
      req.session.authenticated = true;
      req.session.userId = user._id.toString();
      req.session.nickname = user.nickname;
      req.session.role = user.role;
      req.session.csrfToken = authService.generateCsrfToken();
      req.session.registrationTime = new Date().toISOString();

      console.log('🔓 Registration session fingerprint generated:', {
        csrfTokenHash: authService.generateCsrfToken(),
        registrationTime: req.session.registrationTime
      });

      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            console.error('❌ Registration session save error:', err);
            reject(err);
          } else {
            console.log('✅ Registration session saved successfully');
            logger.info('Session saved during registration', {
              userId: req.session.userId,
              nickname: req.session.nickname,
              role: req.session.role,
              ip: req.ip
            });
            resolve();
          }
        });
      });

      const token = authService.generateToken(user, req.sessionId, req.session.csrfToken);

      console.log('JWT token generated successfully');
      logger.info(`User registered: ${user.nickname}`);

      res.status(201).json({
        token,
        user: {
          id: user._id,
          nickname: user.nickname,
          email: user.email,
          role: user.role
        },
        session: {
          authenticated: true,
          id: req.sessionId,
          expires: req.session.cookie.expires
        }
      });
    } catch (error) {
      this.logger.error('Registration controller error:', error);
      if (error.message.includes('already taken') || error.message.includes('already registered')) {
        res.status(409).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Server error during registration' });
      }
    }
  }

  async logout(req, res) {
    try {
      console.log('🚪 Logout request from user:', req.user.nickname, { userId: req.user._id });

      await authService.logoutUser(req.user._id);

      // Disconnect all Socket.IO connections for this user would be handled by socket manager

      console.log(`✅ User ${req.user.nickname} logged out successfully`);
      logger.info(`User logged out: ${req.user.nickname}`, {
        userId: req.user._id
        // disconnectedSockets would be handled by socket manager
      });

      res.json({
        success: true,
        message: 'Logged out successfully'
        // disconnectedCount would be handled by socket manager
      });
    } catch (error) {
      this.logger.error('Logout controller error:', error);
      res.status(500).json({ error: 'Server error during logout' });
    }
  }

  async logoutSession(req, res) {
    try {
      console.log('🚪 Session logout request, sessionId:', req.sessionId);

      const hasJwtAuth = !!req.user;
      const hasSessionAuth = req.sessionUser || (req.session && req.session.authenticated);

      if (hasSessionAuth && req.session) {
        const sessionUser = req.session.userId ?
          await authService.getUserFromToken(null) || { nickname: 'unknown' } :
          req.sessionUser;
        const nickname = sessionUser ? sessionUser.nickname : 'unknown';

        console.log('✅ Session logout: Destroying session for user:', nickname);

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

        logger.info(`Session logged out: ${nickname}`, {
          sessionId: req.sessionId,
          ip: req.ip
        });

        res.json({
          success: true,
          message: 'Session logged out successfully',
          type: 'session_logout',
          sessionDestroyed: true
        });
      } else {
        console.log('⚠️ Session logout: No authenticated session to destroy');
        res.json({
          success: true,
          message: 'No active session to log out',
          type: 'session_logout',
          sessionDestroyed: false
        });
      }

    } catch (error) {
      this.logger.error('Session logout controller error:', error);
      res.status(500).json({
        error: 'Server error during session logout',
        code: 'SESSION_LOGOUT_ERROR'
      });
    }
  }

  async logoutComplete(req, res) {
    try {
      console.log('🚪 Complete logout request, sessionId:', req.sessionId);

      const hasJwtAuth = !!req.user;
      const hasSessionAuth = req.sessionUser || (req.session && req.session.authenticated);

      let jwtLogoutResult = null;
      let sessionLogoutResult = null;

      // Handle JWT logout
      if (hasJwtAuth) {
        try {
          await authService.logoutUser(req.user._id);
          jwtLogoutResult = {
            success: true
            // disconnectedCount would be handled by socket manager
          };
        } catch (jwtError) {
          jwtLogoutResult = {
            success: false,
            error: jwtError.message
          };
        }
      }

      // Handle session logout
      if (hasSessionAuth && req.session) {
        try {
          if (req.session.userId) {
            sessionLogoutResult = {
              success: true,
              sessionDestroyed: true
            };
          }

          await new Promise((resolve, reject) => {
            req.session.destroy((err) => {
              if (err) reject(err);
              else resolve(req.session = null);
            });
          });
        } catch (sessionError) {
          sessionLogoutResult = {
            success: false,
            error: sessionError.message
          };
        }
      }

      const overallSuccess = (!jwtLogoutResult || jwtLogoutResult.success) &&
                            (!sessionLogoutResult || sessionLogoutResult.success);

      res.json({
        success: overallSuccess,
        message: 'Complete logout processed',
        type: 'complete_logout',
        jwt: jwtLogoutResult,
        session: sessionLogoutResult
      });

    } catch (error) {
      this.logger.error('Complete logout controller error:', error);
      res.status(500).json({
        error: 'Server error during complete logout',
        code: 'COMPLETE_LOGOUT_ERROR'
      });
    }
  }

  async checkSecurityStatus(req, res) {
    try {
      const { identifier } = req.query;

      if (!identifier) {
        return res.json({
          captchaRequired: false,
          accountLocked: false,
          lockTimeRemaining: 0
        });
      }

      // Find user by nickname or email
      const User = require('../models/User');
      const user = await User.findOne({
        $or: [{ nickname: identifier }, { email: identifier }]
      });

      if (!user) {
        return res.json({
          captchaRequired: false,
          accountLocked: false,
          lockTimeRemaining: 0
        });
      }

      const isLocked = user.isAccountLocked();
      let lockTimeRemaining = 0;

      if (isLocked) {
        lockTimeRemaining = Math.ceil((user.accountLockedUntil - new Date()) / 1000 / 60);
      }

      res.json({
        captchaRequired: user.captchaRequired,
        accountLocked: isLocked,
        lockTimeRemaining: lockTimeRemaining,
        failedAttempts: user.failedLoginAttempts
      });
    } catch (error) {
      this.logger.error('Security status check error:', error);
      res.status(500).json({
        error: 'Server error during security check',
        code: 'SECURITY_CHECK_ERROR'
      });
    }
  }

  async unlockAccount(req, res) {
    try {
      const { identifier, captchaToken } = req.body;

      const User = require('../models/User');
      const user = await User.findOne({
        $or: [{ nickname: identifier }, { email: identifier }]
      });

      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Validate CAPTCHA token in production
      // For now, accept any non-empty token as valid
      if (!captchaToken || captchaToken.trim().length === 0) {
        return res.status(400).json({ error: 'Valid CAPTCHA token is required' });
      }

      // Temporarily reduce failed attempts and unlock account
      user.failedLoginAttempts = Math.max(0, user.failedLoginAttempts - 1);
      if (user.failedLoginAttempts < 2) {
        user.captchaRequired = false;
      }
      await user.save();

      // Log security event
      this.logger.info('Account unlocked via CAPTCHA', {
        userId: user._id,
        nickname: user.nickname,
        remainingAttempts: user.failedLoginAttempts,
        captchaRequired: user.captchaRequired
      });

      res.json({
        success: true,
        message: 'Account unlocked successfully',
        captchaRequired: user.captchaRequired
      });
    } catch (error) {
      this.logger.error('Unlock account error:', error);
      res.status(500).json({
        error: 'Server error during unlock',
        code: 'UNLOCK_ERROR'
      });
    }
  }
}

module.exports = new AuthController();