'use client';

import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export default function PaymentFail() {
  const router = useRouter();

  // We can show a toast error immediately or let the user decide to retry.
  // We'll show a toast error and then let the user navigate.
  // However, note that the toast might be shown on every render, so we can use useEffect.
  // But for simplicity, we'll just show the toast once when the component mounts.
  // We'll use useEffect for that.

  // However, note that the component might be re-rendered. We'll use a ref to show the toast only once.
  // Alternatively, we can show the toast in the useEffect and then not show it again.

  // We'll do:
  //   useEffect(() => {
  //     toast.error('فشلت عملية الدفع. يرجى المحاولة مرة أخرى.');
  //   }, []);

  // But note: the toast might be shown even if the user navigates away and comes back? 
  // We'll leave it as is for now.

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="text-red-500 text-6xl mb-4">❌</div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          فشل الدفع
        </h1>
        <p className="text-gray-600 mb-6">
          عذراً، لم نتمكن من معالجة دفعتك. يرجى المحاولة مرة أخرى أو استخدام طريقة دفع أخرى.
        </p>
        <div className="space-y-3">
          <button
            onClick={() => router.back()}
            className="block w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition"
          >
            حاول مرة أخرى
          </button>
          <a
            href="/pricing"
            className="block w-full bg-gray-200 text-gray-800 py-3 rounded-lg hover:bg-gray-300 transition"
          >
            اختيار خطة أخرى
          </a>
          <a
            href="/contact"
            className="block w-full text-blue-600 py-2 hover:underline"
          >
            تواصل مع الدعم
          </a>
        </div>
      </div>
    </div>
  );
}