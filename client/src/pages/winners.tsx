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
import { Trophy, Users } from "lucide-react";

export default function WinnersPage() {
  // Fetch all seat assignments with winning money data
  const { data: allAssignments = [], isLoading } = useQuery<any[]>({
    queryKey: ['/api/seat-assignments/with-winning-money'],
    queryFn: async () => {
      const response = await fetch('/api/seat-assignments/with-winning-money');
      if (!response.ok) {
        throw new Error('Failed to fetch winning money data');
      }
      return response.json();
    },
  });

  // Filter players (role = 'player')
  const players = allAssignments.filter((a) => a.winningMoneyRole === 'player' && a.winningMoneyAmount);

  // Filter case holders (role = 'case_holder')
  const caseHolders = allAssignments.filter((a) => a.winningMoneyRole === 'case_holder' && a.winningMoneyAmount);

  const WinnersTable = ({ winners, title }: { winners: any[]; title: string }) => (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <h3 className="text-lg font-semibold">{title}</h3>
        <Badge variant="outline">{winners.length}</Badge>
      </div>

      {winners.length === 0 ? (
        <Card>
          <CardContent className="pt-8">
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-50" />
              <p>No {title.toLowerCase()} yet. Winners will appear here when added on locked RX days.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50">
                <TableHead className="w-16">Photo</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Gender</TableHead>
                <TableHead>Rating</TableHead>
                <TableHead>Record Day</TableHead>
                <TableHead>Block-Seat</TableHead>
                <TableHead>RX</TableHead>
                <TableHead>Case Number</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {winners.map((winner) => (
                <TableRow key={winner.id} className="hover:bg-muted/30">
                  <TableCell>
                    <Avatar className="h-8 w-8">
                      {winner.photoUrl ? (
                        <AvatarImage src={winner.photoUrl} alt={winner.contestantName} className="object-cover" />
                      ) : null}
                      <AvatarFallback className="text-xs">
                        {winner.contestantName
                          ?.split(' ')
                          .map((n: string) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">{winner.contestantName}</TableCell>
                  <TableCell>{winner.age}</TableCell>
                  <TableCell>{winner.gender?.[0]}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-semibold">
                      {winner.auditionRating}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{winner.recordDayDate}</TableCell>
                  <TableCell className="font-mono text-sm">
                    Block {winner.blockNumber}-{winner.seatLabel}
                  </TableCell>
                  <TableCell className="font-mono">{winner.rxNumber || '-'}</TableCell>
                  <TableCell className="font-mono">{winner.caseNumber || '-'}</TableCell>
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
          <TabsTrigger value="players">
            Players ({players.length})
          </TabsTrigger>
          <TabsTrigger value="case-holders">
            Case Holders ({caseHolders.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="players" className="mt-6">
          <WinnersTable winners={players} title="Players" />
        </TabsContent>

        <TabsContent value="case-holders" className="mt-6">
          <WinnersTable winners={caseHolders} title="Case Holders" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
