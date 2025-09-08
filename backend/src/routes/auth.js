const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const {} = require('../config/rateLimit').authRateLimiter;

const router = express.Router();

/**
 * @swagger
 * /api/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Login existing user
 *     description: Authenticates and logs in an existing user with JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               user:
 *                 id: "507f1f77bcf86cd799439011"
 *                 nickname: "john_doe"
 *                 email: "john@example.com"
 *                 role: "member"
 *       400:
 *         description: Invalid credentials or validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Invalid credentials"
 *       500:
 *         description: Server error
 */
console.log('🔧 POST /api/login route registered at startup');
router.post('/login', [
  body('identifier').isLength({ min: 1, max: 50 }).trim(),
  body('password').isLength({ min: 6, max: 100 })
], authController.login);

/**
 * @swagger
 * /api/register:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Register new user
 *     description: Creates a new user account and returns JWT token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RegisterRequest'
 *           example:
 *             nickname: "john_doe"
 *             email: "john@example.com"
 *             password: "securePass123"
 *     responses:
 *       201:
 *         description: Registration successful
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *             example:
 *               token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *               user:
 *                 id: "507f1f77bcf86cd799439011"
 *                 nickname: "john_doe"
 *                 email: "john@example.com"
 *                 role: "member"
 *       400:
 *         description: Validation errors or user already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Nickname already taken"
 *       500:
 *         description: Server error
 */
router.post('/register', [
  body('nickname').isLength({ min: 3, max: 50 }).trim().escape(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 })
], authController.register);

console.log('🔧 POST /api/logout route registered at startup');
router.post('/logout', authenticateToken, authController.logout);

router.post('/logout_session', authController.logoutSession);
router.post('/logout_complete', authController.logoutComplete);

console.log('🔧 GET /api/security-status route registered');
router.get('/security-status', authController.checkSecurityStatus);

console.log('🔧 POST /api/unlock-account route registered');
router.post('/unlock-account', [
  body('identifier').isLength({ min: 1, max: 50 }).trim(),
  body('captchaToken').isLength({ min: 1 })
], authController.unlockAccount);

module.exports = router;