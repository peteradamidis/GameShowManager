import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
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
import { Calendar, User, Mail, Phone, MapPin, Users, Heart, AlertTriangle } from "lucide-react";
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

  const handleRowClick = (contestant: any) => {
    setSelectedContestant(contestant);
    setDetailDialogOpen(true);
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

      await refetch();
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });

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

  const handleRemovePermanently = async (cancellationId: string) => {
    if (!confirm("Are you sure you want to permanently remove this canceled assignment?")) {
      return;
    }

    try {
      await apiRequest('DELETE', `/api/canceled-assignments/${cancellationId}`, {});
      await refetch();
      toast({
        title: "Removed",
        description: "Canceled assignment has been permanently removed.",
      });
    } catch (error: any) {
      toast({
        title: "Remove failed",
        description: error?.message || "Could not remove canceled assignment.",
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
          Contestants who canceled their original booking
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Canceled Contestants</CardTitle>
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
                  <TableHead>Name</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Original Date</TableHead>
                  <TableHead>Original Seat</TableHead>
                  <TableHead>Canceled At</TableHead>
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
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {cancellation.contestant.name}
                      </div>
                    </TableCell>
                    <TableCell>{cancellation.contestant.age}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {cancellation.contestant.gender}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {cancellation.recordDay?.date ? (
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
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(new Date(cancellation.canceledAt), 'MMM dd, yyyy HH:mm')}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {cancellation.reason || '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-2 justify-end">
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
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemovePermanently(cancellation.id);
                          }}
                          data-testid={`button-remove-${cancellation.id}`}
                        >
                          Remove
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
        <DialogContent className="max-w-2xl" data-testid="dialog-contestant-details">
          <DialogHeader>
            <DialogTitle>Contestant Details</DialogTitle>
            <DialogDescription>
              Complete information for {selectedContestant?.name || "this contestant"}
            </DialogDescription>
          </DialogHeader>

          {selectedContestant && (
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
                {selectedContestant.address && (
                  <div className="flex items-center gap-2 text-sm col-span-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span>{selectedContestant.address}</span>
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
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
