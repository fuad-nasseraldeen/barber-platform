import { AppointmentCalendarSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function AppointmentsLoading() {
  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton primary className="h-8 w-48" />
          <Skeleton primary className="mt-2 h-4 w-64" />
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Skeleton primary className="h-9 w-32 rounded-lg" />
        <Skeleton primary className="h-9 w-24 rounded-lg" />
      </div>
      <AppointmentCalendarSkeleton />
    </div>
  );
}
