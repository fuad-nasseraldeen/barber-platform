"use client";

import type { CSSProperties } from "react";
import { Award, Medal, Trophy } from "lucide-react";
import type { TeamGoalsMember, TeamGoalsPalette } from "@/lib/dashboard/kpi-template-config";

type TeamProgressRowProps = {
  member: TeamGoalsMember;
  palette: Required<TeamGoalsPalette>;
  isRtl: boolean;
  ownerLabel: string;
  teamMemberLabel: string;
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Trophy className="h-4 w-4 text-amber-500" />;
  if (rank === 2) return <Medal className="h-4 w-4 text-zinc-500" />;
  if (rank === 3) return <Award className="h-4 w-4 text-orange-500" />;
  return <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">#{rank}</span>;
}

export function TeamProgressRow({
  member,
  palette,
  isRtl,
  ownerLabel,
  teamMemberLabel,
}: TeamProgressRowProps) {
  const safePercent = Math.max(0, Math.min(100, member.progressPercent));
  const fillStyle: CSSProperties = {
    width: `${safePercent}%`,
    background: palette.accentColor,
    insetInlineStart: 0,
  };

  return (
    <li
      className={`flex items-center gap-3 rounded-2xl px-1 py-2 ${isRtl ? "flex-row-reverse" : ""}`}
    >
      <span className="w-12 shrink-0 text-sm font-semibold tabular-nums text-zinc-700 dark:text-zinc-200">
        {safePercent}%
      </span>

      <div className="min-w-0 flex-1">
        <div
          className="relative h-2.5 w-full overflow-hidden rounded-full"
          style={{ background: palette.trackColor }}
        >
          <div
            className={`team-progress-fill absolute inset-y-0 rounded-full ${isRtl ? "origin-right" : "origin-left"}`}
            style={fillStyle}
          >
            <span className="team-progress-shimmer absolute inset-0" />
          </div>
        </div>
      </div>

      <div className={`flex min-w-0 items-center gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
        <div className={`min-w-0 ${isRtl ? "text-right" : "text-left"}`}>
          <p className="truncate text-sm font-medium text-zinc-800 dark:text-zinc-100">
            {member.name}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {member.isOwner ? ownerLabel : member.role ?? teamMemberLabel}
          </p>
        </div>

        {member.avatarUrl ? (
          <img
            src={member.avatarUrl}
            alt={member.name}
            className="h-8 w-8 shrink-0 rounded-full object-cover ring-1 ring-zinc-200 dark:ring-zinc-700"
          />
        ) : (
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{ background: palette.accentSoft, color: palette.accentText }}
          >
            {initialsFromName(member.name)}
          </div>
        )}
      </div>

      <div className={`w-6 shrink-0 ${isRtl ? "text-left" : "text-right"}`}>
        <RankBadge rank={member.rank} />
      </div>
    </li>
  );
}
