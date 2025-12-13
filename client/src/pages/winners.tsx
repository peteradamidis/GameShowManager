import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Trophy, Users, Check, X, Download } from "lucide-react";

export default function WinnersPage() {
  const { toast } = useToast();
  const [filterType, setFilterType] = useState<'all' | 'player' | 'case_holder'>('all');
  const [isDownloading, setIsDownloading] = useState(false);
  const [showTX, setShowTX] = useState(false);
  const [editingTX, setEditingTX] = useState<{ id: string; field: string; value: any } | null>(null);

  const updateTXMutation = useMutation({
    mutationFn: async ({ id, txNumber, txDate, notifiedOfTx, photosSent }: any) => {
      return apiRequest('PATCH', `/api/seat-assignments/${id}/workflow`, {
        txNumber,
        txDate,
        notifiedOfTx,
        photosSent,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/seat-assignments/with-winning-money'] });
      toast({
        title: "TX updated",
        description: "TX information saved successfully"
      });
      setEditingTX(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error.message || "Could not update TX information",
        variant: "destructive"
      });
    },
  });

  const handleDownloadExcel = async () => {
    try {
      setIsDownloading(true);
      const response = await fetch('/api/seat-assignments/with-winning-money/export', {
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to download Excel file');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `winners-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      toast({
        title: "Download successful",
        description: "Winners data exported to Excel"
      });
    } catch (error: any) {
      toast({
        title: "Download failed",
        description: error.message || "Could not download Excel file",
        variant: "destructive"
      });
    } finally {
      setIsDownloading(false);
    }
  };

  // Fetch all seat assignments with winning money data
  const { data: allAssignments = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments/with-winning-money'],
    queryFn: async () => {
      const response = await fetch('/api/seat-assignments/with-winning-money', {
        cache: 'no-store',
        credentials: 'include'
      });
      if (!response.ok) {
        throw new Error('Failed to fetch winning money data');
      }
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  // Get all winners with winning money and sort by RX day order
  const allWinners = useMemo(() => {
    let winners = allAssignments
      .filter((a) => a.winningMoneyAmount)
      .sort((a, b) => new Date(a.recordDayDate).getTime() - new Date(b.recordDayDate).getTime());
    
    if (filterType !== 'all') {
      winners = winners.filter((w) => w.winningMoneyRole === filterType);
    }
    
    return winners;
  }, [allAssignments, filterType]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-muted-foreground">Loading winners...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Trophy className="h-8 w-8 text-amber-500" />
          Winners
        </h1>
        <p className="text-muted-foreground mt-2">
          Contestants with recorded winning money from locked RX days
        </p>
      </div>

      {/* Quick Export */}
      <div className="flex justify-end gap-2">
        <Button
          onClick={handleDownloadExcel}
          disabled={isDownloading}
          size="sm"
          data-testid="button-download-winners-excel"
        >
          <Download className="h-4 w-4 mr-2" />
          {isDownloading ? 'Downloading...' : 'Export to Excel'}
        </Button>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <h3 className="text-lg font-semibold">All Winners</h3>
            <Badge variant="outline">{allWinners.length}</Badge>
          </div>

          <div className="flex gap-2">
            <Button
              variant={filterType === 'all' ? 'default' : 'outline'}
              onClick={() => setFilterType('all')}
              data-testid="button-filter-all"
            >
              All
            </Button>
            <Button
              variant={filterType === 'player' ? 'default' : 'outline'}
              onClick={() => setFilterType('player')}
              data-testid="button-filter-player"
            >
              Players
            </Button>
            <Button
              variant={filterType === 'case_holder' ? 'default' : 'outline'}
              onClick={() => setFilterType('case_holder')}
              data-testid="button-filter-case-holder"
            >
              Case Holders
            </Button>
            <Button
              variant={showTX ? "default" : "outline"}
              onClick={() => setShowTX(!showTX)}
              size="sm"
              data-testid="button-toggle-tx"
            >
              TX
            </Button>
          </div>
        </div>

        {allWinners.length === 0 ? (
          <Card>
            <CardContent className="pt-8">
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                <Users className="h-12 w-12 mb-4 opacity-50" />
                <p>No winners yet. Winners will appear here when added on locked RX days.</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="border rounded-lg overflow-hidden overflow-x-auto">
            <Table>
              <TableHeader>
                {/* Group header row */}
                <TableRow className="bg-yellow-100 dark:bg-yellow-900 border-b-2">
                  <TableHead colSpan={3} className="text-center font-bold bg-yellow-100 dark:bg-yellow-900 border-r">RECORD</TableHead>
                  {showTX && (
                    <TableHead colSpan={4} className="text-center font-bold bg-pink-100 dark:bg-pink-900 border-r">TX</TableHead>
                  )}
                  <TableHead colSpan={4} className="text-center font-bold bg-yellow-100 dark:bg-yellow-900 border-r">CONTESTANTS</TableHead>
                  <TableHead colSpan={8} className="text-center font-bold bg-green-100 dark:bg-green-900">WINNINGS</TableHead>
                </TableRow>
                {/* Column headers */}
                <TableRow className="bg-muted/50">
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950">RX DATE</TableHead>
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950">RX DAY</TableHead>
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950 border-r">RX EP NO.</TableHead>
                  {showTX && (
                    <>
                      <TableHead className="bg-pink-50 dark:bg-pink-950">TX NUMBER</TableHead>
                      <TableHead className="bg-pink-50 dark:bg-pink-950">TX DATE</TableHead>
                      <TableHead className="bg-pink-50 dark:bg-pink-950 text-center">NOTIFIED OF TX</TableHead>
                      <TableHead className="bg-pink-50 dark:bg-pink-950 border-r text-center">PHOTOS SENT</TableHead>
                    </>
                  )}
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950">CONTESTANT TYPE</TableHead>
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950">CONTESTANT NAME</TableHead>
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950">PHONE</TableHead>
                  <TableHead className="bg-yellow-50 dark:bg-yellow-950 border-r">EMAIL</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950">CASE NUMBER</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950">CASE AMOUNT</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950">QUICK CASH</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950 text-center">BANK OFFER</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950 text-right">AMOUNT WON</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950 text-center">SPIN WHEEL</TableHead>
                  <TableHead className="bg-green-50 dark:bg-green-950">PRIZE</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allWinners.map((winner) => (
                  <TableRow key={winner.id} className="hover:bg-muted/30" data-testid={`row-winner-${winner.id}`}>
                    <TableCell className="text-xs">{winner.recordDayDate}</TableCell>
                    <TableCell className="text-xs font-mono">{winner.rxNumber || '-'}</TableCell>
                    <TableCell className="text-xs font-mono border-r">{winner.rxEpNumber || '-'}</TableCell>
                    {showTX && (
                      <>
                        <TableCell className="text-xs">
                          {editingTX && editingTX.id === winner.id && editingTX.field === 'txNumber' ? (
                            <input
                              type="text"
                              value={editingTX.value}
                              onChange={(e) => setEditingTX({ ...editingTX, value: e.target.value })}
                              onBlur={() => {
                                updateTXMutation.mutate({
                                  id: winner.id,
                                  txNumber: editingTX.value,
                                  txDate: winner.txDate,
                                  notifiedOfTx: winner.notifiedOfTx,
                                  photosSent: winner.photosSent,
                                });
                              }}
                              autoFocus
                              className="w-full px-2 py-1 border rounded"
                            />
                          ) : (
                            <span
                              onClick={() => setEditingTX({ id: winner.id, field: 'txNumber', value: winner.txNumber || '' })}
                              className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded"
                            >
                              {winner.txNumber || '-'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {editingTX && editingTX.id === winner.id && editingTX.field === 'txDate' ? (
                            <input
                              type="date"
                              value={editingTX.value}
                              onChange={(e) => setEditingTX({ ...editingTX, value: e.target.value })}
                              onBlur={() => {
                                updateTXMutation.mutate({
                                  id: winner.id,
                                  txNumber: winner.txNumber,
                                  txDate: editingTX.value,
                                  notifiedOfTx: winner.notifiedOfTx,
                                  photosSent: winner.photosSent,
                                });
                              }}
                              autoFocus
                              className="w-full px-2 py-1 border rounded"
                            />
                          ) : (
                            <span
                              onClick={() => setEditingTX({ id: winner.id, field: 'txDate', value: winner.txDate || '' })}
                              className="cursor-pointer hover:bg-muted/50 px-2 py-1 rounded"
                            >
                              {winner.txDate || '-'}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          <button
                            onClick={() => {
                              updateTXMutation.mutate({
                                id: winner.id,
                                txNumber: winner.txNumber,
                                txDate: winner.txDate,
                                notifiedOfTx: !winner.notifiedOfTx,
                                photosSent: winner.photosSent,
                              });
                            }}
                            className="mx-auto"
                          >
                            {winner.notifiedOfTx ? (
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </TableCell>
                        <TableCell className="text-center border-r">
                          <button
                            onClick={() => {
                              updateTXMutation.mutate({
                                id: winner.id,
                                txNumber: winner.txNumber,
                                txDate: winner.txDate,
                                notifiedOfTx: winner.notifiedOfTx,
                                photosSent: !winner.photosSent,
                              });
                            }}
                            className="mx-auto"
                          >
                            {winner.photosSent ? (
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : (
                              <X className="h-4 w-4 text-muted-foreground" />
                            )}
                          </button>
                        </TableCell>
                      </>
                    )}
                    <TableCell className="text-xs font-semibold">
                      {winner.winningMoneyRole === 'player' ? 'Player' : 'Case Holder'}
                    </TableCell>
                    <TableCell className="text-xs">{winner.contestantName}</TableCell>
                    <TableCell className="text-xs min-w-32">{winner.phone || '-'}</TableCell>
                    <TableCell className="text-xs border-r">{winner.email || '-'}</TableCell>
                    <TableCell className="text-xs font-mono">{winner.caseNumber || '-'}</TableCell>
                    <TableCell className="text-xs font-mono">
                      {winner.caseAmount ? `$${winner.caseAmount.toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell className="text-xs font-mono">
                      {winner.quickCash ? `$${winner.quickCash.toLocaleString()}` : '-'}
                    </TableCell>
                    <TableCell className="text-center">
                      {winner.bankOfferTaken !== null && winner.bankOfferTaken !== undefined ? (
                        winner.bankOfferTaken ? 
                          <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" /> : 
                          <X className="h-4 w-4 text-muted-foreground mx-auto" />
                      ) : '-'}
                    </TableCell>
                    <TableCell className={`text-right font-semibold ${winner.spinTheWheel ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                      ${winner.winningMoneyAmount?.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-center">
                      {winner.spinTheWheel !== null && winner.spinTheWheel !== undefined ? (
                        winner.spinTheWheel ? 
                          <Check className="h-4 w-4 text-green-600 dark:text-green-400 mx-auto" /> : 
                          <X className="h-4 w-4 text-muted-foreground mx-auto" />
                      ) : '-'}
                    </TableCell>
                    <TableCell className="text-xs text-green-600 dark:text-green-400">
                      {winner.spinTheWheel && winner.prize ? (
                        <span>{winner.prize}</span>
                      ) : '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
