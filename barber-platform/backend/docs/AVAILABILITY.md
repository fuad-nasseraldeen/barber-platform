# מנגנון זמינות תורים (Availability)

תיעוד זרימת **חישוב זמינות** מהבקשה ועד התשובה, כולל מטמון ועדכון – **לא** WebSocket; "כמעט בזמן אמת" תלוי ב-refresh ותוקף ה-cache.

## תמצית ארכיטקטורה

זמינות ליום (או טווח ימים עסקיים) מחושבת **בזיכרון** ב-`ComputedAvailabilityService`, לא על ידי שאילתת `availability_slots` (הטבלה קיימת בסכמה אך אינה בשימוש פעיל בקוד ה-read path הנוכחי).

הכניסה הראשית ל-API: `BookingService.getAvailability()`.

## זרימה מההתחלה ועד הסוף

1. **בקשה** – פרמטרים: `businessId`, `staffId`, `serviceId`, `date` (יום בסיס), `days` (1–7), אופציות: `compact`, `chronologicalSlots`, `maxSlotsPerRow`.

2. **אזור זמן** – נטען `Business.timezone`, מנורמל ב-`ensureValidBusinessZone` / `resolveBusinessTimeZone`.

3. **מפתח מטמון (Redis)** – מחושב מפתח טווח: `availabilityComputedRange(businessId, staffId, serviceId, baseYmd, dayCount)` דרך `CacheService.keys.availabilityComputedRange`.

4. **Cache hit** – אם יש JSON של מפת ימים → `dayMap` משוחזר; מדידות ב-`AvailabilityMetricsService`.

5. **Cache miss** – `ComputedAvailabilityService.getAvailabilityDayMap(...)`:
   - טוען צוות, שעות עבודה, הפסקות, חריגי הפסקה, חופשות, חגי עסק, תורים קיימים, מטא-דאטה של שירות (משך, buffers).
   - לכל יום בטווח: מריץ מנוע חישוב (interval engine + ניקוי חפיפות, חלונות עבודה, דירוג/מגבלות סלוטים).

6. **בניית שורת תגובה לכל יום** – `slots`: מערך `HH:mm`; אופציונלי `slotsDetail` עם `startUtc` + `businessTime`; `businessTimezone`, `businessNow`.

7. **פיזור סלוטים לצופה** – במידת הצורך `diversifySlotsForViewer` (האזנה ל-`viewerUserId`).

## איך המערכת "מתעדכנת"

- **אין דחיפה ללקוח** – עדכון נראה אחרי קריאה מחדש ל-`/availability` או ריענון דף.
- **פקיעת TTL** – `getAvailabilityComputedCacheTtlSec()` קובע כמה זמן תוצאה נשארת ב-Redis לפני חישוב מחדש.

## איך המטמון מתבטל (invalidation / bust)

לאחר פעולות שמשנות תורים/מצב רלוונטי, `BookingService` קורא ל-`bustAvailabilityCache(businessId, staffId, dateYmd)`:

- מוחק דפוס מפתחות מחושבים לפי צוות+תאריך ולפי טווחים (`delPattern` על `availabilityComputedPatternForStaffDate` ו-`availabilityComputedRangePatternForStaff`).

כך הקריאה הבאה ל-`getAvailability` תגרור חישוב מחדש.

## קבצים עיקריים

- `src/booking/booking.service.ts` – `getAvailability`, `bustAvailabilityCache`
- `src/availability/computed-availability.service.ts` – לוגיקת היום והטווח
- `src/availability/interval-availability.engine.ts`, `simple-availability.engine.ts`
- `src/redis/cache.service.ts` – מפתחות ו-TTL

## זמן בעסק מול UTC

כל יום וסלוט מחושבים בקואורדינטות **יום קלנדרי + שעון קיר בעסק**, והפלט כולל גם `startUtc` לכל סלוט. פירוט המרות: ראו `TIME_AND_TIMEZONES.md`.
