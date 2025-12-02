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
import BookingMaster from "@/pages/booking-master";
import BookingResponses from "@/pages/booking-responses";
import AvailabilityManagement from "@/pages/availability-management";
import StandbysPage from "@/pages/standbys";
import ReschedulePage from "@/pages/reschedule";
import Settings from "@/pages/settings";
import AvailabilityResponsePage from "@/pages/availability-response-page";
import BookingConfirmationPage from "@/pages/booking-confirmation-page";
import EmailAssetsPage from "@/pages/email-assets";
import NotFound from "@/pages/not-found";
import logoImage from "@assets/6b13f568-ecb4-421a-8c1d-6edbe0b1a6c7_1764305481833.png";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/contestants" component={Contestants} />
      <Route path="/record-days" component={RecordDays} />
      <Route path="/seating-chart" component={SeatingChartPage} />
      <Route path="/booking-master" component={BookingMaster} />
      <Route path="/booking-responses" component={BookingResponses} />
      <Route path="/availability" component={AvailabilityManagement} />
      <Route path="/standbys" component={StandbysPage} />
      <Route path="/reschedule" component={ReschedulePage} />
      <Route path="/settings" component={Settings} />
      <Route path="/email-assets" component={EmailAssetsPage} />
      <Route path="/availability/respond/:token" component={AvailabilityResponsePage} />
      <Route path="/booking-confirmation/:token" component={BookingConfirmationPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  const [location] = useLocation();
  const isPublicRoute = location.startsWith('/availability/respond/') || location.startsWith('/booking-confirmation/');
  
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
                  <div className="flex items-center gap-3">
                    <img src={logoImage} alt="Deal or No Deal" className="h-12" />
                    <h2 className="text-lg font-semibold">Deal or No Deal Contestant Manager</h2>
                  </div>
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
