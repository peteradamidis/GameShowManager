import { ContestantTable } from '../contestant-table';

const mockContestants = [
  { id: "1", name: "Sarah Johnson", groupId: "GRP001", age: 28, gender: "Female" as const, availabilityStatus: "Assigned" as const, recordDay: "Dec 15, 2025" },
  { id: "2", name: "Mike Chen", groupId: "GRP001", age: 32, gender: "Male" as const, availabilityStatus: "Assigned" as const, recordDay: "Dec 15, 2025" },
  { id: "3", name: "Emma Williams", groupId: null, age: 24, gender: "Female" as const, availabilityStatus: "Available" as const },
  { id: "4", name: "James Brown", groupId: "GRP002", age: 45, gender: "Male" as const, availabilityStatus: "Pending" as const },
  { id: "5", name: "Lisa Anderson", groupId: "GRP002", age: 41, gender: "Female" as const, availabilityStatus: "Pending" as const },
];

export default function ContestantTableExample() {
  return (
    <div className="p-6">
      <ContestantTable contestants={mockContestants} />
    </div>
  );
}
