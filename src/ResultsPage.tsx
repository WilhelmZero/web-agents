import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Checkbox, Empty, Image, InputNumber, Select, Space, Tag, Typography } from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { downloadBlob, mimeExtension, sanitizeFileName } from './utils';
import type { RenderParams } from './services/engraving/types';
import type { WrapDesign, PrintSettings } from './services/cupWrap/types';
import UsageDashboard from './UsageDashboard';
import type { UsageRow } from './services/usageDashboard';

interface Result {
  id: string; operationId: string; tool: string; username: string; name: string;
  assetId: string; jobId?: string; mime: string; expired: boolean; createdAt: string;
  exportSpec: Record<string, unknown>;
}
interface Job {
  id: string; tool: string; username: string; provider: string; model: string;
  status: string; imageCount: number; error?: string; createdAt: string;
  assets?: Array<{ id: string; name: string; mime: string; expired: boolean }>;
}

const statusColor = (status: string) => status === 'success' ? 'green' : ['failed', 'interrupted'].includes(status) ? 'red' : status === 'queued' ? 'gold' : 'blue';
const statusLabel = (status: string, en: boolean) => ({ queued: en ? 'Queued' : '排队中', running: en ? 'Running' : '进行中', success: en ? 'Complete' : '已完成', failed: en ? 'Failed' : '失败', interrupted: en ? 'Interrupted' : '已中断', cancelled: en ? 'Cancelled' : '已取消' })[status as 'queued' | 'running' | 'success' | 'failed' | 'interrupted' | 'cancelled'] || status;
const nameFor = (result: Result) => sanitizeFileName(result.name || `${result.tool}.${mimeExtension(result.mime)}`);

export default function ResultsPage({ labels, language }: { labels: Record<string, string>; language: 'zh-CN' | 'en-US' }) {
  const en = language === 'en-US';
  const [results, setResults] = useState<Result[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [tool, setTool] = useState('all');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminUsage, setAdminUsage] = useState<UsageRow[] | null>(null);
  const [dpiById, setDpiById] = useState<Record<string, number>>({});
  const [formatById, setFormatById] = useState<Record<string, string>>({});

  const refresh = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ limit: '40', offset: String(offset) });
      if (tool !== 'all') query.set('tool', tool);
      if (status === 'success') query.set('status', 'available');
      if (status === 'expired') query.set('status', 'expired');
      const [resultResponse, jobResponse, usageResponse] = await Promise.all([
        fetch(`/api/results?${query}`), fetch('/api/jobs'),
        isAdmin ? fetch('/api/admin/usage').catch(() => null) : Promise.resolve(null),
      ]);
      if (!resultResponse.ok || !jobResponse.ok) throw new Error(en ? 'Cannot load results' : '无法读取生成结果');
      const batch = await resultResponse.json() as Result[];
      const visibleBatch = ['all', 'success', 'expired'].includes(status) ? batch : [];
      setResults((current) => offset ? [...current, ...visibleBatch] : visibleBatch);
      setHasMore(visibleBatch.length === 40);
      setJobs(await jobResponse.json() as Job[]);
      if (usageResponse?.ok) setAdminUsage(await usageResponse.json() as UsageRow[]);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setLoading(false); }
  }, [tool, status, en, isAdmin]);

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener('studio:results-updated', onUpdate);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 10_000);
    return () => { window.removeEventListener('studio:results-updated', onUpdate); window.clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    void fetch('/api/auth/session').then(async (response) => {
      if (response.ok) setIsAdmin(Boolean((await response.json() as { admin?: boolean }).admin));
    }).catch(() => {});
  }, []);

  const visibleJobs = useMemo(() => jobs.filter((job) => tool === 'all' || job.tool === tool).filter((job) => status === 'all' || status === job.status || (status === 'failed' && job.status === 'interrupted')), [jobs, tool, status]);
  const selectedResults = results.filter((item) => selected.includes(item.id) && !item.expired);

  async function fetchAsset(id: string): Promise<Blob> {
    const response = await fetch(`/api/assets/${id}`);
    if (!response.ok) throw new Error(response.status === 410 ? (en ? 'Image expired' : '图片已过期') : `HTTP ${response.status}`);
    return response.blob();
  }
  async function fetchImage(result: Result): Promise<Blob> {
    const spec = result.exportSpec;
    if (spec.kind === 'engraving' && typeof spec.sourceAssetId === 'string' && spec.params && typeof spec.params === 'object') {
      const params = spec.params as RenderParams;
      const dpi = dpiById[result.id] || params.dpi;
      if (dpi !== params.dpi) {
        const source = await fetchAsset(spec.sourceAssetId);
        let eraseMask: string | undefined;
        if (typeof spec.maskAssetId === 'string') {
          const mask = await fetchAsset(spec.maskAssetId);
          eraseMask = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(mask); });
        }
        const { processInWorker } = await import('./services/engraving/workerClient');
        return (await processInWorker(source, { ...params, dpi, eraseMask })).buffer;
      }
    }
    return fetchAsset(result.assetId);
  }
  async function decodeAssets(value: unknown): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map(decodeAssets));
    if (value && typeof value === 'object') {
      const entry = value as Record<string, unknown>;
      if (typeof entry.__studioResultAsset === 'string') return fetchAsset(entry.__studioResultAsset);
      const output: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(entry)) output[key] = await decodeAssets(item);
      return output;
    }
    return value;
  }
  async function downloadFile(result: Result): Promise<{ blob: Blob; filename: string }> {
    const spec = result.exportSpec;
    const format = formatById[result.id] || 'png';
    if (spec.kind === 'cup-wrap' && spec.design && spec.print) {
      const design = await decodeAssets(spec.design) as WrapDesign;
      const print = { ...(spec.print as PrintSettings), dpi: dpiById[result.id] || (spec.print as PrintSettings).dpi };
      const stem = nameFor(result).replace(/\.[^.]+$/, '');
      if (format === 'pdf') {
        const { exportPdf } = await import('./services/cupWrap/pdf');
        return { blob: await exportPdf([design], print), filename: `${stem}.pdf` };
      }
      const { work } = await import('./services/cupWrap/client');
      if (format === 'tiff') {
        const bytes = await work<ArrayBuffer>({ kind: 'tiff', design, dpi: print.dpi, bleed: print.bleed, cutLine: print.cutLine });
        return { blob: new Blob([bytes], { type: 'image/tiff' }), filename: `${stem}.tif` };
      }
      return { blob: await work<Blob>({ kind: 'png', design, dpi: print.dpi, bleed: print.bleed, cutLine: print.cutLine, preview: false }), filename: `${stem}.png` };
    }
    if (result.tool === 'paper-text' && ['svg', 'vector-svg'].includes(format)) {
      const image = await fetchAsset(result.assetId);
      const stem = nameFor(result).replace(/\.[^.]+$/, '');
      if (format === 'svg') {
        const { createEmbeddedImageSvg } = await import('./services/svgExport');
        return { blob: await createEmbeddedImageSvg(image, stem), filename: `${stem}.svg` };
      }
      const { vectorizeImageToSvg } = await import('./services/trueVectorExport');
      return { blob: await vectorizeImageToSvg(image), filename: `${stem}_vector.svg` };
    }
    if (result.tool === 'background-removal' && format === 'vector-svg') {
      const { vectorizeImageToSvg } = await import('./services/trueVectorExport');
      return { blob: await vectorizeImageToSvg(await fetchAsset(result.assetId)), filename: `${nameFor(result).replace(/\.[^.]+$/, '')}.svg` };
    }
    if (result.tool === 'ai-pet-letter-stickers' && ['high-res', 'transparent', 'transparent-high-res'].includes(format)) {
      const { resizeForDownload } = await import('./services/aiPetLetters/image');
      const transparent = format.startsWith('transparent') && typeof spec.sourceAssetId === 'string';
      const source = await fetchAsset(transparent ? String(spec.sourceAssetId) : result.assetId);
      const highRes = format === 'high-res' || format === 'transparent-high-res';
      return { blob: await resizeForDownload(source, highRes ? 'high-res' : 'native', { width: Number(spec.width), height: Number(spec.height) }), filename: `${nameFor(result).replace(/\.[^.]+$/, '')}${transparent ? '_透明' : ''}${highRes ? '_HD' : ''}.png` };
    }
    return { blob: await fetchImage(result), filename: nameFor(result) };
  }
  async function downloadSelected() {
    if (!selectedResults.length) return;
    setBusy(true);
    try {
      if (selectedResults.length === 1) {
        const result = selectedResults[0];
        const file = await downloadFile(result);
        downloadBlob(file.blob, file.filename);
      } else {
        const zip = new JSZip();
        const names = new Set<string>();
        for (const result of selectedResults) {
          const file = await downloadFile(result);
          let filename = `${result.tool}/${file.filename}`;
          if (names.has(filename)) filename = `${result.tool}/${result.id.slice(0, 8)}_${file.filename}`;
          names.add(filename);
          zip.file(filename, file.blob);
        }
        downloadBlob(await zip.generateAsync({ type: 'blob' }), 'studio-results.zip');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  async function cancelJob(id: string) {
    const response = await fetch(`/api/jobs/${id}/cancel`, { method: 'POST' });
    if (!response.ok) { setError(en ? 'The job has already started' : '任务已开始，无法取消排队'); return; }
    void refresh();
  }

  return <section style={{ padding: '24px 28px', maxWidth: 1440, margin: '0 auto' }}>
    <Space style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 18 }}>
      <div><Typography.Title level={2} style={{ marginBottom: 4 }}>{en ? 'Generated results' : '生成结果'}</Typography.Title><Typography.Text type="secondary">{en ? 'Final images are kept for 30 days. Source uploads are not listed here.' : '仅展示最终图片；图片保存 30 天，上传原图不会列在这里。'}</Typography.Text></div>
      <Space wrap><Select value={tool} style={{ minWidth: 190 }} onChange={(value) => { setTool(value); setSelected([]); }} options={[{ value: 'all', label: en ? 'All tools' : '全部工具' }, ...Object.entries(labels).map(([value, label]) => ({ value, label }))]} /><Select value={status} style={{ minWidth: 130 }} onChange={(value) => { setStatus(value); setSelected([]); }} options={[{ value: 'all', label: en ? 'All status' : '全部状态' }, { value: 'success', label: en ? 'Complete' : '已完成' }, { value: 'queued', label: en ? 'Queued' : '排队中' }, { value: 'running', label: en ? 'Running' : '进行中' }, { value: 'failed', label: en ? 'Failed' : '失败' }, { value: 'expired', label: en ? 'Expired' : '已过期' }]} /><Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>{en ? 'Refresh' : '刷新'}</Button></Space>
    </Space>
    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} style={{ marginBottom: 16 }} />}
    {isAdmin && adminUsage && <UsageDashboard rows={adminUsage} labels={labels} language={language} tool={tool} />}
    <Card title={en ? 'Final images' : '最终图片'} extra={<Space><Checkbox checked={results.some((item) => !item.expired) && results.filter((item) => !item.expired).every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? results.filter((item) => !item.expired).map((item) => item.id) : [])}>{en ? 'Select all' : '全选'}</Checkbox><Button type="primary" icon={<DownloadOutlined />} disabled={!selectedResults.length} loading={busy} onClick={() => void downloadSelected()}>{en ? `Download (${selectedResults.length})` : `下载所选（${selectedResults.length}）`}</Button></Space>}>
      {!results.length ? <Empty description={en ? 'No new-version results yet' : '暂无新版本生成结果'} /> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        {results.map((item) => <Card key={item.id} size="small" hoverable={false} cover={item.expired ? <div style={{ height: 170, display: 'grid', placeItems: 'center', background: '#f4f4f4' }}>{en ? 'Image expired' : '图片已过期'}</div> : <Image src={`/api/assets/${item.assetId}`} alt={item.name} style={{ width: '100%', height: 170, objectFit: 'contain', background: '#f6f6f6' }} />} actions={[<Checkbox key="select" checked={selected.includes(item.id)} disabled={item.expired} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))}>{en ? 'Select' : '选择'}</Checkbox>, <Button key="download" type="link" disabled={item.expired} onClick={() => { void (async () => { try { const file = await downloadFile(item); downloadBlob(file.blob, file.filename); } catch (cause) { setError(String(cause)); } })(); }}>{en ? 'Download' : '下载'}</Button>]}>
          <Card.Meta title={<Typography.Text ellipsis={{ tooltip: item.name }}>{item.name}</Typography.Text>} description={<><Tag>{labels[item.tool] || item.tool}</Tag><div>{item.username} · {new Date(item.createdAt).toLocaleString()}</div>{item.exportSpec.kind === 'cup-wrap' && !item.expired && <Select size="small" style={{ width: '100%', marginTop: 8 }} value={formatById[item.id] || 'png'} onChange={(value) => setFormatById((current) => ({ ...current, [item.id]: value }))} options={[{ value: 'png', label: 'PNG' }, { value: 'tiff', label: '1:1 TIFF' }, { value: 'pdf', label: '1:1 PDF' }]} />}{['paper-text', 'background-removal', 'ai-pet-letter-stickers'].includes(item.tool) && !item.expired && <Select size="small" style={{ width: '100%', marginTop: 8 }} value={formatById[item.id] || 'png'} onChange={(value) => setFormatById((current) => ({ ...current, [item.id]: value }))} options={item.tool === 'paper-text' ? [{ value: 'png', label: 'PNG' }, { value: 'svg', label: 'SVG' }, { value: 'vector-svg', label: 'Vector SVG' }] : item.tool === 'background-removal' ? [{ value: 'png', label: 'PNG' }, { value: 'vector-svg', label: 'Vector SVG' }] : [{ value: 'png', label: 'PNG' }, { value: 'high-res', label: en ? 'High-res PNG' : '高清 PNG' }, { value: 'transparent', label: en ? 'Transparent PNG' : '透明 PNG' }, { value: 'transparent-high-res', label: en ? 'Transparent high-res' : '透明高清 PNG' }]} />}{item.exportSpec.kind === 'cup-wrap' && !item.expired && item.exportSpec.print && <Space style={{ marginTop: 8 }}><span>DPI</span><InputNumber min={72} max={2400} value={dpiById[item.id] || (item.exportSpec.print as PrintSettings).dpi} onChange={(value) => setDpiById((current) => ({ ...current, [item.id]: value || (item.exportSpec.print as PrintSettings).dpi }))} /></Space>}{item.exportSpec.kind === 'engraving' && !item.expired && item.exportSpec.params && typeof item.exportSpec.params === 'object' && (item.exportSpec.params as RenderParams).pixelWidth === undefined && <Space style={{ marginTop: 8 }}><span>DPI</span><InputNumber min={72} max={1200} value={dpiById[item.id] || (item.exportSpec.params as RenderParams).dpi} onChange={(value) => setDpiById((current) => ({ ...current, [item.id]: value || (item.exportSpec.params as RenderParams).dpi }))} /></Space>}</>} />
        </Card>)}
      </div>}
      {hasMore && <Button block style={{ marginTop: 16 }} loading={loading} onClick={() => void refresh(results.length)}>{en ? 'Load more' : '加载更多'}</Button>}
    </Card>
    <Card title={en ? 'Server jobs' : '服务器任务'} style={{ marginTop: 22 }}>
      {!visibleJobs.length ? <Empty description={en ? 'No jobs' : '暂无任务'} /> : <div style={{ display: 'grid', gap: 10 }}>
        {visibleJobs.map((job) => <div key={job.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid #eee', paddingBottom: 10 }}><div><Space wrap><strong>{labels[job.tool] || job.tool}</strong><Tag color={statusColor(job.status)}>{job.status === 'success' ? en ? 'AI response ready' : 'AI 返回完成' : statusLabel(job.status, en)}</Tag><Tag>{job.provider}</Tag></Space><div style={{ color: '#777' }}>{job.username} · {job.model} · {new Date(job.createdAt).toLocaleString()} · {en ? 'Images' : '图片'} {job.imageCount}</div>{job.error && <Typography.Text type="danger">{job.error}</Typography.Text>}{job.assets?.some((asset) => !asset.expired && asset.mime.startsWith('image/')) && <div><Typography.Text type="secondary">{en ? 'Model outputs (not final artwork): ' : '模型原图（非最终成品）：'}</Typography.Text>{job.assets.filter((asset) => !asset.expired && asset.mime.startsWith('image/')).map((asset) => <Button key={asset.id} size="small" type="link" onClick={() => { void fetchAsset(asset.id).then((blob) => downloadBlob(blob, asset.name)).catch((cause) => setError(String(cause))); }}>{asset.name}</Button>)}</div>}</div>{job.status === 'queued' && <Button danger size="small" onClick={() => void cancelJob(job.id)}>{en ? 'Cancel queued' : '取消排队'}</Button>}</div>)}
      </div>}
    </Card>
  </section>;
}
