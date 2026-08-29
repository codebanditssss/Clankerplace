import * as React from "react";
import { cn } from "@/lib/cn";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center border border-dashed border-[color:var(--border)] bg-[color:var(--bg-1)] px-6 py-12 text-center",
        className,
      )}
    >
      {icon && (
        <div className="mb-3 text-[color:var(--text-tertiary)]">{icon}</div>
      )}
      <h3 className="text-[15px] font-medium text-[color:var(--text-primary)]">
        {title}
      </h3>
      {description && (
        <p className="mt-1 max-w-sm text-[13px] text-[color:var(--text-tertiary)]">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
