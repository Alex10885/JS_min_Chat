const Channel = require('../../models/Channel');

describe('Channel Model', () => {
  describe('Channel Creation', () => {
    it('should create a channel with valid data', async () => {
      const channelData = {
        id: 'test-channel',
        name: 'Test Channel',
        type: 'text',
        createdBy: 'testuser'
      };

      const channel = new Channel(channelData);
      const savedChannel = await channel.save();

      expect(savedChannel.id).toBe(channelData.id);
      expect(savedChannel.name).toBe(channelData.name);
      expect(savedChannel.type).toBe(channelData.type);
      expect(savedChannel.createdBy).toBe(channelData.createdBy);
      expect(savedChannel.position).toBe(0);
      expect(savedChannel.locked).toBe(false);
    });

    it('should require id, name, type and createdBy', async () => {
      const channel = new Channel({});
      let error;

      try {
        await channel.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.id).toBeDefined();
      expect(error.errors.name).toBeDefined();
      expect(error.errors.type).toBeDefined();
      expect(error.errors.createdBy).toBeDefined();
    });

    it('should enforce channel name length limits', async () => {
      const longName = 'a'.repeat(101);
      const channel = new Channel({
        id: 'test',
        name: longName,
        type: 'text',
        createdBy: 'testuser'
      });

      let error;
      try {
        await channel.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.name).toBeDefined();
    });
  });

  describe('Channel Types', () => {
    it('should support text and voice channel types', async () => {
      const types = ['text', 'voice'];

      for (const type of types) {
        const channel = new Channel({
          id: `${type}-channel`,
          name: `${type} Channel`,
          type: type,
          createdBy: 'testuser'
        });

        const savedChannel = await channel.save();
        expect(savedChannel.type).toBe(type);
      }
    });

    it('should reject invalid channel types', async () => {
      const channel = new Channel({
        id: 'invalid-channel',
        name: 'Invalid Channel',
        type: 'invalid',
        createdBy: 'testuser'
      });

      let error;
      try {
        await channel.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.type).toBeDefined();
    });
  });

  describe('Channel Properties', () => {
    it('should handle optional properties correctly', async () => {
      const channelData = {
        id: 'optional-channel',
        name: 'Optional Channel',
        type: 'voice',
        createdBy: 'testuser',
        description: 'Channel description',
        position: 5,
        locked: true
      };

      const channel = new Channel(channelData);
      const savedChannel = await channel.save();

      expect(savedChannel.description).toBe(channelData.description);
      expect(savedChannel.position).toBe(channelData.position);
      expect(savedChannel.locked).toBe(channelData.locked);
    });

    it('should set default values', async () => {
      const channel = new Channel({
        id: 'default-channel',
        name: 'Default Channel',
        type: 'text',
        createdBy: 'testuser'
      });

      const savedChannel = await channel.save();

      expect(savedChannel.position).toBe(0);
      expect(savedChannel.locked).toBe(false);
      expect(savedChannel.parent).toBeNull();
      expect(savedChannel.permissions.read).toBe('everyone');
      expect(savedChannel.permissions.write).toBe('everyone');
    });
  });

  describe('Permissions', () => {
    it('should enforce permission enums', async () => {
      const channel = new Channel({
        id: 'permission-channel',
        name: 'Permission Channel',
        type: 'text',
        createdBy: 'testuser',
        permissions: {
          read: 'invalid',
          write: 'invalid'
        }
      });

      let error;
      try {
        await channel.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors['permissions.read']).toBeDefined();
      expect(error.errors['permissions.write']).toBeDefined();
    });
  });

  describe('Unique Constraints', () => {
    it('should enforce unique channel IDs', async () => {
      const channelData1 = {
        id: 'unique-channel',
        name: 'Unique Channel 1',
        type: 'text',
        createdBy: 'testuser'
      };

      const channelData2 = {
        id: 'unique-channel',
        name: 'Unique Channel 2',
        type: 'text',
        createdBy: 'testuser'
      };

      await new Channel(channelData1).save();

      let error;
      try {
        await new Channel(channelData2).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe(11000); // MongoDB duplicate key error
    });
  });

  describe('Channel Positioning', () => {
    it('should sort channels by position', async () => {
      // Create channels with different positions
      const channels = [
        { id: 'first', name: 'First Channel', type: 'text', createdBy: 'testuser', position: 1 },
        { id: 'second', name: 'Second Channel', type: 'text', createdBy: 'testuser', position: 2 },
        { id: 'third', name: 'Third Channel', type: 'text', createdBy: 'testuser', position: 0 }
      ];

      for (const channelData of channels) {
        await new Channel(channelData).save();
      }

      const sortedChannels = await Channel.find().sort({ position: 1 });

      expect(sortedChannels[0].position).toBe(0);
      expect(sortedChannels[1].position).toBe(1);
      expect(sortedChannels[2].position).toBe(2);
    });

    it('should handle position updates', async () => {
      const channel = new Channel({
        id: 'position-test',
        name: 'Position Test',
        type: 'text',
        createdBy: 'testuser',
        position: 5
      });

      await channel.save();
      expect(channel.position).toBe(5);

      // Update position
      channel.position = 10;
      await channel.save();

      const updatedChannel = await Channel.findById(channel._id);
      expect(updatedChannel.position).toBe(10);
    });
  });

  describe('Channel Locking', () => {
    it('should handle locked channels', async () => {
      const channel = new Channel({
        id: 'locked-test',
        name: 'Locked Channel',
        type: 'text',
        createdBy: 'admin',
        locked: true
      });

      await channel.save();
      expect(channel.locked).toBe(true);

      // Update lock status
      channel.locked = false;
      await channel.save();

      const updatedChannel = await Channel.findById(channel._id);
      expect(updatedChannel.locked).toBe(false);
    });
  });

  describe('Channel Categories', () => {
    it('should handle parent channels', async () => {
      const parentChannel = new Channel({
        id: 'parent-category',
        name: 'Parent Category',
        type: 'text',
        createdBy: 'testuser'
      });

      await parentChannel.save();

      const childChannel = new Channel({
        id: 'child-channel',
        name: 'Child Channel',
        type: 'text',
        createdBy: 'testuser',
        parent: parentChannel._id
      });

      await childChannel.save();
      expect(childChannel.parent.toString()).toBe(parentChannel._id.toString());
    });

    it('should allow null parent for root channels', async () => {
      const channel = new Channel({
        id: 'root-channel',
        name: 'Root Channel',
        type: 'text',
        createdBy: 'testuser',
        parent: null
      });

      await channel.save();
      expect(channel.parent).toBeNull();
    });
  });

  describe('Created By Reference', () => {
    it('should store createdBy nickname', async () => {
      const channel = new Channel({
        id: 'creator-test',
        name: 'Creator Test',
        type: 'text',
        createdBy: 'admin-user-123'
      });

      await channel.save();
      expect(channel.createdBy).toBe('admin-user-123');
    });
  });

  describe('ID Sanitization', () => {
    it('should accept valid ID formats', async () => {
      const validIds = ['general', 'voice_chat', 'channel_123', 'test-channel'];

      for (const id of validIds) {
        const channel = new Channel({
          id: id,
          name: 'Test Channel',
          type: 'text',
          createdBy: 'testuser'
        });

        const savedChannel = await channel.save();
        expect(savedChannel.id).toBe(id);
      }
    });

    it('should handle empty ID', async () => {
      const channel = new Channel({
        id: '',
        name: 'Empty ID',
        type: 'text',
        createdBy: 'testuser'
      });

      let error;
      try {
        await channel.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.id).toBeDefined();
    });
  });

  describe('Timestamps', () => {
    it('should set createdAt and updatedAt timestamps', async () => {
      const beforeCreate = new Date();

      const channel = new Channel({
        id: 'timestamp-test',
        name: 'Timestamp Test',
        type: 'text',
        createdBy: 'testuser'
      });

      const savedChannel = await channel.save();
      const afterCreate = new Date();

      expect(savedChannel.createdAt).toBeDefined();
      expect(savedChannel.updatedAt).toBeDefined();
      expect(savedChannel.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(savedChannel.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });
  });
});