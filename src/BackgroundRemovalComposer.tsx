import { ClearOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FileImageOutlined, ReloadOutlined, RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Flex, Image, Popconfirm, Progress, Space, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { removeImageBackground } from './services/backgroundRemoval';
import { reportTaskProgress } from './services/taskProgress';
import { vectorizeImageToSvg } from './services/trueVectorExport';
import { createId, downloadBlob, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
interface Item { id: string; file: File; sourceUrl: string; status: 'waiting' | 'running' | 'success' | 'failed'; progress?: number; resultBlob?: Blob; resultUrl?: string; vectorBlob?: Blob; vectorStatus?: 'converting' | 'ready' | 'failed'; error?: string }
const CONCURRENCY = 2;

export default function BackgroundRemovalComposer({ onSessionStateChange, settingsHost }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const patchItem = (id: string, value: Partial<Item>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  useEffect(() => onSessionStateChange?.(items.length > 0), [items.length, onSessionStateChange]);
  useEffect(() => () => { items.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); }, []);
  const completed = items.filter((item) => ['success', 'failed'].includes(item.status)).length;
  const successful = items.filter((item) => item.resultBlob);
  useEffect(() => reportTaskProgress({ id: 'background-removal', label: '去除背景', completed, total: items.length, failed: items.filter((item) => item.status === 'failed').length, running: busy }), [completed, items, busy]);

  const addFiles = (files: File[]) => {
    const next = files.filter((file) => { if (!ACCEPTED.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error(`${file.name}：仅支持 20MB 内的 PNG、JPEG、WebP`); return false; } return true; })
      .map((file) => ({ id: createId(), file, sourceUrl: URL.createObjectURL(file), status: 'waiting' as const }));
    setItems((current) => [...current, ...next]); return false;
  };
  const removeItem = (id: string) => setItems((current) => { const target = current.find((item) => item.id === id); if (target) { URL.revokeObjectURL(target.sourceUrl); if (target.resultUrl) URL.revokeObjectURL(target.resultUrl); } return current.filter((item) => item.id !== id); });
  const processItem = async (item: Item) => {
    patchItem(item.id, { status: 'running', progress: 0, error: undefined });
    try {
      const resultBlob = await removeImageBackground(item.file, ({ percent }) => patchItem(item.id, { progress: percent }));
      const resultUrl = URL.createObjectURL(resultBlob);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      patchItem(item.id, { status: 'success', progress: 100, resultBlob, resultUrl, vectorBlob: undefined, vectorStatus: undefined });
    } catch (error) { patchItem(item.id, { status: 'failed', error: error instanceof Error ? error.message : '去除背景失败' }); }
  };
  const run = async (targets = items) => {
    if (!targets.length || busy) return;
    setBusy(true); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => { while (cursor < targets.length) await processItem(targets[cursor++]); }));
    setBusy(false);
  };
  const vectorize = async (item: Item) => {
    if (!item.resultBlob) return; patchItem(item.id, { vectorStatus: 'converting' });
    try { patchItem(item.id, { vectorBlob: await vectorizeImageToSvg(item.resultBlob), vectorStatus: 'ready' }); }
    catch (error) { patchItem(item.id, { vectorStatus: 'failed', error: error instanceof Error ? error.message : '矢量化失败' }); }
  };
  const clearAll = () => { setItems((current) => { current.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); return []; }); setCompareIds(new Set()); };
  const downloadAll = async () => { const zip = new JSZip(); successful.forEach((item) => item.resultBlob && zip.file(`${sanitizeFileName(item.file.name)}_透明.png`, item.resultBlob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), '去除背景结果.zip'); };
  const panel = <div className="settings-panel"><Title level={4}>智能抠图</Title><Text type="secondary">使用专用主体分割与 Alpha Matting 模型在浏览器本地处理，不需要 API Key，也不会重绘或上传图片。模型首次运行需要下载，之后会由浏览器缓存。</Text></div>;

  return <div className="background-removal-page"><section className="hero-strip background-removal-hero"><div><Text className="eyebrow">BACKGROUND REMOVER</Text><Title level={2}>一键智能抠图，直接生成透明背景</Title><Paragraph className="hero-description">专用分割模型直接识别主体与精细边缘，不使用提示词、不重绘图片，也不再通过绿色底色转换透明。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 上传待抠图图片" extra={<Space><Text type="secondary">{items.length} 张</Text>{items.length > 0 && <Popconfirm title="清空全部图片？" onConfirm={clearAll}><Button danger size="small" icon={<ClearOutlined />}>清空</Button></Popconfirm>}</Space>}><Upload.Dragger accept={ACCEPTED.join(',')} multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击批量上传 PNG / JPEG / WebP</p></Upload.Dragger>{items.length > 0 && <div className="background-source-grid">{items.map((item) => <Card key={item.id} size="small"><Image src={item.sourceUrl} /><Button danger type="text" block icon={<DeleteOutlined />} disabled={item.status === 'running'} onClick={() => removeItem(item.id)}>删除</Button></Card>)}</div>}</Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>准备处理 {items.length} 张图片</Title><Text type="secondary">点击后直接生成透明 PNG；首次处理需要加载本地抠图模型</Text></div><Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} disabled={!items.length} onClick={() => void run()}>一键批量抠图</Button></Flex>{items.length > 0 && <Progress style={{ marginTop: 16 }} percent={Math.round(completed / items.length * 100)} status={busy ? 'active' : successful.length ? 'success' : 'normal'} />}</Card>
    <section className="results-section"><Flex justify="space-between" align="center" wrap gap={8}><div><Title level={3}>透明背景结果</Title><Text type="secondary">主体原始像素与分辨率保持不变，透明边缘由 Alpha Matting 模型直接生成</Text></div><Button icon={<DownloadOutlined />} disabled={!successful.length} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Flex>{items.length ? <Image.PreviewGroup><div className="logo-replace-results">{items.map((item) => <Card key={item.id} size="small" title={item.file.name} extra={item.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.resultBlob!, `${sanitizeFileName(item.file.name)}_透明.png`)} />}><div className="replace-result-image transparent-result-bg">{item.resultUrl ? <Image src={compareIds.has(item.id) ? item.sourceUrl : item.resultUrl} /> : <div className={`task-state-card is-${item.status}`}><Text strong>{item.status === 'running' ? `模型处理中${item.progress ? ` ${item.progress}%` : ''}` : item.status === 'failed' ? '处理失败' : '等待处理'}</Text><Text type="secondary">{item.error}</Text>{item.status === 'running' && <Progress percent={item.progress || 0} size="small" />}</div>}</div><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Tag color={item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'running' ? 'processing' : 'default'}>{item.status}</Tag><Space>{item.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>{compareIds.has(item.id) ? '查看透明图' : '原图对比'}</Button>}<Button size="small" icon={<ReloadOutlined />} disabled={busy} onClick={() => void run([item])}>重新抠图</Button>{item.resultBlob && <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} loading={item.vectorStatus === 'converting'} onClick={() => item.vectorBlob ? downloadBlob(item.vectorBlob, `${sanitizeFileName(item.file.name)}_矢量.svg`) : void vectorize(item)}>{item.vectorBlob ? '下载 SVG' : '转为矢量图'}</Button>}</Space></Flex></Card>)}</div></Image.PreviewGroup> : <Empty description="处理结果会显示在这里" />}</section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}
