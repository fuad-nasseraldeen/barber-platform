import { CustomerListSkeleton, Skeleton } from "@/components/ui/skeleton";

export default function CustomersLoading() {
  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Skeleton primary className="h-8 w-40" />
          <Skeleton primary className="mt-2 h-4 w-56" />
        </div>
      </div>
      <div className="mb-4">
        <Skeleton primary className="h-10 w-full max-w-md" />
      </div>
      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <CustomerListSkeleton rows={8} />
      </div>
    </div>
  );
}
