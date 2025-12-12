import { queryClient } from './queryClient';

export function invalidateContestantData() {
  queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
  queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
  queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
  queryClient.invalidateQueries({ queryKey: ['/api/all-seat-assignments'] });
}

export function invalidateRecordDayData(recordDayId?: string) {
  queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
  queryClient.invalidateQueries({ queryKey: ['/api/all-seat-assignments'] });
  if (recordDayId) {
    queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
  } else {
    queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
  }
}

export function invalidateSeatingData(recordDayId?: string) {
  queryClient.invalidateQueries({ queryKey: ['/api/all-seat-assignments'] });
  if (recordDayId) {
    queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
  } else {
    queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
  }
  queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
  queryClient.invalidateQueries({ queryKey: ['/api/standbys'] });
}

export function invalidateBookingData(recordDayId?: string) {
  queryClient.invalidateQueries({ queryKey: ['/api/booking-confirmations'] });
  queryClient.invalidateQueries({ queryKey: ['/api/booking-responses'] });
  if (recordDayId) {
    queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments', recordDayId] });
  }
}

export function invalidateAvailabilityData() {
  queryClient.invalidateQueries({ queryKey: ['/api/availability-requests'] });
  queryClient.invalidateQueries({ queryKey: ['/api/availability-responses'] });
}

export function invalidateAllData() {
  invalidateContestantData();
  queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
  invalidateBookingData();
  invalidateAvailabilityData();
}
