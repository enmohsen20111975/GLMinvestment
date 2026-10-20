import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
<<<<<<< HEAD
 return (
 <div
 data-slot="skeleton"
 className={cn("bg-accent animate-pulse rounded-md", className)}
 {...props}
 />
 )
=======
  return (
    <div
      data-slot="skeleton"
      className={cn("bg-accent animate-pulse rounded-md", className)}
      {...props}
    />
  )
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)
}

export { Skeleton }
