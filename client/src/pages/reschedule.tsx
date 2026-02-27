import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, User, Mail, Phone, MapPin, Users, Heart, AlertTriangle, Pencil, X, Save, Trash2, Search, FileCheck, Wrench, History } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format, isSameDay, parseISO } from "date-fns";

const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

export default function ReschedulePage() {
  const { toast } = useToast();
  const [rebookDialogOpen, setRebookDialogOpen] = useState(false);
  const [selectedCancellation, setSelectedCancellation] = useState<any>(null);
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>("");
  const [selectedBlock, setSelectedBlock] = useState<string>("");
  const [selectedSeat, setSelectedSeat] = useState<string>("");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedContestant, setSelectedContestant] = useState<any>(null);
  const [selectedCancellationRecord, setSelectedCancellationRecord] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [filterOriginalRecordDayId, setFilterOriginalRecordDayId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all"); // filter by contestant state

  const handleRowClick = (cancellation: any) => {
    const contestant = cancellation.contestant;
    setSelectedContestant(contestant);
    setSelectedCancellationRecord(cancellation);
    setEditFormData({
      name: contestant.name || '',
      age: contestant.age || '',
      gender: contestant.gender || '',
      email: contestant.email || '',
      phone: contestant.phone || '',
      location: contestant.location || '',
      attendingWith: contestant.attendingWith || '',
      medicalInfo: contestant.medicalInfo || '',
      mobilityNotes: contestant.mobilityNotes || '',
      criminalRecord: contestant.criminalRecord || '',
      auditionRating: contestant.auditionRating || '',
    });
    setDetailDialogOpen(true);
  };

  useEffect(() => {
    if (!detailDialogOpen) {
      setIsEditMode(false);
    }
  }, [detailDialogOpen]);

  const updateContestantMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest('PATCH', `/api/contestants/${selectedContestant?.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      setIsEditMode(false);
      if (selectedContestant) {
        setSelectedContestant({ ...selectedContestant, ...editFormData });
      }
      toast({
        title: "Contestant updated",
        description: "Contestant information has been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const cleanupSeatedMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/canceled-assignments/cleanup-seated');
      return response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Cleanup complete",
        description: data.deletedCount > 0 
          ? `Removed ${data.deletedCount} entries: ${data.removedNames?.join(', ')}`
          : "No duplicates found - reschedule list is clean",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Cleanup failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEditFormChange = (field: string, value: any) => {
    setEditFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = () => {
    updateContestantMutation.mutate(editFormData);
  };

  const handleCancelEdit = () => {
    if (selectedContestant) {
      setEditFormData({
        name: selectedContestant.name || '',
        age: selectedContestant.age || '',
        gender: selectedContestant.gender || '',
        email: selectedContestant.email || '',
        phone: selectedContestant.phone || '',
        location: selectedContestant.location || '',
        attendingWith: selectedContestant.attendingWith || '',
        medicalInfo: selectedContestant.medicalInfo || '',
        mobilityNotes: selectedContestant.mobilityNotes || '',
        criminalRecord: selectedContestant.criminalRecord || '',
        auditionRating: selectedContestant.auditionRating || '',
      });
    }
    setIsEditMode(false);
  };

  // Group booking state
  const [seatGroupTogether, setSeatGroupTogether] = useState(false);

  const { data: canceledAssignments = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/canceled-assignments'],
  });

  const { data: recordDays = [] } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  // Fetch all seat assignments to check if rescheduled contestants are now booked
  const { data: allSeatAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments/all'],
  });

  // Create a map of contestantId -> current booking info
  const currentBookings = useMemo(() => {
    const bookingMap: { [contestantId: string]: { recordDay: any; blockNumber: number; seatLabel: string } } = {};
    allSeatAssignments.forEach((assignment: any) => {
      if (assignment.contestantId) {
        const recordDay = recordDays.find((rd: any) => rd.id === assignment.recordDayId);
        bookingMap[assignment.contestantId] = {
          recordDay,
          blockNumber: assignment.blockNumber,
          seatLabel: assignment.seatLabel,
        };
      }
    });
    return bookingMap;
  }, [allSeatAssignments, recordDays]);

  const sortedCanceledAssignments = useMemo(() => {
    return [...canceledAssignments].sort((a: any, b: any) => {
      // Primary sort: Group ID (if both have one)
      const groupA = a.contestant?.groupId;
      const groupB = b.contestant?.groupId;
      
      if (groupA && groupB && groupA === groupB) {
        // Same group, keep them together and sort by name
        return a.contestant.name.localeCompare(b.contestant.name);
      }
      
      if (groupA && groupB) {
        return groupA.localeCompare(groupB);
      }
      
      // Secondary sort: Attending With (fuzzy grouping for non-linked partners)
      const withA = (a.contestant?.attendingWith || "").toLowerCase().trim();
      const withB = (b.contestant?.attendingWith || "").toLowerCase().trim();
      const nameA = a.contestant.name.toLowerCase().trim();
      const nameB = b.contestant.name.toLowerCase().trim();

      // If A is attending with B, or vice-versa
      const isPartnerAB = (withA && nameB.includes(withA)) || (withB && nameA.includes(withB));
      
      if (isPartnerAB) {
        // They are likely partners, group them. 
        // We use a stable secondary key to ensure they stay together in the list
        const pairKey = [nameA, nameB].sort().join("-");
        return pairKey.localeCompare(pairKey); // This logic is slightly flawed for sorting but helps if we use a consistent sort key
      }

      // Default sort by added date (newest first)
      return new Date(b.addedAt || b.canceledAt).getTime() - new Date(a.addedAt || a.canceledAt).getTime();
    });
  }, [canceledAssignments]);

  // Fetch occupied seats for the selected record day
  const { data: occupiedSeats = [] } = useQuery({
    queryKey: ['/api/seat-assignments', selectedRecordDayId],
    enabled: !!selectedRecordDayId,
    queryFn: async () => {
      const response = await fetch(`/api/seat-assignments/${selectedRecordDayId}`);
      if (!response.ok) {
        if (response.status === 404) return [];
        throw new Error('Failed to fetch seat assignments');
      }
      return response.json();
    },
  });

  // Generate available seats for selected block
  const availableSeats = selectedBlock ? (() => {
    const blockNum = parseInt(selectedBlock);
    const occupied = new Set(
      occupiedSeats
        .filter((a: any) => a.blockNumber === blockNum)
        .map((a: any) => a.seatLabel)
    );
    
    const allSeats: string[] = [];
    SEAT_ROWS.forEach(row => {
      for (let i = 1; i <= row.count; i++) {
        const seatLabel = `${row.label}${i}`;
        if (!occupied.has(seatLabel)) {
          allSeats.push(seatLabel);
        }
      }
    });
    return allSeats;
  })() : [];

  // Create a map of dates to record days for the calendar
  const recordDayDates = useMemo(() => {
    const dateMap = new Map<string, any>();
    recordDays.forEach((day: any) => {
      const dateStr = day.date.split('T')[0];
      dateMap.set(dateStr, day);
    });
    return dateMap;
  }, [recordDays]);

  // Get the selected record day details
  const selectedRecordDayDetails = useMemo(() => {
    return recordDays.find((day: any) => day.id === selectedRecordDayId);
  }, [recordDays, selectedRecordDayId]);

  // Get the currently selected date for the calendar
  const selectedCalendarDate = useMemo(() => {
    if (!selectedRecordDayDetails) return undefined;
    const dateStr = selectedRecordDayDetails.date.split('T')[0];
    return parseISO(dateStr);
  }, [selectedRecordDayDetails]);

  // Determine which dates have record days
  const recordDayDatesList = useMemo(() => {
    return recordDays.map((day: any) => parseISO(day.date.split('T')[0]));
  }, [recordDays]);

  // Handle calendar date selection
  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) {
      setSelectedRecordDayId("");
      setSelectedBlock("");
      setSelectedSeat("");
      return;
    }
    const dateStr = format(date, 'yyyy-MM-dd');
    const recordDay = recordDayDates.get(dateStr);
    if (recordDay) {
      setSelectedRecordDayId(recordDay.id);
      setSelectedBlock("");
      setSelectedSeat("");
    }
  };

  const handleRebook = (cancellation: any) => {
    setSelectedCancellation(cancellation);
    setSelectedRecordDayId("");
    setSelectedBlock("");
    setSelectedSeat("");
    setRebookDialogOpen(true);
  };

  // Helper: find consecutive available seats starting from a selected seat
  const getConsecutiveSeatsFrom = (startSeat: string, count: number): string[] => {
    if (count <= 1) return [startSeat];
    const row = startSeat.charAt(0);
    const startNum = parseInt(startSeat.substring(1));
    const rowConfig = SEAT_ROWS.find(r => r.label === row);
    if (!rowConfig) return [startSeat];
    const maxNum = rowConfig.count;

    const occupiedSet = new Set(
      (occupiedSeats as any[])
        .filter((a: any) => a.blockNumber === parseInt(selectedBlock))
        .map((a: any) => a.seatLabel)
    );

    const seats: string[] = [startSeat];
    // Extend right
    for (let i = startNum + 1; seats.length < count && i <= maxNum; i++) {
      const label = `${row}${i}`;
      if (!occupiedSet.has(label)) seats.push(label);
      else break;
    }
    // If not enough, extend left from start
    for (let i = startNum - 1; seats.length < count && i >= 1; i--) {
      const label = `${row}${i}`;
      if (!occupiedSet.has(label)) seats.unshift(label);
      else break;
    }
    return seats;
  };

  const handleConfirmRebook = async () => {
    if (!selectedCancellation || !selectedRecordDayId || !selectedBlock || !selectedSeat) return;

    try {
      const selectedContestantId = selectedCancellation.contestantId;

      // Find partners in the reschedule list when group booking is enabled
      const partners = seatGroupTogether
        ? canceledAssignments.filter((c: any) =>
            c.contestantId !== selectedContestantId &&
            (
              (c.contestant?.groupId && c.contestant.groupId === selectedCancellation.contestant?.groupId) ||
              (selectedCancellation.contestant?.attendingWith && c.contestant?.name &&
               selectedCancellation.contestant.attendingWith.toLowerCase().includes(c.contestant.name.toLowerCase())) ||
              (c.contestant?.attendingWith && selectedCancellation.contestant?.name &&
               c.contestant.attendingWith.toLowerCase().includes(selectedCancellation.contestant.name.toLowerCase()))
            )
          )
        : [];

      const membersToSeat = [selectedCancellation, ...partners];

      // For groups: find consecutive seats from the selected seat
      const seatsToUse = membersToSeat.length > 1
        ? getConsecutiveSeatsFrom(selectedSeat, membersToSeat.length)
        : [selectedSeat];

      if (seatsToUse.length < membersToSeat.length) {
        toast({
          title: "Not enough consecutive seats",
          description: `Cannot find ${membersToSeat.length} consecutive empty seats in the same row starting from ${selectedSeat}. Try a different starting seat.`,
          variant: "destructive",
        });
        return;
      }

      // Use dedicated rebook endpoint that preserves paperwork status
      await Promise.all(membersToSeat.map((member, index) =>
        apiRequest('POST', `/api/canceled-assignments/${member.id}/rebook`, {
          recordDayId: selectedRecordDayId,
          blockNumber: parseInt(selectedBlock),
          seatLabel: seatsToUse[index],
        })
      ));

      // Invalidate ALL related queries for consistent state across tabs
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/returning-contestants'] }),
      ]);
      await refetch();

      const seatedNames = membersToSeat.map(m => m.contestant.name).join(', ');
      toast({
        title: membersToSeat.length > 1 ? "Group rebooked" : "Contestant rebooked",
        description: membersToSeat.length > 1
          ? `${seatedNames} have been assigned to Block ${selectedBlock}, Seats ${seatsToUse.join(', ')}.`
          : `${selectedCancellation.contestant.name} has been assigned to Block ${selectedBlock}, Seat ${selectedSeat}.`,
      });

      setRebookDialogOpen(false);
      setSelectedCancellation(null);
    } catch (error: any) {
      let parsedError: any = null;
      try {
        const errorMsg = error?.message || '';
        const jsonMatch = errorMsg.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          parsedError = JSON.parse(jsonMatch[1]);
        }
      } catch {}

      if (parsedError?.isReturning) {
        const confirmed = window.confirm(
          `RETURNING CONTESTANT\n\n${parsedError.contestantName || 'This contestant'} previously appeared on ${parsedError.previousLabel || parsedError.previousDay || 'a completed episode'}.\n\nDo you want to rebook them as a returning contestant?`
        );
        if (confirmed) {
          try {
            await apiRequest('POST', `/api/canceled-assignments/${selectedCancellation.id}/rebook`, {
              recordDayId: selectedRecordDayId,
              blockNumber: parseInt(selectedBlock),
              seatLabel: selectedSeat,
              allowReturning: true,
            });
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
              queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
              queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
              queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
              queryClient.invalidateQueries({ queryKey: ['/api/returning-contestants'] }),
            ]);
            await refetch();
            toast({
              title: "Returning contestant rebooked",
              description: `${selectedCancellation.contestant.name} has been rebooked as a returning contestant.`,
            });
            setRebookDialogOpen(false);
            setSelectedCancellation(null);
          } catch (retryError: any) {
            toast({
              title: "Rebooking failed",
              description: retryError?.message || "Could not rebook returning contestant.",
              variant: "destructive",
            });
          }
        }
        return;
      }

      toast({
        title: "Rebooking failed",
        description: parsedError?.error || error?.message || "Could not rebook contestant.",
        variant: "destructive",
      });
    }
  };

  // Handler to delete test subject contestants
  const handleDeleteTestSubject = async (contestantId: string) => {
    try {
      await apiRequest('DELETE', `/api/contestants/${contestantId}`);
      toast({
        title: "Test subject removed",
        description: "The contestant has been deleted from the system.",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
    } catch (error: any) {
      toast({
        title: "Failed to delete",
        description: error?.message || "Could not delete contestant.",
        variant: "destructive",
      });
    }
  };

  const handleReturnToContestants = async (cancellationId: string, contestantName: string) => {
    if (!confirm(`Return ${contestantName} to the contestants tab? They will be marked as available for booking.`)) {
      return;
    }

    try {
      await apiRequest('DELETE', `/api/canceled-assignments/${cancellationId}`, {});
      // Invalidate ALL related queries for consistent state across tabs
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
      ]);
      await refetch();
      toast({
        title: "Returned to Contestants",
        description: `${contestantName} is now available in the contestants tab.`,
      });
    } catch (error: any) {
      toast({
        title: "Action failed",
        description: error?.message || "Could not return contestant.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reschedule</h1>
        <p className="text-muted-foreground">
          Canceled contestants and standbys eligible for rebooking
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
          <div className="flex items-center gap-3">
            <CardTitle>Contestants for Rebooking</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => cleanupSeatedMutation.mutate()}
              disabled={cleanupSeatedMutation.isPending}
              data-testid="btn-cleanup-seated"
            >
              <Wrench className="h-4 w-4 mr-1" />
              {cleanupSeatedMutation.isPending ? 'Cleaning...' : 'Remove Seated Duplicates'}
            </Button>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name or attending with..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-64"
                data-testid="input-search-reschedule"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-status" className="text-sm font-medium whitespace-nowrap">Status:</Label>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger id="filter-status" className="w-36" data-testid="select-filter-status">
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="rescheduled">Reschedule</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="invited">Invited</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="returning_standby">Returning Standby</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-type" className="text-sm font-medium whitespace-nowrap">Type:</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger id="filter-type" className="w-32" data-testid="select-filter-type">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="standby">Standby</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label htmlFor="filter-original-day" className="text-sm font-medium whitespace-nowrap">Original Date:</Label>
              <Select value={filterOriginalRecordDayId} onValueChange={setFilterOriginalRecordDayId}>
                <SelectTrigger id="filter-original-day" className="w-64" data-testid="select-filter-original-day">
                  <SelectValue placeholder="All dates" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All dates</SelectItem>
                  {recordDays
                    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime())
                    .map((rd: any) => (
                      <SelectItem key={rd.id} value={rd.id}>
                        {rd.rxNumber ? `${rd.rxNumber} — ` : ''}{format(new Date(rd.date), "EEE, d MMM yyyy")}
                      </SelectItem>
                    ))
                  }
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {canceledAssignments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <CalendarIcon className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No canceled contestants</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Photo</TableHead>
                  <TableHead className="min-w-[120px]">Name</TableHead>
                  <TableHead className="w-20">Type</TableHead>
                  <TableHead className="w-24">Status</TableHead>
                  <TableHead className="w-14">Rating</TableHead>
                  <TableHead className="w-12">Age</TableHead>
                  <TableHead className="w-14">Gender</TableHead>
                  <TableHead className="w-28">Attending With</TableHead>
                  <TableHead className="w-36">Email</TableHead>
                  <TableHead className="w-24">Orig. Day</TableHead>
                  <TableHead className="w-20">Orig. Seat</TableHead>
                  <TableHead className="w-24">Added At</TableHead>
                  <TableHead className="min-w-[180px]">Reason</TableHead>
                  <TableHead className="w-16">By</TableHead>
                  <TableHead className="w-20 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCanceledAssignments
                  .filter((cancellation: any) => {
                    const matchesDate = filterOriginalRecordDayId === "all" || cancellation.recordDayId === filterOriginalRecordDayId;
                    const searchLower = searchQuery.toLowerCase();
                    const matchesSearch = !searchQuery || 
                      cancellation.contestant?.name?.toLowerCase().includes(searchLower) ||
                      cancellation.contestant?.attendingWith?.toLowerCase().includes(searchLower) ||
                      cancellation.contestant?.email?.toLowerCase().includes(searchLower);
                    const matchesType = filterType === "all" || 
                      (filterType === "standby" && cancellation.isFromStandby) || 
                      (filterType === "canceled" && !cancellation.isFromStandby);
                    const contestantStatus = cancellation.contestant?.availabilityStatus?.toLowerCase() || '';
                    const matchesStatus = filterStatus === "all" || contestantStatus === filterStatus;
                    return matchesDate && matchesSearch && matchesType && matchesStatus;
                  })
                  .map((cancellation: any) => (
                  <TableRow 
                    key={cancellation.id} 
                    data-testid={`row-canceled-${cancellation.id}`}
                    onClick={() => handleRowClick(cancellation)}
                    className="cursor-pointer hover-elevate"
                  >
                    <TableCell>
                      <Avatar className="h-10 w-10">
                        {cancellation.contestant.photoUrl && (
                          <AvatarImage src={cancellation.contestant.photoUrl} alt={cancellation.contestant.name} />
                        )}
                        <AvatarFallback>
                          {cancellation.contestant.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-1.5">
                        <span>{cancellation.contestant.name}</span>
                        {(cancellation.contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(cancellation.contestant.name)) && cancellation.contestant.id && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5 text-destructive hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm(`Remove test subject ${cancellation.contestant.name}?`)) {
                                handleDeleteTestSubject(cancellation.contestant.id);
                              }
                            }}
                            title="Remove test subject"
                            data-testid={`button-delete-test-subject-${cancellation.contestant.id}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                        {cancellation.paperworkReceived && (
                          <Badge variant="outline" className="border-teal-300 bg-teal-500/20 text-teal-800 dark:border-teal-700 dark:text-teal-400 text-xs px-1.5" title="Paperwork received">
                            <FileCheck className="h-3 w-3" />
                          </Badge>
                        )}
                        {!cancellation.paperworkReceived && cancellation.paperworkSent && (
                          <Badge variant="outline" className="border-orange-300 bg-orange-500/20 text-orange-700 dark:border-orange-700 dark:text-orange-400 text-xs px-1.5" title="Paperwork sent, awaiting return">
                            <FileCheck className="h-3 w-3" />
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {cancellation.isFromStandby ? (
                          <>
                            <Badge className="bg-yellow-500 text-yellow-950 hover:bg-yellow-500">
                              Standby
                            </Badge>
                            {/* Display block type from seatedAsBlockType field or fall back to parsing reason */}
                            {cancellation.seatedAsBlockType === 'PB' || cancellation.reason?.includes('Podium Block') || cancellation.reason?.includes('Case Holder') ? (
                              <Badge variant="outline" className="border-purple-300 bg-purple-100 text-purple-700 dark:border-purple-700 dark:bg-purple-900 dark:text-purple-300 text-[10px]" title="Case Holder">
                                PB
                              </Badge>
                            ) : cancellation.seatedAsBlockType === 'NPB' || cancellation.reason?.includes('Non-Playing Block') ? (
                              <Badge variant="outline" className="border-blue-300 bg-blue-100 text-blue-700 dark:border-blue-700 dark:bg-blue-900 dark:text-blue-300 text-[10px]" title="Non Playing Block">
                                NPB
                              </Badge>
                            ) : cancellation.reason?.includes('Not Seated') ? (
                              <Badge variant="outline" className="border-gray-300 bg-gray-100 text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 text-[10px]">
                                NS
                              </Badge>
                            ) : null}
                          </>
                        ) : (
                          <Badge variant="secondary">
                            Canceled
                          </Badge>
                        )}
                        {/* Show reschedule count if > 1 */}
                        {(cancellation.rescheduleCount || 1) > 1 && (
                          <Badge variant="outline" className="border-red-300 bg-red-100 text-red-700 dark:border-red-700 dark:bg-red-900 dark:text-red-300 text-[10px]" title={`In reschedule ${cancellation.rescheduleCount} times`}>
                            x{cancellation.rescheduleCount}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const status = cancellation.contestant?.availabilityStatus;
                        if (status === 'assigned') return <Badge className="bg-blue-500/15 text-blue-700 border-blue-300 dark:text-blue-400 dark:border-blue-700">Assigned</Badge>;
                        if (status === 'rescheduled') return <Badge className="bg-orange-500/15 text-orange-700 border-orange-300 dark:text-orange-400 dark:border-orange-700">Reschedule</Badge>;
                        if (status === 'invited') return <Badge className="bg-purple-500/15 text-purple-700 border-purple-300 dark:text-purple-400 dark:border-purple-700">Invited</Badge>;
                        if (status === 'confirmed') return <Badge className="bg-green-500/15 text-green-700 border-green-300 dark:text-green-400 dark:border-green-700">Confirmed</Badge>;
                        if (status === 'available') return <Badge className="bg-gray-500/15 text-gray-700 border-gray-300 dark:text-gray-400 dark:border-gray-600">Available</Badge>;
                        if (status === 'returning_standby') return <Badge className="bg-yellow-500/15 text-yellow-700 border-yellow-300 dark:text-yellow-400 dark:border-yellow-700">Ret. Standby</Badge>;
                        return <Badge variant="outline">{status || '—'}</Badge>;
                      })()}
                    </TableCell>
                    <TableCell>
                      {cancellation.contestant.auditionRating ? (
                        <Badge variant="outline">
                          {cancellation.contestant.auditionRating}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell>{cancellation.contestant.age}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {cancellation.contestant.gender}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground truncate max-w-[150px] block" title={cancellation.contestant.attendingWith}>
                        {cancellation.contestant.attendingWith || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground truncate max-w-[180px] block" title={cancellation.contestant.email}>
                        {cancellation.contestant.email || "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      {cancellation.isFromStandby && cancellation.originalAttendanceDate ? (
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(cancellation.originalAttendanceDate), 'dd MMM yyyy')}
                        </div>
                      ) : cancellation.recordDay?.date ? (
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(cancellation.recordDay.date), 'dd MMM yyyy')}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {cancellation.blockNumber && cancellation.seatLabel ? (
                        <Badge variant="outline">
                          Block {cancellation.blockNumber}, {cancellation.seatLabel}
                        </Badge>
                      ) : cancellation.seatLabel ? (
                        <Badge variant="outline">
                          {cancellation.seatLabel}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {format(new Date(cancellation.canceledAt), 'dd MMM yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      <div className="space-y-1 max-w-[200px]">
                        {cancellation.reason && <span className="break-words">{cancellation.reason}</span>}
                        {(cancellation as any).standbyMovementNotes && (
                          <span className={`break-words ${cancellation.reason ? "block text-purple-600 dark:text-purple-400" : ""}`}>
                            {(cancellation as any).standbyMovementNotes}
                          </span>
                        )}
                        {!cancellation.reason && !(cancellation as any).standbyMovementNotes && '—'}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {cancellation.movedBy ? (
                        <Badge variant="outline" className="font-mono text-xs">
                          {cancellation.movedBy}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {(() => {
                        // First check if rebooked via the rebookedToRecordDayId field on the record
                        if (cancellation.rebookedToRecordDayId) {
                          const rebookedRecordDay = recordDays.find((rd: any) => rd.id === cancellation.rebookedToRecordDayId);
                          const dateStr = rebookedRecordDay?.date 
                            ? format(new Date(rebookedRecordDay.date), 'EEE d MMM')
                            : 'Unknown date';
                          // Also check if they have a current seat assignment
                          const booking = currentBookings[cancellation.contestantId];
                          return (
                            <div className="flex items-center gap-2">
                              <Badge className="bg-green-100 text-green-700 border-green-300">
                                REBOOKED
                              </Badge>
                              <span className="text-sm font-medium text-green-700">
                                {dateStr}{booking ? ` - B${booking.blockNumber} ${booking.seatLabel}` : ''}
                              </span>
                            </div>
                          );
                        }
                        // Fallback: check currentBookings map (for legacy data without rebookedToRecordDayId)
                        const booking = currentBookings[cancellation.contestantId];
                        if (booking) {
                          const dateStr = booking.recordDay?.date 
                            ? format(new Date(booking.recordDay.date), 'EEE d MMM')
                            : 'Unknown date';
                          return (
                            <div className="flex items-center gap-2">
                              <Badge className="bg-green-100 text-green-700 border-green-300">
                                REBOOKED
                              </Badge>
                              <span className="text-sm font-medium text-green-700">
                                {dateStr} - B{booking.blockNumber} {booking.seatLabel}
                              </span>
                            </div>
                          );
                        }
                        // Not booked - show rebook button
                        return (
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRebook(cancellation);
                              }}
                              data-testid={`button-rebook-${cancellation.id}`}
                            >
                              Rebook
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReturnToContestants(cancellation.id, cancellation.contestant?.name);
                              }}
                              title="Return to contestants"
                              data-testid={`button-return-${cancellation.id}`}
                            >
                              <Trash2 className="h-4 w-4 text-muted-foreground" />
                            </Button>
                          </div>
                        );
                      })()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Rebook Dialog */}
      <Dialog open={rebookDialogOpen} onOpenChange={setRebookDialogOpen}>
        <DialogContent className="max-w-md" data-testid="dialog-rebook-contestant">
          <DialogHeader>
            <DialogTitle>Rebook Contestant</DialogTitle>
            <DialogDescription>
              Assign {selectedCancellation?.contestant?.name} to a new record day and seat
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Calendar for date selection */}
            <div>
              <label className="text-sm font-medium mb-1 block">Select Record Day</label>
              <div className="border rounded-lg p-1 flex justify-center">
                <CalendarComponent
                  mode="single"
                  selected={selectedCalendarDate}
                  onSelect={handleCalendarSelect}
                  modifiers={{
                    recordDay: recordDayDatesList,
                  }}
                  modifiersStyles={{
                    recordDay: {
                      fontWeight: 'bold',
                      backgroundColor: 'hsl(var(--primary) / 0.1)',
                      borderRadius: '50%',
                    }
                  }}
                  disabled={(date) => !recordDayDatesList.some(rd => isSameDay(rd, date))}
                  data-testid="calendar-record-day"
                />
              </div>
              {selectedRecordDayDetails && (
                <div className="mt-1 p-1.5 bg-muted rounded text-sm">
                  <span className="font-medium">Selected: </span>
                  {format(parseISO(selectedRecordDayDetails.date.split('T')[0]), 'd MMMM yyyy')}
                  {selectedRecordDayDetails.rxNumber && (
                    <span className="text-muted-foreground"> ({selectedRecordDayDetails.rxNumber})</span>
                  )}
                </div>
              )}
            </div>

            {selectedCancellation?.contestant?.attendingWith && (
              <div className="flex items-center space-x-2 p-2 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50">
                <Checkbox 
                  id="seat-group-together" 
                  checked={seatGroupTogether} 
                  onCheckedChange={(checked) => setSeatGroupTogether(!!checked)}
                />
                <Label 
                  htmlFor="seat-group-together" 
                  className="text-sm font-medium leading-none cursor-pointer flex items-center gap-1"
                >
                  <Users className="h-4 w-4 text-amber-600" />
                  Seat with partner(s)? (Currently attending with: {selectedCancellation.contestant.attendingWith})
                </Label>
              </div>
            )}

            {/* Block and Seat Selection */}
            {selectedRecordDayId && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium mb-1 block">Block</label>
                  <Select value={selectedBlock} onValueChange={(val) => { setSelectedBlock(val); setSelectedSeat(""); }}>
                    <SelectTrigger data-testid="select-block">
                      <SelectValue placeholder="Select block" />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7].map((block) => (
                        <SelectItem key={block} value={String(block)}>
                          Block {block}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-1 block">
                    {seatGroupTogether ? "Starting Seat" : "Seat"}
                  </label>
                  <Select 
                    value={selectedSeat} 
                    onValueChange={setSelectedSeat}
                    disabled={!selectedBlock}
                  >
                    <SelectTrigger data-testid="select-seat">
                      <SelectValue placeholder={selectedBlock ? "Select seat" : "Select block first"} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSeats.length === 0 ? (
                        <SelectItem value="none" disabled>No available seats</SelectItem>
                      ) : (
                        availableSeats.map((seat) => (
                          <SelectItem key={seat} value={seat}>
                            {seat}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Group seat preview */}
            {seatGroupTogether && selectedSeat && selectedBlock && (() => {
              const partnerCount = canceledAssignments.filter((c: any) =>
                c.contestantId !== selectedCancellation?.contestantId &&
                (
                  (c.contestant?.groupId && c.contestant.groupId === selectedCancellation?.contestant?.groupId) ||
                  (selectedCancellation?.contestant?.attendingWith && c.contestant?.name &&
                   selectedCancellation.contestant.attendingWith.toLowerCase().includes(c.contestant.name.toLowerCase())) ||
                  (c.contestant?.attendingWith && selectedCancellation?.contestant?.name &&
                   c.contestant.attendingWith.toLowerCase().includes(selectedCancellation.contestant.name.toLowerCase()))
                )
              ).length;
              const totalMembers = partnerCount + 1;
              const previewSeats = getConsecutiveSeatsFrom(selectedSeat, totalMembers);
              return (
                <div className="p-2 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 text-sm">
                  <p className="font-medium text-blue-700 dark:text-blue-300">
                    {totalMembers} contestants will be seated together:
                  </p>
                  <p className="text-blue-600 dark:text-blue-400 text-xs mt-1">
                    Seats: {previewSeats.length >= totalMembers
                      ? previewSeats.join(', ')
                      : `${previewSeats.join(', ')} — not enough consecutive seats, try a different starting seat`}
                  </p>
                </div>
              );
            })()}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRebookDialogOpen(false)}
              data-testid="button-cancel-rebook"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmRebook}
              disabled={!selectedRecordDayId || !selectedBlock || !selectedSeat}
              data-testid="button-confirm-rebook"
            >
              Confirm Rebook
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contestant Details Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-contestant-details">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <DialogTitle>{isEditMode ? 'Edit Contestant' : 'Contestant Details'}</DialogTitle>
                <DialogDescription>
                  {isEditMode ? 'Update contestant information' : `Complete information for ${selectedContestant?.name || "this contestant"}`}
                </DialogDescription>
              </div>
              {selectedContestant && !isEditMode && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsEditMode(true)}
                  data-testid="button-edit-contestant"
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          </DialogHeader>

          {selectedContestant && (
            isEditMode ? (
              <div className="space-y-6">
                {/* Photo and Basic Info Edit */}
                <div className="flex gap-4">
                  <Avatar className="h-20 w-20 border-2 border-border">
                    {selectedContestant.photoUrl ? (
                      <AvatarImage 
                        src={selectedContestant.photoUrl} 
                        alt={selectedContestant.name}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="text-xl bg-muted">
                      <User className="h-8 w-8 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 space-y-4">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Basic Information</h3>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="edit-name">Name</Label>
                        <Input
                          id="edit-name"
                          value={editFormData.name || ''}
                          onChange={(e) => handleEditFormChange('name', e.target.value)}
                          data-testid="input-edit-name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-age">Age</Label>
                        <Input
                          id="edit-age"
                          type="number"
                          value={editFormData.age || ''}
                          onChange={(e) => handleEditFormChange('age', parseInt(e.target.value) || 0)}
                          data-testid="input-edit-age"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-gender">Gender</Label>
                        <Select 
                          value={editFormData.gender || ''} 
                          onValueChange={(value) => handleEditFormChange('gender', value)}
                        >
                          <SelectTrigger data-testid="select-edit-gender">
                            <SelectValue placeholder="Select gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-attending">Attending With</Label>
                        <Input
                          id="edit-attending"
                          value={editFormData.attendingWith || ''}
                          onChange={(e) => handleEditFormChange('attendingWith', e.target.value)}
                          data-testid="input-edit-attending"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-rating">Audition Score</Label>
                        <Select 
                          value={editFormData.auditionRating || ''} 
                          onValueChange={(value) => handleEditFormChange('auditionRating', value)}
                        >
                          <SelectTrigger data-testid="select-edit-rating">
                            <SelectValue placeholder="Select rating" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="A+">A+</SelectItem>
                            <SelectItem value="A">A</SelectItem>
                            <SelectItem value="B+">B+</SelectItem>
                            <SelectItem value="B">B</SelectItem>
                            <SelectItem value="C">C</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Contact Information Edit */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Contact Information</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-email">Email</Label>
                      <Input
                        id="edit-email"
                        type="email"
                        value={editFormData.email || ''}
                        onChange={(e) => handleEditFormChange('email', e.target.value)}
                        data-testid="input-edit-email"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-phone">Phone</Label>
                      <Input
                        id="edit-phone"
                        value={editFormData.phone || ''}
                        onChange={(e) => handleEditFormChange('phone', e.target.value)}
                        data-testid="input-edit-phone"
                      />
                    </div>
                    <div className="space-y-2 col-span-2">
                      <Label htmlFor="edit-location">Location</Label>
                      <Input
                        id="edit-location"
                        value={editFormData.location || ''}
                        onChange={(e) => handleEditFormChange('location', e.target.value)}
                        data-testid="input-edit-location"
                      />
                    </div>
                  </div>
                </div>

                {/* Medical Information Edit */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Medical Information</h3>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="edit-medical">Medical Conditions</Label>
                      <Textarea
                        id="edit-medical"
                        value={editFormData.medicalInfo || ''}
                        onChange={(e) => handleEditFormChange('medicalInfo', e.target.value)}
                        rows={3}
                        data-testid="input-edit-medical"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="edit-mobility">Mobility/Access Notes</Label>
                      <Textarea
                        id="edit-mobility"
                        value={editFormData.mobilityNotes || ''}
                        onChange={(e) => handleEditFormChange('mobilityNotes', e.target.value)}
                        rows={3}
                        data-testid="input-edit-mobility"
                      />
                    </div>
                  </div>
                </div>

                {/* Criminal Record Edit */}
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Criminal Record</h3>
                  <div className="space-y-2">
                    <Label htmlFor="edit-criminal">Criminal Record Information</Label>
                    <Textarea
                      id="edit-criminal"
                      value={editFormData.criminalRecord || ''}
                      onChange={(e) => handleEditFormChange('criminalRecord', e.target.value)}
                      rows={3}
                      data-testid="input-edit-criminal"
                    />
                  </div>
                </div>

                {/* Edit Mode Footer */}
                <DialogFooter className="gap-2">
                  <Button
                    variant="outline"
                    onClick={handleCancelEdit}
                    disabled={updateContestantMutation.isPending}
                    data-testid="button-cancel-edit"
                  >
                    <X className="h-4 w-4 mr-1" />
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveEdit}
                    disabled={updateContestantMutation.isPending}
                    data-testid="button-save-edit"
                  >
                    {updateContestantMutation.isPending ? (
                      <span className="flex items-center gap-1">
                        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        Saving...
                      </span>
                    ) : (
                      <>
                        <Save className="h-4 w-4 mr-1" />
                        Save Changes
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Photo and Basic Info Header */}
                <div className="flex gap-4">
                  <Avatar className="h-20 w-20 border-2 border-border">
                    {selectedContestant.photoUrl ? (
                      <AvatarImage 
                        src={selectedContestant.photoUrl} 
                        alt={selectedContestant.name}
                        className="object-cover"
                      />
                    ) : null}
                    <AvatarFallback className="text-xl bg-muted">
                      <User className="h-8 w-8 text-muted-foreground" />
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{selectedContestant.name}</h3>
                    <div className="flex gap-2 mt-1">
                      <Badge variant="secondary">{selectedContestant.age} years old</Badge>
                      <Badge variant="outline">{selectedContestant.gender}</Badge>
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                <div className="grid grid-cols-2 gap-4">
                  {selectedContestant.email && (
                    <div className="flex items-center gap-2 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedContestant.email}</span>
                    </div>
                  )}
                  {selectedContestant.phone && (
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedContestant.phone}</span>
                    </div>
                  )}
                  {selectedContestant.location && (
                    <div className="flex items-center gap-2 text-sm col-span-2">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span>{selectedContestant.location}</span>
                    </div>
                  )}
                </div>

                {/* Attending With */}
                {selectedContestant.attendingWith && (
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      <Users className="h-4 w-4 text-muted-foreground" />
                      Attending With
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedContestant.attendingWith}</p>
                  </div>
                )}

                {/* Medical Info */}
                {selectedContestant.medicalInfo && (
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      <Heart className="h-4 w-4 text-muted-foreground" />
                      Medical Information
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedContestant.medicalInfo}</p>
                  </div>
                )}

                {/* Mobility Notes */}
                {selectedContestant.mobilityNotes && (
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                      Mobility/Access Notes
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedContestant.mobilityNotes}</p>
                  </div>
                )}

                {/* Criminal Record */}
                {selectedContestant.criminalRecord && (
                  <div className="border-t pt-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-1">
                      <AlertTriangle className="h-4 w-4 text-destructive" />
                      Criminal Record
                    </div>
                    <p className="text-sm text-muted-foreground">{selectedContestant.criminalRecord}</p>
                  </div>
                )}

                {/* Reschedule History */}
                {selectedCancellationRecord && (
                  <div className="border-t pt-3" data-testid="section-reschedule-history">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <History className="h-4 w-4 text-muted-foreground" />
                      Reschedule History
                      {(selectedCancellationRecord.rescheduleCount || 1) > 1 && (
                        <Badge variant="outline" className="border-red-300 bg-red-100 text-red-700 dark:border-red-700 dark:bg-red-900 dark:text-red-300 text-xs" data-testid="badge-reschedule-count">
                          {selectedCancellationRecord.rescheduleCount} times
                        </Badge>
                      )}
                    </div>
                    
                    {/* Current reschedule info */}
                    <div className="bg-muted/50 rounded-md p-2 mb-2" data-testid="card-current-reschedule">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">Current</span>
                        <span className="text-muted-foreground" data-testid="text-reschedule-date">
                          {selectedCancellationRecord.canceledAt 
                            ? format(new Date(selectedCancellationRecord.canceledAt), 'dd MMM yyyy')
                            : 'Unknown date'}
                        </span>
                      </div>
                      {selectedCancellationRecord.reason && (
                        <p className="text-xs text-muted-foreground mt-1" data-testid="text-reschedule-reason">{selectedCancellationRecord.reason}</p>
                      )}
                      {selectedCancellationRecord.rebookedToRecordDayId && (
                        <Badge className="bg-green-100 text-green-700 border-green-300 mt-1 text-xs" data-testid="badge-rebooked-current">
                          Rebooked
                        </Badge>
                      )}
                    </div>
                    
                    {/* Previous decline history */}
                    {selectedCancellationRecord.declineHistory && 
                     Array.isArray(selectedCancellationRecord.declineHistory) && 
                     selectedCancellationRecord.declineHistory.length > 0 && (
                      <div className="space-y-2 max-h-40 overflow-y-auto" data-testid="list-decline-history">
                        <p className="text-xs font-medium text-muted-foreground">Previous Entries:</p>
                        {selectedCancellationRecord.declineHistory.map((entry: any, index: number) => (
                          <div key={index} className="bg-muted/30 rounded-md p-2 text-xs" data-testid={`card-history-entry-${index}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">
                                {entry.canceledAt 
                                  ? format(new Date(entry.canceledAt), 'dd MMM yyyy')
                                  : 'Unknown date'}
                              </span>
                              {entry.wasDeclined && (
                                <Badge variant="destructive" className="text-[10px] px-1" data-testid={`badge-declined-${index}`}>
                                  Declined
                                </Badge>
                              )}
                              {entry.rebookedToRecordDayId && (
                                <Badge className="bg-green-100 text-green-700 border-green-300 text-[10px] px-1" data-testid={`badge-rebooked-${index}`}>
                                  Rebooked
                                </Badge>
                              )}
                            </div>
                            {entry.reason && (
                              <p className="text-muted-foreground mt-1" data-testid={`text-history-reason-${index}`}>{entry.reason}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
                    Close
                  </Button>
                </DialogFooter>
              </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
