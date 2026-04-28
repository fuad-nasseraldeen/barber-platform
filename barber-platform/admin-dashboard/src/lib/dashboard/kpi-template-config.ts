import type { LucideIcon } from "lucide-react";

export type DashboardKpiTemplateType = "customers" | "treatments" | "waitlist";
export type DashboardTemplateType = DashboardKpiTemplateType | "teamGoalsProgress";

export type ComparisonTone = "positive" | "negative" | "neutral";

type DashboardTemplateBase = {
  id: string;
  visible: boolean;
};

export type DashboardKpiTemplate = DashboardTemplateBase & {
  type: DashboardKpiTemplateType;
  title: string;
  value: number;
  comparisonText?: string;
  comparisonTone?: ComparisonTone;
  icon: LucideIcon;
  chartSeries: number[];
  chartStartDate?: string;
};

export type TeamGoalsPalette = {
  accentColor?: string;
  accentSoft?: string;
  accentText?: string;
  trackColor?: string;
};

export type TeamGoalsMember = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  role?: string;
  progressPercent: number;
  rank: number;
  isOwner?: boolean;
};

export type TeamGoalsProgressTemplate = DashboardTemplateBase & {
  type: "teamGoalsProgress";
  title: string;
  subtitle: string;
  members: TeamGoalsMember[];
  ownerMember?: TeamGoalsMember;
  palette?: TeamGoalsPalette;
};

export type DashboardTemplateCard =
  | DashboardKpiTemplate
  | TeamGoalsProgressTemplate;

export function isDashboardKpiTemplate(
  card: DashboardTemplateCard,
): card is DashboardKpiTemplate {
  return card.type !== "teamGoalsProgress";
}

export type DashboardKpiTheme = {
  cardClassName: string;
  iconBubbleClassName: string;
  badgeClassName: string;
  chartColor: string;
};

export const KPI_THEME_BY_TYPE: Record<DashboardKpiTemplateType, DashboardKpiTheme> = {
  customers: {
    cardClassName:
      "border-blue-200/70 bg-gradient-to-br from-blue-50 via-white to-blue-100/60 dark:border-blue-900/40 dark:from-zinc-900 dark:via-zinc-900 dark:to-blue-950/40",
    iconBubbleClassName:
      "bg-blue-500/15 text-blue-700 ring-1 ring-blue-300/60 dark:bg-blue-500/20 dark:text-blue-300 dark:ring-blue-500/40",
    badgeClassName:
      "bg-blue-500/10 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200",
    chartColor: "hsl(var(--chart-1))",
  },
  treatments: {
    cardClassName:
      "border-emerald-200/70 bg-gradient-to-br from-emerald-50 via-white to-emerald-100/60 dark:border-emerald-900/40 dark:from-zinc-900 dark:via-zinc-900 dark:to-emerald-950/40",
    iconBubbleClassName:
      "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-300/60 dark:bg-emerald-500/20 dark:text-emerald-300 dark:ring-emerald-500/40",
    badgeClassName:
      "bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
    chartColor: "hsl(var(--chart-2))",
  },
  waitlist: {
    cardClassName:
      "border-orange-200/70 bg-gradient-to-br from-orange-50 via-white to-orange-100/70 dark:border-orange-900/40 dark:from-zinc-900 dark:via-zinc-900 dark:to-orange-950/40",
    iconBubbleClassName:
      "bg-orange-500/15 text-orange-700 ring-1 ring-orange-300/60 dark:bg-orange-500/20 dark:text-orange-300 dark:ring-orange-500/40",
    badgeClassName:
      "bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200",
    chartColor: "hsl(var(--chart-3))",
  },
};
