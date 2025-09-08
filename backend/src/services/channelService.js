const Channel = require('../models/Channel');
const { logger } = require('../middleware/auth');
const {
  cacheQueryResult,
  getCachedQueryResult,
  batchCacheChannels
} = require('./cacheService');

class ChannelService {
  constructor() {
    this.logger = logger;
  }

  async getAllChannels() {
    try {
      // Check cache first
      const cacheKey = 'all-channels-list';
      const cachedChannels = await getCachedQueryResult(cacheKey);

      if (cachedChannels) {
        this.logger.debug('Channels list cache hit');
        return cachedChannels;
      }

      const channels = await Channel.find({})
        .select('-_id id name type description createdBy position')
        .sort({ position: 1 });

      // Cache the result asynchronously (don't wait)
      cacheQueryResult(cacheKey, channels, 300).catch(error =>
        this.logger.warn('Failed to cache channels list:', error.message)
      );

      // Also batch cache individual channels
      batchCacheChannels(channels.slice(0, 20)).catch(error =>
        this.logger.warn('Failed to batch cache channels:', error.message)
      );

      this.logger.debug(`Retrieved ${channels.length} channels`);
      return channels;
    } catch (error) {
      this.logger.error('Error fetching channels:', error);
      throw error;
    }
  }

  async getChannelById(id) {
    try {
      const channel = await Channel.findOne({ id });
      return channel;
    } catch (error) {
      this.logger.error('Error fetching channel by ID:', error);
      throw error;
    }
  }

  async createChannel(channelData) {
    try {
      const { name, type, description, createdBy } = channelData;

      // Create new channel (ID will be auto-generated in pre-save middleware)
      const channel = new Channel({
        name,
        type,
        description,
        createdBy
      });

      await channel.save();

      this.logger.info(`Channel '${name}' created by ${createdBy}`, {
        channelId: channel.id,
        type,
        createdBy
      });

      return channel;
    } catch (error) {
      if (error.code === 11000) {
        throw new Error('Channel name already exists');
      }
      this.logger.error('Error creating channel:', error);
      throw error;
    }
  }

  async updateChannel(channelId, updateData) {
    try {
      const channel = await Channel.findOneAndUpdate(
        { id: channelId },
        updateData,
        { new: true }
      );

      if (!channel) {
        throw new Error('Channel not found');
      }

      this.logger.info(`Channel '${channelId}' updated`);
      return channel;
    } catch (error) {
      this.logger.error('Error updating channel:', error);
      throw error;
    }
  }

  async deleteChannel(channelId) {
    try {
      const result = await Channel.findOneAndDelete({ id: channelId });
      if (!result) {
        throw new Error('Channel not found');
      }

      this.logger.info(`Channel '${channelId}' deleted`);
      return result;
    } catch (error) {
      this.logger.error('Error deleting channel:', error);
      throw error;
    }
  }

  async validateChannelExists(channelId) {
    try {
      const channel = await this.getChannelById(channelId);
      if (!channel) {
        throw new Error('Channel not found');
      }
      return channel;
    } catch (error) {
      this.logger.warn('Channel validation failed:', error.message);
      throw error;
    }
  }

  async createDefaultChannels() {
    try {
      const defaultChannels = [
        { id: 'general', name: 'General', type: 'text', createdBy: 'system' },
        { id: 'voice-chat', name: 'Voice Chat', type: 'voice', createdBy: 'system' }
      ];

      for (const channelData of defaultChannels) {
        await Channel.findOneAndUpdate(
          { id: channelData.id },
          channelData,
          { upsert: true, new: true }
        );
      }

      this.logger.info('Default channels initialized');
    } catch (error) {
      this.logger.error('Error creating default channels:', error);
      throw error;
    }
  }
}

module.exports = new ChannelService();