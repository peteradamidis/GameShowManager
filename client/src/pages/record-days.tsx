import { RecordDayCard, RecordDay } from "@/components/record-day-card";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, Edit, AlertTriangle, ChevronLeft, ChevronRight, CalendarDays, LayoutGrid } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";

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
  });
  const [viewMode, setViewMode] = useState<"grid" | "calendar">("calendar");
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
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
    staleTime: 5000,
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });

  const createMutation = useMutation({
    mutationFn: async (data: RecordDayFormData) => {
      return await apiRequest('POST', '/api/record-days', {
        date: data.date,
        rxNumber: data.rxNumber || null,
        totalSeats: data.totalSeats,
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

  const recordDays: RecordDay[] = [...apiRecordDays]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((day) => {
      const dayAssignments = allAssignments.find((a) => a.recordDayId === day.id)?.assignments || [];
      const filledSeats = dayAssignments.length;
      const confirmedSeats = dayAssignments.filter((a: any) => a.confirmedRsvp).length;
      // Parse date parts from ISO string to avoid timezone issues
      const [year, month, dayNum] = day.date.split('T')[0].split('-').map(Number);
      const localDate = new Date(year, month - 1, dayNum);

      return {
        id: day.id,
        date: localDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
        rxNumber: day.rxNumber,
        totalSeats: day.totalSeats || 154,
        filledSeats,
        confirmedSeats,
      };
    });

  const handleOpenCreate = () => {
    setEditingRecordDay(null);
    setFormData({
      date: "",
      rxNumber: "",
      totalSeats: 154,
    });
    setIsDialogOpen(true);
  };

  const handleOpenEdit = (recordDay: ApiRecordDay) => {
    setEditingRecordDay(recordDay);
    setFormData({
      date: recordDay.date.split('T')[0],
      rxNumber: recordDay.rxNumber || "",
      totalSeats: recordDay.totalSeats || 154,
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

  // Calendar helpers
  const getCalendarDays = () => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startDayOfWeek = firstDay.getDay(); // 0 = Sunday
    
    const days: Array<{ date: Date | null; recordDay?: RecordDay & { rawDate: string } }> = [];
    
    // Add empty slots for days before the first of the month
    for (let i = 0; i < startDayOfWeek; i++) {
      days.push({ date: null });
    }
    
    // Add all days in the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(year, month, day);
      // Format as YYYY-MM-DD in local timezone (don't use toISOString which converts to UTC)
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      // Find if there's a record day on this date
      const recordDay = apiRecordDays.find(rd => rd.date.split('T')[0] === dateStr);
      let enrichedRecordDay: (RecordDay & { rawDate: string }) | undefined;
      
      if (recordDay) {
        const dayAssignments = allAssignments.find((a) => a.recordDayId === recordDay.id)?.assignments || [];
        // Parse date parts from ISO string to avoid timezone issues
        const [rdYear, rdMonth, rdDay] = recordDay.date.split('T')[0].split('-').map(Number);
        const localDate = new Date(rdYear, rdMonth - 1, rdDay);
        enrichedRecordDay = {
          id: recordDay.id,
          date: localDate.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
          rawDate: recordDay.date,
          rxNumber: recordDay.rxNumber,
          totalSeats: recordDay.totalSeats || 154,
          filledSeats: dayAssignments.length,
          confirmedSeats: dayAssignments.filter((a: any) => a.confirmedRsvp).length,
        };
      }
      
      days.push({ date, recordDay: enrichedRecordDay });
    }
    
    return days;
  };

  const calendarDays = getCalendarDays();
  const monthName = calendarMonth.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  
  const goToPrevMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1));
  };
  
  const goToNextMonth = () => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1));
  };
  
  const goToToday = () => {
    const now = new Date();
    setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
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

      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "grid" | "calendar")} className="w-full">
        <TabsList>
          <TabsTrigger value="grid" className="gap-2" data-testid="tab-grid-view">
            <LayoutGrid className="h-4 w-4" />
            Grid
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2" data-testid="tab-calendar-view">
            <CalendarDays className="h-4 w-4" />
            Calendar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="mt-4">
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
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <Card>
            <CardContent className="p-4">
              {/* Calendar Header */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" onClick={goToPrevMonth} data-testid="button-prev-month">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={goToNextMonth} data-testid="button-next-month">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <h2 className="text-xl font-semibold ml-2">{monthName}</h2>
                </div>
                <Button variant="outline" size="sm" onClick={goToToday} data-testid="button-today">
                  Today
                </Button>
              </div>

              {/* Calendar Grid */}
              <div className="grid grid-cols-7 gap-1">
                {/* Day headers */}
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
                  <div key={day} className="text-center text-sm font-medium text-muted-foreground p-2">
                    {day}
                  </div>
                ))}
                
                {/* Calendar days */}
                {calendarDays.map((dayInfo, index) => {
                  const isToday = dayInfo.date && 
                    dayInfo.date.toDateString() === new Date().toDateString();
                  
                  return (
                    <div
                      key={index}
                      className={`min-h-[100px] border rounded-md p-1 ${
                        dayInfo.date ? 'bg-background' : 'bg-muted/30'
                      } ${isToday ? 'ring-2 ring-primary' : ''}`}
                    >
                      {dayInfo.date && (
                        <>
                          <div className={`text-sm font-medium mb-1 ${isToday ? 'text-primary' : ''}`}>
                            {dayInfo.date.getDate()}
                          </div>
                          {dayInfo.recordDay && (
                            <div
                              className="bg-primary/10 border border-primary/30 rounded p-1 cursor-pointer hover-elevate"
                              onClick={() => setLocation(`/seating-chart?day=${dayInfo.recordDay!.id}`)}
                              data-testid={`calendar-day-${dayInfo.recordDay.id}`}
                            >
                              <div className="text-xs font-medium text-primary truncate">
                                {dayInfo.recordDay.rxNumber || 'RX Day'}
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {dayInfo.recordDay.confirmedSeats}/{dayInfo.recordDay.filledSeats} confirmed
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
                  {deleteRecordDay && (() => {
                    const [year, month, day] = deleteRecordDay.date.split('T')[0].split('-').map(Number);
                    return new Date(year, month - 1, day).toLocaleDateString('en-AU', { 
                      weekday: 'long',
                      day: 'numeric', 
                      month: 'long', 
                      year: 'numeric' 
                    });
                  })()}
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
