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
import { Search } from "lucide-react";

export interface Contestant {
  id: string;
  name: string;
  groupId: string | null;
  age: number;
  gender: "Male" | "Female" | "Other";
  availabilityStatus: "Pending" | "Available" | "Assigned" | "Invited";
  recordDay?: string;
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
              <TableRow key={contestant.id} data-testid={`row-contestant-${contestant.id}`}>
                {onSelectionChange && (
                  <TableCell>
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
    </div>
  );
}
