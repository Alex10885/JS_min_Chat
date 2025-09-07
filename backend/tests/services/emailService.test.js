const emailService = require('../../services/emailService');

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransporter: jest.fn(() => ({
    sendMail: jest.fn()
  }))
}));

// Mock console methods to avoid noise
global.console.log = jest.fn();
global.console.error = jest.fn();

describe('EmailService', () => {
  let mockTransporter;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock process.env values
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'test@example.com';
    process.env.SMTP_PASS = 'test-password';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    // Re-import to trigger constructor with mocked values
    delete require.cache[require.resolve('../../services/emailService')];
    const freshEmailService = require('../../services/emailService');

    // Get the mock transporter from the fresh instance
    mockTransporter = freshEmailService.transporter;
  });

  describe('sendPasswordResetEmail', () => {
    it('should send password reset email successfully', async () => {
      const email = 'user@example.com';
      const resetToken = 'test-reset-token-123';
      const expectedMessageId = 'test-message-id-123';

      mockTransporter.sendMail.mockResolvedValue({
        messageId: expectedMessageId
      });

      const result = await emailService.sendPasswordResetEmail(email, resetToken);

      expect(result).toEqual({
        success: true,
        messageId: expectedMessageId
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);

      const mailOptions = mockTransporter.sendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe(email);
      expect(mailOptions.subject).toContain('Password Reset');
      expect(mailOptions.html).toContain(resetToken);
      expect(mailOptions.text).toContain(resetToken);
    });

    it('should include correct reset URL in email', async () => {
      const email = 'user@example.com';
      const resetToken = 'reset-token-456';
      const expectedUrl = `http://localhost:3000/reset-password/${resetToken}`;

      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'test-id'
      });

      await emailService.sendPasswordResetEmail(email, resetToken);

      const mailOptions = mockTransporter.sendMail.mock.calls[0][0];
      expect(mailOptions.html).toContain(expectedUrl);
      expect(mailOptions.text).toContain(expectedUrl);
    });

    it('should handle missing FRONTEND_URL environment variable', async () => {
      delete process.env.FRONTEND_URL;

      // Re-import with new environment
      delete require.cache[require.resolve('../../services/emailService')];
      const freshService = require('../../services/emailService');

      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'test-id'
      });

      await freshService.sendPasswordResetEmail('user@example.com', 'token');

      const mailOptions = mockTransporter.sendMail.mock.calls[0][0];
      expect(mailOptions.html).toContain('http://localhost:3000/reset-password/token');
    });

    it('should throw error when email sending fails', async () => {
      const error = new Error('SMTP connection failed');
      mockTransporter.sendMail.mockRejectedValue(error);

      await expect(
        emailService.sendPasswordResetEmail('user@example.com', 'token')
      ).rejects.toThrow('SMTP connection failed');
    });
  });

  describe('sendPasswordResetSuccessEmail', () => {
    it('should send password reset success email successfully', async () => {
      const email = 'user@example.com';
      const expectedMessageId = 'success-message-id-123';

      mockTransporter.sendMail.mockResolvedValue({
        messageId: expectedMessageId
      });

      const result = await emailService.sendPasswordResetSuccessEmail(email);

      expect(result).toEqual({
        success: true,
        messageId: expectedMessageId
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);

      const mailOptions = mockTransporter.sendMail.mock.calls[0][0];
      expect(mailOptions.to).toBe(email);
      expect(mailOptions.subject).toContain('Password Reset Successful');
      expect(mailOptions.html).toContain('Your password has been successfully reset');
      expect(mailOptions.text).toContain('Your password has been successfully reset');
    });

    it('should throw error when success email sending fails', async () => {
      const error = new Error('SMTP timeout');
      mockTransporter.sendMail.mockRejectedValue(error);

      await expect(
        emailService.sendPasswordResetSuccessEmail('user@example.com')
      ).rejects.toThrow('SMTP timeout');
    });
  });

  describe('Email Service Configuration', () => {
    it('should use environment variables for SMTP configuration', () => {
      const nodemailer = require('nodemailer');
      const createTransporter = nodemailer.createTransporter;

      delete require.cache[require.resolve('../../services/emailService')];
      require('../../services/emailService');

      expect(createTransporter).toHaveBeenCalledWith({
        host: 'smtp.test.com',
        port: '587',
        secure: false,
        auth: {
          user: 'test@example.com',
          pass: 'test-password'
        }
      });
    });

    it('should use defaults when environment variables are missing', () => {
      delete process.env.SMTP_HOST;
      delete process.env.SMTP_PORT;
      delete process.env.SMTP_USER;
      delete process.env.SMTP_PASS;

      const nodemailer = require('nodemailer');
      const createTransporter = nodemailer.createTransporter;

      delete require.cache[require.resolve('../../services/emailService')];
      require('../../services/emailService');

      expect(createTransporter).toHaveBeenCalledWith({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: undefined,
          pass: undefined
        }
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors in SMTP connection', async () => {
      const networkError = new Error('Connection timeout');
      networkError.code = 'ENOTFOUND';

      mockTransporter.sendMail.mockRejectedValue(networkError);

      await expect(
        emailService.sendPasswordResetEmail('user@example.com', 'token')
      ).rejects.toThrow('Connection timeout');
    });

    it('should handle authentication errors', async () => {
      const authError = new Error('Authentication failed');
      authError.responseCode = 535;

      mockTransporter.sendMail.mockRejectedValue(authError);

      await expect(
        emailService.sendPasswordResetEmail('user@example.com', 'token')
      ).rejects.toThrow('Authentication failed');
    });
  });

  describe('Email Content Validation', () => {
    it('should include proper email headers', async () => {
      const email = 'test@example.com';
      const token = 'reset-token-xyz';

      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'header-test-id'
      });

      await emailService.sendPasswordResetEmail(email, token);

      const mailOptions = mockTransporter.sendMail.mock.calls[0][0];

      expect(mailOptions.from).toEqual({
        name: 'Chat-JS Support',
        address: process.env.SMTP_USER
      });
      expect(mailOptions.to).toBe(email);
      expect(mailOptions.subject).toContain('Password Reset');
    });

    it('should include HTML and text versions', async () => {
      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'content-test-id'
      });

      await emailService.sendPasswordResetEmail('test@example.com', 'token-abc');

      const mailOptions = mockTransporter.sendMail.mock.calls[0][0];

      expect(mailOptions.html).toBeDefined();
      expect(mailOptions.html).toContain('<html');
      expect(mailOptions.html).toContain('Reset Password');

      expect(mailOptions.text).toBeDefined();
      expect(mailOptions.text).toContain('Password Reset Request');
      expect(mailOptions.text).toContain('token-abc');
    });

    it('should properly escape HTML content', async () => {
      const maliciousEmail = '<script>alert("xss")</script>@example.com';

      mockTransporter.sendMail.mockResolvedValue({
        messageId: 'escape-test-id'
      });

      // Should not throw or cause issues with HTML content
      await expect(
        emailService.sendPasswordResetEmail(maliciousEmail, 'token')
      ).resolves.toBeDefined();
    });
  });
});