export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';

const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://127.0.0.1:8010';

// All world currencies - fallback data
const WORLD_CURRENCIES = {
  "USD": {"name": "US Dollar", "name_ar": "دولار أمريكي", "symbol": "$"},
  "EUR": {"name": "Euro", "name_ar": "يورو", "symbol": "€"},
  "GBP": {"name": "British Pound", "name_ar": "جنيه إسترليني", "symbol": "£"},
  "JPY": {"name": "Japanese Yen", "name_ar": "ين ياباني", "symbol": "¥"},
  "CNY": {"name": "Chinese Yuan", "name_ar": "يوان صيني", "symbol": "¥"},
  "INR": {"name": "Indian Rupee", "name_ar": "روبية هندية", "symbol": "₹"},
  "AUD": {"name": "Australian Dollar", "name_ar": "دولار أسترالي", "symbol": "A$"},
  "CAD": {"name": "Canadian Dollar", "name_ar": "دولار كندي", "symbol": "C$"},
  "CHF": {"name": "Swiss Franc", "name_ar": "فرنك سويسري", "symbol": "Fr"},
  "KRW": {"name": "South Korean Won", "name_ar": "وون كوري جنوبي", "symbol": "₩"},
  "SGD": {"name": "Singapore Dollar", "name_ar": "دولار سنغافوري", "symbol": "S$"},
  "HKD": {"name": "Hong Kong Dollar", "name_ar": "دولار هونج كونج", "symbol": "HK$"},
  "NOK": {"name": "Norwegian Krone", "name_ar": "كرون نرويجي", "symbol": "kr"},
  "SEK": {"name": "Swedish Krona", "name_ar": "كرون سويدي", "symbol": "kr"},
  "DKK": {"name": "Danish Krone", "name_ar": "كرون دنماركي", "symbol": "kr"},
  "NZD": {"name": "New Zealand Dollar", "name_ar": "دولار نيوزيلندي", "symbol": "NZ$"},
  "ZAR": {"name": "South African Rand", "name_ar": "راند جنوب أفريقي", "symbol": "R"},
  "RUB": {"name": "Russian Ruble", "name_ar": "روبل روسي", "symbol": "₽"},
  "TRY": {"name": "Turkish Lira", "name_ar": "ليرة تركية", "symbol": "₺"},
  "BRL": {"name": "Brazilian Real", "name_ar": "ريال برازيلي", "symbol": "R$"},
  "MXN": {"name": "Mexican Peso", "name_ar": "بيزو مكسيكي", "symbol": "$"},
  "THB": {"name": "Thai Baht", "name_ar": "بات تايلندي", "symbol": "฿"},
  "IDR": {"name": "Indonesian Rupiah", "name_ar": "روبية إندونيسية", "symbol": "Rp"},
  "MYR": {"name": "Malaysian Ringgit", "name_ar": "رينجيت ماليزي", "symbol": "RM"},
  "PHP": {"name": "Philippine Peso", "name_ar": "بيزو فلبيني", "symbol": "₱"},
  "VND": {"name": "Vietnamese Dong", "name_ar": "دونج فيتنامي", "symbol": "₫"},
  "PLN": {"name": "Polish Zloty", "name_ar": "زلاتي بولندي", "symbol": "zł"},
  "SAR": {"name": "Saudi Riyal", "name_ar": "ريال سعودي", "symbol": "﷼"},
  "AED": {"name": "UAE Dirham", "name_ar": "درهم إماراتي", "symbol": "د.إ"},
  "KWD": {"name": "Kuwaiti Dinar", "name_ar": "دينار كويتي", "symbol": "د.ك"},
  "QAR": {"name": "Qatari Riyal", "name_ar": "ريال قطري", "symbol": "﷼"},
  "BHD": {"name": "Bahraini Dinar", "name_ar": "دينار بحريني", "symbol": "د.ب"},
  "OMR": {"name": "Omani Rial", "name_ar": "ريال عماني", "symbol": "﷼"},
  "EGP": {"name": "Egyptian Pound", "name_ar": "جنيه مصري", "symbol": "ج.م"},
  "ILS": {"name": "Israeli Shekel", "name_ar": "شيكل إسرائيلي", "symbol": "₪"},
  "PKR": {"name": "Pakistani Rupee", "name_ar": "روبية باكستانية", "symbol": "₨"},
  "BDT": {"name": "Bangladeshi Taka", "name_ar": "تاكا بنغلاديشية", "symbol": "৳"},
  "NGN": {"name": "Nigerian Naira", "name_ar": "نايرا نيجيرية", "symbol": "₦"},
  "KES": {"name": "Kenyan Shilling", "name_ar": "شيلينج كيني", "symbol": "KSh"},
  "GHS": {"name": "Ghanaian Cedi", "name_ar": "سيدي غاني", "symbol": "₵"},
  "ETB": {"name": "Ethiopian Birr", "name_ar": "بير إثيوبي", "symbol": "Br"},
  "TZS": {"name": "Tanzanian Shilling", "name_ar": "شيلينج تنزاني", "symbol": "TSh"},
  "UGX": {"name": "Ugandan Shilling", "name_ar": "شيلينج أوغندي", "symbol": "USh"},
  "MAD": {"name": "Moroccan Dirham", "name_ar": "درهم مغربي", "symbol": "د.م."},
  "TND": {"name": "Tunisian Dinar", "name_ar": "دينار تونسي", "symbol": "د.ت"},
  "DZD": {"name": "Algerian Dinar", "name_ar": "دينار جزائري", "symbol": "د.ج"},
  "LYD": {"name": "Libyan Dinar", "name_ar": "دينار ليبي", "symbol": "ل.د"},
  "SDG": {"name": "Sudanese Pound", "name_ar": "جنيه سوداني", "symbol": "ج.س"},
  "JOD": {"name": "Jordanian Dinar", "name_ar": "دينار أردني", "symbol": "د.أ"},
  "LBP": {"name": "Lebanese Pound", "name_ar": "جنيه لبناني", "symbol": "ل.ل"},
  "SYP": {"name": "Syrian Pound", "name_ar": "جنيه سوري", "symbol": "ل.س"},
  "IQD": {"name": "Iraqi Dinar", "name_ar": "دينار عراقي", "symbol": "ع.د"},
  "YER": {"name": "Yemeni Rial", "name_ar": "ريال يمني", "symbol": "﷼"},
  "AFN": {"name": "Afghan Afghani", "name_ar": "أفغاني أفغاني", "symbol": "؋"},
  "IRR": {"name": "Iranian Rial", "name_ar": "ريال إيراني", "symbol": "﷼"},
  "ARS": {"name": "Argentine Peso", "name_ar": "بيزو أرجنتيني", "symbol": "$"},
  "CLP": {"name": "Chilean Peso", "name_ar": "بيزو تشيلي", "symbol": "$"},
  "COP": {"name": "Colombian Peso", "name_ar": "بيزو كولومبي", "symbol": "$"},
  "PEN": {"name": "Peruvian Sol", "name_ar": "سول بيروفي", "symbol": "S/"},
  "CZK": {"name": "Czech Koruna", "name_ar": "كرونا تشيكية", "symbol": "Kč"},
  "HUF": {"name": "Hungarian Forint", "name_ar": "فورنت مجري", "symbol": "Ft"},
  "RON": {"name": "Romanian Leu", "name_ar": "ليو روماني", "symbol": "lei"},
  "BGN": {"name": "Bulgarian Lev", "name_ar": "ليف بلغاري", "symbol": "лв"},
  "HRK": {"name": "Croatian Kuna", "name_ar": "كونا كرواتية", "symbol": "kn"},
  "UAH": {"name": "Ukrainian Hryvnia", "name_ar": "هريفنيا أوكرانية", "symbol": "₴"}
};

export async function GET() {
  try {
    // Try Python backend first
    const response = await fetch(`${PYTHON_API_URL}/api/currency/list`, {
      headers: { 'Accept': 'application/json' },
      });
    
    if (response.ok) {
      const data = await response.json();
      if (data.success) {
        return NextResponse.json(data);
      }
    }
  } catch (error) {
    console.log('[Currency List] Backend unavailable, using fallback');
  }
  
  // Fallback to local data
  return NextResponse.json({
    success: true,
    count: Object.keys(WORLD_CURRENCIES).length,
    currencies: WORLD_CURRENCIES
  });
}
