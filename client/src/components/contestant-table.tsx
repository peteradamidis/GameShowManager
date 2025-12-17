import { useState, useRef, useEffect, useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Mail, Phone, MapPin, Heart, Camera, Upload, Trash2, User, Pencil, X, Save, Calendar, AlertTriangle, Users, CalendarPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
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
  location?: string;
  postcode?: string | null;
  state?: string | null;
  medicalInfo?: string;
  mobilityNotes?: string;
  criminalRecord?: string;
  photoUrl?: string | null;
  auditionRating?: string | null;
  playerType?: string;
  groupSize?: number | null;
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
  searchTerm?: string;
  onSearchChange?: (term: string) => void;
  rescheduleContestantIds?: Set<string>;
  standbyContestantIds?: Set<string>;
  allContestants?: Contestant[];
  onBookWithGroup?: (contestantIds: string[]) => void;
  onDeleteContestant?: (contestantId: string) => void;
}

// Docklands, Melbourne coordinates
const DOCKLANDS_COORDS = { lat: -37.8150, lng: 144.9460 };

// Australian city coordinates (approximate city centers)
const CITY_COORDINATES: Record<string, { lat: number; lng: number }> = {
  "Melbourne": { lat: -37.8136, lng: 144.9631 },
  "Sydney": { lat: -33.8688, lng: 151.2093 },
  "Brisbane": { lat: -27.4698, lng: 153.0251 },
  "Perth": { lat: -31.9505, lng: 115.8605 },
  "Adelaide": { lat: -34.9285, lng: 138.6007 },
  "Canberra": { lat: -35.2809, lng: 149.1300 },
  "Hobart": { lat: -42.8821, lng: 147.3272 },
  "Darwin": { lat: -12.4634, lng: 130.8456 },
  "Geelong": { lat: -38.1499, lng: 144.3617 },
  "Ballarat": { lat: -37.5622, lng: 143.8503 },
  "Bendigo": { lat: -36.7570, lng: 144.2794 },
  "Frankston": { lat: -38.1433, lng: 145.1228 },
  "Dandenong": { lat: -37.9877, lng: 145.2149 },
  "Werribee": { lat: -37.9000, lng: 144.6600 },
  "Sunbury": { lat: -37.5778, lng: 144.7260 },
  "Melton": { lat: -37.6869, lng: 144.5788 },
  "Cranbourne": { lat: -38.0996, lng: 145.2834 },
  "Pakenham": { lat: -38.0711, lng: 145.4878 },
  "Mornington": { lat: -38.2193, lng: 145.0375 },
  "Warragul": { lat: -38.1618, lng: 145.9312 },
  "Traralgon": { lat: -38.1954, lng: 146.5415 },
  "Sale": { lat: -38.1067, lng: 147.0680 },
  "Bairnsdale": { lat: -37.8227, lng: 147.6108 },
  "Shepparton": { lat: -36.3833, lng: 145.4000 },
  "Wodonga": { lat: -36.1217, lng: 146.8883 },
  "Albury": { lat: -36.0737, lng: 146.9135 },
  "Wangaratta": { lat: -36.3578, lng: 146.3120 },
  "Mildura": { lat: -34.1840, lng: 142.1580 },
  "Horsham": { lat: -36.7107, lng: 142.1996 },
  "Warrnambool": { lat: -38.3818, lng: 142.4830 },
  "Hamilton": { lat: -37.7440, lng: 142.0220 },
  "Portland": { lat: -38.3433, lng: 141.6037 },
  "Echuca": { lat: -36.1310, lng: 144.7520 },
  "Swan Hill": { lat: -35.3378, lng: 143.5544 },
  "Bacchus Marsh": { lat: -37.6727, lng: 144.4385 },
  "Gisborne": { lat: -37.4900, lng: 144.5900 },
  "Kilmore": { lat: -37.3000, lng: 144.9500 },
  "Seymour": { lat: -37.0267, lng: 145.1392 },
  "Colac": { lat: -38.3400, lng: 143.5850 },
  "Torquay": { lat: -38.3300, lng: 144.3200 },
  "Ocean Grove": { lat: -38.2600, lng: 144.5200 },
  "Lorne": { lat: -38.5417, lng: 143.9750 },
  "Apollo Bay": { lat: -38.7600, lng: 143.6700 },
};

// Calculate distance between two coordinates using Haversine formula
function calculateDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Get distance from Docklands for a city name
function getDistanceFromDocklands(location: string | undefined | null): { distance: number; isOver60km: boolean } | null {
  if (!location) return null;
  
  // Try to find a matching city (case-insensitive, partial match)
  const locationLower = location.toLowerCase().trim();
  for (const [city, coords] of Object.entries(CITY_COORDINATES)) {
    if (locationLower.includes(city.toLowerCase()) || city.toLowerCase().includes(locationLower)) {
      const distance = calculateDistanceKm(DOCKLANDS_COORDS.lat, DOCKLANDS_COORDS.lng, coords.lat, coords.lng);
      return { distance: Math.round(distance), isOver60km: distance > 60 };
    }
  }
  return null;
}

const StatusBadge = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    pending: "border-amber-200 bg-amber-500/10 text-amber-700 dark:border-amber-800 dark:text-amber-400",
    available: "border-green-200 bg-green-500/10 text-green-700 dark:border-green-800 dark:text-green-400",
    assigned: "border-blue-200 bg-blue-500/10 text-blue-700 dark:border-blue-800 dark:text-blue-400",
    invited: "border-purple-200 bg-purple-500/10 text-purple-700 dark:border-purple-800 dark:text-purple-400",
    reschedule: "border-yellow-300 bg-yellow-500/20 text-yellow-800 dark:border-yellow-700 dark:text-yellow-400",
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
  seatAssignments = [],
  searchTerm: externalSearchTerm,
  onSearchChange,
  rescheduleContestantIds = new Set(),
  standbyContestantIds = new Set(),
  allContestants,
  onBookWithGroup,
  onDeleteContestant
}: ContestantTableProps) {
  // Create a map for quick lookup of seat assignments by contestant ID
  // Use the most recent assignment if multiple exist
  const seatAssignmentMap = new Map<string, SeatAssignment>();
  seatAssignments.forEach(sa => {
    seatAssignmentMap.set(sa.contestantId, sa);
  });
  
  // Use external search state if provided, otherwise use local state
  const [localSearchTerm, setLocalSearchTerm] = useState("");
  const searchTerm = externalSearchTerm !== undefined ? externalSearchTerm : localSearchTerm;
  const setSearchTerm = onSearchChange || setLocalSearchTerm;
  const [selectedContestantId, setSelectedContestantId] = useState<string | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadingContestantId, setUploadingContestantId] = useState<string | null>(null);
  const [selectedPlayerType, setSelectedPlayerType] = useState<string>("");
  const [groupPreviewOpen, setGroupPreviewOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmContestantId, setDeleteConfirmContestantId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: contestantDetails } = useQuery<Contestant>({
    queryKey: ['/api/contestants', selectedContestantId],
    enabled: !!selectedContestantId && detailDialogOpen,
  });

  // Find group members for the selected contestant
  // Uses groupId if available, otherwise matches by attendingWith names
  // Falls back to contestants prop if allContestants not provided
  // Filters to only include eligible contestants (not already assigned via status or seat assignments)
  const groupMembers = useMemo(() => {
    if (!contestantDetails) return [];
    const contestantPool = allContestants || contestants;
    
    // If contestant has a groupId, use that to find group members
    if (contestantDetails.groupId) {
      return contestantPool.filter(c => 
        c.groupId === contestantDetails.groupId &&
        c.availabilityStatus !== 'Assigned' &&
        !seatAssignmentMap.has(c.id)
      );
    }
    
    // Otherwise, try to find group by matching attendingWith names
    if (contestantDetails.attendingWith) {
      const attendingNames = contestantDetails.attendingWith.split(',').map(n => n.trim().toLowerCase());
      const currentName = contestantDetails.name.toLowerCase();
      
      // Find people this person is attending with
      const groupMemberSet = new Set<string>([contestantDetails.id]);
      
      contestantPool.forEach(c => {
        if (c.id === contestantDetails.id) return;
        
        // Check if this person's name is in the selected contestant's attendingWith
        const nameMatch = attendingNames.some(name => c.name.toLowerCase().includes(name) || name.includes(c.name.toLowerCase()));
        if (nameMatch) {
          groupMemberSet.add(c.id);
        }
        
        // Check if selected contestant's name is in this person's attendingWith
        if (c.attendingWith) {
          const theirAttending = c.attendingWith.split(',').map(n => n.trim().toLowerCase());
          const reverseMatch = theirAttending.some(name => currentName.includes(name) || name.includes(currentName));
          if (reverseMatch) {
            groupMemberSet.add(c.id);
          }
        }
      });
      
      // Return eligible group members
      return contestantPool.filter(c => 
        groupMemberSet.has(c.id) &&
        c.availabilityStatus !== 'Assigned' &&
        !seatAssignmentMap.has(c.id)
      );
    }
    
    return [];
  }, [contestantDetails, allContestants, contestants, seatAssignmentMap]);

  // Fetch record days to show seat assignment date
  interface RecordDay {
    id: string;
    date: string;
    status: string;
  }
  const { data: recordDays = [] } = useQuery<RecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  // Get seat assignment for the selected contestant
  const tempSelectedContestantSeatAssignment = selectedContestantId 
    ? seatAssignmentMap.get(selectedContestantId) 
    : null;
  
  // Fetch block types for the seat assignment's record day
  interface BlockType {
    id: string;
    recordDayId: string;
    blockNumber: number;
    blockType: 'PB' | 'NPB';
  }
  const { data: blockTypes = [] } = useQuery<BlockType[]>({
    queryKey: ['/api/record-days', tempSelectedContestantSeatAssignment?.recordDayId, 'block-types'],
    enabled: !!tempSelectedContestantSeatAssignment?.recordDayId && detailDialogOpen,
  });

  // Get seat assignment for the selected contestant
  const selectedContestantSeatAssignment = selectedContestantId 
    ? seatAssignmentMap.get(selectedContestantId) 
    : null;
  
  // Get record day info for the seat assignment
  const seatAssignmentRecordDay = selectedContestantSeatAssignment
    ? recordDays.find(rd => rd.id === selectedContestantSeatAssignment.recordDayId)
    : null;

  const uploadPhotoMutation = useMutation({
    mutationFn: async ({ file, contestantId }: { file: File; contestantId: string }) => {
      const formData = new FormData();
      formData.append('photo', file);
      
      const response = await fetch(`/api/contestants/${contestantId}/photo`, {
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
      setUploadingContestantId(null);
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

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState<Partial<Contestant> & { playerType?: string }>({});

  // Reset edit form when contestant details change
  useEffect(() => {
    if (contestantDetails && selectedContestantId) {
      const assignment = seatAssignmentMap.get(selectedContestantId);
      setEditFormData({
        name: contestantDetails.name,
        age: contestantDetails.age,
        gender: contestantDetails.gender,
        email: contestantDetails.email || '',
        phone: contestantDetails.phone || '',
        location: contestantDetails.location || '',
        attendingWith: contestantDetails.attendingWith || '',
        groupSize: contestantDetails.groupSize,
        medicalInfo: contestantDetails.medicalInfo || '',
        mobilityNotes: contestantDetails.mobilityNotes || '',
        criminalRecord: contestantDetails.criminalRecord || '',
        auditionRating: contestantDetails.auditionRating || '',
        playerType: (assignment as any)?.playerType || '',
      });
    }
  }, [contestantDetails, selectedContestantId]);

  // Reset edit mode when dialog closes and set player type
  useEffect(() => {
    if (!detailDialogOpen) {
      setIsEditMode(false);
    } else if (selectedContestantId) {
      // Set initial player type when dialog opens
      const assignment = seatAssignmentMap.get(selectedContestantId);
      setSelectedPlayerType((assignment as any)?.playerType || "");
    }
  }, [detailDialogOpen, selectedContestantId]);

  const updateContestantMutation = useMutation({
    mutationFn: async (data: Partial<Contestant>) => {
      return apiRequest('PATCH', `/api/contestants/${selectedContestantId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      setIsEditMode(false);
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

  const updatePlayerTypeMutation = useMutation({
    mutationFn: async (playerType: string) => {
      const currentAssignment = seatAssignmentMap.get(selectedContestantId!);
      if (!currentAssignment) throw new Error('No seat assignment found');
      return apiRequest('PATCH', `/api/seat-assignments/${currentAssignment.id}/player-type`, { playerType });
    },
    onSuccess: () => {
      // Invalidate all seat assignment queries (exact and partial matches)
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({
        title: "Player type updated",
        description: "Player type has been updated successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive",
      });
      // Reset on error
      const assignment = seatAssignmentMap.get(selectedContestantId!);
      setSelectedPlayerType((assignment as any)?.playerType || "");
    },
  });

  const handleEditFormChange = (field: string, value: any) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = async () => {
    // Save contestant data including playerType to the contestants table
    await updateContestantMutation.mutateAsync(editFormData);
    
    // Also update seat assignment if one exists
    if (selectedContestantId && editFormData.playerType) {
      const assignment = seatAssignmentMap.get(selectedContestantId);
      if (assignment && (assignment as any).playerType !== editFormData.playerType) {
        updatePlayerTypeMutation.mutate(editFormData.playerType);
      }
    }
  };

  const handleCancelEdit = () => {
    if (contestantDetails && selectedContestantId) {
      const assignment = seatAssignmentMap.get(selectedContestantId);
      setEditFormData({
        name: contestantDetails.name,
        age: contestantDetails.age,
        gender: contestantDetails.gender,
        email: contestantDetails.email || '',
        phone: contestantDetails.phone || '',
        location: contestantDetails.location || '',
        attendingWith: contestantDetails.attendingWith || '',
        groupSize: contestantDetails.groupSize,
        medicalInfo: contestantDetails.medicalInfo || '',
        mobilityNotes: contestantDetails.mobilityNotes || '',
        criminalRecord: contestantDetails.criminalRecord || '',
        auditionRating: contestantDetails.auditionRating || '',
        playerType: (assignment as any)?.playerType || '',
      });
    }
    setIsEditMode(false);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && selectedContestantId) {
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
      uploadPhotoMutation.mutate({ file, contestantId: selectedContestantId });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTablePhotoUpload = (contestantId: string) => {
    setUploadingContestantId(contestantId);
    tableFileInputRef.current?.click();
  };

  const handleTableFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadingContestantId) {
      if (!file.type.startsWith('image/')) {
        toast({
          title: "Invalid file type",
          description: "Please select an image file (JPEG, PNG, etc.)",
          variant: "destructive",
        });
        setUploadingContestantId(null);
        return;
      }
      
      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: "File too large",
          description: "Please select an image smaller than 5MB",
          variant: "destructive",
        });
        setUploadingContestantId(null);
        return;
      }
      
      uploadPhotoMutation.mutate({ file, contestantId: uploadingContestantId });
    }
    if (tableFileInputRef.current) {
      tableFileInputRef.current.value = '';
    }
  };

  // When search is controlled externally, parent already filters contestants
  // Only apply local filtering when using internal search state
  const filteredContestants = externalSearchTerm !== undefined
    ? contestants  // Parent already filtered
    : contestants.filter((contestant) => {
        const search = localSearchTerm.toLowerCase();
        return (
          contestant.name.toLowerCase().includes(search) ||
          (contestant.attendingWith?.toLowerCase().includes(search) ?? false)
        );
      });

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
      <input
        ref={tableFileInputRef}
        type="file"
        accept="image/*"
        onChange={handleTableFileChange}
        className="hidden"
        data-testid="input-table-photo-upload"
      />
      <div className="border rounded-md overflow-x-auto">
        <Table className="min-w-[1200px]">
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
              <TableHead className="w-16">Photo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Audition Rating</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="min-w-[150px]">Name</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Attending With</TableHead>
              <TableHead>Group Size</TableHead>
              <TableHead>City</TableHead>
              <TableHead className="max-w-[100px]">Medical</TableHead>
              <TableHead className="max-w-[100px]">Mobility</TableHead>
              <TableHead className="max-w-[100px]">Criminal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredContestants.map((contestant) => {
              const seatAssignment = seatAssignmentMap.get(contestant.id);
              const isUploadingThis = uploadingContestantId === contestant.id && uploadPhotoMutation.isPending;
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
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <div 
                      className="relative group cursor-pointer"
                      onClick={() => handleTablePhotoUpload(contestant.id)}
                    >
                      <Avatar className="h-12 w-12">
                        {contestant.photoUrl ? (
                          <AvatarImage 
                            src={contestant.photoUrl} 
                            alt={contestant.name}
                            className="object-cover"
                          />
                        ) : null}
                        <AvatarFallback className="text-sm">
                          {isUploadingThis ? (
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          ) : (
                            contestant.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                          )}
                        </AvatarFallback>
                      </Avatar>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <Camera className="h-4 w-4 text-white" />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="space-x-2 flex items-center flex-wrap gap-2">
                    <StatusBadge status={rescheduleContestantIds.has(contestant.id) ? "Reschedule" : contestant.availabilityStatus} />
                    {standbyContestantIds.has(contestant.id) && (
                      <Badge variant="outline" className="border-yellow-300 bg-yellow-500/20 text-yellow-800 dark:border-yellow-700 dark:text-yellow-400">
                        Standby
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {contestant.auditionRating ? (
                      <span className={`font-semibold ${
                        contestant.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                        contestant.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                        contestant.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                        contestant.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                        contestant.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' : ''
                      }`}>
                        {contestant.auditionRating}
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell>{contestant.age}</TableCell>
                  <TableCell className="font-medium">{contestant.name}</TableCell>
                  <TableCell>{contestant.phone || "-"}</TableCell>
                  <TableCell>{contestant.email || "-"}</TableCell>
                  <TableCell>{contestant.attendingWith || "-"}</TableCell>
                  <TableCell>
                    {contestant.groupSize != null ? contestant.groupSize : "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <span>{contestant.location || "-"}</span>
                      {(() => {
                        const distanceInfo = getDistanceFromDocklands(contestant.location);
                        if (distanceInfo?.isOver60km) {
                          return (
                            <span 
                              className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-yellow-200/50 text-yellow-600 dark:bg-yellow-900/30 dark:text-yellow-500 text-xs font-bold flex-shrink-0" 
                              title={`${distanceInfo.distance}km from Docklands`}
                              data-testid={`icon-distance-warning-${contestant.id}`}
                            >
                              !
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate text-xs" title={contestant.medicalInfo || ""}>
                    {contestant.medicalInfo || "-"}
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate text-xs" title={contestant.mobilityNotes || ""}>
                    {contestant.mobilityNotes || "-"}
                  </TableCell>
                  <TableCell className="max-w-[100px] truncate text-xs" title={contestant.criminalRecord || ""}>
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
        <DialogContent className="max-w-4xl" data-testid="dialog-contestant-details">
          <DialogHeader className="pb-2">
            <div className="flex items-center justify-between gap-4">
              <div>
                <DialogTitle className="text-base">{isEditMode ? 'Edit Contestant' : 'Contestant Details'}</DialogTitle>
                <DialogDescription className="text-xs">
                  {isEditMode ? 'Update contestant information' : `Complete information for ${contestantDetails?.name || "this contestant"}`}
                </DialogDescription>
              </div>
              {contestantDetails && !isEditMode && (
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

          {contestantDetails ? (
            isEditMode ? (
              <div className="space-y-6">
                {/* Photo Section */}
                <div className="flex gap-6">
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
                      >
                        {isUploading ? 'Uploading...' : 'Upload'}
                      </Button>
                      {contestantDetails.photoUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => deletePhotoMutation.mutate()}
                          disabled={deletePhotoMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  
                  {/* Basic Info Edit - Compact */}
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-name" className="text-xs">Name</Label>
                        <Input
                          id="edit-name"
                          value={editFormData.name || ''}
                          onChange={(e) => handleEditFormChange('name', e.target.value)}
                          data-testid="input-edit-name"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-age" className="text-xs">Age</Label>
                        <Input
                          id="edit-age"
                          type="number"
                          value={editFormData.age || ''}
                          onChange={(e) => handleEditFormChange('age', parseInt(e.target.value) || 0)}
                          data-testid="input-edit-age"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-gender" className="text-xs">Gender</Label>
                        <Select 
                          value={editFormData.gender || ''} 
                          onValueChange={(value) => handleEditFormChange('gender', value)}
                        >
                          <SelectTrigger data-testid="select-edit-gender" className="h-8 text-xs">
                            <SelectValue placeholder="Gender" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Male">Male</SelectItem>
                            <SelectItem value="Female">Female</SelectItem>
                            <SelectItem value="Other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-attending" className="text-xs">Attending With</Label>
                        <Input
                          id="edit-attending"
                          value={editFormData.attendingWith || ''}
                          onChange={(e) => handleEditFormChange('attendingWith', e.target.value)}
                          data-testid="input-edit-attending"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-group-size" className="text-xs">Group Size</Label>
                        <Select 
                          value={editFormData.groupSize != null ? String(editFormData.groupSize) : 'undefined'} 
                          onValueChange={(value) => handleEditFormChange('groupSize', value === 'undefined' ? null : parseInt(value))}
                        >
                          <SelectTrigger data-testid="select-edit-group-size" className="h-8 text-xs">
                            <SelectValue placeholder="Size" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="undefined">Undefined</SelectItem>
                            <SelectItem value="1">1 (Solo)</SelectItem>
                            <SelectItem value="2">2 (Pair)</SelectItem>
                            <SelectItem value="3">3</SelectItem>
                            <SelectItem value="4">4</SelectItem>
                            <SelectItem value="5">5+</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-rating" className="text-xs">Score</Label>
                        <Select 
                          value={editFormData.auditionRating || ''} 
                          onValueChange={(value) => handleEditFormChange('auditionRating', value)}
                        >
                          <SelectTrigger data-testid="select-edit-rating" className="h-8 text-xs">
                            <SelectValue placeholder="Score" />
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
                      <div className="space-y-1">
                        <Label htmlFor="edit-player-type" className="text-xs">Player Type</Label>
                        <Select 
                          value={editFormData.playerType || ''} 
                          onValueChange={(value) => handleEditFormChange('playerType', value)}
                        >
                          <SelectTrigger data-testid="select-edit-player-type" className="h-8 text-xs">
                            <SelectValue placeholder="Type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="player">Player</SelectItem>
                            <SelectItem value="backup">Backup</SelectItem>
                            <SelectItem value="player_partner">Partner</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-email" className="text-xs">Email</Label>
                        <Input
                          id="edit-email"
                          type="email"
                          value={editFormData.email || ''}
                          onChange={(e) => handleEditFormChange('email', e.target.value)}
                          data-testid="input-edit-email"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-phone" className="text-xs">Phone</Label>
                        <Input
                          id="edit-phone"
                          value={editFormData.phone || ''}
                          onChange={(e) => handleEditFormChange('phone', e.target.value)}
                          data-testid="input-edit-phone"
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-location" className="text-xs">Location</Label>
                        <Input
                          id="edit-location"
                          value={editFormData.location || ''}
                          onChange={(e) => handleEditFormChange('location', e.target.value)}
                          data-testid="input-edit-location"
                          className="h-8"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label htmlFor="edit-medical" className="text-xs">Medical Conditions</Label>
                        <Textarea
                          id="edit-medical"
                          value={editFormData.medicalInfo || ''}
                          onChange={(e) => handleEditFormChange('medicalInfo', e.target.value)}
                          rows={2}
                          data-testid="input-edit-medical"
                          className="text-xs"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor="edit-mobility" className="text-xs">Mobility/Access Notes</Label>
                        <Textarea
                          id="edit-mobility"
                          value={editFormData.mobilityNotes || ''}
                          onChange={(e) => handleEditFormChange('mobilityNotes', e.target.value)}
                          rows={2}
                          data-testid="input-edit-mobility"
                          className="text-xs"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-criminal" className="text-xs">Criminal Record</Label>
                      <Textarea
                        id="edit-criminal"
                        value={editFormData.criminalRecord || ''}
                        onChange={(e) => handleEditFormChange('criminalRecord', e.target.value)}
                        rows={2}
                        data-testid="input-edit-criminal"
                        className="text-xs"
                      />
                    </div>
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
              <div className="space-y-3">
                {/* Photo and Basic Info Header */}
                <div className="flex gap-4">
                  {/* Photo Section - Compact */}
                  <div className="flex flex-col items-center gap-1">
                    <div className="relative group">
                      <Avatar className="h-16 w-16 border-2 border-border">
                        {contestantDetails.photoUrl ? (
                          <AvatarImage 
                            src={contestantDetails.photoUrl} 
                            alt={contestantDetails.name}
                            className="object-cover"
                          />
                        ) : null}
                        <AvatarFallback className="text-lg bg-muted">
                          <User className="h-7 w-7 text-muted-foreground" />
                        </AvatarFallback>
                      </Avatar>
                      <div 
                        className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Camera className="h-4 w-4 text-white" />
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
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading || uploadPhotoMutation.isPending}
                        data-testid="button-upload-photo"
                      >
                        {isUploading ? '...' : <Upload className="h-3 w-3" />}
                      </Button>
                      {contestantDetails.photoUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-xs"
                          onClick={() => deletePhotoMutation.mutate()}
                          disabled={deletePhotoMutation.isPending}
                          data-testid="button-delete-photo"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Basic Information - 4 columns */}
                  <div className="flex-1">
                    <div className="grid grid-cols-4 gap-x-4 gap-y-2">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Name</label>
                        <p className="text-sm font-medium">{contestantDetails.name}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Age</label>
                        <p className="text-sm">{contestantDetails.age}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Gender</label>
                        <p className="text-sm">{contestantDetails.gender}</p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Status</label>
                        <div className="flex items-center gap-1 flex-wrap">
                          <StatusBadge status={rescheduleContestantIds.has(contestantDetails.id) ? "Reschedule" : contestantDetails.availabilityStatus} />
                          {standbyContestantIds.has(contestantDetails.id) && (
                            <Badge variant="outline" className="border-yellow-300 bg-yellow-500/20 text-yellow-800 dark:border-yellow-700 dark:text-yellow-400 text-xs py-0">
                              Standby
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Rating</label>
                        <p className={`text-sm font-semibold ${
                          contestantDetails.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                          contestantDetails.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                          contestantDetails.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                          contestantDetails.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                          contestantDetails.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'
                        }`}>
                          {contestantDetails.auditionRating || '-'}
                        </p>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Player Type</label>
                        <div>
                          {contestantDetails.playerType ? (
                            <Badge className={`text-xs py-0 ${
                              contestantDetails.playerType === 'player' ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800' :
                              contestantDetails.playerType === 'backup' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800' :
                              contestantDetails.playerType === 'player_partner' ? 'bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800' :
                              'bg-gray-500/20 text-gray-700 dark:text-gray-400 border-gray-200 dark:border-gray-800'
                            }`}>
                              {contestantDetails.playerType === 'player' ? 'Player' :
                               contestantDetails.playerType === 'backup' ? 'Backup' :
                               contestantDetails.playerType === 'player_partner' ? 'Partner' :
                               contestantDetails.playerType}
                            </Badge>
                          ) : (
                            <span className="text-sm text-muted-foreground">-</span>
                          )}
                        </div>
                      </div>
                      {contestantDetails.attendingWith && (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Attending With</label>
                          <p className="text-sm">{contestantDetails.attendingWith}</p>
                        </div>
                      )}
                      {contestantDetails.groupId && (
                        <div className="overflow-hidden">
                          <label className="text-xs font-medium text-muted-foreground">Group ID</label>
                          <Badge variant="outline" className="font-mono text-xs max-w-full truncate inline-block py-0" title={contestantDetails.groupId}>
                            {contestantDetails.groupId}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Seat Assignment - Compact inline */}
                {selectedContestantSeatAssignment && (
                  <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                        <Calendar className="h-4 w-4" />
                        <span className="text-xs font-semibold uppercase">Seat Assignment</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm">
                        <span><span className="text-xs text-muted-foreground mr-1">Day:</span><span className="font-medium">{seatAssignmentRecordDay ? new Date(seatAssignmentRecordDay.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : 'Unknown'}</span></span>
                        <span className="flex items-center gap-1.5">
                          <span className="text-xs text-muted-foreground">Block:</span>
                          <span className="font-medium">{selectedContestantSeatAssignment.blockNumber}</span>
                          {(() => {
                            const blockType = blockTypes.find(bt => bt.blockNumber === selectedContestantSeatAssignment.blockNumber);
                            if (blockType) {
                              return (
                                <Badge 
                                  variant="outline" 
                                  className={`text-xs py-0 px-1.5 ${
                                    blockType.blockType === 'PB' 
                                      ? 'border-emerald-300 bg-emerald-500/20 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400' 
                                      : 'border-slate-300 bg-slate-500/20 text-slate-700 dark:border-slate-600 dark:text-slate-400'
                                  }`}
                                  data-testid={`badge-block-type-${blockType.blockType}`}
                                >
                                  {blockType.blockType}
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                        </span>
                        <span><span className="text-xs text-muted-foreground mr-1">Seat:</span><span className="font-mono font-medium text-green-600 dark:text-green-400">{String(selectedContestantSeatAssignment.blockNumber).padStart(2, '0')}-{selectedContestantSeatAssignment.seatLabel}</span></span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Contact & Medical in 2 columns */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Contact Information */}
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contact</h3>
                    <div className="space-y-1 text-sm">
                      {contestantDetails.email && (
                        <div className="flex items-center gap-2">
                          <Mail className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span className="truncate">{contestantDetails.email}</span>
                        </div>
                      )}
                      {contestantDetails.phone && (
                        <div className="flex items-center gap-2">
                          <Phone className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span>{contestantDetails.phone}</span>
                        </div>
                      )}
                      {contestantDetails.location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                          <span>{contestantDetails.location}</span>
                          {(() => {
                            const distanceInfo = getDistanceFromDocklands(contestantDetails.location);
                            if (distanceInfo?.isOver60km) {
                              return (
                                <Badge 
                                  variant="outline" 
                                  className="border-orange-300 bg-orange-500/20 text-orange-700 dark:border-orange-700 dark:text-orange-400 text-xs py-0"
                                  data-testid="badge-distance-warning"
                                >
                                  <AlertTriangle className="h-3 w-3 mr-1" />
                                  {distanceInfo.distance}km
                                </Badge>
                              );
                            }
                            return null;
                          })()}
                        </div>
                      )}
                      {!contestantDetails.email && !contestantDetails.phone && !contestantDetails.location && (
                        <p className="text-muted-foreground italic text-xs">No contact info</p>
                      )}
                    </div>
                  </div>

                  {/* Medical Information */}
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Medical</h3>
                    <div className="space-y-1 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground">Conditions: </span>
                        <span className={contestantDetails.medicalInfo ? '' : 'text-muted-foreground italic'}>
                          {contestantDetails.medicalInfo || 'None'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Mobility: </span>
                        <span className={contestantDetails.mobilityNotes ? '' : 'text-muted-foreground italic'}>
                          {contestantDetails.mobilityNotes || 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Criminal Record - Compact */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Criminal Record</h3>
                  <p className={`text-sm ${contestantDetails.criminalRecord ? '' : 'text-muted-foreground italic'}`}>
                    {contestantDetails.criminalRecord || 'No criminal record information provided'}
                  </p>
                </div>

                {/* Non-edit Mode Footer with Delete Button */}
                <div className="flex justify-end gap-2 border-t pt-4 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDetailDialogOpen(false)}
                    data-testid="button-close-detail-dialog"
                  >
                    Close
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      if (selectedContestantId) {
                        setDeleteConfirmContestantId(selectedContestantId);
                        setDeleteConfirmOpen(true);
                      }
                    }}
                    data-testid="button-delete-contestant-detail"
                    className="text-destructive-foreground"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Contestant
                  </Button>
                </div>
              </div>
            )
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Loading contestant details...
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Confirm Delete
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to permanently delete {contestantDetails?.name}? This action cannot be undone and will remove all associated data.
            </DialogDescription>
          </DialogHeader>
          
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              data-testid="button-cancel-delete"
            >
              Cancel
            </Button>
            <Button 
              variant="destructive"
              onClick={() => {
                if (deleteConfirmContestantId && onDeleteContestant) {
                  onDeleteContestant(deleteConfirmContestantId);
                  setDetailDialogOpen(false);
                  setDeleteConfirmOpen(false);
                }
              }}
              data-testid="button-confirm-delete"
            >
              <AlertTriangle className="h-4 w-4 mr-1" />
              Delete Permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Group Preview Dialog */}
      <Dialog open={groupPreviewOpen} onOpenChange={setGroupPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Book Group Together
            </DialogTitle>
            <DialogDescription>
              Review group members before booking them to a record day
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-3">
            <div className="text-sm text-muted-foreground">
              The following {groupMembers.length} contestants will be booked together:
            </div>
            
            <div className="border rounded-md divide-y max-h-64 overflow-y-auto">
              {groupMembers.map((member, index) => (
                <div 
                  key={member.id} 
                  className="flex items-center gap-3 p-3"
                  data-testid={`group-member-${member.id}`}
                >
                  <Avatar className="h-10 w-10">
                    {member.photoUrl ? (
                      <AvatarImage src={member.photoUrl} alt={member.name} className="object-cover" />
                    ) : null}
                    <AvatarFallback className="text-xs">
                      {member.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{member.name}</span>
                      {member.id === selectedContestantId && (
                        <Badge variant="outline" className="text-xs py-0">Current</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{member.gender}</span>
                      <span>•</span>
                      <span>{member.age} yrs</span>
                      {member.auditionRating && (
                        <>
                          <span>•</span>
                          <span className="font-medium">{member.auditionRating}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={member.availabilityStatus} />
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setGroupPreviewOpen(false)}
              data-testid="button-cancel-group-booking"
            >
              Cancel
            </Button>
            <Button 
              onClick={() => {
                if (onBookWithGroup) {
                  const memberIds = groupMembers.map(m => m.id);
                  onBookWithGroup(memberIds);
                  setGroupPreviewOpen(false);
                  setDetailDialogOpen(false);
                }
              }}
              className="gap-1"
              data-testid="button-confirm-group-booking"
            >
              <CalendarPlus className="h-4 w-4" />
              Assign to Record Day
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
