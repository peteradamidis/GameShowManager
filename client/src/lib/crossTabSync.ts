import {
  invalidateContestantData,
  invalidateRecordDayData,
  invalidateSeatingData,
  invalidateBookingData,
  invalidateAvailabilityData,
  invalidateAllData,
} from './cacheHelpers';

type SyncEventType = 
  | 'contestant-change'
  | 'record-day-change'
  | 'seating-change'
  | 'booking-change'
  | 'availability-change'
  | 'all-change';

interface SyncEvent {
  type: SyncEventType;
  recordDayId?: string;
  timestamp: number;
}

const CHANNEL_NAME = 'contestant-manager-sync';
let channel: BroadcastChannel | null = null;

function handleMessage(event: MessageEvent<SyncEvent>) {
  const { type, recordDayId } = event.data;
  
  switch (type) {
    case 'contestant-change':
      invalidateContestantData();
      break;
    case 'record-day-change':
      invalidateRecordDayData(recordDayId);
      break;
    case 'seating-change':
      invalidateSeatingData(recordDayId);
      break;
    case 'booking-change':
      invalidateBookingData(recordDayId);
      break;
    case 'availability-change':
      invalidateAvailabilityData();
      break;
    case 'all-change':
      invalidateAllData();
      break;
  }
}

function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') {
    return null;
  }
  
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = handleMessage;
  }
  
  return channel;
}

export function initCrossTabSync() {
  getChannel();
}

export function closeCrossTabSync() {
  if (channel) {
    channel.close();
    channel = null;
  }
}

export function broadcastContestantChange() {
  getChannel()?.postMessage({
    type: 'contestant-change',
    timestamp: Date.now(),
  } as SyncEvent);
}

export function broadcastRecordDayChange(recordDayId?: string) {
  getChannel()?.postMessage({
    type: 'record-day-change',
    recordDayId,
    timestamp: Date.now(),
  } as SyncEvent);
}

export function broadcastSeatingChange(recordDayId?: string) {
  getChannel()?.postMessage({
    type: 'seating-change',
    recordDayId,
    timestamp: Date.now(),
  } as SyncEvent);
}

export function broadcastBookingChange(recordDayId?: string) {
  getChannel()?.postMessage({
    type: 'booking-change',
    recordDayId,
    timestamp: Date.now(),
  } as SyncEvent);
}

export function broadcastAvailabilityChange() {
  getChannel()?.postMessage({
    type: 'availability-change',
    timestamp: Date.now(),
  } as SyncEvent);
}

export function broadcastAllChange() {
  getChannel()?.postMessage({
    type: 'all-change',
    timestamp: Date.now(),
  } as SyncEvent);
}
