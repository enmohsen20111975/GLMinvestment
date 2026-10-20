"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
<<<<<<< HEAD
 const { theme = "system" } = useTheme()

 return (
 <Sonner
 theme={theme as ToasterProps["theme"]}
 className="toaster group"
 style={
 {
 "--normal-bg": "var(--popover)",
 "--normal-text": "var(--popover-foreground)",
 "--normal-border": "var(--border)",
 } as React.CSSProperties
 }
 {...props}
 />
 )
=======
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
>>>>>>> 99d0ec1 (docs: CLEANUP-PLAN-1 — full cleanup plan for Alpha + Bravo)
}

export { Toaster }
