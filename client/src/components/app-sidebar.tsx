import { Home, Users, Calendar, LayoutGrid, Settings, CheckSquare, RefreshCcw, ClipboardList, UserCheck, MessageSquareText, FileText, Trophy, AlertTriangle, Star, Megaphone, FileCheck2, History, ArrowLeftRight, Loader2, Mic2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
  },
  {
    title: "Noticeboard",
    url: "/noticeboard",
    icon: Megaphone,
  },
  {
    title: "Contestants",
    url: "/contestants",
    icon: Users,
  },
  {
    title: "Availability",
    url: "/availability",
    icon: CheckSquare,
  },
  {
    title: "Record Days",
    url: "/record-days",
    icon: Calendar,
  },
  {
    title: "Seating Chart",
    url: "/seating-chart",
    icon: LayoutGrid,
  },
  {
    title: "Booking Master",
    url: "/booking-master",
    icon: ClipboardList,
  },
  {
    title: "Players",
    url: "/players",
    icon: Star,
  },
  {
    title: "Standbys",
    url: "/standbys",
    icon: UserCheck,
  },
  {
    title: "Booking Tracker",
    url: "/booking-responses",
    icon: MessageSquareText,
  },
  {
    title: "Paperwork Tracker",
    url: "/paperwork",
    icon: FileText,
  },
  {
    title: "Reschedule",
    url: "/reschedule",
    icon: RefreshCcw,
  },
  {
    title: "Winners",
    url: "/winners",
    icon: Trophy,
  },
  {
    title: "Podium Stories",
    url: "/podium-stories",
    icon: Mic2,
  },
  {
    title: "Attendance Issues",
    url: "/attendance-issues",
    icon: AlertTriangle,
  },
  {
    title: "Post Record",
    url: "/post-record",
    icon: FileCheck2,
  },
  {
    title: "History",
    url: "/history",
    icon: History,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: workspaceData } = useQuery<{ workspace: string }>({
    queryKey: ['/api/workspace'],
    staleTime: Infinity,
  });

  const activeWorkspace = workspaceData?.workspace || 'dond';
  const isCeleb = activeWorkspace === 'celeb';

  const switchMutation = useMutation({
    mutationFn: async (workspace: string) => {
      const res = await apiRequest('POST', '/api/workspace/switch', { workspace });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['/api/workspace'], { workspace: data.workspace });
      queryClient.clear();
      queryClient.setQueryData(['/api/workspace'], { workspace: data.workspace });
      toast({
        title: `Switched to ${data.workspace === 'celeb' ? 'DOND CELEB' : 'DOND'}`,
        description: data.workspace === 'celeb'
          ? 'You are now viewing the DOND CELEB workspace — a separate clean database.'
          : 'You are back to the main DOND workspace.',
      });
    },
    onError: () => {
      toast({ title: 'Failed to switch workspace', variant: 'destructive' });
    },
  });

  const handleSwitch = () => {
    const target = isCeleb ? 'dond' : 'celeb';
    switchMutation.mutate(target);
  };

  return (
    <Sidebar>
      <SidebarHeader className="border-b">
        <div className="px-1 py-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-1.5 font-medium">
            Active Workspace
          </div>
          <div className="flex items-center justify-between gap-2">
            <Badge
              data-testid="badge-active-workspace"
              className={
                isCeleb
                  ? "bg-purple-600 hover:bg-purple-600 text-white text-xs px-2 py-0.5 shrink-0"
                  : "bg-blue-600 hover:bg-blue-600 text-white text-xs px-2 py-0.5 shrink-0"
              }
            >
              {isCeleb ? 'DOND CELEB' : 'DOND'}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSwitch}
              disabled={switchMutation.isPending}
              data-testid="button-switch-workspace"
              className="h-7 text-xs gap-1 shrink-0"
            >
              {switchMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <ArrowLeftRight className="h-3 w-3" />
              )}
              Switch
            </Button>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            {isCeleb ? 'DOND CELEB' : 'Deal or No Deal'}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(' ', '-')}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {isCeleb && (
        <SidebarFooter className="border-t">
          <div className="px-1 py-2">
            <div className="rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 px-3 py-2">
              <p className="text-xs font-medium text-purple-700 dark:text-purple-300">DOND CELEB</p>
              <p className="text-xs text-purple-600/80 dark:text-purple-400/80 mt-0.5">Separate clean database</p>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
