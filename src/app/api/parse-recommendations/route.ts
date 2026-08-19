import { NextRequest, NextResponse } from 'next/server';

// Arabic to English digit mapping
const ARABIC_TO_ENGLISH_DIGITS: { [key: string]: string } = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '٫': '.'
};

function normalizeNumbers(text: string): string {
  if (!text) return text;
  return text.replace(/[٠-٩٫]/g, (char) => ARABIC_TO_ENGLISH_DIGITS[char] || char);
}

// Patterns for extraction
const PATTERNS = {
  CODE_PAREN: /\(([A-Z]{2,8})\)/g,
  CODE_AFTER_NAME: /(?:^|\s)([A-Z]{2,8})(?:\s+آخر|\s+اخر|\s+سعر|\s+شراء|\n)/g,
  BUY_ZONE: /(?:شراء|دخول|شراء\s*واحتفاظ|تصطاد|تصطيب|فرصة|اقتناص)\s*(?:في|من|عند|حول|حوالي|زون|zone|ب|بـ)?\s*[:\s]*([\d\.\,\s\-]+(?:\s*(?:جنيه|قرش|جنية|ج\s|EGP))?)/gi,
  LAST_PRICE: /(?:آخر\s*سعر|اخر\s*سعر|السعر|سعر)\s*[:\s]*([\d\.\,\s\-]+)/gi,
  TARGET: /(?:هدف|أهداف|هدف\s*البيع|هدف\s*الشراء|هدف\s*استثماري|target|goal)\s*(?:البيع|الأول|الثاني|الثالث|استثماري|مضارب|مستثمر|في|ثم|ل|لل|و)?\s*[:\s]*([\d\.\,\s\-]+(?:\s*(?:جنيه|قرش|جنية|ج\s|EGP))?)/gi,
  STOP: /(?:استوب|إيقاف\s*خسارة|وقف\s*خسارة|stop\s*loss|stop|استوب\s*كسر)\s*(?:كسر|اسفل|أسفل|أقل|اقل|من|إغلاق|اغلاق|إيقاف|below|under)?\s*[:\s]*([\d\.\,\s\-]+(?:\s*(?:جنيه|قرش|جنية|ج\s|EGP|إغلاق|اغلاق|إيقاف|خسارة))?)/gi,
  SUPPORT: /(?:دعم|دعوم|دعمك|support)\s*(?:عند|حول|حوالي|في|من|اقل|أقل|اسفل|أسفل|كسر)?\s*[:\s]*([\d\.\,\s\-]+(?:\s*(?:جنيه|قرش|جنية|ج\s|EGP))?)/gi,
  RESISTANCE: /(?:مقاومة|مقاومات|resistance)\s*(?:عند|حول|حوالي|في|من|اعلى|أعلى|فوق|above)?\s*[:\s]*([\d\.\,\s\-]+(?:\s*(?:جنيه|قرش|جنية|ج\s|EGP))?)/gi,
  OP_TYPE: /\b(شراء\s*واحتفاظ|شراء\s*واحتفظ|تصطاد\s*في\s*التريحات|تريدة|مضاربة\s*لحظية|مضاربة\s*مخاطرة|شراء\s*مخاطرة|اختراق|ارتداد|محفظة\s*شهرية|محفظة|هدف|متوسط\s*شراء|متوسط|بيع|شراء|T\+1|t\+1|t\+2|تصطاد|تصطيب|دعم|مقاومة)\b/gi,
  RETURN_PCT: /(?:نسبة\s*ربح|ربح\s*متوقع|عائد|return|profit)\s*[:\s]*([\d\.\,\s\-]+\s*%?)/gi,
  DATE: /(?:جلسة|لجلسة|تاريخ|يوم|date|session)\s*[:\s]*([\d]{1,2}[\-/\.][\d]{1,2}[\-/\.][\d]{2,4})/gi,
  WHATSAPP_DATE: /\[(\d{1,2}\/\d{1,2})[\s,]*\d{1,2}:\d{2}\s*(?:AM|PM|ص|م)?\]/gi,
};

interface Recommendation {
  seq: string;
  stock: string;
  code: string;
  type: string;
  buyPrice: string;
  target1: string;
  target2: string;
  target3: string;
  stopLoss: string;
  support: string;
  resistance: string;
  expectedReturn: string;
  status: string;
  notes: string;
  date: string;
}

function preprocessText(text: string): string {
  text = normalizeNumbers(text);
  // Remove WhatsApp metadata
  text = text.replace(/\[\d{1,2}\/\d{1,2},?\s*\d{1,2}:\d{2}\s*(?:AM|PM|ص|م)?\]\s*\+?\d[\d\s]*:/g, '\n');
  text = text.replace(/\[\d{1,2}\/\d{1,2},?\s*\d{1,2}:\d{2}\s*(?:AM|PM|ص|م)?\]\s*[^\n]+:/g, '\n');
  text = text.replace(/\*/g, '');
  text = text.replace(/ +/g, ' ');
  return text.trim();
}

function hasFinancialData(block: string): boolean {
  let score = 0;
  if (PATTERNS.BUY_ZONE.test(block)) score += 2;
  if (PATTERNS.LAST_PRICE.test(block)) score += 1;
  if (PATTERNS.TARGET.test(block)) score += 2;
  if (PATTERNS.STOP.test(block)) score += 2;
  if (PATTERNS.SUPPORT.test(block)) score += 1;
  if (PATTERNS.RESISTANCE.test(block)) score += 1;
  // Reset lastIndex
  Object.values(PATTERNS).forEach(p => p.lastIndex = 0);
  return score >= 2;
}

function splitIntoBlocks(text: string): [string, string][] {
  const blocks: [string, string][] = [];
  
  // Numbered recommendations
  const numberedPattern = /(?:^|\n)\s*(\d+)[\-\.]\s*([^\n]+(?:\n[^\n]+){0,12})/gm;
  let match;
  while ((match = numberedPattern.exec(text)) !== null) {
    const num = match[1];
    const block = match[2].trim();
    if (block.length > 15 && hasFinancialData(block)) {
      blocks.push([num, block]);
    }
  }
  
  return blocks;
}

function extractFromBlock(block: string, baseDate: string): Recommendation | null {
  const rec: Recommendation = {
    seq: '',
    stock: '',
    code: '',
    type: '',
    buyPrice: '',
    target1: '',
    target2: '',
    target3: '',
    stopLoss: '',
    support: '',
    resistance: '',
    expectedReturn: '',
    status: '🟡 نشط',
    notes: '',
    date: baseDate,
  };
  
  // Extract stock name (Arabic text)
  const nameMatch = block.match(/([\u0600-\u06FF][\u0600-\u06FF\s]{1,30})/);
  if (nameMatch) {
    rec.stock = nameMatch[1].trim();
  }
  
  // Extract code
  const codeMatch = block.match(PATTERNS.CODE_PAREN);
  if (codeMatch) {
    rec.code = codeMatch[1];
  }
  
  // Extract operation type
  const opMatches = block.match(PATTERNS.OP_TYPE);
  if (opMatches) {
    rec.type = [...new Set(opMatches)].slice(0, 3).join(' / ');
  }
  
  // Extract buy zone
  PATTERNS.BUY_ZONE.lastIndex = 0;
  const buyMatch = PATTERNS.BUY_ZONE.exec(block);
  if (buyMatch) {
    rec.buyPrice = buyMatch[1].trim();
  }
  
  // Extract targets
  PATTERNS.TARGET.lastIndex = 0;
  const targets: string[] = [];
  let targetMatch;
  while ((targetMatch = PATTERNS.TARGET.exec(block)) !== null) {
    const t = targetMatch[1].replace(/[^\d\.\,\s\-]/g, '').trim();
    if (t && !targets.includes(t)) {
      targets.push(t);
    }
  }
  if (targets.length >= 1) rec.target1 = targets[0];
  if (targets.length >= 2) rec.target2 = targets[1];
  if (targets.length >= 3) rec.target3 = targets[2];
  
  // Extract stop loss
  PATTERNS.STOP.lastIndex = 0;
  const stopMatch = PATTERNS.STOP.exec(block);
  if (stopMatch) {
    rec.stopLoss = stopMatch[1].trim();
  }
  
  // Extract support
  PATTERNS.SUPPORT.lastIndex = 0;
  const supportMatch = PATTERNS.SUPPORT.exec(block);
  if (supportMatch) {
    rec.support = supportMatch[1].trim();
  }
  
  // Extract resistance
  PATTERNS.RESISTANCE.lastIndex = 0;
  const resistMatch = PATTERNS.RESISTANCE.exec(block);
  if (resistMatch) {
    rec.resistance = resistMatch[1].trim();
  }
  
  // Detect status
  if (/✅|حقق|وصل|اهي|مبروك|تحقق|انجز/.test(block)) {
    rec.status = '✅ حقق الهدف';
  } else if (/خسارة|خسر|نزل|سلب|خسران/.test(block)) {
    rec.status = '❌ خسارة';
  } else if (/ربح|كسب|مكسب|صعد|طلع|ارتفع/.test(block)) {
    rec.status = '🟢 ربح';
  }
  
  // Only return if meaningful data found
  if (rec.stock || rec.code || rec.buyPrice || rec.target1 || rec.stopLoss) {
    return rec;
  }
  return null;
}

function extractRecommendations(text: string): Recommendation[] {
  text = preprocessText(text);
  
  // Extract base date
  const whatsappDates = text.match(PATTERNS.WHATSAPP_DATE);
  const baseDate = whatsappDates ? whatsappDates[0] : new Date().toLocaleDateString('ar-EG');
  
  const blocks = splitIntoBlocks(text);
  const recommendations: Recommendation[] = [];
  
  for (const [idx, block] of blocks) {
    const rec = extractFromBlock(block, baseDate);
    if (rec) {
      rec.seq = idx || String(recommendations.length + 1);
      recommendations.push(rec);
    }
  }
  
  return recommendations;
}

function generateFacebookPost(recommendations: Recommendation[]): string {
  if (!recommendations.length) {
    return '❌ لا توجد توقعات لإنشاء البوست.';
  }
  
  const lines: string[] = [
    '📊 توقعات البورصة المصرية 🇪🇬',
    `📅 ${new Date().toLocaleDateString('ar-EG')}`,
    '—'.repeat(25),
    ''
  ];
  
  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    let stockLine = `${i + 1}. `;
    if (rec.stock) stockLine += rec.stock;
    if (rec.code) stockLine += ` (${rec.code})`;
    lines.push(stockLine);
    
    if (rec.type) lines.push(`   🎯 ${rec.type}`);
    if (rec.buyPrice) lines.push(`   💰 سعر الشراء/الدخول: ${rec.buyPrice}`);
    
    const targets = [rec.target1, rec.target2, rec.target3].filter(Boolean);
    if (targets.length) lines.push(`   🎯 الأهداف: ${targets.join(' ➜ ')}`);
    
    if (rec.stopLoss) lines.push(`   🛑 الاستوب: ${rec.stopLoss}`);
    if (rec.support) lines.push(`   📉 الدعم: ${rec.support}`);
    if (rec.resistance) lines.push(`   📈 المقاومة: ${rec.resistance}`);
    if (rec.expectedReturn) lines.push(`   📊 الربح المتوقع: ${rec.expectedReturn}`);
    if (rec.status !== '🟡 نشط') lines.push(`   ${rec.status}`);
    if (rec.notes) lines.push(`   📝 ${rec.notes}`);
    
    lines.push('');
  }
  
  lines.push('—'.repeat(25));
  lines.push('⚠️ تنبيه: هذه التوقعات لأغراض تعليمية فقط.');
  lines.push('📌 أي قرار استثماري مسؤوليتك الشخصية.');
  lines.push('#البورصة_المصرية #توقعات #EGX #الأسهم_المصرية');
  
  return lines.join('\n');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, format = 'both' } = body;
    
    if (!text) {
      return NextResponse.json({
        success: false,
        error: 'النص مطلوب'
      }, { status: 400 });
    }
    
    const recommendations = extractRecommendations(text);
    
    const result: { success: boolean; count: number; recommendations?: Recommendation[]; facebookPost?: string } = {
      success: true,
      count: recommendations.length,
    };
    
    if (format === 'both' || format === 'json') {
      result.recommendations = recommendations;
    }
    
    if (format === 'both' || format === 'facebook') {
      result.facebookPost = generateFacebookPost(recommendations);
    }
    
    return NextResponse.json(result);
    
  } catch (error) {
    console.error('Error parsing recommendations:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ أثناء معالجة النص'
    }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'EGX Recommendation Parser API',
    usage: {
      method: 'POST',
      body: {
        text: 'النص المستخرج من الواتساب',
        format: 'json | facebook | both (default: both)'
      }
    }
  });
}
