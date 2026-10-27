import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "./globals.css";

export const metadata: Metadata = { title: "Printing gate ERP | بوابة الطباعة", description: "نظام إدارة شركة بوابة الطباعة للدعاية والإعلان" };
// عرض الجهاز، والتكبير مسموح (لا maximumScale ولا userScalable=false)، وviewport-fit لحواف الشاشات ذات النتوء
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#14213D" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('gp-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}` }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
