import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface DashboardCardProps {
  title?: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  headerAction?: ReactNode;
  variant?: "cyan" | "green" | "default";
}

export function DashboardCard({
  title,
  subtitle,
  children,
  className,
  headerAction,
  variant = "default",
}: DashboardCardProps) {
  const variantStyles = {
    cyan: "neon-border-cyan",
    green: "neon-border-green",
    default: "",
  };

  return (
    <div
      className={cn(
        "glass-card relative overflow-hidden flex flex-col rounded-xl",
        variantStyles[variant],
        className
      )}
    >
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      
      {(title || subtitle) && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-white/[0.02]">
          <div>
            {title && (
              <h3 className="font-headline font-semibold text-sm uppercase tracking-wider text-foreground/90">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="font-mono-readout text-[10px] text-muted-foreground">
                {subtitle}
              </p>
            )}
          </div>
          {headerAction && <div>{headerAction}</div>}
        </div>
      )}
      <div className="flex-1 p-4 relative scanline">
        {children}
      </div>
    </div>
  );
}
