'use client';

// P40-ACADEMY PILLAR 5: PDF Export
// Utility hook + component that exports a lesson (Academy Encyclopedia) to a
// professional A4 RTL PDF using jsPDF + html2canvas. The lesson HTML is rendered
// into an off-screen print-styled div, captured as a single canvas, then embedded
// as a full-page image across multiple A4 pages. This sidesteps jsPDF's limited
// Arabic shaping by treating the rendered HTML (already RTL-correct) as an image.

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ *
 * Types — mirror the Lesson types used inside AcademyEncyclopedia.
 * Kept loose (no cross-file import) so this file stays self-contained.
 * ------------------------------------------------------------------ */

export interface LessonSection {
  heading: string;
  body: string;
  diagram?: { type: 'candle' | 'line' | 'bar' | 'pie'; data: unknown };
  keyPoints?: string[];
}

export interface QuizQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface LessonContent {
  id: string;
  slug: string;
  title: string;
  titleEn: string;
  category: 'basics' | 'technical' | 'fundamental' | 'smc' | 'risk' | 'psychology' | 'islamic';
  level: 'beginner' | 'intermediate' | 'advanced';
  duration: number;
  icon: string;
  summary: string;
  sections: LessonSection[];
  quiz?: QuizQuestion[];
}

/* ------------------------------------------------------------------ *
 * Theme — the platform primary is a near-black/white monochrome token.
 * The Academy brand book uses an emerald/teal accent for educational
 * surfaces, so we hard-code that here for the PDF (cannot rely on CSS
 * variables inside the html2canvas off-screen render).
 * ------------------------------------------------------------------ */

const ACADEMY_PRIMARY = '#0d9488'; // teal-600
const ACADEMY_PRIMARY_DARK = '#0f766e'; // teal-700
const ACADEMY_BG = '#ffffff';
const ACADEMY_INK = '#0f172a'; // slate-900
const ACADEMY_MUTED = '#475569'; // slate-600
const ACADEMY_ACCENT_BG = '#f0fdfa'; // teal-50

const CATEGORY_LABELS: Record<LessonContent['category'], string> = {
  basics: 'الأساسيات',
  technical: 'التحليل الفني',
  fundamental: 'التحليل الأساسي',
  smc: 'SMC / ICT',
  risk: 'إدارة المخاطر',
  psychology: 'سيكولوجية التداول',
};

const LEVEL_LABELS: Record<LessonContent['level'], string> = {
  beginner: 'مبتدئ',
  intermediate: 'متوسط',
  advanced: 'متقدم',
};

/* ------------------------------------------------------------------ *
 * Inline mini-diagram (SVG) used by the print template when a section
 * has a `diagram` field. We render the SVG inline so html2canvas can
 * capture it without needing extra fonts or network assets.
 * ------------------------------------------------------------------ */

function PrintDiagram({ diagram }: { diagram: LessonSection['diagram'] }) {
  if (!diagram) return null;
  const W = 460;
  const H = 180;
  // Simplified illustrative SVG. The interactive encyclopedia has its own
  // richer diagrams; here we only need a clean print-friendly shape.
  if (diagram.type === 'candle') {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[40, 110, 180, 250, 320, 390].map((x, i) => {
          const up = i % 2 === 0;
          const color = up ? '#10b981' : '#ef4444';
          const top = 30 + (i % 3) * 20;
          const bottom = H - 30 - (i % 3) * 15;
          const bodyTop = top + 25;
          const bodyH = bottom - top - 50;
          return (
            <g key={x}>
              <line x1={x} y1={top} x2={x} y2={bottom} stroke={color} strokeWidth={2} />
              <rect x={x - 12} y={bodyTop} width={24} height={Math.max(bodyH, 20)} fill={color} />
            </g>
          );
        })}
      </svg>
    );
  }
  if (diagram.type === 'line') {
    const pts = [40, 70, 55, 95, 60, 130, 80, 110, 120, 60, 160, 90]
      .map((y, i) => `${30 + i * 36},${y}`)
      .join(' ');
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        <polyline points={pts} fill="none" stroke={ACADEMY_PRIMARY} strokeWidth={3} />
        {pts.split(' ').map((p) => {
          const [x, y] = p.split(',');
          return <circle key={p} cx={x} cy={y} r={3} fill={ACADEMY_PRIMARY_DARK} />;
        })}
      </svg>
    );
  }
  if (diagram.type === 'bar') {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {[60, 110, 90, 140, 100].map((h, i) => (
          <rect
            key={i}
            x={40 + i * 80}
            y={H - 30 - h}
            width={50}
            height={h}
            fill={ACADEMY_PRIMARY}
          />
        ))}
      </svg>
    );
  }
  // pie
  return (
    <svg width={H} height={H} viewBox={`0 0 ${H} ${H}`} style={{ display: 'block' }}>
      <circle cx={H / 2} cy={H / 2} r={H / 2 - 10} fill={ACADEMY_ACCENT_BG} />
      <path
        d={`M ${H / 2} ${H / 2} L ${H / 2} 10 A ${H / 2 - 10} ${H / 2 - 10} 0 0 1 ${
          H / 2 + (H / 2 - 10)
        } ${H / 2} Z`}
        fill={ACADEMY_PRIMARY}
      />
      <path
        d={`M ${H / 2} ${H / 2} L ${H - 10} ${H / 2} A ${H / 2 - 10} ${H / 2 - 10} 0 0 1 ${
          H / 2
        } ${H - 10} Z`}
        fill={ACADEMY_PRIMARY_DARK}
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Off-screen print template (captured by html2canvas).
 * ------------------------------------------------------------------ */

const PrintTemplate = React.forwardRef<
  HTMLDivElement,
  { lesson: LessonContent; generatedAt: string }
>(function PrintTemplate({ lesson, generatedAt }, ref) {
  return (
    <div
      ref={ref}
      dir="rtl"
      style={{
        width: 794, // ~A4 width @ 96 DPI (210mm)
        padding: '40px 44px 56px 44px',
        backgroundColor: ACADEMY_BG,
        color: ACADEMY_INK,
        fontFamily:
          "'Tajawal','Cairo','Segoe UI',Tahoma,Arial,sans-serif",
        fontSize: 14,
        lineHeight: 1.75,
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `3px solid ${ACADEMY_PRIMARY}`,
          paddingBottom: 14,
          marginBottom: 22,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              backgroundColor: ACADEMY_PRIMARY,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            دليل
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 18, color: ACADEMY_INK }}>
              أكاديمية دليل الاستثمار التعليمية
            </div>
            <div style={{ fontSize: 12, color: ACADEMY_MUTED }}>
              أكاديمية دليل الاستثمار — invist.m2y.net
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'left', fontSize: 12, color: ACADEMY_MUTED }}>
          <div>{generatedAt}</div>
          <div style={{ marginTop: 4 }}>
            {CATEGORY_LABELS[lesson.category]} · {LEVEL_LABELS[lesson.level]}
          </div>
        </div>
      </div>

      {/* Title block */}
      <div
        style={{
          backgroundColor: ACADEMY_ACCENT_BG,
          border: `1px solid ${ACADEMY_PRIMARY}33`,
          borderRadius: 12,
          padding: '18px 20px',
          marginBottom: 24,
        }}
      >
        <div style={{ fontSize: 13, color: ACADEMY_PRIMARY_DARK, fontWeight: 700 }}>
          {lesson.icon} {CATEGORY_LABELS[lesson.category]}
        </div>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 800,
            margin: '6px 0 4px',
            color: ACADEMY_INK,
          }}
        >
          {lesson.title}
        </h1>
        <div style={{ fontSize: 13, color: ACADEMY_MUTED }}>{lesson.titleEn}</div>
        <div style={{ fontSize: 13, marginTop: 10, color: ACADEMY_INK }}>
          {lesson.summary}
        </div>
        <div
          style={{
            marginTop: 12,
            display: 'flex',
            gap: 18,
            fontSize: 12,
            color: ACADEMY_MUTED,
          }}
        >
          <span>⏱️ المدة: {lesson.duration} دقيقة</span>
          <span>📊 المستوى: {LEVEL_LABELS[lesson.level]}</span>
        </div>
      </div>

      {/* Sections */}
      {lesson.sections.map((section, idx) => (
        <div key={idx} style={{ marginBottom: 22, pageBreakInside: 'avoid' }}>
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: ACADEMY_PRIMARY_DARK,
              borderRight: `5px solid ${ACADEMY_PRIMARY}`,
              paddingRight: 10,
              margin: '0 0 10px',
            }}
          >
            {idx + 1}. {section.heading}
          </h2>
          <p style={{ margin: '0 0 10px', whiteSpace: 'pre-line' }}>{section.body}</p>

          {section.diagram ? (
            <div
              style={{
                margin: '12px 0',
                padding: 12,
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                textAlign: 'center',
              }}
            >
              <PrintDiagram diagram={section.diagram} />
              <div style={{ fontSize: 11, color: ACADEMY_MUTED, marginTop: 6 }}>
                شكل توضيحي: {section.heading}
              </div>
            </div>
          ) : null}

          {section.keyPoints && section.keyPoints.length > 0 ? (
            <ul
              style={{
                margin: '8px 0 0',
                paddingRight: 22,
                listStyleType: 'disc',
              }}
            >
              {section.keyPoints.map((kp, i) => (
                <li
                  key={i}
                  style={{
                    marginBottom: 4,
                    color: ACADEMY_INK,
                  }}
                >
                  <strong style={{ color: ACADEMY_PRIMARY_DARK }}>•</strong> {kp}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}

      {/* Quiz */}
      {lesson.quiz && lesson.quiz.length > 0 ? (
        <div
          style={{
            marginTop: 8,
            paddingTop: 18,
            borderTop: `2px dashed ${ACADEMY_PRIMARY}55`,
          }}
        >
          <h2
            style={{
              fontSize: 18,
              fontWeight: 700,
              color: ACADEMY_PRIMARY_DARK,
              margin: '0 0 12px',
            }}
          >
            📝 اختبار قصير
          </h2>
          {lesson.quiz.map((q, qi) => (
            <div
              key={qi}
              style={{ marginBottom: 14, pageBreakInside: 'avoid' }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {qi + 1}. {q.question}
              </div>
              <ol
                style={{
                  margin: 0,
                  paddingRight: 22,
                  listStyleType: 'arabic-indic',
                }}
              >
                {q.options.map((opt, oi) => (
                  <li key={oi} style={{ marginBottom: 2 }}>
                    {opt}
                    {oi === q.correctIndex ? '  ✅' : ''}
                  </li>
                ))}
              </ol>
              <div
                style={{
                  fontSize: 12,
                  color: ACADEMY_MUTED,
                  marginTop: 4,
                  fontStyle: 'italic',
                }}
              >
                التوضيح: {q.explanation}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Footer */}
      <div
        style={{
          marginTop: 32,
          paddingTop: 12,
          borderTop: `2px solid ${ACADEMY_PRIMARY}`,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 11,
          color: ACADEMY_MUTED,
        }}
      >
        <span>أكاديمية دليل الاستثمار — invist.m2y.net</span>
        <span>
          {lesson.titleEn} · {generatedAt}
        </span>
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------ *
 * Hook — async export, returns { exporting, exportLesson }.
 * ------------------------------------------------------------------ */

export function useLessonPDFExport() {
  const [exporting, setExporting] = React.useState(false);
  const printRef = React.useRef<HTMLDivElement | null>(null);

  const exportLesson = React.useCallback(async (lesson: LessonContent) => {
    setExporting(true);
    try {
      // Render off-screen template
      const host = document.createElement('div');
      host.style.position = 'fixed';
      host.style.right = '-10000px';
      host.style.top = '0';
      host.style.zIndex = '-1';
      host.style.pointerEvents = 'none';
      host.dir = 'rtl';
      document.body.appendChild(host);

      // We attach the React tree via a temporary root
      const { createRoot } = await import('react-dom/client');
      const root = createRoot(host);
      const generatedAt = new Date().toLocaleDateString('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });

      await new Promise<void>((resolve) => {
        root.render(
          <PrintTemplate ref={printRef} lesson={lesson} generatedAt={generatedAt} />,
        );
        // wait two animation frames for paint
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      // extra microtask delay for fonts
      await new Promise((r) => setTimeout(r, 60));

      const node = printRef.current ?? host.firstElementChild as HTMLElement;
      if (!node) throw new Error('PDF template render failed');

      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(node as HTMLElement, {
        scale: 2,
        backgroundColor: ACADEMY_BG,
        useCORS: true,
        logging: false,
        windowWidth: 794,
      });

      const { jsPDF } = await import('jspdf');
      // A4 portrait in mm
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const usableW = pageW - margin * 2;
      const imgH = (canvas.height * usableW) / canvas.width;

      // If the captured image is taller than one page, slice it across pages
      // by drawing the same image at negative Y offsets.
      if (imgH <= pageH - margin * 2) {
        const imgData = canvas.toDataURL('image/png');
        pdf.addImage(imgData, 'PNG', margin, margin, usableW, imgH, undefined, 'FAST');
      } else {
        // Render the canvas onto a tmp canvas per page slice so we don't blur.
        const pagePxHeight = Math.floor(
          ((pageH - margin * 2) * canvas.width) / usableW,
        );
        const slices = Math.ceil(canvas.height / pagePxHeight);
        for (let i = 0; i < slices; i++) {
          const sliceCanvas = document.createElement('canvas');
          sliceCanvas.width = canvas.width;
          sliceCanvas.height = Math.min(pagePxHeight, canvas.height - i * pagePxHeight);
          const ctx = sliceCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(
              canvas,
              0,
              i * pagePxHeight,
              canvas.width,
              sliceCanvas.height,
              0,
              0,
              canvas.width,
              sliceCanvas.height,
            );
          }
          if (i > 0) pdf.addPage();
          const imgData = sliceCanvas.toDataURL('image/png');
          const sliceImgH = (sliceCanvas.height * usableW) / canvas.width;
          pdf.addImage(
            imgData,
            'PNG',
            margin,
            margin,
            usableW,
            sliceImgH,
            undefined,
            'FAST',
          );
        }
      }

      // Page numbers + footer text on every page
      const pageCount = pdf.getNumberOfPages();
      for (let p = 1; p <= pageCount; p++) {
        pdf.setPage(p);
        // Footer line
        pdf.setDrawColor(13, 148, 136);
        pdf.setLineWidth(0.4);
        pdf.line(margin, pageH - 12, pageW - margin, pageH - 12);
        // Footer text
        pdf.setFontSize(8);
        pdf.setTextColor(71, 85, 105);
        pdf.text('أكاديمية دليل الاستثمار — invist.m2y.net', pageW - margin, pageH - 6, {
          align: 'right',
        });
        pdf.text(`صفحة ${p} من ${pageCount}`, margin, pageH - 6, { align: 'left' });
      }

      const fileName = `M2y_Academy_${lesson.slug}.pdf`;
      pdf.save(fileName);

      // cleanup
      root.unmount();
      host.remove();
      toast.success('تم تحميل المذكرة بنجاح');
    } catch (err) {
      console.error('[LessonPDFExporter] export failed:', err);
      toast.error('فشل تصدير المذكرة');
    } finally {
      setExporting(false);
    }
  }, []);

  return { exporting, exportLesson };
}

/* ------------------------------------------------------------------ *
 * Component — the visible "Download PDF" button.
 * ------------------------------------------------------------------ */

export interface LessonPDFExporterProps {
  lesson: LessonContent;
  variant?: 'default' | 'outline' | 'secondary' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
  label?: string;
}

export function LessonPDFExporter({
  lesson,
  variant = 'outline',
  size = 'sm',
  className,
  label = 'تحميل الدرس كمذكرة PDF',
}: LessonPDFExporterProps) {
  const { exporting, exportLesson } = useLessonPDFExport();

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={exporting}
      onClick={() => exportLesson(lesson)}
      aria-label={label}
    >
      {exporting ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">{exporting ? 'جارٍ التصدير…' : label}</span>
    </Button>
  );
}

export default LessonPDFExporter;
