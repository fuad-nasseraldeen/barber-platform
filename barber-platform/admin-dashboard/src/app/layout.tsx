import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { NotificationProvider } from "@/components/providers/notification-provider";
import { ToastProvider } from "@/components/providers/toast-provider";
import { SessionBootstrap } from "@/components/providers/session-bootstrap";
import { RouteProgressBar } from "@/components/ui/route-progress-bar";

export const metadata: Metadata = {
  title: "תורן | פלטפורמה לזימון תורים",
  description: "פלטפורמה לזימון תורים לעסקים - מספרות, מכוני יופי, חדרי כושר ומרפאות",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=document.documentElement;try{var loc=JSON.parse(localStorage.getItem("locale-storage")||"{}");var dir=loc.state?.dir||"rtl";var lang=loc.state?.locale||"he";s.dir=dir;s.lang=lang;}catch(e){}try{var th=JSON.parse(localStorage.getItem("theme-storage")||"{}");var theme=th.state?.theme||"ocean";var colorScheme=th.state?.colorScheme||"dark";s.setAttribute("data-theme",theme);s.classList.toggle("dark",colorScheme==="dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className="antialiased"
        suppressHydrationWarning
      >
        <RouteProgressBar />
        <QueryProvider>
          <LocaleProvider>
            <SessionBootstrap>
              <NotificationProvider>{children}</NotificationProvider>
            </SessionBootstrap>
            <ToastProvider />
          </LocaleProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
