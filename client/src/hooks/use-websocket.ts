import { useEffect, useRef, useCallback, useState } from 'react';
import { queryClient } from '@/lib/queryClient';

interface BookingMasterUpdate {
  type: 'booking-master-update';
  recordDayId: string;
  assignmentId: string;
  field: string;
  value: any;
}

interface RefreshMessage {
  type: 'refresh';
  recordDayId: string;
}

type WebSocketMessage = BookingMasterUpdate | RefreshMessage | { type: 'connected'; message: string };

export function useBookingMasterWebSocket(recordDayId: string | null) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const currentRecordDayIdRef = useRef<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Close existing connection and cleanup
  const closeConnection = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = undefined;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // Connect to WebSocket for a specific record day
  const connect = useCallback(() => {
    const targetRecordDayId = currentRecordDayIdRef.current;
    
    // Don't connect if no record day selected
    if (!targetRecordDayId) {
      closeConnection();
      return;
    }

    // Close any existing connection first
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Build WebSocket URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected to Booking Master updates');
        setIsConnected(true);
        
        // Subscribe to updates for the current record day
        const currentId = currentRecordDayIdRef.current;
        if (currentId) {
          ws.send(JSON.stringify({ type: 'subscribe', recordDayId: currentId }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data: WebSocketMessage = JSON.parse(event.data);
          const currentId = currentRecordDayIdRef.current;

          if (data.type === 'connected') {
            console.log('WebSocket:', data.message);
            return;
          }

          // Only process messages for the currently selected record day
          if (data.type === 'refresh') {
            if (data.recordDayId === currentId) {
              queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', currentId] });
            }
            return;
          }

          if (data.type === 'booking-master-update') {
            // Only apply update if it's for the current record day
            if (data.recordDayId !== currentId) {
              return;
            }
            
            // Update the specific assignment in the query cache
            queryClient.setQueryData(
              ['/api/seat-assignments', currentId],
              (oldData: any[] | undefined) => {
                if (!oldData) return oldData;

                return oldData.map((assignment) => {
                  if (assignment.id === data.assignmentId) {
                    return {
                      ...assignment,
                      [data.field]: data.value,
                    };
                  }
                  return assignment;
                });
              }
            );
          }
        } catch (e) {
          console.error('WebSocket message parse error:', e);
        }
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setIsConnected(false);
        wsRef.current = null;
        
        // Only reconnect if we still have a record day selected
        if (currentRecordDayIdRef.current) {
          console.log('Will reconnect in 3 seconds...');
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, 3000);
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
    } catch (e) {
      console.error('WebSocket connection error:', e);
    }
  }, [closeConnection]);

  // Handle record day changes - connect/reconnect with new subscription
  useEffect(() => {
    // Update the ref with the current record day
    currentRecordDayIdRef.current = recordDayId;

    if (recordDayId) {
      // Connect (or reconnect) for the new record day
      connect();
    } else {
      // No record day selected, close connection
      closeConnection();
    }

    return () => {
      // Cleanup on unmount
      closeConnection();
    };
  }, [recordDayId, connect, closeConnection]);

  return { isConnected };
}
