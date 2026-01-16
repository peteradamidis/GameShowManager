import { useState, useCallback } from "react";
import { Home, Users, Calendar, LayoutGrid, Settings, CheckSquare, RefreshCcw, ClipboardList, UserCheck, MessageSquareText, FileText, Trophy, AlertTriangle, DollarSign } from "lucide-react";
import { Link, useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { MoneyRain } from "./money-rain";

const menuItems = [
  {
    title: "Dashboard",
    url: "/",
    icon: Home,
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
    title: "Standbys",
    url: "/standbys",
    icon: UserCheck,
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
    title: "Attendance Issues",
    url: "/attendance-issues",
    icon: AlertTriangle,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();
  const [showMoneyRain, setShowMoneyRain] = useState(false);

  const handleLogoClick = useCallback(() => {
    if (!showMoneyRain) {
      setShowMoneyRain(true);
    }
  }, [showMoneyRain]);

  const handleMoneyRainComplete = useCallback(() => {
    setShowMoneyRain(false);
  }, []);

  return (
    <>
      <MoneyRain isActive={showMoneyRain} onComplete={handleMoneyRainComplete} />
      <Sidebar>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel 
              onClick={handleLogoClick}
              className="cursor-pointer hover:text-primary transition-colors select-none flex items-center gap-1.5"
              data-testid="button-logo-easter-egg"
            >
              <DollarSign className="h-4 w-4 text-green-500" />
              Deal or No Deal
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
    </Sidebar>
    </>
  );
}
