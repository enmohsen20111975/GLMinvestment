"use client"

import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

function Collapsible({
<<<<<<< HEAD
 ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
 return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
 ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
 return (
 <CollapsiblePrimitive.CollapsibleTrigger
 data-slot="collapsible-trigger"
 {...props}
 />
 )
}

function CollapsibleContent({
 ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
 return (
 <CollapsiblePrimitive.CollapsibleContent
 data-slot="collapsible-content"
 {...props}
 />
 )
=======
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
    />
  )
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
