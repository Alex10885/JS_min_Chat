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
});