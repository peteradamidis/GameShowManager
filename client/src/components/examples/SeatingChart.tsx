import { SeatingChart } from '../seating-chart';

const mockSeats = Array(7).fill(null).map((_, blockIdx) =>
  Array(20).fill(null).map((_, seatIdx) => {
    const shouldFill = Math.random() > 0.3;
    return {
      id: `demo-block${blockIdx}-seat${seatIdx}`,
      ...(shouldFill && {
        contestantName: `Person ${blockIdx * 20 + seatIdx + 1}`,
        age: Math.floor(Math.random() * 40) + 20,
        gender: Math.random() > 0.4 ? "Female" : "Male" as "Female" | "Male",
        groupId: Math.random() > 0.6 ? `GRP${Math.floor(Math.random() * 5) + 1}` : undefined,
      }),
    };
  })
);

export default function SeatingChartExample() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <SeatingChart recordDayId="demo" initialSeats={mockSeats} />
    </div>
  );
}
