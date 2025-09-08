const userService = require('../services/userService');
const { logger } = require('../middleware/auth');

class UserController {
  constructor() {
    this.logger = logger;
  }

  async getAllUsers(req, res) {
    try {
      const users = await userService.getAllUsers();

      logger.info(`Users list requested by ${req.user.nickname}`, {
        userId: req.user._id,
        totalUsers: users.length
      });

      console.log('📤 Returning users data:', users.length);
      res.json(users);
    } catch (error) {
      this.logger.error('Error fetching users:', error);
      console.error('❌ Error in GET /api/users:', error.message);
      res.status(500).json({ error: 'Failed to fetch users', code: 'DATABASE_ERROR' });
    }
  }

  async getUsersPaginated(req, res) {
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 50;

      const result = await userService.getUsersForAdmin(page, limit);

      logger.info(`Admin user list requested by ${req.user.nickname}`, {
        adminId: req.user._id,
        page,
        limit,
        total: result.pagination.total
      });

      res.json(result);
    } catch (error) {
      this.logger.error('Error fetching users for admin:', error);
      res.status(500).json({ error: 'Failed to fetch users', code: 'DATABASE_ERROR' });
    }
  }

  async banUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason, duration } = req.body;

      const targetUser = await userService.banUser(req.user._id, userId, reason, duration);

      logger.info(`User ${targetUser.nickname} banned by ${req.user.nickname}`, {
        bannedUserId: userId,
        bannedById: req.user._id,
        reason,
        duration
      });

      res.json({
        message: `User ${targetUser.nickname} has been banned`,
        user: {
          id: targetUser._id,
          nickname: targetUser.nickname,
          banned: true,
          banReason: reason,
          banExpires: targetUser.banExpires
        }
      });
    } catch (error) {
      this.logger.error('Error banning user:', error);
      if (error.message === 'User not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to ban user' });
      }
    }
  }

  async unbanUser(req, res) {
    try {
      const { userId } = req.params;

      const targetUser = await userService.unbanUser(userId);

      logger.info(`User ${targetUser.nickname} unbanned by ${req.user.nickname}`, {
        unbannedUserId: userId,
        unbannedById: req.user._id
      });

      res.json({
        message: `User ${targetUser.nickname} has been unbanned`,
        user: {
          id: targetUser._id,
          nickname: targetUser.nickname,
          banned: false
        }
      });
    } catch (error) {
      this.logger.error('Error unbanning user:', error);
      res.status(500).json({ error: 'Failed to unban user' });
    }
  }

  async warnUser(req, res) {
    try {
      const { userId } = req.params;
      const { reason, duration } = req.body;

      const targetUser = await userService.warnUser(req.user._id, userId, reason, duration);
      await targetUser.save();

      logger.info(`Warning issued to user ${targetUser.nickname} by ${req.user.nickname}`, {
        warnedUserId: userId,
        warnedById: req.user._id,
        reason,
        duration
      });

      res.json({
        message: `Warning issued to user ${targetUser.nickname}`,
        warning: {
          reason,
          issuedBy: req.user.nickname,
          issuedAt: new Date(),
          expires: duration ? new Date(Date.now() + duration) : null
        },
        user: {
          id: targetUser._id,
          nickname: targetUser.nickname,
          warningsCount: targetUser.getActiveWarningsCount()
        }
      });
    } catch (error) {
      this.logger.error('Error warning user:', error);
      if (error.message === 'User not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to warn user' });
      }
    }
  }

  async changeUserRole(req, res) {
    try {
      const { userId } = req.params;
      const { role: newRole } = req.body;

      if (req.user._id.toString() === userId) {
        return res.status(400).json({ error: 'Cannot modify your own role' });
      }

      if ((newRole === 'admin' || req.user.role !== 'admin') && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Only administrators can manage admin roles' });
      }

      const targetUser = await userService.changeUserRole(req.user._id, userId, newRole);

      logger.info(`User ${targetUser.nickname} role changed to ${newRole} by ${req.user.nickname}`, {
        changedUserId: userId,
        changedById: req.user._id,
        oldRole: targetUser.role,
        newRole
      });

      res.json({
        message: `User ${targetUser.nickname} role changed to ${newRole}`,
        user: {
          id: targetUser._id,
          nickname: targetUser.nickname,
          role: newRole
        }
      });
    } catch (error) {
      this.logger.error('Error changing user role:', error);
      if (error.message === 'User not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to change user role' });
      }
    }
  }

  async muteUser(req, res) {
    try {
      const { userId } = req.params;
      const { duration } = req.body;

      const targetUser = await userService.muteUser(req.user._id, userId, duration);

      logger.info(`User ${targetUser.nickname} muted by ${req.user.nickname}`, {
        mutedUserId: userId,
        mutedById: req.user._id,
        duration
      });

      res.json({
        message: `User ${targetUser.nickname} has been muted`,
        user: {
          id: targetUser._id,
          nickname: targetUser.nickname,
          muteExpires: targetUser.muteExpires
        }
      });
    } catch (error) {
      this.logger.error('Error muting user:', error);
      if (error.message === 'User not found') {
        res.status(404).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Failed to mute user' });
      }
    }
  }

  async unmuteUser(req, res) {
    try {
      const { userId } = req.params;
      const targetUser = await userService.unmuteUser(req.user._id, userId);

      logger.info(`User ${targetUser.nickname} unmuted by ${req.user.nickname}`, {
        unmutedUserId: userId,
        unmutedById: req.user._id
      });

      res.json({
        message: `User ${targetUser.nickname} has been unmuted`,
        user: {
          id: targetUser._id,
          nickname: targetUser.nickname,
          muteExpires: null
        }
      });
    } catch (error) {
      this.logger.error('Error unmuting user:', error);
      res.status(500).json({ error: 'Failed to unmute user' });
    }
  }
}

module.exports = new UserController();