import type { Metadata, Viewport } from 'next';
import './brand-tokens.css';
import './style.css';
import './polish.css';
import './mono.css';
import Splash from './splash';
export const metadata: Metadata = { title: 'FaZe Vault | Collector Cards', description: 'Collect moments. Build your legacy. Demo collector cards.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#111111' };
export default function Layout({ children }: Readonly<{
    children: React.ReactNode;
}>) { return <html lang="en"><body className="mono-theme"><Splash>{children}</Splash></body></html>; }
