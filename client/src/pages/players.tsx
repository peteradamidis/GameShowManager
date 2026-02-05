import { useQuery, useMutation, useQueries } from "@tanstack/react-query";
import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { getPartnerNames, attendingWithMentionsName } from "@shared/attendingWithParser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import dondLogo from "@assets/dond-logo.png";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { User, Users, Play, Phone, PhoneCall, PhoneOff, Mail, MapPin, Upload, FileText, X, GripVertical, Calendar, Search, Filter, Star, Trash2, CheckCircle2, Clock, Send, Plus, Download, CreditCard, Circle, ArrowDown, Maximize2, Minimize2, Bold, Italic, Underline, Printer, ZoomIn, ZoomOut, RotateCcw, ChevronUp, ChevronDown, AlertTriangle, RefreshCw, Undo2, Redo2, History, Eye, EyeOff, PanelTop, MessageSquare, Check } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Link2 } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface RecordDay {
  id: string;
  date: string;
  rxNumber: string;
  isLocked: boolean;
}

interface SeatAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  blockNumber: number;
  seatLabel: string;
  playerType: string | null;
  rxEpNumber: string | null;
  bookingConfirmationStatus: string | null;
  castingCardUrl: string | null;
  called: boolean | null;
  calledAt: string | null;
  bookingEmailSent: string | null;
  confirmedRsvp: string | null;
  contestant: {
    id: string;
    firstName: string;
    lastName: string;
    gender: string;
    age: number | null;
    phone: string | null;
    email: string | null;
    rating: string | null;
    suburb: string | null;
    medicalMobilityNotes: string | null;
    attendingWith: string | null;
    photoUrl: string | null;
    availabilityStatus: string | null;
  } | null;
  medicalMobilityNotesOverride?: string | null;
  attendingWithOverride?: string | null;
}

interface Contestant {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  gender: string;
  age: number | null;
  phone: string | null;
  email: string | null;
  auditionRating: string | null;
  suburb: string | null;
  location: string | null;
  postcode: string | null;
  medicalMobilityNotes: string | null;
  attendingWith: string | null;
  photoUrl: string | null;
  groupId: string | null;
}

interface EpisodeGroup {
  episodeNumber: string;
  players: SeatAssignment[];
  backups: SeatAssignment[];
}

// RX Planning types - stored in localStorage only (visual planning tool)
interface PlannedContestant {
  id: string;
  name: string;
  gender: string;
  age: number | null;
  rating: string | null;
  location: string | null;
  phone: string | null;
  email: string | null;
  photoUrl: string | null;
  attendingWith: string | null;
  isCustom?: boolean; // For manually entered names not in the contestant list
  note?: string; // Planning notes for this contestant
}

interface RXPlanningData {
  [recordDayId: string]: {
    blocks: {
      [blockNumber: string]: PlannedContestant[];
    };
  };
}

interface BlockTypeData {
  id?: string;
  recordDayId: string;
  blockNumber: number;
  blockType: 'PB' | 'NPB';
}

const PLANNING_STORAGE_KEY = 'rx-planning-data-v2';

// Helper function to check if a field has meaningful content (not NA/N/A/No/empty)
const hasMeaningfulValue = (value: string | undefined | null): boolean => {
  if (!value) return false;
  const trimmed = value.trim().toUpperCase();
  return trimmed !== '' && trimmed !== 'NA' && trimmed !== 'N/A' && trimmed !== 'N / A' && trimmed !== 'NO';
};

// Manual companion interface
interface ManualCompanion {
  id: string;
  name: string;
  relationship: string;
  photoUrl: string | null;
}

// Casting Card interface
interface CastingCardData {
  id?: string;
  contestantId: string;
  fullName?: string | null;
  ageState?: string | null;
  occupation?: string | null;
  sponsorCategory?: string | null;
  tagline?: string | null;
  energyLevel?: string | null;
  characterTraits?: string | null;
  meetStory?: string | null;
  keyStories?: string | null;
  prizeGoalHigh?: string | null;
  prizeGoalLow?: string | null;
  howMuchToWin?: string | null;
  playStyle?: string | null;
  previousShows?: string | null;
  bulletPoints?: string[] | null;
  // Single body text block (replaces individual bullet points for easier editing)
  bodyText?: string | null;
  companionName?: string | null;
  companionRelationship?: string | null;
  companionPhotoUrl?: string | null;
  producerName?: string | null;
  showProducer?: boolean;
  showTagline?: boolean;
  showSponsorCategory?: boolean;
  // Position offsets for draggable elements
  ageStateOffsetY?: number | null;
  occupationOffsetY?: number | null;
  taglineOffsetY?: number | null;
  bodyOffsetY?: number | null;
  // Manual companions (up to 4)
  manualCompanions?: ManualCompanion[] | null;
  useManualCompanions?: boolean;
  // Card status
  isReady?: boolean; // RX Ready
  isDraftComplete?: boolean; // Draft Complete
  // Main photo override (base64) - only affects casting card, not contestant record
  mainPhotoOverride?: string | null;
  // Main photo positioning and zoom
  mainPhotoZoom?: number | null;
  mainPhotoOffsetX?: number | null;
  mainPhotoOffsetY?: number | null;
  mainPhotoRotation?: number | null;
  // Font sizes for age/state and occupation
  fontSizeAgeState?: number | null;
  fontSizeOccupation?: number | null;
  fontSizeName?: number | null;
}

// Default bullet points for new casting cards
const defaultBulletPoints = [
  'Energy Level – 3 out of 5 – this helps us when booking players for later in the day',
  'Top line character points – we don\'t need to know if they are "bubbly/energetic/likable" as it doesn\'t really help. But if they have traits like – they just don\'t stop talking / they argue with their podium partner as they\'re bossy etc / infectious or funny laugh. That is stuff we can work with in an episode.',
  'Meet story (if applicable)',
  '3 key stories/facts/interesting points',
  'How much they want to win - $XX,XXX',
  'What they\'d do with prize money (high and low) - 100K and if they win only $1000',
  'How they might play game / Risk taker?',
  'Other game shows / prize money won / previously on DOND'
];

// Default body text for new casting cards (single block format)
const defaultBodyText = `• Energy Level – 3 out of 5 – this helps us when booking players for later in the day
• Top line character points – we don't need to know if they are "bubbly/energetic/likable" as it doesn't really help. But if they have traits like – they just don't stop talking / they argue with their podium partner as they're bossy etc / infectious or funny laugh. That is stuff we can work with in an episode.
• Meet story (if applicable)
• 3 key stories/facts/interesting points
• How much they want to win - $XX,XXX
• What they'd do with prize money (high and low) - 100K and if they win only $1000
• How they might play game / Risk taker?
• Other game shows / prize money won / previously on DOND`;

// Safe render wrapper to catch errors and prevent white screen
// Proper React Error Boundary class component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode; onError?: (error: Error) => void },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode; onError?: (error: Error) => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    this.props.onError?.(error);
  }

  render() {
    if (this.state.hasError) {
      return <>{this.props.fallback}</>;
    }
    return <>{this.props.children}</>;
  }
}

// Wrapper function for ErrorBoundary
function SafeRender({ children, fallback, onError }: { 
  children: React.ReactNode; 
  fallback: React.ReactNode;
  onError?: (error: Error) => void;
}) {
  return (
    <ErrorBoundary fallback={fallback} onError={onError}>
      {children}
    </ErrorBoundary>
  );
}

// Producer names for casting cards
const PRODUCER_NAMES = ['Peter', 'Maggie', 'Kathleen', 'Lochie', 'Sean', 'Felicity', 'Margie', 'Neil', 'Casual'] as const;

// Casting Cards Tab Component
function CastingCardsTab({ contestants, initialContestantId, onClearInitial }: { contestants: Contestant[]; initialContestantId?: string | null; onClearInitial?: () => void }) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState<string>('A+');
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [cardStatusFilter, setCardStatusFilter] = useState<string>('all'); // all, draft_complete, rx_ready, in_progress
  const [producerFilter, setProducerFilter] = useState<string>('all'); // Filter by producer name
  const [selectedContestant, setSelectedContestant] = useState<Contestant | null>(null);
  const [cardData, setCardData] = useState<CastingCardData | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hideToolbar, setHideToolbar] = useState(false);
  const [cardZoom, setCardZoom] = useState(0.5);
  const [contentEditableKey, setContentEditableKey] = useState(0);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  
  // Undo/Redo history
  const [undoHistory, setUndoHistory] = useState<CastingCardData[]>([]);
  const [redoHistory, setRedoHistory] = useState<CastingCardData[]>([]);
  const maxHistorySize = 50;
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showLinkedPartnersPicker, setShowLinkedPartnersPicker] = useState(false);
  const [lastKnownUpdatedAt, setLastKnownUpdatedAt] = useState<string | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [conflictData, setConflictData] = useState<{ serverUpdatedAt: string; currentData: any } | null>(null);
  const [pendingSaveData, setPendingSaveData] = useState<CastingCardData | null>(null);
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasUnsavedChanges = useRef(false);
  const cardDataRef = useRef<CastingCardData | null>(null);
  const lastLoadedContestantId = useRef<string | null>(null); // Track which contestant's card we've loaded
  const isExitingFullscreen = useRef(false); // Prevent useEffect from overwriting during fullscreen exit
  const lastLocalSaveTime = useRef<number>(0); // Timestamp of last local save to prevent query overwrites
  
  // Version history state
  const [versionHistoryOpen, setVersionHistoryOpen] = useState(false);

  // PowerPoint import state
  const [pptxImportOpen, setPptxImportOpen] = useState(false);
  const [pptxFile, setPptxFile] = useState<File | null>(null);
  const [pptxPreviewData, setPptxPreviewData] = useState<Array<{
    slideNumber: number;
    extractedName: string;
    ageState: string;
    occupation: string;
    sponsorCategory: string;
    tagline: string;
    bodyText: string;
    producerName: string;
    hasMainPhoto: boolean;
    companionPhotoCount: number;
    match: { id: string; name: string } | null;
    confidence: number;
    candidates: Array<{ id: string; name: string }>;
    selectedContestantId?: string;
  }> | null>(null);
  const [pptxImportLoading, setPptxImportLoading] = useState(false);
  const [pptxSearchQuery, setPptxSearchQuery] = useState('');
  const [pptxSearchResults, setPptxSearchResults] = useState<Array<{ id: string; name: string; age: number; gender: string }>>([]);
  const [pptxSearchingFor, setPptxSearchingFor] = useState<number | null>(null);
  const [block7Ep1Confirmation, setBlock7Ep1Confirmation] = useState<{ assignmentId: string; contestantName: string } | null>(null);
  const pptxFileInputRef = useRef<HTMLInputElement>(null);

  // Debug: Log contestants with groupIds
  useEffect(() => {
    const withGroups = contestants.filter(c => c.groupId);
    console.log(`[CastingCardsTab] Total contestants: ${contestants.length}, with groupId: ${withGroups.length}`);
    if (withGroups.length > 0) {
      console.log('[CastingCardsTab] Sample contestants with groups:', withGroups.slice(0, 3).map(c => ({ name: c.name, groupId: c.groupId })));
    }
  }, [contestants]);

  // Select initial contestant when navigating from Players tab
  useEffect(() => {
    if (initialContestantId && contestants.length > 0) {
      const contestant = contestants.find(c => c.id === initialContestantId);
      if (contestant) {
        setSelectedContestant(contestant);
        onClearInitial?.();
      }
    }
  }, [initialContestantId, contestants, onClearInitial]);
  
  // Refs for file inputs
  const mainPhotoInputRef = useRef<HTMLInputElement>(null);
  const companionPhotoInputRef = useRef<HTMLInputElement>(null);
  const supporterPhotoInputRefs = useRef<{[key: string]: HTMLInputElement | null}>({});

  // Photo upload mutation
  const photoUploadMutation = useMutation({
    mutationFn: async ({ contestantId, file }: { contestantId: string; file: File }) => {
      const formData = new FormData();
      formData.append('photo', file);
      const response = await fetch(`/api/contestants/${contestantId}/photo`, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Upload failed');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({ title: "Photo uploaded", description: "The photo has been updated successfully" });
      setUploadingPhotoFor(null);
    },
    onError: (error: any) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
      setUploadingPhotoFor(null);
    },
  });

  // Handle photo file selection - stores as base64 in card data only (doesn't update contestant record)
  const handlePhotoUpload = (contestantId: string, file: File | null) => {
    if (!file || !cardData) return;
    setUploadingPhotoFor(contestantId);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      updateField('mainPhotoOverride', base64);
      setUploadingPhotoFor(null);
      toast({ title: "Photo added", description: "Casting card photo has been updated" });
    };
    reader.onerror = () => {
      setUploadingPhotoFor(null);
      toast({ title: "Upload failed", description: "Could not read the image file", variant: "destructive" });
    };
    reader.readAsDataURL(file);
  };

  // Handle manual companion photo upload (converts to base64 for storage in card data)
  const handleCompanionPhotoUpload = (companionId: string, file: File | null) => {
    if (!file || !cardData) return;
    setUploadingPhotoFor(companionId);
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      const companions = cardData.manualCompanions || [];
      const updatedCompanions = companions.map(c => 
        c.id === companionId ? { ...c, photoUrl: base64 } : c
      );
      updateField('manualCompanions', updatedCompanions);
      setUploadingPhotoFor(null);
      toast({ title: "Photo added", description: "Companion photo has been updated" });
    };
    reader.onerror = () => {
      setUploadingPhotoFor(null);
      toast({ title: "Upload failed", description: "Could not read the image file", variant: "destructive" });
    };
    reader.readAsDataURL(file);
  };

  // Add a manual companion
  const addManualCompanion = () => {
    if (!cardData) return;
    const companions = cardData.manualCompanions || [];
    if (companions.length >= 4) {
      toast({ title: "Maximum reached", description: "You can add up to 4 companions", variant: "destructive" });
      return;
    }
    const newCompanion: ManualCompanion = {
      id: `companion-${Date.now()}`,
      name: 'Name',
      relationship: 'Relationship',
      photoUrl: null
    };
    const newCompanions = [...companions, newCompanion];
    // Update both fields at once to avoid race condition
    const updatedData = { 
      ...cardData, 
      manualCompanions: newCompanions, 
      useManualCompanions: true 
    };
    setCardData(updatedData);
    hasUnsavedChanges.current = true;
    
    // Trigger auto-save
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges.current) {
        setAutoSaveStatus('saving');
        saveMutation.mutate(updatedData, {
          onSuccess: () => {
            hasUnsavedChanges.current = false;
            setAutoSaveStatus('saved');
            setTimeout(() => setAutoSaveStatus('idle'), 2000);
          },
          onError: () => {
            setAutoSaveStatus('idle');
          }
        });
      }
    }, 1500);
  };

  // Get linked group members for current contestant - combines BOTH groupId and attendingWith sources
  const getLinkedPartners = (): Contestant[] => {
    if (!selectedContestant) return [];
    const groupId = selectedContestant.groupId;
    console.log(`[getLinkedPartners] Contestant: ${selectedContestant.name}, groupId: ${groupId}, attendingWith: ${selectedContestant.attendingWith}, contestants count: ${contestants.length}`);
    
    const partnersMap = new Map<string, Contestant>(); // Use map to dedupe by ID
    
    // Find partners via groupId (manually linked)
    if (groupId) {
      const groupPartners = contestants.filter(c => c.groupId === groupId && c.id !== selectedContestant.id);
      console.log(`[getLinkedPartners] Found ${groupPartners.length} partners via groupId: ${groupPartners.map(p => p.name).join(', ')}`);
      groupPartners.forEach(p => partnersMap.set(p.id.toString(), p));
    }
    
    // Also find partners via attendingWith field (imported data)
    if (selectedContestant.attendingWith) {
      const partnerNames = getPartnerNames(selectedContestant.attendingWith);
      console.log(`[getLinkedPartners] Checking attendingWith, partnerNames: ${partnerNames.join(', ')}`);
      
      if (partnerNames.length > 0) {
        // Find contestants whose names match the partner names
        const attendingWithPartners = contestants.filter(c => {
          if (c.id === selectedContestant.id) return false;
          if (partnersMap.has(c.id.toString())) return false; // Already found via groupId
          // Check if this contestant's name is mentioned in attendingWith
          return partnerNames.some(partnerName => {
            const name = c.name?.toLowerCase() || '';
            const pName = partnerName.toLowerCase();
            return name.includes(pName) || pName.includes(name.split(' ')[0]);
          });
        });
        attendingWithPartners.forEach(p => partnersMap.set(p.id.toString(), p));
        
        // Also check for reciprocal mentions (they mention us in their attendingWith)
        const reciprocalPartners = contestants.filter(c => {
          if (c.id === selectedContestant.id) return false;
          if (partnersMap.has(c.id.toString())) return false; // Already found
          return c.attendingWith && attendingWithMentionsName(c.attendingWith, selectedContestant.name || '');
        });
        reciprocalPartners.forEach(p => partnersMap.set(p.id.toString(), p));
      }
    }
    
    // Also check if anyone else has the same groupId as us (even if we don't have one set)
    // This handles cases where we were linked TO someone but don't have our own groupId set
    const othersWithOurName = contestants.filter(c => {
      if (c.id === selectedContestant.id) return false;
      if (partnersMap.has(c.id.toString())) return false;
      // Check if they mention us in their attendingWith
      return c.attendingWith && attendingWithMentionsName(c.attendingWith, selectedContestant.name || '');
    });
    othersWithOurName.forEach(p => partnersMap.set(p.id.toString(), p));
    
    const allPartners = Array.from(partnersMap.values());
    console.log(`[getLinkedPartners] Total combined partners: ${allPartners.length} - ${allPartners.map(p => p.name).join(', ')}`);
    return allPartners;
  };

  // Add a linked partner as companion
  const addLinkedPartnerAsCompanion = (partner: Contestant) => {
    if (!cardData) return;
    const companions = cardData.manualCompanions || [];
    if (companions.length >= 4) {
      toast({ title: "Maximum reached", description: "You can add up to 4 companions", variant: "destructive" });
      return;
    }
    // Check if already added
    if (companions.some(c => c.id === partner.id)) {
      toast({ title: "Already added", description: `${partner.name} is already a companion`, variant: "destructive" });
      return;
    }
    const newCompanion: ManualCompanion = {
      id: partner.id,
      name: partner.name || 'Partner',
      relationship: selectedContestant?.attendingWith?.toLowerCase().includes('partner') ? 'Partner' : 
                   selectedContestant?.attendingWith?.toLowerCase().includes('wife') ? 'Wife' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('husband') ? 'Husband' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('friend') ? 'Friend' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('sister') ? 'Sister' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('brother') ? 'Brother' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('mother') ? 'Mother' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('father') ? 'Father' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('daughter') ? 'Daughter' :
                   selectedContestant?.attendingWith?.toLowerCase().includes('son') ? 'Son' : 'Companion',
      photoUrl: partner.photoUrl || null
    };
    const newCompanions = [...companions, newCompanion];
    const updatedData = { 
      ...cardData, 
      manualCompanions: newCompanions, 
      useManualCompanions: true 
    };
    setCardData(updatedData);
    setShowLinkedPartnersPicker(false);
    hasUnsavedChanges.current = true;
    
    // Trigger auto-save
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges.current) {
        setAutoSaveStatus('saving');
        saveMutation.mutate(updatedData, {
          onSuccess: () => {
            hasUnsavedChanges.current = false;
            setAutoSaveStatus('saved');
            setTimeout(() => setAutoSaveStatus('idle'), 2000);
          },
          onError: () => {
            setAutoSaveStatus('idle');
          }
        });
      }
    }, 1500);
    
    toast({ title: "Partner added", description: `${partner.name} added as companion` });
  };

  // Remove a manual companion
  const removeManualCompanion = (companionId: string) => {
    if (!cardData) return;
    const companions = cardData.manualCompanions || [];
    const updatedCompanions = companions.filter(c => c.id !== companionId);
    
    // Update both fields at once to avoid race conditions
    const updatedData = {
      ...cardData,
      manualCompanions: updatedCompanions,
      useManualCompanions: updatedCompanions.length > 0,
    };
    setCardData(updatedData);
    hasUnsavedChanges.current = true;
    
    // Trigger auto-save with the complete updated data
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges.current) {
        setAutoSaveStatus('saving');
        saveMutation.mutate(updatedData, {
          onSuccess: () => {
            hasUnsavedChanges.current = false;
            setAutoSaveStatus('saved');
            setTimeout(() => setAutoSaveStatus('idle'), 2000);
          },
          onError: () => {
            setAutoSaveStatus('idle');
          }
        });
      }
    }, 1500);
  };

  // Update a manual companion field
  const updateCompanionField = (companionId: string, field: keyof ManualCompanion, value: string) => {
    if (!cardData) return;
    const companions = cardData.manualCompanions || [];
    const updatedCompanions = companions.map(c => 
      c.id === companionId ? { ...c, [field]: value } : c
    );
    updateField('manualCompanions', updatedCompanions);
  };

  // Refs for manual companion photo inputs
  const companionPhotoRefs = useRef<{[key: string]: HTMLInputElement | null}>({});
  
  // Refs for body text contentEditable divs (regular and fullscreen)
  const taglineRef = useRef<HTMLDivElement>(null);
  const occupationRef = useRef<HTMLDivElement>(null);
  const ageStateRef = useRef<HTMLDivElement>(null);
  const bodyTextRef = useRef<HTMLDivElement>(null);

  // Fullscreen refs
  const taglineRefFs = useRef<HTMLDivElement>(null);
  const occupationRefFs = useRef<HTMLDivElement>(null);
  const ageStateRefFs = useRef<HTMLDivElement>(null);
  const bodyTextRefFs = useRef<HTMLDivElement>(null);
  
  // Track last cursor position for dot point insertion
  const lastCursorPositionRef = useRef<{ node: Node | null; offset: number } | null>(null);
  
  // Helper to save cursor position when user is in the body text
  const saveCursorPosition = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      lastCursorPositionRef.current = {
        node: range.startContainer,
        offset: range.startOffset
      };
    }
  };
  
  // Sync ALL contentEditable content to cardData before exiting fullscreen
  const syncAndExitFullscreen = () => {
    // Set flag to prevent useEffect from overwriting our data
    isExitingFullscreen.current = true;
    
    // Use ref for latest data (React state updates are async, ref is sync)
    const currentData = cardDataRef.current || cardData;
    if (!currentData) {
      setCardZoom(0.5);
      setIsFullscreen(false);
      setHideToolbar(false);
      isExitingFullscreen.current = false;
      return;
    }
    
    // Cancel any pending auto-save to prevent race conditions
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
      autoSaveTimeoutRef.current = null;
    }
    
    // Find all contentEditable elements with data-field attribute in the fullscreen view
    const fullscreenCard = document.querySelector('[data-testid="casting-card-fullscreen"]') || document;
    const editableFields = fullscreenCard.querySelectorAll('[data-field]');
    
    // Start with the LATEST data from ref (includes font sizes, offsets, etc.)
    let updatedData = { ...currentData };
    let hasChanges = false;
    
    console.log('[syncAndExitFullscreen] Current data font sizes:', {
      fontSizeOccupation: currentData.fontSizeOccupation,
      fontSizeAgeState: currentData.fontSizeAgeState,
      fontSizeName: currentData.fontSizeName
    });
    
    editableFields.forEach((element) => {
      const fieldName = element.getAttribute('data-field');
      const isHtml = element.getAttribute('data-is-html') === 'true';
      if (!fieldName) return;
      
      // Get the current value from the DOM
      const currentValue = isHtml ? (element as HTMLElement).innerHTML : (element as HTMLElement).textContent;
      const existingValue = (updatedData as any)[fieldName];
      
      // Update if different
      if (currentValue !== existingValue) {
        (updatedData as any)[fieldName] = currentValue || '';
        hasChanges = true;
      }
    });
    
    // Force sync refs with current DOM content for ALL header fields BEFORE saving
    const headerFields = [
      { field: 'tagline', ref: isFullscreen ? taglineRefFs : taglineRef },
      { field: 'occupation', ref: isFullscreen ? occupationRefFs : occupationRef },
      { field: 'ageState', ref: isFullscreen ? ageStateRefFs : ageStateRef }
    ];
    
    headerFields.forEach(({ field, ref }) => {
      if (ref.current) {
        const val = ref.current.innerText.trim();
        (updatedData as any)[field] = val;
      }
    });

    // Update ref immediately (synchronous)
    cardDataRef.current = updatedData;
    
    console.log('[syncAndExitFullscreen] Final updatedData before save:', {
      tagline: updatedData.tagline,
      occupation: updatedData.occupation,
      ageState: (updatedData as any).ageState
    });
    
    // CRITICAL: Set timestamp BEFORE any state changes to protect against race conditions
    lastLocalSaveTime.current = Date.now();
    
    // Use flushSync to force React to process state updates synchronously
    flushSync(() => {
      setCardData(updatedData);
      cardDataRef.current = updatedData;
    });
    
    console.log('[syncAndExitFullscreen] After flushSync, isFullscreen will be set to false');
    
    // Now exit fullscreen - use flushSync to ensure atomic update
    flushSync(() => {
      setCardZoom(0.5);
      setIsFullscreen(false);
      setHideToolbar(false);
      setContentEditableKey(prev => prev + 1);
    });
    
    // Trigger save AFTER exiting fullscreen, and keep the flag set until save completes
    if (hasChanges || hasUnsavedChanges.current) {
      hasUnsavedChanges.current = true;
      setAutoSaveStatus('saving');
      saveMutation.mutate({ ...updatedData, skipInvalidate: true } as any, {
        onSuccess: () => {
          hasUnsavedChanges.current = false;
          setAutoSaveStatus('saved');
          // CRITICAL: Refresh timestamp again after save completes for extended protection
          lastLocalSaveTime.current = Date.now();
          setTimeout(() => setAutoSaveStatus('idle'), 2000);
          // Clear the flag AFTER the save completes successfully
          // Add extra delay to ensure any refetches have completed
          setTimeout(() => {
            isExitingFullscreen.current = false;
          }, 1000);
        },
        onError: () => {
          setAutoSaveStatus('idle');
          // Clear the flag even on error
          setTimeout(() => {
            isExitingFullscreen.current = false;
          }, 1000);
        },
      });
    } else {
      // No changes to save, but still set timestamp to protect against refetches
      lastLocalSaveTime.current = Date.now();
      // Clear the flag after a short delay
      setTimeout(() => {
        isExitingFullscreen.current = false;
      }, 500);
    }
  };
  
  // Helper to insert dot point at cursor position
  const insertDotPointAtCursor = (isFullscreen: boolean) => {
    const ref = isFullscreen ? bodyTextRefFs : bodyTextRef;
    const element = ref.current;
    if (!element) return;
    
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      // No selection - append bullet at the end
      const currentText = element.innerText || '';
      const newText = currentText + (currentText.endsWith('\n') ? '' : '\n') + '• ';
      updateField('bodyText', newText);
      return;
    }
    
    const range = selection.getRangeAt(0);
    
    // Check if selection is within our element
    if (!element.contains(range.startContainer)) {
      // Selection not in this element - append bullet at the end
      const currentText = element.innerText || '';
      const newText = currentText + (currentText.endsWith('\n') ? '' : '\n') + '• ';
      updateField('bodyText', newText);
      return;
    }
    
    // Get the current node and find the start of the line
    let node = range.startContainer;
    let offset = range.startOffset;
    
    // If we're at the start of a text node or in a BR, insert bullet here
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      // Find start of current line within this text node
      let lineStart = offset;
      while (lineStart > 0 && text[lineStart - 1] !== '\n') {
        lineStart--;
      }
      // Insert bullet at line start
      const before = text.slice(0, lineStart);
      const after = text.slice(lineStart);
      node.textContent = before + '• ' + after;
      
      // Update the stored bodyText
      updateField('bodyText', element.innerText || '');
      
      // Set cursor after the bullet
      setTimeout(() => {
        const newRange = document.createRange();
        newRange.setStart(node, lineStart + 2);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }, 0);
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      // Cursor might be in an empty line (after a <br>)
      // Insert a text node with the bullet
      const bulletNode = document.createTextNode('• ');
      
      // Find the right place to insert
      if (offset < node.childNodes.length) {
        node.insertBefore(bulletNode, node.childNodes[offset]);
      } else {
        node.appendChild(bulletNode);
      }
      
      // Update the stored bodyText
      updateField('bodyText', element.innerText || '');
      
      // Set cursor after the bullet
      setTimeout(() => {
        const newRange = document.createRange();
        newRange.setStart(bulletNode, 2);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      }, 0);
    }
  };

  // Find all supporters (group members) for the selected contestant
  const supporters = useMemo(() => {
    if (!selectedContestant?.groupId) return [];
    return contestants.filter(c => c.groupId === selectedContestant.groupId && c.id !== selectedContestant.id);
  }, [selectedContestant, contestants]);

  // Fetch all casting cards for filtering
  const { data: allCastingCards = [] } = useQuery<CastingCardData[]>({
    queryKey: ['/api/casting-cards'],
  });

  // Fetch existing casting card data when contestant is selected
  // Disable refetchOnWindowFocus to prevent overwriting unsaved local edits when switching tabs
  const { data: existingCard, isLoading: loadingCard } = useQuery<CastingCardData>({
    queryKey: ['/api/casting-cards', selectedContestant?.id],
    enabled: !!selectedContestant,
    refetchOnWindowFocus: false,
    staleTime: 30000, // Consider data fresh for 30 seconds
  });

  // Fetch version history for the current card
  const { data: cardVersions = [], isLoading: loadingVersions, refetch: refetchVersions } = useQuery<Array<{
    id: string;
    castingCardId: string;
    cardData: string;
    createdAt: string;
    createdBy: string | null;
  }>>({
    queryKey: ['/api/casting-cards', existingCard?.id, 'versions'],
    queryFn: async () => {
      if (!existingCard?.id) return [];
      const response = await fetch(`/api/casting-cards/${existingCard.id}/versions`, { credentials: 'include' });
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!existingCard?.id && versionHistoryOpen,
  });

  // Restore version mutation
  const restoreVersionMutation = useMutation({
    mutationFn: async ({ cardId, versionId }: { cardId: string; versionId: string }) => {
      const response = await fetch(`/api/casting-cards/${cardId}/versions/${versionId}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to restore version');
      }
      return response.json();
    },
    onSuccess: (restoredCard) => {
      toast({ title: "Version restored", description: "The casting card has been restored to the selected version." });
      // Sync local form state with restored data - need to parse JSON fields
      if (restoredCard) {
        let parsedCard = { ...restoredCard };
        // Parse manualCompanions if it's a string (from database)
        if (typeof parsedCard.manualCompanions === 'string') {
          try {
            parsedCard.manualCompanions = JSON.parse(parsedCard.manualCompanions as any);
          } catch (e) {
            parsedCard.manualCompanions = [];
          }
        }
        // Ensure manualCompanions is always an array
        if (!Array.isArray(parsedCard.manualCompanions)) {
          parsedCard.manualCompanions = [];
        }
        // Parse bulletPoints if it's a string
        if (typeof parsedCard.bulletPoints === 'string') {
          try {
            parsedCard.bulletPoints = JSON.parse(parsedCard.bulletPoints as any);
          } catch (e) {
            parsedCard.bulletPoints = [];
          }
        }
        setCardData(parsedCard);
        cardDataRef.current = parsedCard; // Also update the ref
        setLastKnownUpdatedAt(restoredCard.updatedAt);
        hasUnsavedChanges.current = false; // Mark as saved since we just restored
      }
      queryClient.invalidateQueries({ queryKey: ['/api/casting-cards', selectedContestant?.id] });
      refetchVersions();
      setVersionHistoryOpen(false);
    },
    onError: (error: any) => {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
    },
  });

  // Helper function to get auto-populated companions from group members
  const getAutoCompanions = (contestant: Contestant | null): ManualCompanion[] => {
    if (!contestant) return [];
    
    let groupMembers: Contestant[] = [];
    
    // First, try to find via groupId (manually linked)
    if (contestant.groupId) {
      groupMembers = contestants.filter(
        c => c.groupId === contestant.groupId && c.id !== contestant.id
      );
      console.log(`[getAutoCompanions] Contestant ${contestant.name || contestant.id} has groupId: ${contestant.groupId}, found ${groupMembers.length} group members via groupId`);
    }
    
    // If no groupId or no members found, try via attendingWith
    if (groupMembers.length === 0 && contestant.attendingWith) {
      const partnerNames = getPartnerNames(contestant.attendingWith);
      console.log(`[getAutoCompanions] Trying attendingWith for ${contestant.name}, partnerNames: ${partnerNames.join(', ')}`);
      
      if (partnerNames.length > 0) {
        // Find contestants whose names match the partner names - STRICT MATCHING
        const attendingWithPartners = contestants.filter(c => {
          if (c.id === contestant.id) return false;
          return partnerNames.some(partnerName => {
            const name = c.name?.toLowerCase().trim() || '';
            const pName = partnerName.toLowerCase().trim();
            const nameParts = name.split(' ').filter(p => p.length >= 3);
            const pNameParts = pName.split(' ').filter(p => p.length >= 3);
            
            // Exact full name match
            if (name === pName) return true;
            
            // If partner name has 2+ parts, require at least 2 parts to match
            if (pNameParts.length >= 2) {
              const matchCount = pNameParts.filter(pp => nameParts.includes(pp)).length;
              return matchCount >= 2;
            }
            
            // Single name only - require exact first name match
            if (pNameParts.length === 1 && nameParts.length >= 1) {
              return nameParts[0] === pNameParts[0];
            }
            
            return false;
          });
        });
        
        // Also check for reciprocal mentions - strict matching
        const reciprocalPartners = contestants.filter(c => {
          if (c.id === contestant.id) return false;
          if (attendingWithPartners.some(p => p.id === c.id)) return false;
          if (!c.attendingWith) return false;
          
          const cPartnerNames = getPartnerNames(c.attendingWith);
          const contestantName = (contestant.name || '').toLowerCase().trim();
          const contestantParts = contestantName.split(' ').filter(p => p.length >= 3);
          
          return cPartnerNames.some(pn => {
            const pnParts = pn.toLowerCase().trim().split(' ').filter(p => p.length >= 3);
            if (contestantParts.length >= 2 && pnParts.length >= 2) {
              const matchCount = pnParts.filter(pp => contestantParts.includes(pp)).length;
              return matchCount >= 2;
            }
            if (pnParts.length === 1 && contestantParts.length >= 1) {
              return pnParts[0] === contestantParts[0];
            }
            return false;
          });
        });
        
        groupMembers = [...attendingWithPartners, ...reciprocalPartners];
        console.log(`[getAutoCompanions] Found ${groupMembers.length} group members via attendingWith: ${groupMembers.map(m => m.name).join(', ')}`);
      }
    }
    
    return groupMembers.slice(0, 4).map(member => ({
      id: `companion-${member.id}`,
      name: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.name || 'Partner',
      relationship: member.attendingWith || 'Partner',
      photoUrl: member.photoUrl || null
    }));
  };

  // Initialize card data when contestant is selected or existing card loads
  // IMPORTANT: Only load from existingCard when switching to a NEW contestant
  // This prevents query refetches from overwriting unsaved local edits
  useEffect(() => {
    if (selectedContestant) {
      // CRITICAL: Skip if we're in the process of exiting fullscreen
      // This prevents the useEffect from overwriting local changes during view transition
      if (isExitingFullscreen.current) {
        console.log('[CardData useEffect] Skipping - isExitingFullscreen is true');
        return;
      }
      
      // CRITICAL: Skip if we recently saved data locally (within 5 seconds)
      // This prevents React Query refetches from overwriting our local edits
      const timeSinceLastSave = Date.now() - lastLocalSaveTime.current;
      const refMatchesContestant = cardDataRef.current?.contestantId === selectedContestant.id;
      
      console.log('[CardData useEffect] Protection check:', {
        timeSinceLastSave,
        threshold: 5000,
        refMatchesContestant,
        lastLocalSaveTime: lastLocalSaveTime.current,
        refContestantId: cardDataRef.current?.contestantId,
        selectedContestantId: selectedContestant.id
      });
      
      if (timeSinceLastSave < 10000 && refMatchesContestant) {
        console.log('[CardData useEffect] Skipping - recently saved locally:', timeSinceLastSave, 'ms ago (Threshold: 10s)');
        return;
      }
      
      // Skip if we've already loaded this contestant's card and haven't switched
      const isNewContestant = lastLoadedContestantId.current !== selectedContestant.id;
      
      // Check BOTH state and ref to prevent overwriting (ref is more reliable for recent changes)
      const hasLocalData = cardData?.contestantId === selectedContestant.id || 
                          cardDataRef.current?.contestantId === selectedContestant.id;
      
      console.log('[CardData useEffect] Load check:', {
        isNewContestant,
        hasLocalData,
        lastLoadedContestantId: lastLoadedContestantId.current
      });
      
      if (!isNewContestant && hasLocalData) {
        // Already loaded this contestant, don't overwrite local edits
        console.log('[CardData useEffect] Skipping - already loaded this contestant');
        return;
      }
      
      // ADDITIONAL CHECK: If we have local data with content that differs from existingCard, skip overwrite
      // This catches cases where the timing checks above fail
      const localData = cardDataRef.current || cardData;
      if (localData && localData.contestantId === selectedContestant.id && existingCard) {
        // Check if local data has edits that would be lost - check ALL header fields
        const localTagline = localData.tagline || '';
        const localOccupation = localData.occupation || '';
        const localAgeState = localData.ageState || '';
        const serverTagline = existingCard.tagline || '';
        const serverOccupation = existingCard.occupation || '';
        const serverAgeState = (existingCard as any).ageState || '';
        
        // If local has content that differs from server, preserve local
        if (localTagline !== serverTagline ||
            localOccupation !== serverOccupation ||
            localAgeState !== serverAgeState) {
          console.log('[CardData useEffect] Skipping - local data differs from server', {
            localTagline, serverTagline,
            localOccupation, serverOccupation,
            localAgeState, serverAgeState
          });
          return;
        }
      }
      
      try {
        setRenderError(null); // Clear any previous errors
        
        // Get auto companions from group members
        const autoCompanions = getAutoCompanions(selectedContestant);
        
        if (existingCard && existingCard.contestantId === selectedContestant.id) {
          // Parse manualCompanions if it's a string (from database)
          let parsedCard = { ...existingCard };
          if (typeof parsedCard.manualCompanions === 'string') {
            try {
              parsedCard.manualCompanions = JSON.parse(parsedCard.manualCompanions as any);
            } catch (e) {
              parsedCard.manualCompanions = [];
            }
          }
          // Ensure manualCompanions is always an array
          if (!Array.isArray(parsedCard.manualCompanions)) {
            parsedCard.manualCompanions = [];
          }
          
          // Ensure each companion has required fields
          parsedCard.manualCompanions = parsedCard.manualCompanions.map((c: any, idx: number) => ({
            id: c?.id || `companion-${idx}`,
            name: c?.name || 'Partner',
            relationship: c?.relationship || 'Partner',
            photoUrl: c?.photoUrl || null
          }));
          
          // If no companions saved but group members exist, auto-populate
          if (parsedCard.manualCompanions.length === 0 && autoCompanions.length > 0) {
            parsedCard.manualCompanions = autoCompanions;
            parsedCard.useManualCompanions = true;
          }
          
          setCardData(parsedCard);
          cardDataRef.current = parsedCard;
          lastLoadedContestantId.current = selectedContestant.id; // Mark as loaded
          // Track when this card was loaded for conflict detection
          setLastKnownUpdatedAt((existingCard as any).updatedAt || new Date().toISOString());
        } else if (!loadingCard) {
          setCardData({
            contestantId: selectedContestant.id,
            occupation: '',
            sponsorCategory: '',
            tagline: '',
            energyLevel: '3',
            characterTraits: '',
            meetStory: '',
            keyStories: '',
            prizeGoalHigh: '',
            prizeGoalLow: '',
            howMuchToWin: '',
            playStyle: '',
            previousShows: '',
            companionName: selectedContestant.attendingWith || '',
            companionRelationship: '',
            companionPhotoUrl: '',
            producerName: '',
            showProducer: true,
            showTagline: true,
            manualCompanions: autoCompanions.length > 0 ? autoCompanions : [],
            useManualCompanions: autoCompanions.length > 0,
            ageState: `${selectedContestant.age || ''} (${((selectedContestant as any).state || 'STATE').toUpperCase()})`.trim(),
          });
          // Also update ref for new cards
          cardDataRef.current = {
            contestantId: selectedContestant.id,
            occupation: '',
            sponsorCategory: '',
            tagline: '',
            energyLevel: '3',
            characterTraits: '',
            meetStory: '',
            keyStories: '',
            prizeGoalHigh: '',
            prizeGoalLow: '',
            howMuchToWin: '',
            playStyle: '',
            previousShows: '',
            companionName: selectedContestant.attendingWith || '',
            companionRelationship: '',
            companionPhotoUrl: '',
            producerName: '',
            showProducer: true,
            showTagline: true,
            manualCompanions: autoCompanions.length > 0 ? autoCompanions : [],
            useManualCompanions: autoCompanions.length > 0,
            ageState: `${selectedContestant.age || ''} (${((selectedContestant as any).state || 'STATE').toUpperCase()})`.trim(),
          };
          lastLoadedContestantId.current = selectedContestant.id; // Mark as loaded
        }
      } catch (error: any) {
        console.error('Error initializing card data:', error);
        setRenderError(`Error loading card: ${error?.message || 'Unknown error'}`);
      }
    }
  }, [selectedContestant, existingCard, loadingCard, contestants]);

  // Clear undo/redo history when switching contestants
  useEffect(() => {
    setUndoHistory([]);
    setRedoHistory([]);
    // Reset hasUnsavedChanges when switching contestants
    hasUnsavedChanges.current = false;
  }, [selectedContestant]);

  // Save casting card mutation - uses PATCH for updates, POST for new cards
  const saveMutation = useMutation({
    mutationFn: async (data: CastingCardData & { skipInvalidate?: boolean; forceOverwrite?: boolean }) => {
      // Serialize manualCompanions to JSON string for database storage
      const { skipInvalidate, forceOverwrite, ...cardDataToSend } = data;
      const dataToSend = {
        ...cardDataToSend,
        manualCompanions: cardDataToSend.manualCompanions ? JSON.stringify(cardDataToSend.manualCompanions) : null,
        lastKnownUpdatedAt: lastKnownUpdatedAt,
        forceOverwrite: forceOverwrite || false,
      };
      
      if (existingCard?.id) {
        // Update existing card - use contestantId, not card id
        const response = await fetch(`/api/casting-cards/${data.contestantId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(dataToSend),
        });
        
        // Handle conflict (409)
        if (response.status === 409) {
          const conflictInfo = await response.json();
          return { conflict: true, ...conflictInfo, skipInvalidate, originalData: data };
        }
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Save failed');
        }
        
        return { ...(await response.json()), skipInvalidate };
      } else {
        // Create new card
        const response = await apiRequest('POST', '/api/casting-cards', dataToSend);
        return { ...(await response.json()), skipInvalidate };
      }
    },
    onSuccess: (result: any) => {
      // Handle conflict case
      if (result?.conflict) {
        setConflictData({ serverUpdatedAt: result.serverUpdatedAt, currentData: result.currentData });
        setPendingSaveData(result.originalData);
        setConflictDialogOpen(true);
        setAutoSaveStatus('idle');
        return;
      }
      
      // Update lastKnownUpdatedAt with the server's new timestamp
      if (result?.updatedAt) {
        setLastKnownUpdatedAt(result.updatedAt);
      }
      
      // Only invalidate on manual saves, not auto-saves (to prevent state overwrite)
      if (!result?.skipInvalidate) {
        queryClient.invalidateQueries({ queryKey: ['/api/casting-cards'] });
        if (selectedContestant) {
          queryClient.invalidateQueries({ queryKey: ['/api/casting-cards', selectedContestant.id] });
        }
      }
      // Toast is only shown for manual saves, not auto-saves
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  // Filter contestants - search by full name (first + last)
  const filteredContestants = useMemo(() => {
    const term = searchTerm.toLowerCase().trim();
    return contestants.filter(c => {
      // Search matches full name or email - split search term to match first/last name separately too
      const fullName = c.name.toLowerCase();
      const email = (c.email || '').toLowerCase();
      const searchTerms = term.split(/\s+/).filter(Boolean);
      const matchesSearch = term === '' || 
        fullName.includes(term) || // Match full search term anywhere in name
        email.includes(term) || // Match email
        searchTerms.every(t => fullName.includes(t) || email.includes(t)); // Or match all words individually
      const matchesRating = ratingFilter === 'all' || 
        c.auditionRating?.toUpperCase() === ratingFilter.toUpperCase();
      const matchesGender = genderFilter === 'all' || 
        c.gender.toLowerCase() === genderFilter.toLowerCase();
      
      // Card status filter - check against existing cards
      const cardForContestant = allCastingCards?.find((card: any) => card.contestantId === c.id);
      if (cardStatusFilter !== 'all') {
        if (cardStatusFilter === 'draft_complete') {
          if (!cardForContestant?.isDraftComplete) return false;
        } else if (cardStatusFilter === 'rx_ready') {
          if (!cardForContestant?.isReady) return false;
        } else if (cardStatusFilter === 'in_progress') {
          // In progress = has card but neither draft complete nor rx ready
          if (!cardForContestant || cardForContestant.isDraftComplete || cardForContestant.isReady) return false;
        } else if (cardStatusFilter === 'no_card') {
          if (cardForContestant) return false;
        }
      }
      
      // Producer filter - check the producer name on the card
      if (producerFilter !== 'all') {
        if (!cardForContestant?.producerName) return false;
        if (cardForContestant.producerName !== producerFilter) return false;
      }
      
      return matchesSearch && matchesRating && matchesGender;
    });
  }, [contestants, searchTerm, ratingFilter, genderFilter, cardStatusFilter, producerFilter, allCastingCards]);

  const handleSave = () => {
    if (cardData) {
      saveMutation.mutate(cardData, {
        onSuccess: () => {
          toast({ title: "Saved!", description: "Casting card has been saved" });
        }
      });
    }
  };

  // Toggle RX Ready status and save immediately with the new value
  const toggleReadyAndSave = () => {
    if (cardData) {
      const updatedData = { ...cardData, isReady: !cardData.isReady };
      setCardData(updatedData);
      saveMutation.mutate(updatedData);
    }
  };

  // Toggle Draft Complete status and save immediately with the new value
  const toggleDraftCompleteAndSave = () => {
    if (cardData) {
      const updatedData = { ...cardData, isDraftComplete: !cardData.isDraftComplete };
      setCardData(updatedData);
      saveMutation.mutate(updatedData);
    }
  };

  // Conflict resolution handlers
  const handleOverwriteConflict = () => {
    if (pendingSaveData) {
      // Force overwrite - ignore conflict
      saveMutation.mutate({ ...pendingSaveData, forceOverwrite: true } as any);
      setConflictDialogOpen(false);
      setConflictData(null);
      setPendingSaveData(null);
      toast({ title: "Changes saved", description: "Your changes have been saved, overwriting the other user's changes" });
    }
  };

  const handleRefreshFromServer = () => {
    // Discard local changes and refresh from server
    setConflictDialogOpen(false);
    setConflictData(null);
    setPendingSaveData(null);
    // Refetch the card data from server
    queryClient.invalidateQueries({ queryKey: ['/api/casting-cards', selectedContestant?.id] });
    toast({ title: "Card refreshed", description: "Loaded the latest version from the server" });
  };

  // Helper function to preload all images in an element
  const preloadImages = async (element: HTMLElement): Promise<void> => {
    const images = element.querySelectorAll('img');
    const imagePromises: Promise<void>[] = [];
    
    images.forEach((img) => {
      // Skip data URIs (base64) - they don't need preloading
      if (img.src.startsWith('data:')) return;
      
      // Skip already loaded images with valid dimensions
      if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) return;
      
      // Force reload the image to ensure it's loaded
      imagePromises.push(
        new Promise((resolve) => {
          const timeout = setTimeout(() => {
            console.warn('Image preload timeout:', img.src?.substring(0, 100));
            resolve();
          }, 10000); // 10 second timeout per image
          
          const newImg = new Image();
          newImg.crossOrigin = 'anonymous';
          newImg.onload = () => {
            clearTimeout(timeout);
            // Also ensure the original img is updated
            if (!img.complete || img.naturalWidth === 0) {
              img.src = newImg.src;
            }
            resolve();
          };
          newImg.onerror = () => {
            clearTimeout(timeout);
            console.warn('Image preload failed:', img.src?.substring(0, 100));
            resolve(); // Don't fail on error, just continue
          };
          // Add cache buster to force fresh load if needed
          const srcUrl = img.src;
          newImg.src = srcUrl;
        })
      );
    });
    
    await Promise.all(imagePromises);
    // Extra delay to ensure rendering is complete
    await new Promise(resolve => setTimeout(resolve, 500));
  };

  const handleDownloadPdf = async () => {
    if (!selectedContestant || !cardData) return;
    
    setIsGeneratingPdf(true);
    try {
      // Generate PDF using html2canvas and jspdf approach
      const cardElement = document.getElementById('casting-card-preview');
      if (!cardElement) {
        throw new Error('Card preview not found');
      }

      // Preload all images first
      await preloadImages(cardElement);

      // Dynamic import of html2canvas and jspdf
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      // Inject CSS override BEFORE html2canvas parses stylesheets
      // This prevents "unsupported color function" errors from modern CSS
      const printOverrideStyle = document.createElement('style');
      printOverrideStyle.id = 'print-override-style';
      printOverrideStyle.textContent = `
        #casting-card-preview, #casting-card-preview * {
          background-color: inherit !important;
          border-color: inherit !important;
        }
        /* Casting card specific colors - must override inherit with higher specificity */
        #casting-card-preview .casting-card-header { background: linear-gradient(to right, #b45309, #d97706, #f59e0b) !important; border: 2px solid #000000 !important; }
        #casting-card-preview .casting-card-name { color: #fcd34d !important; }
        #casting-card-preview .casting-card-sponsor { color: #16a34a !important; }
        #casting-card-preview .casting-card-tagline { color: #dc2626 !important; }
        #casting-card-preview .casting-card-producer-label { background-color: #e5e7eb !important; border: 1px solid #d1d5db !important; color: #000000 !important; }
        #casting-card-preview .casting-card-producer-name-print { background-color: #facc15 !important; color: #000000 !important; }
        #casting-card-preview .casting-card-photo-border { border: 4px solid #f59e0b !important; background-color: #f3f4f6 !important; }
      `;
      document.head.appendChild(printOverrideStyle);

      const canvas = await html2canvas(cardElement, {
        scale: 3, // Increased scale for better resolution (sharper photos)
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 15000,
        ignoreElements: (element) => {
          // Skip any elements with problematic CSS
          return element.classList?.contains('ignore-print');
        },
        onclone: (clonedDoc) => {
          // Remove CSS color() function references that html2canvas can't parse
          const style = clonedDoc.createElement('style');
          style.textContent = `
            * { 
              --ring: 215 20.2% 65.1% !important;
              --primary: 215 16.3% 46.9% !important;
              --secondary: 210 40% 96.1% !important;
              --accent: 35 91% 55% !important;
              --muted: 210 40% 96.1% !important;
              --background: 0 0% 100% !important;
              --foreground: 0 0% 0% !important;
              --border: 0 0% 80% !important;
            }
            /* Force header gradient colors for PDF */
            .bg-gradient-to-r.from-amber-700 {
              background: linear-gradient(to right, #b45309, #d97706, #f59e0b) !important;
            }
            /* Hide ignore-print and print-hidden elements */
            .ignore-print, .print-hidden {
              display: none !important;
            }
            /* Show print-only producer name (hidden in UI) with yellow background */
            .casting-card-producer-name-print {
              display: inline-block !important;
              background-color: #facc15 !important;
              color: #000000 !important;
              padding: 8px 16px !important;
              font-weight: bold !important;
            }
            /* Remove border from body text for print */
            .print-no-border {
              border: none !important;
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
              overflow-wrap: break-word !important;
              line-height: 1.5 !important;
            }
            /* Force casting card colors for PDF rendering */
            .casting-card-name {
              color: #fcd34d !important;
            }
            .casting-card-sponsor {
              color: #16a34a !important;
            }
            .casting-card-tagline {
              color: #dc2626 !important;
            }
          `;
          clonedDoc.head.appendChild(style);
          
          // Fix header gradient manually
          const headers = clonedDoc.querySelectorAll('.bg-gradient-to-r');
          headers.forEach((header: Element) => {
            const htmlHeader = header as HTMLElement;
            if (htmlHeader.classList.contains('from-amber-700')) {
              htmlHeader.style.background = 'linear-gradient(to right, #b45309, #d97706, #f59e0b)';
            }
          });
          
          // Fix casting card header and colors explicitly
          clonedDoc.querySelectorAll('.casting-card-header').forEach((el: Element) => {
            (el as HTMLElement).style.background = 'linear-gradient(to right, #b45309, #d97706, #f59e0b)';
            (el as HTMLElement).style.border = '2px solid #000000';
          });
          clonedDoc.querySelectorAll('.casting-card-name').forEach((el: Element) => {
            (el as HTMLElement).style.color = '#fcd34d';
            (el as HTMLElement).style.lineHeight = '80px';
            (el as HTMLElement).style.margin = '0';
            (el as HTMLElement).style.marginTop = '-24px';
            (el as HTMLElement).style.paddingLeft = '16px';
          });
          clonedDoc.querySelectorAll('.casting-card-sponsor').forEach((el: Element) => {
            (el as HTMLElement).style.color = '#16a34a';
          });
          clonedDoc.querySelectorAll('.casting-card-tagline').forEach((el: Element) => {
            (el as HTMLElement).style.color = '#dc2626';
          });
          clonedDoc.querySelectorAll('.casting-card-producer-label').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#e5e7eb';
            (el as HTMLElement).style.border = '1px solid #d1d5db';
            (el as HTMLElement).style.color = '#000000';
          });
          clonedDoc.querySelectorAll('.casting-card-producer-name').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#facc15';
            (el as HTMLElement).style.color = '#000000';
          });
          // Also style the print-only producer name span
          clonedDoc.querySelectorAll('.casting-card-producer-name-print').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#facc15';
            (el as HTMLElement).style.color = '#000000';
            (el as HTMLElement).style.display = 'inline-block';
            (el as HTMLElement).style.position = 'static';
            (el as HTMLElement).style.left = 'auto';
            (el as HTMLElement).style.padding = '8px 16px';
            (el as HTMLElement).style.fontWeight = 'bold';
          });
          // Producer corner in bottom RIGHT - ensure positioning shows in print
          clonedDoc.querySelectorAll('.casting-card-producer-corner').forEach((el: Element) => {
            (el as HTMLElement).style.position = 'absolute';
            (el as HTMLElement).style.bottom = '16px';
            (el as HTMLElement).style.right = '16px';
            (el as HTMLElement).style.left = 'auto';
            (el as HTMLElement).style.zIndex = '9999';
            (el as HTMLElement).style.display = 'flex';
            (el as HTMLElement).style.alignItems = 'center';
            (el as HTMLElement).style.visibility = 'visible';
            (el as HTMLElement).style.opacity = '1';
          });
          // Ensure parent casting-card-preview doesn't clip the producer corner
          const cardPreviewForProducer = clonedDoc.querySelector('#casting-card-preview');
          if (cardPreviewForProducer) {
            (cardPreviewForProducer as HTMLElement).style.overflow = 'visible';
          }
          // Style producer label (gray background) - matching height with name box
          clonedDoc.querySelectorAll('.casting-card-producer-corner .casting-card-producer-label').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#e5e7eb';
            (el as HTMLElement).style.border = '1px solid #d1d5db';
            (el as HTMLElement).style.color = '#000000';
            (el as HTMLElement).style.display = 'flex';
            (el as HTMLElement).style.alignItems = 'center';
            (el as HTMLElement).style.padding = '8px 16px';
            (el as HTMLElement).style.fontWeight = '600';
            (el as HTMLElement).style.fontSize = '14px';
            (el as HTMLElement).style.height = '36px';
            (el as HTMLElement).style.boxSizing = 'border-box';
          });
          // Style producer name (yellow background) - make visible for print, matching height
          clonedDoc.querySelectorAll('.casting-card-producer-corner .casting-card-producer-name-print').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#facc15';
            (el as HTMLElement).style.color = '#000000';
            (el as HTMLElement).style.display = 'flex';
            (el as HTMLElement).style.alignItems = 'center';
            (el as HTMLElement).style.position = 'static';
            (el as HTMLElement).style.left = 'auto';
            (el as HTMLElement).style.padding = '8px 16px';
            (el as HTMLElement).style.fontWeight = 'bold';
            (el as HTMLElement).style.fontSize = '14px';
            (el as HTMLElement).style.minWidth = '120px';
            (el as HTMLElement).style.height = '36px';
            (el as HTMLElement).style.boxSizing = 'border-box';
          });
          clonedDoc.querySelectorAll('.casting-card-photo-border').forEach((el: Element) => {
            (el as HTMLElement).style.border = '4px solid #f59e0b';
            (el as HTMLElement).style.backgroundColor = '#f3f4f6';
            // Fix photo container width - ensure it doesn't shrink
            (el as HTMLElement).style.minWidth = '256px';
          });
          
          // Fix main photo container explicit dimensions - w-64 = 16rem = 256px
          clonedDoc.querySelectorAll('.w-64.flex-shrink-0').forEach((el: Element) => {
            (el as HTMLElement).style.width = '256px';
            (el as HTMLElement).style.minWidth = '256px';
            (el as HTMLElement).style.maxWidth = '256px';
            (el as HTMLElement).style.flexShrink = '0';
            (el as HTMLElement).style.flexBasis = '256px';
          });
          
          // Fix the inner photo wrapper - h-72 = 18rem = 288px  
          clonedDoc.querySelectorAll('.w-full.h-72').forEach((el: Element) => {
            (el as HTMLElement).style.width = '100%';
            (el as HTMLElement).style.height = '288px';
            (el as HTMLElement).style.minHeight = '288px';
          });
          
          // Ensure all images have explicit dimensions and proper object-fit
          clonedDoc.querySelectorAll('img').forEach((img: Element) => {
            const htmlImg = img as HTMLImageElement;
            if (!htmlImg.style.objectFit) {
              htmlImg.style.objectFit = 'cover';
            }
            // Add sharpness/rendering hints
            htmlImg.style.imageRendering = 'auto'; // Browser default usually better for photos than crisp-edges
            htmlImg.style.webkitFontSmoothing = 'antialiased';
            // Force visibility for all images
            htmlImg.style.display = 'block';
            htmlImg.style.visibility = 'visible';
            htmlImg.style.opacity = '1';
          });
          
          // Fix main photo - html2canvas doesn't handle object-fit:cover properly
          // Convert img to background-image on parent container which works better
          clonedDoc.querySelectorAll('.casting-card-photo-border').forEach((container: Element) => {
            const img = container.querySelector('img') as HTMLImageElement;
            if (img && img.src) {
              // Find the inner wrapper div that contains the image
              const wrapper = img.parentElement;
              if (wrapper) {
                // Apply the image as background on the wrapper
                wrapper.style.backgroundImage = `url("${img.src}")`;
                wrapper.style.backgroundSize = 'cover';
                wrapper.style.backgroundPosition = 'center top';
                wrapper.style.backgroundRepeat = 'no-repeat';
                wrapper.style.imageRendering = 'auto'; // Sharpness hint
                // Preserve the transform (zoom/pan) if any
                const imgTransform = img.style.transform;
                if (imgTransform && imgTransform !== 'none') {
                  wrapper.style.transform = imgTransform;
                }
                // Hide the original img element
                img.style.opacity = '0';
                img.style.visibility = 'hidden';
              }
            }
          });
          
          // Fix partner photo sizes - convert Tailwind w-36 h-36 (and variants) to explicit pixels
          // w-36 = 144px, w-28 = 112px, w-24 = 96px, w-20 = 80px
          clonedDoc.querySelectorAll('.w-36.h-36').forEach((el: Element) => {
            (el as HTMLElement).style.width = '144px';
            (el as HTMLElement).style.height = '144px';
            (el as HTMLElement).style.minWidth = '144px';
            (el as HTMLElement).style.minHeight = '144px';
          });
          clonedDoc.querySelectorAll('.w-28.h-28').forEach((el: Element) => {
            (el as HTMLElement).style.width = '112px';
            (el as HTMLElement).style.height = '112px';
            (el as HTMLElement).style.minWidth = '112px';
            (el as HTMLElement).style.minHeight = '112px';
          });
          clonedDoc.querySelectorAll('.w-24.h-24').forEach((el: Element) => {
            (el as HTMLElement).style.width = '96px';
            (el as HTMLElement).style.height = '96px';
            (el as HTMLElement).style.minWidth = '96px';
            (el as HTMLElement).style.minHeight = '96px';
          });
          clonedDoc.querySelectorAll('.w-20.h-20').forEach((el: Element) => {
            (el as HTMLElement).style.width = '80px';
            (el as HTMLElement).style.height = '80px';
            (el as HTMLElement).style.minWidth = '80px';
            (el as HTMLElement).style.minHeight = '80px';
          });
          
          // Fix Avatar images - Radix Avatar uses conditional rendering that doesn't transfer during cloning
          // Find all avatar containers and ensure images render properly
          clonedDoc.querySelectorAll('[data-slot="avatar-image"]').forEach((el: Element) => {
            const img = el as HTMLImageElement;
            if (img.src) {
              img.style.objectFit = 'cover';
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.display = 'block';
              img.style.visibility = 'visible';
              img.style.opacity = '1';
            }
          });
          
          // Also handle avatar fallbacks - hide them if there's an image with a valid src
          clonedDoc.querySelectorAll('[data-slot="avatar"]').forEach((avatar: Element) => {
            const avatarImg = avatar.querySelector('[data-slot="avatar-image"]') as HTMLImageElement;
            const avatarFallback = avatar.querySelector('[data-slot="avatar-fallback"]');
            if (avatarImg && avatarImg.src && avatarImg.src !== 'undefined' && !avatarImg.src.endsWith('undefined')) {
              // Image has a valid src, ensure it shows and hide fallback
              avatarImg.style.display = 'block';
              avatarImg.style.visibility = 'visible';
              avatarImg.style.position = 'absolute';
              avatarImg.style.inset = '0';
              if (avatarFallback) {
                (avatarFallback as HTMLElement).style.display = 'none';
              }
            }
          });
          
          // Hide all elements with ignore-print class
          const ignorePrintElements = clonedDoc.querySelectorAll('.ignore-print');
          ignorePrintElements.forEach((el: Element) => {
            (el as HTMLElement).style.display = 'none';
          });
          
          // Remove border from body text and fix line spacing for print
          clonedDoc.querySelectorAll('.print-no-border').forEach((el: Element) => {
            (el as HTMLElement).style.border = 'none';
            (el as HTMLElement).style.whiteSpace = 'pre-wrap';
            (el as HTMLElement).style.wordWrap = 'break-word';
            (el as HTMLElement).style.overflowWrap = 'break-word';
            (el as HTMLElement).style.lineHeight = '1.5';
          });
          
          // Remove outer border and shadow from card container for print
          const cardPreview = clonedDoc.querySelector('#casting-card-preview');
          if (cardPreview) {
            (cardPreview as HTMLElement).style.border = 'none';
            (cardPreview as HTMLElement).style.boxShadow = 'none';
          }
          
          // Walk through all elements and remove any inline styles with color() function
          const allElements = clonedDoc.querySelectorAll('*');
          allElements.forEach((el: Element) => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.style) {
              const cssText = htmlEl.style.cssText;
              if (cssText && (cssText.includes('color(') || cssText.includes('oklch') || cssText.includes('oklab'))) {
                htmlEl.style.cssText = cssText
                  .replace(/color\([^)]+\)/g, '#000000')
                  .replace(/oklch\([^)]+\)/g, '#000000')
                  .replace(/oklab\([^)]+\)/g, '#000000');
              }
            }
          });
        },
      });

      // Remove the override style after html2canvas is done
      document.getElementById('print-override-style')?.remove();

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(pdfWidth / imgWidth, pdfHeight / imgHeight);
      const imgX = (pdfWidth - imgWidth * ratio) / 2;
      const imgY = (pdfHeight - imgHeight * ratio) / 2;

      pdf.addImage(imgData, 'PNG', imgX, imgY, imgWidth * ratio, imgHeight * ratio);
      const contestantDisplayName = selectedContestant.name || `${selectedContestant.firstName || ''} ${selectedContestant.lastName || ''}`.trim() || 'Unknown';
      pdf.save(`${contestantDisplayName.replace(/\s+/g, '_')}_CastingCard.pdf`);
      
      toast({ title: "PDF Downloaded!", description: "Casting card saved as PDF" });
    } catch (error: any) {
      console.error('PDF generation error:', error);
      // Clean up on error too
      document.getElementById('print-override-style')?.remove();
      toast({ title: "PDF Error", description: error.message || "Failed to generate PDF", variant: "destructive" });
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  // Print the card as an image - guaranteed pixel-perfect match
  const handlePrint = async () => {
    const element = document.getElementById('casting-card-preview');
    if (!element) {
      toast({ title: "Error", description: "Card preview not found", variant: "destructive" });
      return;
    }

    // Show reminder about landscape orientation
    toast({ 
      title: "Print Tip", 
      description: "Select 'Landscape' orientation in the print dialog for correct formatting." 
    });

    try {
      // Preload all images first
      await preloadImages(element);
      
      // Temporarily reset transform for capture
      const originalTransform = (element as HTMLElement).style.transform;
      (element as HTMLElement).style.transform = 'none';
      
      // Capture as canvas using html2canvas
      const html2canvas = (await import('html2canvas')).default;
      
      // Inject CSS override BEFORE html2canvas parses stylesheets
      const printOverrideStyle = document.createElement('style');
      printOverrideStyle.id = 'print-override-style-print';
      printOverrideStyle.textContent = `
        #casting-card-preview, #casting-card-preview * {
          background-color: inherit !important;
          border-color: inherit !important;
        }
        /* Casting card specific colors - must override inherit with higher specificity */
        #casting-card-preview .casting-card-header { background: linear-gradient(to right, #b45309, #d97706, #f59e0b) !important; border: 2px solid #000000 !important; }
        #casting-card-preview .casting-card-name { color: #fcd34d !important; }
        #casting-card-preview .casting-card-sponsor { color: #16a34a !important; }
        #casting-card-preview .casting-card-tagline { color: #dc2626 !important; }
        #casting-card-preview .casting-card-producer-label { background-color: #e5e7eb !important; border: 1px solid #d1d5db !important; color: #000000 !important; }
        #casting-card-preview .casting-card-producer-name-print { background-color: #facc15 !important; color: #000000 !important; }
        #casting-card-preview .casting-card-photo-border { border: 4px solid #f59e0b !important; background-color: #f3f4f6 !important; }
      `;
      document.head.appendChild(printOverrideStyle);
      
      const canvas = await html2canvas(element, {
        scale: 3, // Increased scale for better resolution (sharper photos)
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        imageTimeout: 15000,
        ignoreElements: (elem) => {
          return elem.classList?.contains('ignore-print');
        },
        onclone: (clonedDoc) => {
          // Remove CSS color() function references that html2canvas can't parse
          const style = clonedDoc.createElement('style');
          style.textContent = `
            * { 
              --ring: 215 20.2% 65.1% !important;
              --primary: 215 16.3% 46.9% !important;
              --secondary: 210 40% 96.1% !important;
              --accent: 35 91% 55% !important;
              --muted: 210 40% 96.1% !important;
              --background: 0 0% 100% !important;
              --foreground: 0 0% 0% !important;
              --border: 0 0% 80% !important;
            }
            /* Force header gradient colors for print */
            .bg-gradient-to-r.from-amber-700 {
              background: linear-gradient(to right, #b45309, #d97706, #f59e0b) !important;
            }
            /* Hide ignore-print and print-hidden elements */
            .ignore-print, .print-hidden {
              display: none !important;
            }
            /* Show print-only producer name (hidden in UI) with yellow background */
            .casting-card-producer-name-print {
              display: inline-block !important;
              background-color: #facc15 !important;
              color: #000000 !important;
              padding: 8px 16px !important;
              font-weight: bold !important;
            }
            /* Remove border from body text for print */
            .print-no-border {
              border: none !important;
              white-space: pre-wrap !important;
              word-wrap: break-word !important;
              overflow-wrap: break-word !important;
              line-height: 1.5 !important;
            }
            /* Force casting card colors for print rendering */
            .casting-card-name {
              color: #fcd34d !important;
            }
            .casting-card-sponsor {
              color: #16a34a !important;
            }
            .casting-card-tagline {
              color: #dc2626 !important;
            }
          `;
          clonedDoc.head.appendChild(style);
          
          // Fix header gradient manually
          const headers = clonedDoc.querySelectorAll('.bg-gradient-to-r');
          headers.forEach((header: Element) => {
            const htmlHeader = header as HTMLElement;
            if (htmlHeader.classList.contains('from-amber-700')) {
              htmlHeader.style.background = 'linear-gradient(to right, #b45309, #d97706, #f59e0b)';
            }
          });
          
          // Fix casting card header and colors explicitly
          clonedDoc.querySelectorAll('.casting-card-header').forEach((el: Element) => {
            (el as HTMLElement).style.background = 'linear-gradient(to right, #b45309, #d97706, #f59e0b)';
            (el as HTMLElement).style.border = '2px solid #000000';
          });
          clonedDoc.querySelectorAll('.casting-card-name').forEach((el: Element) => {
            (el as HTMLElement).style.color = '#fcd34d';
            (el as HTMLElement).style.lineHeight = '80px';
            (el as HTMLElement).style.margin = '0';
            (el as HTMLElement).style.marginTop = '-24px';
            (el as HTMLElement).style.paddingLeft = '16px';
          });
          clonedDoc.querySelectorAll('.casting-card-sponsor').forEach((el: Element) => {
            (el as HTMLElement).style.color = '#16a34a';
          });
          clonedDoc.querySelectorAll('.casting-card-tagline').forEach((el: Element) => {
            (el as HTMLElement).style.color = '#dc2626';
          });
          clonedDoc.querySelectorAll('.casting-card-producer-label').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#e5e7eb';
            (el as HTMLElement).style.border = '1px solid #d1d5db';
            (el as HTMLElement).style.color = '#000000';
          });
          clonedDoc.querySelectorAll('.casting-card-producer-name').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#facc15';
            (el as HTMLElement).style.color = '#000000';
          });
          // Also style the print-only producer name span
          clonedDoc.querySelectorAll('.casting-card-producer-name-print').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#facc15';
            (el as HTMLElement).style.color = '#000000';
            (el as HTMLElement).style.display = 'inline-block';
            (el as HTMLElement).style.position = 'static';
            (el as HTMLElement).style.left = 'auto';
            (el as HTMLElement).style.padding = '8px 16px';
            (el as HTMLElement).style.fontWeight = 'bold';
          });
          // Producer corner in bottom RIGHT - ensure positioning shows in print
          clonedDoc.querySelectorAll('.casting-card-producer-corner').forEach((el: Element) => {
            (el as HTMLElement).style.position = 'absolute';
            (el as HTMLElement).style.bottom = '16px';
            (el as HTMLElement).style.right = '16px';
            (el as HTMLElement).style.left = 'auto';
            (el as HTMLElement).style.zIndex = '9999';
            (el as HTMLElement).style.display = 'flex';
            (el as HTMLElement).style.alignItems = 'center';
            (el as HTMLElement).style.visibility = 'visible';
            (el as HTMLElement).style.opacity = '1';
          });
          // Ensure parent casting-card-preview doesn't clip the producer corner
          const cardPreviewForProducer = clonedDoc.querySelector('#casting-card-preview');
          if (cardPreviewForProducer) {
            (cardPreviewForProducer as HTMLElement).style.overflow = 'visible';
          }
          // Style producer label (gray background) - matching height with name box
          clonedDoc.querySelectorAll('.casting-card-producer-corner .casting-card-producer-label').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#e5e7eb';
            (el as HTMLElement).style.border = '1px solid #d1d5db';
            (el as HTMLElement).style.color = '#000000';
            (el as HTMLElement).style.display = 'flex';
            (el as HTMLElement).style.alignItems = 'center';
            (el as HTMLElement).style.padding = '8px 16px';
            (el as HTMLElement).style.fontWeight = '600';
            (el as HTMLElement).style.fontSize = '14px';
            (el as HTMLElement).style.height = '36px';
            (el as HTMLElement).style.boxSizing = 'border-box';
          });
          // Style producer name (yellow background) - make visible for print, matching height
          clonedDoc.querySelectorAll('.casting-card-producer-corner .casting-card-producer-name-print').forEach((el: Element) => {
            (el as HTMLElement).style.backgroundColor = '#facc15';
            (el as HTMLElement).style.color = '#000000';
            (el as HTMLElement).style.display = 'flex';
            (el as HTMLElement).style.alignItems = 'center';
            (el as HTMLElement).style.position = 'static';
            (el as HTMLElement).style.left = 'auto';
            (el as HTMLElement).style.padding = '8px 16px';
            (el as HTMLElement).style.fontWeight = 'bold';
            (el as HTMLElement).style.fontSize = '14px';
            (el as HTMLElement).style.minWidth = '120px';
            (el as HTMLElement).style.height = '36px';
            (el as HTMLElement).style.boxSizing = 'border-box';
          });
          clonedDoc.querySelectorAll('.casting-card-photo-border').forEach((el: Element) => {
            (el as HTMLElement).style.border = '4px solid #f59e0b';
            (el as HTMLElement).style.backgroundColor = '#f3f4f6';
            // Fix photo container width - ensure it doesn't shrink
            (el as HTMLElement).style.minWidth = '256px';
          });
          
          // Fix main photo container explicit dimensions - w-64 = 16rem = 256px
          clonedDoc.querySelectorAll('.w-64.flex-shrink-0').forEach((el: Element) => {
            (el as HTMLElement).style.width = '256px';
            (el as HTMLElement).style.minWidth = '256px';
            (el as HTMLElement).style.maxWidth = '256px';
            (el as HTMLElement).style.flexShrink = '0';
            (el as HTMLElement).style.flexBasis = '256px';
          });
          
          // Fix the inner photo wrapper - h-72 = 18rem = 288px  
          clonedDoc.querySelectorAll('.w-full.h-72').forEach((el: Element) => {
            (el as HTMLElement).style.width = '100%';
            (el as HTMLElement).style.height = '288px';
            (el as HTMLElement).style.minHeight = '288px';
          });
          
          // Ensure all images have explicit dimensions and proper object-fit
          clonedDoc.querySelectorAll('img').forEach((img: Element) => {
            const htmlImg = img as HTMLImageElement;
            if (!htmlImg.style.objectFit) {
              htmlImg.style.objectFit = 'cover';
            }
            // Add sharpness/rendering hints
            htmlImg.style.imageRendering = 'auto'; // Browser default usually better for photos than crisp-edges
            htmlImg.style.webkitFontSmoothing = 'antialiased';
            // Force visibility for all images
            htmlImg.style.display = 'block';
            htmlImg.style.visibility = 'visible';
            htmlImg.style.opacity = '1';
          });
          
          // Fix main photo - html2canvas doesn't handle object-fit:cover properly
          // Convert img to background-image on parent container which works better
          clonedDoc.querySelectorAll('.casting-card-photo-border').forEach((container: Element) => {
            const img = container.querySelector('img') as HTMLImageElement;
            if (img && img.src) {
              // Find the inner wrapper div that contains the image
              const wrapper = img.parentElement;
              if (wrapper) {
                // Apply the image as background on the wrapper
                wrapper.style.backgroundImage = `url("${img.src}")`;
                wrapper.style.backgroundSize = 'cover';
                wrapper.style.backgroundPosition = 'center top';
                wrapper.style.backgroundRepeat = 'no-repeat';
                wrapper.style.imageRendering = 'auto'; // Sharpness hint
                // Preserve the transform (zoom/pan) if any
                const imgTransform = img.style.transform;
                if (imgTransform && imgTransform !== 'none') {
                  wrapper.style.transform = imgTransform;
                }
                // Hide the original img element
                img.style.opacity = '0';
                img.style.visibility = 'hidden';
              }
            }
          });
          
          // Fix partner photo sizes - convert Tailwind w-36 h-36 (and variants) to explicit pixels
          // w-36 = 144px, w-28 = 112px, w-24 = 96px, w-20 = 80px
          clonedDoc.querySelectorAll('.w-36.h-36').forEach((el: Element) => {
            (el as HTMLElement).style.width = '144px';
            (el as HTMLElement).style.height = '144px';
            (el as HTMLElement).style.minWidth = '144px';
            (el as HTMLElement).style.minHeight = '144px';
          });
          clonedDoc.querySelectorAll('.w-28.h-28').forEach((el: Element) => {
            (el as HTMLElement).style.width = '112px';
            (el as HTMLElement).style.height = '112px';
            (el as HTMLElement).style.minWidth = '112px';
            (el as HTMLElement).style.minHeight = '112px';
          });
          clonedDoc.querySelectorAll('.w-24.h-24').forEach((el: Element) => {
            (el as HTMLElement).style.width = '96px';
            (el as HTMLElement).style.height = '96px';
            (el as HTMLElement).style.minWidth = '96px';
            (el as HTMLElement).style.minHeight = '96px';
          });
          clonedDoc.querySelectorAll('.w-20.h-20').forEach((el: Element) => {
            (el as HTMLElement).style.width = '80px';
            (el as HTMLElement).style.height = '80px';
            (el as HTMLElement).style.minWidth = '80px';
            (el as HTMLElement).style.minHeight = '80px';
          });
          
          // Fix Avatar images - Radix Avatar uses conditional rendering that doesn't transfer during cloning
          // Find all avatar containers and ensure images render properly
          clonedDoc.querySelectorAll('[data-slot="avatar-image"]').forEach((el: Element) => {
            const img = el as HTMLImageElement;
            if (img.src) {
              img.style.objectFit = 'cover';
              img.style.width = '100%';
              img.style.height = '100%';
              img.style.display = 'block';
              img.style.visibility = 'visible';
              img.style.opacity = '1';
            }
          });
          
          // Also handle avatar fallbacks - hide them if there's an image with a valid src
          clonedDoc.querySelectorAll('[data-slot="avatar"]').forEach((avatar: Element) => {
            const avatarImg = avatar.querySelector('[data-slot="avatar-image"]') as HTMLImageElement;
            const avatarFallback = avatar.querySelector('[data-slot="avatar-fallback"]');
            if (avatarImg && avatarImg.src && avatarImg.src !== 'undefined' && !avatarImg.src.endsWith('undefined')) {
              // Image has a valid src, ensure it shows and hide fallback
              avatarImg.style.display = 'block';
              avatarImg.style.visibility = 'visible';
              avatarImg.style.position = 'absolute';
              avatarImg.style.inset = '0';
              if (avatarFallback) {
                (avatarFallback as HTMLElement).style.display = 'none';
              }
            }
          });
          
          // Hide all elements with ignore-print class
          const ignorePrintElements = clonedDoc.querySelectorAll('.ignore-print');
          ignorePrintElements.forEach((el: Element) => {
            (el as HTMLElement).style.display = 'none';
          });
          
          // Remove border from body text and fix line spacing for print
          clonedDoc.querySelectorAll('.print-no-border').forEach((el: Element) => {
            (el as HTMLElement).style.border = 'none';
            (el as HTMLElement).style.whiteSpace = 'pre-wrap';
            (el as HTMLElement).style.wordWrap = 'break-word';
            (el as HTMLElement).style.overflowWrap = 'break-word';
            (el as HTMLElement).style.lineHeight = '1.5';
          });
          
          // Remove outer border and shadow from card container for print
          const cardPreview = clonedDoc.querySelector('#casting-card-preview');
          if (cardPreview) {
            (cardPreview as HTMLElement).style.border = 'none';
            (cardPreview as HTMLElement).style.boxShadow = 'none';
          }
          
          // Walk through all elements and remove any inline styles with color() function
          const allElements = clonedDoc.querySelectorAll('*');
          allElements.forEach((el: Element) => {
            const htmlEl = el as HTMLElement;
            if (htmlEl.style) {
              const cssText = htmlEl.style.cssText;
              if (cssText && (cssText.includes('color(') || cssText.includes('oklch') || cssText.includes('oklab'))) {
                htmlEl.style.cssText = cssText
                  .replace(/color\([^)]+\)/g, '#000000')
                  .replace(/oklch\([^)]+\)/g, '#000000')
                  .replace(/oklab\([^)]+\)/g, '#000000');
              }
            }
          });
        },
      });
      
      // Clean up the override style
      document.getElementById('print-override-style-print')?.remove();
      
      // Restore transform
      (element as HTMLElement).style.transform = originalTransform;
      
      const imgData = canvas.toDataURL('image/png');
      
      // Open print window with the image
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast({ title: "Error", description: "Could not open print window. Please allow popups.", variant: "destructive" });
        return;
      }

      // Calculate image dimensions - A4 landscape is 297mm x 210mm (1.414:1 ratio)
      const a4Width = 297; // mm
      const a4Height = 210; // mm
      
      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Casting Card - ${selectedContestant?.name || 'Print'}</title>
          <style>
            @page {
              size: ${a4Width}mm ${a4Height}mm landscape;
              margin: 0;
            }
            @media print {
              @page {
                size: landscape;
                margin: 0;
              }
              html, body {
                margin: 0 !important;
                padding: 0 !important;
                width: 100% !important;
                height: 100% !important;
                overflow: hidden !important;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
              .print-container {
                width: 100vw !important;
                height: 100vh !important;
                display: flex !important;
                justify-content: center !important;
                align-items: center !important;
              }
              img {
                max-width: 100% !important;
                max-height: 100% !important;
                width: auto !important;
                height: auto !important;
                object-fit: contain !important;
              }
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            html, body {
              margin: 0;
              padding: 0;
              width: 100%;
              height: 100vh;
              overflow: hidden;
              background: white;
            }
            .print-container {
              width: 100%;
              height: 100vh;
              display: flex;
              justify-content: center;
              align-items: center;
              background: white;
            }
            img {
              max-width: 100%;
              max-height: 100vh;
              object-fit: contain;
              display: block;
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            <img src="${imgData}" />
          </div>
          <script>
            window.onload = function() {
              // Alert user to select landscape orientation
              setTimeout(function() { 
                window.print(); 
              }, 300);
            };
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    } catch (error: any) {
      console.error('Print error:', error);
      // Clean up on error too
      document.getElementById('print-override-style-print')?.remove();
      toast({ title: "Print Error", description: error.message || "Failed to generate print view", variant: "destructive" });
    }
  };

  // Undo function
  const handleUndo = () => {
    if (undoHistory.length > 0 && cardData) {
      const previousState = undoHistory[undoHistory.length - 1];
      setRedoHistory(prev => [...prev.slice(-(maxHistorySize - 1)), cardData]);
      setUndoHistory(prev => prev.slice(0, -1));
      setCardData(previousState);
      hasUnsavedChanges.current = true;
      
      // Trigger save after undo
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      autoSaveTimeoutRef.current = setTimeout(() => {
        setAutoSaveStatus('saving');
        saveMutation.mutate({ ...previousState, skipInvalidate: true } as any);
      }, 1000);
    }
  };
  
  // Redo function
  const handleRedo = () => {
    if (redoHistory.length > 0 && cardData) {
      const nextState = redoHistory[redoHistory.length - 1];
      setUndoHistory(prev => [...prev.slice(-(maxHistorySize - 1)), cardData]);
      setRedoHistory(prev => prev.slice(0, -1));
      setCardData(nextState);
      hasUnsavedChanges.current = true;
      
      // Trigger save after redo
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
      autoSaveTimeoutRef.current = setTimeout(() => {
        setAutoSaveStatus('saving');
        saveMutation.mutate({ ...nextState, skipInvalidate: true } as any);
      }, 1000);
    }
  };

  const updateField = (field: keyof CastingCardData, value: any) => {
    try {
      if (cardData) {
        // Push current state to undo history before making changes
        setUndoHistory(prev => [...prev.slice(-(maxHistorySize - 1)), cardData]);
        // Clear redo history on new change
        setRedoHistory([]);
        
        // Create new state with the update
        const newCardData = { ...cardData, [field]: value };
        setCardData(newCardData);
        // Keep ref in sync so debounced save uses latest data
        cardDataRef.current = newCardData;
        hasUnsavedChanges.current = true;
        
        // Debounced auto-save
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
        }
        autoSaveTimeoutRef.current = setTimeout(() => {
          if (hasUnsavedChanges.current && cardDataRef.current) {
            setAutoSaveStatus('saving');
            // Use ref to get latest data at save time, not stale closure data
            const dataToSave = { ...cardDataRef.current, skipInvalidate: true };
            saveMutation.mutate(dataToSave as any, {
              onSuccess: () => {
                hasUnsavedChanges.current = false;
                setAutoSaveStatus('saved');
                // Mark save time to prevent query refetches from overwriting
                lastLocalSaveTime.current = Date.now();
                setTimeout(() => setAutoSaveStatus('idle'), 2000);
              },
              onError: () => {
                setAutoSaveStatus('idle');
            }
          });
          }
        }, 1500); // Auto-save after 1.5 seconds of inactivity
      }
    } catch (error) {
      console.error('Error updating field:', error);
    }
  };

  // Save ALL contentEditable content when user leaves the tab (prevents data loss)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && cardDataRef.current) {
        // Cancel any pending debounced saves
        if (autoSaveTimeoutRef.current) {
          clearTimeout(autoSaveTimeoutRef.current);
          autoSaveTimeoutRef.current = null;
        }
        
        // Capture current body text content from the refs before tab becomes hidden
        const bodyTextElement = bodyTextRef.current || bodyTextRefFs.current;
        let needsSave = hasUnsavedChanges.current;
        let dataToSave = { ...cardDataRef.current };
        
        if (bodyTextElement) {
          const currentHtml = bodyTextElement.innerHTML;
          if (currentHtml && currentHtml !== cardDataRef.current.bodyText) {
            dataToSave.bodyText = currentHtml;
            needsSave = true;
          }
        }
        
        // If we have unsaved changes OR body text changed, save immediately
        if (needsSave) {
          console.log('[Visibility] Tab hidden - saving unsaved changes immediately');
          setAutoSaveStatus('saving');
          cardDataRef.current = dataToSave;
          setCardData(dataToSave);
          
          saveMutation.mutate({ ...dataToSave, skipInvalidate: true } as any, {
            onSuccess: () => {
              hasUnsavedChanges.current = false;
              setAutoSaveStatus('saved');
              setTimeout(() => setAutoSaveStatus('idle'), 2000);
            },
            onError: (error) => {
              console.error('[Visibility] Save on tab hide failed:', error);
              setAutoSaveStatus('idle');
            }
          });
        }
      }
    };
    
    // Also handle beforeunload for browser close/refresh
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges.current && cardDataRef.current) {
        // Try to save synchronously using sendBeacon if available
        const dataToSend = JSON.stringify({ ...cardDataRef.current, skipInvalidate: true });
        navigator.sendBeacon?.(`/api/casting-cards/${cardDataRef.current.contestantId}`, 
          new Blob([dataToSend], { type: 'application/json' }));
        
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [saveMutation]);

  // Store the last selection for formatting operations
  const lastSelectionRef = useRef<{ range: Range; element: Element } | null>(null);
  
  // Save selection when user selects text in contentEditable
  const saveSelectionForFormatting = () => {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
      const range = selection.getRangeAt(0);
      const element = document.activeElement;
      if (element) {
        lastSelectionRef.current = { range: range.cloneRange(), element };
      }
    }
  };
  
  // Restore selection from saved ref
  const restoreSelection = (): boolean => {
    if (!lastSelectionRef.current) return false;
    
    try {
      const { range, element } = lastSelectionRef.current;
      
      // Focus the element first
      if (element && 'focus' in element) {
        (element as HTMLElement).focus();
      }
      
      // Restore the selection
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
        return true;
      }
    } catch (e) {
      console.warn('Failed to restore selection:', e);
    }
    return false;
  };
  
  // Continuously save selection on any selection change (for toolbar interactions)
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
        const range = selection.getRangeAt(0);
        const activeElement = document.activeElement;
        // Only save if selection is within a contentEditable element
        if (activeElement?.getAttribute('contenteditable') === 'true') {
          lastSelectionRef.current = { range: range.cloneRange(), element: activeElement };
        }
      }
    };
    
    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);
  
  // Keyboard shortcuts for formatting (Ctrl+B, Ctrl+I, Ctrl+U)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if we're in a contentEditable element
      const activeElement = document.activeElement;
      if (!activeElement?.getAttribute('contenteditable')) return;
      
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'b':
            e.preventDefault();
            formatBold();
            break;
          case 'i':
            e.preventDefault();
            formatItalic();
            break;
          case 'u':
            e.preventDefault();
            formatUnderline();
            break;
        }
      }
    };
    
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
  
  // Trigger debounced auto-save for formatting operations
  const triggerFormattingAutoSave = () => {
    hasUnsavedChanges.current = true;
    
    // Clear existing timeout and set a new one
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    autoSaveTimeoutRef.current = setTimeout(() => {
      if (hasUnsavedChanges.current && cardData) {
        // Get the current body text content from the DOM (check fullscreen first, then regular)
        const fullscreenEditor = document.querySelector('[data-testid="body-text-editor-fullscreen"]') as HTMLElement;
        const regularEditor = document.querySelector('[data-testid="body-text-editor"]') as HTMLElement;
        // Use fullscreen if visible, otherwise regular
        const bodyTextElement = (fullscreenEditor && fullscreenEditor.offsetParent !== null) ? fullscreenEditor : regularEditor;
        const currentBodyText = bodyTextElement?.innerHTML || cardData.bodyText;
        
        const dataToSave = { ...cardData, bodyText: currentBodyText };
        setAutoSaveStatus('saving');
        saveMutation.mutate(dataToSave, {
          onSuccess: () => {
            hasUnsavedChanges.current = false;
            setAutoSaveStatus('saved');
            setTimeout(() => setAutoSaveStatus('idle'), 2000);
          },
          onError: () => {
            setAutoSaveStatus('idle');
          }
        });
      }
    }, 1500); // 1.5 second delay for formatting changes
  };
  
  // Robust text formatting that uses saved selection
  const applyFormat = (command: string, value?: string) => {
    try {
      // First try to use current selection
      const selection = window.getSelection();
      const hasCurrentSelection = selection && selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed;
      
      // If no current selection, restore from saved
      if (!hasCurrentSelection) {
        restoreSelection();
      }
      
      // Apply the format
      document.execCommand(command, false, value);
      
      // Trigger debounced auto-save
      triggerFormattingAutoSave();
      
      // Re-save the selection after formatting (selection may have changed)
      setTimeout(() => {
        const newSelection = window.getSelection();
        if (newSelection && newSelection.rangeCount > 0 && !newSelection.getRangeAt(0).collapsed) {
          const range = newSelection.getRangeAt(0);
          const activeElement = document.activeElement;
          if (activeElement?.getAttribute('contenteditable') === 'true') {
            lastSelectionRef.current = { range: range.cloneRange(), element: activeElement };
          }
        }
      }, 0);
    } catch (e) {
      console.error('Error applying format:', e);
    }
  };

  const formatBold = () => applyFormat('bold');
  const formatItalic = () => applyFormat('italic');
  const formatUnderline = () => applyFormat('underline');
  const formatColor = (color: string) => applyFormat('foreColor', color);
  
  // Predefined font size steps for the up/down arrows
  const fontSizeSteps = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72];
  
  const formatFontSize = (size: string) => {
    try {
      let selection = window.getSelection();
      let range: Range | null = null;
      let targetElement: Element | null = null;
      
      // Try saved selection first (more reliable for dropdowns)
      if (lastSelectionRef.current && lastSelectionRef.current.range && !lastSelectionRef.current.range.collapsed) {
        range = lastSelectionRef.current.range;
        targetElement = lastSelectionRef.current.element;
      }
      // Fall back to current selection
      else if (selection && selection.rangeCount > 0 && !selection.getRangeAt(0).collapsed) {
        range = selection.getRangeAt(0);
        targetElement = document.activeElement;
      }
      
      if (!range || range.collapsed) {
        console.log('No valid selection for font size change');
        return;
      }
      
      // Get current font size from selection - traverse up DOM to find accurate size
      const getCurrentFontSize = (): number => {
        // First, try to find font size from the actual selected node
        let node: Node | null = range!.startContainer;
        
        // If it's a text node, get its parent element
        if (node.nodeType === Node.TEXT_NODE) {
          node = node.parentElement;
        }
        
        // Traverse up the DOM looking for explicit font-size styling
        while (node && node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement;
          
          // Check inline style first (most specific)
          if (el.style && el.style.fontSize) {
            const parsed = parseInt(el.style.fontSize);
            if (!isNaN(parsed) && parsed > 0) {
              return parsed;
            }
          }
          
          // Move up to parent
          node = el.parentElement;
        }
        
        // Fall back to computed style on the start container's parent
        const parentEl = range!.startContainer.parentElement;
        if (parentEl) {
          const computedStyle = window.getComputedStyle(parentEl);
          const computed = parseInt(computedStyle.fontSize);
          if (!isNaN(computed) && computed > 0) {
            return computed;
          }
        }
        
        return 20; // Default body text size
      };
      
      // Handle 'bigger' and 'smaller' for A↑ and A↓ buttons
      let targetSize = size;
      if (size === 'bigger' || size === 'smaller') {
        const currentSize = getCurrentFontSize();
        
        if (size === 'bigger') {
          // Find next step up - if current size is between steps, go to next higher step
          const nextStep = fontSizeSteps.find(s => s > currentSize);
          if (nextStep) {
            targetSize = String(nextStep);
          } else {
            // Already at or above max, just add 4px
            targetSize = String(currentSize + 4);
          }
        } else {
          // Find next step down - if current size is between steps, go to next lower step
          const prevSteps = fontSizeSteps.filter(s => s < currentSize);
          if (prevSteps.length > 0) {
            targetSize = String(prevSteps[prevSteps.length - 1]);
          } else {
            // Already at or below min, just subtract 2px but not below 6
            targetSize = String(Math.max(6, currentSize - 2));
          }
        }
      }
      
      // Restore focus to the target element first
      if (targetElement && 'focus' in targetElement) {
        (targetElement as HTMLElement).focus();
      }
      
      // Clone the range to work with
      const workingRange = range.cloneRange();
      
      // Extract selected content
      const selectedContent = workingRange.extractContents();
      
      // Create wrapper span with the new font size
      const span = document.createElement('span');
      span.style.fontSize = `${targetSize}px`;
      
      // Flatten any existing font-size spans to avoid deep nesting
      const flattenFontSizeSpans = (fragment: DocumentFragment): void => {
        // Find all spans with only font-size styling and unwrap them
        const spans = fragment.querySelectorAll('span');
        spans.forEach(spanEl => {
          // Check if this span only has font-size styling
          if (spanEl.style.length === 1 && spanEl.style.fontSize) {
            // Remove the font-size so it inherits from parent
            spanEl.style.removeProperty('font-size');
            // If no other styles remain, unwrap the span
            if (spanEl.style.length === 0 && !spanEl.className) {
              const parent = spanEl.parentNode;
              while (spanEl.firstChild) {
                parent?.insertBefore(spanEl.firstChild, spanEl);
              }
              parent?.removeChild(spanEl);
            }
          }
        });
      };
      
      // Flatten before appending
      flattenFontSizeSpans(selectedContent);
      
      span.appendChild(selectedContent);
      workingRange.insertNode(span);
      
      // Re-select the content and update saved selection immediately
      const newRange = document.createRange();
      newRange.selectNodeContents(span);
      
      selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(newRange);
      }
      
      // Update saved selection so subsequent changes work
      if (targetElement) {
        lastSelectionRef.current = { range: newRange.cloneRange(), element: targetElement };
      }
      
      // Trigger debounced auto-save
      triggerFormattingAutoSave();
    } catch (error) {
      console.error('Error applying font size:', error);
    }
  };

  // Error fallback for fullscreen mode
  const fullscreenErrorFallback = (
    <div className="fixed inset-0 z-50 bg-white overflow-auto p-6 flex items-center justify-center">
      <Card className="p-6 max-w-md">
        <div className="text-center">
          <div className="text-red-500 text-4xl mb-4">⚠️</div>
          <h3 className="font-semibold text-lg mb-2">Something went wrong</h3>
          <p className="text-muted-foreground mb-4">An error occurred while displaying the casting card.</p>
          <Button onClick={() => { setIsFullscreen(false); setRenderError(null); }}>
            Exit Fullscreen
          </Button>
        </div>
      </Card>
    </div>
  );

  // PowerPoint import handlers
  const handlePptxFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setPptxFile(file);
    setPptxImportLoading(true);
    setPptxPreviewData(null);
    
    try {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/casting-cards/import-preview', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to parse PowerPoint file');
      }
      
      const data = await response.json();
      setPptxPreviewData(data.cards.map((card: any) => ({
        ...card,
        selectedContestantId: card.match?.id || undefined
      })));
    } catch (error: any) {
      toast({
        title: "Import Error",
        description: error.message,
        variant: "destructive"
      });
      setPptxPreviewData(null);
    } finally {
      setPptxImportLoading(false);
    }
    
    e.target.value = '';
  };

  const handlePptxSearch = async (query: string, slideNumber: number) => {
    setPptxSearchQuery(query);
    setPptxSearchingFor(slideNumber);
    
    if (!query.trim()) {
      setPptxSearchResults([]);
      return;
    }
    
    try {
      const response = await fetch(`/api/contestants/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const results = await response.json();
        setPptxSearchResults(results);
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  const handlePptxSelectContestant = (slideNumber: number, contestantId: string, contestantName: string) => {
    if (!pptxPreviewData) return;
    
    setPptxPreviewData(prev => prev?.map(card => 
      card.slideNumber === slideNumber 
        ? { ...card, selectedContestantId: contestantId, match: { id: contestantId, name: contestantName } }
        : card
    ) || null);
    
    setPptxSearchingFor(null);
    setPptxSearchQuery('');
    setPptxSearchResults([]);
  };

  const handlePptxImport = async () => {
    if (!pptxFile || !pptxPreviewData) return;
    
    const cardsToImport = pptxPreviewData.filter(card => card.selectedContestantId);
    if (cardsToImport.length === 0) {
      toast({
        title: "No Cards Selected",
        description: "Please select at least one contestant match to import.",
        variant: "destructive"
      });
      return;
    }
    
    setPptxImportLoading(true);
    
    try {
      const formData = new FormData();
      formData.append('file', pptxFile);
      formData.append('matches', JSON.stringify(cardsToImport.map(card => ({
        slideNumber: card.slideNumber,
        contestantId: card.selectedContestantId
      }))));
      
      const response = await fetch('/api/casting-cards/import', {
        method: 'POST',
        body: formData,
        credentials: 'include'
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Import failed');
      }
      
      const result = await response.json();
      
      toast({
        title: "Import Successful",
        description: `Imported ${result.imported} casting cards.`,
      });
      
      // Refresh casting cards data
      queryClient.invalidateQueries({ queryKey: ['/api/casting-cards'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      
      // Close dialog and reset state
      setPptxImportOpen(false);
      setPptxFile(null);
      setPptxPreviewData(null);
    } catch (error: any) {
      toast({
        title: "Import Failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setPptxImportLoading(false);
    }
  };

  // Fullscreen mode renders just the card
  if (isFullscreen && selectedContestant && cardData) {
    // Safely access cardData properties with defaults
    const safeCardData = {
      ...cardData,
      manualCompanions: cardData.manualCompanions || [],
      bulletPoints: cardData.bulletPoints || defaultBulletPoints,
      fullName: cardData.fullName || selectedContestant?.name || '',
      ageState: cardData.ageState || '',
      occupation: cardData.occupation || '',
      sponsorCategory: cardData.sponsorCategory || '',
      tagline: cardData.tagline || '',
      producerName: cardData.producerName || '',
    };

    return (
      <SafeRender fallback={fullscreenErrorFallback} onError={(e) => { console.error('Fullscreen render error:', e); setRenderError(e.message); }}>
      <div className="fixed inset-0 z-50 bg-white overflow-auto p-6" data-testid="casting-card-fullscreen">
        {/* Hidden file inputs for fullscreen mode */}
        <input
          type="file"
          ref={mainPhotoInputRef}
          className="hidden"
          accept="image/*,.heic,.heif,.webp,.avif"
          onChange={(e) => {
            try {
              const file = e.target.files?.[0];
              if (file && selectedContestant) {
                handlePhotoUpload(selectedContestant.id, file);
              }
              e.target.value = '';
            } catch (error) {
              console.error('Photo upload error:', error);
              toast({ title: "Upload error", description: "Failed to process photo", variant: "destructive" });
            }
          }}
        />
        {/* Companion photo inputs for fullscreen mode */}
        {(cardData.manualCompanions || []).map((companion) => (
          <input
            key={companion.id}
            type="file"
            className="hidden"
            accept="image/*,.heic,.heif,.webp,.avif"
            ref={(el) => { companionPhotoRefs.current[companion.id] = el; }}
            onChange={(e) => {
              try {
                const file = e.target.files?.[0];
                if (file) handleCompanionPhotoUpload(companion.id, file);
                e.target.value = '';
              } catch (error) {
                console.error('Companion photo error:', error);
                toast({ title: "Upload error", description: "Failed to process photo", variant: "destructive" });
              }
            }}
          />
        ))}
        <div className="max-w-5xl mx-auto">
          <div className="sticky top-0 bg-white py-2 border-b z-10 space-y-2">
            {/* Toggle toolbar visibility button - always visible */}
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setHideToolbar(!hideToolbar)}
                className="h-7 px-2 text-gray-500 hover:text-gray-700"
                data-testid="btn-toggle-toolbar"
                title={hideToolbar ? "Show toolbar" : "Hide toolbar"}
              >
                {hideToolbar ? <Eye className="h-4 w-4 mr-1" /> : <EyeOff className="h-4 w-4 mr-1" />}
                {hideToolbar ? "Show Toolbar" : "Hide Toolbar"}
              </Button>
              {/* Always show Exit button even when toolbar is hidden */}
              {hideToolbar && (
                <Button size="sm" variant="outline" onClick={syncAndExitFullscreen} data-testid="btn-exit-fullscreen-mini">
                  <Minimize2 className="h-4 w-4 mr-1" />
                  Exit
                </Button>
              )}
            </div>
            
            {/* Main toolbar - can be hidden */}
            {!hideToolbar && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold">{selectedContestant.name || `${selectedContestant.firstName || ''} ${selectedContestant.lastName || ''}`.trim() || 'Unknown'} - Casting Card</h2>
                {/* Draft Complete toggle */}
                <Button
                  size="sm"
                  variant={cardData?.isDraftComplete ? "default" : "outline"}
                  onClick={toggleDraftCompleteAndSave}
                  disabled={saveMutation.isPending}
                  className={cardData?.isDraftComplete ? "bg-blue-600 hover:bg-blue-700" : ""}
                  data-testid="btn-toggle-draft-complete-fs"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  {cardData?.isDraftComplete ? 'Draft Complete' : 'Draft Complete'}
                </Button>
                {/* RX Ready toggle */}
                <Button
                  size="sm"
                  variant={cardData?.isReady ? "default" : "outline"}
                  onClick={toggleReadyAndSave}
                  disabled={saveMutation.isPending}
                  className={cardData?.isReady ? "bg-green-600 hover:bg-green-700" : ""}
                  data-testid="btn-toggle-ready-fs"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  {cardData?.isReady ? 'RX Ready' : 'RX Ready'}
                </Button>
              </div>
              <div className="flex gap-2 items-center">
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending || autoSaveStatus === 'saving'} data-testid="btn-save-card-fs">
                  {saveMutation.isPending || autoSaveStatus === 'saving' ? 'Saving...' : autoSaveStatus === 'saved' ? '✓ Saved' : 'Save'}
                </Button>
                <span className="text-xs text-gray-500">Auto-saves</span>
                {lastKnownUpdatedAt && (
                  <span className="text-xs text-muted-foreground ml-2" title={`Last saved: ${new Date(lastKnownUpdatedAt).toLocaleString()}`}>
                    Last saved: {new Date(lastKnownUpdatedAt).toLocaleTimeString()}
                  </span>
                )}
                <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={isGeneratingPdf} data-testid="btn-download-pdf-fs">
                  <Download className="h-4 w-4 mr-1" />
                  PDF
                </Button>
                <Button size="sm" variant="outline" onClick={() => setVersionHistoryOpen(true)} disabled={!existingCard?.id} data-testid="btn-version-history-fs">
                  <History className="h-4 w-4 mr-1" />
                  History
                </Button>
                <Button size="sm" variant="outline" onClick={handlePrint} data-testid="btn-print-card-fs">
                  <Printer className="h-4 w-4 mr-1" />
                  Print
                </Button>
                <Button size="sm" variant="outline" onClick={syncAndExitFullscreen} data-testid="btn-exit-fullscreen">
                  <Minimize2 className="h-4 w-4 mr-1" />
                  Exit
                </Button>
              </div>
            </div>
            )}
            
            {/* Formatting toolbar - also hidden when toolbar is hidden */}
            {!hideToolbar && (
            <div className="flex items-center gap-1 flex-wrap bg-gray-50 p-2 rounded border">
              <span className="text-xs text-gray-500 mr-2">Format:</span>
              
              {/* Bold, Italic, Underline - use onMouseDown to preserve selection */}
              <Button 
                size="icon" 
                variant="ghost" 
                onMouseDown={(e) => { e.preventDefault(); saveSelectionForFormatting(); formatBold(); }} 
                title="Bold (Ctrl+B)" 
                data-testid="btn-format-bold" 
                className="h-8 w-8"
              >
                <Bold className="h-4 w-4" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                onMouseDown={(e) => { e.preventDefault(); saveSelectionForFormatting(); formatItalic(); }} 
                title="Italic (Ctrl+I)" 
                data-testid="btn-format-italic" 
                className="h-8 w-8"
              >
                <Italic className="h-4 w-4" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                onMouseDown={(e) => { e.preventDefault(); saveSelectionForFormatting(); formatUnderline(); }} 
                title="Underline (Ctrl+U)" 
                data-testid="btn-format-underline" 
                className="h-8 w-8"
              >
                <Underline className="h-4 w-4" />
              </Button>
              
              <div className="w-px h-6 bg-gray-300 mx-1" />
              
              {/* Font Size */}
              <span className="text-xs text-gray-500 ml-1">Size:</span>
              <select 
                onMouseDown={() => saveSelectionForFormatting()}
                onChange={(e) => { 
                  formatFontSize(e.target.value); 
                  e.target.value = '';
                }}
                className="h-8 px-2 text-sm border rounded bg-white cursor-pointer"
                value=""
                data-testid="select-font-size"
              >
                <option value="" disabled>Size</option>
                <option value="8">8</option>
                <option value="10">10</option>
                <option value="12">12</option>
                <option value="14">14</option>
                <option value="16">16</option>
                <option value="18">18</option>
                <option value="20">20</option>
                <option value="24">24</option>
                <option value="28">28</option>
                <option value="32">32</option>
                <option value="36">36</option>
                <option value="40">40</option>
                <option value="48">48</option>
                <option value="56">56</option>
                <option value="72">72</option>
              </select>
              
              {/* Increase/Decrease Font Size buttons (like Word) */}
              <Button 
                size="icon" 
                variant="ghost" 
                onMouseDown={(e) => { e.preventDefault(); saveSelectionForFormatting(); formatFontSize('bigger'); }} 
                title="Increase Font Size" 
                data-testid="btn-font-size-up" 
                className="h-8 w-8"
              >
                <span className="text-sm font-bold">A</span><ChevronUp className="h-3 w-3 -ml-0.5" />
              </Button>
              <Button 
                size="icon" 
                variant="ghost" 
                onMouseDown={(e) => { e.preventDefault(); saveSelectionForFormatting(); formatFontSize('smaller'); }} 
                title="Decrease Font Size" 
                data-testid="btn-font-size-down" 
                className="h-8 w-8"
              >
                <span className="text-sm font-bold">A</span><ChevronDown className="h-3 w-3 -ml-0.5" />
              </Button>
              
              <div className="w-px h-6 bg-gray-300 mx-1" />
              
              {/* Font Colors */}
              <span className="text-xs text-gray-500 ml-1">Color:</span>
              <button onClick={() => formatColor('#000000')} title="Black" data-testid="btn-color-black" className="w-6 h-6 rounded border border-gray-300 bg-black hover:ring-2 hover:ring-offset-1 hover:ring-gray-400" />
              <button onClick={() => formatColor('#dc2626')} title="Red" data-testid="btn-color-red" className="w-6 h-6 rounded border border-gray-300 bg-red-600 hover:ring-2 hover:ring-offset-1 hover:ring-red-400" />
              <button onClick={() => formatColor('#16a34a')} title="Green" data-testid="btn-color-green" className="w-6 h-6 rounded border border-gray-300 bg-green-600 hover:ring-2 hover:ring-offset-1 hover:ring-green-400" />
              <button onClick={() => formatColor('#2563eb')} title="Blue" data-testid="btn-color-blue" className="w-6 h-6 rounded border border-gray-300 bg-blue-600 hover:ring-2 hover:ring-offset-1 hover:ring-blue-400" />
              <button onClick={() => formatColor('#9333ea')} title="Purple" data-testid="btn-color-purple" className="w-6 h-6 rounded border border-gray-300 bg-purple-600 hover:ring-2 hover:ring-offset-1 hover:ring-purple-400" />
              <button onClick={() => formatColor('#ea580c')} title="Orange" data-testid="btn-color-orange" className="w-6 h-6 rounded border border-gray-300 bg-orange-600 hover:ring-2 hover:ring-offset-1 hover:ring-orange-400" />
              <button onClick={() => formatColor('#6b7280')} title="Gray" data-testid="btn-color-gray" className="w-6 h-6 rounded border border-gray-300 bg-gray-500 hover:ring-2 hover:ring-offset-1 hover:ring-gray-400" />
              
              <div className="w-px h-6 bg-gray-300 mx-1" />
              
              {/* Add Dot Point */}
              <Button 
                size="icon" 
                variant="ghost" 
                onMouseDown={(e) => { e.preventDefault(); insertDotPointAtCursor(true); }} 
                title="Add Dot Point" 
                data-testid="btn-add-dot-point-fs" 
                className="h-8 w-8 text-amber-600 hover:bg-amber-50"
              >
                <Circle className="h-3 w-3 fill-current" />
              </Button>
              
              <div className="w-px h-6 bg-gray-300 mx-1" />
              
              {/* Zoom Controls */}
              <span className="text-xs text-gray-500 ml-1">Zoom:</span>
              <Button size="sm" variant="ghost" onClick={() => setCardZoom(Math.max(0.3, cardZoom - 0.05))} title="Zoom Out" data-testid="btn-zoom-out" className="h-8 px-2">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-gray-600 min-w-[40px] text-center">{Math.round(cardZoom * 100)}%</span>
              <Button size="sm" variant="ghost" onClick={() => setCardZoom(Math.min(1.0, cardZoom + 0.05))} title="Zoom In" data-testid="btn-zoom-in" className="h-8 px-2">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCardZoom(0.5)} title="Reset Zoom" data-testid="btn-zoom-reset" className="h-8 px-2 text-xs">
                Reset
              </Button>
              
              <div className="w-px h-6 bg-gray-300 mx-1" />
              
              {/* Undo/Redo Controls */}
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handleUndo} 
                disabled={undoHistory.length === 0}
                title={`Undo (${undoHistory.length} available)`}
                data-testid="btn-undo" 
                className="h-8 px-2"
              >
                <Undo2 className="h-4 w-4" />
              </Button>
              <Button 
                size="sm" 
                variant="ghost" 
                onClick={handleRedo} 
                disabled={redoHistory.length === 0}
                title={`Redo (${redoHistory.length} available)`}
                data-testid="btn-redo" 
                className="h-8 px-2"
              >
                <Redo2 className="h-4 w-4" />
              </Button>
            </div>
            )}
          </div>
          {/* A4 Landscape page container - 297mm x 210mm (scaled to fit) */}
          <div className="relative overflow-hidden" style={{ width: `calc(297mm * ${cardZoom})`, height: `calc(210mm * ${cardZoom})` }}>
            <div 
              id="casting-card-preview"
              className="bg-white p-4 border-2 border-gray-300 shadow-lg relative overflow-hidden origin-top-left print:border-0 print:shadow-none"
              style={{ 
                width: '297mm', 
                height: '210mm',
                transform: `scale(${cardZoom})`,
                transformOrigin: 'top left',
                fontFamily: 'Calibri, sans-serif'
              }}
            >
              

              {/* Card Layout matching DOND PowerPoint design */}
              <div className="flex gap-6">
              {/* Left side - Photos */}
              <div className="w-64 flex-shrink-0">
                {/* Hidden file inputs */}
                <input
                  type="file"
                  ref={mainPhotoInputRef}
                  className="hidden"
                  accept="image/*,.heic,.heif,.webp,.avif"
                  onChange={(e) => {
                    try {
                      const file = e.target.files?.[0];
                      if (file && selectedContestant) {
                        handlePhotoUpload(selectedContestant.id, file);
                      }
                      e.target.value = '';
                    } catch (error) {
                      console.error('Photo upload error:', error);
                      toast({ title: "Upload error", description: "Failed to process photo", variant: "destructive" });
                    }
                  }}
                />
                
                {/* Main photo - with zoom and position controls */}
                <div 
                  className="casting-card-photo-border rounded-lg overflow-hidden relative group"
                  style={{ border: '4px solid #f59e0b', backgroundColor: '#f3f4f6' }}
                  data-testid="main-photo-container"
                >
                  {/* Photo with zoom/pan applied */}
                  <div 
                    className="w-full h-72 relative overflow-hidden"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {(cardData.mainPhotoOverride || selectedContestant.photoUrl) ? (
                      <img 
                        src={cardData.mainPhotoOverride || selectedContestant.photoUrl || ''} 
                        alt={selectedContestant.name || 'Contestant'}
                        crossOrigin="anonymous"
                        className="object-cover pointer-events-none"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          transform: `scale(${cardData.mainPhotoZoom || 1}) translate(${cardData.mainPhotoOffsetX || 0}px, ${cardData.mainPhotoOffsetY || 0}px) rotate(${cardData.mainPhotoRotation || 0}deg)`,
                          transition: 'transform 0.15s ease-out',
                        }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-gray-200 text-6xl text-gray-400">
                        {(selectedContestant.name || `${selectedContestant.firstName || ''} ${selectedContestant.lastName || ''}`.trim() || 'U').split(' ').map(n => n?.[0] || '').join('')}
                      </div>
                    )}
                  </div>
                  
                  {/* Photo controls overlay - visible on hover */}
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none print-hidden">
                    {/* Upload button - top right */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        mainPhotoInputRef.current?.click();
                      }}
                      className="absolute top-2 right-2 bg-black/70 text-white p-2 rounded-lg hover:bg-black/90 pointer-events-auto"
                      title="Upload new photo"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    
                    {/* Zoom controls - bottom left */}
                    <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 rounded-lg p-1 pointer-events-auto">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateField('mainPhotoZoom', Math.max(0.5, (cardData.mainPhotoZoom || 1) - 0.1));
                        }}
                        className="text-white p-1 hover:bg-white/20 rounded"
                        title="Zoom out"
                      >
                        <ZoomOut className="w-4 h-4" />
                      </button>
                      <span className="text-white text-xs px-1 min-w-[40px] text-center">
                        {Math.round((cardData.mainPhotoZoom || 1) * 100)}%
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateField('mainPhotoZoom', Math.min(3, (cardData.mainPhotoZoom || 1) + 0.1));
                        }}
                        className="text-white p-1 hover:bg-white/20 rounded"
                        title="Zoom in"
                      >
                        <ZoomIn className="w-4 h-4" />
                      </button>
                    </div>
                    
                    {/* Position controls - bottom right */}
                    <div className="absolute bottom-2 right-2 bg-black/70 rounded-lg p-1 pointer-events-auto">
                      <div className="grid grid-cols-3 gap-0.5">
                        <div />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField('mainPhotoOffsetY', (cardData.mainPhotoOffsetY || 0) + 5);
                          }}
                          className="text-white p-1 hover:bg-white/20 rounded"
                          title="Move up"
                        >
                          <ChevronUp className="w-3 h-3" />
                        </button>
                        <div />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField('mainPhotoOffsetX', (cardData.mainPhotoOffsetX || 0) + 5);
                          }}
                          className="text-white p-1 hover:bg-white/20 rounded"
                          title="Move left"
                        >
                          <ChevronUp className="w-3 h-3 -rotate-90" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField('mainPhotoZoom', 1);
                            updateField('mainPhotoOffsetX', 0);
                            updateField('mainPhotoOffsetY', 0);
                            updateField('mainPhotoRotation', 0);
                          }}
                          className="text-white p-0.5 hover:bg-white/20 rounded text-[8px]"
                          title="Reset all"
                        >
                          <RotateCcw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField('mainPhotoOffsetX', (cardData.mainPhotoOffsetX || 0) - 5);
                          }}
                          className="text-white p-1 hover:bg-white/20 rounded"
                          title="Move right"
                        >
                          <ChevronUp className="w-3 h-3 rotate-90" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField('mainPhotoRotation', ((cardData.mainPhotoRotation || 0) + 90) % 360);
                          }}
                          className="text-white p-1 hover:bg-white/20 rounded"
                          title="Rotate 90°"
                        >
                          <RefreshCw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            updateField('mainPhotoOffsetY', (cardData.mainPhotoOffsetY || 0) - 5);
                          }}
                          className="text-white p-1 hover:bg-white/20 rounded"
                          title="Move down"
                        >
                          <ChevronUp className="w-3 h-3 rotate-180" />
                        </button>
                        <div />
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Attending With section - Manual companions control */}
                <div className="mt-6 text-center">
                  <p className="text-sm font-semibold text-gray-600 mb-1">ATTENDING WITH ...</p>
                  <ArrowDown className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                  
                  {/* Manual companions - up to 4 */}
                  {(() => {
                    const companions = cardData.manualCompanions || [];
                    const count = companions.length;
                    // Size based on count: 1=w-36, 2=w-28, 3=w-24, 4=w-20
                    const sizeClass = count <= 1 ? 'w-36 h-36' : count === 2 ? 'w-28 h-28' : count === 3 ? 'w-24 h-24' : 'w-20 h-20';
                    const textSize = count <= 2 ? 'text-base' : 'text-sm';
                    const fallbackSize = count <= 1 ? 'text-2xl' : count === 2 ? 'text-xl' : 'text-lg';
                    
                    return (
                      <div className={count > 2 ? 'grid grid-cols-2 gap-2' : 'space-y-3'}>
                        {companions.map((companion) => (
                          <div key={companion.id} className="relative">
                            <input
                              type="file"
                              className="hidden"
                              accept="image/*,.heic,.heif,.webp,.avif"
                              ref={(el) => { companionPhotoRefs.current[companion.id] = el; }}
                              onChange={(e) => {
                                try {
                                  const file = e.target.files?.[0];
                                  if (file) handleCompanionPhotoUpload(companion.id, file);
                                  e.target.value = '';
                                } catch (error) {
                                  console.error('Companion photo error:', error);
                                  toast({ title: "Upload error", description: "Failed to process photo", variant: "destructive" });
                                }
                              }}
                            />
                            <div 
                              className={`casting-card-photo-border rounded-lg overflow-hidden ${sizeClass} mx-auto relative group cursor-pointer`}
                              style={{ border: '4px solid #f59e0b', backgroundColor: '#f3f4f6' }}
                              onClick={(e) => {
                                e.stopPropagation();
                                companionPhotoRefs.current[companion.id]?.click();
                              }}
                            >
                              <div className="w-full h-full relative">
                                {companion.photoUrl ? (
                                  <div 
                                    className="w-full h-full bg-cover bg-no-repeat bg-top"
                                    style={{ backgroundImage: `url(${companion.photoUrl})` }}
                                  />
                                ) : (
                                  <Avatar className="w-full h-full rounded-none pointer-events-none">
                                    <AvatarFallback className={`${fallbackSize} rounded-none bg-gray-200`}>
                                      {(companion.name || 'Partner').split(' ').map(n => n?.[0] || '').join('') || '?'}
                                    </AvatarFallback>
                                  </Avatar>
                                )}
                              </div>
                              {/* Upload overlay */}
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                {uploadingPhotoFor === companion.id ? (
                                  <div className="text-white text-xs">Uploading...</div>
                                ) : (
                                  <div className="text-center text-white">
                                    <Upload className="w-4 h-4 mx-auto" />
                                    <span className="text-xs">Upload</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            {/* Remove button - hidden in print */}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeManualCompanion(companion.id); }}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 z-10 ignore-print"
                              title="Remove companion"
                              data-testid={`btn-remove-companion-${companion.id}`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                            {/* Editable name */}
                            <div 
                              contentEditable
                              suppressContentEditableWarning
                              className={`${textSize} font-semibold mt-1 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text`}
                              onBlur={(e) => updateCompanionField(companion.id, 'name', e.currentTarget.textContent || 'Name')}
                            >{companion.name || 'Name'}</div>
                            {/* Editable relationship */}
                            <div 
                              contentEditable
                              suppressContentEditableWarning
                              className={`${textSize} text-gray-500 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text`}
                              onBlur={(e) => updateCompanionField(companion.id, 'relationship', e.currentTarget.textContent || 'Relationship')}
                            >({companion.relationship || 'Relationship'})</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  
                  {/* Add companion buttons - hidden in print */}
                  {(cardData.manualCompanions?.length || 0) < 4 && (
                    <div className="flex items-center gap-2 mt-3 justify-center flex-wrap ignore-print print:hidden">
                      {/* Add from linked group members */}
                      {getLinkedPartners().length > 0 && (
                        <Popover open={showLinkedPartnersPicker} onOpenChange={setShowLinkedPartnersPicker}>
                          <PopoverTrigger asChild>
                            <Button
                              size="sm"
                              variant="default"
                              className="text-xs bg-purple-600 hover:bg-purple-700"
                              data-testid="btn-add-linked-partner"
                            >
                              <Link2 className="w-3 h-3 mr-1" />
                              Add Linked Partner ({getLinkedPartners().length})
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-2" align="center">
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground mb-2">
                                Select a linked group member:
                              </p>
                              {getLinkedPartners().map(partner => {
                                const alreadyAdded = (cardData.manualCompanions || []).some(c => c.id === partner.id);
                                return (
                                  <button
                                    key={partner.id}
                                    onClick={() => !alreadyAdded && addLinkedPartnerAsCompanion(partner)}
                                    disabled={alreadyAdded}
                                    className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm ${
                                      alreadyAdded 
                                        ? 'opacity-50 cursor-not-allowed bg-muted' 
                                        : 'hover:bg-accent cursor-pointer'
                                    }`}
                                    data-testid={`btn-select-linked-partner-${partner.id}`}
                                  >
                                    <Avatar className="h-8 w-8 rounded border">
                                      <AvatarImage src={partner.photoUrl || undefined} className="object-cover object-top" />
                                      <AvatarFallback className="text-xs">
                                        {(partner.name || '?').split(' ').map(n => n?.[0] || '').join('').slice(0, 2) || '?'}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">{partner.name}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {partner.gender === 'Female' ? 'F' : 'M'} • {partner.age}y
                                        {alreadyAdded && ' • Already added'}
                                      </p>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </PopoverContent>
                        </Popover>
                      )}
                      {/* Add custom partner */}
                      <Button
                        size="sm"
                        variant="default"
                        onClick={addManualCompanion}
                        className="text-xs bg-blue-600 hover:bg-blue-700 ignore-print"
                        data-testid="btn-add-companion"
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add Custom Partner ({(cardData.manualCompanions?.length || 0)}/4)
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right side - Details */}
              <div className="flex-1 relative flex flex-col">
                {/* Header banner with DOND logo - matching PowerPoint bronze/orange style */}
                <div 
                  className="pl-6 pr-0 rounded-l flex items-center justify-between mb-2 casting-card-header" 
                  style={{ 
                    height: '80px',
                    background: 'linear-gradient(to right, #b45309, #d97706, #f59e0b)',
                    border: '2px solid #000000'
                  }}
                >
                  <div className="relative group flex items-center flex-1">
                    <h2 
                      contentEditable
                      suppressContentEditableWarning
                      data-field="fullName"
                      className="font-bold italic tracking-wide outline-none hover:bg-amber-600/50 focus:bg-amber-600/50 px-1 rounded cursor-text casting-card-name flex-1"
                      style={{ 
                        fontFamily: '"Century Gothic", sans-serif',
                        fontSize: `${cardData.fontSizeName || 42}px`,
                        lineHeight: '80px',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.5), 0 0 1px rgba(0,0,0,0.3)',
                        color: '#fcd34d',
                        margin: 0,
                        padding: 0,
                        paddingLeft: '16px'
                      }}
                      onBlur={(e) => updateField('fullName', e.currentTarget.textContent || '')}
                    >{cardData.fullName || (selectedContestant.name || `${selectedContestant.firstName || ''} ${selectedContestant.lastName || ''}`.trim() || 'Unknown').toUpperCase()}</h2>
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print mr-2">
                      <button 
                        onClick={() => updateField('fontSizeName', (cardData.fontSizeName || 42) + 2)}
                        className="text-yellow-300 hover:text-yellow-100 p-0.5"
                        title="Increase font size"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => updateField('fontSizeName', Math.max(20, (cardData.fontSizeName || 42) - 2))}
                        className="text-yellow-300 hover:text-yellow-100 p-0.5"
                        title="Decrease font size"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <img src={dondLogo} alt="Deal or No Deal" className="h-full object-contain" />
                </div>

                {/* Age and details - all editable */}
                <div className="mb-6">
                  {/* Age/State - with position controls */}
                  <div 
                    className="relative group flex items-center gap-1"
                    style={{ 
                      marginTop: `${cardData.ageStateOffsetY || 0}px`,
                      transition: 'margin-top 0.15s ease-out'
                    }}
                  >
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print mr-1">
                      <button 
                        onClick={() => updateField('ageStateOffsetY', (cardData.ageStateOffsetY || 0) - 5)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Move up"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => updateField('ageStateOffsetY', (cardData.ageStateOffsetY || 0) + 5)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Move down"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      data-field="ageState"
                      className="outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text flex-1"
                      style={{ fontFamily: 'Calibri, sans-serif', fontSize: '34px' }}
                      onBlur={(e) => updateField('ageState', e.currentTarget.textContent || '')}
                    >
                      {cardData.ageState || `${selectedContestant.age || 'AGE'} (${((selectedContestant as any).state || 'STATE').toUpperCase()})`}
                    </div>
                  </div>
                  {/* Occupation - with position controls */}
                  <div 
                    className="relative group flex items-center gap-1"
                    style={{ 
                      marginTop: `${cardData.occupationOffsetY || 0}px`,
                      transition: 'margin-top 0.15s ease-out'
                    }}
                  >
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print mr-1">
                      <button 
                        onClick={() => updateField('occupationOffsetY', (cardData.occupationOffsetY || 0) - 5)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Move up"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => updateField('occupationOffsetY', (cardData.occupationOffsetY || 0) + 5)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Move down"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                    <div
                      contentEditable
                      suppressContentEditableWarning
                      data-field="occupation"
                      className="text-gray-800 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text flex-1"
                      style={{ fontFamily: '"Calibri Light", Calibri, sans-serif', fontSize: `${cardData.fontSizeOccupation || 34}px` }}
                      onBlur={(e) => updateField('occupation', e.currentTarget.textContent || '')}
                    >
                      {cardData.occupation || 'OCCUPATION'}
                    </div>
                    {/* Font size controls for occupation */}
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print">
                      <button 
                        onClick={() => updateField('fontSizeOccupation', (cardData.fontSizeOccupation || 36) + 2)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Increase font size"
                      >
                        <ChevronUp className="w-3 h-3" />
                      </button>
                      <button 
                        onClick={() => updateField('fontSizeOccupation', Math.max(12, (cardData.fontSizeOccupation || 36) - 2))}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Decrease font size"
                      >
                        <ChevronDown className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {/* Sponsor Category - with remove button */}
                  {cardData.showSponsorCategory !== false ? (
                    <div className="relative group flex items-center gap-1 -mt-1">
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        data-field="sponsorCategory"
                        className="text-lg font-semibold outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text casting-card-sponsor"
                        style={{ color: '#16a34a' }}
                        onBlur={(e) => updateField('sponsorCategory', e.currentTarget.textContent || '')}
                      >
                        {cardData.sponsorCategory || 'SPONSOR CATEGORY: X'}
                      </div>
                      <button
                        onClick={() => updateField('showSponsorCategory', false)}
                        className="bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity ignore-print"
                        title="Remove sponsor category"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => updateField('showSponsorCategory', true)}
                      className="text-xs print:hidden ignore-print -mt-1"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Sponsor Category
                    </Button>
                  )}
                </div>

                {/* Tagline - with position controls */}
                {cardData.showTagline !== false ? (
                  <div 
                    className="relative group"
                    style={{ 
                      marginTop: `${(cardData.taglineOffsetY || 0) - 15}px`,
                      transition: 'margin-top 0.15s ease-out'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {/* Position controls */}
                      <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden">
                        <button 
                          onClick={() => updateField('taglineOffsetY', (cardData.taglineOffsetY || 0) - 10)}
                          className="text-gray-400 hover:text-gray-600 p-0.5"
                          title="Move up"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button 
                          onClick={() => updateField('taglineOffsetY', (cardData.taglineOffsetY || 0) + 10)}
                          className="text-gray-400 hover:text-gray-600 p-0.5"
                          title="Move down"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </div>
                      <h3 
                        contentEditable
                        suppressContentEditableWarning
                        data-field="tagline"
                        className="mb-2 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text flex-1 casting-card-tagline"
                        style={{ fontFamily: '"Calibri Light", Calibri, sans-serif', fontSize: '36px', color: '#dc2626' }}
                        onBlur={(e) => updateField('tagline', e.currentTarget.textContent || '')}
                      >
                        {cardData.tagline || 'SHORT TAGLINE'}
                      </h3>
                    </div>
                    <button
                      onClick={() => updateField('showTagline', false)}
                      className="absolute -top-1 right-0 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity print-hidden"
                      title="Remove tagline"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateField('showTagline', true)}
                    className="mb-3 text-xs print-hidden"
                    style={{ marginTop: '-10px' }}
                  >
                    + Add Tagline
                  </Button>
                )}

                {/* Body text - single text box with position controls */}
                <div 
                  className="relative group"
                  style={{ 
                    marginTop: `${cardData.bodyOffsetY || 0}px`,
                    transition: 'margin-top 0.15s ease-out'
                  }}
                >
                  <div className="flex items-start gap-2">
                    {/* Position controls */}
                    <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden mt-1">
                      <button 
                        onClick={() => updateField('bodyOffsetY', (cardData.bodyOffsetY || 0) - 10)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Move up"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </button>
                      <button 
                        onClick={() => updateField('bodyOffsetY', (cardData.bodyOffsetY || 0) + 10)}
                        className="text-gray-400 hover:text-gray-600 p-0.5"
                        title="Move down"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </button>
                    </div>
                    {/* Body text area */}
                    <div
                      ref={bodyTextRefFs}
                      contentEditable
                      suppressContentEditableWarning
                      data-field="bodyText"
                      data-is-html="true"
                      className="outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-2 py-1 rounded cursor-text whitespace-pre-wrap border border-transparent hover:border-gray-200 focus:border-amber-300 flex-1 print-no-border"
                      style={{ fontFamily: 'Calibri, sans-serif', fontSize: '20px', lineHeight: '1.5', paddingBottom: cardData.showProducer !== false ? '50px' : '0' }}
                      onInput={() => { hasUnsavedChanges.current = true; }}
                      onBlur={(e) => updateField('bodyText', e.currentTarget.innerHTML || '')}
                      onMouseUp={saveCursorPosition}
                      onKeyUp={saveCursorPosition}
                      data-testid="body-text-editor-fullscreen"
                      dangerouslySetInnerHTML={{ __html: (cardData.bodyText || defaultBodyText).replace(/\n/g, '<br/>') }}
                    />
                  </div>
                </div>
                

              </div>
            </div>
            
              {/* Producer Field - absolutely positioned at bottom right of the A4 card */}
              <div className="absolute bottom-4 right-4" style={{ zIndex: 10 }}>
                {cardData.showProducer !== false ? (
                  <div className="flex items-stretch group casting-card-producer-corner relative">
                    <span 
                      className="casting-card-producer-label px-4 py-2 font-semibold text-sm flex items-center"
                      style={{ backgroundColor: '#e5e7eb', border: '1px solid #d1d5db', color: '#000000' }}
                    >PRODUCER:</span>
                    {/* Plain text for print - always visible */}
                    <span 
                      className="casting-card-producer-name-print px-4 py-2 font-bold text-sm min-w-[120px] flex items-center"
                      style={{ backgroundColor: '#facc15', color: '#000000' }}
                    >{cardData.producerName || 'SELECT'}</span>
                    {/* Dropdown for UI - positioned on top, hidden during PDF/print */}
                    <div className="absolute right-0 ignore-print" style={{ left: 'calc(100% - 120px - 16px)', top: 0 }}>
                      <Select 
                        value={cardData.producerName || ''} 
                        onValueChange={(value) => updateField('producerName', value === '__clear__' ? '' : value)}
                      >
                        <SelectTrigger 
                          className="casting-card-producer-name h-auto px-4 py-2 font-bold text-sm border-0 rounded-none min-w-[120px]"
                          style={{ backgroundColor: '#facc15', color: '#000000' }}
                          data-testid="select-producer-name-fs"
                        >
                          <SelectValue placeholder="SELECT" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__clear__" className="text-muted-foreground italic">Clear</SelectItem>
                          {PRODUCER_NAMES.map(name => (
                            <SelectItem key={name} value={name}>{name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <button
                      onClick={() => updateField('showProducer', false)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity ignore-print"
                      title="Remove producer field"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateField('showProducer', true)}
                    className="text-xs print:hidden ignore-print"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Add Producer
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Version History Dialog - also needed in fullscreen mode */}
      <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History
            </DialogTitle>
            <DialogDescription>
              Previous versions of this casting card. Versions are saved automatically every 10 minutes during editing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-[400px] overflow-y-auto">
            {loadingVersions ? (
              <div className="text-center py-8 text-muted-foreground">Loading versions...</div>
            ) : cardVersions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No version history yet</p>
                <p className="text-xs mt-1">Versions are saved automatically every 10 minutes during editing.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cardVersions.map((version) => {
                  let parsedData: any = {};
                  try {
                    parsedData = typeof version.cardData === 'string' 
                      ? JSON.parse(version.cardData) 
                      : version.cardData;
                  } catch (e) {
                    console.error('Failed to parse version cardData:', e);
                  }
                  return (
                    <div key={version.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md border">
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {new Date(version.createdAt).toLocaleDateString()} at {new Date(version.createdAt).toLocaleTimeString()}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {version.createdBy && <span>By: {version.createdBy}</span>}
                          {parsedData.isReady && <Badge variant="outline" className="text-[10px] py-0">RX Ready</Badge>}
                          {parsedData.isDraftComplete && <Badge variant="outline" className="text-[10px] py-0">Draft</Badge>}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (existingCard?.id) {
                            restoreVersionMutation.mutate({ cardId: existingCard.id, versionId: version.id });
                          }
                        }}
                        disabled={restoreVersionMutation.isPending}
                        data-testid={`btn-restore-version-fs-${version.id}`}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Restore
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </SafeRender>
    );
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-200px)]">
      {/* Left Panel - Contestant Search */}
      <div className={`w-80 flex-shrink-0 flex flex-col ${isFullscreen ? 'hidden' : ''}`}>
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Select Contestant</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPptxImportOpen(true)}
                className="text-xs"
                data-testid="btn-import-pptx"
              >
                <Upload className="h-3 w-3 mr-1" />
                Import PPTX
              </Button>
            </div>
            <div className="space-y-2 mt-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                  data-testid="input-casting-search"
                />
              </div>
              <div className="flex gap-2">
                <Select value={ratingFilter} onValueChange={setRatingFilter}>
                  <SelectTrigger className="flex-1" data-testid="select-casting-rating">
                    <SelectValue placeholder="Rating" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Ratings</SelectItem>
                    <SelectItem value="A+">A+</SelectItem>
                    <SelectItem value="A">A</SelectItem>
                    <SelectItem value="B+">B+</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={genderFilter} onValueChange={setGenderFilter}>
                  <SelectTrigger className="flex-1" data-testid="select-casting-gender">
                    <SelectValue placeholder="Gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={cardStatusFilter} onValueChange={setCardStatusFilter}>
                  <SelectTrigger className="flex-1" data-testid="select-card-status">
                    <SelectValue placeholder="Card Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Cards</SelectItem>
                    <SelectItem value="draft_complete">Draft Complete</SelectItem>
                    <SelectItem value="rx_ready">RX Ready</SelectItem>
                    <SelectItem value="in_progress">In Progress</SelectItem>
                    <SelectItem value="no_card">No Card</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Select value={producerFilter} onValueChange={setProducerFilter}>
                  <SelectTrigger className="flex-1" data-testid="select-producer-filter">
                    <SelectValue placeholder="Producer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Producers</SelectItem>
                    {PRODUCER_NAMES.map(name => (
                      <SelectItem key={name} value={name}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto p-2">
            <div className="space-y-1">
              {filteredContestants.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedContestant(c)}
                  className={`w-full text-left p-2 rounded-md hover-elevate flex items-center gap-2 ${
                    selectedContestant?.id === c.id ? 'bg-primary/10 border border-primary' : ''
                  }`}
                  data-testid={`btn-contestant-${c.id}`}
                >
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={c.photoUrl || undefined} />
                    <AvatarFallback className="text-xs">{(c.name || '?').split(' ').map(n => n?.[0] || '').join('') || '?'}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{c.name}</p>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <span>{c.age || '?'}</span>
                      <span>•</span>
                      <span>{c.gender === 'female' ? 'F' : 'M'}</span>
                      {c.auditionRating && (
                        <>
                          <span>•</span>
                          <Badge variant="outline" className="text-[10px] px-1 py-0">{c.auditionRating}</Badge>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {filteredContestants.length === 0 && (
                <p className="text-center text-muted-foreground text-sm py-4">No contestants found</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Right Panel - Card Editor & Preview */}
      {renderError ? (
        <div className="flex-1 flex items-center justify-center">
          <Card className="p-6 max-w-md">
            <div className="text-center">
              <div className="text-red-500 text-4xl mb-4">⚠️</div>
              <h3 className="font-semibold text-lg mb-2">Error Loading Casting Card</h3>
              <p className="text-muted-foreground mb-4">{renderError}</p>
              <Button onClick={() => { setRenderError(null); setSelectedContestant(null); }}>
                Go Back
              </Button>
            </div>
          </Card>
        </div>
      ) : selectedContestant && cardData ? (
        <div className="flex-1 overflow-hidden">
          {/* Direct Edit Card - Click any text to edit like PowerPoint */}
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Click any text to edit directly</CardTitle>
                  {/* Draft Complete toggle */}
                  <Button
                    size="sm"
                    variant={cardData.isDraftComplete ? "default" : "outline"}
                    onClick={toggleDraftCompleteAndSave}
                    disabled={saveMutation.isPending}
                    className={cardData.isDraftComplete ? "bg-blue-600 hover:bg-blue-700" : ""}
                    data-testid="btn-toggle-draft-complete"
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    {cardData.isDraftComplete ? 'Draft Complete' : 'Draft Complete'}
                  </Button>
                  {/* RX Ready toggle */}
                  <Button
                    size="sm"
                    variant={cardData.isReady ? "default" : "outline"}
                    onClick={toggleReadyAndSave}
                    disabled={saveMutation.isPending}
                    className={cardData.isReady ? "bg-green-600 hover:bg-green-700" : ""}
                    data-testid="btn-toggle-ready"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {cardData.isReady ? 'RX Ready' : 'RX Ready'}
                  </Button>
                </div>
                <div className="flex gap-2 items-center">
                  <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending || autoSaveStatus === 'saving'} data-testid="btn-save-card">
                    {saveMutation.isPending || autoSaveStatus === 'saving' ? 'Saving...' : autoSaveStatus === 'saved' ? '✓ Saved' : 'Save'}
                  </Button>
                  <span className="text-xs text-gray-500">Auto-saves</span>
                  {lastKnownUpdatedAt && (
                    <span className="text-xs text-muted-foreground ml-2" title={`Last saved: ${new Date(lastKnownUpdatedAt).toLocaleString()}`}>
                      Last saved: {new Date(lastKnownUpdatedAt).toLocaleTimeString()}
                    </span>
                  )}
                  <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={isGeneratingPdf} data-testid="btn-download-pdf">
                    <Download className="h-4 w-4 mr-1" />
                    PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={handlePrint} data-testid="btn-print-card">
                    <Printer className="h-4 w-4 mr-1" />
                    Print
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setVersionHistoryOpen(true)} disabled={!existingCard?.id} data-testid="button-version-history">
                    <History className="h-4 w-4 mr-1" />
                    History
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setCardZoom(0.8); setIsFullscreen(true); }} data-testid="btn-fullscreen">
                    <Maximize2 className="h-4 w-4 mr-1" />
                    Fullscreen
                  </Button>
                                  </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-4">
              {/* A4 Landscape page container - 297mm x 210mm (scaled for preview) */}
              <div className="relative overflow-hidden" style={{ width: `calc(297mm * ${cardZoom})`, height: `calc(210mm * ${cardZoom})` }}>
                <div 
                  id="casting-card-preview"
                  className="bg-white p-4 border-2 border-gray-300 shadow-lg relative overflow-hidden origin-top-left print:border-0 print:shadow-none"
                  style={{ 
                    width: '297mm', 
                    height: '210mm',
                    transform: `scale(${cardZoom})`,
                    transformOrigin: 'top left',
                    fontFamily: 'Calibri, sans-serif'
                  }}
                >
                  
                  
                  {/* Card Layout matching DOND PowerPoint design */}
                  <div className="flex gap-6">
                  {/* Left side - Photos */}
                  <div className="w-64 flex-shrink-0">
                    {/* Main photo - with zoom and position controls */}
                    <div 
                      className="casting-card-photo-border rounded-lg overflow-hidden relative group"
                      style={{ border: '4px solid #f59e0b', backgroundColor: '#f3f4f6' }}
                      data-testid="upload-main-photo-preview"
                    >
                      {/* Photo with zoom/pan applied */}
                      <div 
                        className="w-full h-72 relative overflow-hidden"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {(cardData.mainPhotoOverride || selectedContestant.photoUrl) ? (
                          <img 
                            src={cardData.mainPhotoOverride || selectedContestant.photoUrl || ''} 
                            alt={selectedContestant.name || 'Contestant'}
                            crossOrigin="anonymous"
                            className="object-cover pointer-events-none"
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              transform: `scale(${cardData.mainPhotoZoom || 1}) translate(${cardData.mainPhotoOffsetX || 0}px, ${cardData.mainPhotoOffsetY || 0}px) rotate(${cardData.mainPhotoRotation || 0}deg)`,
                              transition: 'transform 0.15s ease-out',
                            }}
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-gray-200 text-6xl text-gray-400">
                            {(selectedContestant.name || `${selectedContestant.firstName || ''} ${selectedContestant.lastName || ''}`.trim() || 'U').split(' ').map(n => n?.[0] || '').join('')}
                          </div>
                        )}
                      </div>
                      
                      {/* Photo controls overlay - visible on hover */}
                      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none print-hidden">
                        {/* Upload button - top right */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            mainPhotoInputRef.current?.click();
                          }}
                          className="absolute top-2 right-2 bg-black/70 text-white p-2 rounded-lg hover:bg-black/90 pointer-events-auto"
                          title="Upload new photo"
                        >
                          <Upload className="w-4 h-4" />
                        </button>
                        
                        {/* Zoom controls - bottom left */}
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 rounded-lg p-1 pointer-events-auto">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateField('mainPhotoZoom', Math.max(0.5, (cardData.mainPhotoZoom || 1) - 0.1));
                            }}
                            className="text-white p-1 hover:bg-white/20 rounded"
                            title="Zoom out"
                          >
                            <ZoomOut className="w-4 h-4" />
                          </button>
                          <span className="text-white text-xs px-1 min-w-[40px] text-center">
                            {Math.round((cardData.mainPhotoZoom || 1) * 100)}%
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              updateField('mainPhotoZoom', Math.min(3, (cardData.mainPhotoZoom || 1) + 0.1));
                            }}
                            className="text-white p-1 hover:bg-white/20 rounded"
                            title="Zoom in"
                          >
                            <ZoomIn className="w-4 h-4" />
                          </button>
                        </div>
                        
                        {/* Position controls - bottom right */}
                        <div className="absolute bottom-2 right-2 bg-black/70 rounded-lg p-1 pointer-events-auto">
                          <div className="grid grid-cols-3 gap-0.5">
                            <div />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField('mainPhotoOffsetY', (cardData.mainPhotoOffsetY || 0) + 5);
                              }}
                              className="text-white p-1 hover:bg-white/20 rounded"
                              title="Move up"
                            >
                              <ChevronUp className="w-3 h-3" />
                            </button>
                            <div />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField('mainPhotoOffsetX', (cardData.mainPhotoOffsetX || 0) + 5);
                              }}
                              className="text-white p-1 hover:bg-white/20 rounded"
                              title="Move left"
                            >
                              <ChevronUp className="w-3 h-3 -rotate-90" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField('mainPhotoZoom', 1);
                                updateField('mainPhotoOffsetX', 0);
                                updateField('mainPhotoOffsetY', 0);
                                updateField('mainPhotoRotation', 0);
                              }}
                              className="text-white p-0.5 hover:bg-white/20 rounded text-[8px]"
                              title="Reset all"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField('mainPhotoOffsetX', (cardData.mainPhotoOffsetX || 0) - 5);
                              }}
                              className="text-white p-1 hover:bg-white/20 rounded"
                              title="Move right"
                            >
                              <ChevronUp className="w-3 h-3 rotate-90" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField('mainPhotoRotation', ((cardData.mainPhotoRotation || 0) + 90) % 360);
                              }}
                              className="text-white p-1 hover:bg-white/20 rounded"
                              title="Rotate 90°"
                            >
                              <RefreshCw className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateField('mainPhotoOffsetY', (cardData.mainPhotoOffsetY || 0) - 5);
                              }}
                              className="text-white p-1 hover:bg-white/20 rounded"
                              title="Move down"
                            >
                              <ChevronUp className="w-3 h-3 rotate-180" />
                            </button>
                            <div />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    {/* Attending With section - Manual companions control */}
                    <div className="mt-6 text-center" data-testid="preview-companion-section">
                      <p className="text-sm font-semibold text-gray-600 mb-1">ATTENDING WITH ...</p>
                      <ArrowDown className="w-5 h-5 text-blue-500 mx-auto mb-2" />
                      
                      {/* Manual companions - up to 4 */}
                      {(() => {
                        const companions = cardData.manualCompanions || [];
                        const count = companions.length;
                        // Size based on count: 1=w-36, 2=w-28, 3=w-24, 4=w-20
                        const sizeClass = count <= 1 ? 'w-36 h-36' : count === 2 ? 'w-28 h-28' : count === 3 ? 'w-24 h-24' : 'w-20 h-20';
                        const textSize = count <= 2 ? 'text-base' : 'text-sm';
                        const fallbackSize = count <= 1 ? 'text-2xl' : count === 2 ? 'text-xl' : 'text-lg';
                        
                        return (
                          <div className={count > 2 ? 'grid grid-cols-2 gap-2' : 'space-y-3'}>
                            {companions.map((companion) => (
                              <div key={companion.id} className="relative">
                                <div 
                                  className={`border-4 border-amber-500 rounded-lg overflow-hidden ${sizeClass} mx-auto bg-gray-100 relative group cursor-pointer`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    companionPhotoRefs.current[companion.id]?.click();
                                  }}
                                >
                                  <div className="w-full h-full relative">
                                    {companion.photoUrl ? (
                                      <div 
                                        className="w-full h-full bg-cover bg-no-repeat bg-top"
                                        style={{ backgroundImage: `url(${companion.photoUrl})` }}
                                      />
                                    ) : (
                                      <Avatar className="w-full h-full rounded-none pointer-events-none">
                                        <AvatarFallback className={`${fallbackSize} rounded-none bg-gray-200`}>
                                          {(companion.name || 'Partner').split(' ').map(n => n?.[0] || '').join('') || '?'}
                                        </AvatarFallback>
                                      </Avatar>
                                    )}
                                  </div>
                                  {/* Upload overlay */}
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                                    {uploadingPhotoFor === companion.id ? (
                                      <div className="text-white text-xs">Uploading...</div>
                                    ) : (
                                      <div className="text-center text-white">
                                        <Upload className="w-4 h-4 mx-auto" />
                                        <span className="text-xs">Upload</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                {/* Remove button - hidden in print */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeManualCompanion(companion.id); }}
                                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 z-10 ignore-print"
                                  title="Remove companion"
                                >
                                  <X className="w-3 h-3" />
                                </button>
                                {/* Editable name */}
                                <div 
                                  contentEditable
                                  suppressContentEditableWarning
                                  className={`${textSize} font-semibold mt-1 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text`}
                                  onBlur={(e) => updateCompanionField(companion.id, 'name', e.currentTarget.textContent || 'Name')}
                                >{companion.name || 'Name'}</div>
                                {/* Editable relationship */}
                                <div 
                                  contentEditable
                                  suppressContentEditableWarning
                                  className={`${textSize} text-gray-500 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text`}
                                  onBlur={(e) => updateCompanionField(companion.id, 'relationship', e.currentTarget.textContent || 'Relationship')}
                                >({companion.relationship || 'Relationship'})</div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      
                      {/* Add companion buttons - hidden in print */}
                      {(cardData.manualCompanions?.length || 0) < 4 && (
                        <div className="flex items-center gap-2 mt-3 justify-center flex-wrap ignore-print print:hidden">
                          {/* Add from linked group members */}
                          {getLinkedPartners().length > 0 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  size="sm"
                                  variant="default"
                                  className="text-xs bg-purple-600 hover:bg-purple-700"
                                  data-testid="btn-add-linked-partner-preview"
                                >
                                  <Link2 className="w-3 h-3 mr-1" />
                                  Add Linked Partner ({getLinkedPartners().length})
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-72 p-2" align="center">
                                <div className="space-y-1">
                                  <p className="text-xs font-medium text-muted-foreground mb-2">
                                    Select a linked group member:
                                  </p>
                                  {getLinkedPartners().map(partner => {
                                    const alreadyAdded = (cardData.manualCompanions || []).some(c => c.id === partner.id);
                                    return (
                                      <button
                                        key={partner.id}
                                        onClick={() => !alreadyAdded && addLinkedPartnerAsCompanion(partner)}
                                        disabled={alreadyAdded}
                                        className={`w-full flex items-center gap-2 p-2 rounded text-left text-sm ${
                                          alreadyAdded 
                                            ? 'opacity-50 cursor-not-allowed bg-muted' 
                                            : 'hover:bg-accent cursor-pointer'
                                        }`}
                                        data-testid={`btn-select-linked-partner-preview-${partner.id}`}
                                      >
                                        <Avatar className="h-8 w-8 rounded border">
                                          <AvatarImage src={partner.photoUrl || undefined} className="object-cover object-top" />
                                          <AvatarFallback className="text-xs">
                                            {(partner.name || '?').split(' ').map(n => n?.[0] || '').join('').slice(0, 2) || '?'}
                                          </AvatarFallback>
                                        </Avatar>
                                        <div className="flex-1 min-w-0">
                                          <p className="font-medium truncate">{partner.name}</p>
                                          <p className="text-xs text-muted-foreground">
                                            {partner.gender === 'Female' ? 'F' : 'M'} • {partner.age}y
                                            {alreadyAdded && ' • Already added'}
                                          </p>
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                          {/* Add custom partner */}
                          <Button
                            size="sm"
                            variant="default"
                            onClick={addManualCompanion}
                            className="text-xs bg-blue-600 hover:bg-blue-700 ignore-print"
                            data-testid="btn-add-companion-preview"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add Custom Partner ({(cardData.manualCompanions?.length || 0)}/4)
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right side - Details */}
                  <div className="flex-1">
                    {/* Header banner with DOND logo - matching PowerPoint bronze/orange style */}
                    <div 
                      className="pl-4 pr-0 rounded-l flex items-center justify-between mb-2 casting-card-header" 
                      style={{ 
                        height: '80px',
                        background: 'linear-gradient(to right, #b45309, #d97706, #f59e0b)',
                        border: '2px solid #000000'
                      }} 
                      data-testid="preview-header-banner"
                    >
                      <div className="relative group flex items-center flex-1">
                        <h2 
                          contentEditable
                          suppressContentEditableWarning
                          className="font-bold italic tracking-wide outline-none hover:bg-amber-600/50 focus:bg-amber-600/50 px-1 rounded cursor-text casting-card-name flex-1"
                          style={{ 
                            fontFamily: '"Century Gothic", sans-serif',
                            fontSize: `${cardData.fontSizeName || 42}px`,
                            lineHeight: '80px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.5), 0 0 1px rgba(0,0,0,0.3)',
                            color: '#fcd34d',
                            margin: 0,
                            padding: 0,
                            paddingLeft: '16px'
                          }}
                          onBlur={(e) => updateField('fullName', e.currentTarget.textContent || '')}
                          data-testid="preview-contestant-name"
                        >{cardData.fullName || (selectedContestant.name || `${selectedContestant.firstName || ''} ${selectedContestant.lastName || ''}`.trim() || 'Unknown').toUpperCase()}</h2>
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print mr-2">
                          <button 
                            onClick={() => updateField('fontSizeName', (cardData.fontSizeName || 42) + 2)}
                            className="text-yellow-300 hover:text-yellow-100 p-0.5"
                            title="Increase font size"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => updateField('fontSizeName', Math.max(20, (cardData.fontSizeName || 42) - 2))}
                            className="text-yellow-300 hover:text-yellow-100 p-0.5"
                            title="Decrease font size"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                      <img src={dondLogo} alt="Deal or No Deal" className="h-full object-contain" />
                    </div>

                    {/* Age and details - all editable */}
                    <div className="mb-6">
                      {/* Age/State - with position controls */}
                      <div 
                        className="relative group flex items-center gap-1"
                        style={{ 
                          marginTop: `${cardData.ageStateOffsetY || 0}px`,
                          transition: 'margin-top 0.15s ease-out'
                        }}
                      >
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print mr-1">
                          <button 
                            onClick={() => updateField('ageStateOffsetY', (cardData.ageStateOffsetY || 0) - 5)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Move up"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => updateField('ageStateOffsetY', (cardData.ageStateOffsetY || 0) + 5)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Move down"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                        <div
                          ref={isFullscreen ? ageStateRefFs : ageStateRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text flex-1"
                          style={{ fontFamily: 'Calibri, sans-serif', fontSize: '34px' }}
                          onBlur={(e) => updateField('ageState', e.currentTarget.textContent || '')}
                          data-testid="preview-age-location"
                        >
                          {cardData.ageState || `${selectedContestant.age || 'AGE'} (${((selectedContestant as any).state || 'STATE').toUpperCase()})`}
                        </div>
                      </div>
                      {/* Occupation - with position controls */}
                      <div 
                        className="relative group flex items-center gap-1"
                        style={{ 
                          marginTop: `${cardData.occupationOffsetY || 0}px`,
                          transition: 'margin-top 0.15s ease-out'
                        }}
                      >
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print mr-1">
                          <button 
                            onClick={() => updateField('occupationOffsetY', (cardData.occupationOffsetY || 0) - 5)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Move up"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => updateField('occupationOffsetY', (cardData.occupationOffsetY || 0) + 5)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Move down"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                        <div
                          ref={isFullscreen ? occupationRefFs : occupationRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="text-gray-800 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text flex-1"
                          style={{ fontFamily: '"Calibri Light", Calibri, sans-serif', fontSize: `${cardData.fontSizeOccupation || 34}px` }}
                          onBlur={(e) => updateField('occupation', e.currentTarget.textContent || '')}
                          data-testid="edit-occupation"
                        >
                          {cardData.occupation || 'OCCUPATION'}
                        </div>
                        {/* Font size controls for occupation */}
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden ignore-print">
                          <button 
                            onClick={() => updateField('fontSizeOccupation', (cardData.fontSizeOccupation || 36) + 2)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Increase font size"
                          >
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button 
                            onClick={() => updateField('fontSizeOccupation', Math.max(12, (cardData.fontSizeOccupation || 36) - 2))}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Decrease font size"
                          >
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      {/* Sponsor Category - with remove button */}
                      {cardData.showSponsorCategory !== false ? (
                        <div className="relative group flex items-center gap-1 -mt-1">
                          <div
                            contentEditable
                            suppressContentEditableWarning
                            className="text-lg font-semibold outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text casting-card-sponsor"
                            style={{ color: '#16a34a' }}
                            onBlur={(e) => updateField('sponsorCategory', e.currentTarget.textContent || '')}
                            data-testid="edit-sponsor"
                          >
                            {cardData.sponsorCategory || 'SPONSOR CATEGORY: X'}
                          </div>
                          <button
                            onClick={() => updateField('showSponsorCategory', false)}
                            className="bg-red-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity ignore-print"
                            title="Remove sponsor category"
                            data-testid="btn-remove-sponsor"
                          >
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => updateField('showSponsorCategory', true)}
                          className="text-xs print:hidden ignore-print -mt-1"
                          data-testid="btn-add-sponsor"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Sponsor Category
                        </Button>
                      )}
                    </div>

                    {/* Tagline - with position controls */}
                    {cardData.showTagline !== false ? (
                      <div 
                        className="relative group"
                        style={{ 
                          marginTop: `${(cardData.taglineOffsetY || 0) - 15}px`,
                          transition: 'margin-top 0.15s ease-out'
                        }}
                      >
                        <div className="flex items-center gap-2">
                          {/* Position controls */}
                          <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden">
                            <button 
                              onClick={() => updateField('taglineOffsetY', (cardData.taglineOffsetY || 0) - 10)}
                              className="text-gray-400 hover:text-gray-600 p-0.5"
                              title="Move up"
                            >
                              <ChevronUp className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => updateField('taglineOffsetY', (cardData.taglineOffsetY || 0) + 10)}
                              className="text-gray-400 hover:text-gray-600 p-0.5"
                              title="Move down"
                            >
                              <ChevronDown className="w-4 h-4" />
                            </button>
                          </div>
                          <h3 
                            ref={isFullscreen ? taglineRefFs : taglineRef}
                            contentEditable
                            suppressContentEditableWarning
                            className="mb-3 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text flex-1 casting-card-tagline"
                            style={{ fontFamily: '"Calibri Light", Calibri, sans-serif', fontSize: '36px', color: '#dc2626' }}
                            onBlur={(e) => updateField('tagline', e.currentTarget.textContent || '')}
                            data-testid="edit-tagline"
                          >
                            {cardData.tagline || 'SHORT TAGLINE'}
                          </h3>
                        </div>
                        <button
                          onClick={() => updateField('showTagline', false)}
                          className="absolute -top-1 right-0 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity print-hidden"
                          title="Remove tagline"
                          data-testid="btn-remove-tagline"
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => updateField('showTagline', true)}
                        className="mb-3 text-xs print-hidden"
                        style={{ marginTop: '-10px' }}
                        data-testid="btn-add-tagline"
                      >
                        + Add Tagline
                      </Button>
                    )}

                    {/* Body text - relative container with absolutely positioned producer */}
                    <div 
                      className="relative flex-1 group"
                      style={{ 
                        marginTop: `${cardData.bodyOffsetY || 0}px`,
                        transition: 'margin-top 0.15s ease-out',
                        minHeight: '280px'
                      }}
                    >
                      <div className="flex items-start gap-2">
                        {/* Position controls */}
                        <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity print-hidden mt-1">
                          <button 
                            onClick={() => updateField('bodyOffsetY', (cardData.bodyOffsetY || 0) - 10)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Move up"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => updateField('bodyOffsetY', (cardData.bodyOffsetY || 0) + 10)}
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                            title="Move down"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                        </div>
                        
                        <div
                          key={`body-text-${contentEditableKey}`}
                          ref={bodyTextRef}
                          contentEditable
                          suppressContentEditableWarning
                          className="outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-2 py-1 rounded cursor-text whitespace-pre-wrap border border-transparent hover:border-gray-200 focus:border-amber-300 flex-1 print-no-border"
                          style={{ fontFamily: 'Calibri, sans-serif', fontSize: '20px', lineHeight: '1.5', paddingBottom: cardData.showProducer !== false ? '50px' : '0' }}
                          onInput={() => { hasUnsavedChanges.current = true; }}
                          onBlur={(e) => updateField('bodyText', e.currentTarget.innerHTML || '')}
                          onMouseUp={saveCursorPosition}
                          onKeyUp={saveCursorPosition}
                          data-testid="body-text-editor"
                          dangerouslySetInnerHTML={{ __html: (cardData.bodyText || defaultBodyText).replace(/\n/g, '<br/>') }}
                        />
                      </div>
                      
                      {/* Add dot point button */}
                      <Button
                        size="sm"
                        variant="outline"
                        onMouseDown={(e) => {
                          e.preventDefault(); // Prevent focus change before capturing position
                          insertDotPointAtCursor(false);
                        }}
                        className="mt-2 text-amber-600 border-amber-300 hover:bg-amber-50 print-hidden ignore-print"
                        data-testid="btn-add-dot-point"
                      >
                        <Circle className="w-3 h-3 mr-1 fill-current" />
                        Dot Point
                      </Button>
                      
                      {/* Producer Field - absolutely positioned at bottom right */}
                      <div className="absolute bottom-0 right-0">
                        {cardData.showProducer !== false ? (
                          <div className="flex items-stretch group/producer casting-card-producer-corner relative">
                            <span 
                              className="casting-card-producer-label px-4 py-2 font-semibold text-sm flex items-center"
                              style={{ backgroundColor: '#e5e7eb', border: '1px solid #d1d5db', color: '#000000' }}
                            >PRODUCER:</span>
                            {/* Plain text for print - always visible */}
                            <span 
                              className="casting-card-producer-name-print px-4 py-2 font-bold text-sm min-w-[120px] flex items-center"
                              style={{ backgroundColor: '#facc15', color: '#000000' }}
                            >{cardData.producerName || 'SELECT'}</span>
                            {/* Dropdown for UI - positioned on top, hidden during PDF/print */}
                            <div className="absolute right-0 ignore-print" style={{ left: 'calc(100% - 120px - 16px)', top: 0 }}>
                              <Select 
                                value={cardData.producerName || ''} 
                                onValueChange={(value) => updateField('producerName', value === '__clear__' ? '' : value)}
                              >
                                <SelectTrigger 
                                  className="casting-card-producer-name h-auto px-4 py-2 font-bold text-sm border-0 rounded-none min-w-[120px]"
                                  style={{ backgroundColor: '#facc15', color: '#000000' }}
                                  data-testid="select-producer-name-preview"
                                >
                                  <SelectValue placeholder="SELECT" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__clear__" className="text-muted-foreground italic">Clear</SelectItem>
                                  {PRODUCER_NAMES.map(name => (
                                    <SelectItem key={name} value={name}>{name}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <button
                              onClick={() => updateField('showProducer', false)}
                              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover/producer:opacity-100 transition-opacity ignore-print print:hidden"
                              title="Remove producer field"
                              data-testid="btn-remove-producer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => updateField('showProducer', true)}
                            className="text-xs print:hidden ignore-print"
                            data-testid="btn-add-producer"
                          >
                            <Plus className="w-3 h-3 mr-1" />
                            Add Producer
                          </Button>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <Card className="flex-1 flex items-center justify-center" data-testid="casting-empty-state">
          <div className="text-center text-muted-foreground">
            <CreditCard className="h-12 w-12 mx-auto mb-3 opacity-50" />
            <p data-testid="text-empty-state">Select a contestant to create or edit their casting card</p>
          </div>
        </Card>
      )}

      {/* Conflict Detection Dialog */}
      <Dialog open={conflictDialogOpen} onOpenChange={setConflictDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Save Conflict Detected
            </DialogTitle>
            <DialogDescription>
              This casting card was modified by another user since you opened it.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            {conflictData && (
              <p className="text-sm text-muted-foreground">
                Server version was updated: {new Date(conflictData.serverUpdatedAt).toLocaleString()}
              </p>
            )}
            <p className="text-sm">
              What would you like to do?
            </p>
          </div>
          <DialogFooter className="flex gap-2 sm:justify-between">
            <Button
              variant="outline"
              onClick={handleRefreshFromServer}
              className="flex-1"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Discard my changes
            </Button>
            <Button
              variant="default"
              onClick={handleOverwriteConflict}
              className="flex-1 bg-amber-600 hover:bg-amber-700"
            >
              Overwrite with mine
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Version History Dialog */}
      <Dialog open={versionHistoryOpen} onOpenChange={setVersionHistoryOpen}>
        <DialogContent className="max-w-lg max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              Version History
            </DialogTitle>
            <DialogDescription>
              Previous versions of this casting card. Versions are saved automatically every 10 minutes during editing.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2 max-h-[400px] overflow-y-auto">
            {loadingVersions ? (
              <div className="text-center py-8 text-muted-foreground">Loading versions...</div>
            ) : cardVersions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>No version history yet</p>
                <p className="text-xs mt-1">Versions are saved automatically every 10 minutes during editing.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cardVersions.map((version) => {
                  // Handle both string and object cardData safely
                  let parsedData: any = {};
                  try {
                    parsedData = typeof version.cardData === 'string' 
                      ? JSON.parse(version.cardData) 
                      : version.cardData;
                  } catch (e) {
                    console.error('Failed to parse version cardData:', e);
                  }
                  return (
                    <div key={version.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-md border">
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          {new Date(version.createdAt).toLocaleDateString()} at {new Date(version.createdAt).toLocaleTimeString()}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {version.createdBy && <span>By: {version.createdBy}</span>}
                          {parsedData.isReady && <Badge variant="outline" className="text-[10px] py-0">RX Ready</Badge>}
                          {parsedData.isDraftComplete && <Badge variant="outline" className="text-[10px] py-0">Draft</Badge>}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (existingCard?.id) {
                            restoreVersionMutation.mutate({ cardId: existingCard.id, versionId: version.id });
                          }
                        }}
                        disabled={restoreVersionMutation.isPending}
                        data-testid={`btn-restore-version-${version.id}`}
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Restore
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionHistoryOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* PowerPoint Import Dialog */}
      <Dialog open={pptxImportOpen} onOpenChange={(open) => {
        setPptxImportOpen(open);
        if (!open) {
          setPptxFile(null);
          setPptxPreviewData(null);
          setPptxSearchQuery('');
          setPptxSearchResults([]);
          setPptxSearchingFor(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Casting Cards from PowerPoint
            </DialogTitle>
            <DialogDescription>
              Upload a PowerPoint file containing casting cards. The system will extract the content and match it to contestants.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-auto">
            {!pptxPreviewData ? (
              <div className="flex flex-col items-center justify-center py-12 gap-4">
                <input
                  type="file"
                  ref={pptxFileInputRef}
                  className="hidden"
                  accept=".pptx"
                  onChange={handlePptxFileSelect}
                />
                <div className="text-center">
                  <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="font-semibold text-lg mb-2">Upload PowerPoint File</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Select a .pptx file containing your casting cards
                  </p>
                </div>
                <Button
                  onClick={() => pptxFileInputRef.current?.click()}
                  disabled={pptxImportLoading}
                  data-testid="btn-select-pptx-file"
                >
                  {pptxImportLoading ? (
                    <>
                      <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                      Parsing...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      Select File
                    </>
                  )}
                </Button>
                {pptxFile && (
                  <p className="text-sm text-muted-foreground">
                    Selected: {pptxFile.name}
                  </p>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    Found {pptxPreviewData.length} cards. Match them to contestants below.
                  </p>
                  <Badge variant="outline">
                    {pptxPreviewData.filter(c => c.selectedContestantId).length} / {pptxPreviewData.length} matched
                  </Badge>
                </div>
                
                <div className="border rounded-lg divide-y max-h-[400px] overflow-auto">
                  {pptxPreviewData.map((card) => (
                    <div key={card.slideNumber} className="p-4 hover:bg-muted/50">
                      <div className="flex items-start gap-4">
                        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-medium">
                          {card.slideNumber}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold">{card.extractedName}</span>
                            {card.hasMainPhoto && (
                              <Badge variant="secondary" className="text-xs">Has Photo</Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate">
                            {card.occupation || card.ageState || 'No details'}
                          </p>
                          {card.bodyText && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {card.bodyText.substring(0, 150)}...
                            </p>
                          )}
                        </div>
                        <div className="flex-shrink-0 w-64">
                          {card.selectedContestantId ? (
                            <div className="flex items-center gap-2">
                              <Badge variant="default" className="flex-1 justify-center">
                                <CheckCircle2 className="h-3 w-3 mr-1" />
                                {card.match?.name}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => {
                                  setPptxPreviewData(prev => prev?.map(c => 
                                    c.slideNumber === card.slideNumber 
                                      ? { ...c, selectedContestantId: undefined, match: null }
                                      : c
                                  ) || null);
                                }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {card.candidates.length > 0 && pptxSearchingFor !== card.slideNumber ? (
                                <div className="space-y-1">
                                  <p className="text-xs text-muted-foreground">Suggestions:</p>
                                  {card.candidates.slice(0, 3).map(candidate => (
                                    <button
                                      key={candidate.id}
                                      onClick={() => handlePptxSelectContestant(card.slideNumber, candidate.id, candidate.name)}
                                      className="w-full text-left text-sm px-2 py-1 rounded hover:bg-accent truncate"
                                    >
                                      {candidate.name}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                              
                              {pptxSearchingFor === card.slideNumber ? (
                                <div className="space-y-2">
                                  <Input
                                    placeholder="Search contestant..."
                                    value={pptxSearchQuery}
                                    onChange={(e) => handlePptxSearch(e.target.value, card.slideNumber)}
                                    autoFocus
                                    className="h-8 text-sm"
                                  />
                                  {pptxSearchResults.length > 0 && (
                                    <div className="border rounded max-h-32 overflow-auto">
                                      {pptxSearchResults.map(result => (
                                        <button
                                          key={result.id}
                                          onClick={() => handlePptxSelectContestant(card.slideNumber, result.id, result.name)}
                                          className="w-full text-left text-sm px-2 py-1.5 hover:bg-accent border-b last:border-b-0"
                                        >
                                          {result.name} ({result.gender === 'Female' ? 'F' : 'M'}, {result.age})
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      setPptxSearchingFor(null);
                                      setPptxSearchQuery('');
                                      setPptxSearchResults([]);
                                    }}
                                    className="text-xs"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setPptxSearchingFor(card.slideNumber)}
                                  className="w-full text-xs"
                                >
                                  <Search className="h-3 w-3 mr-1" />
                                  Search Contestant
                                </Button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <DialogFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setPptxImportOpen(false);
                setPptxFile(null);
                setPptxPreviewData(null);
              }}
            >
              Cancel
            </Button>
            {pptxPreviewData && (
              <Button
                onClick={handlePptxImport}
                disabled={pptxImportLoading || !pptxPreviewData.some(c => c.selectedContestantId)}
                data-testid="btn-confirm-pptx-import"
              >
                {pptxImportLoading ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Import {pptxPreviewData.filter(c => c.selectedContestantId).length} Cards
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function loadPlanningData(): RXPlanningData {
  try {
    const stored = localStorage.getItem(PLANNING_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function savePlanningData(data: RXPlanningData) {
  localStorage.setItem(PLANNING_STORAGE_KEY, JSON.stringify(data));
}

// Helper to get ISO week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

// RX Planning Tab Component
function RXPlanningTab({ recordDays, contestants }: { recordDays: RecordDay[]; contestants: Contestant[] }) {
  const { toast } = useToast();
  const [selectedDayId, setSelectedDayId] = useState<string>('');
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilters, setRatingFilters] = useState<string[]>([]);
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [ageFilter, setAgeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [planningData, setPlanningData] = useState<RXPlanningData>(loadPlanningData);
  const [draggedContestant, setDraggedContestant] = useState<PlannedContestant | null>(null);
  const [dragSource, setDragSource] = useState<{ type: 'pool' | 'block'; block?: string; dayId?: string } | null>(null);
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; name: string } | null>(null);
  const [viewingContestant, setViewingContestant] = useState<Contestant | null>(null);
  const [viewMode, setViewMode] = useState<'single' | 'weekly'>('single');
  const [hideNPBs, setHideNPBs] = useState(false);
  const [bookingContestant, setBookingContestant] = useState<Contestant | null>(null);
  const [bookingDayId, setBookingDayId] = useState<string>('');
  const [selectedBlock, setSelectedBlock] = useState<string>('');
  const [selectedSeat, setSelectedSeat] = useState<string>('');
  const [customNameInputs, setCustomNameInputs] = useState<{ [blockKey: string]: string }>({});
  const [editingNoteKey, setEditingNoteKey] = useState<string | null>(null); // Format: "dayId-blockNum-contestantId"
  const [noteInputValue, setNoteInputValue] = useState<string>('');

  // Fetch block types from API - refetch when tab is shown to sync with seating chart changes
  const { data: blockTypes = [] } = useQuery<BlockTypeData[]>({
    queryKey: ['/api/record-days', selectedDayId, 'block-types'],
    enabled: !!selectedDayId,
    staleTime: 0, // Always fetch fresh data to sync with seating chart
    refetchOnMount: 'always', // Refetch when component mounts (e.g., tab switch)
  });

  // Fetch groups for booking dialog
  const { data: groups = [] } = useQuery<any[]>({
    queryKey: ['/api/groups'],
  });

  // Fetch seat assignments for the booking day to check availability
  const { data: bookingDayAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments', bookingDayId],
    enabled: !!bookingDayId,
  });

  // Fetch block types for the booking day specifically
  const { data: bookingDayBlockTypes = [] } = useQuery<BlockTypeData[]>({
    queryKey: ['/api/record-days', bookingDayId, 'block-types'],
    enabled: !!bookingDayId,
  });

  // Fetch casting cards to check for draft complete status
  const { data: castingCards = [] } = useQuery<any[]>({
    queryKey: ['/api/casting-cards'],
  });

  // Create a set of contestant IDs with draft complete casting cards
  const draftCompleteContestantIds = useMemo(() => {
    const ids = new Set<string>();
    castingCards.forEach(card => {
      if (card.isDraftComplete && card.contestantId) {
        ids.add(card.contestantId);
      }
    });
    return ids;
  }, [castingCards]);

  // State for viewing casting card preview
  const [viewingCastingCardContestantId, setViewingCastingCardContestantId] = useState<string | null>(null);

  // Book contestant mutation
  const bookContestantMutation = useMutation({
    mutationFn: async ({ recordDayId, contestantId, blockNumber, seatLabel, skipPostcodeWarning }: { 
      recordDayId: string; contestantId: string; blockNumber: number; seatLabel: string; skipPostcodeWarning?: boolean 
    }) => {
      const response = await apiRequest('POST', '/api/seat-assignments', {
        recordDayId,
        contestantId,
        blockNumber,
        seatLabel,
        playerType: 'regular',
        skipPostcodeWarning,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({ title: "Booked!", description: "Contestant has been assigned to the seat" });
      setBookingContestant(null);
      setBookingDayId('');
      setSelectedBlock('');
      setSelectedSeat('');
    },
    onError: (error: any, variables) => {
      // Try to parse the error message as JSON (API errors come as "status: {json}")
      let parsedError: any = null;
      try {
        const errorMsg = error?.message || '';
        const jsonMatch = errorMsg.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          parsedError = JSON.parse(jsonMatch[1]);
        }
      } catch (e) {
        // Not JSON, continue with regular error handling
      }
      
      // Check if this is an OUTSIDE_VICTORIA warning that requires confirmation
      if (parsedError?.code === 'OUTSIDE_VICTORIA' && parsedError?.requiresConfirmation) {
        const confirmed = window.confirm(
          `⚠️ INTERSTATE CONTESTANT\n\n${parsedError.contestantName} is from ${parsedError.state || 'outside Victoria'}.\n\nDo you want to proceed with booking?`
        );
        if (confirmed) {
          // Retry with skip flag
          bookContestantMutation.mutate({ ...variables, skipPostcodeWarning: true });
        }
        return;
      }
      const errorMessage = parsedError?.error || error.message || "Failed to book contestant";
      toast({ title: "Booking failed", description: errorMessage, variant: "destructive" });
    },
  });

  // Book group mutation
  const bookGroupMutation = useMutation({
    mutationFn: async ({ recordDayId, contestantIds, blockNumber, startingSeat, skipPostcodeWarning }: { 
      recordDayId: string; contestantIds: string[]; blockNumber: number; startingSeat: string; skipPostcodeWarning?: boolean 
    }) => {
      const response = await apiRequest('POST', '/api/seat-assignments/group', {
        recordDayId,
        contestantIds,
        blockNumber,
        startingSeat,
        skipPostcodeWarning,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/contestants'] });
      toast({ title: "Group Booked!", description: "All group members have been assigned consecutive seats" });
      setBookingContestant(null);
      setBookingDayId('');
      setSelectedBlock('');
      setSelectedSeat('');
    },
    onError: (error: any, variables) => {
      // Try to parse the error message as JSON (API errors come as "status: {json}")
      let parsedError: any = null;
      try {
        const errorMsg = error?.message || '';
        const jsonMatch = errorMsg.match(/^\d+:\s*(.+)$/);
        if (jsonMatch) {
          parsedError = JSON.parse(jsonMatch[1]);
        }
      } catch (e) {
        // Not JSON, continue with regular error handling
      }
      
      // Check if this is an OUTSIDE_VICTORIA warning that requires confirmation
      if (parsedError?.code === 'OUTSIDE_VICTORIA' && parsedError?.requiresConfirmation) {
        const confirmed = window.confirm(
          `⚠️ INTERSTATE CONTESTANT\n\n${parsedError.contestantName} is from ${parsedError.state || 'outside Victoria'}.\n\nDo you want to proceed with booking?`
        );
        if (confirmed) {
          // Retry with skip flag
          bookGroupMutation.mutate({ ...variables, skipPostcodeWarning: true });
        }
        return;
      }
      const errorMessage = parsedError?.error || error.message || "Failed to book group";
      toast({ title: "Group booking failed", description: errorMessage, variant: "destructive" });
    },
  });

  const updateBlockTypeMutation = useMutation({
    mutationFn: async ({ dayId, blockNumber, blockType }: { dayId: string; blockNumber: number; blockType: 'PB' | 'NPB' }) => {
      if (!dayId) throw new Error("No record day selected");
      const response = await apiRequest('PUT', `/api/record-days/${dayId}/block-types/${blockNumber}`, { blockType });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/record-days', variables.dayId, 'block-types'] });
      queryClient.invalidateQueries({ queryKey: ['/api/record-days'] });
      toast({ title: "Block type saved", description: "This change is reflected on the seating chart" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update block type", variant: "destructive" });
    },
  });

  const handleBlockTypeChange = (blockNumber: number, blockType: 'PB' | 'NPB') => {
    if (!selectedDayId) return;
    updateBlockTypeMutation.mutate({ dayId: selectedDayId, blockNumber, blockType });
  };

  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  // Group record days by calendar week
  const weekGroups = useMemo(() => {
    const groups: { key: string; label: string; days: RecordDay[] }[] = [];
    let currentWeek: RecordDay[] = [];
    let currentWeekNum = -1;
    let currentYear = -1;

    sortedRecordDays.forEach((day, idx) => {
      const date = new Date(day.date);
      const weekNum = getWeekNumber(date);
      const year = date.getFullYear();

      if (currentWeekNum === -1 || (weekNum === currentWeekNum && year === currentYear)) {
        currentWeek.push(day);
        currentWeekNum = weekNum;
        currentYear = year;
      } else {
        // Save current week and start new one
        if (currentWeek.length > 0) {
          const firstRx = currentWeek[0].rxNumber || `Day ${sortedRecordDays.indexOf(currentWeek[0]) + 1}`;
          const lastRx = currentWeek[currentWeek.length - 1].rxNumber || `Day ${sortedRecordDays.indexOf(currentWeek[currentWeek.length - 1]) + 1}`;
          const rxRange = currentWeek.length === 1 ? firstRx : `${firstRx} - ${lastRx}`;
          groups.push({
            key: `${currentYear}-${currentWeekNum}`,
            label: rxRange,
            days: [...currentWeek],
          });
        }
        currentWeek = [day];
        currentWeekNum = weekNum;
        currentYear = year;
      }
    });

    // Don't forget the last week
    if (currentWeek.length > 0) {
      const firstRx = currentWeek[0].rxNumber || `Day ${sortedRecordDays.indexOf(currentWeek[0]) + 1}`;
      const lastRx = currentWeek[currentWeek.length - 1].rxNumber || `Day ${sortedRecordDays.indexOf(currentWeek[currentWeek.length - 1]) + 1}`;
      const rxRange = currentWeek.length === 1 ? firstRx : `${firstRx} - ${lastRx}`;
      groups.push({
        key: `${currentYear}-${currentWeekNum}`,
        label: rxRange,
        days: [...currentWeek],
      });
    }

    return groups;
  }, [sortedRecordDays]);

  useEffect(() => {
    if (!selectedDayId && sortedRecordDays.length > 0) {
      setSelectedDayId(sortedRecordDays[0].id);
    }
    if (!selectedWeekKey && weekGroups.length > 0) {
      setSelectedWeekKey(weekGroups[0].key);
    }
  }, [sortedRecordDays, selectedDayId, weekGroups, selectedWeekKey]);

  // Get block type for a specific block
  const getBlockType = (blockNumber: number): 'PB' | 'NPB' | null => {
    const bt = blockTypes.find(b => b.blockNumber === blockNumber);
    return bt?.blockType || null;
  };

  // Filter to A+ and A contestants only
  const eligibleContestants = useMemo(() => {
    return contestants.filter(c => {
      const rating = c.auditionRating?.toUpperCase();
      return rating === 'A+' || rating === 'A';
    });
  }, [contestants]);

  // Get contestants already planned for current day
  const plannedContestantIds = useMemo(() => {
    if (!selectedDayId || !planningData[selectedDayId]) return new Set<string>();
    const ids = new Set<string>();
    Object.values(planningData[selectedDayId].blocks || {}).forEach(blockContestants => {
      blockContestants.forEach(c => ids.add(c.id));
    });
    return ids;
  }, [selectedDayId, planningData]);

  // Get the days for the selected week (for weekly view)
  const weekDays = useMemo(() => {
    if (!selectedWeekKey) return [];
    const week = weekGroups.find(w => w.key === selectedWeekKey);
    return week?.days || [];
  }, [selectedWeekKey, weekGroups]);

  // Fetch block types for all week days (for weekly view NPB filtering)
  const weekBlockTypesQueries = useQueries({
    queries: weekDays.map(day => ({
      queryKey: ['/api/record-days', day.id, 'block-types'],
      enabled: viewMode === 'weekly' && weekDays.length > 0,
      staleTime: 0,
    })),
  });

  // Create a map of day.id -> block number -> block type for weekly view
  const weekBlockTypesMap = useMemo(() => {
    const map: { [dayId: string]: { [blockNum: string]: 'PB' | 'NPB' | null } } = {};
    weekDays.forEach((day, index) => {
      map[day.id] = {};
      const queryData = weekBlockTypesQueries[index]?.data as BlockTypeData[] | undefined;
      if (queryData) {
        queryData.forEach(bt => {
          map[day.id][bt.blockNumber.toString()] = bt.blockType;
        });
      }
    });
    return map;
  }, [weekDays, weekBlockTypesQueries]);

  // Get all planned contestant IDs across week (for filtering pool in weekly view)
  const weekPlannedContestantIds = useMemo(() => {
    const ids = new Set<string>();
    weekDays.forEach(day => {
      if (planningData[day.id]?.blocks) {
        Object.values(planningData[day.id].blocks).forEach(blockContestants => {
          blockContestants.forEach(c => ids.add(c.id));
        });
      }
    });
    return ids;
  }, [weekDays, planningData]);

  // Filtered contestant pool (not yet assigned to any block)
  const filteredPool = useMemo(() => {
    // In weekly view, exclude contestants planned in any of the week's days
    const excludeIds = viewMode === 'weekly' ? weekPlannedContestantIds : plannedContestantIds;
    return eligibleContestants.filter(c => {
      if (excludeIds.has(c.id)) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (!c.name.toLowerCase().includes(term) && 
            !c.email?.toLowerCase().includes(term) &&
            !c.phone?.includes(term)) return false;
      }
      if (ratingFilters.length > 0 && !ratingFilters.includes(c.auditionRating?.toUpperCase() || '')) return false;
      if (genderFilter !== 'all' && c.gender?.toLowerCase() !== genderFilter.toLowerCase()) return false;
      // Status filter
      if (statusFilter !== 'all' && (c as any).availabilityStatus !== statusFilter) return false;
      // Age filter
      if (ageFilter !== 'all' && c.age) {
        const age = c.age;
        switch (ageFilter) {
          case '18-29': if (age < 18 || age > 29) return false; break;
          case '30-39': if (age < 30 || age > 39) return false; break;
          case '40-49': if (age < 40 || age > 49) return false; break;
          case '50-59': if (age < 50 || age > 59) return false; break;
          case '60-69': if (age < 60 || age > 69) return false; break;
          case '70+': if (age < 70) return false; break;
        }
      } else if (ageFilter !== 'all' && !c.age) {
        return false; // Exclude contestants without age data when filtering by age
      }
      return true;
    });
  }, [eligibleContestants, plannedContestantIds, weekPlannedContestantIds, viewMode, searchTerm, ratingFilters, genderFilter, ageFilter, statusFilter]);

  // Get blocks for current day
  const currentDayBlocks = useMemo(() => {
    const blocks: { [key: string]: PlannedContestant[] } = { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] };
    if (selectedDayId && planningData[selectedDayId]?.blocks) {
      Object.keys(blocks).forEach(block => {
        blocks[block] = planningData[selectedDayId].blocks[block] || [];
      });
    }
    return blocks;
  }, [selectedDayId, planningData]);

  const handleDragStart = (contestant: PlannedContestant, source: { type: 'pool' | 'block'; block?: string; dayId?: string }) => {
    setDraggedContestant(contestant);
    setDragSource(source);
  };

  const handleDragEnd = () => {
    setDraggedContestant(null);
    setDragSource(null);
  };

  const handleDrop = (targetBlock: string, targetDayId?: string, blockTypeOverride?: 'PB' | 'NPB' | null) => {
    if (!draggedContestant) return;
    const dropDayId = targetDayId || selectedDayId;
    if (!dropDayId) return;

    // Don't allow drops on NPB blocks
    const targetBlockType = blockTypeOverride !== undefined ? blockTypeOverride : getBlockType(parseInt(targetBlock));
    if (targetBlockType === 'NPB') {
      toast({ title: "Cannot add to NPB", description: "Players can only be placed in PB blocks", variant: "destructive" });
      handleDragEnd();
      return;
    }

    setPlanningData(prev => {
      const updated = { ...prev };
      if (!updated[dropDayId]) {
        updated[dropDayId] = { blocks: { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] } };
      }

      // Remove from source if coming from a block
      if (dragSource?.type === 'block' && dragSource.block) {
        const sourceDayId = dragSource.dayId || selectedDayId;
        if (sourceDayId && updated[sourceDayId]?.blocks[dragSource.block]) {
          updated[sourceDayId].blocks[dragSource.block] = 
            updated[sourceDayId].blocks[dragSource.block].filter(c => c.id !== draggedContestant.id);
        }
      }

      // Add to target block
      if (!updated[dropDayId].blocks[targetBlock]) {
        updated[dropDayId].blocks[targetBlock] = [];
      }
      // Avoid duplicates
      if (!updated[dropDayId].blocks[targetBlock].find(c => c.id === draggedContestant.id)) {
        updated[dropDayId].blocks[targetBlock].push(draggedContestant);
      }

      savePlanningData(updated);
      return updated;
    });

    toast({ title: "Added to Block " + targetBlock });
    handleDragEnd();
  };

  const removeFromBlock = (blockNumber: string, contestantId: string, dayId?: string) => {
    const removeDayId = dayId || selectedDayId;
    if (!removeDayId) return;
    setPlanningData(prev => {
      const updated = { ...prev };
      if (updated[removeDayId]?.blocks[blockNumber]) {
        updated[removeDayId].blocks[blockNumber] = 
          updated[removeDayId].blocks[blockNumber].filter(c => c.id !== contestantId);
      }
      savePlanningData(updated);
      return updated;
    });
  };

  // Update note for a contestant in a block
  const updateContestantNote = (blockNumber: string, contestantId: string, note: string, dayId?: string) => {
    const updateDayId = dayId || selectedDayId;
    if (!updateDayId) return;
    setPlanningData(prev => {
      const updated = { ...prev };
      if (updated[updateDayId]?.blocks[blockNumber]) {
        updated[updateDayId].blocks[blockNumber] = updated[updateDayId].blocks[blockNumber].map(c =>
          c.id === contestantId ? { ...c, note: note.trim() || undefined } : c
        );
      }
      savePlanningData(updated);
      return updated;
    });
  };

  // Start editing a note
  const startEditingNote = (dayId: string, blockNum: string, contestantId: string, currentNote?: string) => {
    setEditingNoteKey(`${dayId}-${blockNum}-${contestantId}`);
    setNoteInputValue(currentNote || '');
  };

  // Save and close note editing
  const saveNote = (blockNum: string, contestantId: string, dayId?: string) => {
    updateContestantNote(blockNum, contestantId, noteInputValue, dayId);
    setEditingNoteKey(null);
    setNoteInputValue('');
  };

  // Add custom name to a block (for names not in contestant list)
  const addCustomToBlock = (blockNumber: string, name: string, dayId?: string) => {
    const addDayId = dayId || selectedDayId;
    if (!addDayId || !name.trim()) return;
    
    const customContestant: PlannedContestant = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: name.trim(),
      gender: '',
      age: null,
      rating: null,
      location: null,
      phone: null,
      email: null,
      photoUrl: null,
      attendingWith: null,
      isCustom: true,
    };
    
    setPlanningData(prev => {
      const updated = { ...prev };
      if (!updated[addDayId]) {
        updated[addDayId] = { blocks: {} };
      }
      if (!updated[addDayId].blocks[blockNumber]) {
        updated[addDayId].blocks[blockNumber] = [];
      }
      updated[addDayId].blocks[blockNumber].push(customContestant);
      savePlanningData(updated);
      return updated;
    });
  };

  // Get blocks for a specific day (for weekly view)
  const getBlocksForDay = (dayId: string) => {
    const blocks: { [key: string]: PlannedContestant[] } = { '1': [], '2': [], '3': [], '4': [], '5': [], '6': [], '7': [] };
    if (planningData[dayId]?.blocks) {
      Object.keys(blocks).forEach(block => {
        blocks[block] = planningData[dayId].blocks[block] || [];
      });
    }
    return blocks;
  };

  // Find full contestant record by ID
  const findContestant = (id: string) => contestants.find(c => c.id === id);

  // Get group members for a contestant
  const getGroupMembers = (contestant: Contestant): Contestant[] => {
    const contestantGroupId = (contestant as any).groupId;
    
    // First, try to find via groupId
    if (contestantGroupId) {
      const groupMembers = contestants.filter(c => (c as any).groupId === contestantGroupId && c.id !== contestant.id);
      if (groupMembers.length > 0) return groupMembers;
    }
    
    // If no groupId or no members found, try via attendingWith
    if (contestant.attendingWith) {
      const partnerNames = getPartnerNames(contestant.attendingWith);
      if (partnerNames.length > 0) {
        const attendingWithPartners = contestants.filter(c => {
          if (c.id === contestant.id) return false;
          return partnerNames.some(partnerName => {
            const name = c.name?.toLowerCase().trim() || '';
            const pName = partnerName.toLowerCase().trim();
            const nameParts = name.split(' ').filter(p => p.length >= 3);
            const pNameParts = pName.split(' ').filter(p => p.length >= 3);
            
            // Exact full name match
            if (name === pName) return true;
            
            // If partner name has 2+ parts, require at least 2 parts to match (first + last name)
            if (pNameParts.length >= 2) {
              const matchCount = pNameParts.filter(pp => nameParts.includes(pp)).length;
              return matchCount >= 2;
            }
            
            // Single name only (e.g., "Gianni") - require exact first name match AND only 1 contestant matches
            if (pNameParts.length === 1) {
              // Only match if it's an exact first name match, not partial
              return nameParts[0] === pNameParts[0];
            }
            
            return false;
          });
        });
        
        // For reciprocal check, also be stricter
        const reciprocalPartners = contestants.filter(c => {
          if (c.id === contestant.id) return false;
          if (attendingWithPartners.some(p => p.id === c.id)) return false;
          if (!c.attendingWith) return false;
          
          // Check if c's attendingWith mentions contestant - require stronger matching
          const cPartnerNames = getPartnerNames(c.attendingWith);
          const contestantName = (contestant.name || '').toLowerCase().trim();
          const contestantParts = contestantName.split(' ').filter(p => p.length >= 3);
          
          return cPartnerNames.some(pn => {
            const pnParts = pn.toLowerCase().trim().split(' ').filter(p => p.length >= 3);
            // Require at least 2 parts match if target has 2+ parts
            if (contestantParts.length >= 2 && pnParts.length >= 2) {
              const matchCount = pnParts.filter(pp => contestantParts.includes(pp)).length;
              return matchCount >= 2;
            }
            // Single name match only if exact first name
            if (pnParts.length === 1 && contestantParts.length >= 1) {
              return pnParts[0] === contestantParts[0];
            }
            return false;
          });
        });
        
        return [...attendingWithPartners, ...reciprocalPartners];
      }
    }
    
    return [];
  };

  // Open booking dialog for a contestant
  const openBookingDialog = (contestant: Contestant, dayId: string) => {
    setBookingContestant(contestant);
    setBookingDayId(dayId);
    setSelectedBlock('');
    setSelectedSeat('');
  };

  // Handle booking confirmation
  const handleBooking = () => {
    if (!bookingContestant || !bookingDayId || !selectedBlock || !selectedSeat) return;
    
    const groupMembers = getGroupMembers(bookingContestant);
    
    if (groupMembers.length > 0) {
      // Book as a group
      const allContestantIds = [bookingContestant.id, ...groupMembers.map(m => m.id)];
      bookGroupMutation.mutate({
        recordDayId: bookingDayId,
        contestantIds: allContestantIds,
        blockNumber: parseInt(selectedBlock),
        startingSeat: selectedSeat,
      });
    } else {
      // Book single contestant
      bookContestantMutation.mutate({
        recordDayId: bookingDayId,
        contestantId: bookingContestant.id,
        blockNumber: parseInt(selectedBlock),
        seatLabel: selectedSeat,
      });
    }
  };

  // Get available seats for a block
  const getAvailableSeats = (blockNumber: string): string[] => {
    const SEAT_ROWS: Record<string, number> = { A: 5, B: 5, C: 4, D: 4, E: 4 };
    const allSeats: string[] = [];
    Object.entries(SEAT_ROWS).forEach(([row, count]) => {
      for (let i = 1; i <= count; i++) {
        allSeats.push(`${row}${i}`);
      }
    });
    
    // Filter out occupied seats
    const occupiedSeats = new Set(
      bookingDayAssignments
        .filter((a: any) => a.blockNumber === parseInt(blockNumber))
        .map((a: any) => a.seatLabel)
    );
    
    return allSeats.filter(seat => !occupiedSeats.has(seat));
  };

  // Get PB blocks for the booking day
  const getBookingDayPBBlocks = (): string[] => {
    // Use the booking day's block types (not the selected day's)
    return bookingDayBlockTypes
      .filter(b => b.blockType === 'PB')
      .map(b => String(b.blockNumber))
      .sort((a, b) => parseInt(a) - parseInt(b));
  };

  const clearDayPlan = () => {
    if (!selectedDayId) return;
    setPlanningData(prev => {
      const updated = { ...prev };
      delete updated[selectedDayId];
      savePlanningData(updated);
      return updated;
    });
    toast({ title: "Plan cleared", description: "All contestants removed from this day's plan" });
  };

  const convertToPlannedContestant = (c: Contestant): PlannedContestant => ({
    id: c.id,
    name: c.name,
    gender: c.gender,
    age: c.age,
    rating: c.auditionRating,
    location: c.suburb,
    phone: c.phone,
    email: c.email,
    photoUrl: c.photoUrl,
    attendingWith: c.attendingWith,
  });

  // Count PB and NPB blocks
  const pbCount = blockTypes.filter(b => b.blockType === 'PB').length;
  const npbCount = blockTypes.filter(b => b.blockType === 'NPB').length;

  return (
    <div className="space-y-6">
      {/* Header with day selector and view mode */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">RX Day Player Planner</h2>
          <p className="text-sm text-muted-foreground">Configure PB/NPB blocks (syncs to seating chart) and plan players visually</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* View mode toggle */}
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={viewMode === 'single' ? 'default' : 'outline'}
              onClick={() => setViewMode('single')}
              data-testid="button-view-single"
            >
              Single Day
            </Button>
            <Button
              size="sm"
              variant={viewMode === 'weekly' ? 'default' : 'outline'}
              onClick={() => setViewMode('weekly')}
              data-testid="button-view-weekly"
            >
              Weekly
            </Button>
          </div>

          {/* Single Day Selector */}
          {viewMode === 'single' && (
            <Select value={selectedDayId} onValueChange={setSelectedDayId}>
              <SelectTrigger className="w-[220px]" data-testid="select-planning-day">
                <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select RX Day..." />
              </SelectTrigger>
              <SelectContent>
                {sortedRecordDays.map(day => (
                  <SelectItem key={day.id} value={day.id}>
                    {day.rxNumber} - {format(new Date(day.date), 'EEE dd/MM')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Week Selector (for weekly view) */}
          {viewMode === 'weekly' && (
            <Select value={selectedWeekKey} onValueChange={setSelectedWeekKey}>
              <SelectTrigger className="w-[200px]" data-testid="select-planning-week">
                <Calendar className="h-4 w-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select Week..." />
              </SelectTrigger>
              <SelectContent>
                {weekGroups.map(week => (
                  <SelectItem key={week.key} value={week.key}>
                    {week.label} ({week.days.length} {week.days.length === 1 ? 'day' : 'days'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button 
            variant={hideNPBs ? "default" : "outline"}
            size="sm"
            onClick={() => setHideNPBs(!hideNPBs)}
            data-testid="button-hide-npbs"
          >
            {hideNPBs ? "Show NPBs" : "Hide NPBs"}
          </Button>

          <Button 
            variant="outline" 
            size="sm"
            onClick={clearDayPlan}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
            data-testid="button-clear-plan"
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Clear
          </Button>
        </div>
      </div>

      {/* PB/NPB counter - only show in single day mode */}
      {selectedDayId && viewMode === 'single' && (
        <div className="flex items-center gap-4">
          <Badge className={`${pbCount === 5 ? 'bg-blue-500' : 'bg-muted'}`}>
            PB: {pbCount}/5
          </Badge>
          <Badge className={`${npbCount === 2 ? 'bg-amber-500' : 'bg-muted'}`}>
            NPB: {npbCount}/2
          </Badge>
          {pbCount === 5 && npbCount === 2 && (
            <span className="text-sm text-green-600 dark:text-green-400 font-medium">Configuration complete</span>
          )}
        </div>
      )}

      {!selectedDayId ? (
        <Card className="p-8 text-center text-muted-foreground">
          Select an RX Day to start planning blocks
        </Card>
      ) : (
        <div className="flex gap-6">
          {/* Contestant Pool - Left side */}
          <div className="w-80 flex-shrink-0">
            <Card className="h-full sticky top-4">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Star className="h-5 w-5 text-amber-500" />
                  A+ / A Contestants
                  <Badge variant="secondary">{filteredPool.length}</Badge>
                </CardTitle>
                {/* Filters */}
                <div className="space-y-2 pt-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search name, email, phone..."
                      value={searchTerm}
                      onChange={e => setSearchTerm(e.target.value)}
                      className="pl-9"
                      data-testid="input-planning-search"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="flex-1 justify-between" data-testid="select-rating-filter">
                          {ratingFilters.length === 0 ? 'All Ratings' : ratingFilters.join(', ')}
                          <ChevronDown className="h-4 w-4 ml-2 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-48 p-2" align="start">
                        <div className="space-y-2">
                          {['A+', 'A', 'B', 'C'].map(rating => (
                            <label key={rating} className="flex items-center gap-2 cursor-pointer hover:bg-muted p-1 rounded">
                              <input
                                type="checkbox"
                                checked={ratingFilters.includes(rating)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setRatingFilters([...ratingFilters, rating]);
                                  } else {
                                    setRatingFilters(ratingFilters.filter(r => r !== rating));
                                  }
                                }}
                                className="h-4 w-4 rounded border-gray-300"
                              />
                              <span className="text-sm">{rating}</span>
                            </label>
                          ))}
                          {ratingFilters.length > 0 && (
                            <Button 
                              variant="ghost" 
                              size="sm" 
                              className="w-full mt-2"
                              onClick={() => setRatingFilters([])}
                            >
                              Clear All
                            </Button>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Select value={genderFilter} onValueChange={setGenderFilter}>
                      <SelectTrigger className="flex-1" data-testid="select-gender-filter">
                        <SelectValue placeholder="Gender" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Genders</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex gap-2">
                    <Select value={ageFilter} onValueChange={setAgeFilter}>
                      <SelectTrigger className="flex-1" data-testid="select-age-filter">
                        <SelectValue placeholder="Age Range" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Ages</SelectItem>
                        <SelectItem value="18-29">18-29</SelectItem>
                        <SelectItem value="30-39">30-39</SelectItem>
                        <SelectItem value="40-49">40-49</SelectItem>
                        <SelectItem value="50-59">50-59</SelectItem>
                        <SelectItem value="60-69">60-69</SelectItem>
                        <SelectItem value="70+">70+</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="flex-1" data-testid="select-status-filter">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="available">Available</SelectItem>
                        <SelectItem value="assigned">Assigned</SelectItem>
                        <SelectItem value="standby">Standby</SelectItem>
                        <SelectItem value="rescheduled">Rescheduled</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="appeared">Appeared</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="max-h-[600px] overflow-y-auto">
                <div className="space-y-2">
                  {filteredPool.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {eligibleContestants.length === 0 ? 'No A+ or A rated contestants found' : 'All matching contestants have been planned'}
                    </p>
                  ) : (
                    filteredPool.map(c => {
                      const planned = convertToPlannedContestant(c);
                      return (
                        <div
                          key={c.id}
                          draggable
                          onDragStart={() => handleDragStart(planned, { type: 'pool' })}
                          onDragEnd={handleDragEnd}
                          onClick={() => openBookingDialog(c, selectedDayId)}
                          className="p-2 rounded-lg border bg-card hover:bg-accent/50 cursor-grab active:cursor-grabbing transition-colors"
                          data-testid={`draggable-contestant-${c.id}`}
                        >
                          <div className="flex gap-2 items-center">
                            <Avatar className="h-10 w-10 rounded-lg border flex-shrink-0">
                              <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                              <AvatarFallback className="text-xs rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                                {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="font-medium text-sm truncate">{c.name}</span>
                                {draftCompleteContestantIds.has(c.id) && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-5 w-5 p-0 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                                    onClick={(e) => { e.stopPropagation(); setViewingCastingCardContestantId(c.id); }}
                                    title="View Casting Card"
                                    data-testid={`button-view-casting-card-${c.id}`}
                                  >
                                    <Eye className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                                <Badge variant="outline" className={`text-[10px] px-1 py-0 ${c.auditionRating === 'A+' ? 'bg-amber-500/10 text-amber-700 border-amber-300' : 'bg-blue-500/10 text-blue-700 border-blue-300'}`}>
                                  {c.auditionRating}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                <span>{c.gender === 'Female' ? 'F' : 'M'}</span>
                                {c.age && <><span>•</span><span>{c.age}y</span></>}
                                {c.suburb && <><span>•</span><span className="truncate max-w-[80px]">{c.suburb}</span></>}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Days/Blocks - Right side */}
          <div className="flex-1 overflow-x-auto">
            {viewMode === 'single' ? (
              /* Single Day View - Vertical Blocks */
              <div className="space-y-3">
                {['1', '2', '3', '4', '5', '6', '7'].map(blockNum => {
                  const blockContestants = currentDayBlocks[blockNum] || [];
                  const blockType = getBlockType(parseInt(blockNum));
                  const isPB = blockType === 'PB';
                  const isNPB = blockType === 'NPB';
                  
                  // Hide NPB blocks if toggle is on
                  if (hideNPBs && isNPB) return null;
                  
                  return (
                    <Card 
                      key={blockNum}
                      className={`transition-colors ${draggedContestant && !isNPB ? 'border-dashed border-2 border-primary/50' : ''} ${isPB ? 'border-blue-500/50' : isNPB ? 'border-amber-500/50' : ''}`}
                      onDragOver={e => !isNPB && e.preventDefault()}
                      onDrop={() => handleDrop(blockNum)}
                      data-testid={`block-drop-zone-${blockNum}`}
                    >
                      <div className={isNPB ? "p-2" : "p-3"}>
                        <div className="flex items-center gap-2">
                          <Badge className={`px-3 py-1 ${isPB ? 'bg-blue-500' : isNPB ? 'bg-amber-500' : 'bg-muted text-muted-foreground'}`}>
                            Block {blockNum}
                          </Badge>
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant={isPB ? "default" : "outline"}
                              className="h-6 px-2 text-xs"
                              onClick={() => handleBlockTypeChange(parseInt(blockNum), 'PB')}
                              disabled={updateBlockTypeMutation.isPending}
                              data-testid={`button-set-pb-${blockNum}`}
                            >
                              PB
                            </Button>
                            <Button
                              size="sm"
                              variant={isNPB ? "default" : "outline"}
                              className="h-6 px-2 text-xs"
                              onClick={() => handleBlockTypeChange(parseInt(blockNum), 'NPB')}
                              disabled={updateBlockTypeMutation.isPending}
                              data-testid={`button-set-npb-${blockNum}`}
                            >
                              NPB
                            </Button>
                          </div>
                          {isNPB ? (
                            <span className="text-xs text-amber-600 dark:text-amber-400 ml-auto">No players (NPB)</span>
                          ) : (
                            <span className="text-xs text-muted-foreground ml-auto">{blockContestants.length} planned</span>
                          )}
                        </div>
                        {/* Only show drop zone for PB blocks or unassigned blocks */}
                        {!isNPB && (
                          <div className="flex flex-col gap-2 min-h-[50px] p-2 mt-2 rounded-lg border-2 border-dashed border-muted bg-muted/20">
                            <div className="flex gap-3 flex-wrap">
                              {blockContestants.length === 0 ? (
                                <span className="text-xs text-muted-foreground self-center">Drop players here or type a name below</span>
                              ) : (
                                blockContestants.map(c => {
                                const noteKey = `${selectedDayId}-${blockNum}-${c.id}`;
                                const isEditingThisNote = editingNoteKey === noteKey;
                                return (
                                  <div
                                    key={c.id}
                                    className={`flex flex-col gap-1 px-3 py-2 rounded-lg group ${c.isCustom ? 'bg-purple-500/10 border border-purple-500/30' : `${isPB ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-green-500/10 border border-green-500/30'}`}`}
                                    data-testid={`planned-contestant-${blockNum}-${c.id}`}
                                  >
                                    <div 
                                      className={`flex items-center gap-3 ${c.isCustom ? 'cursor-default' : 'cursor-grab'}`}
                                      draggable={!c.isCustom}
                                      onDragStart={() => !c.isCustom && handleDragStart(c, { type: 'block', block: blockNum, dayId: selectedDayId })}
                                      onDragEnd={handleDragEnd}
                                      onClick={() => { if (!c.isCustom) { const full = findContestant(c.id); if (full) openBookingDialog(full, selectedDayId); } }}
                                    >
                                      <Avatar className="h-12 w-12 rounded-lg flex-shrink-0">
                                        <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                                        <AvatarFallback className={`text-sm rounded-lg text-white ${c.isCustom ? 'bg-gradient-to-br from-purple-400 to-pink-500' : 'bg-gradient-to-br from-blue-400 to-purple-500'}`}>
                                          {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                      </Avatar>
                                      <div className="text-sm min-w-0 flex-1">
                                        <span className="font-medium block truncate">{c.name}</span>
                                        {c.isCustom ? (
                                          <span className="text-xs text-purple-600 dark:text-purple-400">Custom entry</span>
                                        ) : (
                                          <span className="text-xs text-muted-foreground">
                                            {c.gender === 'Female' ? 'F' : 'M'}{c.age ? ` • ${c.age}y` : ''}
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        {!c.isCustom && draftCompleteContestantIds.has(c.id) && (
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-6 w-6 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                                            onClick={(e) => { e.stopPropagation(); setViewingCastingCardContestantId(c.id); }}
                                            title="View Casting Card"
                                            data-testid={`button-view-casting-card-block-${c.id}`}
                                          >
                                            <Eye className="h-4 w-4" />
                                          </Button>
                                        )}
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className={`h-6 w-6 ${c.note ? 'opacity-100 text-amber-600' : 'opacity-0 group-hover:opacity-100'}`}
                                          onClick={(e) => { e.stopPropagation(); startEditingNote(selectedDayId, blockNum, c.id, c.note); }}
                                          data-testid={`note-contestant-${blockNum}-${c.id}`}
                                          title={c.note || 'Add note'}
                                        >
                                          <MessageSquare className="h-4 w-4" />
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 opacity-0 group-hover:opacity-100"
                                          onClick={(e) => { e.stopPropagation(); removeFromBlock(blockNum, c.id); }}
                                          data-testid={`remove-contestant-${blockNum}-${c.id}`}
                                        >
                                          <X className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </div>
                                    {/* Note display/edit area */}
                                    {isEditingThisNote ? (
                                      <div className="flex gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                                        <Input
                                          autoFocus
                                          placeholder="Add a note..."
                                          className="h-7 text-xs flex-1"
                                          value={noteInputValue}
                                          onChange={(e) => setNoteInputValue(e.target.value)}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') { saveNote(blockNum, c.id); }
                                            if (e.key === 'Escape') { setEditingNoteKey(null); setNoteInputValue(''); }
                                          }}
                                          data-testid={`input-note-${blockNum}-${c.id}`}
                                        />
                                        <Button size="icon" className="h-7 w-7" onClick={() => saveNote(blockNum, c.id)}>
                                          <Check className="h-3 w-3" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingNoteKey(null); setNoteInputValue(''); }}>
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ) : c.note ? (
                                      <div 
                                        className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 px-2 py-1 rounded cursor-pointer"
                                        onClick={(e) => { e.stopPropagation(); startEditingNote(selectedDayId, blockNum, c.id, c.note); }}
                                        data-testid={`note-display-${blockNum}-${c.id}`}
                                      >
                                        📝 {c.note}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })
                              )}
                            </div>
                            {/* Custom name input */}
                            <div className="flex gap-2 mt-1">
                              <Input
                                placeholder="Add custom name..."
                                className="h-8 text-sm flex-1"
                                value={customNameInputs[`${selectedDayId}-${blockNum}`] || ''}
                                onChange={(e) => setCustomNameInputs(prev => ({ ...prev, [`${selectedDayId}-${blockNum}`]: e.target.value }))}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const value = customNameInputs[`${selectedDayId}-${blockNum}`];
                                    if (value?.trim()) {
                                      addCustomToBlock(blockNum, value);
                                      setCustomNameInputs(prev => ({ ...prev, [`${selectedDayId}-${blockNum}`]: '' }));
                                    }
                                  }
                                }}
                                data-testid={`input-custom-name-${blockNum}`}
                              />
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={() => {
                                  const value = customNameInputs[`${selectedDayId}-${blockNum}`];
                                  if (value?.trim()) {
                                    addCustomToBlock(blockNum, value);
                                    setCustomNameInputs(prev => ({ ...prev, [`${selectedDayId}-${blockNum}`]: '' }));
                                  }
                                }}
                                data-testid={`button-add-custom-${blockNum}`}
                              >
                                <Plus className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            ) : (
              /* Weekly View - Multiple Days Side by Side */
              <div className="flex gap-4">
                {weekDays.map(day => {
                  const dayBlocks = getBlocksForDay(day.id);
                  return (
                    <div key={day.id} className="min-w-[280px] flex-shrink-0">
                      <Card className="mb-3">
                        <CardHeader className="py-2 px-3">
                          <CardTitle className="text-sm flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            {day.rxNumber} - {format(new Date(day.date), 'EEE dd/MM')}
                          </CardTitle>
                        </CardHeader>
                      </Card>
                      <div className="space-y-2">
                        {['1', '2', '3', '4', '5', '6', '7'].map(blockNum => {
                          const blockContestants = dayBlocks[blockNum] || [];
                          const dayBlockType = weekBlockTypesMap[day.id]?.[blockNum];
                          const isNPB = dayBlockType === 'NPB';
                          const isPB = dayBlockType === 'PB';
                          
                          // Hide NPB blocks when toggle is active
                          if (hideNPBs && isNPB) return null;
                          
                          return (
                            <Card 
                              key={blockNum}
                              className={`transition-colors ${draggedContestant && !isNPB ? 'border-dashed border-primary/50' : ''} ${isPB ? 'border-blue-500/50' : isNPB ? 'border-amber-500/50' : ''}`}
                              onDragOver={e => !isNPB && e.preventDefault()}
                              onDrop={() => !isNPB && handleDrop(blockNum, day.id, dayBlockType)}
                              data-testid={`weekly-block-${day.id}-${blockNum}`}
                            >
                              <div className={isNPB ? "p-1" : "p-2"}>
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="outline" className={`text-xs ${isPB ? 'bg-blue-500/10 border-blue-300' : isNPB ? 'bg-amber-500/10 border-amber-300' : ''}`}>B{blockNum}</Badge>
                                  {isNPB ? (
                                    <span className="text-xs text-amber-600 dark:text-amber-400">NPB</span>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">{blockContestants.length} planned</span>
                                  )}
                                </div>
                                {!isNPB && (
                                  <div className="space-y-2 min-h-[48px]">
                                    {blockContestants.length === 0 ? (
                                      <div className="text-xs text-muted-foreground text-center py-2 border border-dashed rounded">
                                        Drop here
                                      </div>
                                    ) : (
                                      blockContestants.map(c => {
                                        const noteKey = `${day.id}-${blockNum}-${c.id}`;
                                        const isEditingThisNote = editingNoteKey === noteKey;
                                        return (
                                          <div
                                            key={c.id}
                                            className="flex flex-col gap-1 p-2 rounded-lg bg-muted/50 border group"
                                            data-testid={`weekly-contestant-${day.id}-${blockNum}-${c.id}`}
                                          >
                                            <div
                                              className={`flex items-center gap-2 ${c.isCustom ? 'cursor-default' : 'cursor-grab'}`}
                                              draggable={!c.isCustom}
                                              onDragStart={() => !c.isCustom && handleDragStart(c, { type: 'block', block: blockNum, dayId: day.id })}
                                              onDragEnd={handleDragEnd}
                                              onClick={() => { if (!c.isCustom) { const full = findContestant(c.id); if (full) openBookingDialog(full, day.id); } }}
                                            >
                                              <Avatar className="h-10 w-10 rounded-lg flex-shrink-0">
                                                <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                                                <AvatarFallback className={`text-xs rounded-lg text-white ${c.isCustom ? 'bg-gradient-to-br from-purple-400 to-pink-500' : 'bg-gradient-to-br from-amber-400 to-orange-500'}`}>
                                                  {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                                </AvatarFallback>
                                              </Avatar>
                                              <div className="min-w-0 flex-1">
                                                <span className="text-sm font-medium truncate block">{c.name}</span>
                                                {c.isCustom ? (
                                                  <span className="text-xs text-purple-600 dark:text-purple-400">Custom</span>
                                                ) : (
                                                  <span className="text-xs text-muted-foreground">
                                                    {c.gender === 'Female' ? 'F' : 'M'}{c.age ? ` • ${c.age}y` : ''}
                                                  </span>
                                                )}
                                              </div>
                                              <div className="flex items-center gap-0.5 flex-shrink-0">
                                                {!c.isCustom && draftCompleteContestantIds.has(c.id) && (
                                                  <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className="h-5 w-5 text-blue-600 hover:text-blue-800 hover:bg-blue-100"
                                                    onClick={(e) => { e.stopPropagation(); setViewingCastingCardContestantId(c.id); }}
                                                    title="View Casting Card"
                                                  >
                                                    <Eye className="h-3 w-3" />
                                                  </Button>
                                                )}
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className={`h-5 w-5 ${c.note ? 'opacity-100 text-amber-600' : 'opacity-0 group-hover:opacity-100'}`}
                                                  onClick={(e) => { e.stopPropagation(); startEditingNote(day.id, blockNum, c.id, c.note); }}
                                                >
                                                  <MessageSquare className="h-3 w-3" />
                                                </Button>
                                                <Button
                                                  variant="ghost"
                                                  size="icon"
                                                  className="h-5 w-5 opacity-0 group-hover:opacity-100"
                                                  onClick={(e) => { e.stopPropagation(); removeFromBlock(blockNum, c.id, day.id); }}
                                                >
                                                  <X className="h-3 w-3" />
                                                </Button>
                                              </div>
                                            </div>
                                            {/* Note display/edit area */}
                                            {isEditingThisNote ? (
                                              <div className="flex gap-1 mt-1" onClick={(e) => e.stopPropagation()}>
                                                <Input
                                                  autoFocus
                                                  placeholder="Add a note..."
                                                  className="h-6 text-xs flex-1"
                                                  value={noteInputValue}
                                                  onChange={(e) => setNoteInputValue(e.target.value)}
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter') { saveNote(blockNum, c.id, day.id); }
                                                    if (e.key === 'Escape') { setEditingNoteKey(null); setNoteInputValue(''); }
                                                  }}
                                                />
                                                <Button size="icon" className="h-6 w-6" onClick={() => saveNote(blockNum, c.id, day.id)}>
                                                  <Check className="h-3 w-3" />
                                                </Button>
                                              </div>
                                            ) : c.note ? (
                                              <div 
                                                className="text-xs text-amber-700 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded cursor-pointer truncate"
                                                onClick={(e) => { e.stopPropagation(); startEditingNote(day.id, blockNum, c.id, c.note); }}
                                                title={c.note}
                                              >
                                                📝 {c.note}
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                )}
                              </div>
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Info notice */}
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="py-3">
          <p className="text-sm text-blue-700 dark:text-blue-400 flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            <strong>PB/NPB settings sync to seating chart.</strong> Contestant placements are visual planning only and do not affect bookings or statuses.
          </p>
        </CardContent>
      </Card>

      {/* Photo lightbox */}
      <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] p-4" data-testid="dialog-photo-lightbox">
          {viewingPhoto && (
            <div className="flex flex-col items-center">
              <img
                src={viewingPhoto.url}
                alt={viewingPhoto.name}
                className="max-h-[80vh] max-w-full object-contain rounded-lg"
                data-testid="img-lightbox-photo"
              />
              <p className="mt-4 text-lg font-medium" data-testid="text-lightbox-name">{viewingPhoto.name}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Contestant Detail Dialog */}
      <Dialog open={!!viewingContestant} onOpenChange={(open) => !open && setViewingContestant(null)}>
        <DialogContent className="max-w-2xl" data-testid="dialog-contestant-detail">
          <DialogHeader>
            <DialogTitle>Contestant Details</DialogTitle>
          </DialogHeader>
          {viewingContestant && (
            <div className="flex gap-6">
              {/* Photo */}
              <div className="flex-shrink-0">
                <Avatar 
                  className="h-32 w-32 rounded-xl border-2 cursor-pointer"
                  onClick={() => viewingContestant.photoUrl && setViewingPhoto({ url: viewingContestant.photoUrl, name: viewingContestant.name })}
                >
                  <AvatarImage src={viewingContestant.photoUrl || undefined} className="object-cover" />
                  <AvatarFallback className="text-3xl rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                    {viewingContestant.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
              </div>
              {/* Info */}
              <div className="flex-1 space-y-4">
                <div>
                  <h3 className="text-xl font-semibold">{viewingContestant.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={viewingContestant.auditionRating === 'A+' ? 'bg-amber-500/10 text-amber-700 border-amber-300' : viewingContestant.auditionRating === 'A' ? 'bg-blue-500/10 text-blue-700 border-blue-300' : ''}>
                      {viewingContestant.auditionRating || 'Unrated'}
                    </Badge>
                    <Badge variant="outline" className={viewingContestant.gender === 'Female' ? 'bg-pink-500/10 text-pink-700 border-pink-300' : 'bg-blue-500/10 text-blue-700 border-blue-300'}>
                      {viewingContestant.gender || 'Unknown'}
                    </Badge>
                    {viewingContestant.age && (
                      <Badge variant="outline">{viewingContestant.age} years old</Badge>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {viewingContestant.email && (
                    <div>
                      <span className="text-muted-foreground">Email:</span>
                      <p className="font-medium">{viewingContestant.email}</p>
                    </div>
                  )}
                  {viewingContestant.phone && (
                    <div>
                      <span className="text-muted-foreground">Phone:</span>
                      <p className="font-medium">{viewingContestant.phone}</p>
                    </div>
                  )}
                  {viewingContestant.suburb && (
                    <div>
                      <span className="text-muted-foreground">Location:</span>
                      <p className="font-medium">{viewingContestant.suburb}</p>
                    </div>
                  )}
                  {viewingContestant.attendingWith && (
                    <div>
                      <span className="text-muted-foreground">Attending With:</span>
                      <p className="font-medium">{viewingContestant.attendingWith}</p>
                    </div>
                  )}
                </div>
                {hasMeaningfulValue(viewingContestant.medicalMobilityNotes) && (
                  <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                    <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">Medical/Mobility Notes:</span>
                    <p className="text-sm">{viewingContestant.medicalMobilityNotes}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Booking Dialog */}
      <Dialog open={!!bookingContestant} onOpenChange={(open) => !open && setBookingContestant(null)}>
        <DialogContent className="max-w-lg" data-testid="dialog-booking">
          <DialogHeader>
            <DialogTitle>Book for RX Day</DialogTitle>
          </DialogHeader>
          {bookingContestant && (
            <div className="space-y-4">
              {/* Contestant Info */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                <Avatar className="h-12 w-12 rounded-lg">
                  <AvatarImage src={bookingContestant.photoUrl || undefined} className="object-cover" />
                  <AvatarFallback className="rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                    {bookingContestant.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold">{bookingContestant.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {bookingContestant.gender === 'Female' ? 'F' : 'M'} • {bookingContestant.age}y • {bookingContestant.auditionRating}
                  </p>
                </div>
              </div>

              {/* Group Members */}
              {getGroupMembers(bookingContestant).length > 0 && (
                <div className="p-3 rounded-lg border border-purple-500/30 bg-purple-500/5">
                  <p className="text-sm font-medium text-purple-700 dark:text-purple-400 mb-2">
                    Group Members (will be booked together):
                  </p>
                  <div className="space-y-1">
                    {getGroupMembers(bookingContestant).map(m => (
                      <div key={m.id} className="flex items-center gap-2 text-sm">
                        <Avatar className="h-6 w-6 rounded">
                          <AvatarImage src={m.photoUrl || undefined} />
                          <AvatarFallback className="text-[10px]">{m.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}</AvatarFallback>
                        </Avatar>
                        <span>{m.name}</span>
                        <span className="text-muted-foreground">({m.gender === 'Female' ? 'F' : 'M'} • {m.age}y)</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Day Selection */}
              <div>
                <label className="text-sm font-medium mb-1 block">Record Day</label>
                <Select value={bookingDayId} onValueChange={setBookingDayId}>
                  <SelectTrigger data-testid="select-booking-day">
                    <SelectValue placeholder="Select day..." />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedRecordDays.map(day => (
                      <SelectItem key={day.id} value={day.id}>
                        {day.rxNumber} - {format(new Date(day.date), 'EEE dd/MM/yyyy')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Block Selection */}
              {bookingDayId && (
                <div>
                  <label className="text-sm font-medium mb-1 block">Block (PB only)</label>
                  <Select value={selectedBlock} onValueChange={(v) => { setSelectedBlock(v); setSelectedSeat(''); }}>
                    <SelectTrigger data-testid="select-booking-block">
                      <SelectValue placeholder="Select block..." />
                    </SelectTrigger>
                    <SelectContent>
                      {getBookingDayPBBlocks().length === 0 ? (
                        <SelectItem value="_none" disabled>No PB blocks configured</SelectItem>
                      ) : (
                        getBookingDayPBBlocks().map(block => (
                          <SelectItem key={block} value={block}>
                            Block {block}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Seat Selection */}
              {selectedBlock && (
                <div>
                  <label className="text-sm font-medium mb-1 block">
                    Starting Seat {getGroupMembers(bookingContestant).length > 0 && `(${getGroupMembers(bookingContestant).length + 1} consecutive seats needed)`}
                  </label>
                  <Select value={selectedSeat} onValueChange={setSelectedSeat}>
                    <SelectTrigger data-testid="select-booking-seat">
                      <SelectValue placeholder="Select seat..." />
                    </SelectTrigger>
                    <SelectContent>
                      {getAvailableSeats(selectedBlock).length === 0 ? (
                        <SelectItem value="_none" disabled>No seats available</SelectItem>
                      ) : (
                        getAvailableSeats(selectedBlock).map(seat => (
                          <SelectItem key={seat} value={seat}>
                            Seat {seat}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="outline" onClick={() => setBookingContestant(null)}>
                  Cancel
                </Button>
                <Button 
                  onClick={handleBooking}
                  disabled={!bookingDayId || !selectedBlock || !selectedSeat || bookContestantMutation.isPending || bookGroupMutation.isPending}
                  data-testid="button-confirm-booking"
                >
                  {bookContestantMutation.isPending || bookGroupMutation.isPending ? 'Booking...' : 'Book Now'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Casting Card Preview Dialog */}
      <Dialog open={!!viewingCastingCardContestantId} onOpenChange={(open) => !open && setViewingCastingCardContestantId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto" data-testid="dialog-casting-card-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-600" />
              Casting Card Preview
            </DialogTitle>
          </DialogHeader>
          {viewingCastingCardContestantId && (
            <CastingCardPreview contestantId={viewingCastingCardContestantId} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Casting Card Preview component for RX Planning - displays visual card via iframe
function CastingCardPreview({ contestantId }: { contestantId: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}
      {hasError ? (
        <div className="text-center py-8 text-muted-foreground">
          No casting card found for this contestant.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden bg-white" style={{ height: '420px', width: '100%' }}>
          <iframe
            src={`/api/casting-cards/${contestantId}/print?preview=true`}
            className="border-0"
            style={{ 
              transform: 'scale(0.55)', 
              transformOrigin: 'top left', 
              width: '182%', 
              height: '182%',
              pointerEvents: 'none'
            }}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setHasError(true);
            }}
            title="Casting Card Preview"
          />
        </div>
      )}
    </div>
  );
}

export default function PlayersPage() {
  const { toast } = useToast();
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>('');
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('players');
  const [editContestantId, setEditContestantId] = useState<string | null>(null);
  const [block7Ep1Confirmation, setBlock7Ep1Confirmation] = useState<{ assignmentId: string; contestantName: string } | null>(null);

  const { data: recordDays = [], isLoading: loadingDays } = useQuery<RecordDay[]>({
    queryKey: ['/api/record-days'],
  });

  const { data: contestants = [] } = useQuery<Contestant[]>({
    queryKey: ['/api/contestants'],
  });

  // Fetch all casting cards to show status in Players & Backups tab
  const { data: allCastingCards = [] } = useQuery<CastingCardData[]>({
    queryKey: ['/api/casting-cards'],
  });

  // Map of contestantId -> casting card for quick lookup
  const castingCardsMap = useMemo(() => {
    return new Map(allCastingCards.map(card => [card.contestantId, card]));
  }, [allCastingCards]);

  const { data: rawAssignments = [], isLoading: loadingAssignments } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments', selectedRecordDayId || undefined],
    queryFn: async () => {
      const url = selectedRecordDayId 
        ? `/api/seat-assignments?recordDayId=${selectedRecordDayId}`
        : '/api/seat-assignments';
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to fetch assignments');
      return response.json();
    },
    enabled: true,
  });

  const contestantsMap = useMemo(() => {
    return new Map(contestants.map(c => [c.id, c]));
  }, [contestants]);

  const allAssignments = useMemo(() => {
    return rawAssignments.map(a => {
      const contestant = contestantsMap.get(a.contestantId);
      return {
        ...a,
        contestant: contestant ? {
          id: contestant.id,
          firstName: contestant.firstName || contestant.name?.split(' ')[0] || '',
          lastName: contestant.lastName || contestant.name?.split(' ').slice(1).join(' ') || '',
          gender: contestant.gender,
          age: contestant.age,
          phone: contestant.phone,
          email: contestant.email,
          rating: contestant.auditionRating,
          suburb: contestant.suburb,
          medicalMobilityNotes: contestant.medicalMobilityNotes,
          attendingWith: contestant.attendingWith,
          photoUrl: contestant.photoUrl,
          availabilityStatus: (contestant as any).availabilityStatus || null,
        } : null,
      };
    });
  }, [rawAssignments, contestantsMap]);

  const sortedRecordDays = useMemo(() => {
    return [...recordDays].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [recordDays]);

  useEffect(() => {
    if (!selectedRecordDayId && sortedRecordDays.length > 0) {
      setSelectedRecordDayId(sortedRecordDays[0].id);
    }
  }, [sortedRecordDays, selectedRecordDayId]);

  const { players, backups } = useMemo(() => {
    const filtered = selectedRecordDayId 
      ? allAssignments.filter(a => a.recordDayId === selectedRecordDayId)
      : [];
    
    const withContestants = filtered.filter(a => a.contestant);
    
    return {
      players: withContestants.filter(a => a.playerType === 'player').sort((a, b) => {
        const epA = parseInt(a.rxEpNumber) || 99;
        const epB = parseInt(b.rxEpNumber) || 99;
        if (epA !== epB) return epA - epB;
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      }),
      backups: withContestants.filter(a => a.playerType === 'backup').sort((a, b) => {
        if (a.blockNumber !== b.blockNumber) return a.blockNumber - b.blockNumber;
        return (a.seatLabel || '').localeCompare(b.seatLabel || '');
      }),
    };
  }, [allAssignments, selectedRecordDayId]);

  const episodeGroups = useMemo(() => {
    const groups: EpisodeGroup[] = [];
    
    for (let ep = 1; ep <= 5; ep++) {
      const epStr = ep.toString();
      const epPlayers = players.filter(p => p.rxEpNumber === epStr);
      
      const blockNumbers = new Set(epPlayers.map(p => p.blockNumber));
      const epBackups = backups.filter(b => blockNumbers.has(b.blockNumber));
      
      groups.push({
        episodeNumber: epStr,
        players: epPlayers,
        backups: epBackups,
      });
    }
    
    const unassignedPlayers = players.filter(p => !p.rxEpNumber || !['1','2','3','4','5'].includes(p.rxEpNumber));
    const assignedBackupIds = new Set(groups.flatMap(g => g.backups.map(b => b.id)));
    const unassignedBackups = backups.filter(b => !assignedBackupIds.has(b.id));
    const assignedCount = groups.filter(g => g.players.length > 0).length;
    
    return { groups, unassignedPlayers, unassignedBackups, assignedCount };
  }, [players, backups]);

  const updateEpisodeMutation = useMutation({
    mutationFn: async ({ assignmentId, episodeNumber }: { assignmentId: string; episodeNumber: string | null }) => {
      const response = await apiRequest('PATCH', `/api/seat-assignments/${assignmentId}/workflow`, {
        rxEpNumber: episodeNumber,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ 
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Updated", description: "Episode number saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const handleEpisodeChange = (assignmentId: string, value: string) => {
    const episodeNumber = value === 'none' ? null : value;
    
    // Warn about Block 7 being assigned to EP1 (but allow with confirmation)
    if (episodeNumber === '1') {
      const assignment = allAssignments.find(a => a.id === assignmentId);
      if (assignment && assignment.blockNumber === 7) {
        const contestantName = assignment.contestant 
          ? `${assignment.contestant.firstName || ''} ${assignment.contestant.lastName || ''}`.trim() || 'Unknown'
          : 'Unknown';
        setBlock7Ep1Confirmation({ assignmentId, contestantName });
        return;
      }
    }
    
    updateEpisodeMutation.mutate({ assignmentId, episodeNumber });
  };
  
  const confirmBlock7Ep1 = () => {
    if (block7Ep1Confirmation) {
      updateEpisodeMutation.mutate({ 
        assignmentId: block7Ep1Confirmation.assignmentId, 
        episodeNumber: '1' 
      });
      setBlock7Ep1Confirmation(null);
    }
  };

  const uploadCastingCardMutation = useMutation({
    mutationFn: async ({ assignmentId, file }: { assignmentId: string; file: File }) => {
      const formData = new FormData();
      formData.append('castingCard', file);
      const response = await fetch(`/api/seat-assignments/${assignmentId}/casting-card`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to upload casting card');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Success", description: "Casting card uploaded" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to upload", variant: "destructive" });
    },
  });

  const deleteCastingCardMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      const response = await apiRequest('DELETE', `/api/seat-assignments/${assignmentId}/casting-card`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Deleted", description: "Casting card removed" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to delete", variant: "destructive" });
    },
  });

  const handleCastingCardUpload = (assignmentId: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        uploadCastingCardMutation.mutate({ assignmentId, file });
      }
    };
    input.click();
  };

  const handleExportToExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      
      const allContestants = [...players, ...backups];
      
      if (allContestants.length === 0) {
        toast({ title: "No data", description: "No contestants to export", variant: "destructive" });
        return;
      }
      
      const selectedDay = recordDays.find(d => d.id === selectedRecordDayId);
      
      const exportData = allContestants.map(a => ({
        'Name': `${a.contestant?.firstName || ''} ${a.contestant?.lastName || ''}`.trim(),
        'Type': a.playerType === 'player' ? 'Player' : 'Backup',
        'Episode': a.rxEpNumber || '',
        'Block': a.blockNumber || '',
        'Seat': a.seatLabel || '',
        'Gender': a.contestant?.gender || '',
        'Age': a.contestant?.age || '',
        'Phone': a.contestant?.phone ? `, ${a.contestant.phone}` : '',
        'Email': a.contestant?.email || '',
        'Suburb': a.contestant?.suburb || '',
        'Rating': a.contestant?.rating || '',
        'Status': a.confirmedRsvp ? 'Confirmed' : (a.bookingEmailSent ? 'Invited' : 'Pending'),
        'Attending With': a.contestant?.attendingWith || '',
      }));
      
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Contestants');
      
      const dayLabel = selectedDay ? `${selectedDay.rxNumber}_${format(new Date(selectedDay.date), 'yyyy-MM-dd')}` : 'all';
      XLSX.writeFile(workbook, `contestants_${dayLabel}.xlsx`);
      
      toast({ title: "Exported", description: `${allContestants.length} contestants exported to Excel` });
    } catch (error) {
      console.error('Export error:', error);
      toast({ title: "Error", description: "Failed to export data", variant: "destructive" });
    }
  };

  const toggleCallMutation = useMutation({
    mutationFn: async ({ assignmentId, called }: { assignmentId: string; called: boolean }) => {
      const response = await apiRequest('PATCH', `/api/seat-assignments/${assignmentId}/workflow`, {
        called,
        calledAt: called ? new Date().toISOString() : null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey[0];
          return typeof key === 'string' && key.includes('/api/seat-assignments');
        }
      });
      toast({ title: "Updated", description: "Call status saved" });
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" });
    },
  });

  const getStatusBadge = (assignment: SeatAssignment) => {
    const status = assignment.contestant?.availabilityStatus;
    const hasBookingEmail = !!assignment.bookingEmailSent;
    const hasConfirmed = !!assignment.confirmedRsvp;
    
    if (hasConfirmed) {
      return <Badge className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-500/30">Confirmed</Badge>;
    }
    if (hasBookingEmail) {
      return <Badge className="bg-blue-500/20 text-blue-700 dark:text-blue-400 border-blue-500/30">Invited</Badge>;
    }
    if (status === 'assigned') {
      return <Badge className="bg-purple-500/20 text-purple-700 dark:text-purple-400 border-purple-500/30">Assigned</Badge>;
    }
    return <Badge variant="outline" className="text-muted-foreground">Pending</Badge>;
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase();
  };

  const handlePrintCard = (contestantId: string) => {
    // Navigate to casting cards tab with this contestant selected
    // The user can then use the print button there which has the proper html2canvas implementation
    setEditContestantId(contestantId);
    setActiveTab('casting');
  };

  const renderPersonCard = (assignment: SeatAssignment, isPlayer: boolean, showEpisodeSelector: boolean = false) => {
    const c = assignment.contestant;
    if (!c) return null;
    const attendingWith = assignment.attendingWithOverride || c.attendingWith;
    const notes = assignment.medicalMobilityNotesOverride || c.medicalMobilityNotes;
    
    return (
      <div 
        key={assignment.id} 
        className={`p-4 rounded-lg border ${isPlayer ? 'bg-blue-500/5 border-blue-500/20' : 'bg-amber-500/5 border-amber-500/20'}`}
        data-testid={`card-person-${assignment.id}`}
      >
        <div className="flex gap-4">
          <Avatar 
            className={`h-16 w-16 border-2 border-background shadow-sm ${c.photoUrl ? 'cursor-pointer hover:ring-2 hover:ring-primary transition-all' : ''}`}
            onClick={() => c.photoUrl && setViewingPhoto({ url: c.photoUrl, name: `${c.firstName} ${c.lastName}` })}
          >
            <AvatarImage src={c.photoUrl || undefined} alt={`${c.firstName} ${c.lastName}`} />
            <AvatarFallback className={isPlayer ? 'bg-blue-500/20 text-blue-700 dark:text-blue-400' : 'bg-amber-500/20 text-amber-700 dark:text-amber-400'}>
              {getInitials(c.firstName, c.lastName)}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-semibold text-lg">{c.firstName} {c.lastName}</span>
              <Badge variant="outline" className={isPlayer ? 'bg-blue-500/10 text-blue-700 dark:text-blue-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}>
                {isPlayer ? 'PLAYER' : 'BACKUP'}
              </Badge>
              <Badge variant="outline" className={c.gender === 'Female' ? 'bg-pink-500/10 text-pink-700 dark:text-pink-400' : 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}>
                {c.gender === 'Female' ? 'F' : 'M'} {c.age || ''}
              </Badge>
              {getStatusBadge(assignment)}
              {showEpisodeSelector && (
                <Select 
                  value={assignment.rxEpNumber || 'none'} 
                  onValueChange={(v) => handleEpisodeChange(assignment.id, v)}
                  disabled={updateEpisodeMutation.isPending}
                >
                  <SelectTrigger className="w-20 h-7 text-xs" data-testid={`select-episode-${assignment.id}`}>
                    <SelectValue placeholder="EP -" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="1">EP 1</SelectItem>
                    <SelectItem value="2">EP 2</SelectItem>
                    <SelectItem value="3">EP 3</SelectItem>
                    <SelectItem value="4">EP 4</SelectItem>
                    <SelectItem value="5">EP 5</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
            
            <div className="flex items-center gap-2 text-sm mb-1">
              <Badge className="bg-primary/10 text-primary font-bold">
                Block {assignment.blockNumber} - Seat {assignment.seatLabel}
              </Badge>
              <Button
                size="sm"
                variant={assignment.called ? "default" : "outline"}
                className={`h-7 gap-1 text-xs ${assignment.called ? 'bg-green-600 hover:bg-green-700 text-white' : ''}`}
                onClick={() => toggleCallMutation.mutate({ assignmentId: assignment.id, called: !assignment.called })}
                disabled={toggleCallMutation.isPending}
                data-testid={`button-call-${assignment.id}`}
              >
                {assignment.called ? (
                  <>
                    <PhoneCall className="h-3 w-3" />
                    Called
                  </>
                ) : (
                  <>
                    <Phone className="h-3 w-3" />
                    Call
                  </>
                )}
              </Button>
            </div>
            
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground mt-2">
              {c.phone && (
                <div className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  <span>{c.phone}</span>
                </div>
              )}
              {c.email && (
                <div className="flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{c.email}</span>
                </div>
              )}
              {c.suburb && (
                <div className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  <span>{c.suburb}</span>
                </div>
              )}
              {attendingWith && (
                <div className="flex items-center gap-1 truncate">
                  <Users className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate" title={attendingWith}>{attendingWith}</span>
                </div>
              )}
            </div>
            
            {hasMeaningfulValue(notes) && (
              <div className="mt-2 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                {notes}
              </div>
            )}
            
            {/* Casting card actions - available for both Players and Backups */}
            <div className="mt-3 flex items-center gap-2 flex-wrap">
              {/* Show PDF badge if PDF is uploaded, otherwise show system card status */}
              {assignment.castingCardUrl ? (
                  // PDF is uploaded - show PDF badge and controls
                  <>
                    <Badge className="bg-purple-600 text-white">
                      <FileText className="h-3 w-3 mr-1" />
                      PDF Uploaded
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => window.open(assignment.castingCardUrl!, '_blank')}
                      data-testid={`button-view-casting-card-${assignment.id}`}
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View PDF
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => deleteCastingCardMutation.mutate(assignment.id)}
                      disabled={deleteCastingCardMutation.isPending}
                      data-testid={`button-delete-casting-card-${assignment.id}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  // No PDF - show system card status or create card option
                  <>
                    {(() => {
                      const systemCard = c ? castingCardsMap.get(c.id) : null;
                      if (systemCard) {
                        // Determine badge color and text based on status
                        const getBadgeStyle = () => {
                          if (systemCard.isReady) return { className: "bg-green-600 text-white", text: "RX Ready" };
                          if ((systemCard as any).isDraftComplete) return { className: "bg-blue-600 text-white", text: "Draft Complete" };
                          return { className: "bg-amber-500 text-white", text: "In Progress" };
                        };
                        const badgeStyle = getBadgeStyle();
                        return (
                          <>
                            <Badge className={badgeStyle.className}>
                              <CreditCard className="h-3 w-3 mr-1" />
                              {badgeStyle.text}
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => {
                                setEditContestantId(c.id);
                                setActiveTab('casting');
                              }}
                              data-testid={`button-edit-card-${assignment.id}`}
                            >
                              <CreditCard className="h-3.5 w-3.5" />
                              Edit Card
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1 text-xs"
                              onClick={() => handlePrintCard(c.id)}
                              data-testid={`button-print-card-${assignment.id}`}
                            >
                              <Printer className="h-3.5 w-3.5" />
                              Print
                            </Button>
                          </>
                        );
                      } else {
                        return (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs border-dashed"
                            onClick={() => {
                              setEditContestantId(c.id);
                              setActiveTab('casting');
                            }}
                            data-testid={`button-create-card-${assignment.id}`}
                          >
                            <CreditCard className="h-3.5 w-3.5" />
                            Create Card
                          </Button>
                        );
                      }
                    })()}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => handleCastingCardUpload(assignment.id)}
                      disabled={uploadCastingCardMutation.isPending}
                      data-testid={`button-upload-casting-card-${assignment.id}`}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Upload PDF
                    </Button>
                  </>
                )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  if (loadingDays || loadingAssignments) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Players</h1>
            <TabsList>
              <TabsTrigger value="players" data-testid="tab-players">
                <User className="h-4 w-4 mr-2" />
                Players & Backups
              </TabsTrigger>
              <TabsTrigger value="casting" data-testid="tab-casting">
                <CreditCard className="h-4 w-4 mr-2" />
                Casting Cards
              </TabsTrigger>
              <TabsTrigger value="planning" data-testid="tab-planning">
                <Calendar className="h-4 w-4 mr-2" />
                RX Planning
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <TabsContent value="players" className="mt-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
            <p className="text-muted-foreground text-sm">Assign episode order for the day (5 episodes per day)</p>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">RX Day:</span>
              <Select value={selectedRecordDayId} onValueChange={setSelectedRecordDayId}>
                <SelectTrigger className="w-[220px]" data-testid="select-record-day-filter">
                  <SelectValue placeholder="Select record day..." />
                </SelectTrigger>
                <SelectContent>
                  {sortedRecordDays.map(day => (
                    <SelectItem key={day.id} value={day.id}>
                      {day.rxNumber} - {format(new Date(day.date), 'dd/MM/yyyy')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleExportToExcel}
                disabled={players.length === 0 && backups.length === 0}
                data-testid="button-export-contestants"
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 mb-6">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{players.length}</p>
                <p className="text-sm text-muted-foreground">Players</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg">
                <Users className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{backups.length}</p>
                <p className="text-sm text-muted-foreground">Backups</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-500/10 rounded-lg">
                <Play className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{episodeGroups.assignedCount}/5</p>
                <p className="text-sm text-muted-foreground">Episodes Assigned</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick View Table - Episodes with Block & Player */}
      <Card className="mb-6">
        <CardHeader className="py-2 pb-1">
          <CardTitle className="text-sm font-medium text-muted-foreground">Quick View - Episodes</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="grid grid-cols-5 gap-2 text-center text-sm">
            {[1, 2, 3, 4, 5].map(epNum => {
              const epPlayer = players.find(p => p.rxEpNumber === epNum.toString() && p.playerType === 'player');
              return (
                <div key={epNum} className={`border rounded-lg p-2 ${epPlayer ? 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800' : 'bg-muted/30'}`}>
                  <div className="font-bold text-sm mb-1">EP {epNum}</div>
                  {epPlayer ? (
                    <>
                      <Badge variant="outline" className="text-xs mb-1">
                        Block {epPlayer.blockNumber}
                      </Badge>
                      <div className="font-medium text-xs truncate" title={`${epPlayer.contestant?.firstName || ''} ${epPlayer.contestant?.lastName || ''}`.trim()}>
                        {epPlayer.contestant ? `${epPlayer.contestant.firstName || ''} ${epPlayer.contestant.lastName || ''}`.trim() || '-' : '-'}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Seat {epPlayer.seatLabel || '-'}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground italic py-2">Not assigned</div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {episodeGroups.groups.map(group => {
        const hasConflict = group.players.length > 1;
        return (
          <Card key={group.episodeNumber} className={`mb-4 ${hasConflict ? 'border-red-500 border-2' : ''}`}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-3">
                <Badge className={`text-lg px-3 py-1 ${group.players.length > 0 ? (hasConflict ? 'bg-red-500' : 'bg-green-500') : 'bg-muted text-muted-foreground'}`}>
                  EP {group.episodeNumber}
                </Badge>
                {hasConflict ? (
                  <span className="text-base font-semibold text-red-600 dark:text-red-400">
                    Conflict: {group.players.length} players assigned
                  </span>
                ) : group.players.length === 1 ? (
                  <div className="flex items-center gap-2">
                    <Badge className="bg-primary text-primary-foreground text-base font-bold px-3 py-1">
                      BLOCK {group.players[0].blockNumber}
                    </Badge>
                    <span className="text-base font-medium">
                      {group.players[0].contestant?.firstName} {group.players[0].contestant?.lastName}
                    </span>
                  </div>
                ) : (
                  <span className="text-base font-normal text-muted-foreground italic">No player assigned</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {group.players.length > 0 || group.backups.length > 0 ? (
                <div className="space-y-3">
                  {group.players.map(player => renderPersonCard(player, true, true))}
                  {group.backups.length > 0 && (
                    <>
                      {group.players.length > 0 && <div className="border-t pt-3 mt-3" />}
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Backups for this block</p>
                      {group.backups.map(backup => renderPersonCard(backup, false, false))}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">Assign a player to this episode from the unassigned list below</p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {episodeGroups.unassignedPlayers.length > 0 && (
        <Card className="mb-4 border-dashed border-amber-500/50">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-amber-600 dark:text-amber-400">
              <User className="h-5 w-5" />
              Unassigned Players
              <Badge className="bg-amber-500/20 text-amber-700 dark:text-amber-400">{episodeGroups.unassignedPlayers.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">Select an episode for each player using the dropdown</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {episodeGroups.unassignedPlayers.map(player => renderPersonCard(player, true, true))}
            </div>
          </CardContent>
        </Card>
      )}

      {episodeGroups.unassignedBackups.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg text-muted-foreground">
              <Users className="h-5 w-5" />
              Backups Without Episode
              <Badge variant="secondary">{episodeGroups.unassignedBackups.length}</Badge>
            </CardTitle>
            <p className="text-sm text-muted-foreground">These backups' blocks don't match any assigned player</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {episodeGroups.unassignedBackups.map(backup => renderPersonCard(backup, false, false))}
            </div>
          </CardContent>
        </Card>
      )}

          {/* Photo lightbox dialog */}
          <Dialog open={!!viewingPhoto} onOpenChange={(open) => !open && setViewingPhoto(null)}>
            <DialogContent className="max-w-5xl max-h-[95vh] p-4">
              {viewingPhoto && (
                <div className="flex flex-col items-center">
                  <img
                    src={viewingPhoto.url}
                    alt={viewingPhoto.name}
                    className="max-h-[85vh] max-w-full object-contain rounded-lg"
                  />
                  <p className="mt-4 text-xl font-medium">{viewingPhoto.name}</p>
                </div>
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="planning" className="mt-0">
          <RXPlanningTab recordDays={recordDays} contestants={contestants} />
        </TabsContent>

        <TabsContent value="casting" className="mt-0">
          <SafeRender 
            fallback={
              <div className="flex flex-col items-center justify-center h-96 gap-4">
                <div className="text-red-500 text-xl font-semibold">Casting Cards Error</div>
                <p className="text-muted-foreground">An error occurred while loading the casting cards. Please refresh the page.</p>
                <Button onClick={() => window.location.reload()}>Refresh Page</Button>
              </div>
            }
            onError={(e) => console.error('CastingCardsTab crashed:', e)}
          >
            <CastingCardsTab contestants={contestants} initialContestantId={editContestantId} onClearInitial={() => setEditContestantId(null)} />
          </SafeRender>
        </TabsContent>
      </Tabs>

      {/* Block 7 to EP1 Confirmation Dialog */}
      <Dialog open={!!block7Ep1Confirmation} onOpenChange={(open) => !open && setBlock7Ep1Confirmation(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5" />
              Block 7 Player Warning
            </DialogTitle>
            <DialogDescription className="pt-2">
              You are about to assign a <strong>Block 7</strong> contestant to <strong>Episode 1</strong>.
              {block7Ep1Confirmation && (
                <div className="mt-2 p-2 bg-muted rounded text-foreground">
                  <strong>{block7Ep1Confirmation.contestantName}</strong> is from Block 7
                </div>
              )}
              <div className="mt-3 text-sm">
                Block 7 contestants are typically assigned to later episodes. Are you sure you want to proceed?
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button 
              variant="outline" 
              onClick={() => setBlock7Ep1Confirmation(null)}
              data-testid="button-cancel-block7-ep1"
            >
              Cancel
            </Button>
            <Button 
              onClick={confirmBlock7Ep1}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-confirm-block7-ep1"
            >
              Yes, Assign to EP 1
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
