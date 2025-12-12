import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trophy, Users, Check, X } from "lucide-react";

export default function WinnersPage() {
  // Fetch all seat assignments with winning money data
  const { data: allAssignments = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments/with-winning-money'],
    queryFn: async () => {
      const response = await fetch('/api/seat-assignments/with-winning-money', {
        cache: 'no-store',
        credentials: 'include'  // Include session cookie for auth
      });
      if (!response.ok) {
        throw new Error('Failed to fetch winning money data');
      }
      return response.json();
    },
    staleTime: 0,
    gcTime: 0,
  });

  // Filter players (role = 'player')
  const players = allAssignments.filter((a) => a.winningMoneyRole === 'player' && a.winningMoneyAmount);

  // Filter case holders (role = 'case_holder')
  const caseHolders = allAssignments.filter((a) => a.winningMoneyRole === 'case_holder' && a.winningMoneyAmount);

  // Players table with all player-specific columns
  const PlayersTable = ({ winners }: { winners: any[] }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <h3 className="text-lg font-semibold">Players</h3>
        <Badge variant="outline">{winners.length}</Badge>
      </div>

      {winners.length === 0 ? (
        <Card>
          <CardContent className="pt-8">
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-50" />
              <p>No players yet. Winners will appear here when added on locked RX days.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden overflow-x-auto">
          <Table>
            <TableHeader>
              {/* Group header row */}
              <TableRow className="bg-yellow-100 dark:bg-yellow-900 border-b-2">
                <TableHead colSpan={2} className="text-center font-bold bg-yellow-100 dark:bg-yellow-900 border-r">RECORD</TableHead>
                <TableHead colSpan={4} className="text-center font-bold bg-yellow-100 dark:bg-yellow-900 border-r">CONTESTANTS</TableHead>
                <TableHead colSpan={7} className="text-center font-bold bg-green-100 dark:bg-green-900">WINNINGS</TableHead>
              </TableRow>
              {/* Column headers */}
              <TableRow className="bg-muted/50">
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">RX DATE</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950 border-r">RX DAY</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">CONTESTANT NAME</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">PHONE</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">EMAIL</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950 border-r">AGE</TableHead>
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
              {winners.map((winner) => (
                <TableRow key={winner.id} className="hover:bg-muted/30" data-testid={`row-winner-${winner.id}`}>
                  <TableCell className="text-sm">{winner.recordDayDate}</TableCell>
                  <TableCell className="text-sm font-mono border-r">{winner.rxNumber || '-'}</TableCell>
                  <TableCell className="font-medium">{winner.contestantName}</TableCell>
                  <TableCell className="text-sm">{winner.phone || '-'}</TableCell>
                  <TableCell className="text-sm">{winner.email || '-'}</TableCell>
                  <TableCell className="text-sm border-r">{winner.age}</TableCell>
                  <TableCell className="text-sm font-mono">{winner.caseNumber || '-'}</TableCell>
                  <TableCell className="text-sm font-mono">
                    {winner.caseAmount ? `$${winner.caseAmount.toLocaleString()}` : '-'}
                  </TableCell>
                  <TableCell className="text-sm font-mono">
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
                  <TableCell className="text-sm">
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
  );

  // Case Holders table with simpler columns (no player-specific fields)
  const CaseHoldersTable = ({ winners }: { winners: any[] }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <h3 className="text-lg font-semibold">Case Holders</h3>
        <Badge variant="outline">{winners.length}</Badge>
      </div>

      {winners.length === 0 ? (
        <Card>
          <CardContent className="pt-8">
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-50" />
              <p>No case holders yet. Winners will appear here when added on locked RX days.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              {/* Group header row */}
              <TableRow className="bg-yellow-100 dark:bg-yellow-900 border-b-2">
                <TableHead colSpan={2} className="text-center font-bold bg-yellow-100 dark:bg-yellow-900 border-r">RECORD</TableHead>
                <TableHead colSpan={4} className="text-center font-bold bg-yellow-100 dark:bg-yellow-900 border-r">CONTESTANTS</TableHead>
                <TableHead colSpan={2} className="text-center font-bold bg-green-100 dark:bg-green-900">WINNINGS</TableHead>
              </TableRow>
              {/* Column headers */}
              <TableRow className="bg-muted/50">
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">RX DATE</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950 border-r">RX DAY</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">CONTESTANT NAME</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">PHONE</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950">EMAIL</TableHead>
                <TableHead className="bg-yellow-50 dark:bg-yellow-950 border-r">AGE</TableHead>
                <TableHead className="bg-green-50 dark:bg-green-950">CASE NUMBER</TableHead>
                <TableHead className="bg-green-50 dark:bg-green-950 text-right">AMOUNT WON</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {winners.map((winner) => (
                <TableRow key={winner.id} className="hover:bg-muted/30" data-testid={`row-caseholder-${winner.id}`}>
                  <TableCell className="text-sm">{winner.recordDayDate}</TableCell>
                  <TableCell className="text-sm font-mono border-r">{winner.rxNumber || '-'}</TableCell>
                  <TableCell className="font-medium">{winner.contestantName}</TableCell>
                  <TableCell className="text-sm">{winner.phone || '-'}</TableCell>
                  <TableCell className="text-sm">{winner.email || '-'}</TableCell>
                  <TableCell className="text-sm border-r">{winner.age}</TableCell>
                  <TableCell className="text-sm font-mono">{winner.caseNumber || '-'}</TableCell>
                  <TableCell className="text-right font-semibold text-green-600 dark:text-green-400">
                    ${winner.winningMoneyAmount?.toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );

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

      <Tabs defaultValue="players" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="players" data-testid="tab-players">
            Players ({players.length})
          </TabsTrigger>
          <TabsTrigger value="case-holders" data-testid="tab-case-holders">
            Case Holders ({caseHolders.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="players" className="mt-6">
          <PlayersTable winners={players} />
        </TabsContent>

        <TabsContent value="case-holders" className="mt-6">
          <CaseHoldersTable winners={caseHolders} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
