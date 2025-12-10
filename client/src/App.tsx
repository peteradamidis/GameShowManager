import { Switch, Route, useLocation } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LogOut } from "lucide-react";
import Dashboard from "@/pages/dashboard";
import Contestants from "@/pages/contestants";
import RecordDays from "@/pages/record-days";
import SeatingChartPage from "@/pages/seating-chart-page";
import BookingMaster from "@/pages/booking-master";
import BookingResponses from "@/pages/booking-responses";
import AvailabilityManagement from "@/pages/availability-management";
import StandbysPage from "@/pages/standbys";
import ReschedulePage from "@/pages/reschedule";
import WinnersPage from "@/pages/winners";
import FormsPage from "@/pages/forms";
import Settings from "@/pages/settings";
import Backup from "@/pages/backup";
import AvailabilityResponsePage from "@/pages/availability-response-page";
import BookingConfirmationPage from "@/pages/booking-confirmation-page";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import logoImage from "@assets/6b13f568-ecb4-421a-8c1d-6edbe0b1a6c7_1764305481833.png";

interface AuthCheckResponse {
  authenticated: boolean;
  user?: { id: string; username: string };
}

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
      <Route path="/winners" component={WinnersPage} />
      <Route path="/forms" component={FormsPage} />
      <Route path="/settings" component={Settings} />
      <Route path="/backup" component={Backup} />
      <Route path="/availability/respond/:token" component={AvailabilityResponsePage} />
      <Route path="/booking-confirmation/:token" component={BookingConfirmationPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const { data: authData, refetch: refetchAuth, isLoading } = useQuery<AuthCheckResponse>({
    queryKey: ["/api/auth/check"],
    staleTime: 5 * 60 * 1000,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/logout", {});
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "Signed out",
        description: "You have been signed out successfully",
      });
      refetchAuth();
    },
  });

  const [location] = useLocation();
  const isPublicRoute = location.startsWith('/availability/respond/') || location.startsWith('/booking-confirmation/');
  
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (isPublicRoute) {
    return (
      <>
        <Router />
        <Toaster />
      </>
    );
  }

  if (!authData?.authenticated) {
    return (
      <>
        <Login onLoginSuccess={() => refetchAuth()} />
        <Toaster />
      </>
    );
  }

  return (
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
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {authData.user?.username}
              </span>
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                data-testid="button-logout"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-6">
            <Router />
          </main>
        </div>
      </div>
      <Toaster />
    </SidebarProvider>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthenticatedApp />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
