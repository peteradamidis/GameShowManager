import { Home, Users, Calendar, LayoutGrid, Settings, CheckSquare, RefreshCcw, ClipboardList } from "lucide-react";
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
    title: "Reschedule",
    url: "/reschedule",
    icon: RefreshCcw,
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
          <SidebarGroupLabel>TV Game Show Manager</SidebarGroupLabel>
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
