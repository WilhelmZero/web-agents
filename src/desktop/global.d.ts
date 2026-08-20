import type { DesktopApi } from './types';

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}
export {};
