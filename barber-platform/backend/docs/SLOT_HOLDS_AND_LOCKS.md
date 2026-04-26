# Slot holds ו-LOCK (נעילת סלוט)

## מטרה

**Slot hold** הוא **הזמנה קצרת בזמן (TTL)** על טווח זמן של עובד, לפני אישור סופי לתור. המטרה: למנוע race condition כששני לקוחות בוחרים אותו חלון.

## מימוש בקוד

- שירות: `SlotHoldService` – `src/scheduling-v2/slot-hold.service.ts`
- מודל DB: `SlotHold` – `startTime`, `endTime` (UTC), `expiresAt`, `userId`, `businessId`, `staffId`, `customerId`, `serviceId`

### זרימת יצירה (`createSlotHold`)

1. **ניקוי** – `deleteMany` להחזקות ש-`expiresAt <= now`.
2. **בדיקת התנגשות לתור קיים** – חיפוש `appointment` פעיל (לא מבוטל) עם חפיפה ל-`[startTime, endTime)`.
3. **INSERT** ל-`slot_hold`. אילוץ **EXCLUDE** ב-PostgreSQL על טווחי זמן לפי צוות מונע חפיפה בין החזקות (וכן מסנכרן מול עמיתים) – בפועל מתקבל `ConflictException` עם הקוד **`SLOT_ALREADY_TAKEN`** (`23P01`).

### TTL

- ברירת מחדל: `DEFAULT_HOLD_TTL_SECONDS = 300` (5 דקות), ניתן לעקוף בפרמטר.

### זמן

כל `startTime` / `endTime` / `expiresAt` הם **אינסטנטים ב-UTC** (כמו ב-`Appointment`). יש להעביר מאותם אינסטנטים שמחושבים מ-`toUtcFromBusinessHhmm` או מחישוב זמינות, לא מ"שעה מקומית גולמית" בלי אזור. ראו `TIME_AND_TIMEZONES.md`.

## הפרדה מ-`AvailabilitySlot`

- **`SlotHold`** – שורת DB חיה עם תוקף, לנעילה זמנית.
- **`AvailabilitySlot`** (טבלת Prisma) – מודל פרס-קומפיוט שכרגע **לא** מניע את ה-read path של `getAvailability` (ראו `SLOTS.md`).

## LOCK ברמת התור הסופי (`Appointment`)

הגנה נוספת על "אותו סלוט פיזית":

- **`slotKey`** – מחרוזת ייחודית גלובלית, מקובלת בפורמט `businessId:staffId:YYYY-MM-DD:HH:mm` (ה-`HH:mm` הוא זמן **קיר עסקי** כפי שנשלח ב-API).
- אילוצי **EXCLUDE** על טווחי `startTime`/`endTime` של תורים למניעת חפיפה ברמת DB (בנוסף ללוגיקת אפליקציה).

כך גם בלי hold, שני INSERT-ים מקבילים לא אמורים ליצור שני תורים חופפים.

## סנכרון "בזמן אמת"

אין WebSocket ייעודי. לאחר hold/confirm, לקוחות אחרים רואים עדכון בקריאה הבאה ל-**availability** (ובמידה ו-Redis cache עדיין חי – עד פקיעתו או `bustAvailabilityCache`).

## קבצים

- `src/scheduling-v2/slot-hold.service.ts`
- `prisma/schema.prisma` – `SlotHold`, מיגרציות EXCLUDE הרלוונטיות
- `src/booking/booking.service.ts` – `bustAvailabilityCache`, יצירת `Appointment`
