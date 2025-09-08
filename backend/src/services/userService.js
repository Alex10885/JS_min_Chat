const User = require('../models/User');
const { logger } = require('../middleware/auth');
const { cacheUser, getCachedUser, invalidateUserCache, cacheUserActivity } = require('./cacheService');

class UserService {
  constructor() {
    this.logger = logger;
  }

  async getAllUsers() {
    try {
      const users = await User.find({})
        .select('_id nickname role status createdAt lastActive')
        .sort({ nickname: 1 });

      return users;
    } catch (error) {
      this.logger.error('Error fetching users:', error);
      throw error;
    }
  }

  async getUserById(userId) {
    try {
      // Try to get from cache first
      const cachedUser = await getCachedUser(userId);
      if (cachedUser) {
        this.logger.debug('User data retrieved from cache');
        return cachedUser;
      }

      // Not in cache, fetch from database
      const user = await User.findById(userId);
      if (user) {
        // Cache the user data (without sensitive fields)
        const cacheableUser = {
          _id: user._id,
          nickname: user.nickname,
          role: user.role,
          status: user.status,
          createdAt: user.createdAt,
          lastActive: user.lastActive,
          isMuted: user.isMuted,
          muteExpires: user.muteExpires,
          channels: user.channels || []
        };

        // Cache user data asynchronously (don't block response)
        cacheUser(userId, cacheableUser).catch(error => {
          this.logger.error('Error caching user data:', error);
        });
      }

      return user;
    } catch (error) {
      this.logger.error('Error fetching user by ID:', error);
      throw error;
    }
  }

  async getUserByNickname(nickname) {
    try {
      const user = await User.findOne({ nickname });
      return user;
    } catch (error) {
      this.logger.error('Error fetching user by nickname:', error);
      throw error;
    }
  }

  async updateUserStatus(userId, status) {
    try {
      const user = await User.findByIdAndUpdate(
        userId,
        {
          status,
          lastActive: new Date()
        },
        { new: true }
      );

      if (user) {
        // Invalidate cache to ensure fresh data
        invalidateUserCache(userId).catch(error => {
          this.logger.error('Error invalidating user cache:', error);
        });

        // Cache activity data
        const activityData = {
          lastActive: user.lastActive,
          status: user.status,
          timestamp: Date.now()
        };
        cacheUserActivity(userId, activityData).catch(error => {
          this.logger.error('Error caching user activity:', error);
        });
      }

      return user;
    } catch (error) {
      this.logger.error('Error updating user status:', error);
      throw error;
    }
  }

  async banUser(adminUserId, targetUserId, reason, duration) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      await targetUser.ban(reason, duration, adminUserId);

      this.logger.info(`User ${targetUser.nickname} banned by admin ${adminUserId}`, {
        adminId: adminUserId,
        bannedUserId: targetUserId,
        reason,
        duration
      });

      return targetUser;
    } catch (error) {
      this.logger.error('Error banning user:', error);
      throw error;
    }
  }

  async unbanUser(targetUserId) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      await targetUser.unban();
      this.logger.info(`User ${targetUser.nickname} unbanned`);

      return targetUser;
    } catch (error) {
      this.logger.error('Error unbanning user:', error);
      throw error;
    }
  }

  async warnUser(adminUserId, targetUserId, reason, duration) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      await targetUser.warn(reason, adminUserId, duration);
      await targetUser.save();

      this.logger.info(`Warning issued to user ${targetUser.nickname} by admin ${adminUserId}`, {
        adminId: adminUserId,
        warnedUserId: targetUserId,
        reason,
        duration
      });

      return targetUser;
    } catch (error) {
      this.logger.error('Error warning user:', error);
      throw error;
    }
  }

  async changeUserRole(adminUserId, targetUserId, newRole) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      const oldRole = targetUser.role;
      targetUser.role = newRole;
      await targetUser.save();

      this.logger.info(`User ${targetUser.nickname} role changed from ${oldRole} to ${newRole} by admin ${adminUserId}`, {
        adminId: adminUserId,
        targetUserId,
        oldRole,
        newRole
      });

      return targetUser;
    } catch (error) {
      this.logger.error('Error changing user role:', error);
      throw error;
    }
  }

  async muteUser(adminUserId, targetUserId, duration) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      await targetUser.mute(duration);

      this.logger.info(`User ${targetUser.nickname} muted by admin ${adminUserId}`, {
        mutedBy: adminUserId,
        mutedUser: targetUser._id,
        duration
      });

      return targetUser;
    } catch (error) {
      this.logger.error('Error muting user:', error);
      throw error;
    }
  }

  async unmuteUser(adminUserId, targetUserId) {
    try {
      const targetUser = await User.findById(targetUserId);
      if (!targetUser) {
        throw new Error('User not found');
      }

      await targetUser.unmute();

      this.logger.info(`User ${targetUser.nickname} unmuted by admin ${adminUserId}`, {
        unmutedBy: adminUserId,
        unmutedUser: targetUser._id
      });

      return targetUser;
    } catch (error) {
      this.logger.error('Error unmuting user:', error);
      throw error;
    }
  }

  async getUsersForAdmin(page = 1, limit = 50) {
    try {
      const skip = (page - 1) * limit;

      const users = await User.find({})
        .select('-password -resetPasswordToken -resetPasswordExpires -moderationToken -moderationTokenExpires')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      const total = await User.countDocuments();

      return {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      this.logger.error('Error fetching users for admin:', error);
      throw error;
    }
  }
}

module.exports = new UserService();