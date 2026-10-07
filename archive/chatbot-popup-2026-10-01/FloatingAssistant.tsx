'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Bot,
  Send,
  X,
  Loader2,
  TrendingUp,
  Bitcoin,
  BarChart3,
  Sparkles,
  Wallet,
  MessageCircle
} from 'lucide-react';
import { useAppStore } from '@/lib/store';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  error?: boolean;
}

interface AIStatus {
  model: string;
  ollama_running: boolean;
  tools_available: string[];
}

const getQuickActions = (currentPage: string) => {
  const actions = [];
  if (currentPage === 'stocks' || currentPage === 'stock-detail') {
    actions.push({ label: 'تحليل السهم', icon: TrendingUp, query: 'ما تحليلك للسهم المعروض حالياً؟' });
  }
  if (currentPage === 'crypto') {
    actions.push({ label: 'تحليل الكريبتو', icon: Bitcoin, query: 'ما تحليلك لحالة سوق العملات الرقمية؟' });
  }
  if (currentPage === 'portfolio') {
    actions.push({ label: 'تحليل محفظتي', icon: Wallet, query: 'حلل محفظتي الحالية' });
  }
  actions.push({ label: 'ملخص السوق', icon: BarChart3, query: 'اعطني ملخص سريع لحالة السوق المصري' });
  return actions.slice(0, 2);
};

export function FloatingAssistant() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const currentView = useAppStore((s) => s.currentView);
  const user = useAppStore((s) => s.user);
  // Hide the floating assistant when the login/register modal is open so it
  // never covers the authentication CTA buttons (User Experience First).
  const showLoginPrompt = useAppStore((s) => s.showLoginPrompt);
  
  const quickActions = getQuickActions(currentView || 'dashboard');
  
  const checkStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/ai/chat');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      setStatus({ model: 'unknown', ollama_running: false, tools_available: [] });
    }
  }, []);
  
  useEffect(() => {
    if (isOpen && !status) {
      checkStatus();
    }
  }, [isOpen, status, checkStatus]);
  
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);
  
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);
  
  const sendMessage = async (messageText?: string) => {
    const text = messageText || input.trim();
    if (!text || loading) return;
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    
    try {
      const response = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: text,
          context: { page: currentView, user_id: user?.id }
        })
      });
      
      const data = await response.json();
      
      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply || data.error || 'حدث خطأ غير متوقع',
        timestamp: new Date(),
        error: !data.success
      };
      
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: 'فشل الاتصال بالخادم',
        timestamp: new Date(),
        error: true
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };
  
  // Floating button - COMPACT SIZE
  // Hidden when the login/register modal is open (z-40 keeps it below the
  // auth modal at z-50 even if it were visible).
  if (showLoginPrompt) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 lg:bottom-20 right-4 z-40 w-12 h-12 rounded-full bg-emerald-500 border-2 border-white shadow-lg shadow-emerald-500/30 flex items-center justify-center hover:scale-110 transition-transform active:scale-95"
        title="مساعد الاستثمار"
      >
        <MessageCircle className="w-5 h-5 text-white" />
      </button>
    );
  }
  
  // Chat popup - COMPACT SIZE
  return (
    <div
      className="fixed bottom-24 lg:bottom-20 right-2 left-2 sm:left-auto sm:right-4 sm:w-[340px] z-40 bg-white dark:bg-card rounded-2xl shadow-2xl border-2 border-emerald-500 flex flex-col overflow-hidden"
      style={{
        height: isMinimized ? 48 : 420,
        maxHeight: "calc(100dvh - 120px)",
      }}
    >
      {/* Header */}
      <div className="bg-emerald-500 p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-sm">مساعد الاستثمار</div>
            <div className="text-white/70 text-[10px]">
              {status?.ollama_running ? '🟢 متصل' : '🔴 غير متصل'}
            </div>
          </div>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <span className="text-white text-xs">{isMinimized ? '▲' : '▼'}</span>
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      </div>
      
      {!isMinimized && (
        <>
          {/* Messages */}
          <div
            ref={scrollRef}
            dir="rtl"
            className="flex-1 p-3 overflow-y-auto bg-gray-50"
          >
            {messages.length === 0 ? (
              <div className="text-center pt-4">
                <Sparkles className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
                <p className="font-bold text-sm mb-1">مرحباً! 👋</p>
                <p className="text-gray-500 text-xs mb-3">اسألني عن الأسهم والعملات</p>
                
                <div className="flex flex-col gap-1.5">
                  {quickActions.map((action, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(action.query)}
                      className="w-full p-2 rounded-lg border border-gray-200 bg-white text-xs flex items-center gap-2 hover:border-emerald-300 transition-colors"
                    >
                      <action.icon className="w-3.5 h-3.5 text-emerald-500" />
                      {action.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map(message => (
                  <div
                    key={message.id}
                    className={`flex gap-1.5 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {message.role !== 'user' && (
                      <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <div 
                      className={`max-w-[75%] p-2 rounded-xl text-xs leading-relaxed ${
                        message.role === 'user' 
                          ? 'bg-emerald-500 text-white' 
                          : 'bg-white shadow-sm text-gray-800'
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                
                {loading && (
                  <div className="flex gap-1.5">
                    <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                      <Bot className="w-3 h-3 text-white" />
                    </div>
                    <div className="p-2 rounded-xl bg-white shadow-sm">
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          
          {/* Input */}
          <div className="p-2 border-t border-gray-100 bg-white">
            <div className="flex gap-1.5">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="اسأل عن الأسهم..."
                disabled={loading || !status?.ollama_running}
                dir="rtl"
                className="flex-1 p-2 rounded-lg border border-gray-200 text-xs outline-none focus:border-emerald-400 transition-colors"
              />
              <button
                onClick={() => sendMessage()}
                disabled={loading || !input.trim() || !status?.ollama_running}
                className="w-9 h-9 rounded-lg bg-emerald-500 flex items-center justify-center hover:bg-emerald-600 disabled:opacity-50 transition-colors"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                ) : (
                  <Send className="w-4 h-4 text-white" />
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default FloatingAssistant;
