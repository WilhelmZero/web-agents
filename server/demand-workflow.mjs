import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const DEMAND_TYPES = ['main', 'dimensions', 'logo-design', 'scene', 'custom-logo'];
export const DEMAND_PLATFORMS = ['AMAZON', 'ETSY', 'TEMU', 'SHEIN', 'EBAY', 'TIKTOK', 'WAYFAIR', 'WALMART'];
const AUTO_TOOLS = { scene: 'scene', 'custom-logo': 'custom-monochrome-logo' };
const IMAGE_MODELS = new Set(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst']);
const MODEL = 'gpt-6-luna';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizedDemand(input) {
  if (!input || typeof input !== 'object' || !String(input.description || '').trim()) throw new Error('Demand description is required');
  const type = input.type || null;
  const platform = input.platform === 'SHEI' ? 'SHEIN' : input.platform || null;
  if (type && !DEMAND_TYPES.includes(type)) throw new Error('Unsupported image type');
  if (platform && !DEMAND_PLATFORMS.includes(platform)) throw new Error('Unsupported platform');
  const assets = Array.isArray(input.assets) ? input.assets.slice(0, 24).map((item) => ({
    assetId: String(item.assetId || ''), role: item.role === 'source' ? 'source' : 'reference', name: String(item.name || '').slice(0, 255),
  })) : [];
  if (assets.some((item) => !/^[a-f0-9-]{36}$/.test(item.assetId))) throw new Error('Invalid image reference');
  const specifications = Array.isArray(input.specifications) ? input.specifications.slice(0, 20).map((item) => {
    const width = item.width === '' || item.width == null ? null : Number(item.width);
    const height = item.height === '' || item.height == null ? null : Number(item.height);
    const dpi = item.dpi === '' || item.dpi == null ? null : Number(item.dpi);
    const maxMB = item.maxMB === '' || item.maxMB == null ? null : Number(item.maxMB);
    const minLongestEdge = item.minLongestEdge === '' || item.minLongestEdge == null ? null : Number(item.minLongestEdge);
    const ratio = item.ratio === '' || item.ratio == null ? null : Number(item.ratio);
    if ([width, height, dpi, maxMB, minLongestEdge, ratio].some((v) => v !== null && (!Number.isFinite(v) || v <= 0))) throw new Error('Image limits must be positive numbers');
    if ((width && !height) || (!width && height) || (width && height && width * height > 80_000_000)) throw new Error('Invalid output resolution');
    return { id: /^[a-f0-9-]{36}$/.test(item.id || '') ? item.id : randomUUID(), content: String(item.content || '').slice(0, 2000),
      width, height, ratio: width && height ? width / height : ratio, dpi,
      maxMB, minLongestEdge, referenceLinks: Array.isArray(item.referenceLinks) ? item.referenceLinks.slice(0, 10).map((v) => String(v).slice(0, 2000)) : [],
      referenceAssetIds: Array.isArray(item.referenceAssetIds) ? item.referenceAssetIds.filter((id) => assets.some((asset) => asset.assetId === id && asset.role === 'reference')) : [],
      source: item.source && typeof item.source === 'object' ? item.source : undefined };
  }) : [];
  return { title: String(input.title || '').slice(0, 200), description: String(input.description).slice(0, 10000),
    type, platform, presetId: String(input.presetId || '').slice(0, 36) || null, assets,
    specifications: specifications.length ? specifications : [{ id: randomUUID(), content: '', width: null, height: null, ratio: null, dpi: null, maxMB: null, referenceLinks: [], referenceAssetIds: [] }],
    links: Array.isArray(input.links) ? input.links.slice(0, 20).map((v) => String(v).slice(0, 2000)) : [],
  };
}

export function publicDemand(row, operations = []) {
  return { id: row.id, creator: row.creator, assignee: row.assignee, status: row.status, revision: row.revision,
    content: JSON.parse(row.content_json), analysis: row.analysis_json ? JSON.parse(row.analysis_json) : null,
    createdAt: row.created_at, updatedAt: row.updated_at,
    operations: operations.map((op) => ({ id: op.id, kind: op.kind, revision: op.revision, status: op.status,
      result: op.result_json ? JSON.parse(op.result_json) : null, error: op.error_message, createdAt: op.created_at })) };
}

function responseText(value) {
  if (typeof value.output_text === 'string') return value.output_text;
  return (value.output || []).flatMap((item) => item.content || []).filter((item) => item.type === 'output_text').map((item) => item.text).join('\n');
}

function parseAnalysis(value, content) {
  const raw = responseText(value).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const parsed = JSON.parse(raw);
  const tool = AUTO_TOOLS[content.type] || null;
  const requestedTool = parsed.tool === tool ? tool : null;
  return { tool: requestedTool, rationale: String(parsed.rationale || '').slice(0, 1200),
    parameters: {
      model: IMAGE_MODELS.has(parsed.model) ? parsed.model : 'gpt-image-2.5-flare',
      prompts: content.specifications.map((item, index) => String(parsed.prompts?.[index] || item.content || content.description).slice(0, 4000)),
    },
    executable: Boolean(requestedTool && content.assets.some((asset) => asset.role === 'source')) };
}

function modelSize(spec) {
  const ratio = spec.width && spec.height ? spec.width / spec.height : spec.ratio || 1;
  if (ratio > 1.18) return '1536x1024';
  if (ratio < 0.85) return '1024x1536';
  return '1024x1024';
}

async function sourceImage(store, dataDir, content) {
  const source = content.assets.find((item) => item.role === 'source');
  if (!source) throw new Error('A source image is required for automatic execution');
  const asset = await store.getAsset(source.assetId);
  if (!asset || asset.expired || !asset.mime?.startsWith('image/') || !asset.file_path || !path.resolve(asset.file_path).startsWith(path.resolve(dataDir) + path.sep)) throw new Error('Source image is missing or expired');
  return { asset, bytes: await readFile(asset.file_path) };
}

export function createDemandWorker({ store, dataDir, invokeAi }) {
  let draining = false;
  async function analyze(row) {
    const content = JSON.parse(row.content_json);
    const userParts = [{ type: 'input_text', text: JSON.stringify({ description: content.description, type: content.type,
      platform: content.platform, specifications: content.specifications.map(({ content: text, width, height, dpi, maxMB }) => ({ content: text, width, height, dpi, maxMB })) }) }];
    const preview = content.assets.find((item) => item.role === 'source');
    if (preview) {
      const asset = await store.getAsset(preview.assetId);
      if (asset?.file_path && asset.mime?.startsWith('image/')) {
        const thumbnail = await sharp(await readFile(asset.file_path)).resize({ width: 512, height: 512, fit: 'inside' }).png().toBuffer();
        userParts.push({ type: 'input_image', image_url: `data:image/png;base64,${thumbnail.toString('base64')}`, detail: 'low' });
      }
    }
    const body = { model: MODEL, input: [
      { role: 'developer', content: `Analyze a commercial image-production request. Return only JSON: {"tool": "scene"|"custom-monochrome-logo"|null, "model":"gpt-image-2.5-flare", "rationale":"...", "prompts":["one prompt per requested image"]}. Only choose scene for type scene and custom-monochrome-logo for type custom-logo; otherwise null. Preserve the supplied product identity. Never use a reference link as an image source.` },
      { role: 'user', content: userParts },
    ] };
    const { response } = await invokeAi({ path: '/v1/responses', contentType: 'application/json', bytes: Buffer.from(JSON.stringify(body)),
      model: MODEL, tool: 'operating-demand', username: row.creator });
    const analysis = parseAnalysis(JSON.parse(response.toString('utf8')), content);
    await store.updateDemandAnalysis(row.id, row.revision, analysis);
    return analysis;
  }

  async function execute(row, payload) {
    const content = JSON.parse(row.content_json);
    const tool = AUTO_TOOLS[content.type];
    const analysis = payload.analysis;
    if (!tool || analysis?.tool !== tool || !content.assets.some((item) => item.role === 'source')) throw new Error('This request has no verified automatic workflow');
    const { asset: inputAsset, bytes: input } = await sourceImage(store, dataDir, content);
    const outcomes = [];
    for (const [index, spec] of content.specifications.entries()) {
      const operationId = `demand:${row.id}:v${row.revision}:item:${spec.id}`;
      const prior = await store.getResultByOperation(operationId);
      if (prior) { outcomes.push({ index, resultId: prior.id, status: 'completed' }); continue; }
      try {
        const prompt = String(analysis.parameters?.prompts?.[index] || content.description).slice(0, 4000);
        const instructions = tool === 'scene'
          ? `Create a finished commercial product scene based on the FIRST supplied image, which is the original product. Any later images are style references only; do not copy their products. Preserve product shape and branding. ${prompt}`
          : `Create one production-ready high-contrast black-and-white logo/engraving image based on the FIRST supplied original image. Any later images are references only. Preserve the subject's identity, complete contours and recognizability. No gray gradients. ${prompt}`;
        const form = new FormData();
        form.append('model', IMAGE_MODELS.has(analysis.parameters?.model) ? analysis.parameters.model : 'gpt-image-2.5-flare');
        form.append('image', new Blob([input], { type: inputAsset.mime }), inputAsset.name || 'source.png');
        for (const referenceId of (spec.referenceAssetIds || []).slice(0, 3)) {
          if (!content.assets.some((item) => item.assetId === referenceId && item.role === 'reference')) continue;
          const reference = await store.getAsset(referenceId);
          if (reference?.file_path && reference.mime?.startsWith('image/') && path.resolve(reference.file_path).startsWith(path.resolve(dataDir) + path.sep)) {
            form.append('image', new Blob([await readFile(reference.file_path)], { type: reference.mime }), reference.name || 'reference.png');
          }
        }
        form.append('prompt', instructions);
        form.append('size', modelSize(spec));
        form.append('quality', 'high');
        form.append('output_format', 'png');
        const multipart = new Response(form);
        const bytes = Buffer.from(await multipart.arrayBuffer());
        const { response, jobId } = await invokeAi({ path: '/v1/images/edits', contentType: multipart.headers.get('content-type'), bytes,
          model: analysis.parameters?.model || 'gpt-image-2.5-flare', tool, username: row.creator });
        const value = JSON.parse(response.toString('utf8'));
        if (!value.data?.[0]?.b64_json) throw new Error('Image model returned no image');
        const generated = Buffer.from(value.data[0].b64_json, 'base64');
        const originalMeta = await sharp(generated).metadata();
        let pipeline = sharp(generated);
        if (tool === 'custom-monochrome-logo') pipeline = pipeline.grayscale().threshold(150);
        let targetWidth = spec.width;
        let targetHeight = spec.height;
        if (!targetWidth && !targetHeight && spec.ratio && originalMeta.width && originalMeta.height) {
          const area = originalMeta.width * originalMeta.height;
          targetWidth = Math.max(1, Math.round(Math.sqrt(area * spec.ratio)));
          targetHeight = Math.max(1, Math.round(targetWidth / spec.ratio));
        }
        if (!targetWidth && spec.minLongestEdge && originalMeta.width && originalMeta.height && Math.max(originalMeta.width, originalMeta.height) < spec.minLongestEdge) {
          const factor = spec.minLongestEdge / Math.max(originalMeta.width, originalMeta.height);
          targetWidth = Math.round(originalMeta.width * factor);
          targetHeight = Math.round(originalMeta.height * factor);
        }
        if (targetWidth && targetHeight) pipeline = pipeline.resize(targetWidth, targetHeight, { fit: 'contain', background: '#ffffff' });
        const output = await pipeline.withMetadata({ density: spec.dpi || 72 }).png().toBuffer();
        const outputMeta = await sharp(output).metadata();
        if (spec.width && (outputMeta.width !== spec.width || outputMeta.height !== spec.height)) throw new Error('Output resolution does not meet the request');
        if (spec.minLongestEdge && Math.max(outputMeta.width || 0, outputMeta.height || 0) < spec.minLongestEdge) throw new Error('Output is below the required longest edge');
        if (spec.ratio && Math.abs((outputMeta.width || 1) / (outputMeta.height || 1) - spec.ratio) > 0.01) throw new Error('Output aspect ratio does not meet the request');
        if (spec.maxMB && output.length > spec.maxMB * 1024 * 1024) throw new Error(`Image exceeds ${spec.maxMB} MB limit`);
        const name = `${tool}-${row.id.slice(0, 8)}-${index + 1}.png`;
        const filePath = path.join(dataDir, randomUUID());
        await writeFile(filePath, output, { flag: 'wx', mode: 0o600 });
        const assetId = await store.createAsset({ jobId, tool, mime: 'image/png', name, path: filePath, expiresAt: new Date(Date.now() + RETENTION_MS) });
        const result = await store.createResult({ operationId, tool, username: row.creator, name, assetId, jobId,
          exportSpec: { kind: 'demand', demandId: row.id, specificationId: spec.id, dpi: spec.dpi || 72, width: spec.width, height: spec.height } });
        outcomes.push({ index, status: 'completed', resultId: result.id });
      } catch (error) { outcomes.push({ index, status: 'failed', error: error instanceof Error ? error.message : 'Image generation failed' }); }
    }
    return outcomes;
  }

  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const operation = await store.claimDemandOperation();
        if (!operation) break;
        try {
          const demand = await store.getDemand(operation.demand_id);
          if (!demand || demand.revision !== operation.revision) throw new Error('Demand changed; this operation is stale');
          const result = operation.kind === 'analyze' ? await analyze(demand) : await execute(demand, JSON.parse(operation.payload_json || '{}'));
          const failed = Array.isArray(result) && result.some((item) => item.status === 'failed');
          await store.finishDemandOperation(operation.id, failed ? 'failed' : 'completed', result, failed ? 'Some images failed; completed images remain available' : null);
        } catch (error) {
          await store.finishDemandOperation(operation.id, 'failed', null, error instanceof Error ? error.message.slice(0, 1000) : 'Demand operation failed');
        }
      }
    } finally { draining = false; }
  }
  return { drain };
}
