# Task 9: Admin Feedback Dashboard UI

## Work Summary

### Files Created
- `src/components/admin/FeedbackDashboard.tsx` — New comprehensive feedback dashboard component

### Files Modified
- `src/components/admin/AdminPanel.tsx` — Added FeedbackDashboard as a new tab

## Changes Made

### 1. FeedbackDashboard.tsx (New File)
Complete self-learning system dashboard with all required sections:

- **Header Section**: Brain icon with gradient, title "نظام التعلم الذاتي", subtitle, and large accuracy badge (color-coded: green >55%, amber 40-55%, red <40%)
- **Stats Cards Row** (4 cards): Total Predictions (TrendingUp), Validated (CheckCircle2), Overall Accuracy (Target), Last Updated (Clock)
- **Action Buttons**: "تشغيل التغذية الراجعة" (POST /api/v2/feedback/run) and "اختبار تاريخي" (POST /api/v2/feedback/backtest) with loading states
- **Accuracy by Horizon** (3 custom progress bars): 5d/10d/20d with color thresholds (green >60%, amber 45-60%, red <45%) + fundamental/technical accuracy
- **Accuracy by Recommendation Type** (5 horizontal bars): Strong Buy → Strong Avoid with colored bars + regime distribution badges
- **Score Correlation Card**: Avg correct score, avg incorrect score, discrimination difference with visual indicators (>5 = excellent, >2 = acceptable, else needs improvement)
- **Weight Adjustment History Table**: Parameter, Old, New, Change (green/red), Reason, Date — last 10 entries with sticky header
- **Bottom Stats**: Predictions distribution by type, average composite score with progress bar

### 2. AdminPanel.tsx (Modified)
- Added `Brain` icon import from lucide-react
- Added `import FeedbackDashboard from './FeedbackDashboard'`
- Changed TabsList from `grid-cols-3` to `grid-cols-4`
- Added new "التعلم الذاتي" tab with Brain icon (rose color)
- Added TabsContent for feedback rendering `<FeedbackDashboard />`

## Technical Details
- All text in Arabic with RTL layout
- Uses emerald/amber/rose color palette (no blue/indigo)
- Skeleton loading state for initial data fetch
- Error handling with toast notifications via sonner
- Responsive design (mobile-first with sm/md/lg breakpoints)
- Custom progress bars with color-coded thresholds
- Uses shadcn/ui components: Card, Badge, Button, Progress, Table, Skeleton
- Client-side fetch() to API endpoints
- TypeScript strict typing with proper interfaces

## Status
- Lint: ✅ No errors
- Dev server: ✅ Compiling successfully
