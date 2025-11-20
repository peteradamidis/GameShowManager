import { ContestantTable, Contestant } from "@/components/contestant-table";
import { ImportExcelDialog } from "@/components/import-excel-dialog";
import { Button } from "@/components/ui/button";
import { Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Contestants() {
  const { toast } = useToast();

  const mockContestants: Contestant[] = [
    { id: "1", name: "Sarah Johnson", groupId: "GRP001", age: 28, gender: "Female", availabilityStatus: "Assigned", recordDay: "Dec 15, 2025" },
    { id: "2", name: "Mike Chen", groupId: "GRP001", age: 32, gender: "Male", availabilityStatus: "Assigned", recordDay: "Dec 15, 2025" },
    { id: "3", name: "Emma Williams", groupId: null, age: 24, gender: "Female", availabilityStatus: "Available" },
    { id: "4", name: "James Brown", groupId: "GRP002", age: 45, gender: "Male", availabilityStatus: "Pending" },
    { id: "5", name: "Lisa Anderson", groupId: "GRP002", age: 41, gender: "Female", availabilityStatus: "Pending" },
    { id: "6", name: "David Martinez", groupId: "GRP003", age: 36, gender: "Male", availabilityStatus: "Available" },
    { id: "7", name: "Jennifer Lee", groupId: "GRP003", age: 29, gender: "Female", availabilityStatus: "Available" },
    { id: "8", name: "Robert Taylor", groupId: null, age: 52, gender: "Male", availabilityStatus: "Invited", recordDay: "Dec 22, 2025" },
    { id: "9", name: "Amanda White", groupId: "GRP004", age: 31, gender: "Female", availabilityStatus: "Assigned", recordDay: "Dec 15, 2025" },
    { id: "10", name: "Chris Evans", groupId: "GRP004", age: 33, gender: "Male", availabilityStatus: "Assigned", recordDay: "Dec 15, 2025" },
  ];

  const handleSendAvailabilityForms = () => {
    toast({
      title: "Availability forms sent",
      description: "Forms have been sent to all pending contestants.",
    });
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
          <Button variant="outline" onClick={handleSendAvailabilityForms} data-testid="button-send-availability">
            <Mail className="h-4 w-4 mr-2" />
            Send Availability Forms
          </Button>
          <ImportExcelDialog onImport={(file) => console.log('Importing:', file.name)} />
        </div>
      </div>

      <ContestantTable contestants={mockContestants} />
    </div>
  );
}
