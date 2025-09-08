const channelService = require('../services/channelService');
const { logger } = require('../middleware/auth');

class ChannelController {
  constructor() {
    this.logger = logger;
  }

  async getAllChannels(req, res) {
    try {
      const channels = await channelService.getAllChannels();

      logger.info(`Channels list requested by ${req.user.nickname}`, {
        userId: req.user._id,
        channelCount: channels.length
      });

      console.log('📤 Returning channels data:', channels.length);
      res.json(channels);
    } catch (error) {
      logger.error('Error fetching channels:', error);
      console.error('❌ Error in GET /api/channels:', error.message);
      res.status(500).json({ error: 'Failed to fetch channels', code: 'DATABASE_ERROR' });
    }
  }

  async createChannel(req, res) {
    try {
      const { name, type, description } = req.body;
      const createdBy = req.user.nickname;

      const channel = await channelService.createChannel({
        name,
        type,
        description,
        createdBy
      });

      logger.info(`Channel '${name}' created by ${createdBy}`, {
        channelId: channel.id,
        type,
        userId: req.user._id
      });

      res.status(201).json({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        createdBy: channel.createdBy,
        position: channel.position
      });
    } catch (error) {
      logger.error('Error creating channel:', error);

      if (error.message === 'Channel name already exists') {
        return res.status(409).json({
          error: 'Channel name already exists',
          code: 'DUPLICATE_CHANNEL'
        });
      }

      if (error.name === 'ValidationError') {
        return res.status(400).json({
          error: 'Invalid channel data',
          details: error.message
        });
      }

      res.status(500).json({
        error: 'Failed to create channel',
        code: 'DATABASE_ERROR'
      });
    }
  }

  async getChannelById(req, res) {
    try {
      const { channelId } = req.params;
      const channel = await channelService.getChannelById(channelId);

      if (!channel) {
        return res.status(404).json({
          error: 'Channel not found',
          code: 'CHANNEL_NOT_FOUND'
        });
      }

      res.json({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        createdBy: channel.createdBy,
        position: channel.position
      });
    } catch (error) {
      logger.error('Error fetching channel:', error);
      res.status(500).json({ error: 'Failed to fetch channel', code: 'DATABASE_ERROR' });
    }
  }

  async updateChannel(req, res) {
    try {
      const { channelId } = req.params;
      const updateData = req.body;

      const channel = await channelService.updateChannel(channelId, updateData);

      logger.info(`Channel '${channelId}' updated by ${req.user.nickname}`, {
        userId: req.user._id
      });

      res.json({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        description: channel.description,
        createdBy: channel.createdBy,
        position: channel.position
      });
    } catch (error) {
      logger.error('Error updating channel:', error);
      if (error.message === 'Channel not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to update channel', code: 'DATABASE_ERROR' });
      }
    }
  }

  async deleteChannel(req, res) {
    try {
      const { channelId } = req.params;

      // Check if channel exists first
      const channel = await channelService.getChannelById(channelId);
      if (channel.createdBy !== req.user.nickname && !req.user.hasAdminPrivileges()) {
        return res.status(403).json({
          error: 'You can only delete channels you created',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      }

      const deletedChannel = await channelService.deleteChannel(channelId);

      logger.info(`Channel '${channelId}' deleted by ${req.user.nickname}`, {
        userId: req.user._id
      });

      res.json({
        message: 'Channel deleted successfully',
        channel: {
          id: deletedChannel.id,
          name: deletedChannel.name
        }
      });
    } catch (error) {
      logger.error('Error deleting channel:', error);
      if (error.message === 'Channel not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to delete channel', code: 'DATABASE_ERROR' });
      }
    }
  }
}

module.exports = new ChannelController();