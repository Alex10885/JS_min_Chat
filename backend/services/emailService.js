const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransporter({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }

  async sendPasswordResetEmail(email, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password/${resetToken}`;

    const mailOptions = {
      from: {
        name: 'Chat-JS Support',
        address: process.env.SMTP_USER
      },
      to: email,
      subject: 'Password Reset Request - Chat-JS',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Password Reset</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
                .content { background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; }
                .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .footer { background: #6c757d; color: white; padding: 20px; border-radius: 0 0 10px 10px; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Password Reset Request</h2>
                </div>
                <div class="content">
                    <p>You have requested to reset your password for your Chat-JS account.</p>
                    <p>Please click the button below to reset your password:</p>

                    <a href="${resetUrl}" class="button">Reset Password</a>

                    <p><strong>This link will expire in 1 hour.</strong></p>

                    <p>If you did not request this password reset, please ignore this email.</p>

                    <p>For security reasons, this link can only be used once.</p>
                </div>
                <div class="footer">
                    <p>If the button doesn't work, copy and paste this URL into your browser:</p>
                    <p>${resetUrl}</p>
                    <p>&copy; 2024 Chat-JS. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
      `,
      text: `
        Password Reset Request - Chat-JS

        You have requested to reset your password.

        Please use the following link to reset your password:
        ${resetUrl}

        This link will expire in 1 hour.

        If you did not request this password reset, please ignore this email.

        Best regards,
        Chat-JS Support Team
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Password reset email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending password reset email:', error);
      throw error;
    }
  }

  async sendPasswordResetSuccessEmail(email) {
    const mailOptions = {
      from: {
        name: 'Chat-JS Support',
        address: process.env.SMTP_USER
      },
      to: email,
      subject: 'Password Reset Successful - Chat-JS',
      html: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Password Reset Successful</title>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 20px; border-radius: 10px 10px 0 0; }
                .content { background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; }
                .footer { background: #6c757d; color: white; padding: 20px; border-radius: 0 0 10px 10px; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h2>Password Reset Successful</h2>
                </div>
                <div class="content">
                    <p>Your password has been successfully reset!</p>
                    <p>You can now sign in to your Chat-JS account with your new password.</p>
                    <p>If you did not make this change, please contact our support team immediately.</p>
                </div>
                <div class="footer">
                    <p>&copy; 2024 Chat-JS. All rights reserved.</p>
                </div>
            </div>
        </body>
        </html>
      `,
      text: `
        Password Reset Successful - Chat-JS

        Your password has been successfully reset!

        You can now sign in to your Chat-JS account with your new password.

        If you did not make this change, please contact our support team immediately.

        Best regards,
        Chat-JS Support Team
      `
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Password reset success email sent:', info.messageId);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Error sending password reset success email:', error);
      throw error;
    }
  }
}

module.exports = new EmailService();