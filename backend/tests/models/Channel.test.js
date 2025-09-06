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
});