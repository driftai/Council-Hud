import type {Metadata} from 'next';
import './globals.css';
import { NexusProvider } from '@/providers/NexusProvider';

export const metadata: Metadata = {
  title: 'Council HUD | AI Surveillance System',
  description: 'Advanced monitoring and control interface for autonomous AI agents.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased selection:bg-primary/30 selection:text-primary">
        <NexusProvider>
          {children}
        </NexusProvider>
      </body>
    </html>
  );
}
