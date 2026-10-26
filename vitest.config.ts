/// <reference types="vitest" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

// vitest.config.ts — إعدادات الاختبارات الأمامية (Phase 5 — Testing & QA)
//
// - environment: jsdom (عشان نقدر نـ render React components في Node)
// - setupFiles: الـ jest-dom matchers (toBeInTheDocument, ...) + polyfills
// - resolve.alias: نفس الـ @/ alias اللي Next.js بيستخدمه
// - coverage: optional (مفيش enforce دلوقتي)

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: [
     'src/__tests__/**/*.test.{ts,tsx}',
     // A3-DEDUP (Task 4-a / Alpha): co-located test for the prediction dedup
     // helper lives next to the module it tests, so we add its path here.
     'src/modules/predictions/__tests__/**/*.test.{ts,tsx}',
    ],
    exclude: ['node_modules', '.next', 'dist'],
    // Next.js components بتستخدم 'use client' + dynamic imports. بنـ skip الـ
    // SSR-specific stuff عن طريق إخبار vitest إننا في بيئة browser.
    environmentOptions: {
      jsdom: {
        resources: 'usable',
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
