# תיעוד התראות – תמיכה בשפות (Notifications i18n)

## סקירה

ההתראות במערכת מוצגות בשפה הנבחרת של המשתמש (עברית, ערבית, אנגלית) בהתאם לבחירה ב־LocaleSwitcher.

## סוגי התראות נתמכים

### vacation_requested (בקשת חופשה)

- **מפתחי תרגום:** `notification.vacationRequestedTitle`, `notification.vacationRequestedBody`
- **מקום placeholder:** `{name}` – מוחלף בשם העובד
- **דוגמאות:**
  - עברית: "עובד ביקש חופשה" / "פריד נאצר ביקש חופשה."
  - ערבית: "طلب الموظف إجازة" / "فريد ناصر طلب إجازة."
  - אנגלית: "Employee requested vacation" / "John Doe requested time off."

## מיקום הקוד

| קובץ | תפקיד |
|------|--------|
| `src/lib/i18n.ts` | מפתחי התרגום לכל השפות |
| `src/app/employee/notifications/page.tsx` | דף ההתראות של העובד – `getNotificationDisplay` |
| `src/components/dashboard/notifications.tsx` | תפריט ההתראות ב־TopBar – `getNotificationDisplay` |

## לוגיקת הצגה

1. כשהסוג הוא `vacation_requested`, הפונקציה `getNotificationDisplay` משתמשת בתרגום.
2. שם העובד נלקח מ־`n.data.staffName` (נשלח מה־backend).
3. אם `staffName` חסר, מנסים לחלץ אותו מ־`n.body` (פורמט: "שם requested time off.").
4. אם עדיין אין שם, משתמשים ב־`vacation.me` ("אני" / "Me").

## הוספת סוג התראה חדש

1. הוסף מפתחות ב־`i18n.ts` לכל השפות.
2. עדכן את `getNotificationDisplay` ב־`employee/notifications/page.tsx` וב־`notifications.tsx`.
3. הוסף אייקון ב־`TYPE_ICONS` ב־`notifications.tsx` (אם רלוונטי).
