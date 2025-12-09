import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useEffect } from "react";
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
import { Calendar, User, Mail, Phone, MapPin, Users, Heart, AlertTriangle, Pencil, X, Save, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";

export default function ReschedulePage() {
  const { toast } = useToast();
  const [rebookDialogOpen, setRebookDialogOpen] = useState(false);
  const [selectedCancellation, setSelectedCancellation] = useState<any>(null);
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>("");
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedContestant, setSelectedContestant] = useState<any>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});

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

  const handleRebook = (cancellation: any) => {
    setSelectedCancellation(cancellation);
    setSelectedRecordDayId("");
    setRebookDialogOpen(true);
  };

  const handleConfirmRebook = async () => {
    if (!selectedCancellation || !selectedRecordDayId) return;

    try {
      // Fetch existing assignments to find an available seat
      const response = await fetch(`/api/seat-assignments/${selectedRecordDayId}`);
      const assignments = response.ok ? await response.json() : [];

      // Find first available seat
      let foundSeat = null;
      const SEAT_ROWS = [
        { label: 'A', count: 5 },
        { label: 'B', count: 5 },
        { label: 'C', count: 4 },
        { label: 'D', count: 4 },
        { label: 'E', count: 4 },
      ];

      for (let blockNum = 1; blockNum <= 7 && !foundSeat; blockNum++) {
        for (const row of SEAT_ROWS) {
          for (let seatNum = 1; seatNum <= row.count; seatNum++) {
            const seatLabel = `${row.label}${seatNum}`;
            const isOccupied = assignments.some((a: any) => 
              a.blockNumber === blockNum && a.seatLabel === seatLabel
            );
            if (!isOccupied) {
              foundSeat = { blockNumber: blockNum, seatLabel };
              break;
            }
          }
          if (foundSeat) break;
        }
      }

      if (!foundSeat) {
        toast({
          title: "No available seats",
          description: "The selected record day has no available seats.",
          variant: "destructive",
        });
        return;
      }

      // Create new seat assignment
      await apiRequest('POST', '/api/seat-assignments', {
        recordDayId: selectedRecordDayId,
        contestantId: selectedCancellation.contestantId,
        blockNumber: foundSeat.blockNumber,
        seatLabel: foundSeat.seatLabel,
      });

      // Delete cancellation record after successful assignment
      await apiRequest('DELETE', `/api/canceled-assignments/${selectedCancellation.id}`, {});

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
        description: `${selectedCancellation.contestant.name} has been assigned to Block ${foundSeat.blockNumber}, Seat ${foundSeat.seatLabel}.`,
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
        <CardHeader>
          <CardTitle>Contestants for Rebooking</CardTitle>
        </CardHeader>
        <CardContent>
          {canceledAssignments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No canceled contestants</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16">Photo</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Original Attendance</TableHead>
                  <TableHead>Original Seat</TableHead>
                  <TableHead>Added At</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {canceledAssignments.map((cancellation: any) => (
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
                    <TableCell>{cancellation.contestant.age}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {cancellation.contestant.gender}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {cancellation.isFromStandby && cancellation.originalAttendanceDate ? (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          {format(new Date(cancellation.originalAttendanceDate), 'MMM dd, yyyy')}
                        </div>
                      ) : cancellation.recordDay?.date ? (
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
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
        <DialogContent data-testid="dialog-rebook-contestant">
          <DialogHeader>
            <DialogTitle>Rebook Contestant</DialogTitle>
            <DialogDescription>
              Assign {selectedCancellation?.contestant?.name} to a new record day
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">Record Day</label>
            <Select value={selectedRecordDayId} onValueChange={setSelectedRecordDayId}>
              <SelectTrigger data-testid="select-record-day">
                <SelectValue placeholder="Select a record day" />
              </SelectTrigger>
              <SelectContent>
                {recordDays.map((day: any) => (
                  <SelectItem key={day.id} value={day.id}>
                    {format(new Date(day.date), 'MMMM dd, yyyy')} - {day.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              Contestant will be assigned to the first available seat
            </p>
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
              disabled={!selectedRecordDayId}
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
