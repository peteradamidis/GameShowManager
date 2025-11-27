import { useState, useRef } from "react";
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
import { Button } from "@/components/ui/button";
import { Search, Mail, Phone, MapPin, Heart, Camera, Upload, Trash2, User } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
  mobilityNotes?: string;
  criminalRecord?: string;
  photoUrl?: string | null;
}

interface SeatAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  blockNumber: number;
  seatLabel: string;
  rating?: string | null;
}

interface ContestantTableProps {
  contestants: Contestant[];
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  seatAssignments?: SeatAssignment[];
}

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    pending: "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:text-amber-400",
    available: "border-green-200 bg-green-500/10 text-green-700 dark:border-green-800 dark:text-green-400",
    assigned: "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-800 dark:text-blue-400",
    invited: "border-purple-200 bg-purple-500/10 text-purple-700 dark:border-purple-800 dark:text-purple-400",
  };
  
  const colorClasses = colors[status.toLowerCase()] || colors.available;
  
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${colorClasses}`}>
      {status}
    </span>
  );
};

export function ContestantTable({ 
  contestants, 
  selectedIds = [], 
  onSelectionChange,
  seatAssignments = []
}: ContestantTableProps) {
  // Create a map for quick lookup of seat assignments by contestant ID
  // Use the most recent assignment if multiple exist
  const seatAssignmentMap = new Map<string, SeatAssignment>();
  seatAssignments.forEach(sa => {
    seatAssignmentMap.set(sa.contestantId, sa);
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedContestantId, setSelectedContestantId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: contestantDetails } = useQuery<Contestant>({
    queryKey: ['/api/contestants', selectedContestantId],
    enabled: !!selectedContestantId && detailDialogOpen,
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('photo', file);
      
      const response = await fetch(`/api/contestants/${selectedContestantId}/photo`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload photo');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Photo uploaded",
        description: "Contestant photo has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setIsUploading(false);
    },
  });

  const deletePhotoMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/contestants/${selectedContestantId}/photo`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete photo');
      }
      
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Photo removed",
        description: "Contestant photo has been removed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file (JPEG, PNG, etc.)",
          variant: "destructive",
        });
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 5MB",
          variant: "destructive",
        });
        return;
      }
      
      setIsUploading(true);
      uploadPhotoMutation.mutate(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

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
              <TableHead>Audition Rating</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Attending With</TableHead>
              <TableHead>City</TableHead>
              <TableHead>Medical Conditions</TableHead>
              <TableHead>Mobility/Access Notes</TableHead>
              <TableHead>Criminal Record</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredContestants.map((contestant) => {
              const seatAssignment = seatAssignmentMap.get(contestant.id);
              return (
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
                  <TableCell>{seatAssignment?.rating || "-"}</TableCell>
                  <TableCell>{contestant.age}</TableCell>
                  <TableCell className="font-medium">{contestant.name}</TableCell>
                  <TableCell>{contestant.phone || "-"}</TableCell>
                  <TableCell>{contestant.email || "-"}</TableCell>
                  <TableCell>{contestant.attendingWith || "-"}</TableCell>
                  <TableCell>{contestant.address || "-"}</TableCell>
                  <TableCell className="max-w-[200px] truncate" title={contestant.medicalInfo || ""}>
                    {contestant.medicalInfo || "-"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={contestant.mobilityNotes || ""}>
                    {contestant.mobilityNotes || "-"}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate" title={contestant.criminalRecord || ""}>
                    {contestant.criminalRecord || "-"}
                  </TableCell>
                </TableRow>
              );
            })}
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
              {/* Photo and Basic Info Header */}
              <div className="flex gap-6">
                {/* Photo Section */}
                <div className="flex flex-col items-center gap-2">
                  <div className="relative group">
                    <Avatar className="h-24 w-24 border-2 border-border">
                      {contestantDetails.photoUrl ? (
                        <AvatarImage 
                          src={contestantDetails.photoUrl} 
                          alt={contestantDetails.name}
                          className="object-cover"
                        />
                      ) : null}
                      <AvatarFallback className="text-2xl bg-muted">
                        <User className="h-10 w-10 text-muted-foreground" />
                      </AvatarFallback>
                    </Avatar>
                    
                    {/* Upload overlay on hover */}
                    <div 
                      className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Camera className="h-6 w-6 text-white" />
                    </div>
                  </div>
                  
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                    data-testid="input-photo-upload"
                  />
                  
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading || uploadPhotoMutation.isPending}
                      data-testid="button-upload-photo"
                    >
                      {isUploading ? (
                        <span className="flex items-center gap-1">
                          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          Uploading...
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <Upload className="h-3 w-3" />
                          Upload
                        </span>
                      )}
                    </Button>
                    
                    {contestantDetails.photoUrl && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => deletePhotoMutation.mutate()}
                        disabled={deletePhotoMutation.isPending}
                        data-testid="button-delete-photo"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {/* Basic Information */}
                <div className="flex-1">
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
                        <StatusBadge status={contestantDetails.availabilityStatus} />
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
              <div>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Medical Information</h3>
                <div className="space-y-3">
                  <div className="flex items-start gap-3">
                    <Heart className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground">Medical Conditions</label>
                      {contestantDetails.medicalInfo ? (
                        <p className="text-sm whitespace-pre-wrap mt-1">{contestantDetails.medicalInfo}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic mt-1">No medical information provided</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <Heart className="h-4 w-4 mt-0.5 text-muted-foreground" />
                    <div className="flex-1">
                      <label className="text-xs font-medium text-muted-foreground">Mobility/Access Notes</label>
                      {contestantDetails.mobilityNotes ? (
                        <p className="text-sm whitespace-pre-wrap mt-1">{contestantDetails.mobilityNotes}</p>
                      ) : (
                        <p className="text-sm text-muted-foreground italic mt-1">No mobility/access notes provided</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Criminal Record */}
              <div>
                <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Criminal Record</h3>
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    {contestantDetails.criminalRecord ? (
                      <p className="text-sm whitespace-pre-wrap">{contestantDetails.criminalRecord}</p>
                    ) : (
                      <p className="text-sm text-muted-foreground italic">No criminal record information provided</p>
                    )}
                  </div>
                </div>
              </div>
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
