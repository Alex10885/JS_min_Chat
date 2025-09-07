const jwt = require('jsonwebtoken');
const { authenticateToken } = require('../../server');

// Mock models
jest.mock('../../models/User', () => ({
  findById: jest.fn()
}));

const User = require('../../models/User');

describe('Authentication Middleware', () => {
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    mockReq = {
      headers: {}
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    it('should authenticate user with valid token', async () => {
      const userId = '507f1f77bcf86cd799439011';
      const token = jwt.sign({ id: userId }, process.env.JWT_SECRET || 'test-secret');
      const mockUser = {
        _id: userId,
        nickname: 'testuser',
        role: 'member'
      };

      mockReq.headers.authorization = `Bearer ${token}`;
      User.findById.mockResolvedValue(mockUser);

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toEqual(mockUser);
      expect(User.findById).toHaveBeenCalledWith(userId);
    });

    it('should return 401 when no token is provided', async () => {
      delete mockReq.headers.authorization;

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    });

    it('should return 401 with malformed authorization header', async () => {
      mockReq.headers.authorization = 'InvalidTokenFormat';

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Access token required',
        code: 'NO_TOKEN'
      });
    });

    it('should handle JWT verification errors', async () => {
      const invalidToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid';
      mockReq.headers.authorization = `Bearer ${invalidToken}`;

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Token verification failed',
        code: 'TOKEN_VERIFICATION_FAILED'
      });
    });

    it('should handle expired tokens', async () => {
      const expiredToken = jwt.sign({ id: 'testId' }, 'test-secret', { expiresIn: '-1h' });
      mockReq.headers.authorization = `Bearer ${expiredToken}`;

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Token has expired',
        code: 'TOKEN_EXPIRED'
      });
    });

    it('should handle malformed JWT tokens', async () => {
      mockReq.headers.authorization = 'Bearer not-a-jwt-token';

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Invalid token format',
        code: 'INVALID_TOKEN_FORMAT'
      });
    });

    it('should return 401 when user is not found', async () => {
      const token = jwt.sign({ id: 'nonexistent' }, process.env.JWT_SECRET || 'test-secret');
      mockReq.headers.authorization = `Bearer ${token}`;

      User.findById.mockResolvedValue(null);

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    });

    it('should handle database errors during user lookup', async () => {
      const token = jwt.sign({ id: 'testid' }, process.env.JWT_SECRET || 'test-secret');
      mockReq.headers.authorization = `Bearer ${token}`;

      const dbError = new Error('Database connection failed');
      User.findById.mockRejectedValue(dbError);

      // Override console methods to avoid spam
      const originalConsole = global.console;
      global.console = {
        warn: jest.fn(),
        error: jest.fn()
      };

      await authenticateToken(mockReq, mockRes, mockNext);

      // Restore console
      global.console = originalConsole;

      expect(mockNext).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Token verification failed',
        code: 'TOKEN_VERIFICATION_FAILED'
      });
    });
  });

  describe('Token extraction', () => {
    it('should extract token from Bearer authorization header', async () => {
      const token = jwt.sign({ id: 'testId' }, process.env.JWT_SECRET || 'test-secret');
      const authorization = `Bearer ${token}`;
      const mockUser = { _id: 'testId', nickname: 'testuser' };

      mockReq.headers.authorization = authorization;
      User.findById.mockResolvedValue(mockUser);

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(User.findById).toHaveBeenCalledWith('testId');
    });

    it('should handle extra whitespace in authorization header', async () => {
      const token = jwt.sign({ id: 'whitespacetest' }, process.env.JWT_SECRET || 'test-secret');
      mockReq.headers.authorization = `  Bearer    ${token}   `;
      const mockUser = { _id: 'whitespacetest', nickname: 'testuser' };

      User.findById.mockResolvedValue(mockUser);

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(User.findById).toHaveBeenCalledWith('whitespacetest');
    });
  });

  describe('Request properties', () => {
    it('should attach user to request object', async () => {
      const token = jwt.sign({ id: 'attachTest' }, process.env.JWT_SECRET || 'test-secret');
      mockReq.headers.authorization = `Bearer ${token}`;
      const mockUser = { _id: 'attachTest', nickname: 'attachUser', role: 'admin' };

      User.findById.mockResolvedValue(mockUser);

      await authenticateToken(mockReq, mockRes, mockNext);

      expect(mockReq.user).toEqual(mockUser);
      expect(mockReq.user._id).toBe('attachTest');
      expect(mockReq.user.nickname).toBe('attachUser');
      expect(mockReq.user.role).toBe('admin');
    });
  });
});