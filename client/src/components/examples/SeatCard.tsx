import { SeatCard } from '../seat-card';

export default function SeatCardExample() {
  const filledSeat = {
    id: "1",
    contestantName: "Sarah Johnson",
    age: 28,
    gender: "Female" as const,
    groupId: "GRP001",
  };

  const emptySeat = {
    id: "2",
  };

  return (
    <div className="grid grid-cols-2 gap-4 p-6 max-w-md">
      <SeatCard seat={filledSeat} blockIndex={0} seatIndex={0} />
      <SeatCard seat={emptySeat} blockIndex={0} seatIndex={1} />
    </div>
  );
}
