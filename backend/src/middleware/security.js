const { logger } = require('./auth');

// Geographic-based rate limiting map (country -> multiplier)
const geoLimitMap = {
  'RU': 1.0, // Russia - normal limits
  'US': 1.2, // US - slightly higher suspicion
  'CN': 1.5, // China - higher suspicion
  'IN': 1.5, // India - higher suspicion
  'BR': 1.2, // Brazil - slightly higher
  'DE': 0.8, // Germany - lower suspicion
  'JP': 0.9, // Japan - lower suspicion
  'GB': 0.9, // UK - lower suspicion
  'CA': 1.0, // Canada - normal
  'AU': 1.0, // Australia - normal
};

// Simple IP country detection (without full geoip library for performance)
// This is a basic implementation - in production, use geoip-lite or similar
const getCountryFromIP = (ip) => {
  // This is a simplified version - in real implementation would use MaxMind DB
  if (ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '127.0.0.1') {
    return 'LOCAL'; // Local network
  }

  // For demo purposes, return some countries based on IP patterns
  // In production, integrate with geoip2-country or similar
  const ipParts = ip.split('.');
  if (ipParts.length === 4) {
    const firstOctet = parseInt(ipParts[0]);
    if (firstOctet === 5) return 'RU'; // Example simplification
    if (firstOctet >= 68 && firstOctet <= 71) return 'US'; // Example for US
    if (firstOctet >= 101 && firstOctet <= 126) return 'CN'; // Example for CN
    if (firstOctet >= 198 && firstOctet <= 199) return 'BR'; // Example for BR
    if (firstOctet >= 188 && firstOctet <= 191) return 'IN'; // Example for IN
  }

  return 'UNKNOWN'; // Default
};

// Geographic rate limiting middleware
const geographicRateLimiter = (req, res, next) => {
  try {
    const clientIP = req.ip || req.connection.remoteAddress;
    const country = getCountryFromIP(clientIP);
    const multiplier = geoLimitMap[country] || 1.0;

    // Store geographic information in request for later use
    req.clientIP = clientIP;
    req.clientCountry = country;
    req.geoMultiplier = multiplier;

    // Log suspicious activities
    if (multiplier > 1.3) {
      logger.warn(`Suspicious request from ${country} (${clientIP})`, {
        country,
        ip: clientIP,
        path: req.path,
        userAgent: req.get('User-Agent'),
        multiplier
      });
    }

    next();
  } catch (error) {
    logger.error('Geographic middleware error:', error);
    req.geoMultiplier = 1.0; // Default to normal limits
    next();
  }
};

// Enhanced session fingerprinting middleware
const sessionFingerprint = (req, res, next) => {
  try {
    if (req.session && req.session.authenticated) {
      const currentUserAgent = req.get('User-Agent');
      const currentIP = req.ip;
      const currentTime = new Date().toISOString();

      // Check if User-Agent has changed (basic check)
      if (!req.session.userAgent) {
        req.session.userAgent = currentUserAgent;
      } else if (req.session.userAgent !== currentUserAgent) {
        logger.warn('User-Agent fingerprint mismatch detected', {
          sessionId: req.sessionID,
          storedUA: req.session.userAgent,
          currentUA: currentUserAgent,
          ip: currentIP,
          userId: req.session.userId,
          nickname: req.session.nickname
        });

        // Flag as suspicious activity
        req.session.suspiciousActivity = (req.session.suspiciousActivity || 0) + 1;

        // If too many suspicious activities, destroy session
        if (req.session.suspiciousActivity > 3) {
          req.session.destroy((err) => {
            if (err) logger.error('Failed to destroy suspicious session:', err);
            else logger.info('Destroyed session due to suspicious activity', {
              sessionId: req.sessionID,
              userId: req.session.userId
            });
          });

          return res.status(401).json({
            error: 'Session compromised - please login again',
            code: 'SESSION_COMPROMISED'
          });
        }
      }

      // Check IP change from session creation
      if (!req.session.ipAddress) {
        req.session.ipAddress = currentIP;
      } else if (req.session.ipAddress !== currentIP) {
        const isConsideredSuspicious = isIPSuspicious(req.session.ipAddress, currentIP);
        if (isConsideredSuspicious) {
          logger.warn('IP address change detected', {
            sessionId: req.sessionID,
            oldIP: req.session.ipAddress,
            newIP: currentIP,
            userId: req.session.userId,
            nickname: req.session.nickname,
            suspicious: isConsideredSuspicious,
            networkChanged: true
          });

          req.session.suspiciousActivity = (req.session.suspiciousActivity || 0) + 1;

          // Store IP history for analysis
          if (!req.session.ipHistory) req.session.ipHistory = [];
          req.session.ipHistory.push({
            ip: currentIP,
            timestamp: currentTime,
            suspicious: true
          });
        } else {
          // Store normal IP transitions for legitimate mobile usage
          if (!req.session.ipHistory) req.session.ipHistory = [];
          req.session.ipHistory.push({
            ip: currentIP,
            timestamp: currentTime,
            suspicious: false
          });
        }
      }

      // Update last activity time
      req.session.lastActivity = currentTime;
    }

    next();
  } catch (error) {
    logger.error('Session fingerprint middleware error:', error);
    next(); // Continue even if fingerprinting fails
  }
};

// Middleware for session inactivity timeout and automatic cleanup
const checkSessionInactivity = (req, res, next) => {
  try {
    if (req.session && req.session.authenticated) {
      const now = new Date();
      const lastActivity = req.session.lastActivity ? new Date(req.session.lastActivity) : now;
      const sessionDuration = now - lastActivity;

      // Check for prolonged inactivity (30 minutes)
      const inactivityTimeout = 30 * 60 * 1000; // 30 minutes
      if (sessionDuration > inactivityTimeout) {
        logger.info('Session expired due to inactivity', {
          sessionId: req.sessionID,
          userId: req.session.userId,
          nickname: req.session.nickname,
          lastActivity: req.session.lastActivity,
          duration: sessionDuration / 1000 / 60 + ' minutes'
        });

        req.session.destroy((err) => {
          if (err) {
            logger.error('Failed to destroy inactive session:', err);
            return next();
          }
          res.json({
            error: 'Session expired due to inactivity',
            code: 'SESSION_INACTIVE'
          });
        });
        return;
      }

      // Update last activity time
      req.session.lastActivity = now.toISOString();
    }
    next();
  } catch (error) {
    logger.error('Session inactivity check error:', error);
    next();
  }
};

// Simple IP suspicious detection (different geographical regions)
const isIPSuspicious = (oldIP, newIP) => {
  // This is a simplified check - in production use full geo-detection
  const oldCountry = getCountryFromIP(oldIP);
  const newCountry = getCountryFromIP(newIP);

  // If both are known countries and different, might be suspicious
  return (oldCountry !== 'UNKNOWN' && newCountry !== 'UNKNOWN' && oldCountry !== newCountry) ||
         (oldCountry === 'UNKNOWN' && newCountry !== 'UNKNOWN') ||
         (newCountry === 'UNKNOWN' && oldCountry !== 'UNKNOWN');
};

module.exports = {
  geographicRateLimiter,
  sessionFingerprint,
  checkSessionInactivity
};