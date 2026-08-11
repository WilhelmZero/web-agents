import { DeleteOutlined, DownloadOutlined, EyeOutlined, FileImageOutlined, FileTextOutlined, ReloadOutlined, RocketOutlined, ScanOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Progress, Segmented, Select, Space, Tag, Typography, Upload } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reportTaskProgress } from './services/taskProgress';
import { buildPaperTextEditPrompt, editPaperTextOpenAi, recognizePaperTextOpenAi, verifyPaperTextOpenAi, type PaperTextRegion } from './services/paperText';
import { editPaperTextGemini, recognizePaperTextGemini, verifyPaperTextGemini } from './services/gemini';
import { createId, downloadBlob, sanitizeFileName } from './utils';
import { createEmbeddedImageSvg } from './services/svgExport';
import { STORAGE_KEYS } from './constants';
import { readLocalStorage } from './storage';
import { inspectVectorEligibility, vectorizeImageToSvg } from './services/trueVectorExport';
import { prepareTransparentImageForEdit, restoreTransparentBackground } from './services/transparentImageEdit';
import OriginalCompareImage from './OriginalCompareImage';

const { Title, Text, Paragraph } = Typography;
type Provider = 'openai' | 'gemini';
type ItemStatus = 'waiting' | 'recognizing' | 'recognized' | 'editing' | 'done' | 'error';
interface Item { id: string; file: File; url: string; resultUrl?: string; resultBlob?: Blob; vectorBlob?: Blob; vectorStatus?: 'checking' | 'converting' | 'ready' | 'skipped' | 'error'; vectorError?: string; regions: PaperTextRegion[]; status: ItemStatus; error?: string; verification?: string }
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
const textKey = (value: string) => value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
const OPENAI_TEXT_MODELS = [
  { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna（快速低成本）' },
  { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra（均衡）' },
  { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol（最高能力）' },
];
const GEMINI_TEXT_MODELS = [
  { value: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash（推荐）' },
  { value: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  { value: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite（快速低成本）' },
  { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite' },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（旧版）' },
];
const OPENAI_IMAGE_MODELS = [
  { value: 'gpt-image-2', label: 'GPT Image 2（推荐）' },
  { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21 固定版本）' },
];
const GEMINI_IMAGE_MODELS = [
  { value: 'gemini-3.1-flash-image', label: 'Gemini 3.1 Flash Image（推荐）' },
  { value: 'gemini-3.1-flash-lite-image', label: 'Gemini 3.1 Flash Lite Image（快速低成本）' },
  { value: 'gemini-3-pro-image', label: 'Gemini 3 Pro Image（高质量）' },
  { value: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image（旧版）' },
];
interface PaperTextSettings {
  languageProvider: Provider;
  imageProvider: Provider;
  openAiTextModel: string;
  openAiImageModel: string;
  geminiTextModel: string;
  geminiImageModel: string;
  quality: string;
  concurrency: number;
}
const DEFAULT_PAPER_TEXT_SETTINGS: PaperTextSettings = {
  languageProvider: 'openai', imageProvider: 'openai', openAiTextModel: 'gpt-5.6-luna', openAiImageModel: 'gpt-image-2',
  geminiTextModel: 'gemini-3.6-flash', geminiImageModel: 'gemini-3.1-flash-image', quality: 'high', concurrency: 4,
};

export default function PaperTextComposer({ apiKey, openAiApiKey, apiBaseUrl, onRequestKey, onSessionStateChange, settingsHost }: { apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [paperSettings, setPaperSettings] = useState<PaperTextSettings>(() => readLocalStorage(STORAGE_KEYS.paperTextSettings, DEFAULT_PAPER_TEXT_SETTINGS));
  const { languageProvider, imageProvider, openAiTextModel, openAiImageModel, geminiTextModel, geminiImageModel, quality, concurrency } = paperSettings;
  const patchSettings = (value: Partial<PaperTextSettings>) => setPaperSettings((current) => ({ ...current, ...value }));
  const [commonPrompt, setCommonPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [compareIds, setCompareIds] = useState<Set<string>>(() => new Set());
  const aborter = useRef<AbortController | undefined>(undefined);
  const active = items.find((item) => item.id === activeId) || items[0];
  useEffect(() => onSessionStateChange?.(items.length > 0), [items.length, onSessionStateChange]);
  useEffect(() => { try { localStorage.setItem(STORAGE_KEYS.paperTextSettings, JSON.stringify(paperSettings)); } catch { /* 本地存储不可用时继续使用当前会话设置 */ } }, [paperSettings]);
  useEffect(() => () => { aborter.current?.abort(); items.forEach((item) => { URL.revokeObjectURL(item.url); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); }, []);

  const recognizedItems = items.filter((item) => item.regions.length > 0);
  const commonTexts = useMemo(() => {
    if (recognizedItems.length < 2) return [];
    const first = new Map(recognizedItems[0].regions.map((region) => [textKey(region.original), region.original]));
    return [...first].filter(([key]) => recognizedItems.every((item) => item.regions.some((region) => textKey(region.original) === key))).map(([key, original]) => ({ key, original }));
  }, [items]);
  const completed = items.filter((item) => ['done', 'error'].includes(item.status)).length;
  const changedItems = items.filter((item) => item.regions.some((region) => region.text !== region.original));
  useEffect(() => { reportTaskProgress({ id: 'paper-text', label: '花纸文字修改', completed, total: busy ? Math.max(changedItems.length, items.length) : items.filter((item) => item.resultBlob).length, failed: items.filter((item) => item.status === 'error').length, running: busy }); }, [completed, items, busy, changedItems.length]);

  const requiredKey = (provider: Provider) => provider === 'openai' ? openAiApiKey : apiKey;
  const ensureKey = (provider: Provider) => { if (requiredKey(provider)) return true; onRequestKey(); message.warning(`请先配置 ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`); return false; };
  const patch = (id: string, value: Partial<Item>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  const addFiles = (files: File[]) => {
    const next = files.filter((file) => { if (!ACCEPTED.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error(`${file.name}：仅支持 20MB 内的 PNG、JPEG、WebP`); return false; } return true; }).map((file) => ({ id: createId(), file, url: URL.createObjectURL(file), regions: [], status: 'waiting' as const }));
    if (next.length) { setItems((current) => [...current, ...next]); setActiveId((current) => current || next[0].id); }
    return false;
  };
  const removeItem = (id: string) => setItems((current) => { const target = current.find((item) => item.id === id); if (target) { URL.revokeObjectURL(target.url); if (target.resultUrl) URL.revokeObjectURL(target.resultUrl); } const next = current.filter((item) => item.id !== id); if (id === activeId) setActiveId(next[0]?.id); return next; });
  const recognizeOne = async (item: Item, signal: AbortSignal) => {
    patch(item.id, { status: 'recognizing', error: undefined });
    try {
      const regions = languageProvider === 'openai'
        ? await recognizePaperTextOpenAi({ apiKey: openAiApiKey, model: openAiTextModel, image: item.file, signal })
        : await recognizePaperTextGemini({ apiKey, model: geminiTextModel, image: item.file, signal, apiBaseUrl });
      patch(item.id, { status: 'recognized', regions, error: regions.length ? undefined : '未识别到可编辑文字' });
    } catch (error) { patch(item.id, { status: 'error', error: error instanceof Error ? error.message : '识别失败' }); }
  };
  const runPool = async <T,>(jobs: T[], worker: (job: T, signal: AbortSignal) => Promise<void>) => {
    const controller = new AbortController(); aborter.current = controller; let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => { while (cursor < jobs.length && !controller.signal.aborted) await worker(jobs[cursor++], controller.signal); }));
    aborter.current = undefined;
  };
  const recognizeAll = async () => { if (!ensureKey(languageProvider) || busy || !items.length) return; setBusy(true); await runPool(items, recognizeOne); setBusy(false); };
  const updateRegion = (index: number, text: string) => active && patch(active.id, { regions: active.regions.map((region, i) => i === index ? { ...region, text } : region) });
  const updateCommonText = (key: string, replacement: string) => setItems((current) => current.map((item) => ({ ...item, regions: item.regions.map((region) => textKey(region.original) === key ? { ...region, text: replacement } : region) })));

  const processItem = async (item: Item, signal: AbortSignal) => {
    const changed = item.regions.filter((region) => region.text !== region.original); if (!changed.length) return;
    patch(item.id, { status: 'editing', error: undefined, verification: undefined });
    try {
      const prepared = await prepareTransparentImageForEdit(item.file);
      let correction = ''; let blob: Blob | undefined; let verification = { ok: false, reason: '尚未复核' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const prompt = buildPaperTextEditPrompt(item.regions, correction, commonPrompt) + prepared.promptSuffix;
        blob = imageProvider === 'openai'
          ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: openAiImageModel, image: prepared.image, prompt, quality, signal })
          : await editPaperTextGemini({ apiKey, model: geminiImageModel, image: prepared.image, prompt, signal, apiBaseUrl });
        if (prepared.matte) blob = await restoreTransparentBackground(blob, prepared.matte);
        verification = languageProvider === 'openai'
          ? await verifyPaperTextOpenAi({ apiKey: openAiApiKey, model: openAiTextModel, image: blob, regions: item.regions, signal })
          : await verifyPaperTextGemini({ apiKey, model: geminiTextModel, image: blob, regions: item.regions, signal, apiBaseUrl });
        if (verification.ok) break; correction = verification.reason;
      }
      if (!blob) throw new Error('图片编辑未返回结果');
      const resultUrl = URL.createObjectURL(blob); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      patch(item.id, { status: 'done', resultBlob: blob, resultUrl, vectorBlob: undefined, vectorStatus: 'checking', vectorError: undefined, verification: verification.ok ? '复核通过' : `复核未通过：${verification.reason}` });
      void autoVectorize(item.id, blob);
    } catch (error) { patch(item.id, { status: signal.aborted ? 'recognized' : 'error', error: signal.aborted ? undefined : error instanceof Error ? error.message : '修改失败' }); }
  };
  const convertVector = async (id: string, blob: Blob, automatic = false) => {
    patch(id, { vectorStatus: 'converting', vectorError: undefined });
    try {
      const vectorBlob = await vectorizeImageToSvg(blob);
      patch(id, { vectorBlob, vectorStatus: 'ready' });
      return true;
    } catch (error) {
      patch(id, { vectorStatus: automatic ? 'skipped' : 'error', vectorError: error instanceof Error ? error.message : '矢量化失败' });
      return false;
    }
  };
  const autoVectorize = async (id: string, blob: Blob) => {
    try {
      const analysis = await inspectVectorEligibility(blob);
      if (!analysis.eligible) return void patch(id, { vectorStatus: 'skipped', vectorError: `检测到约 ${analysis.colorBins} 个颜色层级，未自动描摹` });
      await convertVector(id, blob, true);
    } catch (error) {
      patch(id, { vectorStatus: 'skipped', vectorError: error instanceof Error ? error.message : '自动矢量检测失败' });
    }
  };
  const batchVectorize = async () => {
    const targets = items.filter((item) => item.resultBlob && item.vectorStatus !== 'ready');
    if (!targets.length) return void message.info('当前结果均已生成真正矢量图');
    setVectorizing(true);
    let success = 0;
    for (const item of targets) if (item.resultBlob && await convertVector(item.id, item.resultBlob)) success += 1;
    setVectorizing(false);
    message.success(`已完成 ${success}/${targets.length} 张真正矢量图转换`);
  };
  const applyItems = async (targets: Item[]) => {
    if (!ensureKey(imageProvider) || !ensureKey(languageProvider) || busy) return;
    if (!targets.length) return void message.warning('请先修改至少一处文字');
    setBusy(true); await runPool(targets, processItem); setBusy(false); message.success('批量文字修改任务已完成');
  };
  const exportSvg = async (item: Item) => {
    if (!item.resultBlob) return;
    try {
      const name = `${sanitizeFileName(item.file.name)}_花纸文字修改`;
      const svg = await createEmbeddedImageSvg(item.resultBlob, name);
      downloadBlob(svg, `${name}.svg`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : 'SVG 导出失败');
    }
  };
  const downloadVectorSvg = (item: Item) => {
    if (item.vectorBlob) downloadBlob(item.vectorBlob, `${sanitizeFileName(item.file.name)}_真正矢量.svg`);
  };

  const settings = <div className="composer-settings paper-text-settings"><Title level={4}>模型设置</Title><Form layout="vertical">
    <Form.Item label="文字识别与复核"><Segmented block value={languageProvider} onChange={(value) => patchSettings({ languageProvider: value as Provider })} options={[{ label: 'GPT', value: 'openai' }, { label: 'Gemini', value: 'gemini' }]} /></Form.Item>
    <Form.Item label="语言模型"><Select value={languageProvider === 'openai' ? openAiTextModel : geminiTextModel} onChange={(value) => patchSettings(languageProvider === 'openai' ? { openAiTextModel: value } : { geminiTextModel: value })} options={languageProvider === 'openai' ? OPENAI_TEXT_MODELS : GEMINI_TEXT_MODELS} /></Form.Item>
    <Form.Item label="图片编辑"><Segmented block value={imageProvider} onChange={(value) => patchSettings({ imageProvider: value as Provider })} options={[{ label: 'GPT Image', value: 'openai' }, { label: 'Gemini', value: 'gemini' }]} /></Form.Item>
    <Form.Item label="图片模型"><Select value={imageProvider === 'openai' ? openAiImageModel : geminiImageModel} onChange={(value) => patchSettings(imageProvider === 'openai' ? { openAiImageModel: value } : { geminiImageModel: value })} options={imageProvider === 'openai' ? OPENAI_IMAGE_MODELS : GEMINI_IMAGE_MODELS} /></Form.Item>
    {imageProvider === 'openai' && <Form.Item label="GPT 图片质量"><Select value={quality} onChange={(value) => patchSettings({ quality: value })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item>}
    <Form.Item label="识别与修改并发"><InputNumber min={1} max={8} value={concurrency} onChange={(value) => patchSettings({ concurrency: value || 1 })} style={{ width: '100%' }} /></Form.Item>
  </Form><Alert type="info" showIcon title="默认使用 GPT 官方直连" description="OpenAI 请求固定直连 api.openai.com，不使用 Gemini 中转或自定义 Base URL。" /></div>;
  const statusLabel = (status: ItemStatus) => ({ waiting: '待识别', recognizing: '识别中', recognized: '可编辑', editing: '修改中', done: '已完成', error: '失败' })[status];
  const changedCount = active?.regions.filter((r) => r.text !== r.original).length || 0;

  return <div className="paper-text-composer">
    {settingsHost && createPortal(settings, settingsHost)}
    <section className="hero-strip"><div><Text className="eyebrow">PAPER TEXT EDITOR</Text><Title level={2}>花纸文字修改</Title><Paragraph className="hero-description">批量识别包装花纸文字，统一修改共有文字，并发生成和复核结果。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span>上传花纸场景图</Space>} extra={<Button icon={<ScanOutlined />} type="primary" loading={busy} disabled={!items.length} onClick={() => void recognizeAll()}>批量识别</Button>}>
      <Upload.Dragger accept={ACCEPTED.join(',')} multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击上传 PNG / JPEG / WebP</p></Upload.Dragger>
      {items.length > 0 && <div className="paper-queue">{items.map((item) => <Card key={item.id} size="small" hoverable className={item.id === active?.id ? 'is-active' : ''} onClick={() => setActiveId(item.id)}><img src={item.url} alt="" /><Flex justify="space-between" align="center"><Text ellipsis>{item.file.name}</Text><Tag>{statusLabel(item.status)}</Tag></Flex><Button danger type="text" icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); removeItem(item.id); }} /></Card>)}</div>}
    </Card>
    {commonTexts.length > 0 && <Card className="workflow-card paper-common-card" title={<Space><span className="step-badge">2</span>所有图片共有文字</Space>} extra={<Tag color="purple">{commonTexts.length} 项共有</Tag>}><Alert type="info" showIcon title="在这里修改会同步到全部已识别图片" style={{ marginBottom: 14 }} /><div className="paper-common-grid">{commonTexts.map((item) => { const region = recognizedItems[0].regions.find((value) => textKey(value.original) === item.key)!; return <Form.Item key={item.key} label={`原文：${item.original}`}><Input.TextArea value={region.text} autoSize={{ minRows: 1, maxRows: 4 }} onChange={(event) => updateCommonText(item.key, event.target.value)} /></Form.Item>; })}</div></Card>}
    <Card className="workflow-card" title={<Space><span className="step-badge">{commonTexts.length ? 3 : 2}</span>逐图检查与修改</Space>} extra={active && <Text type="secondary">{active.regions.length} 个区域 · {changedCount} 处已修改</Text>}>
      {!active ? <Empty description="上传并识别图片后开始修改" /> : <div className="paper-editor"><div className="paper-stage"><Image preview src={active.url} /><div className="paper-box-layer">{active.regions.map((region, index) => <div key={index} className={region.text !== region.original ? 'paper-box is-changed' : 'paper-box'} style={{ left: `${region.box[0]}%`, top: `${region.box[1]}%`, width: `${region.box[2]}%`, height: `${region.box[3]}%` }}><span>{index + 1}</span></div>)}</div></div><div className="paper-fields">{active.regions.map((region, index) => <Card key={index} size="small" title={`区域 ${index + 1}`} extra={region.text !== region.original && <Tag color="purple">已修改</Tag>}><Text type="secondary">原文：{region.original}</Text><Input.TextArea value={region.text} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(e) => updateRegion(index, e.target.value)} /></Card>)}{active.error && <Alert type="error" showIcon title={active.error} />}</div></div>}
    </Card>
    <Card className="workflow-card" title="公共修改提示词" extra={<Tag color="blue">应用于全部生成图片</Tag>}>
      <Alert type="info" showIcon title="可在这里补充统一的画面、字体或印刷效果要求；指定区域和原图保护规则会继续强制保留。" style={{ marginBottom: 14 }} />
      <Input.TextArea value={commonPrompt} onChange={(event) => setCommonPrompt(event.target.value)} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="例如：保持金色烫印质感，文字边缘清晰，并匹配原图透视。" showCount maxLength={1200} />
    </Card>
    <Card className="action-card"><Flex justify="space-between" align="center" gap={12} wrap><div><Title level={4} style={{ margin: 0 }}>已修改 {changedItems.length} 张图片</Title><Text type="secondary">按右侧并发数同时执行文字修改和结果复核</Text></div><Space>{busy && <Button danger icon={<StopOutlined />} onClick={() => aborter.current?.abort()}>停止</Button>}<Button icon={<ReloadOutlined />} disabled={!active || busy} onClick={() => active && void recognizeOne(active, new AbortController().signal)}>重新识别当前图</Button><Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} disabled={!changedItems.length} onClick={() => void applyItems(changedItems)}>应用到全部已修改图片</Button></Space></Flex>{busy && <Progress style={{ marginTop: 14 }} percent={items.length ? Math.round(completed / items.length * 100) : 0} status="active" />}</Card>
    <section className="results-section"><Flex justify="space-between" align="center" gap={12} wrap><div><Title level={3}>文字修改结果</Title><Text type="secondary">简单花纸会自动生成真实 SVG Path；复杂图片可使用批量转换强制描摹</Text></div><Button icon={<ThunderboltOutlined />} loading={vectorizing} disabled={!items.some((item) => item.resultBlob && item.vectorStatus !== 'ready')} onClick={() => void batchVectorize()}>批量转换为矢量图</Button></Flex>{items.some((item) => item.resultUrl) ? <Image.PreviewGroup><div className="paper-results">{items.filter((item) => item.resultUrl).map((item) => <Card key={item.id} size="small" title={item.file.name} extra={item.resultBlob && <Space size={4}><Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.resultBlob!, `${sanitizeFileName(item.file.name)}_花纸文字修改.png`)}>PNG</Button><Button size="small" type="text" icon={<FileTextOutlined />} onClick={() => void exportSvg(item)}>保真 SVG</Button><Button size="small" type="primary" ghost disabled={!item.vectorBlob} loading={item.vectorStatus === 'checking' || item.vectorStatus === 'converting'} icon={<ThunderboltOutlined />} onClick={() => downloadVectorSvg(item)}>矢量 SVG</Button></Space>}><div className="replace-result-image"><OriginalCompareImage src={compareIds.has(item.id) ? item.url : item.resultUrl} originalSrc={item.url} alt={compareIds.has(item.id) ? '原始图片' : '文字修改结果'} /></div><Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Space wrap><Tag color={item.verification === '复核通过' ? 'success' : 'warning'}>{item.verification || '已生成'}</Tag>{item.vectorStatus === 'ready' ? <Tag color="cyan">真实矢量路径已就绪</Tag> : item.vectorStatus === 'checking' || item.vectorStatus === 'converting' ? <Tag color="processing">正在矢量化</Tag> : item.vectorStatus === 'skipped' ? <Tag>未自动矢量化</Tag> : item.vectorStatus === 'error' ? <Tag color="error">矢量化失败</Tag> : null}</Space><Button size="small" icon={<EyeOutlined />} onClick={() => setCompareIds((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next; })}>{compareIds.has(item.id) ? '查看生成图' : '原图对比'}</Button></Flex>{item.vectorError && <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>{item.vectorError}</Text>}</Card>)}</div></Image.PreviewGroup> : <Empty description="完成文字修改后，结果会显示在这里" />}</section>
  </div>;
}
