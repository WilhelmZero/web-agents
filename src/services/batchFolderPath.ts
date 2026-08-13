import { sanitizeFileName } from '../utils';

export function sanitizeRelativeFolderPath(path: string, fallback: string) {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean).map(sanitizeFileName).filter(Boolean);
  return parts.join('/') || sanitizeFileName(fallback);
}
