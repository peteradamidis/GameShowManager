// Workspace-aware seating layout.
//
// DOND: 7 blocks, each with rows A(5) B(5) C(4) D(4) E(4) = 22 seats -> 154 total.
// CELEB: 6 blocks, each with rows A(5) B(5) C(5) D(5) E(5) = 25 seats -> 150 total.
//
// Blocks 4, 5, 6 (1-indexed) use mirrored right-to-left seat numbering in both
// workspaces. The Podium tab (P1-P22, block 8) and the overflow "To Seat on Day"
// section (block 0) are NOT part of this layout and are handled separately.

export type Workspace = 'celeb' | 'dond';

export interface SeatRow {
  label: string;
  count: number;
}

// Canonical row definitions in A -> E order (A nearest the stage).
const DOND_ROWS: SeatRow[] = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

const CELEB_ROWS: SeatRow[] = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 5 },
  { label: 'D', count: 5 },
  { label: 'E', count: 5 },
];

export interface SeatingLayout {
  workspace: Workspace;
  blockCount: number;
  rows: SeatRow[]; // A -> E order
  seatsPerBlock: number;
  totalSeats: number;
  blockNumbers: number[]; // 1-indexed block numbers, e.g. [1..7] or [1..6]
}

export function isCelebWorkspace(workspace?: string | null): boolean {
  return workspace === 'celeb';
}

export function getSeatingLayout(workspace?: string | null): SeatingLayout {
  const celeb = isCelebWorkspace(workspace);
  const rows = celeb ? CELEB_ROWS : DOND_ROWS;
  const blockCount = celeb ? 6 : 7;
  const seatsPerBlock = rows.reduce((sum, r) => sum + r.count, 0);
  return {
    workspace: celeb ? 'celeb' : 'dond',
    blockCount,
    rows,
    seatsPerBlock,
    totalSeats: blockCount * seatsPerBlock,
    blockNumbers: Array.from({ length: blockCount }, (_, i) => i + 1),
  };
}

// Blocks 4, 5, 6 (1-indexed) use right-to-left seat numbering.
export function isReversedBlock(blockNumber: number): boolean {
  return blockNumber >= 4 && blockNumber <= 6;
}

// 1-indexed block numbers for the workspace, e.g. [1..7] (DOND) or [1..6] (CELEB).
export function getBlockNumbers(workspace?: string | null): number[] {
  const { blockCount } = getSeatingLayout(workspace);
  return Array.from({ length: blockCount }, (_, i) => i + 1);
}

// Convenience: rows in display order top -> bottom (E -> A), used by the
// seating-chart visualisation where row A is rendered at the bottom.
export function getDisplaySeatRows(workspace?: string | null): SeatRow[] {
  return [...getSeatingLayout(workspace).rows].reverse();
}
