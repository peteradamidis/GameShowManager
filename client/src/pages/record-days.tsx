import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ApiRecordDay = {
  id: string;
  date: string;
  rxNumber?: string | null;
  totalSeats: number;
  status: string;
};

type RecordDayFormData = {
  date: string;
  rxNumber: string;
  totalSeats: number;
  status: string;
};

export default function RecordDays() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingRecordDay, setEditingRecordDay] = useState<ApiRecordDay | null>(null);
  const [deleteRecordDay, setDeleteRecordDay] = useState<ApiRecordDay | null>(null);
  const [formData, setFormData] = useState<RecordDayFormData>({
    date: "",
    rxNumber: "",
    totalSeats: 154,
    status: "draft",
  });

  const { data: apiRecordDays = [], isLoading } = useQuery<ApiRecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  const { data: allAssignments = [] } = useQuery<Array<{ recordDayId: string; assignments: any[] }>>({
    queryKey: ['/api/all-seat-assignments'],
    queryFn: async () => {
      const promises = apiRecordDays.map(async (day) => {
        const response = await fetch(`/api/seat-assignments/${day.id}`);
        if (!response.ok) return { recordDayId: day.id, assignments: [] };
        const assignments = await response.json();
        return { recordDayId: day.id, assignments };
      });
      return await Promise.all(promises);
    },
    enabled: apiRecordDays.length > 0,
  });

  const createMutation = useMutation({
    mutationFn: async (data: RecordDayFormData) => {
      return await apiRequest('POST', '/api/record-days', {
        date: data.date,
        rxNumber: data.rxNumber || null,
        totalSeats: data.totalSeats,
        status: data.status,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      toast({
        title: "Record day created",
        description: "The new record day has been added successfully.",
      });
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create record day",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<RecordDayFormData> }) => {
      return await apiRequest('PATCH', `/api/record-days/${id}`, {
        date: data.date,
        rxNumber: data.rxNumber || null,
        totalSeats: data.totalSeats,
        status: data.status,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      toast({
        title: "Record day updated",
        description: "The record day has been updated successfully.",
      });
      handleCloseDialog();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update record day",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest('DELETE', `/api/record-days/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      toast({
        title: "Record day deleted",
        description: "The record day has been permanently removed.",
      });
      setDeleteRecordDay(null);
    },
    onError: (error: any) => {
      toast({
        title: "Cannot delete record day",
        description: error.message || "Failed to delete record day",
        variant: "destructive",
      });
      setDeleteRecordDay(null);
    },
  });

  const recordDays: RecordDay[] = apiRecordDays
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((day) => {
      const dayAssignments = allAssignments.find((a) => a.recordDayId === day.id)?.assignments || [];
      const filledSeats = dayAssignments.length;
      const femaleCount = dayAssignments.filter((a: any) => a.gender === 'Female').length;
      const femalePercent = filledSeats > 0 ? Math.round((femaleCount / filledSeats) * 100) : 0;

      return {
        id: day.id,
        date: new Date(day.date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
        rxNumber: day.rxNumber,
        totalSeats: day.totalSeats || 154,
        filledSeats,
        femalePercent,
        status: day.status === 'draft' ? 'Draft' : day.status === 'ready' ? 'Ready' : day.status === 'completed' ? 'Completed' : 'Invited',
      };
    });

  const handleOpenCreate = () => {
    setEditingRecordDay(null);
    setFormData({
      date: "",
      rxNumber: "",
      totalSeats: 154,
      status: "draft",
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (recordDay: ApiRecordDay) => {
    setEditingRecordDay(recordDay);
    setFormData({
      date: recordDay.date.split('T')[0],
      rxNumber: recordDay.rxNumber || "",
      totalSeats: recordDay.totalSeats || 154,
      status: recordDay.status || "draft",
    });
    setIsDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setIsDialogOpen(false);
    setEditingRecordDay(null);
    setFormData({
      date: "",
      rxNumber: "",
      totalSeats: 154,
      status: "draft",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.date) {
      toast({
        title: "Date required",
        description: "Please select a date for the record day.",
        variant: "destructive",
      });
      return;
    }

    if (editingRecordDay) {
      updateMutation.mutate({ id: editingRecordDay.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleDeleteClick = (recordDayId: string) => {
    const recordDay = apiRecordDays.find(rd => rd.id === recordDayId);
    if (recordDay) {
      setDeleteRecordDay(recordDay);
    }
  };

  const handleConfirmDelete = () => {
    if (deleteRecordDay) {
      deleteMutation.mutate(deleteRecordDay.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Record Days</h1>
          <p className="text-muted-foreground">
            Manage recording schedules and contestant assignments
          </p>
        </div>
        <Button onClick={handleOpenCreate} data-testid="button-create-record-day">
          <Plus className="h-4 w-4 mr-2" />
          Create Record Day
        </Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading record days...
        </div>
      ) : recordDays.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          No record days yet. Create one to get started!
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {recordDays.map((recordDay) => {
            const apiDay = apiRecordDays.find(d => d.id === recordDay.id);
            return (
              <RecordDayCard
                key={recordDay.id}
                recordDay={recordDay}
                onViewSeating={() => setLocation(`/seating-chart?day=${recordDay.id}`)}
                onEdit={apiDay ? () => handleOpenEdit(apiDay) : undefined}
                onDelete={() => handleDeleteClick(recordDay.id)}
                onSendInvitations={() => {
                  toast({
                    title: "Invitations sent",
                    description: `Record day invitations sent to all ${recordDay.filledSeats} assigned contestants.`,
                  });
                }}
              />
            );
          })}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              {editingRecordDay ? "Edit Record Day" : "Create Record Day"}
            </DialogTitle>
            <DialogDescription>
              {editingRecordDay 
                ? "Update the details for this record day."
                : "Add a new record day to the schedule."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="date">Date *</Label>
                <Input
                  id="date"
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  data-testid="input-record-day-date"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="rxNumber">RX Number (e.g., "RX EP 1 - 5")</Label>
                <Input
                  id="rxNumber"
                  placeholder="RX EP 1 - 5"
                  value={formData.rxNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, rxNumber: e.target.value }))}
                  data-testid="input-record-day-rx-number"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="totalSeats">Total Seats</Label>
                <Input
                  id="totalSeats"
                  type="number"
                  min={1}
                  max={500}
                  value={formData.totalSeats}
                  onChange={(e) => setFormData(prev => ({ ...prev, totalSeats: parseInt(e.target.value) || 154 }))}
                  data-testid="input-record-day-total-seats"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}
                >
                  <SelectTrigger data-testid="select-record-day-status">
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="ready">Ready</SelectItem>
                    <SelectItem value="invited">Invited</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleCloseDialog}>
                Cancel
              </Button>
              <Button 
                type="submit" 
                disabled={createMutation.isPending || updateMutation.isPending}
                data-testid="button-save-record-day"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteRecordDay} onOpenChange={(open) => !open && setDeleteRecordDay(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Delete Record Day?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                <strong>Warning:</strong> You are about to permanently delete the record day on{" "}
                <strong>
                  {deleteRecordDay && new Date(deleteRecordDay.date).toLocaleDateString('en-US', { 
                    weekday: 'long',
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </strong>
                {deleteRecordDay?.rxNumber && ` (${deleteRecordDay.rxNumber})`}.
              </p>
              <p className="text-destructive font-medium">
                This action cannot be undone. All related block type configurations will also be removed.
              </p>
              <p>
                Note: If there are any contestants assigned to this record day, they must be removed first.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-record-day"
            >
              {deleteMutation.isPending ? "Deleting..." : "Yes, Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
