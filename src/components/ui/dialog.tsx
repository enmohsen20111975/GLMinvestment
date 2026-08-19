"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

const Dialog = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>
>(({ ...props }, ref) => (
  <DialogPrimitive.Root data-slot="dialog" {...props} ref={ref} />
))
Dialog.displayName = "Dialog"

const DialogTrigger = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger>
>(({ ...props }, ref) => (
  <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} ref={ref} />
))
DialogTrigger.displayName = "DialogTrigger"

const DialogPortal = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Portal>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>
>(({ ...props }, ref) => (
  <DialogPrimitive.Portal data-slot="dialog-portal" {...props} ref={ref} />
))
DialogPortal.displayName = "DialogPortal"

const DialogClose = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Close>
>(({ ...props }, ref) => (
  <DialogPrimitive.Close data-slot="dialog-close" {...props} ref={ref} />
))
DialogClose.displayName = "DialogClose"

const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = "DialogOverlay"

const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    showCloseButton?: boolean
  }
>(({ className, children, showCloseButton = true, ...props }, ref) => (
  <DialogPortal data-slot="dialog-portal">
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      data-slot="dialog-content"
      className={cn(
        "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-1rem)] translate-x-[-50%] translate-y-[-50%] gap-4 border p-4 sm:p-6 shadow-lg duration-200 sm:max-w-lg",
        "max-h-[90vh] overflow-y-auto",
        "rounded-t-lg sm:rounded-lg",
        "bottom-0 top-auto translate-y-0 sm:bottom-auto sm:top-[50%] sm:translate-y-[-50%]",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close
          data-slot="dialog-close"
          className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = "DialogContent"

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn("text-lg leading-none font-semibold", className)}
    {...props}
  />
))
DialogTitle.displayName = "DialogTitle"

const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn("text-muted-foreground text-sm", className)}
    {...props}
  />
))
DialogDescription.displayName = "DialogDescription"

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
