import { Skeleton } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div>
      <Skeleton primary className="mb-6 h-8 w-48" />
      <Skeleton primary className="mb-8 h-4 w-96 max-w-full" />
      <div className="mb-6 flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} primary className="h-10 w-24" />
        ))}
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
        <Skeleton primary className="mb-4 h-5 w-40" />
        <Skeleton primary className="mb-4 h-4 w-full max-w-md" />
        <div className="space-y-4">
          <Skeleton primary className="h-10 w-full" />
          <Skeleton primary className="h-24 w-full" />
          <Skeleton primary className="h-10 w-24" />
        </div>
      </div>
    </div>
  );
}
