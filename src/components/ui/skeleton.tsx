import { cn } from "@/lib/utils"

export interface SkeletonProps extends React.ComponentProps<"div"> {
  variant?: "shimmer" | "pulse" | "subtle"
}

function Skeleton({
  className,
  variant = "shimmer",
  ...props
}: SkeletonProps) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "rounded-md overflow-hidden transition-colors duration-150",
        variant === "shimmer" && "skeleton-shimmer bg-[var(--app-skeleton-bg)]",
        variant === "pulse" && "bg-accent animate-pulse",
        variant === "subtle" && "bg-[var(--app-skeleton-bg)]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
