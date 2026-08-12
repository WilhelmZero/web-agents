import type { GeneratedImage, ImageModel, ImageSize, SceneLogoStyle } from '../types';
import { fileToBase64 } from '../utils';
import type { CombinedLogoProfile, CombinedSceneAnalysis, CombinedVerification } from './combinedReplace';
import { startRequestConsoleEntry, updateRequestConsoleEntry } from './requestConsole';

type Base = { provider: 'gemini' | 'openai'; apiKey: string; model: string; apiBaseUrl?: string | null; signal?: AbortSignal };
const OPENAI_ROOT = 'https://api.openai.com/v1';
const outputText = (data: any) => data?.output_text || data?.output?.flatMap((x: any) => x.content || []).map((x: any) => x.text || '').join('') || '';

export function toGeminiResponseSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiResponseSchema);
  if (!schema || typeof schema !== 'object') return schema;
  return Object.fromEntries(Object.entries(schema as Record<string, unknown>)
    .filter(([key]) => key !== 'additionalProperties')
    .map(([key, value]) => [key, toGeminiResponseSchema(value)]));
}

async function requestJson(options: Base & { images: Array<File | Blob>; prompt: string; schema: object; name: string }) {
  const images = await Promise.all(options.images.map(async (image) => ({ mime: image.type || 'image/png', data: await fileToBase64(image) })));
  const startedAt = performance.now();
  const consoleId = startRequestConsoleEntry({ model: options.model, connection: options.provider === 'openai' ? 'direct' : options.apiBaseUrl ? 'proxy' : 'direct', requestSummary: `Combined replace analysis/verification - ${images.length} images` });
  try {
    let raw = '';
    if (options.provider === 'openai') {
      const response = await fetch(`${OPENAI_ROOT}/responses`, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify({ model: options.model, input: [{ role: 'user', content: [{ type: 'input_text', text: options.prompt }, ...images.map((image) => ({ type: 'input_image', image_url: `data:${image.mime};base64,${image.data}`, detail: 'high' }))] }], text: { format: { type: 'json_schema', name: options.name, strict: true, schema: options.schema } } }) });
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed (HTTP ${response.status})`); raw = outputText(data);
    } else {
      const endpoint = options.apiBaseUrl ? `${options.apiBaseUrl.replace(/\/$/, '')}/models/${options.model}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
      const response = await fetch(endpoint, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(options.apiBaseUrl ? { 'x-goog-api-key': options.apiKey } : {}) }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: options.prompt }, ...images.map((image) => ({ inlineData: { mimeType: image.mime, data: image.data } }))] }], generationConfig: { responseMimeType: 'application/json', responseSchema: toGeminiResponseSchema(options.schema) } }) });
      const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed (HTTP ${response.status})`); raw = data?.candidates?.flatMap((x: any) => x.content?.parts || []).map((x: any) => x.text || '').join('') || '';
    }
    if (!raw) throw new Error('The model returned no structured result'); const parsed = JSON.parse(raw); updateRequestConsoleEntry(consoleId, { status: 'success', durationMs: Math.round(performance.now() - startedAt), message: 'Analysis complete' }); return parsed;
  } catch (error) { updateRequestConsoleEntry(consoleId, { status: options.signal?.aborted ? 'stopped' : 'failed', durationMs: Math.round(performance.now() - startedAt), message: error instanceof Error ? error.message : 'Request failed' }); throw error; }
}

const styleSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: { type: 'string' }, subject: { type: 'string' }, composition: { type: 'string' }, camera: { type: 'string' }, lighting: { type: 'string' }, individualPrompt: { type: 'string' },
    styles: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, label: { type: 'string' }, description: { type: 'string' }, occurrences: { type: 'integer' }, carrier: { type: 'string' } }, required: ['id', 'label', 'description', 'occurrences', 'carrier'] } },
  }, required: ['summary', 'subject', 'composition', 'camera', 'lighting', 'individualPrompt', 'styles'],
};
export async function analyzeCombinedScene(options: Base & { scene: File; sceneId: string; optimizeIndividual: boolean }): Promise<CombinedSceneAnalysis> {
  const prompt = `Analyze this source scene. Describe subject, cups, people, poses, hand gestures, camera, composition, light and materials. Find every brand logo style. Different graphics or typography are different styles; merge repeated instances and count occurrences. ${options.optimizeIndividual ? 'Create an image-specific supplemental edit instruction that preserves all positions, gestures and cup geometry.' : 'Return an empty individualPrompt.'} Return all prose in Simplified Chinese.`;
  const parsed = await requestJson({ ...options, images: [options.scene], name: 'combined_scene_analysis', schema: styleSchema, prompt });
  return { ...parsed, sceneId: options.sceneId, styles: (parsed.styles || []).map((style: SceneLogoStyle, index: number) => ({ ...style, id: style.id || `${options.sceneId}-style-${index + 1}`, occurrences: Math.max(1, Number(style.occurrences) || 1) })) };
}

const logosSchema = {
  type: 'object', additionalProperties: false,
  properties: { logos: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { index: { type: 'integer' }, summary: { type: 'string' }, style: { type: 'string' }, colors: { type: 'string' }, suitableFor: { type: 'array', items: { type: 'string' } } }, required: ['index', 'summary', 'style', 'colors', 'suitableFor'] } } },
  required: ['logos'],
};
export async function analyzeCombinedLogos(options: Base & { logos: File[]; logoIds: string[] }): Promise<CombinedLogoProfile[]> {
  const parsed = await requestJson({ ...options, images: options.logos, name: 'combined_logo_analysis', schema: logosSchema, prompt: 'Analyze each logo in input order: graphic, text, proportions, style, colors, complexity and suitable carriers/scenes. index starts at 1. Return prose in Simplified Chinese.' });
  return (parsed.logos || []).map((logo: any, index: number) => ({ logoId: options.logoIds[Math.max(0, Number(logo.index || index + 1) - 1)] || options.logoIds[index], summary: logo.summary || '', style: logo.style || '', colors: logo.colors || '', suitableFor: logo.suitableFor || [] }));
}

export async function generateCombinedReplacement(options: Base & { scene: File; logos: File[]; prompt: string; imageModel: ImageModel | 'gpt-image-2'; imageSize: ImageSize; quality: 'high' | 'medium' | 'low'; aspectRatio: string }): Promise<GeneratedImage> {
  const startedAt = performance.now(); const consoleId = startRequestConsoleEntry({ model: options.imageModel, connection: options.provider === 'openai' ? 'direct' : options.apiBaseUrl ? 'proxy' : 'direct', requestSummary: `Combined scene and logo edit - ${options.logos.length + 1} inputs` });
  try {
    let blob: Blob;
    if (options.provider === 'openai') {
      const form = new FormData(); [options.scene, ...options.logos].forEach((file) => form.append('image[]', file, file.name)); form.append('prompt', options.prompt); form.append('model', options.imageModel); form.append('n', '1'); form.append('size', 'auto'); form.append('quality', options.quality); form.append('output_format', 'png');
      const response = await fetch(`${OPENAI_ROOT}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}` }, body: form, signal: options.signal }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `OpenAI image request failed (HTTP ${response.status})`); const item = data?.data?.[0]; if (item?.b64_json) blob = new Blob([Uint8Array.from(atob(item.b64_json), (char) => char.charCodeAt(0))], { type: 'image/png' }); else if (item?.url) { const image = await fetch(item.url, { signal: options.signal }); blob = await image.blob(); } else throw new Error('OpenAI returned no image');
    } else {
      const files = [options.scene, ...options.logos]; const parts = await Promise.all(files.map(async (file) => ({ inlineData: { mimeType: file.type, data: await fileToBase64(file) } }))); const endpoint = options.apiBaseUrl ? `${options.apiBaseUrl.replace(/\/$/, '')}/models/${options.imageModel}:generateContent` : `https://generativelanguage.googleapis.com/v1beta/models/${options.imageModel}:generateContent?key=${encodeURIComponent(options.apiKey)}`; const response = await fetch(endpoint, { method: 'POST', signal: options.signal, headers: { 'Content-Type': 'application/json', ...(options.apiBaseUrl ? { 'x-goog-api-key': options.apiKey } : {}) }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: options.prompt }, ...parts] }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { imageSize: options.imageSize, ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {}) } } }) }); const data = await response.json().catch(() => null); if (!response.ok) throw new Error(data?.error?.message || `Gemini image request failed (HTTP ${response.status})`); const part = data?.candidates?.flatMap((x: any) => x.content?.parts || []).find((x: any) => x.inlineData?.data); if (!part) throw new Error('Gemini returned no image'); blob = new Blob([Uint8Array.from(atob(part.inlineData.data), (char) => char.charCodeAt(0))], { type: part.inlineData.mimeType || 'image/png' });
    }
    updateRequestConsoleEntry(consoleId, { status: 'success', durationMs: Math.round(performance.now() - startedAt), message: 'Combined edit complete', outputImages: [blob] }); return { blob, mimeType: blob.type || 'image/png' };
  } catch (error) { updateRequestConsoleEntry(consoleId, { status: options.signal?.aborted ? 'stopped' : 'failed', durationMs: Math.round(performance.now() - startedAt), message: error instanceof Error ? error.message : 'Generation failed' }); throw error; }
}

const verifySchema = {
  type: 'object', additionalProperties: false,
  properties: { passed: { type: 'boolean' }, scenePassed: { type: 'boolean' }, logoPassed: { type: 'boolean' }, sceneIssues: { type: 'array', items: { type: 'string' } }, logoIssues: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' } },
  required: ['passed', 'scenePassed', 'logoPassed', 'sceneIssues', 'logoIssues', 'summary'],
};
export async function verifyCombinedReplacement(options: Base & { original: File; logos: File[]; generated: Blob; styles: SceneLogoStyle[] }): Promise<CombinedVerification> {
  const prompt = `The first image is the source scene, the next ${options.logos.length} images are mapped replacement logos, and the last image is the generated result. Strictly verify scene target, camera and composition, unchanged cup geometry/size/direction/position, and unchanged people positions/poses/gestures. Separately verify all ${options.styles.length} original logo styles were replaced consistently, logo graphics/text are accurate, old logos are gone, and material/curvature/perspective integration is natural rather than a flat overlay. Any failed item means passed=false. Return issues and summary in Simplified Chinese.`;
  const parsed = await requestJson({ ...options, images: [options.original, ...options.logos, options.generated], name: 'combined_replacement_verification', schema: verifySchema, prompt });
  return { ...parsed, passed: Boolean(parsed.passed && parsed.scenePassed && parsed.logoPassed), sceneIssues: parsed.sceneIssues || [], logoIssues: parsed.logoIssues || [] };
}
