# זמן ואזורי זמן (Time & timezones)

מסמך זה מתאר איך הזמן נשמר, איך ממירים אותו, ואיך לאבחן הפרשי שעות (למשל ~2 שעות) בין ה-API ליומן.

## עקרונות

1. **במסד הנתונים (PostgreSQL)** – כל רגע מוחלט (`startTime`, `endTime` בתורים, ב-`SlotHold` וכו') נשמר כ-`timestamptz`, כלומר **אובייקט נקודתי בזמן (instant) ב-UTC**.
2. **לוגיקה עסקית (יום קלנדרי, שעות עבודה, הפסקות)** – נספרים ב-**זמן מקומי של העסק**: השדה `Business.timezone` חייב להיות מזהה IANA תקף (לדוגמה `Asia/Jerusalem`), לא קיזוז קבוע בלבד.
3. **המרות** – בוצעות בגבולות ברורים (API ← → DB) בעזרת **Luxon** (`src/common/time-engine.ts`, `src/common/business-local-time.ts`). אין להניח ש-`Date` ב-JavaScript "מייצג" שעון מקומי של העסק בלי המרה מפורשת.

## איפה מוגדר אזור העסק

- **מודל:** `Business.timezone` ב-`schema.prisma` (ברירת מחדל `"UTC"`).
- **רזולוציה בזמן ריצה:** `resolveBusinessTimeZone()` ב-`business-local-time.ts` – אם הערך ריק/לא תקף, מתקבלת נפילה ל-UTC.

## פונקציות המרה מרכזיות

| פונקציה | קובץ | תפקיד |
|---------|------|--------|
| `getStartOfDay(ymd, timeZone)` | `time-engine.ts` | תחילת יום קלנדרי בעסק (חצות מקומית). |
| `toUtcFromBusinessHhmm(ymd, hhmm, timeZone)` | `time-engine.ts` | **שעון קיר** `HH:mm` ביום `yyyy-mm-dd` **באזור העסק** → `Date` UTC לשמירה. |
| `toBusinessTime(dateUtc, timeZone)` | `time-engine.ts` | אינסטנט מה-DB → זמן תצוגה בעסק. |
| `parseBookingStartUtc` | `date-only.ts` | **Legacy:** בונה `Date.UTC(...)` מ-תאריך + שעה – מתייחס לשעה כאילו היא ב-UTC, **לא** כזמן קיר של העסק. |

## נתיבי API רלוונטיים

- **`GET /booking/availability` (או המסלול המקביל ב-`BookingService.getAvailability`)**  
  - טוען `businessTimezone` מ-`Business`.  
  - `slots` – רשימת מחרוזות `HH:mm` בזמן קיר של העסק.  
  - `slotsDetail` – לכל סלוט: `businessTime` + `startUtc` (אותו רגע כ-ISO ב-UTC), מחושב מ-`getStartOfDay(date).set({ hour, minute }).toUTC()`.

- **יצירת תור (`insertAppointmentOnly` ב-`booking.service.ts`)**  
  - הלקוח שולח `date` (יום עסקי) ו-`startTime` כ-`HH:mm` **בזמן קיר של העסק** (תואם לסלוטים).  
  - השרת ממיר ל-UTC באמצעות `toUtcFromBusinessHhmm(dateYmd, dto.startTime, tz)` לפי `Business.timezone`.

## למה עדיין רואים הפרש של כשעתיים ביומן?

הסיבות הנפוצות:

1. **`Business.timezone` ב-DB שגוי או `UTC`**  
   אם העסק בישראל אך ב-DB עדיין `UTC`, חישוב הסלוטים בשרת יתיישר עם UTC, בעוד הדפדפן מציג לפי אזור אחר → הפרש קבוע (~שעתיים/שלוש בקיץ).

2. **תורים שנוצרו לפני תיקון המרה**  
   רשומות ישנות שנשמרו כאילו `HH:mm` היה UTC יוצגו אחרת אחרי תיקון הקוד. נדרשת בדיקה לפי `startTime.toISOString()` מול `startUtc` צפוי מ-`slotsDetail`.

3. **ערבוב instant מקומי מול UTC ב-Frontend**  
   יש להשתמש באותו מקור אמת: ISO מהשרת + `businessTimezone` (או fallback מתועד בפרונט), ולא `new Date('2026-03-27T10:00:00')` ללא `Z`/offset אם הכוונה היא "10:00 בעסק".

4. **שעון קיץ (DST)**  
   קפיצות של שעה אחת; אם משתמשים בקיזוז קבוע במקום IANA, תופיע סטייה עונתית.

## צ'ק-ליסט אבחון

- [ ] בדוק ב-API העסק/הגדרות: ערך `timezone` = IANA נכון (למשל `Asia/Jerusalem`).
- [ ] השווה `businessTimezone` בתשובת `getAvailability` למה שהיומן משתמש בו (`useResolvedScheduleTimezone` וכו').
- [ ] לסלוט בודד: השווה `slotsDetail[].startUtc` ל-`appointment.startTime` אחרי יצירה.
- [ ] ודא שאין שימוש ב-`parseBookingStartUtc` בנתיבי יצירה חדשים (הוחלף ב-`toUtcFromBusinessHhmm` ביצירת תור).

## קבצים מומלצים לקריאה

- `src/common/time-engine.ts`
- `src/common/business-local-time.ts`
- `src/common/date-only.ts`
- `src/booking/booking.service.ts` (`getAvailability`, `insertAppointmentOnly`)
