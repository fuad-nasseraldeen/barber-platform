"use client";

import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";

const ICON_CLASS = "shrink-0 stroke-[2.5]";

/** Back/navigation arrow - points left in LTR, right in RTL */
export function BackArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <ChevronLeft
      className={`${ICON_CLASS} ${className} rtl:rotate-180`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Prev/Previous - for calendar, pagination */
export function PrevArrow({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <ChevronLeft
      className={`${ICON_CLASS} ${className}`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Next - for calendar, pagination */
export function NextArrow({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <ChevronRight
      className={`${ICON_CLASS} ${className}`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Expand/forward - for nav items, links to sub-pages */
export function ForwardArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <ChevronRight
      className={`${ICON_CLASS} ${className} rtl:rotate-180`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Dropdown indicator */
export function DropdownArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <ChevronDown
      className={`${ICON_CLASS} ${className}`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Sort up */
export function SortUpArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <ChevronUp
      className={`${ICON_CLASS} ${className}`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Sort down */
export function SortDownArrow({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <ChevronDown
      className={`${ICON_CLASS} ${className}`}
      strokeWidth={2.5}
      aria-hidden
    />
  );
}

/** Sidebar collapse: points toward collapsed state */
export function SidebarCollapseArrow({
  collapsed,
  className = "h-5 w-5",
}: {
  collapsed: boolean;
  className?: string;
}) {
  return collapsed ? (
    <NextArrow className={className} />
  ) : (
    <PrevArrow className={className} />
  );
}
