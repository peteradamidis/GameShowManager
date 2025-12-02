import { Home, Users, Calendar, LayoutGrid, Settings, CheckSquare, RefreshCcw, ClipboardList, UserCheck, MessageSquareText, Image } from "lucide-react";
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
    title: "Booking Responses",
    url: "/booking-responses",
    icon: MessageSquareText,
  },
  {
    title: "Reschedule",
    url: "/reschedule",
    icon: RefreshCcw,
  },
  {
    title: "Email Assets",
    url: "/email-assets",
    icon: Image,
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings,
  },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Deal or No Deal</SidebarGroupLabel>
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
  );
}
