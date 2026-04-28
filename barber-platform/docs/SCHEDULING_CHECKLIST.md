# ✅ Production Scheduling System — Checklist

## 1. DB (Database)

### יש tenantId בכל טבלה?

**תשובה:** כמעט. המערכת משתמשת ב־`businessId` כ־tenant (לא `tenantId`).

| טבלה | businessId | הערה |
|------|------------|------|
| Business | — | זה ה־tenant עצמו |
| BusinessUser, BusinessInvite, StaffInvite | ✅ | יש |
| Branch, Location | ✅ | יש |
| Service, ServiceCategory | ✅ | יש |
| Staff | ✅ | יש |
| Customer | ✅ | יש |
| Appointment | ✅ | יש |
| Waitlist | ✅ | יש |
| Payment, Notification, AuditLog | ✅ | יש |
| BusinessHoliday | ✅ | יש |
| User, UserSettings, RefreshToken | ❌ | גלובליים (זהות) |
| StaffWorkingHours, StaffBreak, StaffBreakException, StaffTimeOff | ❌ | מקושרים דרך Staff→Business |
| StaffAvailabilityCache | ❌ | מקושר דרך Staff |
| Role, Permission | חלקי | Role יכול להיות גלובלי (businessId null) |

**סיכום:** כל הטבלאות העסקיות כוללות `businessId` או מקושרות אליו דרך relations. טבלאות טכניות (User, Token) לא דורשות tenant.

---

### יש relations אמיתיים או סתם IDs?

**תשובה:** יש relations אמיתיים.

- `Appointment` → `customer`, `staff`, `service`, `branch`, `business` (כולם עם `@relation`)
- `Staff` → `business`, `branch`, `user`
- `StaffWorkingHours` → `staff`
- `StaffBreak` → `staff`
- `StaffTimeOff` → `staff`
- `Customer` → `business`, `branch`
- אין שדות ID "עירומים" בלי relation

---

### יש indexes או לא?

**תשובה:** יש indexes.

דוגמאות:
- `@@index([businessId])` — ברוב הטבלאות
- `@@index([staffId, startTime, endTime])` — ב־Appointment
- `@@index([businessId, startTime])` — ב־Appointment
- `@@index([staffId, date])` — ב־StaffBreakException, StaffAvailabilityCache
- `@@index([slotKey])` — ב־Appointment
- `@@unique([businessId, staffId, date, time])` — דרך slotKey

---

## 2. Availability Engine

### האם הוא משלב recurring availability, breaks, overrides?

**תשובה:** כן.

| רכיב | ממומש | איפה |
|------|--------|------|
| **Recurring availability** | ✅ | `StaffWorkingHours` — שעות שבועיות (יום, startTime, endTime) |
| **Breaks** | ✅ | `StaffBreak` (שבועי) + `StaffBreakException` (תאריך ספציפי) |
| **Overrides** | ✅ | `StaffTimeOff` (חופשה) + `BusinessHoliday` (חגים) |

הלוגיקה ב־`AvailabilityWorkerService.computeSlots()`:
1. קורא `StaffWorkingHours` לפי `dayOfWeek`
2. אם אין שעות — מחזיר `[]`
3. קורא `StaffBreak` + `StaffBreakException` ומסנן slots שנמצאים בהפסקה
4. בודק `StaffTimeOff` — אם יש חופשה מאושרת באותו יום — מחזיר `[]`
5. בודק `BusinessHoliday` — אם חג — מחזיר `[]`
6. יוצר slots כל 30 דקות בתוך שעות העבודה, ומדלג על הפסקות

---

### האם הוא מחזיר slots אמיתיים או חרטא?

**תשובה:** slots אמיתיים.

- אין `return ["09:00", "09:30"]` קבוע
- ה־slots נבנים מתוך:
  - שעות עבודה אמיתיות
  - הפסקות אמיתיות
  - חופשות וחגים
- בנוסף: `filterOutBookedAndLocked` מסנן תורים קיימים ו־Redis locks
- התוצאה נשמרת ב־`StaffAvailabilityCache` (DB) וב־Redis

---

## 3. Slot Locking

### האם יש Redis?

**תשובה:** כן.

- `RedisService` + `SlotLockService`
- מפתח: `slot_lock:{tenantId}:{staffId}:{date}:{time}`
- Redis אופציונלי: כשמושבת, יש fallback (ללא lock אמיתי)

---

### האם יש TTL?

**תשובה:** כן.

- `CACHE_TTL.SLOT_LOCK = 600` (10 דקות)
- `WAITLIST_RESERVE = 900` (15 דקות ל־waitlist)
- שימוש ב־`SET key value EX 600 NX` — lock עם TTL

---

### האם יש בדיקה לפני יצירת booking?

**תשובה:** כן (בזרימת confirm).

- `confirmBooking` קורא ל־`verifyLockForDuration` לפני יצירת התור
- אם אין lock תקף — `ConflictException: "Slot lock expired or invalid"`
- אחרי יצירת התור — `releaseLockForDuration` משחרר את ה־lock

**הערה:** `createAppointment` (אדמין) עוקף lock — אין lock, אבל יש unique על `slotKey`.

---

## 4. Booking Validation

### האם יש מניעת overlap?

**תשובה:** חלקית.

| פעולה | overlap check |
|--------|----------------|
| **confirmBooking** | ✅ דרך lock + unique slotKey |
| **updateAppointment** (drag/resize) | ✅ `findFirst` על תורים חופפים |
| **createAppointment** (אדמין) | ⚠️ רק unique על `slotKey` — לא בודק overlap מלא (למשל 9:00–9:30 ו־9:15–9:45) |

**פער:** יצירת תור ידנית על ידי אדמין יכולה ליצור overlap אם ה־slotKeys שונים.

---

### האם יש בדיקה מול availability?

**תשובה:** כן (בזרימות הרלוונטיות).

- **lockSlot** — `validateSlotForLock` קורא ל־`getAvailableSlots` ובודק שה־slot ברשימה
- **confirmBooking** — תלוי ב־lock (שנוצר רק אחרי בדיקת availability)
- **createAppointment** — ❌ אין בדיקה מול availability
- **updateAppointment** — ❌ אין בדיקת availability, רק overlap

---

## 5. Frontend

### האם יש drag & drop אמיתי?

**תשובה:** כן.

- `eventDrop` — גרירת תור בין עובדים או שינוי שעה
- קריאה ל־`PATCH /appointments/:id` עם `staffId`, `startTime`, `endTime`
- במקרה שגיאה — `arg.revert()` להחזרת המצב הקודם
- הפסקות וחופשות — `startEditable: false` (לא ניתנות לגרירה)

---

### האם יש resize?

**תשובה:** כן.

- `eventResize` — שינוי משך התור
- קריאה ל־`PATCH /appointments/:id` עם `startTime`, `endTime`
- בדיקת overlap בצד שרת
- הפסקות וחופשות — `durationEditable: false`

---

### האם eventClick עובד?

**תשובה:** כן.

- `handleEventClick` — לחיצה על תור
- פותח `AppointmentPopup` עם פרטי התור
- רק לתורים (`type === "appointment"`), לא להפסקות/חופשות

---

### או רק UI יפה?

**תשובה:** לא — יש לוגיקה מלאה.

- FullCalendar Premium (resource-timegrid)
- אירועים מה־API
- יצירה, עדכון (drag/resize), ביטול
- הפסקות, חופשות, צבע לפי לקוח

---

## סיכום ציונים

| קריטריון | סטטוס |
|----------|--------|
| DB tenantId | ✅ (businessId) |
| DB relations | ✅ |
| DB indexes | ✅ |
| Availability — recurring | ✅ |
| Availability — breaks | ✅ |
| Availability — overrides | ✅ |
| Availability — slots אמיתיים | ✅ |
| Redis slot lock | ✅ |
| TTL | ✅ (10 דקות) |
| בדיקה לפני confirm | ✅ |
| Overlap — confirm/update | ✅ |
| Overlap — create (אדמין) | ⚠️ חלקי |
| בדיקת availability — create | ❌ |
| Drag & drop | ✅ |
| Resize | ✅ |
| eventClick | ✅ |

---

## פערים מומלצים לתיקון

~~1. **createAppointment** — להוסיף בדיקת overlap מלאה ובדיקה מול availability.~~ ✅ תוקן
~~2. **updateAppointment** — להוסיף בדיקה מול availability (שעות עבודה, הפסקות וכו').~~ ✅ תוקן

## Hardening שבוצע

1. **Unified validation** — `BookingValidationService.validateBookingSlot()` משמש את כל הזרימות (create, confirm, update).
2. **Overlap detection** — `startTime < newEndTime AND endTime > newStartTime` (לא slotKey כ־source of truth).
3. **Cache invalidation** — `invalidateForStaffDate` נקרא ב־create, confirm, cancel, update.
4. **Redis** — ראה `docs/REDIS_PRODUCTION.md`.
