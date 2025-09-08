const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  nickname: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 50,
    index: true // Remove duplicate index call below
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true // Remove duplicate index call below
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'moderator', 'member'],
    default: 'member'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActive: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['online', 'offline'],
    default: 'offline'
  },
  // Moderation fields
  banned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: null
  },
  banExpires: {
    type: Date,
    default: null
  },
  warnings: [{
    reason: String,
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    issuedAt: { type: Date, default: Date.now },
    expires: Date
  }],
  muteExpires: {
    type: Date,
    default: null
  },
  // Security fields for brute-force protection
  failedLoginAttempts: {
    type: Number,
    default: 0
  },
  lastFailedAttempt: {
    type: Date,
    default: null
  },
  accountLockedUntil: {
    type: Date,
    default: null
  },
  captchaRequired: {
    type: Boolean,
    default: false
  },
  securityToken: {
    type: String,
    default: null
  },
  // Two-Factor Authentication (2FA/OTP) fields
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String,
    default: null
  },
  backupCodes: [{
    type: String,
    default: []
  }],
  twoFactorMethod: {
    type: String,
    enum: ['TOTP', 'SMS', 'EMAIL'],
    default: 'TOTP'
  },
  last2FACode: {
    type: String,
    default: null
  },
  last2FACodeExpiry: {
    type: Date,
    default: null
  },
  // Temporary tokens
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  },
  moderationToken: {
    type: String,
    default: null
  },
  moderationTokenExpires: {
    type: Date,
    default: null
  }
});

// Hash password before saving
userSchema.pre('save', async function(next) {
   if (!this.isModified('password')) return next();

   console.log('Hashing password for user:', this.nickname);
   try {
     const salt = await bcrypt.genSalt(12);
     console.log('Salt generated:', salt);
     this.password = await bcrypt.hash(this.password, salt);
     console.log('Password hashed successfully');
     next();
   } catch (error) {
     console.error('Error hashing password:', error.message);
     next(error);
   }
 });

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate reset password token
userSchema.methods.generateResetToken = function() {
  // Generate random token
  const resetToken = crypto.randomBytes(32).toString('hex');

  // Hash token before storing
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expiration (1 hour from now)
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour

  return resetToken;
};

// Reset password using token
userSchema.methods.resetPassword = function(token, newPassword) {
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  if (hashedToken !== this.resetPasswordToken) {
    throw new Error('Invalid or expired password reset token');
  }

  if (Date.now() > this.resetPasswordExpires) {
    throw new Error('Password reset token has expired');
  }

  this.password = newPassword;
  this.resetPasswordToken = null;
  this.resetPasswordExpires = null;

  return this.save();
};

// Ban user
userSchema.methods.ban = function(reason, duration = null, issuedBy = null) {
  this.banned = true;
  this.banReason = reason;
  if (duration) {
    this.banExpires = new Date(Date.now() + duration);
  } else {
    this.banExpires = null; // permanent ban
  }
  return this.save();
};

// Unban user
userSchema.methods.unban = function() {
  this.banned = false;
  this.banReason = null;
  this.banExpires = null;
  return this.save();
};

// Check if user is banned and if ban is active
userSchema.methods.isBanned = function() {
  if (!this.banned) return false;
  if (!this.banExpires) return true; // permanent ban
  return this.banExpires > new Date(); // temporary ban still active
};

// Add warning to user
userSchema.methods.warn = function(reason, issuedBy, duration = null) {
  const warning = {
    reason: reason,
    issuedBy: issuedBy,
    issuedAt: new Date(),
    expires: duration ? new Date(Date.now() + duration) : null
  };
  this.warnings.push(warning);
  return this.save();
};

// Remove expired warnings
userSchema.methods.cleanWarnings = function() {
  this.warnings = this.warnings.filter(warning => {
    return !warning.expires || warning.expires > new Date();
  });
  return this.save();
};

// Get active warnings count
userSchema.methods.getActiveWarningsCount = function() {
  this.cleanWarnings();
  return this.warnings.length;
};

// Mute user (for chat)
userSchema.methods.mute = function(duration = 3600000) { // default 1 hour
  this.muteExpires = new Date(Date.now() + duration);
  return this.save();
};

// Unmute user
userSchema.methods.unmute = function() {
  this.muteExpires = null;
  return this.save();
};

// Check if user is muted
userSchema.methods.isMuted = function() {
  return this.muteExpires && this.muteExpires > new Date();
};

// Generate moderation token for admin actions
userSchema.methods.generateModerationToken = function() {
  const moderationToken = crypto.randomBytes(32).toString('hex');
  this.moderationToken = crypto
    .createHash('sha256')
    .update(moderationToken)
    .digest('hex');
  this.moderationTokenExpires = Date.now() + 3600000; // 1 hour
  return this.save().then(() => moderationToken);
};

// Verify moderation token
userSchema.methods.verifyModerationToken = function(token) {
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  if (hashedToken !== this.moderationToken) {
    throw new Error('Invalid moderation token');
  }

  if (Date.now() > this.moderationTokenExpires) {
    throw new Error('Moderation token expired');
  }

  this.moderationToken = null;
  this.moderationTokenExpires = null;
  return this.save();
};

// Check if user has moderator/admin permissions
userSchema.methods.hasModeratorPrivileges = function() {
  return this.role === 'admin' || this.role === 'moderator';
};

userSchema.methods.hasAdminPrivileges = function() {
  return this.role === 'admin';
};

// Check if account is locked
userSchema.methods.isAccountLocked = function() {
  if (!this.accountLockedUntil) return false;
  return this.accountLockedUntil > new Date();
};

// Increment failed login attempts
userSchema.methods.incFailedAttempts = function() {
  this.failedLoginAttempts += 1;
  this.lastFailedAttempt = new Date();

  // Lock account after 3 failed attempts
  if (this.failedLoginAttempts >= 3) {
    this.accountLockedUntil = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes lock
    this.captchaRequired = true; // Require CAPTCHA when unlocked
  }

  // Require CAPTCHA after 2 failed attempts
  if (this.failedLoginAttempts >= 2) {
    this.captchaRequired = true;
  }

  return this.save();
};

// Reset failed login attempts (on successful login)
userSchema.methods.resetFailedAttempts = function() {
  this.failedLoginAttempts = 0;
  this.accountLockedUntil = null;
  this.captchaRequired = false;
  return this.save();
};

// Generate security token for CAPTCHA verification
userSchema.methods.generateSecurityToken = function() {
  this.securityToken = crypto.randomBytes(32).toString('hex');
  return this.save().then(() => this.securityToken);
};

// Clear security token
userSchema.methods.clearSecurityToken = function() {
  this.securityToken = null;
  return this.save();
};

// Generate 2FA secret (base32 encoded)
userSchema.methods.generate2FASecret = function() {
  const speakeasy = require('speakeasy');
  const secret = speakeasy.generateSecret({
    name: `Chat-JS (${this.nickname})`,
    issuer: 'Chat-JS'
  });
  this.twoFactorSecret = secret.base32;
  return this.save().then(() => secret);
};

// Enable 2FA
userSchema.methods.enable2FA = function(method = 'TOTP') {
  if (!this.twoFactorSecret) {
    throw new Error('2FA secret not generated');
  }
  this.twoFactorEnabled = true;
  this.twoFactorMethod = method;

  // Generate backup codes (10 codes)
  this.backupCodes = [];
  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(4).toString('hex').toUpperCase();
    this.backupCodes.push(code);
  }

  return this.save();
};

// Disable 2FA
userSchema.methods.disable2FA = function() {
  this.twoFactorEnabled = false;
  this.twoFactorSecret = null;
  this.backupCodes = [];
  return this.save();
};

// Verify 2FA code
userSchema.methods.verify2FACode = function(code, useBackup = false) {
  if (!this.twoFactorEnabled || !this.twoFactorSecret) {
    return false;
  }

  // Check if using backup code
  if (useBackup && this.backupCodes.includes(code)) {
    // Remove used backup code
    this.backupCodes = this.backupCodes.filter(bc => bc !== code);
    return this.save().then(() => true);
  }

  if (useBackup) return false;

  // Verify TOTP
  const speakeasy = require('speakeasy');
  return speakeasy.totp.verify({
    secret: this.twoFactorSecret,
    encoding: 'base32',
    token: code,
    window: 2 // Allow time window for clock skew
  });
};

// Remove password and sensitive data from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  delete userObject.moderationToken;
  delete userObject.moderationTokenExpires;
  delete userObject.securityToken;
  // Don't show ban details to regular users
  if (!this.hasModeratorPrivileges()) {
    delete userObject.banReason;
    delete userObject.banExpires;
    delete userObject.warnings;
    delete userObject.failedLoginAttempts;
    delete userObject.lastFailedAttempt;
    delete userObject.accountLockedUntil;
  }
  return userObject;
};

module.exports = mongoose.model('User', userSchema);