// Centralized configuration for backend URL, media assets, and API routing
const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};

export const BACKEND_URL = (
  (metaEnv.VITE_BACKEND_URL as string) ||
  (metaEnv.VITE_SERVER_URL as string) ||
  ''
).replace(/\/$/, '');

// Format media URLs (e.g. /uploads/video.mp4 -> https://api.myserver.com/uploads/video.mp4 if external backend)
export function getMediaUrl(url: string | undefined | null): string {
  if (!url) return '';
  if (url.startsWith('/uploads/') && BACKEND_URL) {
    return `${BACKEND_URL}${url}`;
  }
  return url;
}

// Format API URLs (e.g. /api/upload -> https://api.myserver.com/api/upload if external backend)
export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return BACKEND_URL ? `${BACKEND_URL}${cleanPath}` : cleanPath;
}

// Detect if running on Netlify or similar static host without a backend configured
export function isStaticHostWithoutBackend(): boolean {
  if (typeof window === 'undefined') return false;
  const isNetlify =
    window.location.hostname.includes('netlify.app') ||
    window.location.hostname.includes('vercel.app');
  return isNetlify && !BACKEND_URL;
}
