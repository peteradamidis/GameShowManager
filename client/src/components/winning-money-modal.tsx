import { useState, useEffect } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

interface WinningMoneyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (role: string, amount: number, rxNumber: string, caseNumber: string) => void;
  onRemove?: () => void;
  isLoading?: boolean;
  currentRole?: string;
  currentAmount?: number;
  currentRxNumber?: string;
  currentCaseNumber?: string;
  isViewOnly?: boolean;
  contestantName?: string;
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
  isViewOnly = false,
  contestantName,
}: WinningMoneyModalProps) {
  const [rxNumber, setRxNumber] = useState<string>(currentRxNumber || "");
  const [caseNumber, setCaseNumber] = useState<string>(currentCaseNumber || "");
  const [role, setRole] = useState<string>(currentRole || "player");
  const [amount, setAmount] = useState<string>(currentAmount?.toString() || "");
  const [isEditing, setIsEditing] = useState(false);

  // Update form fields when modal opens with existing data
  useEffect(() => {
    if (open) {
      setRxNumber(currentRxNumber || "");
      setCaseNumber(currentCaseNumber || "");
      setRole(currentRole || "player");
      setAmount(currentAmount ? currentAmount.toString() : "");
      setIsEditing(false);
    }
  }, [open, currentRxNumber, currentCaseNumber, currentRole, currentAmount]);

  useEffect(() => {
    if (role === "case_holder") {
      setAmount("250");
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
    onSubmit(role, amountNum, rxNumber, caseNumber);
    setRxNumber("");
    setCaseNumber("");
    setRole("player");
    setAmount("");
    onOpenChange(false);
  };

  const hasExistingData = currentAmount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]" data-testid="dialog-winning-money">
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
            <Label htmlFor="case-input">Case Number</Label>
            <Input
              id="case-input"
              type="text"
              value={caseNumber}
              onChange={(e) => setCaseNumber(e.target.value)}
              placeholder="Enter case number"
              disabled={hasExistingData && !isEditing}
              data-testid="input-case-number"
            />
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

          <div className="space-y-2">
            <Label htmlFor="amount-input">Amount ($)</Label>
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
