import { Resend } from 'resend';
import { env } from './env';
import logger from './logger';

const resend = new Resend(env.RESEND_API_KEY);

const FROM_EMAIL = env.EMAIL_FROM ?? 'noreply@yourdomain.com';

interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
}

async function sendEmail({ to, subject, html }: SendEmailOptions): Promise<boolean> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      logger.error('Email send error', { error, to, subject });
      return false;
    }

    logger.info('Email sent successfully', { to, subject, emailId: data?.id });
    return true;
  } catch (error) {
    logger.error('Email send exception', { error, to, subject });
    return false;
  }
}

export async function sendVerificationEmail(email: string, url: string, token: string): Promise<boolean> {
  const subject = 'Verify your email address';
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #6366f1;">Verify Your Email Address</h2>
          <p>Thank you for signing up! Please click the button below to verify your email address:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${url}" 
               style="background-color: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Verify Email
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${url}" style="color: #6366f1;">${url}</a>
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            If you didn't create an account, you can safely ignore this email.
          </p>
        </div>
      </body>
    </html>
  `;

  return sendEmail({ to: email, subject, html });
}

export async function sendPasswordResetEmail(email: string, url: string, token: string): Promise<boolean> {
  const subject = 'Reset your password';
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #6366f1;">Reset Your Password</h2>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${url}" 
               style="background-color: #6366f1; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #666; font-size: 14px;">
            If the button doesn't work, copy and paste this link into your browser:<br>
            <a href="${url}" style="color: #6366f1;">${url}</a>
          </p>
          <p style="color: #999; font-size: 12px; margin-top: 30px;">
            This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
          </p>
        </div>
      </body>
    </html>
  `;

  return sendEmail({ to: email, subject, html });
}

export async function sendWorkflowEmail(to: string, subject: string, body: string): Promise<boolean> {
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
          ${body}
        </div>
      </body>
    </html>
  `;

  return sendEmail({ to, subject, html });
}
