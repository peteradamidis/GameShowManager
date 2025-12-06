import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Download, Database, Users, Calendar, HardDrive, RefreshCw } from "lucide-react";
import { useState } from "react";

type BackupSummary = {
  recordDays: number;
  contestants: number;
  groups: number;
  seatAssignments: number;
  standbys: number;
  canceledAssignments: number;
  lastBackup: string | null;
};

export default function Backup() {
  const { toast } = useToast();
  const [isDownloading, setIsDownloading] = useState(false);

  const { data: summary, isLoading, refetch } = useQuery<BackupSummary>({
    queryKey: ['/api/backup/summary'],
  });

  const handleDownloadBackup = async () => {
    setIsDownloading(true);
    try {
      const response = await fetch('/api/backup/export');
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to download backup');
      }
      
      const blob = await response.blob();
      const filename = response.headers.get('Content-Disposition')?.split('filename=')[1]?.replace(/"/g, '') || 
        `backup_${new Date().toISOString().split('T')[0]}.json`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      
      toast({
        title: "Backup downloaded",
        description: "Your data backup has been saved to your downloads folder.",
      });
    } catch (error: any) {
      toast({
        title: "Backup failed",
        description: error.message || "Failed to download backup",
        variant: "destructive",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const statItems = [
    { label: "Record Days", value: summary?.recordDays || 0, icon: Calendar },
    { label: "Contestants", value: summary?.contestants || 0, icon: Users },
    { label: "Seat Assignments", value: summary?.seatAssignments || 0, icon: HardDrive },
    { label: "Standbys", value: summary?.standbys || 0, icon: Users },
    { label: "Groups", value: summary?.groups || 0, icon: Database },
    { label: "Canceled", value: summary?.canceledAssignments || 0, icon: RefreshCw },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Data Backup</h1>
          <p className="text-muted-foreground">
            Download a complete backup of all your data
          </p>
        </div>
        <Button 
          onClick={handleDownloadBackup} 
          disabled={isDownloading || isLoading}
          data-testid="button-download-backup"
        >
          <Download className="h-4 w-4 mr-2" />
          {isDownloading ? "Downloading..." : "Download Backup"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Current Data Summary
          </CardTitle>
          <CardDescription>
            Overview of all data that will be included in the backup
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              Loading data summary...
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {statItems.map((item) => (
                <div key={item.label} className="p-4 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <item.icon className="h-4 w-4" />
                    <span className="text-sm">{item.label}</span>
                  </div>
                  <p className="text-2xl font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>About Backups</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            <strong>What's included:</strong> Record days, contestants, groups, seat assignments, 
            standbys, block types, and canceled assignments.
          </p>
          <p>
            <strong>Format:</strong> JSON file that can be used to restore your data or 
            import into another system.
          </p>
          <p>
            <strong>Recommendation:</strong> Download a backup regularly, especially before 
            major changes or at the end of each production day.
          </p>
          <p>
            <strong>Security:</strong> The backup file contains sensitive contestant information. 
            Store it securely and do not share it publicly.
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button variant="outline" onClick={() => refetch()} data-testid="button-refresh-summary">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh Summary
        </Button>
      </div>
    </div>
  );
}
