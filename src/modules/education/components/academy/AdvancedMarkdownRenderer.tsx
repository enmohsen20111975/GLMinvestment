'use client';

/**
 * academy/AdvancedMarkdownRenderer.tsx
 * ============================================================================
 * F-Phase3-Split-Academy: Extracted from AcademyView.tsx (was 2,357 LOC).
 * ----------------------------------------------------------------------------
 * Minimal MD → JSX renderer. Handles: fenced code blocks (```), #/##/###/####
 * headings, - bullets, 1. numbered lists, > blockquotes, **bold**, *italic*,
 * `code`, markdown tables, hr, and plain paragraphs.
 *
 * Designed to read `content/education/*.md` faithfully (RTL-aware).
 * Detects ASCII-art code blocks (Loss Aversion curve, SOP pipeline, Algo
 * pipeline) and swaps them for premium SVG visuals at render time — source
 * .md files stay readable for content editors.
 * ============================================================================
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  LossAversionCurve,
  SopPipelineFlow,
  TradingSystemPipeline,
} from '../LearningVisuals';
import { parseMarkdown } from './helpers';

/** Render inline markdown: **bold**, *italic*, `code`, and plain text. */
function renderInline(text: string): React.ReactNode {
  if (!text) return null;
  // Tokenize on ** ** first, then ` `, then * *
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key++} className="font-bold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else if (token.startsWith('`')) {
      nodes.push(
        <code
          key={key++}
          dir="ltr"
          className="mx-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith('*')) {
      nodes.push(
        <em key={key++} className="italic">
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes.length === 0 ? text : nodes;
}

export function AdvancedMarkdownRenderer({
  content,
  compact = false,
}: {
  content: string;
  compact?: boolean;
}) {
  const blocks = React.useMemo(() => parseMarkdown(content), [content]);

  return (
    <div className={cn('space-y-3 leading-relaxed text-foreground/90', compact ? 'text-sm' : 'text-sm sm:text-base')}>
      {blocks.map((block, i) => {
        switch (block.kind) {
          case 'h1':
            return (
              <h2 key={i} className="mt-4 text-xl font-bold leading-tight sm:text-2xl">
                {block.text}
              </h2>
            );
          case 'h2':
            return (
              <h3 key={i} className="mt-3 flex items-center gap-2 border-r-4 border-warning pr-3 text-lg font-bold">
                {block.text}
              </h3>
            );
          case 'h3':
            return (
              <h4 key={i} className="mt-2 text-base font-bold text-warning ">
                {block.text}
              </h4>
            );
          case 'h4':
            return (
              <h5 key={i} className="mt-2 text-sm font-bold">
                {block.text}
              </h5>
            );
          case 'code': {
            // Task ID 30-A (Visual Battalion): detect ASCII-art code blocks
            // by signature keywords AND box-drawing characters, then render
            // a premium SVG instead of an ugly <pre><code> block. Source
            // .md files stay readable for content editors — swap happens at
            // render time only.
            //
            // The ASCII-art char check (┌│╲▲▼ etc.) ensures we NEVER replace
            // legitimate JS/Python code blocks that merely mention "Loss
            // Aversion" or "SOP Pipeline" in their comments — only true
            // ASCII diagrams are swapped to SVG.
            const codeText = block.text ?? '';
            const lowered = codeText.toLowerCase();
            const hasAsciiArt = /[┌┐└┘│─╲╱▲▼├┤┬┴┼╫║╝╗╔═]/.test(codeText);
            const isLossAversion =
              hasAsciiArt &&
              (codeText.includes('Loss Aversion') ||
                codeText.includes('منحنى Loss Aversion'));
            const isSopPipeline =
              hasAsciiArt &&
              codeText.includes('SOP') &&
              (codeText.includes('Pipeline') || codeText.includes('Standard Operating'));
            const isAlgoPipeline =
              codeText.length > 200 &&
              (codeText.includes('الربط البرمجي') ||
                codeText.includes('الخوارزمي') ||
                lowered.includes('algorithmic') ||
                lowered.includes('pipeline')) &&
              hasAsciiArt;
            if (isLossAversion) {
              return (
                <div key={i} className="my-4">
                  <LossAversionCurve />
                </div>
              );
            }
            if (isSopPipeline) {
              return (
                <div key={i} className="my-4">
                  <SopPipelineFlow />
                </div>
              );
            }
            if (isAlgoPipeline) {
              return (
                <div key={i} className="my-4">
                  <TradingSystemPipeline />
                </div>
              );
            }
            return (
              <pre
                key={i}
                dir="ltr"
                className="my-2 overflow-x-auto rounded-md border bg-muted/60 p-3 text-xs leading-relaxed"
              >
                <code className="font-mono">{block.text}</code>
              </pre>
            );
          }
          case 'blockquote':
            return (
              <blockquote
                key={i}
                className="my-2 border-r-4 border-warning bg-warning/10 p-3 text-sm italic text-muted-foreground /10"
              >
                {renderInline(block.text)}
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={i} className="space-y-1.5 pr-4">
                {block.items?.map((item, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
                    <span className="flex-1">{renderInline(item)}</span>
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="space-y-1.5 pr-4">
                {block.items?.map((item, j) => (
                  <li key={j} className="flex items-start gap-2 text-sm">
                    <span className="font-semibold text-warning ">
                      {j + 1}.
                    </span>
                    <span className="flex-1">{renderInline(item)}</span>
                  </li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div
                key={i}
                className="my-2 overflow-x-auto rounded-md border border-warning/20 /40"
              >
                <table className="w-full border-collapse text-xs sm:text-sm">
                  <thead className="bg-warning/70 /30">
                    <tr>
                      {block.headers.map((h, hi) => (
                        <th
                          key={hi}
                          className="border-b border-warning/20 /40 p-2 text-right font-bold text-warning "
                        >
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, ri) => (
                      <tr
                        key={ri}
                        className={
                          ri % 2 === 0
                            ? 'bg-card'
                            : 'bg-muted/30'
                        }
                      >
                        {row.map((cell, ci) => (
                          <td
                            key={ci}
                            className="border-b border-border/40 p-2 align-top leading-relaxed"
                          >
                            {renderInline(cell)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case 'hr':
            return <hr key={i} className="my-3 border-t border-dashed" />;
          case 'paragraph':
          default:
            return (
              <p key={i} className="whitespace-pre-line">
                {renderInline(block.text ?? '')}
              </p>
            );
        }
      })}
    </div>
  );
}
