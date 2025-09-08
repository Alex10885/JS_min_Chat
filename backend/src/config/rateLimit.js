const rateLimit = require('express-rate-limit');
const config = require('./index');

// Progressive delay for failed authentication attempts
const progressiveDelay = (attempts) => {
  if (attempts < 3) return 0; // No delay for first 2 attempts
  if (attempts < 5) return 1000; // 1 second delay
  if (attempts < 8) return 5000; // 5 seconds delay
  return 15000; // 15 seconds delay for >7 failed attempts
};

// Enhanced auth rate limiter with progressive delay
const authRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: (req) => {
    const isAuthenticated = req.user || (req.session && req.session.authenticated);
    const geoMultiplier = req.geoMultiplier || 1.0; // Geographic suspicion factor

    let baseLimit = isAuthenticated ? config.rateLimit.maxAuthAuthenticated : config.rateLimit.maxAuthAnonymous;

    // Apply geographic multiplier (lower limits for suspicious regions)
    if (geoMultiplier > 1.0) {
      baseLimit = Math.max(1, Math.floor(baseLimit / geoMultiplier));
    }

    return baseLimit;
  },
  message: (req, _res) => {
    const attempts = req.rateLimit?.remainingHit || 0;
    const delay = progressiveDelay(config.rateLimit.maxAuth - attempts);
    return {
      error: 'Too many authentication attempts, please try again later.',
      delay: delay,
      attemptsLeft: attempts
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    return req.get('User-Agent') && req.get('User-Agent').includes('Cypress');
  },
  handler: (req, res, next, options) => {
    const delay = progressiveDelay(config.rateLimit.maxAuth - (req.rateLimit?.remainingHit || 0));
    if (delay > 0) {
      setTimeout(() => {
        res.status(options.statusCode).json(options.message);
      }, delay);
    } else {
      res.status(options.statusCode).json(options.message);
    }
  }
});

const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: (req) => {
    const isAuthenticated = req.user || (req.session && req.session.authenticated);
    const hasModeratorPrivileges = isAuthenticated && req.user?.role === 'moderator';
    const hasAdminPrivileges = isAuthenticated && req.user?.role === 'admin';

    if (hasAdminPrivileges) return config.rateLimit.maxApi * 2; // Higher limit for admins
    if (hasModeratorPrivileges) return config.rateLimit.maxApi * 1.5; // Higher limit for moderators
    if (isAuthenticated) return config.rateLimit.maxApi; // Standard authenticated users
    return config.rateLimit.maxApi / 4; // Lower limit for anonymous users
  },
  message: { error: 'Too many API requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Include session fingerprint or IP for anonymous users
    const isAuthenticated = req.user || (req.session && req.session.authenticated);
    return isAuthenticated
      ? `${req.ip}:${req.user?.id || req.session?.userId}`
      : req.ip;
  }
});

const generalRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: config.rateLimit.maxGeneral,
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const passwordResetRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxPasswordReset,
  message: { error: 'Too many password reset requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  authRateLimiter,
  apiRateLimiter,
  generalRateLimiter,
  passwordResetRateLimiter
};