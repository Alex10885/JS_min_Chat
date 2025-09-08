const express = require('express');
const { body } = require('express-validator');
const userController = require('../controllers/userController');
const { authenticateToken, requireModerator, requireAdmin } = require('../middleware/auth');
const { apiRateLimiter } = require('../config/rateLimit');

const router = express.Router();

/**
 * @swagger
 * /api/users:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get list of all registered users
 *     description: Retrieves a list of all users with their roles and online status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of users successfully retrieved
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     description: User's unique identifier
 *                   nickname:
 *                     type: string
 *                     description: User's display name
 *                   role:
 *                     type: string
 *                     enum: [admin, moderator, member]
 *                     description: User's role level
 *                   status:
 *                     type: string
 *                     enum: [online, offline]
 *                     description: User's online status
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 *                     description: User registration date
 *                   lastActive:
 *                     type: string
 *                     format: date-time
 *                     description: Last activity timestamp
 *             example:
 *               - id: "507f1f77bcf86cd799439011"
 *                 nickname: "john_doe"
 *                 role: "member"
 *                 status: "online"
 *                 createdAt: "2024-09-07T10:30:00Z"
 *                 lastActive: "2024-09-07T22:15:00Z"
 *       401:
 *         description: Authentication required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Server error
 */
console.log('🔧 GET /api/users route registered at startup');
router.get('/', authenticateToken, apiRateLimiter, userController.getAllUsers);

// Administrative routes
router.get('/admin', authenticateToken, requireModerator, apiRateLimiter, userController.getUsersPaginated);

// Ban user
router.post('/:userId/ban', authenticateToken, requireModerator, apiRateLimiter, [
  body('reason').isLength({ min: 1, max: 500 }).trim(),
  body('duration').optional().isInt({ min: 1, max: 31536000 }) // Max 1 year in seconds
], userController.banUser);

// Unban user
router.post('/:userId/unban', authenticateToken, requireModerator, apiRateLimiter, userController.unbanUser);

// Warn user
router.post('/:userId/warn', authenticateToken, requireModerator, apiRateLimiter, [
  body('reason').isLength({ min: 1, max: 500 }).trim(),
  body('duration').optional().isInt({ min: 1, max: 31536000 })
], userController.warnUser);

// Change user role
router.post('/:userId/role', authenticateToken, requireAdmin, apiRateLimiter, [
  body('role').isIn(['member', 'moderator', 'admin'])
], userController.changeUserRole);

// Mute user
router.post('/:userId/mute', authenticateToken, requireModerator, apiRateLimiter, [
  body('duration').isInt({ min: 60, max: 86400 }) // 1 minute to 24 hours
], userController.muteUser);

// Unmute user
router.post('/:userId/unmute', authenticateToken, requireModerator, apiRateLimiter, userController.unmuteUser);

module.exports = router;