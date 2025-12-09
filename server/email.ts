import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { storage } from './storage';

let transporter: nodemailer.Transporter | null = null;

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
}

export interface EmailConfig {
  senderName?: string;
  replyTo?: string;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

// Check if email is configured
export async function isEmailAvailable(): Promise<boolean> {
  try {
    const config = await getSmtpConfig();
    return !!(config.host && config.username && config.password && config.fromEmail);
  } catch {
    return false;
  }
}

// Get SMTP configuration from database or environment
export async function getSmtpConfig(): Promise<SmtpConfig> {
  // Try to get from database first (allows runtime configuration)
  const host = await storage.getSystemConfig('smtp_host') || process.env.SMTP_HOST || '';
  const port = parseInt(await storage.getSystemConfig('smtp_port') || process.env.SMTP_PORT || '587', 10);
  const secure = (await storage.getSystemConfig('smtp_secure') || process.env.SMTP_SECURE || 'false') === 'true';
  const username = await storage.getSystemConfig('smtp_username') || process.env.SMTP_USERNAME || '';
  const password = await storage.getSystemConfig('smtp_password') || process.env.SMTP_PASSWORD || '';
  const fromEmail = await storage.getSystemConfig('smtp_from_email') || process.env.SMTP_FROM_EMAIL || '';
  const fromName = await storage.getSystemConfig('smtp_from_name') || process.env.SMTP_FROM_NAME || 'Deal or No Deal';
  
  return { host, port, secure, username, password, fromEmail, fromName };
}

// Create or get the email transporter
async function getTransporter(): Promise<nodemailer.Transporter> {
  const config = await getSmtpConfig();
  
  if (!config.host || !config.username || !config.password) {
    throw new Error('Email not configured. Please configure SMTP settings in Settings page.');
  }
  
  // Always create fresh transporter to pick up config changes
  transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: false, // Allow self-signed certificates for internal servers
    },
  });
  
  return transporter;
}

// Generate a unique Message-ID for email tracking
function generateMessageId(domain: string): string {
  const uniqueId = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `<${uniqueId}.${timestamp}@${domain}>`;
}

// Extract domain from email address
function extractDomain(email: string): string {
  const match = email.match(/@([^>]+)/);
  return match ? match[1] : 'mail.local';
}

// Get the configured sender email address
export async function getSenderEmail(): Promise<string> {
  const config = await getSmtpConfig();
  return config.fromEmail || 'noreply@example.com';
}

// Send a simple email
export async function sendEmail(
  to: string, 
  subject: string, 
  body: string, 
  htmlBody?: string,
  config?: EmailConfig
): Promise<boolean> {
  try {
    const transport = await getTransporter();
    const smtpConfig = await getSmtpConfig();
    const senderName = config?.senderName || smtpConfig.fromName || 'Deal or No Deal';
    const replyTo = config?.replyTo || smtpConfig.fromEmail;
    const domain = extractDomain(smtpConfig.fromEmail);
    const messageId = generateMessageId(domain);
    
    await transport.sendMail({
      from: `${senderName} <${smtpConfig.fromEmail}>`,
      to,
      replyTo,
      subject,
      text: body,
      html: htmlBody || body,
      messageId,
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Deal-or-No-Deal-Booking-System',
      },
    });

    console.log(`📧 Email sent successfully to ${to} (from: ${senderName} <${smtpConfig.fromEmail}>)`);
    return true;
  } catch (error: any) {
    console.error(`Error sending email to ${to}:`, error);
    throw error;
  }
}

// Send email with attachments
export async function sendEmailWithAttachment(
  to: string, 
  subject: string, 
  htmlBody: string,
  attachments: EmailAttachment[] = [],
  config?: EmailConfig
): Promise<boolean> {
  try {
    const transport = await getTransporter();
    const smtpConfig = await getSmtpConfig();
    const senderName = config?.senderName || smtpConfig.fromName || 'Deal or No Deal';
    const replyTo = config?.replyTo || smtpConfig.fromEmail;
    const domain = extractDomain(smtpConfig.fromEmail);
    const messageId = generateMessageId(domain);
    
    // Convert attachments to nodemailer format
    const nodemailerAttachments = attachments.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
    }));

    await transport.sendMail({
      from: `${senderName} <${smtpConfig.fromEmail}>`,
      to,
      replyTo,
      subject,
      html: htmlBody,
      messageId,
      attachments: nodemailerAttachments,
      headers: {
        'X-Priority': '3',
        'X-Mailer': 'Deal-or-No-Deal-Booking-System',
      },
    });

    console.log(`📧 Email with ${attachments.length} attachment(s) sent successfully to ${to} (from: ${senderName} <${smtpConfig.fromEmail}>)`);
    return true;
  } catch (error: any) {
    console.error(`Error sending email with attachment to ${to}:`, error);
    throw error;
  }
}

// Test SMTP connection
export async function testSmtpConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const transport = await getTransporter();
    await transport.verify();
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}
