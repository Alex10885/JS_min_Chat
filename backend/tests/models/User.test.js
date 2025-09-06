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

    it('should normalize email format', async () => {
      const user = new User({
        nickname: 'emailtest',
        email: 'TEST@EXAMPLE.COM',
        password: 'password123'
      });

      await user.save();
      expect(user.email).toBe('test@example.com'); // Normalized to lowercase
    });
  });

  describe('Status Management', () => {
    it('should update lastActive timestamp', async () => {
      const userData = {
        nickname: 'activetest',
        email: 'active@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      const originalLastActive = user.lastActive;

      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay

      user.lastActive = new Date();
      await user.save();

      expect(user.lastActive.getTime()).toBeGreaterThan(originalLastActive.getTime());
    });

    it('should handle online/offline status correctly', async () => {
      const userData = {
        nickname: 'statustest',
        email: 'status@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      expect(user.status).toBe('offline');

      user.status = 'online';
      await user.save();

      const foundUser = await User.findById(user._id);
      expect(foundUser.status).toBe('online');
    });
  });

  describe('Role Management', () => {
    it('should default to member role', async () => {
      const userData = {
        nickname: 'roledefault',
        email: 'role@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      await user.save();

      expect(user.role).toBe('member');
    });

    it('should accept admin role', async () => {
      const userData = {
        nickname: 'admintest',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin'
      };

      const user = new User(userData);
      await user.save();

      expect(user.role).toBe('admin');
    });

    it('should reject invalid roles', async () => {
      const userData = {
        nickname: 'invalidrole',
        email: 'invalid@example.com',
        password: 'password123',
        role: 'superuser'
      };

      const user = new User(userData);
      let error;

      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.role).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings properly', async () => {
      const userData = {
        nickname: '   ',
        email: 'spaces@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      let error;

      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();
    });

    it('should trim whitespace from fields', async () => {
      const userData = {
        nickname: '  trimmed ',
        email: 'trim@example.com',
        password: 'password123'
      };

      const user = new User(userData);
      await user.save();

      expect(user.nickname).toBe('trimmed');
      expect(user.email).toBe('trim@example.com');
    });
  });
});