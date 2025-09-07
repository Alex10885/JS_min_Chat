const User = require('../../models/User');

describe('User Model', () => {
  describe('User Creation and Validation', () => {
    it('should create a user with valid data', async () => {
      const userData = {
        nickname: 'testuser',
        email: 'test@example.com',
        password: 'password123',
        role: 'member'
      };

      const user = new User(userData);
      const savedUser = await user.save();

      expect(savedUser.nickname).toBe(userData.nickname);
      expect(savedUser.email).toBe(userData.email.toLowerCase());
      expect(savedUser.role).toBe(userData.role);
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
    });

    it('should enforce nickname length limits', async () => {
      const shortNickname = 'ab'; // too short
      let error;

      try {
        await new User({
          nickname: shortNickname,
          email: 'test@example.com',
          password: 'password123'
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();

      const longNickname = 'a'.repeat(51); // too long
      try {
        await new User({
          nickname: longNickname,
          email: 'test@example.com',
          password: 'password123'
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();
    });

    it('should enforce password length limits', async () => {
      const shortPassword = '12345'; // too short
      let error;

      try {
        await new User({
          nickname: 'testuser',
          email: 'test@example.com',
          password: shortPassword
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.password).toBeDefined();
    });
  });

  describe('Password Hashing', () => {
    it('should hash password before saving', async () => {
      const password = 'testpassword123';
      const user = await new User({
        nickname: 'hashuser',
        email: 'hash@example.com',
        password: password
      }).save();

      // Password should be hashed, not stored in plain text
      expect(user.password).not.toBe(password);
      expect(user.password).toMatch(/^\$2[aby]\$/); // bcrypt hash format
    });

    it('should not rehash password if not modified', async () => {
      const user = await new User({
        nickname: 'norehash',
        email: 'norehash@example.com',
        password: 'original'
      }).save();

      const originalHash = user.password;

      // Update a non-password field
      user.role = 'admin';
      await user.save();

      // Password hash should remain the same
      expect(user.password).toBe(originalHash);
    });
  });

  describe('Password Comparison', () => {
    it('should correctly compare valid password', async () => {
      const password = 'testpassword123';
      const user = await new User({
        nickname: 'compuser',
        email: 'comp@example.com',
        password: password
      }).save();

      const isValid = await user.comparePassword(password);
      expect(isValid).toBe(true);
    });

    it('should reject invalid password', async () => {
      const user = await new User({
        nickname: 'wrongpass',
        email: 'wrong@example.com',
        password: 'correctpass'
      }).save();

      const isValid = await user.comparePassword('wrongpass');
      expect(isValid).toBe(false);
    });
  });

  describe('Unique Constraints', () => {
    it('should enforce unique nicknames', async () => {
      await new User({
        nickname: 'uniqueuser',
        email: 'first@example.com',
        password: 'password123'
      }).save();

      let error;
      try {
        await new User({
          nickname: 'uniqueuser', // duplicate
          email: 'second@example.com',
          password: 'password123'
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      if (error.code === 11000) {
        expect(error.code).toBe(11000); // MongoDB duplicate key error
      }
    });

    it('should enforce unique emails', async () => {
      await new User({
        nickname: 'firstuser',
        email: 'unique@example.com',
        password: 'password123'
      }).save();

      let error;
      try {
        await new User({
          nickname: 'seconduser',
          email: 'unique@example.com', // duplicate
          password: 'password123'
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      if (error.code === 11000) {
        expect(error.code).toBe(11000); // MongoDB duplicate key error
      }
    });
  });

  describe('User Roles', () => {
    it('should default to member role', async () => {
      const user = await new User({
        nickname: 'memberuser',
        email: 'member@example.com',
        password: 'password123'
      }).save();

      expect(user.role).toBe('member');
    });

    it('should allow admin role', async () => {
      const user = await new User({
        nickname: 'adminuser',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin'
      }).save();

      expect(user.role).toBe('admin');
    });

    it('should reject invalid roles', async () => {
      let error;
      try {
        await new User({
          nickname: 'invalidrole',
          email: 'invalid@example.com',
          password: 'password123',
          role: 'invalid'
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.role).toBeDefined();
    });
  });

  describe('User Status', () => {
    it('should default to offline status', async () => {
      const user = await new User({
        nickname: 'offlineuser',
        email: 'offline@example.com',
        password: 'password123'
      }).save();

      expect(user.status).toBe('offline');
    });

    it('should allow online status', async () => {
      const user = await new User({
        nickname: 'onlineuser',
        email: 'online@example.com',
        password: 'password123',
        status: 'online'
      }).save();

      expect(user.status).toBe('online');
    });

    it('should reject invalid status values', async () => {
      let error;
      try {
        await new User({
          nickname: 'invalidstatus',
          email: 'invalid@example.com',
          password: 'password123',
          status: 'away' // invalid status
        }).save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.status).toBeDefined();
    });
  });

  describe('Email Normalization', () => {
    it('should convert email to lowercase', async () => {
      const user = await new User({
        nickname: 'lowercase',
        email: 'USER@EXAMPLE.COM',
        password: 'password123'
      }).save();

      expect(user.email).toBe('user@example.com');
    });

    it('should trim email whitespace', async () => {
      const user = await new User({
        nickname: 'trimemail',
        email: '  user@example.com  ',
        password: 'password123'
      }).save();

      expect(user.email).toBe('user@example.com');
    });
  });

  describe('Extended Field Validation Edge Cases', () => {
    it('should validate empty nickname', async () => {
      const user = new User({
        nickname: '',
        email: 'test@example.com',
        password: 'password123'
      });

      let error;
      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();
    });

    it('should validate whitespace-only nickname', async () => {
      const user = new User({
        nickname: '   ',
        email: 'test2@example.com',
        password: 'password123'
      });

      let error;
      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();
    });

    it('should validate nickname with special characters', async () => {
      const specialNicknames = ['test@user', 'test#user', 'test$user', 'test%user'];

      for (let i = 0; i < specialNicknames.length; i++) {
        const nickname = specialNicknames[i];
        const user = new User({
          nickname: `${nickname}${i}`, // Make unique nickname
          email: `test${nickname.replace(/[^a-zA-Z0-9]/g, '')}${i}@example.com`,
          password: 'password123'
        });

        // Special characters should be accepted unless they violate other rules
        const savedUser = await user.save();
        expect(savedUser.nickname).toBe(`${nickname}${i}`);
      }
    });

    it('should validate extremely long nickname', async () => {
      const longNickname = 'a'.repeat(60); // Beyond 50 char limit
      const user = new User({
        nickname: longNickname,
        email: 'longnick@example.com',
        password: 'password123'
      });

      let error;
      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.nickname).toBeDefined();
    });

    it('should validate password with exactly 5 characters', async () => {
      const shortPassword = '12345'; // Exactly at boundary but below min
      const user = new User({
        nickname: 'boundarypass',
        email: 'boundary@example.com',
        password: shortPassword
      });

      let error;
      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.password).toBeDefined();
    });

    it('should validate email with special characters', async () => {
      const specialEmails = [
        'test+tag@example.com',
        'test.email@sub.domain.com',
        'user_name@example.com',
        '123@numbers.com'
      ];

      for (const email of specialEmails) {
        const user = new User({
          nickname: email.split('@')[0] + 'user',
          email: email,
          password: 'password123'
        });

        const savedUser = await user.save();
        expect(savedUser.email).toBe(email.toLowerCase());
      }
    });

    it('should validate empty email', async () => {
      const user = new User({
        nickname: 'emptyemail',
        email: '',
        password: 'password123'
      });

      let error;
      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.email).toBeDefined();
    });

    it('should validate email with only whitespace', async () => {
      const user = new User({
        nickname: 'wsemail',
        email: '   ',
        password: 'password123'
      });

      let error;
      try {
        await user.save();
      } catch (err) {
        error = err;
      }

      expect(error).toBeDefined();
      expect(error.errors.email).toBeDefined();
    });

    it('should validate inconsistent role transitions', async () => {
      // First create admin user
      const adminUser = await new User({
        nickname: 'adminrole',
        email: 'admin@example.com',
        password: 'password123',
        role: 'admin'
      }).save();

      expect(adminUser.role).toBe('admin');

      // Test changing admin to member
      adminUser.role = 'member';
      await adminUser.save();
      expect(adminUser.role).toBe('member');

      // Test changing member back to admin
      adminUser.role = 'admin';
      await adminUser.save();
      expect(adminUser.role).toBe('admin');
    });

    it('should validate status transitions', async () => {
      const user = await new User({
        nickname: 'statustransition',
        email: 'transition@example.com',
        password: 'password123'
      }).save();

      expect(user.status).toBe('offline');

      // Test online status
      user.status = 'online';
      await user.save();
      expect(user.status).toBe('online');

      // Test back to offline
      user.status = 'offline';
      await user.save();
      expect(user.status).toBe('offline');
    });

    it('should validate password with special characters', async () => {
      const specialPasswords = [
        'password@123',
        'password#123',
        'password$123',
        'password%123',
        'password&123',
        'password*123'
      ];

      for (let i = 0; i < specialPasswords.length; i++) {
        const user = await new User({
          nickname: `specialpass${i}`,
          email: `specialpass${i}@example.com`,
          password: specialPasswords[i]
        }).save();

        const isValid = await user.comparePassword(specialPasswords[i]);
        expect(isValid).toBe(true);
      }
    });

    it('should validate role-specific functionality', async () => {
      // Test admin role creation
      const adminUser = await new User({
        nickname: 'adminfunc',
        email: 'adminfunc@example.com',
        password: 'password123',
        role: 'admin'
      }).save();

      expect(adminUser.role).toBe('admin');

      // Test member role creation
      const memberUser = await new User({
        nickname: 'memberfunc',
        email: 'memberfunc@example.com',
        password: 'password123'
      }).save();

      expect(memberUser.role).toBe('member');
    });

    it('should handle null values correctly', async () => {
      const user = new User({
        nickname: 'nulltest',
        email: 'nulltest@example.com',
        password: 'password123',
        role: null, // Should use default
        status: null // Should use default
      });

      const savedUser = await user.save();
      // MongoDB/Mongoose may not apply defaults if explicit null is set
      // So we check that the save succeeded and fields are not null
      expect(savedUser.role).toBeDefined();
      expect(savedUser.status).toBeDefined();
      expect(savedUser.role).not.toBeNull();
      expect(savedUser.status).not.toBeNull();
    });

    it('should validate maximum field lengths across all fields', async () => {
      const maxNickname = 'a'.repeat(50); // At limit
      const user = await new User({
        nickname: maxNickname,
        email: 'maxlength@example.com',
        password: 'password123'
      }).save();

      expect(user.nickname).toBe(maxNickname);
      expect(user.nickname.length).toBe(50);
    });
  });

  describe('Password Reset Token', () => {
    it('should generate reset password token', async () => {
      const user = await new User({
        nickname: 'resettoken',
        email: 'reset@example.com',
        password: 'password123'
      }).save();

      const token = user.generateResetToken();

      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBe(64); // hex representation of 32 bytes
      expect(user.resetPasswordToken).toBeDefined();
      expect(user.resetPasswordExpires).toBeDefined();
      expect(user.resetPasswordExpires.getTime()).toBeGreaterThan(Date.now());
    });

    it('should expire reset token after 1 hour', async () => {
      const user = await new User({
        nickname: 'expiretoken',
        email: 'expire@example.com',
        password: 'password123'
      }).save();

      const resetToken = user.generateResetToken();
      await user.save();

      // Manually set expiry to past (but keep the hashed token)
      const hashedToken = user.resetPasswordToken;
      user.resetPasswordExpires = new Date(Date.now() - 1000);
      await user.save();

      expect(() => {
        user.resetPassword(resetToken, 'newpassword');
      }).toThrow('Password reset token has expired');
    });

    it('should reject invalid reset token', async () => {
      const user = await new User({
        nickname: 'invalidtoken',
        email: 'invalidtoken@example.com',
        password: 'password123'
      }).save();

      user.generateResetToken();
      await user.save();

      expect(() => {
        user.resetPassword('invalidtoken123', 'newpassword');
      }).toThrow('Invalid or expired password reset token');
    });

    it('should successfully reset password with valid token', async () => {
      const user = await new User({
        nickname: 'validreset',
        email: 'validreset@example.com',
        password: 'password123'
      }).save();

      const resetToken = user.generateResetToken();
      await user.save();

      const newPassword = 'newsecurepassword';
      await user.resetPassword(resetToken, newPassword);

      // Verify new password works
      const isNewPasswordValid = await user.comparePassword(newPassword);
      expect(isNewPasswordValid).toBe(true);

      // Verify token is cleared
      expect(user.resetPasswordToken).toBeNull();
      expect(user.resetPasswordExpires).toBeNull();
    });
  });

  describe('JSON Serialization', () => {
    it('should exclude password from JSON output', async () => {
      const user = await new User({
        nickname: 'jsonuser',
        email: 'json@example.com',
        password: 'password123'
      }).save();

      const userJSON = user.toJSON();

      expect('password' in userJSON).toBe(false);
      expect(userJSON.nickname).toBeDefined();
      expect(userJSON.email).toBeDefined();
      expect(userJSON.role).toBeDefined();
    });

    it('should include all non-sensitive fields in JSON', async () => {
      const user = await new User({
        nickname: 'completeuser',
        email: 'complete@example.com',
        password: 'password123',
        role: 'admin'
      }).save();

      const userJSON = user.toJSON();

      expect(userJSON.nickname).toBe('completeuser');
      expect(userJSON.email).toBe('complete@example.com');
      expect(userJSON.role).toBe('admin');
      expect(userJSON.status).toBe('offline');
      expect(userJSON.createdAt).toBeDefined();
      expect(userJSON.lastActive).toBeDefined();
    });
  });

  describe('Timestamps', () => {
    it('should set createdAt timestamp', async () => {
      const beforeCreate = new Date();
      const user = await new User({
        nickname: 'timestampuser',
        email: 'timestamp@example.com',
        password: 'password123'
      }).save();
      const afterCreate = new Date();

      expect(user.createdAt).toBeDefined();
      expect(user.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime());
      expect(user.createdAt.getTime()).toBeLessThanOrEqual(afterCreate.getTime());
    });

    it('should set lastActive timestamp', async () => {
      const user = await new User({
        nickname: 'activetimestamp',
        email: 'active@example.com',
        password: 'password123'
      }).save();

      expect(user.lastActive).toBeDefined();
      expect(user.lastActive.getTime()).toBeGreaterThanOrEqual(user.createdAt.getTime());
    });
  });
});