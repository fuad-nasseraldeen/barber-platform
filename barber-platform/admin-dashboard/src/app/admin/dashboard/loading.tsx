export default function DashboardLoading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div>
        <div className="h-8 w-48 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="mt-2 h-4 w-64 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-24 rounded-xl bg-zinc-200 dark:bg-zinc-700"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-48 rounded-xl bg-zinc-200 dark:bg-zinc-700" />
        <div className="h-48 rounded-xl bg-zinc-200 dark:bg-zinc-700" />
      </div>
    </div>
  );
}
