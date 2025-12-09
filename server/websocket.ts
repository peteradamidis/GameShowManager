import { WebSocketServer, WebSocket } from 'ws';
import type { Server, IncomingMessage } from 'http';

interface BookingMasterUpdate {
  type: 'booking-master-update';
  recordDayId: string;
  assignmentId: string;
  field: string;
  value: any;
}

interface ConnectedClient {
  ws: WebSocket;
  recordDayId?: string;
  authenticated: boolean;
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<ConnectedClient> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server, 
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      // Check if session cookie is present - basic authentication check
      // The REST API handles full auth; WebSocket just needs to verify the session exists
      const cookies = this.parseCookies(req.headers.cookie || '');
      const hasSession = !!cookies['connect.sid'];
      
      const client: ConnectedClient = { 
        ws, 
        authenticated: hasSession 
      };
      this.clients.add(client);
      
      if (!hasSession) {
        console.log('WebSocket connection without session cookie - limited access');
        // Still allow connection but mark as unauthenticated
        // This allows graceful degradation while page loads session
      } else {
        console.log('WebSocket client connected with session. Total clients:', this.clients.size);
      }

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          // Client subscribing to a specific record day
          if (data.type === 'subscribe' && data.recordDayId) {
            // Only allow subscription if client appears authenticated
            if (client.authenticated || hasSession) {
              client.recordDayId = data.recordDayId;
              client.authenticated = true;
              console.log('Client subscribed to record day:', data.recordDayId);
            } else {
              console.log('Subscription rejected - no session');
              ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized' }));
            }
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      });

      ws.on('close', () => {
        this.clients.delete(client);
        console.log('WebSocket client disconnected. Total clients:', this.clients.size);
      });

      ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        this.clients.delete(client);
      });

      // Send a welcome message
      ws.send(JSON.stringify({ 
        type: 'connected', 
        message: 'Connected to Booking Master live updates',
        authenticated: hasSession
      }));
    });

    console.log('WebSocket server initialized on /ws');
  }

  private parseCookies(cookieHeader: string): Record<string, string> {
    const cookies: Record<string, string> = {};
    if (!cookieHeader) return cookies;
    
    cookieHeader.split(';').forEach(cookie => {
      const [name, value] = cookie.trim().split('=');
      if (name && value) {
        cookies[name] = decodeURIComponent(value);
      }
    });
    
    return cookies;
  }

  // Broadcast a booking master update to all clients watching that record day
  broadcastBookingUpdate(update: BookingMasterUpdate) {
    if (!this.wss) return;

    const message = JSON.stringify(update);
    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN && client.authenticated) {
        // Send to clients watching this specific record day
        if (client.recordDayId === update.recordDayId) {
          client.ws.send(message);
          sentCount++;
        }
      }
    });

    if (sentCount > 0) {
      console.log(`Broadcast booking update to ${sentCount} clients:`, update.field, update.assignmentId);
    }
  }

  // Broadcast a full refresh signal (for major changes)
  broadcastRefresh(recordDayId: string) {
    if (!this.wss) return;

    const message = JSON.stringify({ type: 'refresh', recordDayId });

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN && client.authenticated) {
        if (client.recordDayId === recordDayId) {
          client.ws.send(message);
        }
      }
    });
  }
}

export const wsManager = new WebSocketManager();
