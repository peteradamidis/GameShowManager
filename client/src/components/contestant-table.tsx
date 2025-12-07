import { useState, useRef, useEffect } from "react";
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
import { Search, Mail, Phone, MapPin, Heart, Camera, Upload, Trash2, User, Pencil, X, Save } from "lucide-react";
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
  medicalInfo?: string;
  mobilityNotes?: string;
  criminalRecord?: string;
  photoUrl?: string | null;
  auditionRating?: string | null;
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
  standbyContestantIds = new Set()
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const { data: contestantDetails } = useQuery<Contestant>({
    queryKey: ['/api/contestants', selectedContestantId],
    enabled: !!selectedContestantId && detailDialogOpen,
  });

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
  const [editFormData, setEditFormData] = useState<Partial<Contestant>>({});

  // Reset edit form when contestant details change
  useEffect(() => {
    if (contestantDetails) {
      setEditFormData({
        name: contestantDetails.name,
        age: contestantDetails.age,
        gender: contestantDetails.gender,
        email: contestantDetails.email || '',
        phone: contestantDetails.phone || '',
        location: contestantDetails.location || '',
        attendingWith: contestantDetails.attendingWith || '',
        medicalInfo: contestantDetails.medicalInfo || '',
        mobilityNotes: contestantDetails.mobilityNotes || '',
        criminalRecord: contestantDetails.criminalRecord || '',
        auditionRating: contestantDetails.auditionRating || '',
      });
    }
  }, [contestantDetails]);

  // Reset edit mode when dialog closes
  useEffect(() => {
    if (!detailDialogOpen) {
      setIsEditMode(false);
    }
  }, [detailDialogOpen]);

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
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
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
    },
  });

  const handleEditFormChange = (field: keyof Contestant, value: any) => {
    setEditFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSaveEdit = () => {
    updateContestantMutation.mutate(editFormData);
  };

  const handleCancelEdit = () => {
    if (contestantDetails) {
      setEditFormData({
        name: contestantDetails.name,
        age: contestantDetails.age,
        gender: contestantDetails.gender,
        email: contestantDetails.email || '',
        phone: contestantDetails.phone || '',
        location: contestantDetails.location || '',
        attendingWith: contestantDetails.attendingWith || '',
        medicalInfo: contestantDetails.medicalInfo || '',
        mobilityNotes: contestantDetails.mobilityNotes || '',
        criminalRecord: contestantDetails.criminalRecord || '',
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
              <TableHead className="w-16">Photo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Audition Rating</TableHead>
              <TableHead>Age</TableHead>
              <TableHead className="min-w-[150px]">Name</TableHead>
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
                  <TableCell>{contestant.location || "-"}</TableCell>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-testid="dialog-contestant-details">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <DialogTitle>{isEditMode ? 'Edit Contestant' : 'Contestant Details'}</DialogTitle>
                <DialogDescription>
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
                  
                  {/* Basic Info Edit */}
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
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <StatusBadge status={rescheduleContestantIds.has(contestantDetails.id) ? "Reschedule" : contestantDetails.availabilityStatus} />
                          {standbyContestantIds.has(contestantDetails.id) && (
                            <Badge variant="outline" className="border-yellow-300 bg-yellow-500/20 text-yellow-800 dark:border-yellow-700 dark:text-yellow-400">
                              Standby
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Audition Rating</label>
                        <p className={`text-sm mt-1 font-semibold ${
                          contestantDetails.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                          contestantDetails.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                          contestantDetails.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                          contestantDetails.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                          contestantDetails.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' : 'text-muted-foreground'
                        }`}>
                          {contestantDetails.auditionRating || 'Not rated'}
                        </p>
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
                      {selectedContestantId && seatAssignmentMap.get(selectedContestantId) && (
                        <div>
                          <label className="text-xs font-medium text-muted-foreground">Player Type</label>
                          <div className="mt-1">
                            <Select 
                              value={(seatAssignmentMap.get(selectedContestantId) as any)?.playerType || ''} 
                              onValueChange={(value) => {
                                updatePlayerTypeMutation.mutate(value);
                              }}
                            >
                              <SelectTrigger className="text-sm">
                                <SelectValue placeholder="Select type" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="player">Player</SelectItem>
                                <SelectItem value="backup">Backup</SelectItem>
                                <SelectItem value="player_partner">Player Partner</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contact Information */}
                {(contestantDetails.email || contestantDetails.phone || contestantDetails.location) && (
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
                      {contestantDetails.location && (
                        <div className="flex items-start gap-3">
                          <MapPin className="h-4 w-4 mt-0.5 text-muted-foreground" />
                          <div>
                            <label className="text-xs font-medium text-muted-foreground">Location</label>
                            <p className="text-sm mt-1">{contestantDetails.location}</p>
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
            )
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
