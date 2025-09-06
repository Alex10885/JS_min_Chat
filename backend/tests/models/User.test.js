const User = require('../../models/User');

describe('User Model', () => {
  describe('User Creation', () => {
    it('should create a user with valid data', async () => {
      const userData = {
        nickname: 'testuser',
        email: 'test@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      const savedUser = await user.save();

      expect(savedUser.nickname).toBe(userData.nickname);
      expect(savedUser.email).toBe(userData.email);
      expect(savedUser.role).toBe('member');
      expect(savedUser.status).toBe('offline');
      expect(savedUser.createdAt).toBeDefined();
      expect(savedUser.lastActive).toBeDefined();
    });

    it('should require nickname, email and password', async () => {
      const user = new User({});
      let error;

      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();
      expect(error.errors.email).toBeDefined();
      expect(error.errors.password).toBeDefined();
    });

    it('should enforce unique constraints', async () => {
      const userData1 = {
        nickname: 'duplicateuser',
        email: 'duplicate@example.com',
        password: 'password123'
      };

      const userData2 = {
        nickname: 'duplicateuser',
        email: 'another@example.com',
        password: 'password123'
      };

      await new User(userData1).save();

      let error;
      try {
        await new User(userData2).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.code).toBe(11000); // MongoDB duplicate key error
    });
  });

  describe('Password Methods', () => {
    it('should hash password before saving', async () => {
      const userData = {
        nickname: 'hashuser',
        email: 'hash@example.com',
        password: 'plainpassword'
      };

      const user = new User(userData);
      await user.save();

      expect(user.password).not.toBe(userData.password);
      expect(user.password).toMatch(/^\$2[ayb]\$.{56}$/); // bcrypt hash pattern
    });

    it('should compare passwords correctly', async () => {
      const userData = {
        nickname: 'compareuser',
        email: 'compare@example.com',
        password: 'testpassword'
      };

      const user = new User(userData);
      await user.save();

      const isValidPassword = await user.comparePassword('testpassword');
      const isInvalidPassword = await user.comparePassword('wrongpassword');

      expect(isValidPassword).toBe(true);
      expect(isInvalidPassword).toBe(false);
    });
  });

  describe('JSON Serialization', () => {
    it('should exclude password from JSON output', async () => {
      const userData = {
        nickname: 'jsonuser',
        email: 'json@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      await user.save();

      const jsonUser = user.toJSON();

      expect(jsonUser.password).toBeUndefined();
      expect(jsonUser.nickname).toBe(userData.nickname);
      expect(jsonUser.email).toBe(userData.email);
    });
  });

  describe('Validation', () => {
    it('should enforce nickname length constraints', async () => {
      const shortNickname = new User({
        nickname: 'ab',
        email: 'test@example.com',
        password: 'password123'
      });

      const longNickname = new User({
        nickname: 'a'.repeat(51),
        email: 'test@example.com',
        password: 'password123'
      });

      let shortError, longError;

      try { await shortNickname.save(); } catch (err) { shortError = err; }
      try { await longNickname.save(); } catch (err) { longError = err; }

      expect(shortError).toBeDefined();
      expect(longError).toBeDefined();
    });

    it('should validate email format', async () => {
      const invalidEmail = new User({
        nickname: 'testuser',
        email: 'invalid-email',
        password: 'password123'
      });

      let error;
      try {
        await invalidEmail.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.email).toBeDefined();
    });
  });
});