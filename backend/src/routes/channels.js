const express = require('express');
const { body } = require('express-validator');
const channelController = require('../controllers/channelController');
const { authenticateToken } = require('../middleware/auth');
const { apiRateLimiter } = require('../config/rateLimit');

const router = express.Router();

console.log('🔧 GET /api/channels route registered at startup');

/**
 * @swagger
 * /api/channels:
 *   get:
 *     tags:
 *       - Channels
 *     summary: Get list of channels
 *     description: Retrieves a list of all available channels
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of channels
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Channel'
 *             example:
 *               - id: "general"
 *                 name: "General"
 *                 type: "text"
 *                 description: ""
 *                 createdBy: "system"
 *                 position: 0
 *       401:
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               error: "Access token required"
 *       500:
 *         description: Internal server error
 */
router.get('/', authenticateToken, apiRateLimiter, channelController.getAllChannels);

console.log('🔧 POST /api/channels route registered at startup');

/**
 * @swagger
 * /api/channels:
 *   post:
 *     tags:
 *       - Channels
 *     summary: Create a new channel
 *     description: Creates a new text or voice channel
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChannelRequest'
 *           example:
 *             name: "NewChannel"
 *             type: "text"
 *             description: "Description of the new channel"
 *     responses:
 *       201:
 *         description: Channel created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Channel'
 *             example:
 *               id: "newchannel"
 *               name: "NewChannel"
 *               type: "text"
 *               description: "Description of the new channel"
 *               createdBy: "john_doe"
 *               position: 10
 *       400:
 *         description: Invalid request data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: Channel name already exists
 *       500:
 *         description: Server error
 */
router.post('/', authenticateToken, apiRateLimiter, [
  body('name').isLength({ min: 1, max: 100 }).trim().escape(),
  body('type').isIn(['text', 'voice']).trim(),
  body('description').optional().isLength({ max: 500 }).trim()
], channelController.createChannel);

router.get('/:channelId', authenticateToken, apiRateLimiter, channelController.getChannelById);
router.put('/:channelId', authenticateToken, apiRateLimiter, channelController.updateChannel);
router.delete('/:channelId', authenticateToken, apiRateLimiter, channelController.deleteChannel);

module.exports = router;