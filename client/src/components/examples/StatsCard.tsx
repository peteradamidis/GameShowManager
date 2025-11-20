import { StatsCard } from '../stats-card';
import { Users } from 'lucide-react';

export default function StatsCardExample() {
  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      <StatsCard title="Total Applicants" value={1247} icon={Users} />
      <StatsCard title="Pending Availability" value={342} icon={Users} subtitle="Awaiting response" />
      <StatsCard title="Assigned" value={140} icon={Users} />
    </div>
  );
}
