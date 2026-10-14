import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
    darkMode: "class",
    content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/modules/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/hooks/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/config/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/types/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
        extend: {
                colors: {
                        background: 'hsl(var(--background))',
                        foreground: 'hsl(var(--foreground))',
                        card: {
                                DEFAULT: 'hsl(var(--card))',
                                foreground: 'hsl(var(--card-foreground))'
                        },
                        popover: {
                                DEFAULT: 'hsl(var(--popover))',
                                foreground: 'hsl(var(--popover-foreground))'
                        },
                        primary: {
                                DEFAULT: 'hsl(var(--primary))',
                                foreground: 'hsl(var(--primary-foreground))',
                                // SCR-STITCH: container variants for emerald-mint accent fills
                                container: 'hsl(var(--stitch-primary-container))',
                                'container-foreground': 'hsl(var(--stitch-on-primary-container))',
                        },
                        secondary: {
                                DEFAULT: 'hsl(var(--secondary))',
                                foreground: 'hsl(var(--secondary-foreground))'
                        },
                        muted: {
                                DEFAULT: 'hsl(var(--muted))',
                                foreground: 'hsl(var(--muted-foreground))'
                        },
                        accent: {
                                DEFAULT: 'hsl(var(--accent))',
                                foreground: 'hsl(var(--accent-foreground))'
                        },
                        destructive: {
                                DEFAULT: 'hsl(var(--destructive))',
                                foreground: 'hsl(var(--destructive-foreground))'
                        },
                        // SCR-STITCH: error token for negative % / stop-loss numbers
                        error: {
                                DEFAULT: 'hsl(var(--stitch-error))',
                                container: 'hsl(var(--stitch-error-container))',
                        },
                        // BOX-2 Phase 3: semantic financial tokens (emerald/amber/red)
                        // defined as CSS vars in globals.css — now wired into Tailwind
                        // so utilities like bg-success / text-warning / border-danger work.
                        success: {
                                DEFAULT: 'hsl(var(--success))',
                                foreground: 'hsl(var(--success-foreground))',
                        },
                        warning: {
                                DEFAULT: 'hsl(var(--warning))',
                                foreground: 'hsl(var(--warning-foreground))',
                        },
                        danger: {
                                DEFAULT: 'hsl(var(--danger))',
                                foreground: 'hsl(var(--danger-foreground))',
                        },
                        sidebar: {
                                DEFAULT: 'hsl(var(--sidebar))',
                                foreground: 'hsl(var(--sidebar-foreground))',
                                primary: 'hsl(var(--sidebar-primary))',
                                'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
                                accent: 'hsl(var(--sidebar-accent))',
                                'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
                                border: 'hsl(var(--sidebar-border))',
                                ring: 'hsl(var(--sidebar-ring))',
                        },
                        border: 'hsl(var(--border))',
                        input: 'hsl(var(--input))',
                        ring: 'hsl(var(--ring))',
                        chart: {
                                '1': 'hsl(var(--chart-1))',
                                '2': 'hsl(var(--chart-2))',
                                '3': 'hsl(var(--chart-3))',
                                '4': 'hsl(var(--chart-4))',
                                '5': 'hsl(var(--chart-5))'
                        },
                        // SCR-STITCH: Sovereign Terminal surface tokens (dark mode)
                        'surface': 'hsl(var(--stitch-surface))',
                        'surface-dim': 'hsl(var(--stitch-surface-dim))',
                        'surface-bright': 'hsl(var(--stitch-surface-bright))',
                        'surface-container-lowest': 'hsl(var(--stitch-surface-lowest))',
                        'surface-container-low': 'hsl(var(--stitch-surface-low))',
                        'surface-container': 'hsl(var(--stitch-surface-container))',
                        'surface-container-high': 'hsl(var(--stitch-surface-high))',
                        'surface-container-highest': 'hsl(var(--stitch-surface-highest))',
                        'on-surface': 'hsl(var(--stitch-on-surface))',
                        'on-surface-variant': 'hsl(var(--stitch-on-surface-variant))',
                        'outline': 'hsl(var(--stitch-outline))',
                        'outline-variant': 'hsl(var(--stitch-outline-variant))',
                },
                borderRadius: {
                        lg: 'var(--radius)',
                        md: 'calc(var(--radius) - 2px)',
                        sm: 'calc(var(--radius) - 4px)'
                },
                fontFamily: {
                        cairo: ['Cairo', 'Tajawal', 'sans-serif'],
                        mono: ['JetBrains Mono', 'Outfit', 'monospace'],
                        sans: ['Cairo', 'Tajawal', 'system-ui', 'sans-serif'],
                        // SCR-STITCH: Outfit for display/headlines, JetBrains Mono for financial numbers
                        outfit: ['Outfit', 'Cairo', 'sans-serif'],
                        financial: ['JetBrains Mono', 'monospace'],
                }
        }
  },
  plugins: [tailwindcssAnimate],
};
export default config;
