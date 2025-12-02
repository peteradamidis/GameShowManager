import { google } from 'googleapis';

let connectionSettings: any;

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

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=google-mail',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('Gmail not connected');
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

export async function sendEmail(to: string, subject: string, body: string, htmlBody?: string) {
  try {
    const gmail = await getUncachableGmailClient();
    
    const message = [
      `From: me`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody || body
    ].join('\n');

    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log(`📧 Email sent successfully to ${to}`);
    return true;
  } catch (error: any) {
    console.error(`Error sending email to ${to}:`, error);
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
