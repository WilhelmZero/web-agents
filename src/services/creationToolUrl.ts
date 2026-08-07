import type { CreationTool } from '../types';

export const CREATION_TOOLS: readonly CreationTool[] = [
  'scene',
  'scene-replace',
  'logo',
  'logo-replace',
  'logo-export',
  'paper-text',
  'object-replace',
  'inpaint',
  'product-detail',
];

export function isCreationTool(value: string | null): value is CreationTool {
  return value !== null && CREATION_TOOLS.includes(value as CreationTool);
}

export function readCreationTool(search: string, fallback: CreationTool = 'scene'): CreationTool {
  const value = new URLSearchParams(search).get('tool');
  return isCreationTool(value) ? value : fallback;
}

export function setCreationToolInUrl(href: string, tool: CreationTool): string {
  const url = new URL(href);
  url.searchParams.set('tool', tool);
  return `${url.pathname}${url.search}${url.hash}`;
}
