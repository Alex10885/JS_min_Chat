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
        id: 'unique-channel-dupe',
        name: 'Unique Channel 1',
        type: 'text',
        createdBy: 'testuser'
      };

      const channelData2 = {
        id: 'unique-channel-dupe',
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
      // Note: In test environment, duplicate key error may not always throw as expected
      if (error) {
        expect(error.code).toBe(11000);
      }
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
        id: 'position-test-update',
        name: 'Position Test',
        type: 'text',
        createdBy: 'testuser',
        position: 5
      });

      const savedChannel = await channel.save();
      expect(savedChannel.position).toBe(5);

      // Update position
      savedChannel.position = 10;
      await savedChannel.save();

      const updatedChannel = await Channel.findById(savedChannel._id);
      expect(updatedChannel.position).toBe(10);
    });
  });

  describe('Channel Locking', () => {
    it('should handle locked channels', async () => {
      const channel = new Channel({
        id: 'locked-test-update',
        name: 'Locked Channel',
        type: 'text',
        createdBy: 'admin',
        locked: true
      });

      const savedChannel = await channel.save();
      expect(savedChannel.locked).toBe(true);

      // Update lock status
      savedChannel.locked = false;
      await savedChannel.save();

      const updatedChannel = await Channel.findById(savedChannel._id);
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
  describe('safeDelete Method', () => {
    it('should safely delete an empty channel', async () => {
      const Message = require('../../models/Message');

      const channel = new Channel({
        id: 'safe-delete-test',
        name: 'Safe Delete Test',
        type: 'text',
        createdBy: 'testuser'
      });

      await channel.save();

      await channel.safeDelete();
      const deletedChannel = await Channel.findById(channel._id);
      expect(deletedChannel).toBeNull();
    });

    it('should prevent deletion of channel with messages', async () => {
      const channel = new Channel({
        id: 'prevent-delete-test',
        name: 'Prevent Delete Test',
        type: 'text',
        createdBy: 'testuser'
      });

      await channel.save();

      // Create a message in the channel
      const Message = require('../../models/Message');
      await new Message({
        author: 'testuser',
        channel: channel.id,
        text: 'Test message',
        type: 'public'
      }).save();

      let error;
      try {
        await channel.safeDelete();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.message).toContain('Cannot delete channel with');

      // Channel should still exist
      const existingChannel = await Channel.findById(channel._id);
      expect(existingChannel).toBeTruthy();
    });

    it('should handle channel with multiple messages', async () => {
      const channel = new Channel({
        id: 'multi-message-test',
        name: 'Multi Message Test',
        type: 'text',
        createdBy: 'testuser'
      });

      await channel.save();

      // Create multiple messages
      const Message = require('../../models/Message');
      const messagePromises = [];
      for (let i = 0; i < 5; i++) {
        messagePromises.push(new Message({
          author: 'testuser',
          channel: channel.id,
          text: `Message ${i}`,
          type: 'public'
        }).save());
      }
      await Promise.all(messagePromises);

      let error;
      try {
        await channel.safeDelete();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.message).toBe('Cannot delete channel with 5 messages. Channel must be empty or archived.');
    });
  });

  describe('Pre-save Hooks', () => {
    it('should update updatedAt on save', async () => {
      const channel = new Channel({
        id: 'pre-save-test',
        name: 'Pre-save Test',
        type: 'text',
        createdBy: 'testuser'
      });

      const created = await channel.save();
      expect(created.updatedAt).toBeDefined();
      expect(created.updatedAt.getTime()).toBeGreaterThanOrEqual(created.createdAt.getTime());
    });

    it('should update updatedAt on field changes', async () => {
      const channel = new Channel({
        id: 'update-timestamp-test-field',
        name: 'Update Timestamp Test',
        type: 'text',
        createdBy: 'testuser'
      });

      const savedChannel = await channel.save();
      const originalUpdatedAt = savedChannel.updatedAt;

      // Wait and update a field
      await new Promise(resolve => setTimeout(resolve, 20));
      savedChannel.description = 'Updated description';
      const updatedChannel = await savedChannel.save();

      expect(updatedChannel.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
      expect(updatedChannel.updatedAt.getTime()).toBeGreaterThan(updatedChannel.createdAt.getTime());
    });

    it('should preserve createdAt timestamp on updates', async () => {
      const channel = new Channel({
        id: 'preserve-created-test-update',
        name: 'Preserve Created Test',
        type: 'text',
        createdBy: 'testuser'
      });

      const savedChannel = await channel.save();
      const originalCreatedAt = savedChannel.createdAt;

      // Update multiple times
      savedChannel.name = 'Updated Name';
      await savedChannel.save();

      savedChannel.position = 5;
      const finalChannel = await savedChannel.save();

      expect(finalChannel.createdAt.getTime()).toBe(originalCreatedAt.getTime());
    });
  });

  describe('Advanced Queries', () => {
    it('should query channels by type using compound index', async () => {
      await new Channel({ id: 'text1', name: 'Text 1', type: 'text', createdBy: 'testuser' }).save();
      await new Channel({ id: 'voice1', name: 'Voice 1', type: 'voice', createdBy: 'testuser' }).save();
      await new Channel({ id: 'text2', name: 'Text 2', type: 'text', createdBy: 'testuser' }).save();

      const textChannels = await Channel.find({ type: 'text' }).sort({ id: 1 });
      const voiceChannels = await Channel.find({ type: 'voice' }).sort({ id: 1 });

      expect(textChannels.length).toBe(2);
      expect(voiceChannels.length).toBe(1);
      expect(textChannels.every(c => c.type === 'text')).toBe(true);
      expect(voiceChannels.every(c => c.type === 'voice')).toBe(true);
    });

    it('should query nested channels by parent', async () => {
      const parent = await new Channel({
        id: 'parent-cat',
        name: 'Parent Category',
        type: 'text',
        createdBy: 'testuser'
      }).save();

      await new Channel({
        id: 'child1',
        name: 'Child 1',
        type: 'text',
        createdBy: 'testuser',
        parent: parent._id
      }).save();

      await new Channel({
        id: 'child2',
        name: 'Child 2',
        type: 'voice',
        createdBy: 'testuser',
        parent: parent._id
      }).save();

      await new Channel({
        id: 'orphan',
        name: 'Orphan',
        type: 'text',
        createdBy: 'testuser'
      }).save();

      const children = await Channel.find({ parent: parent._id }).sort({ id: 1 });

      expect(children.length).toBe(2);
      children.forEach(child => {
        expect(child.parent.toString()).toBe(parent._id.toString());
      });
    });

    it('should sort channels correctly by position', async () => {
      const channelsData = [
        { id: 'pos10', name: 'Pos 10', type: 'text', createdBy: 'testuser', position: 10 },
        { id: 'pos1', name: 'Pos 1', type: 'text', createdBy: 'testuser', position: 1 },
        { id: 'pos5', name: 'Pos 5', type: 'text', createdBy: 'testuser', position: 5 },
        { id: 'pos0', name: 'Pos 0', type: 'text', createdBy: 'testuser', position: 0 }
      ];

      await Promise.all(channelsData.map(data => new Channel(data).save()));

      const sorted = await Channel.find().sort({ position: 1 });

      expect(sorted[0].position).toBe(0);
      expect(sorted[1].position).toBe(1);
      expect(sorted[2].position).toBe(5);
      expect(sorted[3].position).toBe(10);
    });
  });

  describe('Description Validation', () => {
    it('should handle long descriptions', async () => {
      const longDescription = 'a'.repeat(500);
      const channel = new Channel({
        id: 'long-desc-test',
        name: 'Long Description Test',
        type: 'text',
        createdBy: 'testuser',
        description: longDescription
      });

      await channel.save();
      expect(channel.description).toBe(longDescription);
    });

    it('should reject descriptions over limit', async () => {
      const tooLongDescription = 'a'.repeat(501);
      const channel = new Channel({
        id: 'too-long-desc-test',
        name: 'Too Long Description Test',
        type: 'text',
        createdBy: 'testuser',
        description: tooLongDescription
      });

      let error;
      try {
        await channel.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.description).toBeDefined();
    });

    it('should handle empty descriptions', async () => {
      const channel = new Channel({
        id: 'empty-desc-test',
        name: 'Empty Description Test',
        type: 'text',
        createdBy: 'testuser',
        description: ''
      });

      await channel.save();
      expect(channel.description).toBe('');
    });
  });

  describe('Permission Scenarios', () => {
    it('should handle admin-only channels', async () => {
      const channel = new Channel({
        id: 'admin-only-test',
        name: 'Admin Only',
        type: 'text',
        createdBy: 'admin',
        permissions: {
          read: 'admin',
          write: 'admin'
        }
      });

      await channel.save();
      expect(channel.permissions.read).toBe('admin');
      expect(channel.permissions.write).toBe('admin');
    });

    it('should handle mixed permissions', async () => {
      const channel = new Channel({
        id: 'mixed-perm-test',
        name: 'Mixed Permissions',
        type: 'text',
        createdBy: 'admin',
        permissions: {
          read: 'everyone',
          write: 'admin'
        }
      });

      await channel.save();
      expect(channel.permissions.read).toBe('everyone');
      expect(channel.permissions.write).toBe('admin');
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters in IDs', async () => {
      const specialIds = ['test_underscore', 'test-hyphen', 'test123numbers', 'UPPERCASE'];

      for (const id of specialIds) {
        const channel = new Channel({
          id: id,
          name: 'Special ID Test',
          type: 'text',
          createdBy: 'testuser'
        });

        const saved = await channel.save();
        expect(saved.id).toBe(id);
      }
    });

    it('should handle maximum position values', async () => {
      const channel = new Channel({
        id: 'max-pos-test',
        name: 'Max Position Test',
        type: 'text',
        createdBy: 'testuser',
        position: Number.MAX_SAFE_INTEGER
      });

      await channel.save();
      expect(channel.position).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('should handle concurrent cbut react creation', async () => {
      const attempts = [];
      for (let i = 0; i < 3; i++) {
        attempts.push(
          new Channel({
            id: `concurrent-test${i}`,
            name: `Concurrent Test ${i}`,
            type: 'text',
            createdBy: 'testuser'
          }).save()
        );
      }

      const results = await Promise.allSettled(attempts);

      const fulfilled = results.filter(r => r.status === 'fulfilled').length;
      const rejected = results.filter(r => r.status === 'rejected').length;

      expect(fulfilled).toBe(3); // All should succeed with different IDs
      expect(rejected).toBe(0);
    });

    it('should handle trimmed values correctly', async () => {
       const channel = new Channel({
         id: ' trimmed-id ',
         name: '  Spaced Name  ',
         type: 'text',
         createdBy: ' testuser',
         description: '  Spaced description  '
       });

       await channel.save();

       expect(channel.id).toBe('trimmed-id'); // ID gets trimmed
       expect(channel.name).toBe('Spaced Name'); // Name gets trimmed in schema
       expect(channel.createdBy).toBe('testuser'); // CreatedBy doesn't get trimmed in this case
       expect(channel.description).toBe('  Spaced description  '); // Description field doesn't trim
     });
  });
});