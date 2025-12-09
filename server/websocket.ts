import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

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
}

class WebSocketManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<ConnectedClient> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const client: ConnectedClient = { ws };
      this.clients.add(client);
      console.log('WebSocket client connected. Total clients:', this.clients.size);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          // Client subscribing to a specific record day
          if (data.type === 'subscribe' && data.recordDayId) {
            client.recordDayId = data.recordDayId;
            console.log('Client subscribed to record day:', data.recordDayId);
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
      ws.send(JSON.stringify({ type: 'connected', message: 'Connected to Booking Master live updates' }));
    });

    console.log('WebSocket server initialized on /ws');
  }

  // Broadcast a booking master update to all clients watching that record day
  broadcastBookingUpdate(update: BookingMasterUpdate) {
    if (!this.wss) return;

    const message = JSON.stringify(update);
    let sentCount = 0;

    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        // Send to clients watching this specific record day, or all clients if no filter
        if (!client.recordDayId || client.recordDayId === update.recordDayId) {
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
      if (client.ws.readyState === WebSocket.OPEN) {
        if (!client.recordDayId || client.recordDayId === recordDayId) {
          client.ws.send(message);
        }
      }
    });
  }
}

export const wsManager = new WebSocketManager();
