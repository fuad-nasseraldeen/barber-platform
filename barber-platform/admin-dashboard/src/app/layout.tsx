import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/query-provider";
import { LocaleProvider } from "@/components/providers/locale-provider";
import { NotificationProvider } from "@/components/providers/notification-provider";
import { ToastProvider } from "@/components/providers/toast-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var s=document.documentElement;try{var loc=JSON.parse(localStorage.getItem("locale-storage")||"{}");var dir=loc.state?.dir||"ltr";var lang=loc.state?.locale||"en";s.dir=dir;s.lang=lang;}catch(e){}try{var th=JSON.parse(localStorage.getItem("theme-storage")||"{}");var theme=th.state?.theme||"dark";var colorScheme=th.state?.colorScheme||"dark";s.setAttribute("data-theme",theme);s.classList.toggle("dark",colorScheme==="dark");}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        <QueryProvider>
          <LocaleProvider>
            <NotificationProvider>{children}</NotificationProvider>
            <ToastProvider />
          </LocaleProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
