# הרשאות עובד (Staff / Employee)

מסמך זה מתאר את ההרשאות, הגישה והמגבלות של משתמש עם תפקיד **עובד** (Staff) במערכת.

---

## 1. הרשאות (Permissions)

לפי `prisma/seed.ts`, תפקיד העובד כולל את ההרשאות הבאות:

| הרשאה | תיאור |
|-------|--------|
| `business:read` | צפייה במידע העסק |
| `staff:read` | צפייה ברשימת עובדים (רק דרך API – לא כל endpoint) |
| `appointment:read` | צפייה בתורים |
| `appointment:update` | עדכון סטטוס תור |
| `customer:read` | צפייה בלקוחות |
| `waitlist:read` | צפייה ברשימת המתנה |
| `waitlist:update` | עדכון רשימת המתנה |
| `location:read` | צפייה במיקומים/סניפים |
| `service:read` | צפייה בשירותים |

---

## 2. כניסה למערכת

כשעובד מתחבר (טלפון או Google):

- הוא מופנה ל־`/employee/dashboard` (בממשק העובד)
- לא לדשבורד המנהלים (`/admin/...`)

---

## 3. מה יש לעובד בממשק (Employee UI)

| עמוד | נתיב | תיאור |
|------|------|--------|
| **Dashboard** | `/employee/dashboard` | דף הבית: תורים להיום, תורים קרובים, סיכום מהיר |
| **Appointments** | `/employee/appointments` | רשימת התורים שלו בלבד |
| **Notifications** | `/employee/notifications` | התראות של העסק |
| **Check-ins** | `/employee/check-ins` | אישור הגעת לקוחות |
| **Vacation** | `/employee/vacation` | צפייה בימי חופשה/מנוחה |
| **Services** | `/employee/services` | צפייה ועריכת שירותים אישיים (מחיר, משך) |
| **Team** | `/employee/team` | צפייה ברשימת עובדים (אם יש הרשאה) |
| **Birthdays** | `/employee/birthdays` | ימי הולדת של עובדים (אם יש הרשאה) |
| **Earnings** | `/employee/earnings` | סיכום הכנסות לפי תקופה |

---

## 4. מה מותר לעובד (API)

### ✅ מותר

| פעולה | Endpoint | הערות |
|-------|----------|--------|
| צפייה בתורים | `GET /appointments` | רק עם `staffId` שלו |
| עדכון סטטוס תור | `POST /appointments/:id/status` | `COMPLETED`, `NO_SHOW` |
| ביטול תור | `POST /appointments/cancel` | |
| צפייה בזמינות | `GET /availability` | |
| צפייה בפרופיל | `GET /staff/me` | |
| עדכון שירותים אישיים | `PATCH /staff/me/services` | מחיר ומשך לכל שירות |
| צפייה בהתראות | `GET /notifications` | |
| צפייה בלקוחות | `GET /customers` | |
| צפייה בשירותים | `GET /services` | |
| צפייה בסניפים | `GET /branches` | |
| צפייה ברשימת המתנה | `GET /waitlist` | |
| עדכון רשימת המתנה | `PATCH /waitlist/:id` | |
| צפייה בביקורי לקוח | `GET /customer-visits` | |

### ⚠️ דורש הרשאה נוספת (אין לעובד בברירת מחדל)

| פעולה | Endpoint | הרשאה חסרה |
|-------|----------|-------------|
| יצירת תור | `POST /appointments/create` | `appointment:create` |
| נעילת משבצת | `POST /appointments/lock` | `appointment:create` |
| אישור הזמנה | `POST /appointments/confirm` | `appointment:create` |
| אישור מרשימת המתנה | `POST /appointments/confirm-from-waitlist` | `appointment:create` |
| יצירת תשלום | `POST /payments/create-intent` | `payment:create` |

### ❌ אסור

| פעולה | הערות |
|-------|--------|
| `GET /staff` | רשימת עובדים – רק למנהלים/בעלים |
| `GET /staff/:id` | פרטי עובד – רק למנהלים/בעלים |
| `POST /staff` | הוספת עובד – רק למנהלים/בעלים |
| `PATCH /staff/:id` | עריכת עובד – רק למנהלים/בעלים |
| `POST /staff/working-hours` | שעות עבודה – רק למנהלים |
| `POST /staff/breaks` | הפסקות – רק למנהלים |
| `POST /staff/time-off` | ימי חופשה – רק למנהלים |
| `GET /analytics` | אנליטיקה – רק למנהלים/בעלים |
| `GET /analytics/dashboard` | דשבורד אנליטיקה – רק למנהלים/בעלים |

---

## 5. סינון נתונים

- **תורים** – כל הבקשות מוגבלות לפי `businessId` ו־`staffId` (העובד רואה רק את התורים שלו).
- **התראות** – לפי `businessId`.
- **לקוחות** – לפי העסק (business).

---

## 6. סיכום

| נושא | עובד |
|------|------|
| **גישה** | ממשק עובד (`/employee/*`) בלבד |
| **תורים** | צפייה, עדכון סטטוס, ביטול – רק לתורים שלו |
| **שירותים** | צפייה ועריכת מחיר/משך לשירותים שלו בלבד |
| **פרופיל** | צפייה ועדכון שירותים דרך `GET /staff/me` |
| **צוות** | אין גישה ל־API רשימת עובדים (רק למנהלים) |
| **אנליטיקה** | אין גישה |
| **הגדרות** | אין גישה |
