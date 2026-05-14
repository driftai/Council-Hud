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
          "relative flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-b from-white/[0.04] to-white/[0.02]",
          !isCollapsed && "border-b border-white/10"
        )}>
          {/* Left-edge accent stripe so card titles read as headers, not labels. */}
          <span
            aria-hidden="true"
            className={cn(
              "absolute left-0 top-3 bottom-3 w-[3px] rounded-r",
              variant === "green" ? "bg-secondary/70"
                : variant === "cyan" ? "bg-primary/70"
                : "bg-primary/40"
            )}
          />
          <div className="min-w-0 pl-2">
            {title && (
              <h3 className="truncate font-headline font-bold text-base uppercase tracking-[0.14em] text-foreground">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="mt-0.5 truncate font-mono-readout text-[11px] text-muted-foreground/90">
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
                className="flex h-8 w-8 items-center justify-center rounded border border-white/10 bg-black/30 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                onClick={toggleCollapse}
              >
                {isCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </button>
            )}
          </div>
        </div>
      )}
      {!isCollapsed && (
        <div id={contentId} className="flex-1 p-5 relative scanline" data-dashboard-card-content>
          {children}
        </div>
      )}
    </div>
  );
}
