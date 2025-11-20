import { ContestantTable, Contestant } from "@/components/contestant-table";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { Button } from "@/components/ui/button";
import { Mail, UserPlus, TestTube } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export default function Contestants() {
  const { toast } = useToast();
  const [selectedContestants, setSelectedContestants] = useState<string[]>([]);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedRecordDay, setSelectedRecordDay] = useState<string>("");

  // Fetch contestants
  const { data: contestants = [], isLoading: loadingContestants, refetch: refetchContestants } = useQuery<Contestant[]>({
    queryKey: ['/api/contestants'],
  });

  // Fetch record days
  const { data: recordDays = [] } = useQuery<any[]>({
    queryKey: ['/api/record-days'],
  });

  const generateFakeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest('POST', '/api/contestants/generate-fake', {});
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Fake contestants generated",
        description: `Created ${data.count} contestants with ${data.groups} groups for testing.`,
      });
    },
    onError: () => {
      toast({
        title: "Generation failed",
        description: "Could not generate fake contestants.",
        variant: "destructive",
      });
    },
  });

  const handleSendAvailabilityForms = () => {
    toast({
      title: "Availability forms sent",
      description: "Forms have been sent to all pending contestants.",
    });
  };

  const handleAssignToRecordDay = async () => {
    if (!selectedRecordDay || selectedContestants.length === 0) return;

    try {
      // Add contestants to the selected record day
      await apiRequest('POST', `/api/record-days/${selectedRecordDay}/contestants`, {
        contestantIds: selectedContestants,
      });

      await refetchContestants();
      
      toast({
        title: "Contestants assigned",
        description: `${selectedContestants.length} contestant(s) assigned to record day.`,
      });

      setAssignDialogOpen(false);
      setSelectedContestants([]);
      setSelectedRecordDay("");
    } catch (error) {
      toast({
        title: "Assignment failed",
        description: "Could not assign contestants to record day.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contestants</h1>
          <p className="text-muted-foreground">
            Manage auditioned applicants and their availability
          </p>
        </div>
        <div className="flex gap-2">
          {selectedContestants.length > 0 && (
            <Button 
              onClick={() => setAssignDialogOpen(true)} 
              data-testid="button-assign-contestants"
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Assign {selectedContestants.length} to Record Day
            </Button>
          )}
          <Button 
            variant="outline" 
            onClick={() => generateFakeMutation.mutate()}
            disabled={generateFakeMutation.isPending}
            data-testid="button-generate-fake"
          >
            <TestTube className="h-4 w-4 mr-2" />
            {generateFakeMutation.isPending ? "Generating..." : "Generate Test Data"}
          </Button>
          <Button variant="outline" onClick={handleSendAvailabilityForms} data-testid="button-send-availability">
            <Mail className="h-4 w-4 mr-2" />
            Send Availability Forms
          </Button>
          <ImportExcelDialog onImport={(file) => console.log('Importing:', file.name)} />
        </div>
      </div>

      {loadingContestants ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading contestants...
        </div>
      ) : (
        <ContestantTable 
          contestants={contestants}
          selectedIds={selectedContestants}
          onSelectionChange={setSelectedContestants}
        />
      )}

      {/* Assign to Record Day Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent data-testid="dialog-assign-record-day">
          <DialogHeader>
            <DialogTitle>Assign to Record Day</DialogTitle>
            <DialogDescription>
              Select a record day to assign {selectedContestants.length} contestant(s) to.
            </DialogDescription>
          </DialogHeader>
          
          <div className="py-4">
            <Select value={selectedRecordDay} onValueChange={setSelectedRecordDay}>
              <SelectTrigger data-testid="select-record-day">
                <SelectValue placeholder="Select a record day" />
              </SelectTrigger>
              <SelectContent>
                {recordDays.map((day: any) => (
                  <SelectItem key={day.id} value={day.id}>
                    {new Date(day.date).toLocaleDateString()} - {day.status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleAssignToRecordDay} 
              disabled={!selectedRecordDay}
              data-testid="button-confirm-assign"
            >
              Assign Contestants
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
