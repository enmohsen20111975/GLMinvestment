'use client';

import React, { useState, useRef, useCallback } from 'react';
import { toPng } from 'html-to-image';
import {
  Share2,
  Facebook,
  Send,
  MessageCircle,
  Download,
  Loader2,
  Check,
  X,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { withOfficialLinks } from '@/modules/publishing/lib/official-links';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ShareButtonProps {
  /** Reference to the element to capture */
  targetRef: React.RefObject<HTMLDivElement | null>;
  /** Title for the shared content */
  title?: string;
  /** Description for the shared content */
  description?: string;
  /** Custom text to share */
  shareText?: string;
  /** Custom hashtags for Facebook */
  hashtags?: string[];
  /** Button variant */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** Button size */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** Show as dialog instead of dropdown */
  asDialog?: boolean;
  /** Custom trigger button */
  customTrigger?: React.ReactNode;
  /** Callback when image is generated */
  onImageGenerated?: (imageDataUrl: string) => void;
  /** Filename for downloaded image */
  filename?: string;
}

/* ------------------------------------------------------------------ */
/*  Helper Functions                                                   */
/* ------------------------------------------------------------------ */

function generateShareText(title: string, description?: string): string {
  let text = title;
  if (description) {
    text += `\n\n${description}`;
  }
  text += '\n\n📊 من منصة دليل الاستثمار';
  return withOfficialLinks(text);
}

/**
 * يضمن أن أي نص جاهز للمشاركة يحتوي على بلوك الروابط الرسمية
 * (حتى لو جاء كـ prop جاهز من خارج المكوّن).
 */
function ensureOfficialLinks(text: string): string {
  if (text.includes('invist.m2y.net')) {
    return text; // النص فيه الروابط بالفعل
  }
  return withOfficialLinks(text);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function ShareButton({
  targetRef,
  title = 'تحليل الأسهم',
  description,
  shareText,
  hashtags = ['EGX', 'استثمار', 'بورصة'],
  variant = 'outline',
  size = 'default',
  asDialog = false,
  customTrigger,
  onImageGenerated,
  filename = 'analysis',
}: ShareButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [imageData, setImageData] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

  const captureImage = useCallback(async (): Promise<string | null> => {
    if (!targetRef?.current) {
      toast.error('لا يمكن التقاط الصورة');
      return null;
    }

    setIsCapturing(true);
    try {
      const dataUrl = await toPng(targetRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left',
        },
      });
      setImageData(dataUrl);
      onImageGenerated?.(dataUrl);
      return dataUrl;
    } catch (error) {
      console.error('Error capturing image:', error);
      toast.error('فشل في التقاط الصورة');
      return null;
    } finally {
      setIsCapturing(false);
    }
  }, [targetRef, onImageGenerated]);

  const handleShareFacebook = useCallback(async () => {
    const image = await captureImage();
    const text = shareText ? ensureOfficialLinks(shareText) : generateShareText(title, description);
    const url = encodeURIComponent(window.location.href);
    const quote = encodeURIComponent(text);
    
    // Facebook share dialog
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${quote}`,
      '_blank',
      'width=600,height=400'
    );
  }, [captureImage, title, description, shareText]);

  const handleShareTelegram = useCallback(async () => {
    const image = await captureImage();
    const text = shareText ? ensureOfficialLinks(shareText) : generateShareText(title, description);
    const url = encodeURIComponent(window.location.href);
    
    window.open(
      `https://t.me/share/url?url=${url}&text=${encodeURIComponent(text)}`,
      '_blank',
      'width=600,height=400'
    );
  }, [captureImage, title, description, shareText]);

  const handleShareWhatsApp = useCallback(async () => {
    const image = await captureImage();
    const text = shareText ? ensureOfficialLinks(shareText) : generateShareText(title, description);
    const url = window.location.href;
    
    window.open(
      `https://wa.me/?text=${encodeURIComponent(text + '\n' + url)}`,
      '_blank'
    );
  }, [captureImage, title, description, shareText]);

  const handleDownloadImage = useCallback(async () => {
    const image = imageData || await captureImage();
    if (!image) return;

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = image;
    link.click();
    toast.success('تم تحميل الصورة');
  }, [imageData, captureImage, filename]);

  const handleCopyImage = useCallback(async () => {
    if (!imageData) {
      const image = await captureImage();
      if (!image) return;
    }

    try {
      const response = await fetch(imageData || '');
      const blob = await response.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      setCopySuccess(true);
      toast.success('تم نسخ الصورة للحافظة');
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (error) {
      console.error('Error copying image:', error);
      toast.error('فشل نسخ الصورة');
    }
  }, [imageData, captureImage]);

  /* ------------------------ Dialog View ------------------------ */
  if (asDialog) {
    return (
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogTrigger asChild>
          {customTrigger || (
            <Button variant={variant} size={size} className="gap-2">
              <Share2 className="w-4 h-4" />
              مشاركة
            </Button>
          )}
        </DialogTrigger>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="w-5 h-5" />
              مشاركة التحليل
            </DialogTitle>
            <DialogDescription>
              اختر طريقة المشاركة المناسبة
            </DialogDescription>
          </DialogHeader>
          
          <Tabs defaultValue="share" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="share">مشاركة</TabsTrigger>
              <TabsTrigger value="preview">معاينة الصورة</TabsTrigger>
            </TabsList>
            
            <TabsContent value="share" className="space-y-4 mt-4">
              <div className="grid grid-cols-3 gap-3">
                <Button
                  onClick={handleShareFacebook}
                  className="h-auto py-4 flex-col gap-2 bg-[#1877F2] hover:bg-[#1877F2]/90"
                >
                  <Facebook className="w-6 h-6" />
                  <span className="text-xs">فيسبوك</span>
                </Button>
                <Button
                  onClick={handleShareTelegram}
                  className="h-auto py-4 flex-col gap-2 bg-[#0088cc] hover:bg-[#0088cc]/90"
                >
                  <Send className="w-6 h-6" />
                  <span className="text-xs">تيليجرام</span>
                </Button>
                <Button
                  onClick={handleShareWhatsApp}
                  className="h-auto py-4 flex-col gap-2 bg-[#25D366] hover:bg-[#25D366]/90"
                >
                  <MessageCircle className="w-6 h-6" />
                  <span className="text-xs">واتساب</span>
                </Button>
              </div>
              
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleCopyImage}
                  className="flex-1 gap-2"
                  disabled={isCapturing}
                >
                  {copySuccess ? (
                    <>
                      <Check className="w-4 h-4 text-green-500" />
                      تم النسخ
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4" />
                      نسخ الصورة
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDownloadImage}
                  className="flex-1 gap-2"
                  disabled={isCapturing}
                >
                  <Download className="w-4 h-4" />
                  تحميل
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="preview" className="mt-4">
              <div className="space-y-3">
                <Button
                  onClick={captureImage}
                  disabled={isCapturing}
                  className="w-full gap-2"
                >
                  {isCapturing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري التصوير...
                    </>
                  ) : (
                    <>
                      <ImageIcon className="w-4 h-4" />
                      التقاط صورة للمعاينة
                    </>
                  )}
                </Button>
                
                {imageData && (
                  <div className="border rounded-lg overflow-hidden">
                    <img
                      src={imageData}
                      alt="Preview"
                      className="w-full h-auto max-h-64 object-contain"
                    />
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    );
  }

  /* ------------------------ Dropdown View ------------------------ */
  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        {customTrigger || (
          <Button variant={variant} size={size} className="gap-2">
            <Share2 className="w-4 h-4" />
            مشاركة
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" dir="rtl">
        <DropdownMenuLabel>مشاركة على</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem onClick={handleShareFacebook} className="gap-2 cursor-pointer">
          <Facebook className="w-4 h-4 text-[#1877F2]" />
          فيسبوك
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleShareTelegram} className="gap-2 cursor-pointer">
          <Send className="w-4 h-4 text-[#0088cc]" />
          تيليجرام
        </DropdownMenuItem>
        
        <DropdownMenuItem onClick={handleShareWhatsApp} className="gap-2 cursor-pointer">
          <MessageCircle className="w-4 h-4 text-[#25D366]" />
          واتساب
        </DropdownMenuItem>
        
        <DropdownMenuSeparator />
        <DropdownMenuLabel>خيارات أخرى</DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        <DropdownMenuItem 
          onClick={handleCopyImage} 
          className="gap-2 cursor-pointer"
          disabled={isCapturing}
        >
          {isCapturing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : copySuccess ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
          {copySuccess ? 'تم النسخ' : 'نسخ الصورة للحافظة'}
        </DropdownMenuItem>
        
        <DropdownMenuItem 
          onClick={handleDownloadImage} 
          className="gap-2 cursor-pointer"
          disabled={isCapturing}
        >
          {isCapturing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          تحميل الصورة
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ------------------------------------------------------------------ */
/*  Share Wrapper Component - Wraps content for easy sharing          */
/* ------------------------------------------------------------------ */

interface ShareableCardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  description?: string;
  showShareButton?: boolean;
  shareButtonPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export function ShareableCard({
  children,
  className,
  title,
  description,
  showShareButton = true,
  shareButtonPosition = 'top-left',
}: ShareableCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  const positionClasses = {
    'top-left': 'top-2 left-2',
    'top-right': 'top-2 right-2',
    'bottom-left': 'bottom-2 left-2',
    'bottom-right': 'bottom-2 right-2',
  };

  return (
    <div className={cn('relative', className)}>
      {showShareButton && (
        <div className={cn('absolute z-10', positionClasses[shareButtonPosition])}>
          <ShareButton
            targetRef={cardRef}
            title={title}
            description={description}
            variant="secondary"
            size="sm"
          />
        </div>
      )}
      <div ref={cardRef} className="bg-white dark:bg-gray-900 rounded-lg">
        {children}
      </div>
    </div>
  );
}

export default ShareButton;
