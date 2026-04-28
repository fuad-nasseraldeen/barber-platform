export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-xl animate-pulse space-y-4 px-4 pt-4 pb-7 sm:px-5 sm:pt-5">
      <div>
        <div className="h-3 w-32 rounded bg-zinc-200 dark:bg-zinc-700" />
        <div className="mt-2 h-8 w-52 rounded bg-zinc-200 dark:bg-zinc-700" />
      </div>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-[212px] rounded-3xl bg-zinc-200 dark:bg-zinc-700" />
      ))}
    </div>
  );
}
