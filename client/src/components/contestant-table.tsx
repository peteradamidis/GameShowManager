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
import { Search, Mail, Phone, MapPin, Heart, Camera, Upload, Trash2, User, Pencil, X, Save, Calendar, AlertTriangle, Users, CalendarPlus, ArrowUp, ArrowDown, ArrowUpDown, FileCheck } from "lucide-react";
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
import { getPartnerNames, attendingWithMentionsName, isSoloContestant } from "@shared/attendingWithParser";

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
  podiumStory?: boolean;
  availableForStandby?: boolean;
  isTemporary?: boolean;
  isTestSubject?: boolean;
}

interface SeatAssignment {
  id: string;
  contestantId: string;
  recordDayId: string;
  blockNumber: number;
  seatLabel: string;
  rating?: string | null;
}

interface PaperworkStatus {
  status: 'received' | 'sent' | 'none';
  receivedAt?: string;
  sentAt?: string;
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
  paperworkStatusMap?: Map<string, PaperworkStatus>;
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
  "Prahran": { lat: -37.8600, lng: 145.0067 },
  "South Yarra": { lat: -37.8750, lng: 145.0233 },
  "Toorak": { lat: -37.8933, lng: 145.0400 },
  "St Kilda": { lat: -37.8667, lng: 145.0200 },
  "Elsternwick": { lat: -37.8667, lng: 145.0167 },
  "Port Melbourne": { lat: -37.8000, lng: 144.8800 },
  "Spotswood": { lat: -37.8267, lng: 144.8600 },
  "Altona": { lat: -37.8667, lng: 144.7867 },
  "Footscray": { lat: -37.8433, lng: 144.8067 },
  "Carlton": { lat: -37.7667, lng: 144.9667 },
  "Collingwood": { lat: -37.7533, lng: 145.0167 },
  "Abbotsford": { lat: -37.7667, lng: 145.0533 },
  "Fitzroy": { lat: -37.7333, lng: 145.0500 },
  "Brunswick": { lat: -37.7300, lng: 144.9200 },
  "Thornbury": { lat: -37.7067, lng: 144.9833 },
  "Preston": { lat: -37.6867, lng: 145.0333 },
  "Heidelberg": { lat: -37.7500, lng: 145.0833 },
  "Ivanhoe": { lat: -37.7200, lng: 145.0900 },
  "Eltham": { lat: -37.6900, lng: 145.1500 },
  "Box Hill": { lat: -37.8200, lng: 145.1300 },
  "Mitcham": { lat: -37.8600, lng: 145.1500 },
  "Ringwood": { lat: -37.8300, lng: 145.2300 },
  "Mooroolbark": { lat: -37.7800, lng: 145.3100 },
  "Croydon": { lat: -37.7900, lng: 145.2800 },
  "Nunawading": { lat: -37.8400, lng: 145.1700 },
  "Blackburn": { lat: -37.8500, lng: 145.1800 },
  "Oakleigh": { lat: -37.9000, lng: 145.1100 },
  "Chadstone": { lat: -37.9100, lng: 145.0800 },
  "Glen Waverley": { lat: -37.8800, lng: 145.1400 },
  "Rowville": { lat: -37.9500, lng: 145.1800 },
  "Knoxfield": { lat: -37.9800, lng: 145.2000 },
  "Ferntree Gully": { lat: -37.8900, lng: 145.2500 },
  "Belgrave": { lat: -37.8500, lng: 145.3300 },
  "Kew": { lat: -37.8067, lng: 145.0867 },
  "Hawthorn": { lat: -37.8233, lng: 145.0733 },
  "Camberwell": { lat: -37.8433, lng: 145.0600 },
  "Balwyn": { lat: -37.8167, lng: 145.1033 },
  "Officer": { lat: -37.6200, lng: 145.2000 },
  "Berwick": { lat: -38.0167, lng: 145.3833 },
  "Narre Warren": { lat: -38.0500, lng: 145.2500 },
  "Langwarrin": { lat: -38.3000, lng: 145.1500 },
  "Hastings": { lat: -38.3800, lng: 145.2000 },
  "Clyde": { lat: -37.9000, lng: 145.5200 },
  "Gembrook": { lat: -37.8700, lng: 145.5500 },
  "Laverton": { lat: -37.9200, lng: 144.7500 },
  "Ballan": { lat: -37.8200, lng: 144.1500 },
  "Tullamarine": { lat: -37.6000, lng: 144.9000 },
  "Mountain Gate": { lat: -37.9200, lng: 145.2300 },
  "Vermont South": { lat: -37.7000, lng: 145.2500 },
  "Mount Waverley": { lat: -37.6500, lng: 145.3000 },
  "Notting Hill": { lat: -37.7800, lng: 145.2000 },
  "Mount Evelyn": { lat: -37.8100, lng: 145.3200 },
  "Sassafras": { lat: -37.8000, lng: 145.4000 },
  "Diggers Rest": { lat: -37.6000, lng: 144.3000 },
  "Ashburton": { lat: -37.9200, lng: 145.0900 },
  "Silvan": { lat: -37.7500, lng: 145.4800 },
  "Bunyip": { lat: -38.1000, lng: 145.6000 },
  "Koo Wee Rup": { lat: -38.2500, lng: 145.6500 },
  "Tynong": { lat: -37.9800, lng: 145.5500 },
  "Fountain Gate": { lat: -38.0333, lng: 145.3000 },
  "Somerville": { lat: -38.3500, lng: 145.1800 },
  "Albert Park": { lat: -37.8867, lng: 144.9467 },
  "Southbank": { lat: -37.8397, lng: 144.9557 },
  "Docklands": { lat: -37.8308, lng: 144.9692 },
  "West Melbourne": { lat: -37.8000, lng: 144.9500 },
  "Williamstown": { lat: -37.7800, lng: 144.8500 },
  "Glenhuntly": { lat: -37.8867, lng: 145.0367 },
  "Bentleigh": { lat: -37.9167, lng: 145.0567 },
  "Moorabbin": { lat: -37.9300, lng: 145.0733 },
  "McKinnon": { lat: -37.9533, lng: 145.0833 },
  "Brighton": { lat: -37.9267, lng: 145.0200 },
  "Sandringham": { lat: -37.9533, lng: 145.0033 },
  "Mentone": { lat: -37.9800, lng: 145.0700 },
  "Parkdale": { lat: -38.0067, lng: 145.0633 },
  "Beaumaris": { lat: -38.0533, lng: 145.0500 },
  "Highett": { lat: -37.9967, lng: 145.0367 },
  "Ormond": { lat: -37.9467, lng: 145.0900 },
  "Mordialloc": { lat: -38.0133, lng: 145.0833 },
  "Auburn": { lat: -37.7167, lng: 144.9667 },
  "Moonee Ponds": { lat: -37.7600, lng: 144.9133 },
  "Ascot Vale": { lat: -37.7467, lng: 144.9233 },
  "Coburg": { lat: -37.7400, lng: 144.9600 },
  "Pascoe Vale": { lat: -37.7300, lng: 144.9500 },
  "Fawkner": { lat: -37.7167, lng: 144.9867 },
  "Airport West": { lat: -37.7200, lng: 144.8667 },
  "Keilor": { lat: -37.7133, lng: 144.8000 },
  "Niddrie": { lat: -37.7533, lng: 144.8467 },
  "Avondale Heights": { lat: -37.7567, lng: 144.8267 },
  "Sunshine": { lat: -37.8000, lng: 144.7600 },
  "Strathmore": { lat: -37.7411, lng: 144.8864 },
  "Greensborough": { lat: -37.6833, lng: 145.1167 },
  "Templestowe": { lat: -37.7667, lng: 145.1500 },
  "Doncaster": { lat: -37.7833, lng: 145.1667 },
  "Bulleen": { lat: -37.8267, lng: 145.1600 },
  "Taylors Lakes": { lat: -37.7033, lng: 144.8567 },
  "Glenroy": { lat: -37.7267, lng: 144.8867 },
  "Roxburgh Park": { lat: -37.6733, lng: 144.9533 },
  "Epping": { lat: -37.6600, lng: 145.0200 },
  "Plenty": { lat: -37.6667, lng: 145.0667 },
  "South Morang": { lat: -37.6467, lng: 145.0600 },
  "Yarrrawonga": { lat: -37.6867, lng: 145.0600 },
  "Macleod": { lat: -37.7067, lng: 145.0800 },
  "Watsonia": { lat: -37.7200, lng: 145.1000 },
  "Northcote": { lat: -37.7533, lng: 145.0100 },
  "Alphington": { lat: -37.7600, lng: 145.0400 },
  "Fairfield": { lat: -37.7733, lng: 145.0567 },
  "Montmorency": { lat: -37.6667, lng: 145.1600 },
  "Hurstbridge": { lat: -37.6433, lng: 145.2167 },
  "Warrandyte": { lat: -37.7167, lng: 145.2500 },
  "Ringwood East": { lat: -37.8100, lng: 145.2500 },
  "Forest Hill": { lat: -37.8400, lng: 145.1200 },
  "Sunbury West": { lat: -37.5900, lng: 144.7400 },
  "Vineyard": { lat: -37.5533, lng: 144.7667 },
  "Euclumbene": { lat: -37.6633, lng: 144.6967 },
  "Wildwood": { lat: -37.6400, lng: 144.5800 },
  "Macedon": { lat: -37.3733, lng: 144.5733 },
  "Mount Macedon": { lat: -37.3600, lng: 144.5933 },
  "Riddells Creek": { lat: -37.4233, lng: 144.5500 },
  "Lancefield": { lat: -37.3967, lng: 144.4333 },
  "Romsey": { lat: -37.2700, lng: 144.6300 },
  "Hesket": { lat: -37.3300, lng: 144.7200 },
  "Kyneton": { lat: -37.2500, lng: 144.4600 },
  "Trentham": { lat: -37.4167, lng: 144.2500 },
  "Daylesford": { lat: -37.3333, lng: 143.8667 },
  "Castlemaine": { lat: -37.0733, lng: 144.2167 },
  "Chewton": { lat: -37.0900, lng: 144.1900 },
  "New Gisborne": { lat: -37.3533, lng: 144.6700 },
  "Woodend": { lat: -37.3233, lng: 144.5800 },
  "Darraweit Guim": { lat: -37.2233, lng: 144.6300 },
  "Kilmore East": { lat: -37.3000, lng: 144.9500 },
  "Broadford": { lat: -37.1500, lng: 145.1300 },
  "Pyalong": { lat: -37.0233, lng: 144.9667 },
  "Clonbinane": { lat: -36.9700, lng: 144.9100 },
  "Wallan": { lat: -37.2500, lng: 144.9900 },
  "Beveridge": { lat: -37.5300, lng: 144.9700 },
  "Donvale": { lat: -37.8000, lng: 145.2100 },
  "Mooroolbark East": { lat: -37.7600, lng: 145.3400 },
  "Belgrave Heights": { lat: -37.8300, lng: 145.3600 },
  "Kallista": { lat: -37.8767, lng: 145.3700 },
  "Olinda": { lat: -37.8600, lng: 145.3633 },
  "Emerald": { lat: -37.8933, lng: 145.3867 },
  "Clematis": { lat: -37.8967, lng: 145.3200 },
  "Wandin": { lat: -37.8467, lng: 145.2800 },
  "Wandin North": { lat: -37.8267, lng: 145.3000 },
  "Kalorama": { lat: -37.8367, lng: 145.3500 },
  "Monbulk": { lat: -37.8833, lng: 145.3500 },
  "Ferny Creek": { lat: -37.8933, lng: 145.2900 },
  "Sherbrooke": { lat: -37.8533, lng: 145.3167 },
  "Upwey": { lat: -37.8267, lng: 145.3100 },
  "Tecoma": { lat: -37.8500, lng: 145.3400 },
  "Kallista North": { lat: -37.8867, lng: 145.3533 },
  "Badger Creek": { lat: -37.9367, lng: 145.3833 },
  "Seville": { lat: -37.9167, lng: 145.3600 },
  "Millgrove": { lat: -37.9067, lng: 145.3200 },
  "Woori Yallock": { lat: -37.8733, lng: 145.4433 },
  "Yarra Glen": { lat: -37.7867, lng: 145.3867 },
  "Coldstream": { lat: -37.7500, lng: 145.4100 },
  "Steels Creek": { lat: -37.7700, lng: 145.4500 },
  "Healesville": { lat: -37.6667, lng: 145.4100 },
  "Chum Creek": { lat: -37.6800, lng: 145.5200 },
  "Tarrawarra": { lat: -37.6667, lng: 145.5333 },
  "Alexandra": { lat: -37.5967, lng: 145.5200 },
  "Thornton": { lat: -37.6533, lng: 145.6867 },
  "Buxton": { lat: -37.7533, lng: 145.6100 },
  "Noojee": { lat: -37.7967, lng: 145.7067 },
  "Powelltown": { lat: -37.7933, lng: 145.5667 },
  "Narbethong": { lat: -37.7400, lng: 145.5867 },
  "Cherrybank": { lat: -37.8167, lng: 145.6333 },
  // East Gippsland - Very remote (over 60km)
  "Lakes Entrance": { lat: -37.8720, lng: 147.9990 },
  "Orbost": { lat: -37.7005, lng: 148.4567 },
  "Mallacoota": { lat: -37.5567, lng: 149.7500 },
  "Metung": { lat: -37.8908, lng: 147.8550 },
  "Paynesville": { lat: -37.9167, lng: 147.7167 },
  "Marlo": { lat: -37.7833, lng: 148.5333 },
  "Cann River": { lat: -37.5674, lng: 149.1519 },
  // Gippsland - Remote
  "Yarram": { lat: -38.5617, lng: 146.6734 },
  "Foster": { lat: -38.6517, lng: 146.2117 },
  "Leongatha": { lat: -38.4817, lng: 145.9417 },
  "Korumburra": { lat: -38.4317, lng: 145.8217 },
  "Inverloch": { lat: -38.6367, lng: 145.7300 },
  "Wonthaggi": { lat: -38.6050, lng: 145.5900 },
  "San Remo": { lat: -38.5167, lng: 145.3667 },
  "Cowes": { lat: -38.4550, lng: 145.2350 }, // Phillip Island
  "Drouin": { lat: -38.1340, lng: 145.8550 },
  "Moe": { lat: -38.1770, lng: 146.2620 },
  "Morwell": { lat: -38.2350, lng: 146.3950 },
  "Churchill": { lat: -38.3120, lng: 146.4220 },
  // Western Victoria - Remote
  "Stawell": { lat: -37.0560, lng: 142.7750 },
  "Ararat": { lat: -37.2830, lng: 142.9340 },
  "Nhill": { lat: -36.3333, lng: 141.6500 },
  "Dimboola": { lat: -36.4617, lng: 142.0333 },
  // Coastal - Southwest
  "Port Fairy": { lat: -38.3850, lng: 142.2300 },
  "Port Campbell": { lat: -38.6194, lng: 142.9967 },
  // Border towns
  "Kerang": { lat: -35.7330, lng: 143.9200 },
  "Cohuna": { lat: -35.8069, lng: 144.2194 },
  "Kyabram": { lat: -36.3167, lng: 145.0500 },
  "Rochester": { lat: -36.3667, lng: 144.7000 },
  "Cobram": { lat: -35.9222, lng: 145.6556 },
  "Numurkah": { lat: -36.0833, lng: 145.4333 },
  // High Country
  "Bright": { lat: -36.7300, lng: 146.9600 },
  "Myrtleford": { lat: -36.5600, lng: 146.7250 },
  "Beechworth": { lat: -36.3620, lng: 146.6880 },
  "Mansfield": { lat: -37.0530, lng: 146.0840 },
  "Benalla": { lat: -36.5520, lng: 145.9820 },
  "Euroa": { lat: -36.7500, lng: 145.7667 },
  "Nagambie": { lat: -36.7850, lng: 145.1567 },
  // Additional common locations
  "Phillip Island": { lat: -38.4890, lng: 145.2350 },
  "Gippsland": { lat: -38.1000, lng: 146.5000 },
  
  // Additional Gippsland towns
  "Stratford": { lat: -37.9667, lng: 147.0833 },
  "Heyfield": { lat: -37.9833, lng: 146.7833 },
  "Maffra": { lat: -37.9667, lng: 146.9833 },
  "Rosedale": { lat: -38.1500, lng: 146.7833 },
  "Longford": { lat: -38.1833, lng: 147.1000 },
  "Loch Sport": { lat: -38.0500, lng: 147.6000 },
  "Bruthen": { lat: -37.7000, lng: 147.8333 },
  "Nowa Nowa": { lat: -37.7167, lng: 148.0833 },
  "Buchan": { lat: -37.5000, lng: 148.1667 },
  "Omeo": { lat: -37.1000, lng: 147.6000 },
  "Swifts Creek": { lat: -37.2500, lng: 147.7167 },
  "Ensay": { lat: -37.3500, lng: 147.8333 },
  "Bemm River": { lat: -37.7833, lng: 148.9833 },
  "Cabbage Tree Creek": { lat: -37.5833, lng: 149.1500 },
  "Genoa": { lat: -37.4833, lng: 149.5833 },
  "Glenaladale": { lat: -37.7167, lng: 147.0000 },
  "Briagolong": { lat: -37.8333, lng: 147.0500 },
  "Dargo": { lat: -37.5000, lng: 147.2667 },
  "Licola": { lat: -37.6167, lng: 146.6333 },
  "Rawson": { lat: -37.9500, lng: 146.2333 },
  "Erica": { lat: -37.9833, lng: 146.3667 },
  "Walhalla": { lat: -37.9333, lng: 146.4500 },
  "Thorpdale": { lat: -38.2833, lng: 146.1833 },
  "Trafalgar": { lat: -38.2000, lng: 146.1500 },
  "Yarragon": { lat: -38.2000, lng: 146.0500 },
  "Newborough": { lat: -38.2167, lng: 146.3000 },
  "Yallourn": { lat: -38.1833, lng: 146.3333 },
  "Mirboo North": { lat: -38.4000, lng: 146.1667 },
  "Boolarra": { lat: -38.3667, lng: 146.2667 },
  "Toora": { lat: -38.6500, lng: 146.3333 },
  "Fish Creek": { lat: -38.7000, lng: 145.9833 },
  "Meeniyan": { lat: -38.5667, lng: 145.9667 },
  "Poowong": { lat: -38.3833, lng: 145.7333 },
  "Loch": { lat: -38.3667, lng: 145.7000 },
  "Nyora": { lat: -38.3333, lng: 145.6667 },
  "Lang Lang": { lat: -38.2667, lng: 145.5667 },
  "Tooradin": { lat: -38.2167, lng: 145.3833 },
  "Blind Bight": { lat: -38.2333, lng: 145.3500 },
  "Cannons Creek": { lat: -38.2833, lng: 145.4167 },
  "Almurta": { lat: -38.3500, lng: 145.4500 },
  "Glen Forbes": { lat: -38.3833, lng: 145.5333 },
  "Cape Paterson": { lat: -38.6833, lng: 145.6333 },
  "Kilcunda": { lat: -38.5500, lng: 145.4833 },
  "Dalyston": { lat: -38.5667, lng: 145.5500 },
  "Newhaven": { lat: -38.5167, lng: 145.3500 },
  "Rhyll": { lat: -38.4667, lng: 145.3167 },
  "Ventnor": { lat: -38.4833, lng: 145.2000 },
  
  // Additional Western Victoria towns
  "Casterton": { lat: -37.5833, lng: 141.4000 },
  "Coleraine": { lat: -37.6000, lng: 141.6833 },
  "Penshurst": { lat: -37.8667, lng: 142.2833 },
  "Dunkeld": { lat: -37.6500, lng: 142.3333 },
  "Cavendish": { lat: -37.5167, lng: 142.0333 },
  "Balmoral": { lat: -37.2500, lng: 141.8333 },
  "Harrow": { lat: -36.9667, lng: 141.6000 },
  "Edenhope": { lat: -37.0333, lng: 141.3000 },
  "Apsley": { lat: -36.9833, lng: 141.0833 },
  "Goroke": { lat: -36.7333, lng: 141.4667 },
  "Kaniva": { lat: -36.3833, lng: 141.2333 },
  "Serviceton": { lat: -36.4000, lng: 140.9833 },
  "Natimuk": { lat: -36.7333, lng: 142.0000 },
  "Rupanyup": { lat: -36.6333, lng: 142.6333 },
  "Murtoa": { lat: -36.6167, lng: 142.4667 },
  "Warracknabeal": { lat: -36.2500, lng: 142.4000 },
  "Hopetoun": { lat: -35.7167, lng: 142.3500 },
  "Rainbow": { lat: -35.9000, lng: 141.9833 },
  "Jeparit": { lat: -36.1333, lng: 141.9833 },
  "Sea Lake": { lat: -35.5000, lng: 142.8500 },
  "Ouyen": { lat: -35.0667, lng: 142.3167 },
  "Murrayville": { lat: -35.2667, lng: 141.1833 },
  "Underbool": { lat: -35.1833, lng: 141.8167 },
  "Walpeup": { lat: -35.1167, lng: 142.0333 },
  "Birchip": { lat: -35.9833, lng: 142.9167 },
  "Wycheproof": { lat: -36.0667, lng: 143.2333 },
  "Charlton": { lat: -36.2667, lng: 143.3500 },
  "Donald": { lat: -36.3667, lng: 142.9833 },
  "St Arnaud": { lat: -36.6167, lng: 143.2667 },
  "Avoca": { lat: -37.0833, lng: 143.4667 },
  "Maryborough": { lat: -37.0500, lng: 143.7333 },
  "Dunolly": { lat: -36.8500, lng: 143.7333 },
  "Talbot": { lat: -37.1667, lng: 143.7167 },
  "Clunes": { lat: -37.2833, lng: 143.7833 },
  "Creswick": { lat: -37.4333, lng: 143.9000 },
  "Hepburn Springs": { lat: -37.3167, lng: 144.1333 },
  "Malmsbury": { lat: -37.2167, lng: 144.3833 },
  "Heathcote": { lat: -36.9167, lng: 144.7000 },
  "Tooborac": { lat: -37.0500, lng: 144.8000 },
  "Avenel": { lat: -36.9000, lng: 145.2333 },
  "Violet Town": { lat: -36.6333, lng: 145.7167 },
  "Strathbogie": { lat: -36.8500, lng: 145.7500 },
  "Longwood": { lat: -36.7500, lng: 145.4667 },
  "Yea": { lat: -37.2167, lng: 145.4333 },
  "Marysville": { lat: -37.5167, lng: 145.7500 },
  "Eildon": { lat: -37.2333, lng: 145.9000 },
  "Jamieson": { lat: -37.3167, lng: 146.1333 },
  "Woods Point": { lat: -37.5667, lng: 146.2667 },
  "Bonnie Doon": { lat: -37.0333, lng: 145.8667 },
  "Merton": { lat: -37.0500, lng: 145.7000 },
  
  // Additional Murray/Goulburn towns
  "Yarrawonga": { lat: -36.0167, lng: 146.0000 },
  "Mulwala": { lat: -36.0333, lng: 146.0167 },
  "Tocumwal": { lat: -35.8167, lng: 145.5667 },
  "Barooga": { lat: -35.9000, lng: 145.6833 },
  "Nathalia": { lat: -36.0500, lng: 145.2000 },
  "Strathmerton": { lat: -35.9167, lng: 145.4500 },
  "Katamatite": { lat: -36.1000, lng: 145.6833 },
  "Tatura": { lat: -36.4333, lng: 145.2333 },
  "Mooroopna": { lat: -36.3833, lng: 145.3500 },
  "Merrigum": { lat: -36.3000, lng: 145.2000 },
  "Dookie": { lat: -36.3500, lng: 145.7000 },
  "Rushworth": { lat: -36.5833, lng: 145.0167 },
  "Stanhope": { lat: -36.4500, lng: 144.9667 },
  "Girgarre": { lat: -36.3500, lng: 145.0333 },
  "Tongala": { lat: -36.2500, lng: 144.9500 },
  "Lockington": { lat: -36.3000, lng: 144.6500 },
  "Elmore": { lat: -36.5000, lng: 144.6000 },
  "Raywood": { lat: -36.5500, lng: 144.2167 },
  "Inglewood": { lat: -36.5667, lng: 143.8667 },
  "Wedderburn": { lat: -36.4333, lng: 143.6167 },
  "Korong Vale": { lat: -36.4167, lng: 143.5000 },
  "Boort": { lat: -36.1167, lng: 143.7167 },
  "Pyramid Hill": { lat: -36.0500, lng: 144.1333 },
  "Leitchville": { lat: -35.8500, lng: 144.3000 },
  "Gunbower": { lat: -35.9333, lng: 144.3667 },
  "Koondrook": { lat: -35.6333, lng: 144.1333 },
  "Barham": { lat: -35.6333, lng: 144.1333 },
  "Murrabit": { lat: -35.5333, lng: 143.9000 },
  "Lake Boga": { lat: -35.4667, lng: 143.6333 },
  "Nyah": { lat: -35.1667, lng: 143.3667 },
  "Nyah West": { lat: -35.2000, lng: 143.3667 },
  "Piangil": { lat: -35.0667, lng: 143.2500 },
  "Tooleybuc": { lat: -35.0333, lng: 143.3500 },
  "Robinvale": { lat: -34.5833, lng: 142.7667 },
  "Euston": { lat: -34.5667, lng: 142.7333 },
  "Red Cliffs": { lat: -34.3000, lng: 142.2000 },
  "Irymple": { lat: -34.2333, lng: 142.1667 },
  "Merbein": { lat: -34.1667, lng: 142.0667 },
  
  // Additional Bellarine/Surf Coast/Great Ocean Road
  "Queenscliff": { lat: -38.2667, lng: 144.6667 },
  "Point Lonsdale": { lat: -38.2833, lng: 144.6167 },
  "Pt Lonsdale": { lat: -38.2833, lng: 144.6167 },
  "Portarlington": { lat: -38.1167, lng: 144.6500 },
  "Indented Head": { lat: -38.1500, lng: 144.7167 },
  "St Leonards": { lat: -38.1667, lng: 144.7167 },
  "Clifton Springs": { lat: -38.1500, lng: 144.5667 },
  "Drysdale": { lat: -38.1667, lng: 144.5667 },
  "Leopold": { lat: -38.1833, lng: 144.4667 },
  "Barwon Heads": { lat: -38.2667, lng: 144.5000 },
  "Breamlea": { lat: -38.2833, lng: 144.4667 },
  "Connewarre": { lat: -38.2667, lng: 144.3833 },
  "Bellbrae": { lat: -38.3333, lng: 144.2833 },
  "Jan Juc": { lat: -38.3500, lng: 144.3000 },
  "Anglesea": { lat: -38.4000, lng: 144.2000 },
  "Aireys Inlet": { lat: -38.4667, lng: 144.1000 },
  "Fairhaven": { lat: -38.4833, lng: 143.9833 },
  "Moggs Creek": { lat: -38.5000, lng: 143.9500 },
  "Wye River": { lat: -38.6333, lng: 143.8833 },
  "Kennett River": { lat: -38.6667, lng: 143.8500 },
  "Skenes Creek": { lat: -38.7000, lng: 143.7333 },
  "Marengo": { lat: -38.7667, lng: 143.6500 },
  "Lavers Hill": { lat: -38.7500, lng: 143.4667 },
  "Princetown": { lat: -38.6833, lng: 143.1500 },
  "Peterborough": { lat: -38.6000, lng: 142.8833 },
  "Allansford": { lat: -38.3833, lng: 142.5833 },
  "Koroit": { lat: -38.2833, lng: 142.3667 },
  "Tower Hill": { lat: -38.3167, lng: 142.3667 },
  "Mortlake": { lat: -38.0833, lng: 142.8000 },
  "Terang": { lat: -38.2333, lng: 142.9167 },
  "Camperdown": { lat: -38.2333, lng: 143.1500 },
  "Cobden": { lat: -38.3333, lng: 143.0667 },
  "Simpson": { lat: -38.5667, lng: 143.2667 },
  "Timboon": { lat: -38.4833, lng: 143.0167 },
  "Nullawarre": { lat: -38.4500, lng: 142.7167 },
  "Panmure": { lat: -38.3167, lng: 142.7000 },
  "Dennington": { lat: -38.3500, lng: 142.4667 },
  
  // Additional High Country/Alpine
  "Mount Beauty": { lat: -36.7333, lng: 147.1667 },
  "Tawonga": { lat: -36.7167, lng: 147.1333 },
  "Harrietville": { lat: -36.8833, lng: 147.0667 },
  "Dinner Plain": { lat: -37.0333, lng: 147.2500 },
  "Hotham Heights": { lat: -36.9833, lng: 147.1500 },
  "Mt Hotham": { lat: -36.9833, lng: 147.1500 },
  "Falls Creek": { lat: -36.8667, lng: 147.2833 },
  "Mt Buller": { lat: -37.1500, lng: 146.4333 },
  "Mount Buller": { lat: -37.1500, lng: 146.4333 },
  "Merrijig": { lat: -37.1000, lng: 146.2333 },
  "Sawmill Settlement": { lat: -37.0833, lng: 146.3333 },
  "Whitfield": { lat: -36.7667, lng: 146.4167 },
  "Moyhu": { lat: -36.5833, lng: 146.3833 },
  "Oxley": { lat: -36.4500, lng: 146.4000 },
  "Milawa": { lat: -36.4500, lng: 146.4333 },
  "Everton": { lat: -36.4333, lng: 146.5333 },
  "Eldorado": { lat: -36.3167, lng: 146.5167 },
  "Chiltern": { lat: -36.1500, lng: 146.6167 },
  "Rutherglen": { lat: -36.0500, lng: 146.4667 },
  "Wahgunyah": { lat: -36.0167, lng: 146.4000 },
  "Corryong": { lat: -36.2000, lng: 147.9000 },
  "Tallangatta": { lat: -36.2167, lng: 147.1833 },
  "Mitta Mitta": { lat: -36.5333, lng: 147.3667 },
  "Dartmouth": { lat: -36.5500, lng: 147.5000 },
  "Bethanga": { lat: -36.1333, lng: 147.1167 },
  "Bellbridge": { lat: -36.1000, lng: 147.0667 },
  "Tangambalanga": { lat: -36.2500, lng: 146.9333 },
  "Yackandandah": { lat: -36.3167, lng: 146.8333 },
  "Stanley": { lat: -36.4167, lng: 146.7500 },
  
  // Additional Ballarat/Goldfields region
  "Buninyong": { lat: -37.6500, lng: 143.8833 },
  "Sebastopol": { lat: -37.6000, lng: 143.8333 },
  "Wendouree": { lat: -37.5333, lng: 143.8167 },
  "Miners Rest": { lat: -37.4833, lng: 143.8167 },
  "Learmonth": { lat: -37.4000, lng: 143.7167 },
  "Beaufort": { lat: -37.4333, lng: 143.3833 },
  "Skipton": { lat: -37.6833, lng: 143.3667 },
  "Linton": { lat: -37.6667, lng: 143.5500 },
  "Smythesdale": { lat: -37.6333, lng: 143.6833 },
  "Scarsdale": { lat: -37.6333, lng: 143.8000 },
  "Snake Valley": { lat: -37.6333, lng: 143.5833 },
  "Gordon": { lat: -37.5833, lng: 144.1167 },
  "Blackwood": { lat: -37.4667, lng: 144.3000 },
  
  // Additional Bendigo region
  "Kangaroo Flat": { lat: -36.8000, lng: 144.2333 },
  "Eaglehawk": { lat: -36.7167, lng: 144.2500 },
  "Epsom": { lat: -36.7167, lng: 144.3167 },
  "Huntly": { lat: -36.6667, lng: 144.3333 },
  "Marong": { lat: -36.7333, lng: 144.1333 },
  "Bridgewater": { lat: -36.6000, lng: 143.9500 },
  "Serpentine": { lat: -36.4667, lng: 143.9667 },
  "Fryerstown": { lat: -37.1167, lng: 144.2333 },
  "Maldon": { lat: -36.9833, lng: 144.0667 },
  "Newstead": { lat: -37.1000, lng: 144.0667 },
  "Harcourt": { lat: -36.9833, lng: 144.2667 },
  "Ravenswood": { lat: -36.8667, lng: 144.0833 },
  "Axedale": { lat: -36.7833, lng: 144.5833 },
  "Goornong": { lat: -36.6500, lng: 144.5667 },
  "Dingee": { lat: -36.3833, lng: 144.2000 },
  "Mitiamo": { lat: -36.2167, lng: 144.2333 },
  
  // Additional Geelong region
  "Lara": { lat: -38.0167, lng: 144.4167 },
  "Little River": { lat: -37.9667, lng: 144.5000 },
  "Avalon": { lat: -38.0500, lng: 144.4667 },
  "Anakie": { lat: -37.9167, lng: 144.2333 },
  "Lethbridge": { lat: -37.9667, lng: 144.1333 },
  "Bannockburn": { lat: -38.0500, lng: 144.1667 },
  "Meredith": { lat: -37.8500, lng: 144.0667 },
  "Inverleigh": { lat: -38.1000, lng: 144.0500 },
  "Winchelsea": { lat: -38.2333, lng: 143.9833 },
  "Birregurra": { lat: -38.3333, lng: 143.7833 },
  "Forrest": { lat: -38.5167, lng: 143.7167 },
  "Deans Marsh": { lat: -38.4000, lng: 143.8833 },
  "Moriac": { lat: -38.2500, lng: 144.1500 },
  "Waurn Ponds": { lat: -38.2167, lng: 144.3000 },
  "Highton": { lat: -38.2000, lng: 144.3000 },
  "Belmont": { lat: -38.1667, lng: 144.3500 },
  "Grovedale": { lat: -38.2000, lng: 144.3500 },
  "Armstrong Creek": { lat: -38.2500, lng: 144.3667 },
  "Mount Duneed": { lat: -38.2500, lng: 144.3167 },
  "Corio": { lat: -38.0833, lng: 144.3833 },
  "Norlane": { lat: -38.1000, lng: 144.3667 },
  "North Geelong": { lat: -38.1167, lng: 144.3500 },
  "Bell Park": { lat: -38.1167, lng: 144.3333 },
  "Bell Post Hill": { lat: -38.1333, lng: 144.3167 },
  "Lovely Banks": { lat: -37.9833, lng: 144.3000 },
  
  // Mornington Peninsula
  "Dromana": { lat: -38.3333, lng: 144.9667 },
  "Safety Beach": { lat: -38.3167, lng: 145.0000 },
  "Mt Martha": { lat: -38.2833, lng: 145.0333 },
  "Mount Martha": { lat: -38.2833, lng: 145.0333 },
  "Mt Eliza": { lat: -38.1833, lng: 145.0833 },
  "Mount Eliza": { lat: -38.1833, lng: 145.0833 },
  "Rosebud": { lat: -38.3500, lng: 144.9000 },
  "Rye": { lat: -38.3667, lng: 144.8333 },
  "Blairgowrie": { lat: -38.3667, lng: 144.7833 },
  "Sorrento": { lat: -38.3333, lng: 144.7500 },
  "Portsea": { lat: -38.3167, lng: 144.7167 },
  "Flinders": { lat: -38.4833, lng: 145.0167 },
  "Shoreham": { lat: -38.4333, lng: 145.0667 },
  "Red Hill": { lat: -38.3667, lng: 145.0333 },
  "Balnarring": { lat: -38.3833, lng: 145.1333 },
  "Somers": { lat: -38.3833, lng: 145.1667 },
  "Tyabb": { lat: -38.2500, lng: 145.1833 },
  "Bittern": { lat: -38.3333, lng: 145.1667 },
  "Crib Point": { lat: -38.3500, lng: 145.2000 },
  "Baxter": { lat: -38.2000, lng: 145.1500 },
  "Frankston South": { lat: -38.1500, lng: 145.1333 },
  "Seaford": { lat: -38.1000, lng: 145.1333 },
  "Carrum": { lat: -38.0833, lng: 145.1167 },
  "Bonbeach": { lat: -38.0667, lng: 145.1167 },
  "Chelsea": { lat: -38.0500, lng: 145.1167 },
  "Edithvale": { lat: -38.0333, lng: 145.1167 },
  "Aspendale": { lat: -38.0167, lng: 145.1000 },
  "Cheltenham": { lat: -37.9667, lng: 145.0500 },
  "Black Rock": { lat: -37.9667, lng: 145.0167 },
  "Hampton": { lat: -37.9333, lng: 145.0000 },
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

// Postcode to coordinates mapping for Victoria (Australian postcodes)
const POSTCODE_COORDINATES: Record<string, { lat: number; lng: number }> = {
  // Inner CBD & Close suburbs
  "3000": { lat: -37.8128, lng: 144.9633 }, // CBD
  "3001": { lat: -37.8308, lng: 144.9692 }, // Docklands
  "3002": { lat: -37.8397, lng: 144.9557 }, // Southbank
  "3003": { lat: -37.8235, lng: 144.9872 }, // St Kilda Road
  "3004": { lat: -37.8435, lng: 144.9892 }, // Melbourne
  "3006": { lat: -37.8000, lng: 144.9500 }, // West Melbourne
  "3011": { lat: -37.7800, lng: 144.8500 }, // Williamstown
  "3008": { lat: -37.7867, lng: 144.8633 }, // Southside
  // Inner suburbs - South & East
  "3181": { lat: -37.8600, lng: 145.0067 }, // Prahran
  "3182": { lat: -37.8750, lng: 145.0233 }, // South Yarra
  "3183": { lat: -37.8933, lng: 145.0400 }, // Toorak
  "3142": { lat: -37.8533, lng: 145.0100 }, // St Kilda
  "3141": { lat: -37.8667, lng: 145.0167 }, // Elsternwick
  "3144": { lat: -37.8600, lng: 145.0500 }, // Glen Waverley
  "3187": { lat: -37.8867, lng: 144.9467 }, // Albert Park
  "3205": { lat: -37.8533, lng: 144.9200 }, // Southbank
  "3207": { lat: -37.8000, lng: 144.8800 }, // Port Melbourne
  // Inner suburbs - West
  "3012": { lat: -37.8267, lng: 144.8600 }, // Spotswood
  "3014": { lat: -37.8667, lng: 144.7867 }, // Altona
  "3013": { lat: -37.8433, lng: 144.8067 }, // Footscray
  // Inner suburbs - North & NorthEast
  "3051": { lat: -37.7667, lng: 144.9667 }, // Carlton
  "3053": { lat: -37.7533, lng: 145.0167 }, // Collingwood
  "3054": { lat: -37.7667, lng: 145.0533 }, // Abbotsford
  "3068": { lat: -37.7333, lng: 145.0500 }, // Fitzroy
  "3031": { lat: -37.7300, lng: 144.9200 }, // Brunswick
  "3056": { lat: -37.7067, lng: 144.9833 }, // Thornbury
  "3070": { lat: -37.6867, lng: 145.0333 }, // Preston
  // Outer South East
  "3165": { lat: -37.9200, lng: 145.2300 }, // Mountain Gate
  "3174": { lat: -37.9500, lng: 145.3800 }, // Lilydale
  "3168": { lat: -38.0200, lng: 145.0800 }, // Dandenong
  "3175": { lat: -38.1200, lng: 145.2700 }, // Cranbourne
  "3170": { lat: -38.1500, lng: 145.3500 }, // Badger Creek
  "3806": { lat: -38.0167, lng: 145.3833 }, // Berwick
  "3805": { lat: -38.0333, lng: 145.3000 }, // Fountain Gate
  "3804": { lat: -38.0500, lng: 145.2500 }, // Narre Warren
  "3910": { lat: -38.3000, lng: 145.1500 }, // Langwarrin
  "3912": { lat: -38.3500, lng: 145.1800 }, // Somerville
  "3915": { lat: -38.3800, lng: 145.2000 }, // Hastings
  "3783": { lat: -37.8700, lng: 145.5500 }, // Gembrook
  "3810": { lat: -38.0200, lng: 145.4200 }, // Pakenham
  "3978": { lat: -37.9000, lng: 145.5200 }, // Clyde
  "3821": { lat: -38.1000, lng: 145.6000 }, // Bunyip
  "3981": { lat: -38.2500, lng: 145.6500 }, // Koo Wee Rup
  "3813": { lat: -37.9800, lng: 145.5500 }, // Tynong
  "3754": { lat: -38.1500, lng: 145.1200 }, // Frankston
  "3803": { lat: -38.3000, lng: 145.0500 }, // Mornington
  // Outer South West
  "3015": { lat: -37.9000, lng: 144.6600 }, // Werribee
  "3030": { lat: -37.9200, lng: 144.7500 }, // Laverton
  "3026": { lat: -37.8700, lng: 144.6300 }, // Docklands West
  "3032": { lat: -37.7800, lng: 144.6500 }, // Williamstown North
  // Outer West
  "3064": { lat: -37.6800, lng: 144.5800 }, // Melton
  "3038": { lat: -37.7300, lng: 144.3300 }, // Bacchus Marsh
  "3342": { lat: -37.8200, lng: 144.1500 }, // Ballan
  "3370": { lat: -37.7800, lng: 143.9500 }, // Buninyong
  "3097": { lat: -37.6500, lng: 144.4000 }, // Gisborne
  "3350": { lat: -37.5500, lng: 143.8000 }, // Ballarat
  // Outer North West
  "3341": { lat: -37.4800, lng: 144.8000 }, // Sunbury
  "3024": { lat: -37.6000, lng: 144.9000 }, // Tullamarine
  "3022": { lat: -37.5800, lng: 144.8500 }, // Essendon
  // Outer East
  "3040": { lat: -37.6700, lng: 145.3500 }, // Narre Warren East
  "3037": { lat: -37.6200, lng: 145.2000 }, // Officer
  "3134": { lat: -37.7500, lng: 145.4800 }, // Silvan
  "3161": { lat: -37.9200, lng: 145.0900 }, // Ashburton
  // Outer North East
  "3077": { lat: -37.7000, lng: 145.2500 }, // Vermont South
  "3088": { lat: -37.6500, lng: 145.3000 }, // Mount Waverley
  "3149": { lat: -37.7800, lng: 145.2000 }, // Notting Hill
  "3124": { lat: -37.8100, lng: 145.3200 }, // Mount Evelyn
  "3135": { lat: -37.8000, lng: 145.4000 }, // Sassafras
  "3957": { lat: -37.6000, lng: 144.3000 }, // Diggers Rest
};

// Victorian postcode ranges that are WITHIN 60km of Docklands (Melbourne inner/middle suburbs)
// Postcodes outside these ranges in Victoria are considered 60km+
const MELBOURNE_METRO_POSTCODES = new Set([
  // CBD and inner suburbs 3000-3010
  ...Array.from({ length: 11 }, (_, i) => String(3000 + i)),
  // Inner suburbs 3011-3100
  ...Array.from({ length: 90 }, (_, i) => String(3011 + i)),
  // Eastern suburbs 3100-3200
  ...Array.from({ length: 100 }, (_, i) => String(3100 + i)),
  // South-eastern suburbs 3800-3820 (partial - Berwick, Pakenham area is border)
  ...Array.from({ length: 15 }, (_, i) => String(3800 + i)),
]);

// State indicators for detecting interstate locations
const INTERSTATE_PATTERNS = [
  // NSW indicators
  /\bnsw\b/i, /\bnew south wales\b/i, /\bsydney\b/i,
  // QLD indicators  
  /\bqld\b/i, /\bqueensland\b/i, /\bbrisbane\b/i,
  // SA indicators
  /\bsa\b/i, /\bsouth australia\b/i, /\badelaide\b/i,
  // WA indicators
  /\bwa\b/i, /\bwestern australia\b/i, /\bperth\b/i,
  // TAS indicators
  /\btas\b/i, /\btasmania\b/i, /\bhobart\b/i,
  // NT indicators
  /\bnt\b/i, /\bnorthern territory\b/i, /\bdarwin\b/i,
  // ACT indicators
  /\bact\b/i, /\bcanberra\b/i,
];

// Interstate postcodes (not Victoria)
function isInterstatePostcode(postcode: string): boolean {
  const code = parseInt(postcode, 10);
  if (isNaN(code)) return false;
  // Victoria: 3000-3999, 8000-8999
  // NSW: 1000-2999, 2619-2899, 2921-2999
  // QLD: 4000-4999, 9000-9999
  // SA: 5000-5999
  // WA: 6000-6999
  // TAS: 7000-7999
  // NT: 0800-0899
  // ACT: 0200-0299, 2600-2618, 2900-2920
  if (code >= 3000 && code <= 3999) return false; // Victoria
  if (code >= 8000 && code <= 8999) return false; // Victoria PO Boxes
  return true; // Everything else is interstate
}

// Check if location string indicates interstate
function detectInterstate(location: string): { isInterstate: boolean; state?: string } {
  const locationLower = location.toLowerCase().trim();
  
  // Check for explicit state indicators (standalone abbreviations only - e.g., ", NSW" or "NSW ")
  // Use stricter patterns to avoid false positives (e.g., matching "sa" in "Horsham")
  if (/\bNSW\b/.test(location) || /\bnew south wales\b/i.test(location)) {
    return { isInterstate: true, state: 'NSW' };
  }
  if (/\bQLD\b/.test(location) || /\bqueensland\b/i.test(location)) {
    return { isInterstate: true, state: 'QLD' };
  }
  // SA/WA/NT require comma or space before to avoid false positives
  if (/[,\s]SA\b/.test(location) || /\bsouth australia\b/i.test(location)) {
    return { isInterstate: true, state: 'SA' };
  }
  if (/[,\s]WA\b/.test(location) || /\bwestern australia\b/i.test(location)) {
    return { isInterstate: true, state: 'WA' };
  }
  if (/\bTAS\b/.test(location) || /\btasmania\b/i.test(location)) {
    return { isInterstate: true, state: 'TAS' };
  }
  if (/[,\s]NT\b/.test(location) || /\bnorthern territory\b/i.test(location)) {
    return { isInterstate: true, state: 'NT' };
  }
  if (/\bACT\b/.test(location) || /\bcanberra\b/i.test(location)) {
    return { isInterstate: true, state: 'ACT' };
  }
  
  // Check for interstate postcodes in the location string
  const postcodeMatch = location.match(/\b(\d{4})\b/);
  if (postcodeMatch) {
    const postcode = postcodeMatch[1];
    if (isInterstatePostcode(postcode)) {
      const code = parseInt(postcode, 10);
      let state = 'Interstate';
      if (code >= 1000 && code <= 2999) state = 'NSW';
      else if (code >= 4000 && code <= 4999) state = 'QLD';
      else if (code >= 5000 && code <= 5999) state = 'SA';
      else if (code >= 6000 && code <= 6999) state = 'WA';
      else if (code >= 7000 && code <= 7999) state = 'TAS';
      else if (code >= 800 && code <= 899) state = 'NT';
      else if ((code >= 200 && code <= 299) || (code >= 2600 && code <= 2618)) state = 'ACT';
      return { isInterstate: true, state };
    }
  }
  
  // Check for known interstate cities
  const interstateCities = [
    { pattern: /\bsydney\b/i, state: 'NSW' },
    { pattern: /\bbrisbane\b/i, state: 'QLD' },
    { pattern: /\badelaide\b/i, state: 'SA' },
    { pattern: /\bperth\b/i, state: 'WA' },
    { pattern: /\bhobart\b/i, state: 'TAS' },
    { pattern: /\bdarwin\b/i, state: 'NT' },
    { pattern: /\bgold coast\b/i, state: 'QLD' },
    { pattern: /\bnewcastle\b/i, state: 'NSW' },
    { pattern: /\bwollongong\b/i, state: 'NSW' },
    { pattern: /\bcairns\b/i, state: 'QLD' },
    { pattern: /\btownsville\b/i, state: 'QLD' },
    { pattern: /\blaunceston\b/i, state: 'TAS' },
    { pattern: /\balice springs\b/i, state: 'NT' },
  ];
  
  for (const { pattern, state } of interstateCities) {
    if (pattern.test(location)) {
      return { isInterstate: true, state };
    }
  }
  
  return { isInterstate: false };
}

// Export function to check if location is interstate
export function isLocationInterstate(location: string | undefined | null): { isInterstate: boolean; state?: string } {
  if (!location) return { isInterstate: false };
  return detectInterstate(location);
}

// Get distance from Docklands for a city name or postcode
export function getDistanceFromDocklands(location: string | undefined | null): { distance: number; isOver60km: boolean; isInterstate?: boolean; state?: string } | null {
  if (!location) return null;
  
  const locationLower = location.toLowerCase().trim();
  
  // First check if interstate
  const interstateCheck = detectInterstate(location);
  if (interstateCheck.isInterstate) {
    // Return a large distance for interstate locations
    return { distance: 999, isOver60km: true, isInterstate: true, state: interstateCheck.state };
  }
  
  // Try postcode lookup first (if it's 4 digits)
  const postcodeMatch = location.match(/\b(\d{4})\b/);
  if (postcodeMatch) {
    const postcode = postcodeMatch[1];
    const coords = POSTCODE_COORDINATES[postcode];
    if (coords) {
      const distance = calculateDistanceKm(DOCKLANDS_COORDS.lat, DOCKLANDS_COORDS.lng, coords.lat, coords.lng);
      return { distance: Math.round(distance), isOver60km: distance > 60 };
    }
    // If Victorian postcode but not in our detailed list, check if in metro area
    const code = parseInt(postcode, 10);
    if (code >= 3000 && code <= 3999) {
      // Check if it's in the Melbourne metro set (within 60km)
      if (MELBOURNE_METRO_POSTCODES.has(postcode)) {
        return { distance: 30, isOver60km: false }; // Approximate metro distance
      } else {
        // Victorian postcode but outside metro - flag as over 60km
        return { distance: 80, isOver60km: true }; // Approximate regional distance
      }
    }
  }
  
  // Try to find a matching city (case-insensitive, partial match)
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
    available: "border-green-300 bg-green-500/10 text-green-700 dark:border-green-700 dark:text-green-400",
    assigned: "border-blue-300 bg-blue-500/10 text-blue-700 dark:border-blue-700 dark:text-blue-400",
    invited: "border-purple-300 bg-purple-500/10 text-purple-700 dark:border-purple-700 dark:text-purple-400",
    confirmed: "border-sky-300 bg-sky-500/10 text-sky-700 dark:border-sky-700 dark:text-sky-400",
    reschedule: "border-red-400 bg-red-900/10 text-red-900 dark:border-red-700 dark:text-red-400",
    rescheduled: "border-red-400 bg-red-900/10 text-red-900 dark:border-red-700 dark:text-red-400",
  };
  
  const colorClasses = colors[status.toLowerCase()] || colors.available;
  
  // Display "reschedule" instead of "rescheduled" for consistency
  const displayStatus = status.toLowerCase() === "rescheduled" ? "reschedule" : status;
  
  return (
    <span className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${colorClasses}`}>
      {displayStatus}
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
  paperworkStatusMap = new Map(),
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
  
  // Sorting state: column name and direction (asc, desc, or null for original order)
  type SortDirection = 'asc' | 'desc' | null;
  type SortColumn = 'status' | 'auditionRating' | 'age' | 'name' | 'phone' | 'email' | 'attendingWith' | 'groupSize' | 'location' | 'medicalInfo' | 'mobilityNotes' | 'criminalRecord' | null;
  const [sortColumn, setSortColumn] = useState<SortColumn>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const tableFileInputRef = useRef<HTMLInputElement>(null);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const dialogContentRef = useRef<HTMLDivElement>(null);
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
    // Use shared parser for consistent partner name extraction
    if (contestantDetails.attendingWith) {
      // Check if this is a solo contestant using shared parser
      if (isSoloContestant(contestantDetails.attendingWith)) {
        return [];
      }
      
      const partnerNamesList = getPartnerNames(contestantDetails.attendingWith);
      if (partnerNamesList.length === 0) {
        return [];
      }
      
      // Find people this person is attending with
      const groupMemberSet = new Set<string>([contestantDetails.id]);
      
      contestantPool.forEach(c => {
        if (c.id === contestantDetails.id) return;
        
        // Check if this person's name is in the selected contestant's attendingWith
        if (attendingWithMentionsName(contestantDetails.attendingWith, c.name)) {
          groupMemberSet.add(c.id);
        }
        
        // Check if selected contestant's name is in this person's attendingWith
        if (attendingWithMentionsName(c.attendingWith, contestantDetails.name)) {
          groupMemberSet.add(c.id);
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
  
  // Photo lightbox state (for viewing larger photo when not in edit mode)
  const [showPhotoLightbox, setShowPhotoLightbox] = useState(false);

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
        availabilityStatus: contestantDetails.availabilityStatus || 'available',
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
      // Scroll DialogContent to top when dialog opens - use setTimeout to ensure DOM is ready
      const scrollToTop = () => {
        if (dialogContentRef.current) {
          dialogContentRef.current.scrollTop = 0;
        }
      };
      // Use multiple timing approaches for reliability
      scrollToTop();
      requestAnimationFrame(scrollToTop);
      setTimeout(scrollToTop, 0);
      setTimeout(scrollToTop, 50);
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
        availabilityStatus: contestantDetails.availabilityStatus || 'available',
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

  // Handle column header click for sorting (cycles: asc → desc → original)
  const handleSort = (column: SortColumn) => {
    if (sortColumn !== column) {
      // New column clicked - start with ascending
      setSortColumn(column);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      // Same column, was ascending - switch to descending
      setSortDirection('desc');
    } else if (sortDirection === 'desc') {
      // Same column, was descending - reset to original order
      setSortColumn(null);
      setSortDirection(null);
    } else {
      // Was null, start with ascending
      setSortDirection('asc');
    }
  };

  // Get sort icon for a column
  const getSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) {
      return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
    }
    if (sortDirection === 'asc') {
      return <ArrowUp className="ml-1 h-3 w-3" />;
    }
    if (sortDirection === 'desc') {
      return <ArrowDown className="ml-1 h-3 w-3" />;
    }
    return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
  };

  // Sort the filtered contestants
  const sortedContestants = useMemo(() => {
    if (!sortColumn || !sortDirection) {
      return filteredContestants;
    }

    return [...filteredContestants].sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case 'status':
          aVal = a.availabilityStatus || '';
          bVal = b.availabilityStatus || '';
          break;
        case 'auditionRating':
          // Sort ratings: A+ > A > B > C > D > DNU > P > empty
          const ratingOrder: Record<string, number> = { 'A+': 1, 'A': 2, 'B': 3, 'C': 4, 'D': 5, 'DNU': 6, 'P': 7 };
          aVal = ratingOrder[a.auditionRating || ''] || 99;
          bVal = ratingOrder[b.auditionRating || ''] || 99;
          break;
        case 'age':
          aVal = a.age || 0;
          bVal = b.age || 0;
          break;
        case 'name':
          aVal = (a.name || '').toLowerCase();
          bVal = (b.name || '').toLowerCase();
          break;
        case 'phone':
          aVal = (a.phone || '').toLowerCase();
          bVal = (b.phone || '').toLowerCase();
          break;
        case 'email':
          aVal = (a.email || '').toLowerCase();
          bVal = (b.email || '').toLowerCase();
          break;
        case 'attendingWith':
          aVal = (a.attendingWith || '').toLowerCase();
          bVal = (b.attendingWith || '').toLowerCase();
          break;
        case 'groupSize':
          aVal = a.groupSize || 0;
          bVal = b.groupSize || 0;
          break;
        case 'location':
          aVal = (a.location || '').toLowerCase();
          bVal = (b.location || '').toLowerCase();
          break;
        case 'medicalInfo':
          aVal = (a.medicalInfo || '').toLowerCase();
          bVal = (b.medicalInfo || '').toLowerCase();
          break;
        case 'mobilityNotes':
          aVal = (a.mobilityNotes || '').toLowerCase();
          bVal = (b.mobilityNotes || '').toLowerCase();
          break;
        case 'criminalRecord':
          aVal = (a.criminalRecord || '').toLowerCase();
          bVal = (b.criminalRecord || '').toLowerCase();
          break;
        default:
          return 0;
      }

      // Compare values
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredContestants, sortColumn, sortDirection]);

  const handleToggleAll = () => {
    if (!onSelectionChange) return;
    
    if (selectedIds.length === sortedContestants.length) {
      onSelectionChange([]);
    } else {
      onSelectionChange(sortedContestants.map(c => c.id));
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

  const allSelected = sortedContestants.length > 0 && selectedIds.length === sortedContestants.length;

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
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('status')}
                data-testid="sort-status"
              >
                <div className="flex items-center">Status{getSortIcon('status')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('auditionRating')}
                data-testid="sort-audition-rating"
              >
                <div className="flex items-center">Audition Rating{getSortIcon('auditionRating')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('age')}
                data-testid="sort-age"
              >
                <div className="flex items-center">Age{getSortIcon('age')}</div>
              </TableHead>
              <TableHead 
                className="min-w-[150px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('name')}
                data-testid="sort-name"
              >
                <div className="flex items-center">Name{getSortIcon('name')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('phone')}
                data-testid="sort-mobile"
              >
                <div className="flex items-center">Mobile{getSortIcon('phone')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('email')}
                data-testid="sort-email"
              >
                <div className="flex items-center">Email{getSortIcon('email')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('attendingWith')}
                data-testid="sort-attending-with"
              >
                <div className="flex items-center">Attending With{getSortIcon('attendingWith')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('groupSize')}
                data-testid="sort-group-size"
              >
                <div className="flex items-center">Group Size{getSortIcon('groupSize')}</div>
              </TableHead>
              <TableHead 
                className="cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('location')}
                data-testid="sort-city"
              >
                <div className="flex items-center">City{getSortIcon('location')}</div>
              </TableHead>
              <TableHead 
                className="max-w-[150px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('medicalInfo')}
                data-testid="sort-medical-app"
              >
                <div className="flex items-center">Medical - App{getSortIcon('medicalInfo')}</div>
              </TableHead>
              <TableHead 
                className="max-w-[150px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('mobilityNotes')}
                data-testid="sort-medical-aud"
              >
                <div className="flex items-center">Medical - Aud{getSortIcon('mobilityNotes')}</div>
              </TableHead>
              <TableHead 
                className="max-w-[150px] cursor-pointer select-none hover:bg-muted/50"
                onClick={() => handleSort('criminalRecord')}
                data-testid="sort-criminal"
              >
                <div className="flex items-center">Criminal{getSortIcon('criminalRecord')}</div>
              </TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedContestants.map((contestant) => {
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
                  <TableCell className="space-x-2 flex items-center flex-wrap gap-1">
                    <StatusBadge status={rescheduleContestantIds.has(contestant.id) ? "Reschedule" : contestant.availabilityStatus} />
                    {standbyContestantIds.has(contestant.id) && (
                      <Badge variant="outline" className="border-yellow-300 bg-yellow-500/20 text-yellow-800 dark:border-yellow-700 dark:text-yellow-400">
                        Standby
                      </Badge>
                    )}
                    {paperworkStatusMap.get(contestant.id)?.status === 'received' && (
                      <Badge variant="outline" className="border-teal-300 bg-teal-500/20 text-teal-800 dark:border-teal-700 dark:text-teal-400 text-xs px-1.5" title="Paperwork received" data-testid={`badge-paperwork-${contestant.id}`}>
                        <FileCheck className="h-3 w-3" />
                      </Badge>
                    )}
                    {paperworkStatusMap.get(contestant.id)?.status === 'sent' && (
                      <Badge variant="outline" className="border-orange-300 bg-orange-500/20 text-orange-700 dark:border-orange-700 dark:text-orange-400 text-xs px-1.5" title="Paperwork sent, awaiting return" data-testid={`badge-paperwork-sent-${contestant.id}`}>
                        <FileCheck className="h-3 w-3" />
                      </Badge>
                    )}
                    {contestant.podiumStory && (
                      <Badge variant="outline" className="border-purple-300 bg-purple-500/20 text-purple-800 dark:border-purple-700 dark:text-purple-400 text-xs px-1.5">
                        PS
                      </Badge>
                    )}
                    {contestant.availableForStandby && (
                      <Badge variant="outline" className="border-amber-300 bg-amber-500/20 text-amber-800 dark:border-amber-700 dark:text-amber-400 text-xs px-1.5">
                        S
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
                        contestant.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' :
                        contestant.auditionRating === 'P' ? 'text-purple-600 dark:text-purple-400' : ''
                      }`}>
                        {contestant.auditionRating}
                      </span>
                    ) : "-"}
                  </TableCell>
                  <TableCell>{contestant.age}</TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-1">
                      {contestant.name}
                      {contestant.isTemporary && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-700">
                          TEMP
                        </Badge>
                      )}
                      {(contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(contestant.name)) && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700">
                          TEST
                        </Badge>
                      )}
                    </div>
                  </TableCell>
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
                  <TableCell className="max-w-[150px] truncate text-xs" title={contestant.medicalInfo || ""}>
                    {contestant.medicalInfo || "-"}
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate text-xs" title={contestant.mobilityNotes || ""}>
                    {contestant.mobilityNotes || "-"}
                  </TableCell>
                  <TableCell className="max-w-[150px] truncate text-xs" title={contestant.criminalRecord || ""}>
                    {contestant.criminalRecord || "-"}
                  </TableCell>
                  <TableCell className="p-1">
                    {(contestant.isTestSubject || ['Peter Adamidis', 'Kathleen Reynolds'].includes(contestant.name)) && onDeleteContestant && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Remove test subject ${contestant.name}?`)) {
                            onDeleteContestant(contestant.id);
                          }
                        }}
                        title="Remove test subject"
                        data-testid={`button-delete-test-subject-${contestant.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Contestant Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent ref={dialogContentRef} className="max-w-4xl flex flex-col h-[90vh]" data-testid="dialog-contestant-details">
          <DialogHeader className="pb-2 flex-shrink-0">
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
            <>
              <div ref={contentScrollRef} className="flex-1 overflow-y-auto min-h-0">
                {isEditMode ? (
                  <div className="space-y-6 pr-4">
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
                            <SelectItem value="P">P</SelectItem>
                            <SelectItem value="DNU">DNU (Do Not Use)</SelectItem>
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
                    <div className="grid grid-cols-4 gap-2">
                      <div className="space-y-1 col-span-1">
                        <Label htmlFor="edit-status" className="text-xs flex items-center gap-1">
                          Status
                          <span className="text-[10px] text-amber-600 dark:text-amber-400">(Manual)</span>
                        </Label>
                        <Select 
                          value={editFormData.availabilityStatus || ''} 
                          onValueChange={(value) => handleEditFormChange('availabilityStatus', value)}
                        >
                          <SelectTrigger data-testid="select-edit-status" className="h-8 text-xs">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="available">Available</SelectItem>
                            <SelectItem value="assigned">Assigned</SelectItem>
                            <SelectItem value="invited">Invited</SelectItem>
                            <SelectItem value="confirmed">Confirmed</SelectItem>
                            <SelectItem value="rescheduled">Reschedule</SelectItem>
                            <SelectItem value="returning_standby">Returning Standby</SelectItem>
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
                        <Label htmlFor="edit-medical" className="text-xs">Medical - App</Label>
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
                        <Label htmlFor="edit-mobility" className="text-xs">Medical - Aud</Label>
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
                    <div className="grid grid-cols-2 gap-2">
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
                      <div className="space-y-1">
                        <Label htmlFor="edit-availability" className="text-xs">Availability</Label>
                        <Textarea
                          id="edit-availability"
                          value={editFormData.availabilityNotes || ''}
                          onChange={(e) => handleEditFormChange('availabilityNotes', e.target.value)}
                          rows={2}
                          data-testid="input-edit-availability"
                          className="text-xs"
                          placeholder="Enter availability notes..."
                        />
                      </div>
                    </div>
                  </div>
                </div>

                  </div>
                ) : (
                  <div className="space-y-3 pr-4">
                {/* Photo and Basic Info Header */}
                <div className="flex gap-4">
                  {/* Photo Section - Compact (click to view larger) */}
                  <div className="flex flex-col items-center gap-1">
                    <div 
                      className="relative group cursor-pointer"
                      onClick={() => contestantDetails.photoUrl && setShowPhotoLightbox(true)}
                    >
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
                      {contestantDetails.photoUrl && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30 rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                          <Search className="h-4 w-4 text-white" />
                        </div>
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
                          {contestantDetails.podiumStory && (
                            <Badge variant="outline" className="border-purple-300 bg-purple-500/20 text-purple-800 dark:border-purple-700 dark:text-purple-400 text-xs py-0">
                              Podium Story
                            </Badge>
                          )}
                          {contestantDetails.availableForStandby && (
                            <Badge variant="outline" className="border-amber-300 bg-amber-500/20 text-amber-800 dark:border-amber-700 dark:text-amber-400 text-xs py-0">
                              Available for Standby
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground">Rating</label>
                        {contestantDetails.auditionRating?.toUpperCase().trim() === 'DNU' ? (
                          <Badge variant="destructive" className="text-xs font-bold">
                            DNU
                          </Badge>
                        ) : (
                          <p className={`text-sm font-semibold ${
                            contestantDetails.auditionRating === 'A+' ? 'text-emerald-600 dark:text-emerald-400' :
                            contestantDetails.auditionRating === 'A' ? 'text-green-600 dark:text-green-400' :
                            contestantDetails.auditionRating === 'B+' ? 'text-amber-600 dark:text-amber-400' :
                            contestantDetails.auditionRating === 'B' ? 'text-orange-600 dark:text-orange-400' :
                            contestantDetails.auditionRating === 'C' ? 'text-red-500 dark:text-red-400' :
                            contestantDetails.auditionRating === 'P' ? 'text-purple-600 dark:text-purple-400' : 'text-muted-foreground'
                          }`}>
                            {contestantDetails.auditionRating || '-'}
                          </p>
                        )}
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

                {/* Seat Assignments - List all appearances */}
                {(() => {
                  // Find all assignments for this contestant across all record days
                  const allAssignments = Array.from(seatAssignmentMap.values()).filter(
                    (a: any) => a.contestantId === selectedContestantId
                  );
                  
                  if (allAssignments.length === 0) return null;

                  return (
                    <div className="space-y-2">
                      {allAssignments.map((assignment: any) => {
                        const rd = recordDays.find(rd => rd.id === assignment.recordDayId);
                        const blockType = blockTypes.find(bt => bt.recordDayId === assignment.recordDayId && bt.blockNumber === assignment.blockNumber);
                        
                        return (
                          <div key={assignment.id} className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-md px-3 py-2">
                            <div className="flex items-center gap-6">
                              <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                                <Calendar className="h-4 w-4" />
                                <span className="text-xs font-semibold uppercase">Seat Assignment</span>
                              </div>
                              <div className="flex items-center gap-4 text-sm">
                                <span><span className="text-xs text-muted-foreground mr-1">Day:</span><span className="font-medium">{rd ? new Date(rd.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : 'Unknown'}</span></span>
                                <span className="flex items-center gap-1.5">
                                  <span className="text-xs text-muted-foreground">Block:</span>
                                  <span className="font-medium">{assignment.blockNumber}</span>
                                  {blockType && (
                                    <Badge 
                                      variant="outline" 
                                      className={`text-xs py-0 px-1.5 ${
                                        blockType.blockType === 'PB' 
                                          ? 'border-emerald-300 bg-emerald-500/20 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400' 
                                          : 'border-slate-300 bg-slate-500/20 text-slate-700 dark:border-slate-600 dark:text-slate-400'
                                      }`}
                                    >
                                      {blockType.blockType}
                                    </Badge>
                                  )}
                                </span>
                                <span><span className="text-xs text-muted-foreground mr-1">Seat:</span><span className="font-mono font-medium text-green-600 dark:text-green-400">{String(assignment.blockNumber).padStart(2, '0')}-{assignment.seatLabel}</span></span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Paperwork Status */}
                {contestantDetails && paperworkStatusMap.get(contestantDetails.id) && (
                  <div className={`rounded-md px-3 py-2 ${
                    paperworkStatusMap.get(contestantDetails.id)?.status === 'received' 
                      ? 'bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800' 
                      : 'bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-800'
                  }`}>
                    <div className="flex items-center gap-2">
                      <FileCheck className={`h-4 w-4 ${
                        paperworkStatusMap.get(contestantDetails.id)?.status === 'received' 
                          ? 'text-teal-700 dark:text-teal-400' 
                          : 'text-orange-700 dark:text-orange-400'
                      }`} />
                      <span className={`text-sm font-medium ${
                        paperworkStatusMap.get(contestantDetails.id)?.status === 'received' 
                          ? 'text-teal-700 dark:text-teal-400' 
                          : 'text-orange-700 dark:text-orange-400'
                      }`}>
                        {paperworkStatusMap.get(contestantDetails.id)?.status === 'received' 
                          ? `Paperwork completed on ${paperworkStatusMap.get(contestantDetails.id)?.receivedAt 
                              ? new Date(paperworkStatusMap.get(contestantDetails.id)!.receivedAt!).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) 
                              : 'unknown date'}`
                          : `Paperwork sent on ${paperworkStatusMap.get(contestantDetails.id)?.sentAt 
                              ? new Date(paperworkStatusMap.get(contestantDetails.id)!.sentAt!).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) 
                              : 'unknown date'}`
                        }
                      </span>
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
                      {contestantDetails.postcode && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Postcode:</span>
                          <span>{contestantDetails.postcode}</span>
                          {contestantDetails.state && (
                            <span className="text-xs text-muted-foreground">{contestantDetails.state}</span>
                          )}
                        </div>
                      )}
                      {!contestantDetails.email && !contestantDetails.phone && !contestantDetails.location && !contestantDetails.postcode && (
                        <p className="text-muted-foreground italic text-xs">No contact info</p>
                      )}
                    </div>
                  </div>

                  {/* Medical Information */}
                  <div className="space-y-1">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Medical</h3>
                    <div className="space-y-1 text-sm">
                      <div>
                        <span className="text-xs text-muted-foreground">App: </span>
                        <span className={contestantDetails.medicalInfo ? '' : 'text-muted-foreground italic'}>
                          {contestantDetails.medicalInfo || 'None'}
                        </span>
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">Aud: </span>
                        <span className={contestantDetails.mobilityNotes ? '' : 'text-muted-foreground italic'}>
                          {contestantDetails.mobilityNotes || 'None'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Criminal Record & Availability - 2 columns */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Criminal Record</h3>
                    <p className={`text-sm ${contestantDetails.criminalRecord ? '' : 'text-muted-foreground italic'}`}>
                      {contestantDetails.criminalRecord || 'No information provided'}
                    </p>
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Availability</h3>
                    <p className={`text-sm ${contestantDetails.availabilityNotes ? '' : 'text-muted-foreground italic'}`}>
                      {contestantDetails.availabilityNotes || 'No availability notes'}
                    </p>
                  </div>
                </div>
                  </div>
                )}
              </div>
              
              {/* Footer - Sticky at bottom */}
              {isEditMode && (
                <DialogFooter className="gap-2 flex-shrink-0 border-t pt-4 mt-4">
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
              )}
              
              {!isEditMode && (
                <div className="flex justify-end gap-2 border-t bg-background pt-4 pb-4 flex-shrink-0">
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
              )}
            </>
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

      {/* Photo Lightbox Dialog - shows larger photo when clicked outside edit mode */}
      <Dialog open={showPhotoLightbox} onOpenChange={setShowPhotoLightbox}>
        <DialogContent className="sm:max-w-2xl p-4">
          <DialogHeader className="sr-only">
            <DialogTitle>Photo View</DialogTitle>
            <DialogDescription>Contestant photo enlarged view</DialogDescription>
          </DialogHeader>
          {contestantDetails?.photoUrl && (
            <div className="flex items-center justify-center">
              <img 
                src={contestantDetails.photoUrl} 
                alt={contestantDetails.name || 'Contestant'} 
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                data-testid="img-photo-lightbox"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
