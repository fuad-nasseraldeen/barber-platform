import Link from "next/link";
import { Calendar } from "lucide-react";

export default function Home() {
  return (
    <div dir="rtl" className="flex min-h-screen flex-col items-center justify-center gap-10 bg-gradient-to-b from-zinc-50 to-zinc-100 p-8 dark:from-zinc-950 dark:to-zinc-900">
      <div className="flex flex-col items-center gap-6 text-center">
        <div className="flex items-center gap-3">
          <div className="sidebar-logo rounded-2xl p-3">
            <Calendar className="h-10 w-10" />
          </div>
          <h1 className="text-5xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100">
            תורן
          </h1>
        </div>
        <p className="text-xl font-medium text-zinc-600 dark:text-zinc-400">
          פלטפורמה לזימון תורים
        </p>
        <p className="max-w-md text-zinc-500 dark:text-zinc-500">
          תזמין תור בקליק • מספרות, מכוני יופי, חדרי כושר ומרפאות
        </p>
      </div>
      <Link
        href="/login"
        className="btn-primary rounded-xl px-10 py-4 text-lg font-medium shadow-lg transition hover:shadow-xl"
      >
        התחבר
      </Link>
      <p className="text-sm text-zinc-400 dark:text-zinc-500">
        התחבר עם מספר טלפון או Google כדי להמשיך
      </p>
    </div>
  );
}
