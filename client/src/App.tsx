import { Switch, Route, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import Dashboard from "@/pages/dashboard";
import Contestants from "@/pages/contestants";
import RecordDays from "@/pages/record-days";
import SeatingChartPage from "@/pages/seating-chart-page";
import AvailabilityManagement from "@/pages/availability-management";
import ReschedulePage from "@/pages/reschedule";
import Settings from "@/pages/settings";
import AvailabilityResponsePage from "@/pages/availability-response-page";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/contestants" component={Contestants} />
      <Route path="/record-days" component={RecordDays} />
      <Route path="/seating-chart" component={SeatingChartPage} />
      <Route path="/availability" component={AvailabilityManagement} />
      <Route path="/reschedule" component={ReschedulePage} />
      <Route path="/settings" component={Settings} />
      <Route path="/availability/respond/:token" component={AvailabilityResponsePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [location] = useLocation();
  const isPublicRoute = location.startsWith('/availability/respond/');
  
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        {isPublicRoute ? (
          <>
            <Router />
            <Toaster />
          </>
        ) : (
          <SidebarProvider style={style as React.CSSProperties}>
            <div className="flex h-screen w-full">
              <AppSidebar />
              <div className="flex flex-col flex-1 overflow-hidden">
                <header className="flex items-center justify-between p-4 border-b">
                  <SidebarTrigger data-testid="button-sidebar-toggle" />
                  <h2 className="text-lg font-semibold">TV Game Show Contestant Manager</h2>
                  <div className="w-9"></div>
                </header>
                <main className="flex-1 overflow-auto p-6">
                  <Router />
                </main>
              </div>
            </div>
            <Toaster />
          </SidebarProvider>
        )}
      </TooltipProvider>
    </QueryClientProvider>
  );
}
