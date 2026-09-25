import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { AppBar } from '@/components/AppBar';

export const metadata: Metadata = {
  title: 'IDEAX · THAItern',
  description: 'หนึ่งเครื่องยนต์ สองประตู — ห้องเรียนที่มองเห็นกระบวนการคิดกับ AI และโจทย์จริงจาก SMEs และชุมชน',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1B3A5F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link href="https://fonts.googleapis.com/css2?family=Anuphan:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Providers>
          <AppBar />
          <main>
            <div className="wrap">{children}</div>
          </main>
        </Providers>
      </body>
    </html>
  );
}
