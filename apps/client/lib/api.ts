const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/;
/** Opened from a phone/LAN address, "localhost" would mean that device: point at the host serving this page instead. */
export function forThisHost(url: string): string {
    if (typeof window === 'undefined' || LOCAL.test(window.location.hostname)) return url;
    try {
        const u = new URL(url);
        if (!LOCAL.test(u.hostname)) return url;
        u.hostname = window.location.hostname;
        return u.pathname === '/' && !url.endsWith('/') ? u.origin : u.toString();
    }
    catch { return url; }
}
export const API = forThisHost(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000');
export const PAYMENTS = forThisHost(process.env.NEXT_PUBLIC_PAYMENTS_URL ?? 'http://localhost:4100');
export class ApiError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export async function request<T>(path: string, body?: unknown, origin = API): Promise<T> {
    const res = await fetch(origin + path, { credentials: 'include', cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
    if (!res.ok) {
        const error = await res.json().catch(() => null);
        throw new ApiError(res.status, error?.error?.message ?? `Request failed (${res.status})`);
    }
    return res.status === 204 ? undefined as T : res.json();
}
export const art = (url: string) => url.startsWith('/') ? API + url : forThisHost(url);
