import { google } from 'googleapis';
import crypto from 'crypto';

let connectionSettings: any;
let cachedSenderEmail: string | null = null;

// Check if Gmail integration is available (Replit Connectors or local OAuth)
export function isGmailAvailable(): boolean {
  const hasReplitConnectors = !!(
    process.env.REPLIT_CONNECTORS_HOSTNAME &&
    (process.env.REPL_IDENTITY || process.env.WEB_REPL_RENEWAL)
  );
  // Future: Add check for local OAuth credentials here
  // const hasLocalOAuth = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
  return hasReplitConnectors;
}

// Email configuration interface
export interface EmailConfig {
  senderName?: string;
  replyTo?: string;
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

// Strip HTML tags for plain text version
function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings?.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  const response = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  );
  
  const data = await response.json();
  connectionSettings = data.items?.[0];

  if (!connectionSettings) {
    console.error('Gmail connection not found. Please reconnect Gmail in Replit Integrations.');
    throw new Error('Gmail not connected - please reconnect in Replit Integrations');
  }

  const accessToken = connectionSettings.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!accessToken) {
    console.error('Gmail access token not found in connection settings:', JSON.stringify(connectionSettings, null, 2));
    throw new Error('Gmail access token not available - please reconnect Gmail');
  }
  return accessToken;
}

export async function getUncachableGmailClient() {
  const accessToken = await getAccessToken();

  const oauth2Client = new google.auth.OAuth2();
  oauth2Client.setCredentials({
    access_token: accessToken
  });

  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Get the authenticated sender's email address
export async function getSenderEmail(): Promise<string> {
  if (cachedSenderEmail) {
    return cachedSenderEmail;
  }
  
  try {
    const gmail = await getUncachableGmailClient();
    const profile = await gmail.users.getProfile({ userId: 'me' });
    cachedSenderEmail = profile.data.emailAddress || 'noreply@example.com';
    return cachedSenderEmail;
  } catch (error) {
    console.error('Error getting sender email:', error);
    return 'noreply@example.com';
  }
}

// Wrap base64 content at 76 characters per line (RFC 2045 compliance)
function wrapBase64(base64: string, lineLength: number = 76): string {
  const lines = [];
  for (let i = 0; i < base64.length; i += lineLength) {
    lines.push(base64.substring(i, i + lineLength));
  }
  return lines.join('\r\n');
}

export async function sendEmail(
  to: string, 
  subject: string, 
  body: string, 
  htmlBody?: string,
  config?: EmailConfig
) {
  try {
    const gmail = await getUncachableGmailClient();
    const senderEmail = await getSenderEmail();
    const senderName = config?.senderName || 'Deal or No Deal';
    const replyTo = config?.replyTo || senderEmail;
    const domain = extractDomain(senderEmail);
    const messageId = generateMessageId(domain);
    
    // Create multipart message with both text and HTML
    const boundary = `boundary_${crypto.randomBytes(8).toString('hex')}`;
    const htmlContent = htmlBody || body;
    const textContent = htmlToPlainText(htmlContent);
    
    // Encode content as base64 with proper line wrapping
    const textBase64 = wrapBase64(Buffer.from(textContent, 'utf-8').toString('base64'));
    const htmlBase64 = wrapBase64(Buffer.from(htmlContent, 'utf-8').toString('base64'));
    
    const message = [
      `From: ${senderName} <${senderEmail}>`,
      `To: ${to}`,
      `Reply-To: ${replyTo}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `X-Priority: 3`,
      `X-Mailer: Deal-or-No-Deal-Booking-System`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      textBase64,
      '',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      htmlBase64,
      '',
      `--${boundary}--`
    ].join('\r\n');

    const encodedMessage = Buffer.from(message).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log(`📧 Email sent successfully to ${to} (from: ${senderName} <${senderEmail}>)`);
    return true;
  } catch (error: any) {
    console.error(`Error sending email to ${to}:`, error);
    throw error;
  }
}

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export async function sendEmailWithAttachment(
  to: string, 
  subject: string, 
  htmlBody: string,
  attachments: EmailAttachment[] = [],
  config?: EmailConfig
) {
  try {
    const gmail = await getUncachableGmailClient();
    const senderEmail = await getSenderEmail();
    const senderName = config?.senderName || 'Deal or No Deal';
    const replyTo = config?.replyTo || senderEmail;
    const domain = extractDomain(senderEmail);
    const messageId = generateMessageId(domain);
    
    const boundary = `boundary_${crypto.randomBytes(8).toString('hex')}`;
    const altBoundary = `alt_${crypto.randomBytes(8).toString('hex')}`;
    const textContent = htmlToPlainText(htmlBody);
    
    // Encode content as base64 with proper line wrapping (RFC 2045)
    const textBase64 = wrapBase64(Buffer.from(textContent, 'utf-8').toString('base64'));
    const htmlBase64 = wrapBase64(Buffer.from(htmlBody, 'utf-8').toString('base64'));
    
    let message = [
      `From: ${senderName} <${senderEmail}>`,
      `To: ${to}`,
      `Reply-To: ${replyTo}`,
      `Subject: ${subject}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `X-Priority: 3`,
      `X-Mailer: Deal-or-No-Deal-Booking-System`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      `--${altBoundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      textBase64,
      '',
      `--${altBoundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      htmlBase64,
      '',
      `--${altBoundary}--`,
    ];

    for (const attachment of attachments) {
      // Wrap attachment base64 at 76 characters per line
      const attachmentBase64 = wrapBase64(attachment.content.toString('base64'));
      message = message.concat([
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${attachment.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${attachment.filename}"`,
        '',
        attachmentBase64,
      ]);
    }

    message.push(`--${boundary}--`);

    const rawMessage = message.join('\r\n');
    const encodedMessage = Buffer.from(rawMessage).toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log(`📧 Email with ${attachments.length} attachment(s) sent successfully to ${to} (from: ${senderName} <${senderEmail}>)`);
    return true;
  } catch (error: any) {
    console.error(`Error sending email with attachment to ${to}:`, error);
    throw error;
  }
}

// Type for parsed email message
export interface ParsedEmail {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string;
  body: string;
  date: Date;
  inReplyTo?: string;
}

// Extract email address from "Name <email@domain.com>" format
function extractEmailAddress(headerValue: string): string {
  const match = headerValue.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : headerValue.toLowerCase().trim();
}

// Get the plain text body from a message
function getPlainTextBody(payload: any): string {
  if (!payload) return '';
  
  // Direct body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }
  
  // Multipart - search for text/plain
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return Buffer.from(part.body.data, 'base64').toString('utf-8');
      }
      // Nested parts (like multipart/alternative inside multipart/mixed)
      if (part.parts) {
        const nested = getPlainTextBody(part);
        if (nested) return nested;
      }
    }
    // Fall back to text/html if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        // Strip HTML tags for plain text display
        return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      }
    }
  }
  
  return '';
}

// Fetch recent inbox messages (replies)
export async function getInboxMessages(maxResults: number = 20, afterTimestamp?: Date): Promise<ParsedEmail[]> {
  try {
    const gmail = await getUncachableGmailClient();
    
    // Build query - look for messages in inbox that are not sent by us
    let query = 'in:inbox -from:me';
    
    // Filter by time if provided
    if (afterTimestamp) {
      const afterEpoch = Math.floor(afterTimestamp.getTime() / 1000);
      query += ` after:${afterEpoch}`;
    }
    
    console.log(`📥 Fetching inbox messages with query: ${query}`);
    
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults,
    });
    
    const messages = listResponse.data.messages || [];
    console.log(`📥 Found ${messages.length} messages in inbox`);
    
    if (messages.length === 0) {
      return [];
    }
    
    // Fetch full message details
    const parsedMessages: ParsedEmail[] = [];
    
    for (const msg of messages) {
      if (!msg.id) continue;
      
      try {
        const fullMessage = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full',
        });
        
        const headers = fullMessage.data.payload?.headers || [];
        const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
        
        const fromHeader = getHeader('From');
        const subject = getHeader('Subject');
        const to = getHeader('To');
        const date = getHeader('Date');
        const inReplyTo = getHeader('In-Reply-To');
        
        const body = getPlainTextBody(fullMessage.data.payload);
        
        parsedMessages.push({
          id: msg.id,
          threadId: fullMessage.data.threadId || '',
          subject,
          from: fromHeader,
          fromEmail: extractEmailAddress(fromHeader),
          to,
          body,
          date: date ? new Date(date) : new Date(),
          inReplyTo: inReplyTo || undefined,
        });
      } catch (err) {
        console.error(`Error fetching message ${msg.id}:`, err);
      }
    }
    
    return parsedMessages;
  } catch (error: any) {
    console.error('Error fetching inbox messages:', error);
    throw error;
  }
}

// Check if a specific Gmail message ID has been processed
export async function getMessageById(messageId: string): Promise<ParsedEmail | null> {
  try {
    const gmail = await getUncachableGmailClient();
    
    const fullMessage = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });
    
    const headers = fullMessage.data.payload?.headers || [];
    const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
    
    const fromHeader = getHeader('From');
    const subject = getHeader('Subject');
    const to = getHeader('To');
    const date = getHeader('Date');
    const inReplyTo = getHeader('In-Reply-To');
    
    const body = getPlainTextBody(fullMessage.data.payload);
    
    return {
      id: messageId,
      threadId: fullMessage.data.threadId || '',
      subject,
      from: fromHeader,
      fromEmail: extractEmailAddress(fromHeader),
      to,
      body,
      date: date ? new Date(date) : new Date(),
      inReplyTo: inReplyTo || undefined,
    };
  } catch (error: any) {
    console.error(`Error fetching message ${messageId}:`, error);
    return null;
  }
}
