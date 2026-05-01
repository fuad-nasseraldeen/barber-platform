import { Suspense } from "react";
import AnalyticsClient from "./analytics-client";

function AnalyticsFallback() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
      Loading analytics...
    </div>
  );
}

export default function AdminAnalyticsPage() {
  return (
    <Suspense fallback={<AnalyticsFallback />}>
      <AnalyticsClient />
    </Suspense>
  );
}
