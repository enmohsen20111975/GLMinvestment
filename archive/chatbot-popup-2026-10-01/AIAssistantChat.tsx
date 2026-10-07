'use client';

/**
 * AI Assistant Chat Component
 * مكون المحادثة مع المساعد الذكي
 */

import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { 
  Send, 
  Sparkles, 
  User, 
  Loader2, 
  AlertCircle, 
  TrendingUp, 
  Bitcoin,
  BarChart3,
  RefreshCw,
  Trash2
} from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolUsed?: string;
  confidence?: 'high' | 'medium' | 'low';
  error?: boolean;
}

interface AIStatus {
  model: string;
  ollama_running: boolean;
  tools_available: string[];
  cache_stats?: {
    total_entries: number;
  };
}

export function AIAssistantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Check AI status on mount
  useEffect(() => {
    checkStatus();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/python/ai/status?XTransformPort=8010');
      const data = await response.json();
      setStatus(data);
    } catch (error) {
      console.error('Failed to check AI status:', error);
      setStatus({ model: 'unknown', ollama_running: false, tools_available: [] });
    } finally {
      setCheckingStatus(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/python/ai/chat?XTransformPort=8010', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMessage.content })
      });

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply || data.error || 'حدث خطأ غير متوقع',
        timestamp: new Date(),
        toolUsed: data.tool_used,
        confidence: data.confidence,
        error: !data.success
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'system',
        content: 'فشل الاتصال بالخادم. تأكد من تشغيل Ollama.',
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

  const clearChat = () => {
    setMessages([]);
  };

  const quickActions = [
    { label: 'سعر البيتكوين', icon: Bitcoin, query: 'ما سعر البيتكوين الآن؟' },
    { label: 'مؤشر الخوف والطمع', icon: TrendingUp, query: 'ما مؤشر الخوف والطمع اليوم؟' },
    { label: 'ملخص السوق', icon: BarChart3, query: 'اعطني ملخص سوق EGX' },
  ];

  const handleQuickAction = (query: string) => {
    setInput(query);
  };

  // Status indicator
  const StatusIndicator = () => (
    <div className="flex items-center gap-2 text-sm">
      {checkingStatus ? (
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      ) : status?.ollama_running ? (
        <>
          <div className="w-2 h-2 bg-green-500 rounded-full" />
          <span className="text-green-600 dark:text-green-400">AI متصل</span>
          <Badge variant="outline" className="text-xs">
            {status.model}
          </Badge>
        </>
      ) : (
        <>
          <AlertCircle className="w-4 h-4 text-red-500" />
          <span className="text-red-600 dark:text-red-400">AI غير متصل</span>
        </>
      )}
    </div>
  );

  // Message bubble
  const MessageBubble = ({ message }: { message: Message }) => {
    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    
    return (
      <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
        {!isUser && (
          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
            isSystem ? 'bg-red-100 dark:bg-red-900' : 'bg-primary/10'
          }`}>
            {isSystem ? (
              <AlertCircle className="w-4 h-4 text-red-500" />
            ) : (
              <Sparkles className="w-4 h-4 text-primary" />
            )}
          </div>
        )}
        
        <div className={`max-w-[80%] rounded-lg p-3 ${
          isUser 
            ? 'bg-primary text-primary-foreground' 
            : isSystem
            ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-200'
            : 'bg-muted'
        }`}>
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
          
          {/* Tool and confidence badges */}
          {!isUser && !isSystem && (
            <div className="flex gap-2 mt-2">
              {message.toolUsed && (
                <Badge variant="secondary" className="text-xs">
                  {message.toolUsed}
                </Badge>
              )}
              {message.confidence && (
                <Badge 
                  variant={
                    message.confidence === 'high' ? 'default' :
                    message.confidence === 'medium' ? 'secondary' : 'destructive'
                  }
                  className="text-xs"
                >
                  {message.confidence === 'high' ? 'ثقة عالية' :
                   message.confidence === 'medium' ? 'ثقة متوسطة' : 'ثقة منخفضة'}
                </Badge>
              )}
            </div>
          )}
          
          <p className="text-xs opacity-60 mt-1">
            {message.timestamp.toLocaleTimeString('ar-EG')}
          </p>
        </div>
        
        {isUser && (
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <User className="w-4 h-4 text-primary" />
          </div>
        )}
      </div>
    );
  };

  return (
    <Card className="h-[600px] flex flex-col">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5" />
            مساعد الاستثمار
          </CardTitle>
          <div className="flex items-center gap-2">
            <StatusIndicator />
            <Button variant="ghost" size="icon" onClick={checkStatus}>
              <RefreshCw className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={clearChat}>
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="flex-1 flex flex-col p-0">
        {/* Messages area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              <Sparkles className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p className="mb-4">مرحباً! أنا مساعد الاستثمار</p>
              <p className="text-sm mb-4">اسألني عن:</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {quickActions.map((action, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickAction(action.query)}
                    className="gap-2"
                  >
                    <action.icon className="w-4 h-4" />
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(message => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {loading && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div className="bg-muted rounded-lg p-3">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                </div>
              )}
            </div>
          )}
        </ScrollArea>
        
        {/* Input area */}
        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="اكتب سؤالك هنا..."
              disabled={loading || !status?.ollama_running}
              className="flex-1"
              dir="rtl"
            />
            <Button 
              onClick={sendMessage} 
              disabled={loading || !input.trim() || !status?.ollama_running}
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
          
          {!status?.ollama_running && !checkingStatus && (
            <p className="text-xs text-red-500 mt-2">
              ⚠️ Ollama غير مشتغل. قم بتشغيله بـ: ollama serve
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default AIAssistantChat;
