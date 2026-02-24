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
  hnGiftcard?: boolean;
  bankOfferTaken?: boolean;
  spinTheWheel?: boolean;
  prize?: string;
}

interface WinningMoneyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (role: string, amount: number | null, rxNumber: string, rxEpNumber: string, caseNumber: string, playerFields?: PlayerFields, amountText?: string) => void;
  onRemove?: () => void;
  isLoading?: boolean;
  currentRole?: string;
  currentAmount?: number;
  currentAmountText?: string;
  currentRxNumber?: string;
  currentRxEpNumber?: string;
  currentCaseNumber?: string;
  currentCaseAmount?: number;
  currentHnGiftcard?: boolean;
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
  currentAmountText,
  currentRxNumber,
  currentRxEpNumber,
  currentCaseNumber,
  currentCaseAmount,
  currentHnGiftcard,
  currentBankOfferTaken,
  currentSpinTheWheel,
  currentPrize,
  isViewOnly = false,
  contestantName,
  blockNumber,
  assignments = [],
}: WinningMoneyModalProps) {
  const [rxNumber, setRxNumber] = useState<string>(currentRxNumber || "");
  const [rxEpNumber, setRxEpNumber] = useState<string>(currentRxEpNumber || "");
  const [caseNumber, setCaseNumber] = useState<string>(currentCaseNumber || "");
  const [role, setRole] = useState<string>(currentRole || "player");
  const [amount, setAmount] = useState<string>(currentAmount?.toString() || "");
  const [isEditing, setIsEditing] = useState(false);
  
  // Player-specific fields
  const [caseAmount, setCaseAmount] = useState<string>(currentCaseAmount?.toString() || "");
  const [hnGiftcard, setHnGiftcard] = useState<boolean>(currentHnGiftcard ?? false);
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
      setRxEpNumber(currentRxEpNumber || "");
      setCaseNumber(currentCaseNumber || "");
      setRole(currentRole || "player");
      if (currentRole === "case_holder" && currentAmountText) {
        setAmount(currentAmountText);
      } else {
        setAmount(currentAmount != null ? currentAmount.toString() : "");
      }
      setCaseAmount(currentCaseAmount != null ? currentCaseAmount.toString() : "");
      setHnGiftcard(currentHnGiftcard ?? false);
      setBankOfferTaken(currentBankOfferTaken ?? false);
      setSpinTheWheel(currentSpinTheWheel ?? false);
      setPrize(currentPrize || "");
      setIsEditing(false);
    }
  }, [open, currentRxNumber, currentRxEpNumber, currentCaseNumber, currentRole, currentAmount, currentAmountText, currentCaseAmount, currentHnGiftcard, currentBankOfferTaken, currentSpinTheWheel, currentPrize]);

  useEffect(() => {
    if (role === "case_holder") {
      setAmount("250");
      // Reset player-specific fields when switching to case holder
      setCaseAmount("");
      setHnGiftcard(false);
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
    
    // For case holders, allow text input (e.g., "Car", "Trip", or a number)
    // For players, require a valid number
    const amountNum = parseFloat(amount);
    const isValidNumber = !isNaN(amountNum) && amountNum >= 0;
    
    if (role === "player" && !isValidNumber) {
      return; // Players must have a valid number
    }
    
    if (role === "case_holder" && !amount.trim()) {
      return; // Case holders must have some value
    }
    
    // Build player fields object only if role is player
    const playerFields: PlayerFields | undefined = role === "player" ? {
      caseAmount: caseAmount ? parseFloat(caseAmount) : undefined,
      bankOfferTaken,
      spinTheWheel,
      prize: spinTheWheel ? prize : undefined,
    } : undefined;
    
    // HN Giftcard is now available for both roles
    const finalHnGiftcard = hnGiftcard;
    
    // For case holders with text, pass null for amount and include amountText
    // For case holders with valid number, pass the number
    const finalAmount = isValidNumber ? amountNum : null;
    const amountText = role === "case_holder" ? amount.trim() : undefined;
    
    onSubmit(role, finalAmount, rxNumber, rxEpNumber, caseNumber, { ...playerFields, hnGiftcard: finalHnGiftcard }, amountText);
    setRxNumber("");
    setRxEpNumber("");
    setCaseNumber("");
    setRole("player");
    setAmount("");
    setCaseAmount("");
    setHnGiftcard(false);
    setBankOfferTaken(false);
    setSpinTheWheel(false);
    setPrize("");
    onOpenChange(false);
  };

  const hasExistingData = (currentAmount != null && currentAmount >= 0) || !!currentAmountText;

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
            <Label htmlFor="rx-input">RX Day</Label>
            <Input
              id="rx-input"
              type="text"
              value={rxNumber}
              onChange={(e) => setRxNumber(e.target.value)}
              placeholder="Enter RX Day number"
              disabled={hasExistingData && !isEditing}
              data-testid="input-rx-number"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="rx-ep-input">RX Ep No.</Label>
            <Input
              id="rx-ep-input"
              type="text"
              value={rxEpNumber}
              onChange={(e) => setRxEpNumber(e.target.value)}
              placeholder="Enter RX Episode number"
              disabled={hasExistingData && !isEditing}
              data-testid="input-rx-ep-number"
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

          <div className="flex items-center justify-between">
            <Label htmlFor="hn-giftcard-switch">HN Giftcard</Label>
            <Switch
              id="hn-giftcard-switch"
              checked={hnGiftcard}
              onCheckedChange={setHnGiftcard}
              disabled={hasExistingData && !isEditing}
              data-testid="switch-hn-giftcard"
            />
          </div>

          {/* Player-specific fields before Amount Won */}
          {role === "player" && (
            <>
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
            <Label htmlFor="amount-input">{role === "case_holder" ? "Amount/Prize Won" : "Amount Won ($)"}</Label>
            <Input
              id="amount-input"
              type={role === "case_holder" ? "text" : "number"}
              min={role === "case_holder" ? undefined : "0"}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={hasExistingData && !isEditing}
              placeholder={role === "case_holder" ? "250 or Car, Trip, etc." : "Enter amount"}
              data-testid="input-winning-amount"
            />
            {role === "case_holder" && (
              <p className="text-xs text-muted-foreground">
                Enter amount ($250) or text description (Car, Trip, etc.)
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
                  if (onRemove) {
                    onRemove();
                  } else {
                    onOpenChange(false);
                  }
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
                disabled={isLoading || !role || (!amount && role === "player" && !hnGiftcard)}
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
