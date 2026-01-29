import { useQuery, useMutation } from "@tanstack/react-query";
import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
import { User, Users, Play, Phone, PhoneCall, PhoneOff, Mail, MapPin, Upload, FileText, X, GripVertical, Calendar, Search, Filter, Star, Trash2, CheckCircle2, Clock, Send, Plus, Download, CreditCard, Circle, ArrowDown, Maximize2, Minimize2, Bold, Italic, Underline, Printer, ZoomIn, ZoomOut } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
  medicalMobilityNotes: string | null;
  attendingWith: string | null;
  photoUrl: string | null;
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
  companionName?: string | null;
  companionRelationship?: string | null;
  companionPhotoUrl?: string | null;
  producerName?: string | null;
  showProducer?: boolean;
  // Manual companions (up to 4)
  manualCompanions?: ManualCompanion[] | null;
  useManualCompanions?: boolean;
  // Card ready status
  isReady?: boolean;
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

// Casting Cards Tab Component
function CastingCardsTab({ contestants, initialContestantId, onClearInitial }: { contestants: Contestant[]; initialContestantId?: string | null; onClearInitial?: () => void }) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [genderFilter, setGenderFilter] = useState<string>('all');
  const [selectedContestant, setSelectedContestant] = useState<Contestant | null>(null);
  const [cardData, setCardData] = useState<CastingCardData | null>(null);
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cardZoom, setCardZoom] = useState(0.7);
  const [uploadingPhotoFor, setUploadingPhotoFor] = useState<string | null>(null);

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

  // Handle photo file selection
  const handlePhotoUpload = (contestantId: string, file: File | null) => {
    if (!file) return;
    setUploadingPhotoFor(contestantId);
    photoUploadMutation.mutate({ contestantId, file });
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
    updateField('manualCompanions', [...companions, newCompanion]);
    updateField('useManualCompanions', true);
  };

  // Remove a manual companion
  const removeManualCompanion = (companionId: string) => {
    if (!cardData) return;
    const companions = cardData.manualCompanions || [];
    const updatedCompanions = companions.filter(c => c.id !== companionId);
    updateField('manualCompanions', updatedCompanions);
    if (updatedCompanions.length === 0) {
      updateField('useManualCompanions', false);
    }
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

  // Find all supporters (group members) for the selected contestant
  const supporters = useMemo(() => {
    if (!selectedContestant) return [];
    const contestantGroupId = (selectedContestant as any).groupId;
    if (!contestantGroupId) return [];
    return contestants.filter(c => (c as any).groupId === contestantGroupId && c.id !== selectedContestant.id);
  }, [selectedContestant, contestants]);

  // Fetch existing casting card data when contestant is selected
  const { data: existingCard, isLoading: loadingCard } = useQuery<CastingCardData>({
    queryKey: ['/api/casting-cards', selectedContestant?.id],
    enabled: !!selectedContestant,
  });

  // Initialize card data when contestant is selected or existing card loads
  useEffect(() => {
    if (selectedContestant) {
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
        setCardData(parsedCard);
      } else if (!loadingCard) {
        // Find group members to auto-populate as companions (up to 4)
        const contestantGroupId = (selectedContestant as any).groupId;
        let autoCompanions: ManualCompanion[] = [];
        
        if (contestantGroupId) {
          const groupMembers = contestants.filter(
            c => (c as any).groupId === contestantGroupId && c.id !== selectedContestant.id
          ).slice(0, 4);
          
          autoCompanions = groupMembers.map(member => ({
            id: `companion-${member.id}`,
            name: [member.firstName, member.lastName].filter(Boolean).join(' ') || member.name || 'Partner',
            relationship: member.attendingWith || 'Partner',
            photoUrl: member.photoPath ? `/photos/${member.photoPath.split('/').pop()}` : null
          }));
        }
        
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
          manualCompanions: autoCompanions.length > 0 ? autoCompanions : [],
          useManualCompanions: autoCompanions.length > 0,
        });
      }
    }
  }, [selectedContestant, existingCard, loadingCard, contestants]);

  // Save casting card mutation - uses PATCH for updates, POST for new cards
  const saveMutation = useMutation({
    mutationFn: async (data: CastingCardData) => {
      // Serialize manualCompanions to JSON string for database storage
      const dataToSend = {
        ...data,
        manualCompanions: data.manualCompanions ? JSON.stringify(data.manualCompanions) : null,
      };
      
      if (existingCard?.id) {
        // Update existing card - use contestantId, not card id
        const response = await apiRequest('PATCH', `/api/casting-cards/${data.contestantId}`, dataToSend);
        return response.json();
      } else {
        // Create new card
        const response = await apiRequest('POST', '/api/casting-cards', dataToSend);
        return response.json();
      }
    },
    onSuccess: () => {
      // Invalidate both the list and the specific contestant's card
      queryClient.invalidateQueries({ queryKey: ['/api/casting-cards'] });
      if (selectedContestant) {
        queryClient.invalidateQueries({ queryKey: ['/api/casting-cards', selectedContestant.id] });
      }
      toast({ title: "Saved!", description: "Casting card has been saved" });
    },
    onError: (error: any) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  // Filter contestants
  const filteredContestants = useMemo(() => {
    return contestants.filter(c => {
      const matchesSearch = searchTerm === '' || 
        c.name.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesRating = ratingFilter === 'all' || 
        c.auditionRating?.toUpperCase() === ratingFilter.toUpperCase();
      const matchesGender = genderFilter === 'all' || 
        c.gender.toLowerCase() === genderFilter.toLowerCase();
      return matchesSearch && matchesRating && matchesGender;
    });
  }, [contestants, searchTerm, ratingFilter, genderFilter]);

  const handleSave = () => {
    if (cardData) {
      saveMutation.mutate(cardData);
    }
  };

  // Toggle ready status and save immediately with the new value
  const toggleReadyAndSave = () => {
    if (cardData) {
      const updatedData = { ...cardData, isReady: !cardData.isReady };
      setCardData(updatedData);
      saveMutation.mutate(updatedData);
    }
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

      // Dynamic import of html2canvas and jspdf
      const html2canvas = (await import('html2canvas')).default;
      const { jsPDF } = await import('jspdf');

      const canvas = await html2canvas(cardElement, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
      });

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
      pdf.save(`${selectedContestant.name.replace(/\s+/g, '_')}_CastingCard.pdf`);
      
      toast({ title: "PDF Downloaded!", description: "Casting card saved as PDF" });
    } catch (error: any) {
      console.error('PDF generation error:', error);
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

    try {
      // Temporarily reset transform for capture
      const originalTransform = (element as HTMLElement).style.transform;
      (element as HTMLElement).style.transform = 'none';
      
      // Capture as canvas using html2canvas
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      
      // Restore transform
      (element as HTMLElement).style.transform = originalTransform;
      
      const imgData = canvas.toDataURL('image/png');
      
      // Open print window with the image
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        toast({ title: "Error", description: "Could not open print window. Please allow popups.", variant: "destructive" });
        return;
      }

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Casting Card - ${selectedContestant?.name || 'Print'}</title>
          <style>
            @page {
              size: A4 landscape;
              margin: 0;
            }
            @media print {
              html, body {
                margin: 0;
                padding: 0;
                -webkit-print-color-adjust: exact !important;
                print-color-adjust: exact !important;
              }
            }
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: white;
            }
            img {
              max-width: 100%;
              max-height: 100vh;
              width: auto;
              height: auto;
            }
          </style>
        </head>
        <body>
          <img src="${imgData}" />
          <script>
            window.onload = function() {
              setTimeout(function() { window.print(); }, 300);
            };
          </script>
        </body>
        </html>
      `);
      printWindow.document.close();
    } catch (error: any) {
      console.error('Print error:', error);
      toast({ title: "Print Error", description: error.message || "Failed to generate print view", variant: "destructive" });
    }
  };

  const updateField = (field: keyof CastingCardData, value: any) => {
    if (cardData) {
      setCardData({ ...cardData, [field]: value });
    }
  };

  // Text formatting functions for contentEditable
  const applyFormat = (command: string, value?: string) => {
    document.execCommand(command, false, value);
  };

  const formatBold = () => applyFormat('bold');
  const formatItalic = () => applyFormat('italic');
  const formatUnderline = () => applyFormat('underline');
  const formatFontSize = (size: string) => applyFormat('fontSize', size);
  const formatColor = (color: string) => applyFormat('foreColor', color);

  // Fullscreen mode renders just the card
  if (isFullscreen && selectedContestant && cardData) {
    return (
      <div className="fixed inset-0 z-50 bg-white overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          <div className="sticky top-0 bg-white py-2 border-b z-10 space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{selectedContestant.name} - Casting Card</h2>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} data-testid="btn-save-card-fs">
                  {saveMutation.isPending ? 'Saving...' : 'Save'}
                </Button>
                <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={isGeneratingPdf} data-testid="btn-download-pdf-fs">
                  <Download className="h-4 w-4 mr-1" />
                  PDF
                </Button>
                <Button size="sm" variant="outline" onClick={handlePrint} data-testid="btn-print-card-fs">
                  <Printer className="h-4 w-4 mr-1" />
                  Print
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsFullscreen(false)} data-testid="btn-exit-fullscreen">
                  <Minimize2 className="h-4 w-4 mr-1" />
                  Exit
                </Button>
              </div>
            </div>
            
            {/* Formatting toolbar */}
            <div className="flex items-center gap-1 flex-wrap bg-gray-50 p-2 rounded border">
              <span className="text-xs text-gray-500 mr-2">Format:</span>
              
              {/* Bold, Italic, Underline */}
              <Button size="icon" variant="ghost" onClick={formatBold} title="Bold" data-testid="btn-format-bold" className="h-8 w-8">
                <Bold className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={formatItalic} title="Italic" data-testid="btn-format-italic" className="h-8 w-8">
                <Italic className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={formatUnderline} title="Underline" data-testid="btn-format-underline" className="h-8 w-8">
                <Underline className="h-4 w-4" />
              </Button>
              
              <div className="w-px h-6 bg-gray-300 mx-1" />
              
              {/* Font Size */}
              <span className="text-xs text-gray-500 ml-1">Size:</span>
              <Button size="sm" variant="ghost" onClick={() => formatFontSize('1')} title="Small" data-testid="btn-size-small" className="h-8 px-2 text-xs">
                S
              </Button>
              <Button size="sm" variant="ghost" onClick={() => formatFontSize('3')} title="Normal" data-testid="btn-size-normal" className="h-8 px-2 text-sm">
                M
              </Button>
              <Button size="sm" variant="ghost" onClick={() => formatFontSize('5')} title="Large" data-testid="btn-size-large" className="h-8 px-2 text-base font-semibold">
                L
              </Button>
              <Button size="sm" variant="ghost" onClick={() => formatFontSize('7')} title="Extra Large" data-testid="btn-size-xlarge" className="h-8 px-2 text-lg font-bold">
                XL
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
              
              {/* Zoom Controls */}
              <span className="text-xs text-gray-500 ml-1">Zoom:</span>
              <Button size="sm" variant="ghost" onClick={() => setCardZoom(Math.max(0.3, cardZoom - 0.1))} title="Zoom Out" data-testid="btn-zoom-out" className="h-8 px-2">
                <ZoomOut className="h-4 w-4" />
              </Button>
              <span className="text-xs text-gray-600 min-w-[40px] text-center">{Math.round(cardZoom * 100)}%</span>
              <Button size="sm" variant="ghost" onClick={() => setCardZoom(Math.min(1.5, cardZoom + 0.1))} title="Zoom In" data-testid="btn-zoom-in" className="h-8 px-2">
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCardZoom(0.7)} title="Reset Zoom" data-testid="btn-zoom-reset" className="h-8 px-2 text-xs">
                Reset
              </Button>
            </div>
          </div>
          {/* A4 Landscape page container - 297mm x 210mm (scaled to fit) */}
          <div className="relative overflow-auto" style={{ height: `calc(210mm * ${cardZoom} + 40px)` }}>
            <div 
              id="casting-card-preview"
              className="bg-white p-6 border-2 border-gray-300 shadow-lg relative overflow-visible origin-top-left"
              style={{ 
                width: '297mm', 
                minHeight: '210mm',
                transform: `scale(${cardZoom})`,
                transformOrigin: 'top left',
                fontFamily: 'Calibri, sans-serif'
              }}
            >
              {/* Page boundary indicator line */}
              <div 
                className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 pointer-events-none z-10"
                style={{ top: '210mm' }}
              >
                <span className="absolute right-2 -top-5 bg-red-100 text-red-600 text-xs px-2 py-1 rounded font-medium">
                  Page boundary - content below will be cut off
                </span>
              </div>
              
              {/* Card Layout matching DOND PowerPoint design */}
              <div className="flex gap-8">
              {/* Left side - Photos */}
              <div className="w-64 flex-shrink-0">
                {/* Hidden file inputs */}
                <input
                  type="file"
                  ref={mainPhotoInputRef}
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file && selectedContestant) {
                      handlePhotoUpload(selectedContestant.id, file);
                    }
                    e.target.value = '';
                  }}
                />
                
                {/* Main photo - clickable to upload */}
                <div 
                  className="border-4 border-amber-500 rounded-lg overflow-hidden bg-gray-100 relative group cursor-pointer"
                  onClick={() => mainPhotoInputRef.current?.click()}
                  data-testid="upload-main-photo"
                >
                  <Avatar className="w-full h-72 rounded-none">
                    <AvatarImage src={selectedContestant.photoUrl || undefined} className="object-cover" />
                    <AvatarFallback className="text-6xl rounded-none bg-gray-200">{selectedContestant.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                  </Avatar>
                  {/* Upload overlay */}
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    {uploadingPhotoFor === selectedContestant.id ? (
                      <div className="text-white text-sm">Uploading...</div>
                    ) : (
                      <div className="text-center text-white">
                        <Upload className="w-8 h-8 mx-auto mb-1" />
                        <span className="text-xs">Click to upload</span>
                      </div>
                    )}
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
                              accept="image/*"
                              ref={(el) => { companionPhotoRefs.current[companion.id] = el; }}
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleCompanionPhotoUpload(companion.id, file);
                                e.target.value = '';
                              }}
                            />
                            <div 
                              className={`border-4 border-amber-500 rounded-lg overflow-hidden ${sizeClass} mx-auto bg-gray-100 relative group cursor-pointer`}
                              onClick={() => companionPhotoRefs.current[companion.id]?.click()}
                            >
                              <Avatar className="w-full h-full rounded-none">
                                <AvatarImage src={companion.photoUrl || undefined} className="object-cover" />
                                <AvatarFallback className={`${fallbackSize} rounded-none bg-gray-200`}>
                                  {(companion.name || 'Partner').split(' ').map(n => n?.[0] || '').join('') || '?'}
                                </AvatarFallback>
                              </Avatar>
                              {/* Upload overlay */}
                              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
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
                            {/* Remove button */}
                            <button
                              onClick={(e) => { e.stopPropagation(); removeManualCompanion(companion.id); }}
                              className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600"
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
                            >({companion.relationship})</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  
                  {/* Add companion button */}
                  {(cardData.manualCompanions?.length || 0) < 4 && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={addManualCompanion}
                      className="mt-3 text-xs"
                      data-testid="btn-add-companion"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Add Partner ({(cardData.manualCompanions?.length || 0)}/4)
                    </Button>
                  )}
                </div>
              </div>

              {/* Right side - Details */}
              <div className="flex-1">
                {/* Header banner with DOND logo - matching PowerPoint bronze/orange style */}
                <div className="bg-gradient-to-r from-amber-700 via-amber-600 to-amber-500 pl-4 rounded-l flex items-stretch justify-between mb-4">
                  <h2 
                    contentEditable
                    suppressContentEditableWarning
                    className="font-bold italic tracking-wide outline-none hover:bg-amber-600/50 focus:bg-amber-600/50 px-1 rounded cursor-text text-yellow-300 flex items-center"
                    style={{ 
                      fontFamily: '"Century Gothic", sans-serif',
                      fontSize: '40px',
                      lineHeight: '1.1',
                      paddingTop: '2px',
                      paddingBottom: '2px',
                      textShadow: '1px 1px 2px rgba(0,0,0,0.5), 0 0 1px rgba(0,0,0,0.3)'
                    }}
                    onBlur={(e) => updateField('fullName', e.currentTarget.textContent || '')}
                  >{cardData.fullName || selectedContestant.name.toUpperCase()}</h2>
                  <img src={dondLogo} alt="Deal or No Deal" className="h-full object-contain" />
                </div>

                {/* Age and details - all editable */}
                <div className="mb-6">
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    className="text-3xl font-bold outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                    onBlur={(e) => updateField('ageState', e.currentTarget.textContent || '')}
                  >
                    {cardData.ageState || `${selectedContestant.age || 'AGE'} (${selectedContestant.suburb || 'STATE'})`}
                  </div>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    className="text-xl font-bold text-gray-800 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                    onBlur={(e) => updateField('occupation', e.currentTarget.textContent || '')}
                  >
                    {cardData.occupation || 'OCCUPATION'}
                  </div>
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    className="text-lg text-green-600 font-semibold outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                    onBlur={(e) => updateField('sponsorCategory', e.currentTarget.textContent || '')}
                  >
                    {cardData.sponsorCategory || 'SPONSOR CATEGORY: X'}
                  </div>
                </div>

                {/* Tagline */}
                <h3 
                  contentEditable
                  suppressContentEditableWarning
                  className="font-bold text-red-600 mb-3 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                  style={{ fontFamily: 'Calibri, sans-serif', fontSize: '29px', marginTop: '-10px' }}
                  onBlur={(e) => updateField('tagline', e.currentTarget.textContent || '')}
                >
                  {cardData.tagline || 'SHORT TAGLINE'}
                </h3>

                {/* Bullet points - dynamic with add/remove */}
                <ul className="space-y-2" style={{ fontFamily: 'Calibri, sans-serif', fontSize: '14px' }}>
                  {(cardData.bulletPoints || defaultBulletPoints).map((point, index) => (
                    <li key={index} className="flex items-start gap-3 group">
                      <Circle className={`w-4 h-4 mt-1 flex-shrink-0 ${index === (cardData.bulletPoints || defaultBulletPoints).length - 1 ? 'text-red-500' : 'text-gray-400'}`} />
                      <span
                        contentEditable
                        suppressContentEditableWarning
                        className={`outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text flex-1 ${index === (cardData.bulletPoints || defaultBulletPoints).length - 1 ? 'text-red-600 italic' : ''}`}
                        onBlur={(e) => {
                          const newPoints = [...(cardData.bulletPoints || defaultBulletPoints)];
                          newPoints[index] = e.currentTarget.textContent || '';
                          updateField('bulletPoints', newPoints);
                        }}
                      >{point}</span>
                      <button
                        onClick={() => {
                          const newPoints = [...(cardData.bulletPoints || defaultBulletPoints)];
                          newPoints.splice(index, 1);
                          updateField('bulletPoints', newPoints);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-1"
                        title="Remove point"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const newPoints = [...(cardData.bulletPoints || defaultBulletPoints), 'New point...'];
                    updateField('bulletPoints', newPoints);
                  }}
                  className="mt-2 text-green-600 hover:text-green-700"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Point
                </Button>

                {/* Producer - matching PowerPoint style */}
                {cardData.showProducer !== false ? (
                  <div className="mt-6 flex items-center border border-gray-300 relative group">
                    <span className="bg-gray-200 px-4 py-2 font-semibold text-sm border-r border-gray-300">PRODUCER:</span>
                    <span 
                      contentEditable
                      suppressContentEditableWarning
                      className="bg-yellow-400 px-4 py-2 font-bold text-sm outline-none hover:bg-yellow-300 focus:bg-yellow-300 cursor-text flex-1"
                      onBlur={(e) => updateField('producerName', e.currentTarget.textContent || '')}
                    >{cardData.producerName || 'INSERT NAME'}</span>
                    <button
                      onClick={() => updateField('showProducer', false)}
                      className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
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
                    className="mt-6 text-xs"
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
    );
  }

  return (
    <div className="flex gap-6 h-[calc(100vh-200px)]">
      {/* Left Panel - Contestant Search */}
      <div className={`w-80 flex-shrink-0 flex flex-col ${isFullscreen ? 'hidden' : ''}`}>
        <Card className="flex-1 flex flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Contestant</CardTitle>
            <div className="space-y-2 mt-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name..."
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
                    <SelectItem value="B">B</SelectItem>
                    <SelectItem value="C">C</SelectItem>
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
                    <AvatarFallback className="text-xs">{c.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
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
      {selectedContestant && cardData ? (
        <div className="flex-1 overflow-hidden">
          {/* Direct Edit Card - Click any text to edit like PowerPoint */}
          <Card className="h-full flex flex-col">
            <CardHeader className="pb-2 flex-shrink-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-3">
                  <CardTitle className="text-base">Click any text to edit directly</CardTitle>
                  {/* Ready status toggle */}
                  <Button
                    size="sm"
                    variant={cardData.isReady ? "default" : "outline"}
                    onClick={toggleReadyAndSave}
                    disabled={saveMutation.isPending}
                    className={cardData.isReady ? "bg-green-600 hover:bg-green-700" : ""}
                    data-testid="btn-toggle-ready"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" />
                    {cardData.isReady ? 'Ready' : 'Mark Ready'}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} data-testid="btn-save-card">
                    {saveMutation.isPending ? 'Saving...' : 'Save'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleDownloadPdf} disabled={isGeneratingPdf} data-testid="btn-download-pdf">
                    <Download className="h-4 w-4 mr-1" />
                    PDF
                  </Button>
                  <Button size="sm" variant="outline" onClick={handlePrint} data-testid="btn-print-card">
                    <Printer className="h-4 w-4 mr-1" />
                    Print
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setIsFullscreen(true)} data-testid="btn-fullscreen">
                    <Maximize2 className="h-4 w-4 mr-1" />
                    Fullscreen
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
              {/* A4 Landscape page container - 297mm x 210mm (scaled for preview) */}
              <div className="relative mx-auto" style={{ maxWidth: '100%' }}>
                <div 
                  id="casting-card-preview"
                  className="bg-white p-6 border-2 border-gray-300 shadow-lg relative overflow-visible origin-top-left"
                  style={{ 
                    width: '297mm', 
                    minHeight: '210mm',
                    transform: 'scale(0.38)',
                    transformOrigin: 'top left',
                    marginBottom: '-62%',
                    fontFamily: 'Calibri, sans-serif'
                  }}
                >
                  {/* Page boundary indicator line */}
                  <div 
                    className="absolute left-0 right-0 border-t-2 border-dashed border-red-400 pointer-events-none z-10"
                    style={{ top: '210mm' }}
                  >
                    <span className="absolute right-2 -top-5 bg-red-100 text-red-600 text-xs px-2 py-1 rounded font-medium">
                      Page boundary - content below will be cut off
                    </span>
                  </div>
                  
                  {/* Card Layout matching DOND PowerPoint design */}
                  <div className="flex gap-8">
                  {/* Left side - Photos */}
                  <div className="w-64 flex-shrink-0">
                    {/* Main photo - clickable to upload */}
                    <div 
                      className="border-4 border-amber-500 rounded-lg overflow-hidden bg-gray-100 relative group cursor-pointer"
                      onClick={() => mainPhotoInputRef.current?.click()}
                      data-testid="upload-main-photo-preview"
                    >
                      <Avatar className="w-full h-72 rounded-none">
                        <AvatarImage src={selectedContestant.photoUrl || undefined} className="object-cover" />
                        <AvatarFallback className="text-6xl rounded-none bg-gray-200">{selectedContestant.name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
                      </Avatar>
                      {/* Upload overlay */}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        {uploadingPhotoFor === selectedContestant.id ? (
                          <div className="text-white text-sm">Uploading...</div>
                        ) : (
                          <div className="text-center text-white">
                            <Upload className="w-8 h-8 mx-auto mb-1" />
                            <span className="text-xs">Click to upload</span>
                          </div>
                        )}
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
                                  onClick={() => companionPhotoRefs.current[companion.id]?.click()}
                                >
                                  <Avatar className="w-full h-full rounded-none">
                                    <AvatarImage src={companion.photoUrl || undefined} className="object-cover" />
                                    <AvatarFallback className={`${fallbackSize} rounded-none bg-gray-200`}>
                                      {(companion.name || 'Partner').split(' ').map(n => n?.[0] || '').join('') || '?'}
                                    </AvatarFallback>
                                  </Avatar>
                                  {/* Upload overlay */}
                                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
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
                                {/* Remove button */}
                                <button
                                  onClick={(e) => { e.stopPropagation(); removeManualCompanion(companion.id); }}
                                  className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 z-10"
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
                                >({companion.relationship})</div>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      
                      {/* Add companion button */}
                      {(cardData.manualCompanions?.length || 0) < 4 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={addManualCompanion}
                          className="mt-3 text-xs"
                          data-testid="btn-add-companion-preview"
                        >
                          <Plus className="w-3 h-3 mr-1" />
                          Add Partner ({(cardData.manualCompanions?.length || 0)}/4)
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Right side - Details */}
                  <div className="flex-1">
                    {/* Header banner with DOND logo - matching PowerPoint bronze/orange style */}
                    <div className="bg-gradient-to-r from-amber-700 via-amber-600 to-amber-500 pl-4 rounded-l flex items-stretch justify-between mb-4" data-testid="preview-header-banner">
                      <h2 
                        contentEditable
                        suppressContentEditableWarning
                        className="font-bold italic tracking-wide outline-none hover:bg-amber-600/50 focus:bg-amber-600/50 px-1 rounded cursor-text text-yellow-300 flex items-center"
                        style={{ 
                          fontFamily: '"Century Gothic", sans-serif',
                          fontSize: '40px',
                          lineHeight: '1.1',
                          paddingTop: '2px',
                          paddingBottom: '2px',
                          textShadow: '1px 1px 2px rgba(0,0,0,0.5), 0 0 1px rgba(0,0,0,0.3)'
                        }}
                        onBlur={(e) => updateField('fullName', e.currentTarget.textContent || '')}
                        data-testid="preview-contestant-name"
                      >{cardData.fullName || selectedContestant.name.toUpperCase()}</h2>
                      <img src={dondLogo} alt="Deal or No Deal" className="h-full object-contain" />
                    </div>

                    {/* Age and details - all editable */}
                    <div className="mb-6">
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        className="text-3xl font-bold outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                        onBlur={(e) => updateField('ageState', e.currentTarget.textContent || '')}
                        data-testid="preview-age-location"
                      >
                        {cardData.ageState || `${selectedContestant.age || 'AGE'} (${selectedContestant.suburb || 'STATE'})`}
                      </div>
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        className="text-xl font-bold text-gray-800 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                        onBlur={(e) => updateField('occupation', e.currentTarget.textContent || '')}
                        data-testid="edit-occupation"
                      >
                        {cardData.occupation || 'OCCUPATION'}
                      </div>
                      <div
                        contentEditable
                        suppressContentEditableWarning
                        className="text-lg text-green-600 font-semibold outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                        onBlur={(e) => updateField('sponsorCategory', e.currentTarget.textContent || '')}
                        data-testid="edit-sponsor"
                      >
                        {cardData.sponsorCategory || 'SPONSOR CATEGORY: X'}
                      </div>
                    </div>

                    {/* Tagline */}
                    <h3 
                      contentEditable
                      suppressContentEditableWarning
                      className="font-bold text-red-600 mb-3 outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 -mx-1 rounded cursor-text"
                      style={{ fontFamily: 'Calibri, sans-serif', fontSize: '29px', marginTop: '-10px' }}
                      onBlur={(e) => updateField('tagline', e.currentTarget.textContent || '')}
                      data-testid="edit-tagline"
                    >
                      {cardData.tagline || 'SHORT TAGLINE'}
                    </h3>

                    {/* Bullet points - dynamic with add/remove */}
                    <ul className="space-y-2" style={{ fontFamily: 'Calibri, sans-serif', fontSize: '14px' }} data-testid="preview-details-list">
                      {(cardData.bulletPoints || defaultBulletPoints).map((point, index) => (
                        <li key={index} className="flex items-start gap-3 group">
                          <Circle className={`w-4 h-4 mt-1 flex-shrink-0 ${index === (cardData.bulletPoints || defaultBulletPoints).length - 1 ? 'text-red-500' : 'text-gray-400'}`} />
                          <span
                            contentEditable
                            suppressContentEditableWarning
                            className={`outline-none hover:bg-yellow-50 focus:bg-yellow-100 px-1 rounded cursor-text flex-1 ${index === (cardData.bulletPoints || defaultBulletPoints).length - 1 ? 'text-red-600 italic' : ''}`}
                            onBlur={(e) => {
                              const newPoints = [...(cardData.bulletPoints || defaultBulletPoints)];
                              newPoints[index] = e.currentTarget.textContent || '';
                              updateField('bulletPoints', newPoints);
                            }}
                            data-testid={`edit-bullet-${index}`}
                          >{point}</span>
                          <button
                            onClick={() => {
                              const newPoints = [...(cardData.bulletPoints || defaultBulletPoints)];
                              newPoints.splice(index, 1);
                              updateField('bulletPoints', newPoints);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-red-500 hover:text-red-700 p-1"
                            title="Remove point"
                            data-testid={`btn-remove-bullet-${index}`}
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const newPoints = [...(cardData.bulletPoints || defaultBulletPoints), 'New point...'];
                        updateField('bulletPoints', newPoints);
                      }}
                      className="mt-2 text-green-600 hover:text-green-700"
                      data-testid="btn-add-bullet"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add Point
                    </Button>

                    {/* Producer - matching PowerPoint style */}
                    {cardData.showProducer !== false ? (
                      <div className="mt-6 flex items-center border border-gray-300 relative group">
                        <span className="bg-gray-200 px-4 py-2 font-semibold text-sm border-r border-gray-300">PRODUCER:</span>
                        <span 
                          contentEditable
                          suppressContentEditableWarning
                          className="bg-yellow-400 px-4 py-2 font-bold text-sm outline-none hover:bg-yellow-300 focus:bg-yellow-300 cursor-text flex-1"
                          onBlur={(e) => updateField('producerName', e.currentTarget.textContent || '')}
                          data-testid="edit-producer"
                        >{cardData.producerName || 'INSERT NAME'}</span>
                        <button
                          onClick={() => updateField('showProducer', false)}
                          className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs hover:bg-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
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
                        className="mt-6 text-xs"
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
  const [ratingFilter, setRatingFilter] = useState<string>('all');
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

  // Book contestant mutation
  const bookContestantMutation = useMutation({
    mutationFn: async ({ recordDayId, contestantId, blockNumber, seatLabel }: { 
      recordDayId: string; contestantId: string; blockNumber: number; seatLabel: string 
    }) => {
      const response = await apiRequest('POST', '/api/seat-assignments', {
        recordDayId,
        contestantId,
        blockNumber,
        seatLabel,
        playerType: 'regular',
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
    onError: (error: any) => {
      toast({ title: "Booking failed", description: error.message || "Failed to book contestant", variant: "destructive" });
    },
  });

  // Book group mutation
  const bookGroupMutation = useMutation({
    mutationFn: async ({ recordDayId, contestantIds, blockNumber, startingSeat }: { 
      recordDayId: string; contestantIds: string[]; blockNumber: number; startingSeat: string 
    }) => {
      const response = await apiRequest('POST', '/api/seat-assignments/group', {
        recordDayId,
        contestantIds,
        blockNumber,
        startingSeat,
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
    onError: (error: any) => {
      toast({ title: "Group booking failed", description: error.message || "Failed to book group", variant: "destructive" });
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
      if (ratingFilter !== 'all' && c.auditionRating?.toUpperCase() !== ratingFilter) return false;
      if (genderFilter !== 'all' && c.gender?.toLowerCase() !== genderFilter.toLowerCase()) return false;
      // Status filter
      if (statusFilter !== 'all' && c.availabilityStatus !== statusFilter) return false;
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
  }, [eligibleContestants, plannedContestantIds, weekPlannedContestantIds, viewMode, searchTerm, ratingFilter, genderFilter, ageFilter, statusFilter]);

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
    if (!contestantGroupId) return [];
    return contestants.filter(c => (c as any).groupId === contestantGroupId && c.id !== contestant.id);
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
                    <Select value={ratingFilter} onValueChange={setRatingFilter}>
                      <SelectTrigger className="flex-1" data-testid="select-rating-filter">
                        <SelectValue placeholder="Rating" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Ratings</SelectItem>
                        <SelectItem value="A+">A+ Only</SelectItem>
                        <SelectItem value="A">A Only</SelectItem>
                      </SelectContent>
                    </Select>
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
                                blockContestants.map(c => (
                                  <div
                                    key={c.id}
                                    draggable={!c.isCustom}
                                    onDragStart={() => !c.isCustom && handleDragStart(c, { type: 'block', block: blockNum, dayId: selectedDayId })}
                                    onDragEnd={handleDragEnd}
                                    onClick={() => { if (!c.isCustom) { const full = findContestant(c.id); if (full) openBookingDialog(full, selectedDayId); } }}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg group ${c.isCustom ? 'bg-purple-500/10 border border-purple-500/30 cursor-default' : `cursor-grab ${isPB ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-green-500/10 border border-green-500/30'}`}`}
                                    data-testid={`planned-contestant-${blockNum}-${c.id}`}
                                  >
                                    <Avatar className="h-12 w-12 rounded-lg flex-shrink-0">
                                      <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                                      <AvatarFallback className={`text-sm rounded-lg text-white ${c.isCustom ? 'bg-gradient-to-br from-purple-400 to-pink-500' : 'bg-gradient-to-br from-blue-400 to-purple-500'}`}>
                                        {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <div className="text-sm min-w-0">
                                      <span className="font-medium block truncate">{c.name}</span>
                                      {c.isCustom ? (
                                        <span className="text-xs text-purple-600 dark:text-purple-400">Custom entry</span>
                                      ) : (
                                        <span className="text-xs text-muted-foreground">
                                          {c.gender === 'Female' ? 'F' : 'M'}{c.age ? ` • ${c.age}y` : ''}
                                        </span>
                                      )}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                                      onClick={(e) => { e.stopPropagation(); removeFromBlock(blockNum, c.id); }}
                                      data-testid={`remove-contestant-${blockNum}-${c.id}`}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))
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
                          return (
                            <Card 
                              key={blockNum}
                              className={`transition-colors ${draggedContestant ? 'border-dashed border-primary/50' : ''}`}
                              onDragOver={e => e.preventDefault()}
                              onDrop={() => handleDrop(blockNum, day.id)}
                              data-testid={`weekly-block-${day.id}-${blockNum}`}
                            >
                              <div className="p-2">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="outline" className="text-xs">B{blockNum}</Badge>
                                  <span className="text-xs text-muted-foreground">{blockContestants.length} planned</span>
                                </div>
                                <div className="space-y-2 min-h-[48px]">
                                  {blockContestants.length === 0 ? (
                                    <div className="text-xs text-muted-foreground text-center py-2 border border-dashed rounded">
                                      Drop here
                                    </div>
                                  ) : (
                                    blockContestants.map(c => (
                                      <div
                                        key={c.id}
                                        draggable
                                        onDragStart={() => handleDragStart(c, { type: 'block', block: blockNum, dayId: day.id })}
                                        onDragEnd={handleDragEnd}
                                        onClick={() => { const full = findContestant(c.id); if (full) openBookingDialog(full, day.id); }}
                                        className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border cursor-grab group"
                                        data-testid={`weekly-contestant-${day.id}-${blockNum}-${c.id}`}
                                      >
                                        <Avatar className="h-10 w-10 rounded-lg flex-shrink-0">
                                          <AvatarImage src={c.photoUrl || undefined} className="object-cover" />
                                          <AvatarFallback className="text-xs rounded-lg bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                                            {c.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                          </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                          <span className="text-sm font-medium truncate block">{c.name}</span>
                                          <span className="text-xs text-muted-foreground">
                                            {c.gender === 'Female' ? 'F' : 'M'}{c.age ? ` • ${c.age}y` : ''}
                                          </span>
                                        </div>
                                        <Button
                                          variant="ghost"
                                          size="icon"
                                          className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
                                          onClick={(e) => { e.stopPropagation(); removeFromBlock(blockNum, c.id, day.id); }}
                                        >
                                          <X className="h-3 w-3" />
                                        </Button>
                                      </div>
                                    ))
                                  )}
                                </div>
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
                {viewingContestant.medicalMobilityNotes && (
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
    </div>
  );
}

export default function PlayersPage() {
  const { toast } = useToast();
  const [selectedRecordDayId, setSelectedRecordDayId] = useState<string>('');
  const [viewingPhoto, setViewingPhoto] = useState<{ url: string; name: string } | null>(null);
  const [activeTab, setActiveTab] = useState<string>('players');
  const [editContestantId, setEditContestantId] = useState<string | null>(null);

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
    
    // Prevent Block 7 from being assigned to EP1
    if (episodeNumber === '1') {
      const assignment = allAssignments.find(a => a.id === assignmentId);
      if (assignment && assignment.blockNumber === 7) {
        toast({ 
          title: "Block 7 Cannot Be EP1", 
          description: "Block 7 contestants cannot be assigned to Episode 1. Please select a different episode.", 
          variant: "destructive" 
        });
        return;
      }
    }
    
    updateEpisodeMutation.mutate({ assignmentId, episodeNumber });
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
    const printWindow = window.open(`/api/casting-cards/${contestantId}/print`, '_blank');
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
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
            
            {notes && (
              <div className="mt-2 text-xs bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-1 rounded">
                {notes}
              </div>
            )}
            
            {isPlayer && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {/* System-created casting card status */}
                {(() => {
                  const systemCard = c ? castingCardsMap.get(c.id) : null;
                  if (systemCard) {
                    return (
                      <>
                        <Badge 
                          className={systemCard.isReady ? "bg-green-600 text-white" : "bg-amber-500 text-white"}
                        >
                          <CreditCard className="h-3 w-3 mr-1" />
                          Card {systemCard.isReady ? 'Ready' : 'Draft'}
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
                
                {/* Uploaded PowerPoint/PDF casting card */}
                {assignment.castingCardUrl ? (
                  <>
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
                )}
              </div>
            )}
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
              <TabsTrigger value="planning" data-testid="tab-planning">
                <Calendar className="h-4 w-4 mr-2" />
                RX Planning
              </TabsTrigger>
              <TabsTrigger value="casting" data-testid="tab-casting">
                <CreditCard className="h-4 w-4 mr-2" />
                Casting Cards
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
          <CastingCardsTab contestants={contestants} initialContestantId={editContestantId} onClearInitial={() => setEditContestantId(null)} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
