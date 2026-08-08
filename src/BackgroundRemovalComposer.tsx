import { ClearOutlined, DeleteOutlined, DownloadOutlined, FileImageOutlined, ReloadOutlined, RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Flex, Form, Image, Popconfirm, Progress, Segmented, Select, Slider, Space, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildGptBackgroundRemovalPrompt, buildGptDirectTransparentPrompt, chooseContrastingBackground, hasUsableTransparency, removeImageBackground } from './services/backgroundRemoval';
import { editPaperTextOpenAi } from './services/paperText';
import { STORAGE_KEYS } from './constants';
import { readLocalStorage } from './storage';
import { reportTaskProgress } from './services/taskProgress';
import { vectorizeImageToSvg } from './services/trueVectorExport';
import { createId, downloadBlob, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
type RemovalMode = 'local' | 'gpt-hybrid' | 'gpt-direct';
interface RemovalSettings { mode: RemovalMode; quality: 'high' | 'medium' | 'low'; gptBackground: string; edgeExpansion: number; edgeFeather: number }
type PreviewMode = 'source' | 'ai' | 'result';
interface Item { id: string; file: File; sourceUrl: string; status: 'waiting' | 'running' | 'success' | 'failed'; progress?: number; stage?: string; matteColor?: string; aiResultBlob?: Blob; aiResultUrl?: string; resultBlob?: Blob; resultUrl?: string; resultMode?: RemovalMode; alphaStatus?: 'valid' | 'missing'; vectorBlob?: Blob; vectorStatus?: 'converting' | 'ready' | 'failed'; error?: string }
const CONCURRENCY = 2;

export default function BackgroundRemovalComposer({ openAiApiKey, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<RemovalSettings>(() => readLocalStorage<RemovalSettings>(STORAGE_KEYS.backgroundRemovalSettings, { mode: 'local', quality: 'high', gptBackground: 'auto', edgeExpansion: 2, edgeFeather: 1 }));
  const patchSettings = (value: Partial<RemovalSettings>) => setSettings((current) => ({ ...current, ...value }));
  const [previewModes, setPreviewModes] = useState<Record<string, PreviewMode>>({});
  const patchItem = (id: string, value: Partial<Item>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  useEffect(() => onSessionStateChange?.(items.length > 0), [items.length, onSessionStateChange]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.backgroundRemovalSettings, JSON.stringify(settings)); }, [settings]);
  useEffect(() => () => { items.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); }, []);
  const completed = items.filter((item) => ['success', 'failed'].includes(item.status)).length;
  const successful = items.filter((item) => item.resultBlob);
  useEffect(() => reportTaskProgress({ id: 'background-removal', label: '去除背景', completed, total: items.length, failed: items.filter((item) => item.status === 'failed').length, running: busy }), [completed, items, busy]);

  const addFiles = (files: File[]) => {
    const next = files.filter((file) => { if (!ACCEPTED.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error(`${file.name}：仅支持 20MB 内的 PNG、JPEG、WebP`); return false; } return true; })
      .map((file) => ({ id: createId(), file, sourceUrl: URL.createObjectURL(file), status: 'waiting' as const }));
    setItems((current) => [...current, ...next]); return false;
  };
  const removeItem = (id: string) => setItems((current) => { const target = current.find((item) => item.id === id); if (target) { URL.revokeObjectURL(target.sourceUrl); if (target.aiResultUrl) URL.revokeObjectURL(target.aiResultUrl); if (target.resultUrl) URL.revokeObjectURL(target.resultUrl); } return current.filter((item) => item.id !== id); });
  const processItem = async (item: Item) => {
    patchItem(item.id, { status: 'running', progress: 0, stage: settings.mode === 'gpt-direct' ? 'GPT 正在直接生成透明 PNG' : settings.mode === 'gpt-hybrid' ? 'GPT 正在分离复杂主体' : '本地模型正在分析主体', error: undefined, alphaStatus: undefined });
    try {
      let intermediate: Blob = item.file;
      if (settings.mode === 'gpt-direct') {
        if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl);
        patchItem(item.id, { aiResultBlob: undefined, aiResultUrl: undefined, matteColor: undefined });
        intermediate = await editPaperTextOpenAi({ apiKey: openAiApiKey, model: 'gpt-image-1.5', image: item.file, prompt: buildGptDirectTransparentPrompt(), quality: settings.quality, background: 'transparent' });
      } else if (settings.mode === 'gpt-hybrid') {
        const matteColor = settings.gptBackground === 'auto' ? await chooseContrastingBackground(item.file) : settings.gptBackground;
        patchItem(item.id, { matteColor });
        intermediate = await editPaperTextOpenAi({ apiKey: openAiApiKey, model: 'gpt-image-2', image: item.file, prompt: buildGptBackgroundRemovalPrompt(matteColor), quality: settings.quality });
        const aiResultUrl = URL.createObjectURL(intermediate);
        if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl);
        patchItem(item.id, { aiResultBlob: intermediate, aiResultUrl });
        setPreviewModes((current) => ({ ...current, [item.id]: 'ai' }));
        patchItem(item.id, { progress: 0, stage: '正在生成精细透明边缘' });
      } else if (item.aiResultUrl) {
        URL.revokeObjectURL(item.aiResultUrl);
        patchItem(item.id, { aiResultBlob: undefined, aiResultUrl: undefined });
      }
      const hasAlpha = await hasUsableTransparency(intermediate);
      const resultBlob = settings.mode === 'gpt-direct'
        ? intermediate
        : hasAlpha ? intermediate : await removeImageBackground(intermediate, ({ percent }) => patchItem(item.id, { progress: percent }), settings);
      const resultUrl = URL.createObjectURL(resultBlob);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      patchItem(item.id, { status: 'success', progress: 100, resultBlob, resultUrl, resultMode: settings.mode, alphaStatus: settings.mode === 'gpt-direct' ? (hasAlpha ? 'valid' : 'missing') : undefined, vectorBlob: undefined, vectorStatus: undefined });
      setPreviewModes((current) => ({ ...current, [item.id]: 'result' }));
    } catch (error) { patchItem(item.id, { status: 'failed', error: error instanceof Error ? error.message : '去除背景失败' }); }
  };
  const run = async (targets = items) => {
    if (!targets.length || busy) return;
    if (settings.mode !== 'local' && !openAiApiKey) return onRequestKey();
    setBusy(true); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => { while (cursor < targets.length) await processItem(targets[cursor++]); }));
    setBusy(false);
  };
  const vectorize = async (item: Item) => {
    if (!item.resultBlob) return; patchItem(item.id, { vectorStatus: 'converting' });
    try { patchItem(item.id, { vectorBlob: await vectorizeImageToSvg(item.resultBlob), vectorStatus: 'ready' }); }
    catch (error) { patchItem(item.id, { vectorStatus: 'failed', error: error instanceof Error ? error.message : '矢量化失败' }); }
  };
  const clearAll = () => { setItems((current) => { current.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); return []; }); setPreviewModes({}); };
  const downloadAll = async () => { const zip = new JSZip(); successful.forEach((item) => item.resultBlob && zip.file(`${sanitizeFileName(item.file.name)}_透明.png`, item.resultBlob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), '去除背景结果.zip'); };
  const previewUrl = (item: Item) => {
    if (!item.aiResultUrl && !item.resultUrl) return undefined;
    const mode = previewModes[item.id] || (item.resultUrl ? 'result' : item.aiResultUrl ? 'ai' : 'source');
    return mode === 'source' ? item.sourceUrl : mode === 'ai' ? item.aiResultUrl : item.resultUrl;
  };
  const panel = <div className="settings-panel"><Title level={4}>智能抠图</Title><Form layout="vertical"><Form.Item label="处理方式"><Select value={settings.mode} onChange={(mode) => patchSettings({ mode })} options={[{ value: 'local', label: '本地智能抠图（快速）' }, { value: 'gpt-hybrid', label: 'GPT 复杂图精细抠图' }, { value: 'gpt-direct', label: 'GPT 直接透明返回（实验）' }]} /></Form.Item>{settings.mode !== 'local' && <Form.Item label="GPT 输出质量"><Select value={settings.quality} onChange={(quality) => patchSettings({ quality })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item>}{settings.mode === 'gpt-hybrid' && <Form.Item label="GPT 分离底色" tooltip="自动模式会选择与原图主体最不相似的高反差颜色"><Select value={settings.gptBackground} onChange={(gptBackground) => patchSettings({ gptBackground })} options={[{ value: 'auto', label: '自动避开主体颜色（推荐）' }, { value: '#FF00FF', label: '🟪 品红 #FF00FF' }, { value: '#00FFFF', label: '🟦 青色 #00FFFF' }, { value: '#00FF00', label: '🟩 绿色 #00FF00' }, { value: '#FFFF00', label: '🟨 黄色 #FFFF00' }, { value: '#000000', label: '⬛ 黑色 #000000' }, { value: '#FFFFFF', label: '⬜ 白色 #FFFFFF' }]} /></Form.Item>}{settings.mode !== 'gpt-direct' && <><Form.Item label={`主体保留：扩展 ${settings.edgeExpansion}px`} tooltip="主体被抠掉太多时调大；背景残留时调小"><Slider min={0} max={8} step={1} value={settings.edgeExpansion} onChange={(edgeExpansion) => patchSettings({ edgeExpansion })} marks={{ 0: '精确', 2: '推荐', 8: '保留更多' }} /></Form.Item><Form.Item label={`边缘柔化：${settings.edgeFeather}px`} tooltip="减少锯齿；过大会让边缘发虚"><Slider min={0} max={4} step={1} value={settings.edgeFeather} onChange={(edgeFeather) => patchSettings({ edgeFeather })} marks={{ 0: '清晰', 1: '推荐', 4: '柔和' }} /></Form.Item></>}</Form><Text type="secondary">{settings.mode === 'local' ? '浏览器本地处理，不需要 API Key。主体被误删时提高“主体保留”。' : settings.mode === 'gpt-direct' ? 'GPT 直接返回透明 PNG，不经过本地模型。系统会检测 Alpha；若未检测到透明通道，会保留原始返回供调试。' : 'GPT 先生成高反差纯色底，本地模型再生成透明 Alpha；可通过 AI 返回图检查底色效果。'}</Text></div>;

  return <div className="background-removal-page"><section className="hero-strip background-removal-hero"><div><Text className="eyebrow">BACKGROUND REMOVER</Text><Title level={2}>一键智能抠图，直接生成透明背景</Title><Paragraph className="hero-description">可选择本地像素级抠图、GPT + Alpha Matting，或由 GPT 直接返回透明 PNG。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 上传待抠图图片" extra={<Space><Text type="secondary">{items.length} 张</Text>{items.length > 0 && <Popconfirm title="清空全部图片？" onConfirm={clearAll}><Button danger size="small" icon={<ClearOutlined />}>清空</Button></Popconfirm>}</Space>}><Upload.Dragger accept={ACCEPTED.join(',')} multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击批量上传 PNG / JPEG / WebP</p></Upload.Dragger>{items.length > 0 && <div className="background-source-grid">{items.map((item) => <Card key={item.id} size="small"><Image src={item.sourceUrl} /><Button danger type="text" block icon={<DeleteOutlined />} disabled={item.status === 'running'} onClick={() => removeItem(item.id)}>删除</Button></Card>)}</div>}</Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>准备处理 {items.length} 张图片</Title><Text type="secondary">{settings.mode === 'gpt-direct' ? 'GPT 直接输出透明 PNG，不执行本地抠图，尽量避免边缘再次处理' : settings.mode === 'gpt-hybrid' ? 'GPT 识别复杂主体 + 本地 Alpha Matting，最终稳定输出透明 PNG' : '点击后直接生成透明 PNG；首次处理需要加载本地抠图模型'}</Text></div><Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} disabled={!items.length} onClick={() => void run()}>一键批量抠图</Button></Flex>{items.length > 0 && <Progress style={{ marginTop: 16 }} percent={Math.round(completed / items.length * 100)} status={busy ? 'active' : successful.length ? 'success' : 'normal'} />}</Card>
    <section className="results-section">
      <Flex justify="space-between" align="center" wrap gap={8}><div><Title level={3}>透明背景结果</Title><Text type="secondary">GPT 模式可切换查看 AI 原始返回图，方便定位语义分离或透明化阶段的问题</Text></div><Button icon={<DownloadOutlined />} disabled={!successful.length} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Flex>
      {items.length ? <Image.PreviewGroup><div className="logo-replace-results">{items.map((item) => <Card key={item.id} size="small" title={item.file.name} extra={<Space>{item.aiResultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.aiResultBlob!, `${sanitizeFileName(item.file.name)}_AI返回.png`)}>AI 原图</Button>}{item.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.resultBlob!, `${sanitizeFileName(item.file.name)}_透明.png`)} />}</Space>}>
        <div className="replace-result-image transparent-result-bg">{previewUrl(item) ? <Image src={previewUrl(item)} /> : <div className={`task-state-card is-${item.status}`}><Text strong>{item.status === 'running' ? item.stage || '模型处理中' : item.status === 'failed' ? '处理失败' : '等待处理'}</Text><Text type="secondary">{item.error}</Text>{item.status === 'running' && <Progress percent={item.progress || 0} size="small" />}</div>}</div>
        {(item.aiResultUrl || item.resultUrl) && <Segmented block size="small" style={{ marginTop: 8 }} value={previewModes[item.id] || (item.resultUrl ? 'result' : 'ai')} onChange={(value) => setPreviewModes((current) => ({ ...current, [item.id]: value as PreviewMode }))} options={[{ label: '原图', value: 'source' }, ...(item.aiResultUrl ? [{ label: 'AI 返回', value: 'ai' }] : []), ...(item.resultUrl ? [{ label: item.resultMode === 'gpt-direct' ? 'GPT 透明返回' : '透明结果', value: 'result' }] : [])]} />}
        <Flex justify="space-between" align="center" style={{ marginTop: 8 }}><Space size={4}><Tag color={item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'running' ? 'processing' : 'default'}>{item.status}</Tag>{item.alphaStatus && <Tag color={item.alphaStatus === 'valid' ? 'success' : 'warning'}>{item.alphaStatus === 'valid' ? '已检测到透明 Alpha' : '未检测到透明 Alpha'}</Tag>}{item.matteColor && <Tag><span style={{ display: 'inline-block', width: 10, height: 10, marginRight: 5, borderRadius: 2, verticalAlign: -1, background: item.matteColor, border: '1px solid #999' }} />底色 {item.matteColor}</Tag>}</Space><Space><Button size="small" icon={<ReloadOutlined />} disabled={busy} onClick={() => void run([item])}>按当前参数重抠</Button>{item.resultBlob && <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} loading={item.vectorStatus === 'converting'} onClick={() => item.vectorBlob ? downloadBlob(item.vectorBlob, `${sanitizeFileName(item.file.name)}_矢量.svg`) : void vectorize(item)}>{item.vectorBlob ? '下载 SVG' : '转为矢量图'}</Button>}</Space></Flex>
      </Card>)}</div></Image.PreviewGroup> : <Empty description="处理结果会显示在这里" />}
    </section>
    {!settingsHost && <aside className="logo-settings">{panel}</aside>}{settingsHost && createPortal(panel, settingsHost)}
  </div>;
}
