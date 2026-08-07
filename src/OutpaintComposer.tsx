import { ClearOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, ExpandOutlined, FileImageOutlined, ReloadOutlined, RocketOutlined, StopOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Popconfirm, Progress, Select, Space, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MODEL_CAPABILITIES, STORAGE_KEYS } from './constants';
import { generateSceneReplacementImage } from './services/gemini';
import { editPaperTextOpenAi } from './services/paperText';
import { buildOutpaintPrompt, closestAspectRatio, composeExactOutpaint, prepareOutpaintInput } from './services/outpaint';
import { reportTaskProgress } from './services/taskProgress';
import { readLocalStorage } from './storage';
import type { ImageModel, ImageSize } from './types';
import { createId, downloadBlob, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
type OpenAiImageModel = 'gpt-image-2' | 'gpt-image-2-2026-04-21';
type OutpaintModel = ImageModel | OpenAiImageModel;
interface Settings { imageModel: OutpaintModel; imageSize: ImageSize; quality: 'high' | 'medium' | 'low'; width: number; height: number; concurrency: number; prompt: string }
interface Item { id: string; file: File; sourceUrl: string; status: 'waiting' | 'running' | 'success' | 'failed' | 'stopped'; resultBlob?: Blob; resultUrl?: string; error?: string }
const DEFAULT_SETTINGS: Settings = { imageModel: 'gemini-3.1-flash-image', imageSize: '2K', quality: 'high', width: 3200, height: 1310, concurrency: 3, prompt: '自然延展原图场景，补充画面之外合理存在的环境内容，保持真实摄影质感和自然景深。' };
const PRESETS = [{ label: '超宽屏 3200 × 1310', value: '3200x1310', width: 3200, height: 1310 }, { label: '横版 1800 × 1350', value: '1800x1350', width: 1800, height: 1350 }, { label: '自定义尺寸', value: 'custom' }];
const isOpenAiModel = (model: OutpaintModel): model is OpenAiImageModel => model.startsWith('gpt-image-');

export default function OutpaintComposer({ apiKey, openAiApiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = App.useApp();
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...readLocalStorage(STORAGE_KEYS.outpaintSettings, {}) }));
  const [items, setItems] = useState<Item[]>([]); const [busy, setBusy] = useState(false); const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const aborter = useRef<AbortController | undefined>(undefined);
  const patchSettings = (value: Partial<Settings>) => setSettings((current) => ({ ...current, ...value }));
  const patchItem = (id: string, value: Partial<Item>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.outpaintSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => onSessionStateChange?.(items.length > 0), [items.length, onSessionStateChange]);
  const completed = items.filter((item) => ['success', 'failed', 'stopped'].includes(item.status)).length; const successful = items.filter((item) => item.resultBlob);
  useEffect(() => reportTaskProgress({ id: 'outpaint', label: '扩图', completed, total: items.length, failed: items.filter((item) => item.status === 'failed').length, running: busy }), [completed, items, busy]);
  const addFiles = (files: File[]) => { const next = files.filter((file) => { if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error(`${file.name}：仅支持 20MB 内的 PNG、JPEG、WebP`); return false; } return true; }).map((file) => ({ id: createId(), file, sourceUrl: URL.createObjectURL(file), status: 'waiting' as const })); setItems((current) => [...current, ...next]); return false; };
  const removeItem = (id: string) => setItems((current) => { const target = current.find((item) => item.id === id); if (target) { URL.revokeObjectURL(target.sourceUrl); if (target.resultUrl) URL.revokeObjectURL(target.resultUrl); } return current.filter((item) => item.id !== id); });
  const processItem = async (item: Item, signal: AbortSignal) => {
    patchItem(item.id, { status: 'running', error: undefined });
    try {
      const prepared = await prepareOutpaintInput(item.file, settings.width, settings.height); const prompt = buildOutpaintPrompt(settings.prompt, settings.width, settings.height);
      const generated = isOpenAiModel(settings.imageModel)
        ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: settings.imageModel, image: prepared.file, prompt, quality: settings.quality, signal })
        : (await generateSceneReplacementImage({ apiKey, apiBaseUrl, signal, model: settings.imageModel as ImageModel, image: prepared.file, imageSize: settings.imageSize, aspectRatio: closestAspectRatio(settings.width, settings.height, MODEL_CAPABILITIES[settings.imageModel as ImageModel].aspectRatios), prompt })).blob;
      const resultBlob = await composeExactOutpaint(generated, item.file, settings.width, settings.height); const resultUrl = URL.createObjectURL(resultBlob);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); patchItem(item.id, { status: 'success', resultBlob, resultUrl });
    } catch (error) { patchItem(item.id, { status: signal.aborted ? 'stopped' : 'failed', error: signal.aborted ? '任务已停止' : error instanceof Error ? error.message : '扩图失败' }); }
  };
  const run = async (targets = items) => {
    if (isOpenAiModel(settings.imageModel) ? !openAiApiKey : !apiKey) return onRequestKey(); if (!isOpenAiModel(settings.imageModel) && connectionMode === 'proxy' && !apiBaseUrl) return onRequestKey();
    if (!targets.length || busy) return; if (settings.width < 64 || settings.height < 64 || settings.width > 8192 || settings.height > 8192) return void message.warning('输出宽高需在 64–8192 像素之间');
    const controller = new AbortController(); aborter.current = controller; setBusy(true); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(settings.concurrency, targets.length) }, async () => { while (cursor < targets.length && !controller.signal.aborted) await processItem(targets[cursor++], controller.signal); })); aborter.current = undefined; setBusy(false);
  };
  const clearAll = () => { aborter.current?.abort(); setItems((current) => { current.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); return []; }); setCompareIds(new Set()); };
  const fileName = (item: Item) => `${sanitizeFileName(item.file.name)}_扩图_${settings.width}x${settings.height}.png`;
  const downloadAll = async () => { const zip = new JSZip(); successful.forEach((item) => item.resultBlob && zip.file(fileName(item), item.resultBlob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), `扩图结果_${settings.width}x${settings.height}.zip`); };
  const selectedPreset = PRESETS.find((preset) => preset.width === settings.width && preset.height === settings.height)?.value || 'custom';
  const modelOptions = useMemo(() => [{ label: 'GPT（OpenAI 官方直连）', options: [{ value: 'gpt-image-2', label: 'GPT Image 2（推荐）' }, { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' }] }, { label: 'Gemini', options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label })) }], []);
  const panel = <div className="settings-panel"><Title level={4}>扩图设置</Title><Form layout="vertical"><Form.Item label="图片模型"><Select value={settings.imageModel} options={modelOptions} onChange={(imageModel) => patchSettings({ imageModel })} /></Form.Item>{isOpenAiModel(settings.imageModel) ? <Form.Item label="GPT 输出质量"><Select value={settings.quality} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} onChange={(quality) => patchSettings({ quality })} /></Form.Item> : <Form.Item label="模型生成质量"><Select value={settings.imageSize} options={MODEL_CAPABILITIES[settings.imageModel as ImageModel].imageSizes.map((value) => ({ value, label: value }))} onChange={(imageSize) => patchSettings({ imageSize })} /></Form.Item>}<Form.Item label="输出尺寸预设"><Select value={selectedPreset} options={PRESETS} onChange={(value) => { const preset = PRESETS.find((item) => item.value === value); if (preset?.width && preset.height) patchSettings({ width: preset.width, height: preset.height }); }} /></Form.Item><Flex gap={10}><Form.Item label="宽度" style={{ flex: 1 }}><InputNumber min={64} max={8192} value={settings.width} onChange={(width) => patchSettings({ width: width || 64 })} style={{ width: '100%' }} /></Form.Item><Form.Item label="高度" style={{ flex: 1 }}><InputNumber min={64} max={8192} value={settings.height} onChange={(height) => patchSettings({ height: height || 64 })} style={{ width: '100%' }} /></Form.Item></Flex><Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item></Form><Text type="secondary">模型按最接近比例补画，最终由本地脚本合成为精确 {settings.width} × {settings.height} PNG。</Text></div>;

  return <div className="outpaint-page"><section className="hero-strip outpaint-hero"><div><Text className="eyebrow">AI OUTPAINT</Text><Title level={2}>完整保留原图，智能补齐画面之外</Title><Paragraph className="hero-description">按指定比例或精确分辨率扩展画布，只补充缺失环境，并在最终结果中原位覆盖回原图。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 上传需要扩展的图片" extra={<Space><Text type="secondary">{items.length} 张</Text>{items.length > 0 && <Popconfirm title="清空全部？" onConfirm={clearAll}><Button danger size="small" icon={<ClearOutlined />}>清空</Button></Popconfirm>}</Space>}><Upload.Dragger accept="image/png,image/jpeg,image/webp" multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击批量上传图片</p></Upload.Dragger>{items.length > 0 && <div className="background-source-grid">{items.map((item) => <Card key={item.id} size="small"><Image src={item.sourceUrl} /><Button danger type="text" block icon={<DeleteOutlined />} disabled={item.status === 'running'} onClick={() => removeItem(item.id)}>删除</Button></Card>)}</div>}</Card>
    <Card className="workflow-card" title="2. 扩图提示词"><Input.TextArea value={settings.prompt} onChange={(event) => patchSettings({ prompt: event.target.value })} autoSize={{ minRows: 4, maxRows: 10 }} maxLength={3000} showCount /><Text type="secondary">系统会自动追加原图完整保护、仅补齐空白区域及目标比例要求。</Text></Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>输出 {settings.width} × {settings.height}</Title><Text type="secondary">原图完整居中显示，缺少的上下或左右区域由模型补齐</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={() => aborter.current?.abort()}>停止</Button>}<Button type="primary" size="large" icon={<ExpandOutlined />} loading={busy} disabled={!items.length} onClick={() => void run()}>开始批量扩图</Button></Space></Flex>{items.length > 0 && <Progress style={{ marginTop: 16 }} percent={Math.round(completed / items.length * 100)} status={busy ? 'active' : successful.length ? 'success' : 'normal'} />}</Card>
    <section className="results-section"><Flex justify="space-between" align="center" wrap gap={8}><div><Title level={3}>扩图结果</Title><Text type="secondary">结果均为精确 {settings.width} × {settings.height}，支持原图对比和放大</Text></div><Button icon={<DownloadOutlined />} disabled={!successful.length} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Flex>{items.length ? <Image.PreviewGroup><div className="outpaint-results-grid">{items.map((item) => <Card key={item.id} size="small" title={item.file.name} extra={item.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.resultBlob!, fileName(item))} />}><div className="outpaint-result-image">{item.resultUrl ? <Image src={compareIds.has(item.id) ? item.sourceUrl : item.resultUrl} /> : <div className={`task-state-card is-${item.status}`}><Text strong>{item.status === 'running' ? '扩图中' : item.status === 'failed' ? '扩图失败' : item.status === 'stopped' ? '已停止' : '等待处理'}</Text><Text type="secondary">{item.error}</Text></div>}</div><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Tag color={item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'running' ? 'processing' : 'default'}>{item.status}</Tag><Space>{item.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>{compareIds.has(item.id) ? '查看扩图' : '原图对比'}</Button>}<Button size="small" icon={<ReloadOutlined />} disabled={busy} onClick={() => void run([item])}>重新生成</Button></Space></Flex></Card>)}</div></Image.PreviewGroup> : <Empty description="扩图结果会显示在这里" />}</section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}
