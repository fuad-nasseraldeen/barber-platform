"use client";

import type { TeamGoalsMember, TeamGoalsPalette, TeamGoalsProgressTemplate } from "@/lib/dashboard/kpi-template-config";
import { TeamProgressRow } from "@/components/dashboard/team-progress-row";

type TeamGoalsProgressCardProps = {
  card: TeamGoalsProgressTemplate;
  isRtl: boolean;
  ownerLabel: string;
  teamMemberLabel: string;
};

function ensureOwnerInMembers(
  members: TeamGoalsMember[],
  ownerMember?: TeamGoalsMember,
): TeamGoalsMember[] {
  const hasOwner =
    members.some((member) => member.isOwner) ||
    (!!ownerMember && members.some((member) => member.id === ownerMember.id));
  if (hasOwner) return members;
  if (!ownerMember) return members;
  return [{ ...ownerMember, isOwner: true }, ...members];
}

export function TeamGoalsProgressCard({
  card,
  isRtl,
  ownerLabel,
  teamMemberLabel,
}: TeamGoalsProgressCardProps) {
  const palette: Required<TeamGoalsPalette> = {
    accentColor: card.palette?.accentColor ?? "var(--primary)",
    accentSoft:
      card.palette?.accentSoft ??
      "color-mix(in srgb, var(--primary) 18%, transparent)",
    accentText: card.palette?.accentText ?? "var(--primary)",
    trackColor:
      card.palette?.trackColor ??
      "color-mix(in srgb, var(--primary) 12%, #e4e4e7)",
  };

  const rows = ensureOwnerInMembers(card.members, card.ownerMember)
    .map((member) => ({
      ...member,
      progressPercent: Math.max(0, Math.min(100, member.progressPercent)),
    }))
    .sort((a, b) => a.rank - b.rank);

  return (
    <article
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-[280px] rounded-3xl border border-zinc-200 bg-white p-4 shadow-[0_10px_30px_-20px_rgba(0,0,0,0.35)] dark:border-zinc-800 dark:bg-zinc-900 sm:p-5"
    >
      <header
        className={`mb-3 flex items-start justify-between gap-3 ${isRtl ? "flex-row-reverse" : ""}`}
      >
        <p
          className={`text-xs font-medium text-zinc-500 dark:text-zinc-400 ${isRtl ? "" : "uppercase tracking-[0.14em]"}`}
        >
          {card.subtitle}
        </p>
        <h2
          className={`text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100 ${isRtl ? "text-left" : "text-right"}`}
        >
          {card.title}
        </h2>
      </header>

      <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {rows.map((member) => (
          <TeamProgressRow
            key={member.id}
            member={member}
            palette={palette}
            isRtl={isRtl}
            ownerLabel={ownerLabel}
            teamMemberLabel={teamMemberLabel}
          />
        ))}
      </ul>
    </article>
  );
}
