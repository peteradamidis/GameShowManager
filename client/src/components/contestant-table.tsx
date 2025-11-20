import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Mail, Phone, MapPin, Heart } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useQuery } from "@tanstack/react-query";

export interface Contestant {
  id: string;
  name: string;
  groupId: string | null;
  age: number;
  gender: "Male" | "Female" | "Other";
  availabilityStatus: "Pending" | "Available" | "Assigned" | "Invited";
  recordDay?: string;
  attendingWith?: string;
  email?: string;
  phone?: string;
  address?: string;
  medicalInfo?: string;
}

interface ContestantTableProps {
  contestants: Contestant[];
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
}

const statusColors = {
  Pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  Available: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
  Assigned: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  Invited: "bg-purple-500/10 text-purple-700 dark:text-purple-400",
};

export function ContestantTable({ 
  contestants, 
  selectedIds = [], 
  onSelectionChange 
}: ContestantTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContestantId, setSelectedContestantId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const { data: contestantDetails } = useQuery<Contestant>({
    queryKey: [`/api/contestants/${selectedContestantId}`],
    enabled: !!selectedContestantId && detailDialogOpen,
  });

  const filteredContestants = contestants.filter((contestant) =>
    contestant.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleToggleAll = () => {
    if (!onSelectionChange) return;
    
    if (selectedIds.length === filteredContestants.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(filteredContestants.map(c => c.id));
    }
  };

  const handleToggle = (id: string) => {
    if (!onSelectionChange) return;
    
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter(sid => sid !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  };

  const handleRowClick = (contestantId: string) => {
    setSelectedContestantId(contestantId);
    setDetailDialogOpen(true);
  };

  const allSelected = filteredContestants.length > 0 && selectedIds.length === filteredContestants.length;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search contestants..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
          data-testid="input-search-contestants"
        />
      </div>
      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              {onSelectionChange && (
                <TableHead className="w-12">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={handleToggleAll}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
              )}
              <TableHead>Name</TableHead>
              <TableHead>Group ID</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Gender</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Record Day</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredContestants.map((contestant) => (
              <TableRow 
                key={contestant.id} 
                data-testid={`row-contestant-${contestant.id}`}
                onClick={() => handleRowClick(contestant.id)}
                className="cursor-pointer hover-elevate"
              >
                {onSelectionChange && (
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.includes(contestant.id)}
                      onCheckedChange={() => handleToggle(contestant.id)}
                      data-testid={`checkbox-contestant-${contestant.id}`}
                    />
                  </TableCell>
                )}
                <TableCell className="font-medium">{contestant.name}</TableCell>
                <TableCell>
                  {contestant.groupId ? (
                    <Badge variant="outline" className="font-mono text-xs">
                      {contestant.groupId}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground text-sm">-</span>
                  )}
                </TableCell>
                <TableCell>{contestant.age}</TableCell>
                <TableCell>{contestant.gender}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={statusColors[contestant.availabilityStatus]}>
                    {contestant.availabilityStatus}
                  </Badge>
                </TableCell>
                <TableCell>{contestant.recordDay || "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Contestant Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl" data-testid="dialog-contestant-details">
          <DialogHeader>
            <DialogTitle>Contestant Details</DialogTitle>
            <DialogDescription>
              Complete information for {contestantDetails?.name || "this contestant"}
            </DialogDescription>
          </DialogHeader>

          {contestantDetails ? (
            <div className="space-y-6">
              {/* Basic Information */}
              <div>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Basic Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Name</label>
                    <p className="text-sm mt-1">{contestantDetails.name}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Age</label>
                    <p className="text-sm mt-1">{contestantDetails.age}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Gender</label>
                    <p className="text-sm mt-1">{contestantDetails.gender}</p>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Status</label>
                    <div className="mt-1">
                      <Badge variant="secondary" className={statusColors[contestantDetails.availabilityStatus as keyof typeof statusColors]}>
                        {contestantDetails.availabilityStatus}
                      </Badge>
                    </div>
                  </div>
                  {contestantDetails.groupId && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Group ID</label>
                      <div className="mt-1">
                        <Badge variant="outline" className="font-mono text-xs">
                          {contestantDetails.groupId}
                        </Badge>
                      </div>
                    </div>
                  )}
                  {contestantDetails.attendingWith && (
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Attending With</label>
                      <p className="text-sm mt-1">{contestantDetails.attendingWith}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Contact Information */}
              {(contestantDetails.email || contestantDetails.phone || contestantDetails.address) && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Contact Information</h3>
                  <div className="space-y-3">
                    {contestantDetails.email && (
                      <div className="flex items-start gap-3">
                        <Mail className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Email</label>
                          <p className="text-sm mt-1">{contestantDetails.email}</p>
                        </div>
                      </div>
                    )}
                    {contestantDetails.phone && (
                      <div className="flex items-start gap-3">
                        <Phone className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Phone</label>
                          <p className="text-sm mt-1">{contestantDetails.phone}</p>
                        </div>
                      </div>
                    )}
                    {contestantDetails.address && (
                      <div className="flex items-start gap-3">
                        <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Address</label>
                          <p className="text-sm mt-1">{contestantDetails.address}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Medical Information */}
              {contestantDetails.medicalInfo && (
                <div>
                  <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Medical Information</h3>
                  <div className="flex items-start gap-3">
                    <Heart className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="text-sm whitespace-pre-wrap">{contestantDetails.medicalInfo}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Loading contestant details...
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
