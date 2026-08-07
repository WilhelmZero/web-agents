import { ClearOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FileImageOutlined, ReloadOutlined, RocketOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Popconfirm, Progress, Select, Space, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_BACKGROUND_REMOVAL_PROMPT, buildBackgroundRemovalPrompt, chooseBackgroundRemovalMatte, restoreTransparentBackground } from './services/backgroundRemoval';
import { generateSceneReplacementImage } from './services/gemini';
import { editPaperTextOpenAi } from './services/paperText';
import { reportTaskProgress } from './services/taskProgress';
import { vectorizeImageToSvg } from './services/trueVectorExport';
import { MODEL_CAPABILITIES, STORAGE_KEYS } from './constants';
import { readLocalStorage } from './storage';
import type { ImageModel, ImageSize } from './types';
import { createId, downloadBlob, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
type OpenAiImageModel = 'gpt-image-2' | 'gpt-image-2-2026-04-21';
type BackgroundRemovalModel = ImageModel | OpenAiImageModel;
interface Settings { imageModel: BackgroundRemovalModel; imageSize: ImageSize; quality: 'high' | 'medium' | 'low'; concurrency: number; prompt: string }
interface Item { id: string; file: File; sourceUrl: string; status: 'waiting' | 'running' | 'success' | 'failed' | 'stopped'; resultBlob?: Blob; resultUrl?: string; vectorBlob?: Blob; vectorStatus?: 'converting' | 'ready' | 'failed'; error?: string }
const DEFAULT_SETTINGS: Settings = { imageModel: 'gemini-3.1-flash-image', imageSize: '1K', quality: 'high', concurrency: 3, prompt: DEFAULT_BACKGROUND_REMOVAL_PROMPT };
const isOpenAiModel = (model: BackgroundRemovalModel): model is OpenAiImageModel => model.startsWith('gpt-image-');

export default function BackgroundRemovalComposer({ apiKey, openAiApiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...readLocalStorage(STORAGE_KEYS.backgroundRemovalSettings, {}) }));
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const aborter = useRef<AbortController | undefined>(undefined);
  const patchSettings = (value: Partial<Settings>) => setSettings((current) => ({ ...current, ...value }));
  const patchItem = (id: string, value: Partial<Item>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.backgroundRemovalSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => onSessionStateChange?.(items.length > 0), [items.length, onSessionStateChange]);
  useEffect(() => () => { aborter.current?.abort(); items.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); }, []);
  const completed = items.filter((item) => ['success', 'failed', 'stopped'].includes(item.status)).length;
  const successful = items.filter((item) => item.resultBlob);
  useEffect(() => reportTaskProgress({ id: 'background-removal', label: '去除背景', completed, total: items.length, failed: items.filter((item) => item.status === 'failed').length, running: busy }), [completed, items, busy]);

  const addFiles = (files: File[]) => {
    const next = files.filter((file) => { if (!ACCEPTED.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error(`${file.name}：仅支持 20MB 内的 PNG、JPEG、WebP`); return false; } return true; })
      .map((file) => ({ id: createId(), file, sourceUrl: URL.createObjectURL(file), status: 'waiting' as const }));
    setItems((current) => [...current, ...next]); return false;
  };
  const removeItem = (id: string) => setItems((current) => { const target = current.find((item) => item.id === id); if (target) { URL.revokeObjectURL(target.sourceUrl); if (target.resultUrl) URL.revokeObjectURL(target.resultUrl); } return current.filter((item) => item.id !== id); });
  const processItem = async (item: Item, signal: AbortSignal) => {
    patchItem(item.id, { status: 'running', error: undefined });
    try {
      const matte = await chooseBackgroundRemovalMatte(item.file);
      const prompt = buildBackgroundRemovalPrompt(settings.prompt, matte);
      const generatedBlob = isOpenAiModel(settings.imageModel)
        ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: settings.imageModel, image: item.file, prompt, quality: settings.quality, signal })
        : (await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal, model: settings.imageModel as ImageModel, image: item.file, imageSize: settings.imageSize, prompt })).blob;
      const resultBlob = await restoreTransparentBackground(generatedBlob, matte);
      const resultUrl = URL.createObjectURL(resultBlob);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      patchItem(item.id, { status: 'success', resultBlob, resultUrl, vectorBlob: undefined, vectorStatus: undefined });
    } catch (error) { patchItem(item.id, { status: signal.aborted ? 'stopped' : 'failed', error: signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '去除背景失败' }); }
  };
  const run = async (targets = items) => {
    if (isOpenAiModel(settings.imageModel) ? !openAiApiKey : !apiKey) return onRequestKey();
    if (!isOpenAiModel(settings.imageModel) && connectionMode === 'proxy' && !apiBaseUrl) return onRequestKey();
    if (!targets.length || busy) return; if (!settings.prompt.trim()) return void message.warning('请填写抠图提示词');
    const controller = new AbortController(); aborter.current = controller; setBusy(true); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(settings.concurrency, targets.length) }, async () => { while (cursor < targets.length && !controller.signal.aborted) await processItem(targets[cursor++], controller.signal); }));
    aborter.current = undefined; setBusy(false);
  };
  const vectorize = async (item: Item) => {
    if (!item.resultBlob) return; patchItem(item.id, { vectorStatus: 'converting' });
    try { patchItem(item.id, { vectorBlob: await vectorizeImageToSvg(item.resultBlob), vectorStatus: 'ready' }); }
    catch (error) { patchItem(item.id, { vectorStatus: 'failed', error: error instanceof Error ? error.message : '矢量化失败' }); }
  };
  const clearAll = () => { aborter.current?.abort(); setItems((current) => { current.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); return []; }); setCompareIds(new Set()); };
  const downloadAll = async () => { const zip = new JSZip(); successful.forEach((item) => item.resultBlob && zip.file(`${sanitizeFileName(item.file.name)}_透明.png`, item.resultBlob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), '去除背景结果.zip'); };
  const modelOptions = useMemo(() => [{ label: 'GPT（OpenAI 官方直连）', options: [{ value: 'gpt-image-2', label: 'GPT Image 2（推荐）' }, { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' }] }, { label: 'Gemini', options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label })) }], []);
  const panel = <div className="settings-panel"><Title level={4}>去除背景设置</Title><Form layout="vertical"><Form.Item label="图片模型"><Select value={settings.imageModel} options={modelOptions} onChange={(imageModel) => patchSettings({ imageModel })} /></Form.Item>{isOpenAiModel(settings.imageModel) ? <Form.Item label="GPT 输出质量"><Select value={settings.quality} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} onChange={(quality) => patchSettings({ quality })} /></Form.Item> : <Form.Item label="输出分辨率"><Select value={settings.imageSize} options={MODEL_CAPABILITIES[settings.imageModel as ImageModel].imageSizes.map((value: ImageSize) => ({ value, label: value }))} onChange={(imageSize) => patchSettings({ imageSize })} /></Form.Item>}<Form.Item label="并发任务数"><InputNumber min={1} max={8} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item></Form><Text type="secondary">GPT 使用右上角 OpenAI Key 官方直连；两类模型都会先生成纯色底，再由本地脚本恢复透明通道。</Text></div>;

  return <div className="background-removal-page"><section className="hero-strip background-removal-hero"><div><Text className="eyebrow">BACKGROUND REMOVER</Text><Title level={2}>批量去除背景，保留清晰透明边缘</Title><Paragraph className="hero-description">自动选择避开主体的抠图底色，生成后在本地恢复 Alpha；结果可继续转换为真实 SVG 路径。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 上传待抠图图片" extra={<Space><Text type="secondary">{items.length} 张</Text>{items.length > 0 && <Popconfirm title="清空全部图片？" onConfirm={clearAll}><Button danger size="small" icon={<ClearOutlined />}>清空</Button></Popconfirm>}</Space>}><Upload.Dragger accept={ACCEPTED.join(',')} multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击批量上传 PNG / JPEG / WebP</p></Upload.Dragger>{items.length > 0 && <div className="background-source-grid">{items.map((item) => <Card key={item.id} size="small"><Image src={item.sourceUrl} /><Button danger type="text" block icon={<DeleteOutlined />} disabled={item.status === 'running'} onClick={() => removeItem(item.id)}>删除</Button></Card>)}</div>}</Card>
    <Card className="workflow-card" title="2. 修改抠图提示词"><Input.TextArea value={settings.prompt} onChange={(event) => patchSettings({ prompt: event.target.value })} autoSize={{ minRows: 5, maxRows: 12 }} maxLength={3000} showCount /><Text type="secondary">系统会在请求末尾加入每张图片对应的纯色底技术要求，避免棋盘格、阴影和底色污染。</Text></Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>准备处理 {items.length} 张图片</Title><Text type="secondary">最多 {settings.concurrency} 个任务并发执行</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={() => aborter.current?.abort()}>停止</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} disabled={!items.length} onClick={() => void run()}>开始批量去除背景</Button></Space></Flex>{items.length > 0 && <Progress style={{ marginTop: 16 }} percent={Math.round(completed / items.length * 100)} status={busy ? 'active' : successful.length ? 'success' : 'normal'} />}</Card>
    <section className="results-section"><Flex justify="space-between" align="center" wrap gap={8}><div><Title level={3}>透明背景结果</Title><Text type="secondary">点击图片可放大，并可切换原图对比</Text></div><Button icon={<DownloadOutlined />} disabled={!successful.length} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Flex>{items.length ? <Image.PreviewGroup><div className="logo-replace-results">{items.map((item) => <Card key={item.id} size="small" title={item.file.name} extra={item.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.resultBlob!, `${sanitizeFileName(item.file.name)}_透明.png`)} />}><div className="replace-result-image transparent-result-bg">{item.resultUrl ? <Image src={compareIds.has(item.id) ? item.sourceUrl : item.resultUrl} /> : <div className={`task-state-card is-${item.status}`}><Text strong>{item.status === 'running' ? '处理中' : item.status === 'failed' ? '处理失败' : item.status === 'stopped' ? '已停止' : '等待处理'}</Text><Text type="secondary">{item.error}</Text></div>}</div><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Tag color={item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'running' ? 'processing' : 'default'}>{item.status}</Tag><Space>{item.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>{compareIds.has(item.id) ? '查看透明图' : '原图对比'}</Button>}<Button size="small" icon={<ReloadOutlined />} disabled={busy} onClick={() => void run([item])}>重新生成</Button>{item.resultBlob && <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} loading={item.vectorStatus === 'converting'} onClick={() => item.vectorBlob ? downloadBlob(item.vectorBlob, `${sanitizeFileName(item.file.name)}_矢量.svg`) : void vectorize(item)}>{item.vectorBlob ? '下载 SVG' : '转为矢量图'}</Button>}</Space></Flex></Card>)}</div></Image.PreviewGroup> : <Empty description="处理结果会显示在这里" />}</section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}
