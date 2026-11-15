import type { Metadata } from 'next';
import './style.css';
export const metadata: Metadata = { title: 'FaZe Vault | Collector Cards', description: 'Collect moments. Build your legacy. Demo collector cards.' };
export default function Layout({children}: Readonly<{children:React.ReactNode}>) { return <html lang="en"><body>{children}</body></html>; }
