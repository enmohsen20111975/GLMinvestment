"use client"

import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "@/lib/utils"

function Progress({
<<<<<<< HEAD
 className,
 value,
 ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
 return (
 <ProgressPrimitive.Root
 data-slot="progress"
 className={cn(
 "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
 className
 )}
 {...props}
 >
 <ProgressPrimitive.Indicator
 data-slot="progress-indicator"
 className="bg-primary h-full absolute inset-y-0 right-0 transition-all"
 style={{ width: `${Math.min(Math.max(value || 0, 0), 100)}%` }}
 />
 </ProgressPrimitive.Root>
 )
=======
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "bg-primary/20 relative h-2 w-full overflow-hidden rounded-full",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="bg-primary h-full w-full flex-1 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)
}

export { Progress }
