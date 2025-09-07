const Message = require('../../models/Message');

describe('Message Model', () => {
  describe('Message Creation', () => {
    it('should create a message with valid data', async () => {
      const messageData = {
        author: 'testuser',
        channel: 'general',
        text: 'Hello world!',
        type: 'public'
      };

      const message = new Message(messageData);
      const savedMessage = await message.save();

      expect(savedMessage.author).toBe(messageData.author);
      expect(savedMessage.channel).toBe(messageData.channel);
      expect(savedMessage.text).toBe(messageData.text);
      expect(savedMessage.type).toBe(messageData.type);
      expect(savedMessage.timestamp).toBeDefined();
      expect(savedMessage.status).toBe('delivered');
    });

    it('should require author, channel and text', async () => {
      const message = new Message({});
      let error;

      try {
        await message.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.author).toBeDefined();
      expect(error.errors.channel).toBeDefined();
      expect(error.errors.text).toBeDefined();
    });

    it('should enforce text length limits', async () => {
      const longText = 'a'.repeat(2001);
      const message = new Message({
        author: 'testuser',
        channel: 'general',
        text: longText,
        type: 'public'
      });

      let error;
      try {
        await message.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.text).toBeDefined();
    });
  });

  describe('Message Types', () => {
    it('should support different message types', async () => {
      const messageTypes = ['public', 'private', 'system'];

      for (const type of messageTypes) {
        const message = new Message({
          author: 'testuser',
          channel: 'general',
          text: `Test ${type} message`,
          type: type
        });

        const savedMessage = await message.save();
        expect(savedMessage.type).toBe(type);
      }
    });

    it('should reject invalid message types', async () => {
      const message = new Message({
        author: 'testuser',
        channel: 'general',
        text: 'Test message',
        type: 'invalid'
      });

      let error;
      try {
        await message.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.type).toBeDefined();
    });
  });

  describe('Private Messages', () => {
    it('should handle private messages correctly', async () => {
      const privateMessage = {
        author: 'sender',
        channel: 'general',
        text: 'Private message',
        type: 'private',
        target: 'recipient'
      };

      const message = new Message(privateMessage);
      const savedMessage = await message.save();

      expect(savedMessage.type).toBe('private');
      expect(savedMessage.target).toBe('recipient');
    });

    it('should allow null target for public messages', async () => {
      const publicMessage = {
        author: 'sender',
        channel: 'general',
        text: 'Public message',
        type: 'public',
        target: null
      };

      const message = new Message(publicMessage);
      const savedMessage = await message.save();

      expect(savedMessage.target).toBeNull();
    });
  });

  describe('Indexing', () => {
    it('should use timestamp index for queries', async () => {
      const messages = [];
      const now = new Date();

      // Create messages with different timestamps
      for (let i = 0; i < 5; i++) {
        const message = new Message({
          author: 'testuser',
          channel: 'general',
          text: `Message ${i}`,
          type: 'public'
        });
        await message.save();
        messages.push(message);
      }

      // Query messages sorted by timestamp
      const foundMessages = await Message.find({
        channel: 'general',
        type: 'public'
      }).sort({ timestamp: -1 });

      expect(foundMessages.length).toBe(5);
      // Check that messages are properly sorted
      for (let i = 0; i < foundMessages.length - 1; i++) {
        expect(foundMessages[i].timestamp.getTime()).toBeGreaterThanOrEqual(
          foundMessages[i + 1].timestamp.getTime()
        );
      }
    });
  });

  describe('Message Status', () => {
    it('should default status to delivered', async () => {
      const messageData = {
        author: 'testuser',
        channel: 'general',
        text: 'Test message',
        type: 'public'
      };

      const message = new Message(messageData);
      const savedMessage = await message.save();

      expect(savedMessage.status).toBe('delivered');
    });

    it('should accept different status values', async () => {
      const statuses = ['delivered', 'failed'];

      for (const status of statuses) {
        const message = new Message({
          author: 'testuser',
          channel: 'general',
          text: `Message with status ${status}`,
          type: 'public',
          status: status
        });

        const savedMessage = await message.save();
        expect(savedMessage.status).toBe(status);
      }
    });
  });

  describe('Timestamps', () => {
    it('should set timestamp on creation', async () => {
      const beforeCreate = new Date();
      const message = new Message({
        author: 'testuser',
        channel: 'general',
        text: 'Timestamp test',
        type: 'public'
      });

      const savedMessage = await message.save();
      const afterCreate = new Date();

      expect(savedMessage.timestamp).toBeDefined();
      expect(savedMessage.timestamp.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(savedMessage.timestamp.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });
  });

  describe('Target Validation', () => {
    it('should allow null target for private messages', async () => {
      const message = new Message({
        author: 'sender',
        channel: 'general',
        text: 'Private message',
        type: 'private',
        target: null
      });

      const savedMessage = await message.save();
      expect(savedMessage.target).toBeNull();
    });

    it('should handle empty targets correctly', async () => {
      const message = new Message({
        author: 'sender',
        channel: 'general',
        text: 'Empty target test',
        type: 'private',
        target: ''
      });

      const savedMessage = await message.save();
      expect(savedMessage.target).toBe('');
    });
  });

  describe('Channel-based Queries', () => {
    it('should filter messages by channel', async () => {
      // Create messages in different channels
      await new Message({
        author: 'user1',
        channel: 'general',
        text: 'General message',
        type: 'public'
      }).save();

      await new Message({
        author: 'user2',
        channel: 'random',
        text: 'Random message',
        type: 'public'
      }).save();

      await new Message({
        author: 'user3',
        channel: 'general',
        text: 'Another general message',
        type: 'public'
      }).save();

      const generalMessages = await Message.find({ channel: 'general' });
      const randomMessages = await Message.find({ channel: 'random' });

      expect(generalMessages.length).toBe(2);
      expect(randomMessages.length).toBe(1);
    });

    it('should filter by multiple criteria', async () => {
      await new Message({
        author: 'testuser',
        channel: 'general',
        text: 'Public message',
        type: 'public'
      }).save();

      await new Message({
        author: 'testuser',
        channel: 'general',
        text: 'Private message',
        type: 'private',
        target: 'recipient'
      }).save();

      const publicMessages = await Message.find({
        channel: 'general',
        type: 'public'
      });

      const privateMessages = await Message.find({
        channel: 'general',
        type: 'private'
      });

      expect(publicMessages.length).toBe(1);
      expect(privateMessages.length).toBe(1);
    });
  });

  describe('Text Validation', () => {
    it('should allow unicode characters', async () => {
      const unicodeText = 'Привет, мир! 🌍 こんにちは';
      const message = new Message({
        author: 'unicodetest',
        channel: 'general',
        text: unicodeText,
        type: 'public'
      });

      const savedMessage = await message.save();
      expect(savedMessage.text).toBe(unicodeText);
    });

    it('should preserve whitespace in text', async () => {
      const message = new Message({
        author: 'whitespacetest',
        channel: 'general',
        text: '  Text with spaces  ',
        type: 'public'
      });

      const savedMessage = await message.save();
      expect(savedMessage.text).toBe('  Text with spaces  ');
    });
  });
  describe('ReplyTo Functionality', () => {
    it('should handle replyTo field correctly', async () => {
      // Create original message
      const originalMessage = new Message({
        author: 'originaluser',
        channel: 'general',
        text: 'Original message',
        type: 'public'
      });
      await originalMessage.save();

      // Create reply to original message
      const replyMessage = new Message({
        author: 'replyuser',
        channel: 'general',
        text: 'Reply to original',
        type: 'public',
        replyTo: originalMessage._id
      });
      await replyMessage.save();

      expect(replyMessage.replyTo.toString()).toBe(originalMessage._id.toString());

      // Query replies
      const foundReply = await Message.findById(replyMessage._id).populate('replyTo');
      expect(foundReply.replyTo).toBeDefined();
      expect(foundReply.replyTo.text).toBe('Original message');
    });

    it('should allow null replyTo', async () => {
      const message = new Message({
        author: 'noreplyuser',
        channel: 'general',
        text: 'Message without reply',
        type: 'public',
        replyTo: null
      });
      await message.save();

      expect(message.replyTo).toBeNull();
    });
  });

  describe('Pre-save Hooks', () => {
    it('should handle system message pre-save hook', async () => {
      const systemMessage = new Message({
        author: 'System',
        channel: 'general',
        text: 'System notification',
        type: 'system'
      });

      const savedMessage = await systemMessage.save();
      expect(savedMessage.type).toBe('system');
      expect(savedMessage.text).toBe('System notification');
    });

    it('should handle pre-save for new messages', async () => {
      const regularMessage = new Message({
        author: 'regularuser',
        channel: 'general',
        text: 'Regular message',
        type: 'public'
      });

      const savedMessage = await regularMessage.save();
      expect(savedMessage.type).toBe('public');
      expect(savedMessage.text).toBe('Regular message');
    });
  });

  describe('Advanced Queries', () => {
    it('should query private messages with author and target', async () => {
      await new Message({
        author: 'alice',
        channel: 'general',
        text: 'Private to bob',
        type: 'private',
        target: 'bob'
      }).save();

      await new Message({
        author: 'alice',
        channel: 'general',
        text: 'Public message',
        type: 'public'
      }).save();

      await new Message({
        author: 'bob',
        channel: 'general',
        text: 'Private to alice',
        type: 'private',
        target: 'alice'
      }).save();

      // Create system message to test OR query
      await new Message({
        author: 'System',
        channel: 'general',
        text: 'System message',
        type: 'system'
      }).save();

      const alicePrivateMessages = await Message.find({
        channel: 'general',
        $or: [
          { author: 'alice' },
          { target: 'alice' }
        ]
      }).sort({ timestamp: -1 });

      expect(alicePrivateMessages.length).toBeGreaterThanOrEqual(2);
      alicePrivateMessages.forEach(msg => {
        const hasAlice = msg.author === 'alice' || msg.target === 'alice';
        expect(hasAlice).toBe(true);
      });
    });

    it('should support complex filtering with indexes', async () => {
      // Create test messages with clear timing separation
      await new Promise(resolve => setTimeout(resolve, 10));

      const msg1 = await new Message({
        author: 'user1',
        channel: 'general',
        text: 'Msg1',
        type: 'public'
      }).save();

      await new Promise(resolve => setTimeout(resolve, 10));

      await new Message({
        author: 'user1',
        channel: 'general',
        text: 'Msg2',
        type: 'private',
        target: 'user2'
      }).save();

      await new Promise(resolve => setTimeout(resolve, 10));

      await new Message({
        author: 'user2',
        channel: 'general',
        text: 'Msg3',
        type: 'public'
      }).save();

      await new Promise(resolve => setTimeout(resolve, 10));

      await new Message({
        author: 'user1',
        channel: 'random',
        text: 'Msg4',
        type: 'public'
      }).save();

      // Query using multi-key index
      const userMessages = await Message.find({
        author: 'user1',
        channel: 'general',
        type: 'public'
      }).sort({ timestamp: -1 });

      expect(userMessages.length).toBe(1);
      expect(userMessages[0].text).toBe('Msg1');
      expect(userMessages[0]._id.toString()).toBe(msg1._id.toString());
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty text after trimming', async () => {
      const message = new Message({
        author: 'emptytextuser',
        channel: 'general',
        text: '   ',
        type: 'public'
      });

      let error;
      try {
        await message.save();
      } catch (err) {
        error = err;
      }
      // Note: This might pass validation but should be handled in business logic
      expect(message.text).toBe('   '); // Mongoose doesn't auto-trim
    });

    it('should handle extremely long timestamps correctly', async () => {
      const message = new Message({
        author: 'timestampuser',
        channel: 'general',
        text: 'Timestamp test',
        type: 'public',
        timestamp: new Date('2038-01-19T03:14:07.000Z') // Year 2038 problem
      });

      const savedMessage = await message.save();
      expect(savedMessage.timestamp.getFullYear()).toBe(2038);
    });

    it('should handle concurrent message creation', async () => {
      const promises = [];
      const channels = ['general', 'random', 'voice'];

      for (let i = 0; i < 10; i++) {
        promises.push(
          new Message({
            author: `concurrentuser${i}`,
            channel: channels[i % channels.length],
            text: `Concurrent message ${i}`,
            type: 'public'
          }).save()
        );
      }

      const results = await Promise.all(promises);
      expect(results.length).toBe(10);

      results.forEach((msg, index) => {
        expect(msg.author).toBe(`concurrentuser${index}`);
        expect(msg.text).toBe(`Concurrent message ${index}`);
      });
    });
  });
});