import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface PlayerFields {
  caseAmount?: number;
  quickCash?: number;
  bankOfferTaken?: boolean;
  spinTheWheel?: boolean;
  prize?: string;
}

interface WinningMoneyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (role: string, amount: number, rxNumber: string, caseNumber: string, playerFields?: PlayerFields) => void;
  onRemove?: () => void;
  isLoading?: boolean;
  currentRole?: string;
  currentAmount?: number;
  currentRxNumber?: string;
  currentCaseNumber?: string;
  currentCaseAmount?: number;
  currentQuickCash?: number;
  currentBankOfferTaken?: boolean;
  currentSpinTheWheel?: boolean;
  currentPrize?: string;
  isViewOnly?: boolean;
  contestantName?: string;
  blockNumber?: number;
  assignments?: any[];
}

export function WinningMoneyModal({
  open,
  onOpenChange,
  onSubmit,
  onRemove,
  isLoading = false,
  currentRole,
  currentAmount,
  currentRxNumber,
  currentCaseNumber,
  currentCaseAmount,
  currentQuickCash,
  currentBankOfferTaken,
  currentSpinTheWheel,
  currentPrize,
  isViewOnly = false,
  contestantName,
  blockNumber,
  assignments = [],
}: WinningMoneyModalProps) {
  const [rxNumber, setRxNumber] = useState<string>(currentRxNumber || "");
  const [caseNumber, setCaseNumber] = useState<string>(currentCaseNumber || "");
  const [role, setRole] = useState<string>(currentRole || "player");
  const [amount, setAmount] = useState<string>(currentAmount?.toString() || "");
  const [isEditing, setIsEditing] = useState(false);
  
  // Player-specific fields
  const [caseAmount, setCaseAmount] = useState<string>(currentCaseAmount?.toString() || "");
  const [quickCash, setQuickCash] = useState<string>(currentQuickCash?.toString() || "");
  const [bankOfferTaken, setBankOfferTaken] = useState<boolean>(currentBankOfferTaken ?? false);
  const [spinTheWheel, setSpinTheWheel] = useState<boolean>(currentSpinTheWheel ?? false);
  const [prize, setPrize] = useState<string>(currentPrize || "");

  // Calculate available case numbers for this block
  const availableCaseNumbers = useMemo(() => {
    if (!blockNumber) return Array.from({ length: 22 }, (_, i) => (i + 1).toString());
    
    // Get all case numbers used by other contestants in the same block
    const usedNumbers = new Set<string>();
    assignments.forEach((assignment: any) => {
      if (assignment.blockNumber === blockNumber && assignment.caseNumber && assignment.caseNumber !== currentCaseNumber) {
        usedNumbers.add(assignment.caseNumber.toString());
      }
    });
    
    // Return numbers 1-22 excluding used ones
    return Array.from({ length: 22 }, (_, i) => (i + 1).toString()).filter(
      num => !usedNumbers.has(num)
    );
  }, [blockNumber, assignments, currentCaseNumber]);

  // Update form fields when modal opens with existing data
  useEffect(() => {
    if (open) {
      setRxNumber(currentRxNumber || "");
      setCaseNumber(currentCaseNumber || "");
      setRole(currentRole || "player");
      setAmount(currentAmount ? currentAmount.toString() : "");
      setCaseAmount(currentCaseAmount ? currentCaseAmount.toString() : "");
      setQuickCash(currentQuickCash ? currentQuickCash.toString() : "");
      setBankOfferTaken(currentBankOfferTaken ?? false);
      setSpinTheWheel(currentSpinTheWheel ?? false);
      setPrize(currentPrize || "");
      setIsEditing(false);
    }
  }, [open, currentRxNumber, currentCaseNumber, currentRole, currentAmount, currentCaseAmount, currentQuickCash, currentBankOfferTaken, currentSpinTheWheel, currentPrize]);

  useEffect(() => {
    if (role === "case_holder") {
      setAmount("250");
      // Reset player-specific fields when switching to case holder
      setCaseAmount("");
      setQuickCash("");
      setBankOfferTaken(false);
      setSpinTheWheel(false);
      setPrize("");
    } else if (!amount) {
      setAmount("");
    }
  }, [role]);

  const handleSubmit = () => {
    if (!role) {
      return;
    }
    const amountNum = parseInt(amount, 10);
    if (isNaN(amountNum) || amountNum < 0) {
      return;
    }
    
    // Build player fields object only if role is player
    const playerFields: PlayerFields | undefined = role === "player" ? {
      caseAmount: caseAmount ? parseInt(caseAmount, 10) : undefined,
      quickCash: quickCash ? parseInt(quickCash, 10) : undefined,
      bankOfferTaken,
      spinTheWheel,
      prize: spinTheWheel ? prize : undefined,
    } : undefined;
    
    onSubmit(role, amountNum, rxNumber, caseNumber, playerFields);
    setRxNumber("");
    setCaseNumber("");
    setRole("player");
    setAmount("");
    setCaseAmount("");
    setQuickCash("");
    setBankOfferTaken(false);
    setSpinTheWheel(false);
    setPrize("");
    onOpenChange(false);
  };

  const hasExistingData = (currentAmount ?? 0) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px] max-h-[85vh] overflow-y-auto" data-testid="dialog-winning-money">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                Winning Money
                {contestantName && <span className="text-sm font-normal text-muted-foreground">— {contestantName}</span>}
              </DialogTitle>
              <DialogDescription>
                {!hasExistingData ? 'Enter winning money information for this contestant' : isEditing ? 'Edit winning money information' : 'View winning money information'}
              </DialogDescription>
            </div>
            {hasExistingData && !isEditing && (
              <Badge variant="secondary" className="ml-2">Saved</Badge>
            )}
            {hasExistingData && isEditing && (
              <Badge variant="secondary" className="ml-2">Editing</Badge>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="rx-input">RX</Label>
            <Input
              id="rx-input"
              type="text"
              value={rxNumber}
              onChange={(e) => setRxNumber(e.target.value)}
              placeholder="Enter RX number"
              disabled={hasExistingData && !isEditing}
              data-testid="input-rx-number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="case-select">Case Number</Label>
            <Select value={caseNumber} onValueChange={setCaseNumber} disabled={hasExistingData && !isEditing}>
              <SelectTrigger id="case-select" data-testid="select-case-number">
                <SelectValue placeholder="Select case number" />
              </SelectTrigger>
              <SelectContent>
                {availableCaseNumbers.map((num) => (
                  <SelectItem key={num} value={num}>
                    {num}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role-select">Role</Label>
            <Select value={role} onValueChange={setRole} disabled={hasExistingData && !isEditing}>
              <SelectTrigger id="role-select" data-testid="select-winning-role" disabled={hasExistingData && !isEditing}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="player">Player</SelectItem>
                <SelectItem value="case_holder">Case Holder</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Player-specific fields before Amount Won */}
          {role === "player" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="quick-cash-input">Quick Cash ($)</Label>
                <Input
                  id="quick-cash-input"
                  type="number"
                  min="0"
                  value={quickCash}
                  onChange={(e) => setQuickCash(e.target.value)}
                  disabled={hasExistingData && !isEditing}
                  placeholder="Enter quick cash amount"
                  data-testid="input-quick-cash"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="case-amount-input">Case Amount ($)</Label>
                <Input
                  id="case-amount-input"
                  type="number"
                  min="0"
                  value={caseAmount}
                  onChange={(e) => setCaseAmount(e.target.value)}
                  disabled={hasExistingData && !isEditing}
                  placeholder="Enter case amount"
                  data-testid="input-case-amount"
                />
              </div>

              <div className="flex items-center justify-between">
                <Label htmlFor="bank-offer-switch">Bank Offer Taken</Label>
                <Switch
                  id="bank-offer-switch"
                  checked={bankOfferTaken}
                  onCheckedChange={setBankOfferTaken}
                  disabled={hasExistingData && !isEditing}
                  data-testid="switch-bank-offer"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount-input">Amount Won ($)</Label>
            <Input
              id="amount-input"
              type="number"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={role === "case_holder" || (hasExistingData && !isEditing)}
              placeholder={role === "case_holder" ? "250" : "Enter amount"}
              data-testid="input-winning-amount"
            />
            {role === "case_holder" && (
              <p className="text-xs text-muted-foreground">
                Case Holder amount is automatically $250
              </p>
            )}
          </div>

          {/* Spin the Wheel after Amount Won */}
          {role === "player" && (
            <>
              <div className="flex items-center justify-between">
                <Label htmlFor="spin-wheel-switch">Spin the Wheel</Label>
                <Switch
                  id="spin-wheel-switch"
                  checked={spinTheWheel}
                  onCheckedChange={setSpinTheWheel}
                  disabled={hasExistingData && !isEditing}
                  data-testid="switch-spin-wheel"
                />
              </div>

              {spinTheWheel && (
                <div className="space-y-2">
                  <Label htmlFor="prize-input">Prize</Label>
                  <Input
                    id="prize-input"
                    type="text"
                    value={prize}
                    onChange={(e) => setPrize(e.target.value)}
                    disabled={hasExistingData && !isEditing}
                    placeholder="Enter prize won"
                    data-testid="input-prize"
                  />
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {hasExistingData && !isEditing ? (
            <>
              <Button
                variant="destructive"
                onClick={() => {
                  onRemove?.();
                  onOpenChange(false);
                  setIsEditing(false);
                }}
                disabled={isLoading}
                data-testid="button-winning-remove"
              >
                Remove
              </Button>
              <Button
                variant="outline"
                onClick={() => setIsEditing(true)}
                disabled={isLoading}
                data-testid="button-winning-edit"
              >
                Edit
              </Button>
              <Button
                onClick={() => onOpenChange(false)}
                disabled={isLoading}
                data-testid="button-winning-close"
              >
                Close
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  setIsEditing(false);
                }}
                disabled={isLoading}
                data-testid="button-winning-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isLoading || !role || !amount}
                data-testid="button-winning-save"
              >
                Save
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
