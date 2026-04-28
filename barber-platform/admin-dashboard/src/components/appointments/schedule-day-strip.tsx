"use client";

import { DateTime } from "luxon";
import { Plus } from "lucide-react";

export type DayStripItem = {
  ymd: string;
  dayNum: string;
  sublabel: string;
  isToday: boolean;
  isSelected: boolean;
  isWorkingDay: boolean;
  showOpenDayAction: boolean;
};

type ScheduleDayStripProps = {
  days: DayStripItem[];
  dir: "rtl" | "ltr";
  onSelectYmd: (ymd: string) => void;
  onOpenDay?: (ymd: string) => void;
  pickDayLabel: string;
  openDayLabel: string;
};

export function ScheduleDayStrip({
  days,
  dir,
  onSelectYmd,
  onOpenDay,
  pickDayLabel,
  openDayLabel,
}: ScheduleDayStripProps) {
  return (
    <div dir={dir} className="w-full">
      <p className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">{pickDayLabel}</p>
      <div className="schedule-strip-scroll flex gap-3 overflow-x-auto pb-2 pt-1 [-ms-overflow-style:none] [scrollbar-width:thin]">
        {days.map((d) => (
          <div key={d.ymd} className="relative flex shrink-0 flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => onSelectYmd(d.ymd)}
              className={`relative flex h-14 w-14 flex-col items-center justify-center rounded-full text-sm font-bold transition-all duration-300 ${
                d.isSelected
                  ? "scale-105 bg-[var(--primary)] text-[var(--primary-foreground)] shadow-lg ring-2 ring-[var(--primary)]/40"
                  : d.isWorkingDay
                    ? "border-2 border-zinc-300 bg-white text-zinc-900 hover:border-[var(--primary)]/50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
                    : "border-2 border-dashed border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
              } ${d.isToday && !d.isSelected ? "ring-2 ring-zinc-900/20 dark:ring-white/20" : ""}`}
            >
              <span className="leading-none">{d.dayNum}</span>
              <span className="max-w-[3.5rem] truncate text-[10px] font-normal leading-tight opacity-90">
                {d.sublabel}
              </span>
            </button>
            {d.showOpenDayAction && onOpenDay && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDay(d.ymd);
                }}
                className="absolute -start-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] shadow-md hover:opacity-95"
                title={openDayLabel}
                aria-label={openDayLabel}
              >
                <Plus className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="mx-auto mt-1 h-1 max-w-[120px] rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className="h-1 w-1/2 rounded-full bg-[var(--primary)]/50" />
      </div>
    </div>
  );
}

/** Build 7-day window around anchor in business zone. */
export function buildDayStripItems(opts: {
  anchorYmd: string;
  selectedYmd: string;
  businessTimeZone: string;
  locale: string;
  staffDayOfWeekSet: Set<number> | null;
  todayYmd: string;
  labels: {
    today: string;
    tomorrow: string;
  };
}): DayStripItem[] {
  const { anchorYmd, selectedYmd, businessTimeZone, locale, staffDayOfWeekSet, todayYmd, labels } =
    opts;
  const loc = locale === "he" ? "he" : locale === "ar" ? "ar" : "en";
  const anchor = DateTime.fromISO(anchorYmd.slice(0, 10), { zone: businessTimeZone });
  if (!anchor.isValid) return [];

  const items: DayStripItem[] = [];
  for (let i = -2; i <= 4; i++) {
    const dt = anchor.plus({ days: i });
    const ymd = dt.toISODate()!;
    const dow = dt.weekday % 7;
    const isWorkingDay = staffDayOfWeekSet == null ? true : staffDayOfWeekSet.has(dow);
    let sublabel = dt.setLocale(loc).toFormat("EEE");
    if (ymd === todayYmd) sublabel = labels.today;
    else {
      const tom = DateTime.fromISO(todayYmd, { zone: businessTimeZone }).plus({ days: 1 });
      if (tom.toISODate() === ymd) sublabel = labels.tomorrow;
    }
    items.push({
      ymd,
      dayNum: String(dt.day),
      sublabel,
      isToday: ymd === todayYmd,
      isSelected: ymd === selectedYmd,
      isWorkingDay,
      showOpenDayAction: Boolean(staffDayOfWeekSet && !isWorkingDay),
    });
  }
  return items;
}
