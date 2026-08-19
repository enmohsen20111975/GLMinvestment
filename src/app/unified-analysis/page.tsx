import { Metadata } from 'next'
import UnifiedAnalysisView from '@/components/analysis/UnifiedAnalysisView'

export const metadata: Metadata = {
  title: 'نظام التحليل الموحد | GLM Investment',
  description:
    'تحليل الأسواق المالية بمحرك واحد قابل للتخصيص حسب السوق وشخصية المتداول',
}

export default function UnifiedAnalysisPage() {
  return <UnifiedAnalysisView />
}
