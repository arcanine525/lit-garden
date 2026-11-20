import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../../docs/research/vuon-van-ca-nhan.pages.dev/source/fonts-local.css';
import './style.css';

export const metadata: Metadata = {
  title: 'Vườn Văn',
  description: 'Không gian dạy và học viết'
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function Layout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="vi"><body>{children}</body></html>;
}
