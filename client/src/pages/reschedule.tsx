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
import { Calendar as CalendarIcon, User, Mail, Phone, MapPin, Users, Heart, AlertTriangle, Pencil, X, Save, Trash2, Search, FileCheck } from "lucide-react";
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
  const [isEditMode, setIsEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [filterOriginalRecordDayId, setFilterOriginalRecordDayId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  const handleRowClick = (contestant: any) => {
    setSelectedContestant(contestant);
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

  const { data: canceledAssignments = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/canceled-assignments'],
  });

  const { data: recordDays = [] } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

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

  const handleConfirmRebook = async () => {
    if (!selectedCancellation || !selectedRecordDayId || !selectedBlock || !selectedSeat) return;

    try {
      // Use dedicated rebook endpoint that preserves paperwork status
      await apiRequest('POST', `/api/canceled-assignments/${selectedCancellation.id}/rebook`, {
        recordDayId: selectedRecordDayId,
        blockNumber: parseInt(selectedBlock),
        seatLabel: selectedSeat,
      });

      // Invalidate ALL related queries for consistent state across tabs
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/contestants'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/standbys'], exact: false }),
        queryClient.invalidateQueries({ queryKey: ['/api/canceled-assignments'], exact: false }),
      ]);
      await refetch();

      toast({
        title: "Contestant rebooked",
        description: `${selectedCancellation.contestant.name} has been assigned to Block ${selectedBlock}, Seat ${selectedSeat}.`,
      });

      setRebookDialogOpen(false);
      setSelectedCancellation(null);
    } catch (error: any) {
      toast({
        title: "Rebooking failed",
        description: error?.message || "Could not rebook contestant.",
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
          <CardTitle>Contestants for Rebooking</CardTitle>
          <div className="flex items-center gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 w-64"
                data-testid="input-search-reschedule"
              />
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
                        {rd.rxNumber ? `${rd.rxNumber} — ` : ''}{format(new Date(rd.date), "EEE, MMM d, yyyy")}
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
                  <TableHead className="w-16">Photo</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Paperwork</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Original Attendance</TableHead>
                  <TableHead>Original Seat</TableHead>
                  <TableHead>Added At</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Moved By</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {canceledAssignments
                  .filter((cancellation: any) => {
                    const matchesDate = filterOriginalRecordDayId === "all" || cancellation.recordDayId === filterOriginalRecordDayId;
                    const matchesSearch = !searchQuery || cancellation.contestant?.name?.toLowerCase().includes(searchQuery.toLowerCase());
                    return matchesDate && matchesSearch;
                  })
                  .map((cancellation: any) => (
                  <TableRow 
                    key={cancellation.id} 
                    data-testid={`row-canceled-${cancellation.id}`}
                    onClick={() => handleRowClick(cancellation.contestant)}
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
                      {cancellation.contestant.name}
                    </TableCell>
                    <TableCell>
                      {cancellation.isFromStandby ? (
                        <Badge className="bg-yellow-500 text-yellow-950 hover:bg-yellow-500">
                          Standby
                        </Badge>
                      ) : (
                        <Badge variant="secondary">
                          Canceled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {cancellation.paperworkReceived ? (
                        <Badge className="bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                          <FileCheck className="h-3 w-3 mr-1" />
                          Received
                        </Badge>
                      ) : cancellation.paperworkSent ? (
                        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                          Sent
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
                      {cancellation.isFromStandby && cancellation.originalAttendanceDate ? (
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(cancellation.originalAttendanceDate), 'MMM dd, yyyy')}
                        </div>
                      ) : cancellation.recordDay?.date ? (
                        <div className="flex items-center gap-2">
                          <CalendarIcon className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(cancellation.recordDay.date), 'MMM dd, yyyy')}
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
                      {format(new Date(cancellation.canceledAt), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {cancellation.reason || '—'}
                    </TableCell>
                    <TableCell>
                      {cancellation.movedBy ? (
                        <Badge variant="outline" className="font-mono">
                          {cancellation.movedBy}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
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
                  {format(parseISO(selectedRecordDayDetails.date.split('T')[0]), 'MMMM d, yyyy')}
                  {selectedRecordDayDetails.rxNumber && (
                    <span className="text-muted-foreground"> ({selectedRecordDayDetails.rxNumber})</span>
                  )}
                </div>
              )}
            </div>

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
                  <label className="text-sm font-medium mb-1 block">Seat</label>
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
