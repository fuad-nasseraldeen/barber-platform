# סלוטים (Slots) – הגדרה, שדות ומקורות נתונים

## מה נחשב "סלוט" במסלול החי?

במסגרת `GET availability` (ראו `AVAILABILITY.md`), **סלוט** הוא זמן התחלה אפשרי לתור, מיוצג כרגע בשכבת ה-API כ:

- **`HH:mm`** – שעון קיר ב-**אזור העסק** (`businessTimezone`).
- אופציונלי ב-`slotsDetail`: אותו רגע כ-**`startUtc`** (ISO, UTC).

התחלה אפשרית נגזרת מ:

- חלון **שעות עבודה** של העובד ליום (`StaffWorkingHours` לפי יום בשבוע מקומי).
- **משך השירות** + **buffer לפני/אחרי** (מ-`StaffService` / `Service`, לפי מה שנטען ב-`ComputedAvailabilityService`).
- **הפסקות** שבועיות + **חריגי תאריך**, **חופש מאושר**, **חגי עסק**.
- **תורים קיימים** (תחומי זמן תפוסים) – מוחרגים מהחופש.

שלב הדקות (grid) מוגדר באמצעות הקונפיגורציה, למשל `getAvailabilitySlotStepMinutes` ב־`availability-slot-interval.ts`.

## שדות ב-API (דוגמה מושגית)

| שדה | משמעות מבחינת זמן |
|-----|-------------------|
| `date` | יום קלנדרי בעסק `YYYY-MM-DD`. |
| `slots[]` | רשימת `HH:mm` להתחלה. |
| `slotsDetail[].businessTime` | אותו `HH:mm`. |
| `slotsDetail[].startUtc` | אינסטנט UTC (תואם ל-`businessTime` באותו יום ובאותו `businessTimezone`). |
| `businessTimezone` | IANA zone שנלקח מ-`Business.timezone`. |
| `businessNow` | "עכשיו" בקיר העסק בזמן החישוב (לתצוגה/לוגיקה). |

## טבלת `AvailabilitySlot` ב-Prisma

ב-`schema.prisma` קיימת מודל `AvailabilitySlot` עם שדות כגון:

- `date` (@db.Date)
- `startTime`, `endTime` (מחרוזות `HH:mm`)
- `startMinute`, `endMinute`
- `status` (AVAILABLE / HELD / BOOKED)
- קישורים ל-`Business`, `Staff`, `Service`, לעיתים `appointmentId`

**המצב הנוכחי בקוד:** לא נמצא שימוש ב-`prisma.availabilitySlot` בנתיב ה-read של הזמינות; חישוב הסלוטים הוא **דינמי** דרך `ComputedAvailabilityService`. הטבלה נשארת לסכימה עתידית / אינטגרציות / תכנון מראש אם יופעל מחדש.

## קישור ל-LOCK

זמינות **אינה** "ננעלת" ברמת הסלוט ב-DB בזמן קריאת `GET availability`. נעילה קצרת מתבצעת בנתיבים אחרים (ראו `SLOT_HOLDS_AND_LOCKS.md`) או במניעת כפילות ב-`Appointment` (מפתח ייחודי `slotKey`, אילוצי חפיפה).

## זמן

כל הגדרת סלוט כלפי המשתמש היא **מקומית לעסק**; ה-DB לא מקבל "רשימת מחרוזות" אלא רק **אינסטנטים** בעת יצירת `Appointment`. ראו `TIME_AND_TIMEZONES.md`.
