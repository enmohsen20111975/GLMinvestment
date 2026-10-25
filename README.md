# GLMinvestment — دليل الاستثمار

> **منصة استثمار متكاملة** للبورصة المصرية (EGX) + الأسواق العربية + الكريبتو + الذهب.
>
> **الإنتاج:** `https://invist.m2y.net` · **GitHub:** `https://github.com/enmohsen20111975/GLMinvestment` · **الإصدار:** `3.4.41`
>
> ⚠️ **التوثيق الكامل في `Documentation/`** — هذا الملف مختصر فقط. اقرأ `Documentation/README.md` للنظرة الشاملة.

---

## 📚 التوثيق (5 ملفات + الدستور)

كل التوثيق في `Documentation/`:

| الملف | المحتوى |
|---|---|
| `00-CONSTITUTION.md` | الدستور الحاكم (76 قاعدة) — **لا يُلمس إلا بأمر المالك** |
| `README.md` | نظرة عامة شاملة + خريطة + تشغيل + حالة |
| `01-ARCHITECTURE.md` | البنية التقنية (ألفا + برافو + data_engine + services + ports + data flow) |
| `02-DATABASES-AND-DATA.md` | 17 DB + Prisma schemas + canonical data map + مصادر البيانات + التعارضات |
| `03-ENGINES-AND-LOGIC.md` | V40.2 + 30+ محلل + ML + AI + رادار + باك تست + مخاطر + عتبات الإشارة |
| `04-TEAM.md` | الفريق: المالك + جيمي + جون + ألفا + برافو + الوكلاء |

> التوثيق القديم المؤرشف في `Documentation/archive/` — مرجع تاريخي فقط، **المصدر الحي هو الـ 5 ملفات أعلاه + الدستور.**

---

## 🚀 التشغيل السريع

```bash
# تثبيت
bun install
cd vps-service && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && cd ..
cd data_engine && pip install -r requirements.txt && cd ..
bunx prisma db push --schema=prisma/auth-schema.prisma
bunx prisma db push --schema=prisma/predictions-schema.prisma

# تشغيل (تطوير)
bun run dev                                    # Next.js → port 3000
cd vps-service && python3 main.py              # Python backend → port 8010
cd data_engine && python3 main.py              # Data engine → port 5000
cd vps-service/ws-service && bun run dev       # WebSocket → port 3005

# تشغيل (إنتاج)
pm2 start ecosystem.config.js                  # 8 خدمات
```

### 📦 تنزيل قواعد البيانات (DBs خارج git tracking)

الـ DBs مش متتبعة في git (كبيرة ~500MB — استنزاف bandwidth مع كل `git pull`).
نزّلها يدوي من **GitHub Releases**:

**أحدث snapshot:**
> 🔗 https://github.com/enmohsen20111975/GLMinvestment/releases/tag/db-snapshot-2026-10-24
>
> فيه: `predictions.db` (محدّث 2026-10-22، 2256 توقع) + ملفات `data/` (JSON + Pine scripts).

**snapshot كامل (كل الـ DBs):**
> 🔗 https://github.com/enmohsen20111975/GLMinvestment/releases/tag/db-snapshot-2026-10-21
>
> فيه: `price_history.db` (حتى 2026-06-10), `stocks.db`, `predictions.db` (قديم), `data_engine.db`, `intraday.db` — 16 جزء (306MB).

```bash
# للـ snapshot الكامل (2026-10-21):
# 1. نزّل كل أجزاء الـ snapshot المطلوب (9 أجزاء)
# 2. ادمج الـ .part files:
cat db_backup_2026-10-21T19-15-52_part2_split_00.zip.part \
    db_backup_2026-10-21T19-15-52_part2_split_01.zip.part \
    > db_backup_2026-10-21T19-15-52_part2.zip

# 3. فك ضغط كل الـ .zip في فولدر db/
unzip 'db_backup_2026-10-21T19-15-52_part*.zip' -d db/

# للـ snapshot المحدّث (2026-10-24 — predictions.db فقط):
unzip predictions.db.zip -d db/
```

---

## 📊 الـ Stack (من `package.json` + الكود)

- **الفرونت (ألفا)**: Next.js 14.2.28 + React 18 + TypeScript 5 + Tailwind 3 + Prisma 5.22 + Zustand 5
- **الباك (برافو)**: Python 3.11 + FastAPI + Flask + Socket.io
- **DBs**: SQLite (17 قاعدة — شوف `Documentation/02-DATABASES-AND-DATA.md`)
- **AI**: Ollama (محلي) + DeepSeek API + z-ai-web-dev-sdk
- **Gateway**: Caddy (port 81) · **Process Manager**: PM2 (8 خدمات)

> ⚠️ **ملاحظة**: التوثيق القديم كان بيقول "Next.js 16" — ده **كاذب**. الكود الفعلي Next.js **14.2.28**.

---

## 📁 بنية سريعة

```
src/           # ألفا — الفرونت (Next.js, 113 API route, SPA)
vps-service/   # برافو — الباك بايثون (FastAPI 8010, V40.2 engine)
data_engine/   # برافو — سحب الأسعار (Flask 5000, 20+ scraper)
news-agent/    # خدمة أخبار منفصلة
prisma/        # schemas (auth + predictions)
db/            # SQLite DBs (gitignored — متولّدة من data_engine)
Documentation/ # التوثيق (5 ملفات + دستور + أرشيف)
worklog.md     # سجل العمل الحي (دليل المالك)
SESSION-STATE.md # حالة الجلسة الحالية
```

---

## 📖 ترتيب القراءة (إلزامي)

1. `Documentation/00-CONSTITUTION.md` — الدستور
2. `Documentation/README.md` — نظرة عامة
3. `Documentation/01-ARCHITECTURE.md` — المعمارية
4. `Documentation/02-DATABASES-AND-DATA.md` — الـ DBs
5. `Documentation/03-ENGINES-AND-LOGIC.md` — المحركات
6. `Documentation/04-TEAM.md` — الفريق
7. `SESSION-STATE.md` — حالة الجلسة
8. `worklog.md` — آخر ~150 سطر

---

*هذا الملف مختصر. للتفاصيل الكاملة، اقرأ `Documentation/`.*
