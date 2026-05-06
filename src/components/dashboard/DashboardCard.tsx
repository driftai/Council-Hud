"use client";

import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

interface DashboardCardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  headerAction?: ReactNode;
  variant?: "cyan" | "green" | "default";
  collapsible?: boolean;
  defaultCollapsed?: boolean;
  collapseStorageKey?: string;
}

const COLLAPSE_STORAGE_PREFIX = "council-hud-card-collapsed";

function buildStorageKey(title?: string, subtitle?: string) {
  const raw = `${title || "untitled"}-${subtitle || ""}`.toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "card";
  return `${COLLAPSE_STORAGE_PREFIX}:${slug}`;
}

function removeCollapsedSizeUtilities(className?: string) {
  if (!className) return className;
  return className
    .split(/\s+/)
    .filter((item) => item && !item.startsWith("min-h-") && !item.startsWith("!min-h-"))
    .join(" ");
}

export function DashboardCard({
  title,
  subtitle,
  children,
  className,
  style,
  headerAction,
  variant = "default",
  collapsible = true,
  defaultCollapsed = false,
  collapseStorageKey,
}: DashboardCardProps) {
  const contentId = useId();
  const canCollapse = collapsible && !!(title || subtitle);
  const storageKey = useMemo(
    () => collapseStorageKey || buildStorageKey(title, subtitle),
    [collapseStorageKey, title, subtitle]
  );
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const variantStyles = {
    cyan: "neon-border-cyan",
    green: "neon-border-green",
    default: "",
  };
  const cardStyle: CSSProperties | undefined = isCollapsed
    ? { ...style, minHeight: 0, height: "auto" }
    : style;
  const resolvedClassName = isCollapsed ? removeCollapsedSizeUtilities(className) : className;

  useEffect(() => {
    if (!canCollapse) return;

    const stored = window.localStorage.getItem(storageKey);
    if (stored === "1") {
      setIsCollapsed(true);
    } else if (stored === "0") {
      setIsCollapsed(false);
    } else {
      setIsCollapsed(defaultCollapsed);
    }
  }, [canCollapse, defaultCollapsed, storageKey]);

  const toggleCollapse = () => {
    if (!canCollapse) return;

    setIsCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(storageKey, next ? "1" : "0");
      return next;
    });
  };

  return (
    <div
      className={cn(
        "glass-card relative overflow-hidden flex flex-col rounded-xl",
        variantStyles[variant],
        resolvedClassName,
        isCollapsed && "self-start !min-h-0 h-auto"
      )}
      style={cardStyle}
      data-dashboard-card={title || subtitle || "untitled"}
      data-card-collapsed={isCollapsed ? "true" : "false"}
    >
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      
      {(title || subtitle) && (
        <div className={cn(
          "flex items-center justify-between gap-3 px-4 py-3 bg-white/[0.02]",
          !isCollapsed && "border-b border-white/5"
        )}>
          <div className="min-w-0">
            {title && (
              <h3 className="truncate font-headline font-semibold text-sm uppercase tracking-wider text-foreground/90">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="truncate font-mono-readout text-[10px] text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {headerAction && <div className="flex items-center gap-2">{headerAction}</div>}
            {canCollapse && (
              <button
                type="button"
                aria-controls={contentId}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${title || "card"}`}
                title={isCollapsed ? "Expand card" : "Collapse card"}
                className="flex h-7 w-7 items-center justify-center rounded border border-white/10 bg-black/30 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                onClick={toggleCollapse}
              >
                {isCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            )}
          </div>
        </div>
      )}
      {!isCollapsed && (
        <div id={contentId} className="flex-1 p-4 relative scanline" data-dashboard-card-content>
          {children}
        </div>
      )}
    </div>
  );
}
