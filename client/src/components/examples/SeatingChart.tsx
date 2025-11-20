import { SeatingChart } from '../seating-chart';
import { SeatData } from '../seat-card';

// Generate seats with the proper row structure
const SEAT_ROWS = [
  { label: 'A', count: 5 },
  { label: 'B', count: 5 },
  { label: 'C', count: 4 },
  { label: 'D', count: 4 },
  { label: 'E', count: 4 },
];

function generateMockBlock(blockIdx: number): SeatData[] {
  const seats: SeatData[] = [];
  SEAT_ROWS.forEach(row => {
    for (let i = 1; i <= row.count; i++) {
      const shouldFill = Math.random() > 0.3;
      seats.push({
        id: `demo-block${blockIdx}-${row.label}${i}`,
        ...(shouldFill && {
          contestantName: `Person ${row.label}${i}`,
          age: Math.floor(Math.random() * 40) + 20,
          gender: Math.random() > 0.4 ? "Female" : "Male" as "Female" | "Male",
          groupId: Math.random() > 0.6 ? `GRP${Math.floor(Math.random() * 5) + 1}` : undefined,
        }),
      });
    }
  });
  return seats;
}

const mockSeats = Array(7).fill(null).map((_, blockIdx) => generateMockBlock(blockIdx));

export default function SeatingChartExample() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SeatingChart recordDayId="demo" initialSeats={mockSeats} />
    </div>
  );
}
