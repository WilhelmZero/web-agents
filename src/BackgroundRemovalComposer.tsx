import { ClearOutlined, DeleteOutlined, DownloadOutlined, EyeOutlined, FileImageOutlined, ReloadOutlined, RocketOutlined, ThunderboltOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Flex, Form, Image, Popconfirm, Progress, Segmented, Select, Slider, Space, Switch, Tag, Tooltip, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { cloneElement, useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { buildGptBackgroundRemovalPrompt, buildGptDirectTransparentPrompt, chooseContrastingBackground, hasUsableTransparency, removeImageBackground } from './services/backgroundRemoval';
import { editPaperTextOpenAi } from './services/paperText';
import { STORAGE_KEYS } from './constants';
import { readLocalStorage } from './storage';
import { reportTaskProgress } from './services/taskProgress';
import { vectorizeImageToSvg, type VectorTraceEngine } from './services/trueVectorExport';
import { upscaleTransparentPng } from './services/imageUpscale';
import { detectBorderMatte, restoreTransparentBackground, type RgbColor } from './services/transparentImageEdit';
import { createId, downloadBlob, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];
type RemovalMode = 'local' | 'hsv-only' | 'gpt-hybrid' | 'gpt-color-key' | 'gpt-direct';
interface RemovalSettings { mode: RemovalMode; quality: 'high' | 'medium' | 'low'; gptBackground: string; edgeExpansion: number; edgeFeather: number; autoVectorize: boolean; vectorEngine: VectorTraceEngine; outputHd: boolean; hdScale: 2 | 4 }
type PreviewMode = 'source' | 'ai' | 'result';
interface Item { id: string; file: File; sourceUrl: string; status: 'waiting' | 'running' | 'success' | 'failed'; progress?: number; stage?: string; matteColor?: string; aiResultBlob?: Blob; aiResultUrl?: string; resultBlob?: Blob; resultUrl?: string; resultMode?: RemovalMode; resultResolution?: string; alphaStatus?: 'valid' | 'missing'; vectorBlob?: Blob; vectorStatus?: 'converting' | 'ready' | 'failed'; error?: string }
const CONCURRENCY = 2;
const hexToRgb = (color: string) => ({ r: Number.parseInt(color.slice(1, 3), 16), g: Number.parseInt(color.slice(3, 5), 16), b: Number.parseInt(color.slice(5, 7), 16) });
const rgbToHex = ({ r, g, b }: RgbColor) => `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;

export default function BackgroundRemovalComposer({ openAiApiKey, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null;
}) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<RemovalSettings>(() => readLocalStorage<RemovalSettings>(STORAGE_KEYS.backgroundRemovalSettings, { mode: 'local', quality: 'high', gptBackground: 'auto', edgeExpansion: 2, edgeFeather: 1, autoVectorize: false, vectorEngine: 'auto', outputHd: false, hdScale: 2 }));
  const [previewCompareOriginal, setPreviewCompareOriginal] = useState(false);
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
    patchItem(item.id, { status: 'running', progress: 0, stage: settings.mode === 'hsv-only' ? '正在识别图片边缘纯色背景' : settings.mode === 'gpt-direct' ? 'GPT 正在直接生成透明 PNG' : settings.mode === 'gpt-color-key' ? 'GPT 正在生成纯色背景版本' : settings.mode === 'gpt-hybrid' ? 'GPT 正在分离复杂主体' : '本地模型正在分析主体', error: undefined, alphaStatus: undefined });
    try {
      let intermediate: Blob = item.file;
      let selectedMatteColor: string | undefined;
      if (settings.mode === 'hsv-only') {
        if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl);
        const matte = settings.gptBackground === 'auto' ? await detectBorderMatte(item.file) : hexToRgb(settings.gptBackground);
        selectedMatteColor = rgbToHex(matte); patchItem(item.id, { matteColor: selectedMatteColor, aiResultBlob: undefined, aiResultUrl: undefined });
      } else if (settings.mode === 'gpt-direct') {
        if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl);
        patchItem(item.id, { aiResultBlob: undefined, aiResultUrl: undefined, matteColor: undefined });
        intermediate = await editPaperTextOpenAi({ apiKey: openAiApiKey, model: 'gpt-image-1.5', image: item.file, prompt: buildGptDirectTransparentPrompt(), quality: settings.quality, background: 'transparent' });
      } else if (settings.mode === 'gpt-hybrid' || settings.mode === 'gpt-color-key') {
        const matteColor = settings.gptBackground === 'auto' ? await chooseContrastingBackground(item.file) : settings.gptBackground;
        selectedMatteColor = matteColor;
        patchItem(item.id, { matteColor });
        intermediate = await editPaperTextOpenAi({ apiKey: openAiApiKey, model: 'gpt-image-2', image: item.file, prompt: buildGptBackgroundRemovalPrompt(matteColor), quality: settings.quality });
        const aiResultUrl = URL.createObjectURL(intermediate);
        if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl);
        patchItem(item.id, { aiResultBlob: intermediate, aiResultUrl });
        setPreviewModes((current) => ({ ...current, [item.id]: 'ai' }));
        patchItem(item.id, { progress: 0, stage: settings.mode === 'gpt-color-key' ? '正在分析 HSV 色域并生成透明 Alpha' : '正在生成精细透明边缘' });
      } else if (item.aiResultUrl) {
        URL.revokeObjectURL(item.aiResultUrl);
        patchItem(item.id, { aiResultBlob: undefined, aiResultUrl: undefined });
      }
      const hasAlpha = await hasUsableTransparency(intermediate);
      const transparentBlob = settings.mode === 'gpt-direct'
        ? intermediate
        : (settings.mode === 'gpt-color-key' || settings.mode === 'hsv-only') && selectedMatteColor
          ? await restoreTransparentBackground(intermediate, hexToRgb(selectedMatteColor))
          : hasAlpha ? intermediate : await removeImageBackground(intermediate, ({ percent }) => patchItem(item.id, { progress: percent }), settings);
      let resultBlob = transparentBlob;
      let resultResolution: string | undefined;
      if (settings.outputHd) {
        patchItem(item.id, { stage: `正在生成 ${settings.hdScale}× 高清透明图` });
        const upscaled = await upscaleTransparentPng(transparentBlob, settings.hdScale);
        resultBlob = upscaled.blob;
        resultResolution = `${upscaled.width} × ${upscaled.height}`;
      }
      const resultUrl = URL.createObjectURL(resultBlob);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      patchItem(item.id, { status: 'success', progress: 100, resultBlob, resultUrl, resultMode: settings.mode, resultResolution, alphaStatus: settings.mode === 'gpt-direct' ? (hasAlpha ? 'valid' : 'missing') : settings.mode === 'gpt-color-key' || settings.mode === 'hsv-only' ? 'valid' : undefined, vectorBlob: undefined, vectorStatus: settings.autoVectorize ? 'converting' : undefined });
      setPreviewModes((current) => ({ ...current, [item.id]: 'result' }));
      if (settings.autoVectorize) {
        try { patchItem(item.id, { vectorBlob: await vectorizeImageToSvg(resultBlob, undefined, settings.vectorEngine), vectorStatus: 'ready' }); }
        catch (error) { patchItem(item.id, { vectorStatus: 'failed', error: error instanceof Error ? error.message : '自动矢量化失败' }); }
      }
    } catch (error) { patchItem(item.id, { status: 'failed', error: error instanceof Error ? error.message : '去除背景失败' }); }
  };
  const run = async (targets = items) => {
    if (!targets.length || busy) return;
    if (settings.mode !== 'local' && settings.mode !== 'hsv-only' && !openAiApiKey) return onRequestKey();
    setBusy(true); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => { while (cursor < targets.length) await processItem(targets[cursor++]); }));
    setBusy(false);
  };
  const vectorize = async (item: Item) => {
    if (!item.resultBlob) return; patchItem(item.id, { vectorStatus: 'converting', error: undefined });
    try { patchItem(item.id, { vectorBlob: await vectorizeImageToSvg(item.resultBlob, undefined, settings.vectorEngine), vectorStatus: 'ready' }); }
    catch (error) { patchItem(item.id, { vectorStatus: 'failed', error: error instanceof Error ? error.message : '矢量化失败' }); }
  };
  const clearAll = () => { setItems((current) => { current.forEach((item) => { URL.revokeObjectURL(item.sourceUrl); if (item.aiResultUrl) URL.revokeObjectURL(item.aiResultUrl); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); return []; }); setPreviewModes({}); };
  const downloadAll = async () => { const zip = new JSZip(); successful.forEach((item) => item.resultBlob && zip.file(`${sanitizeFileName(item.file.name)}_透明.png`, item.resultBlob)); downloadBlob(await zip.generateAsync({ type: 'blob' }), '去除背景结果.zip'); };
  const previewUrl = (item: Item) => {
    if (!item.aiResultUrl && !item.resultUrl) return undefined;
    const mode = previewModes[item.id] || (item.resultUrl ? 'result' : item.aiResultUrl ? 'ai' : 'source');
    return mode === 'source' ? item.sourceUrl : mode === 'ai' ? item.aiResultUrl : item.resultUrl;
  };
  const previewableItems = items.filter((item) => Boolean(previewUrl(item)));
  const vectorEnginePanel = <div className="settings-panel"><Title level={4}>矢量化算法</Title><Form layout="vertical"><Form.Item label="处理引擎" tooltip="透明黑色素材建议选择 ImageTracer；复杂彩色插画可选择 VTracer"><Select value={settings.vectorEngine} onChange={(vectorEngine) => patchSettings({ vectorEngine })} options={[{ value: 'auto', label: '自动识别（默认）' }, { value: 'imagetracer', label: 'ImageTracer（透明图推荐）' }, { value: 'vtracer', label: 'VTracer（复杂彩色图）' }]} /></Form.Item></Form><Text type="secondary">该选择同时作用于自动矢量化和结果卡片中的手动转换。</Text></div>;
  const outputPanel = <div className="settings-panel"><Title level={4}>输出设置</Title><Form layout="vertical"><Form.Item label="自动矢量化" tooltip="抠图完成后自动生成可编辑 SVG 路径"><Switch checked={settings.autoVectorize} onChange={(autoVectorize) => patchSettings({ autoVectorize })} checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item><Form.Item label="输出高清图" tooltip="本地高质量重采样放大并保留透明 Alpha，不消耗 API"><Switch checked={settings.outputHd} onChange={(outputHd) => patchSettings({ outputHd })} checkedChildren="开启" unCheckedChildren="关闭" /></Form.Item>{settings.outputHd && <Form.Item label="高清倍率"><Select value={settings.hdScale} onChange={(hdScale) => patchSettings({ hdScale })} options={[{ value: 2, label: '2× 高清（推荐）' }, { value: 4, label: '4× 超高清' }]} /></Form.Item>}</Form><Text type="secondary">高清图使用本地高质量重采样，保留透明背景；超大图片会自动限制到浏览器安全尺寸。</Text></div>;
  const panel = <div className="settings-panel"><Title level={4}>智能抠图</Title><Form layout="vertical"><Form.Item label="处理方式"><Select value={settings.mode} onChange={(mode) => patchSettings({ mode })} options={[{ value: 'hsv-only', label: '仅 HSV 透明化（无需 AI）' }, { value: 'gpt-color-key', label: 'GPT 纯色分离 + HSV 透明（推荐）' }, { value: 'local', label: '本地智能抠图（快速）' }, { value: 'gpt-hybrid', label: 'GPT 复杂图精细抠图' }, { value: 'gpt-direct', label: 'GPT 直接透明返回（实验）' }]} /></Form.Item>{settings.mode !== 'local' && settings.mode !== 'hsv-only' && <Form.Item label="GPT 输出质量"><Select value={settings.quality} onChange={(quality) => patchSettings({ quality })} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item>}{(settings.mode === 'gpt-hybrid' || settings.mode === 'gpt-color-key' || settings.mode === 'hsv-only') && <Form.Item label={settings.mode === 'hsv-only' ? '原图背景色' : 'GPT 分离底色'} tooltip="自动模式会从原图边缘识别主背景色"><Select value={settings.gptBackground} onChange={(gptBackground) => patchSettings({ gptBackground })} options={[{ value: 'auto', label: settings.mode === 'hsv-only' ? '自动识别图片边缘背景色（推荐）' : '自动避开主体颜色（推荐）' }, { value: '#FF00FF', label: '🟪 品红 #FF00FF' }, { value: '#00FFFF', label: '🟦 青色 #00FFFF' }, { value: '#00FF00', label: '🟩 绿色 #00FF00' }, { value: '#FFFF00', label: '🟨 黄色 #FFFF00' }, { value: '#000000', label: '⬛ 黑色 #000000' }, { value: '#FFFFFF', label: '⬜ 白色 #FFFFFF' }]} /></Form.Item>}{(settings.mode === 'local' || settings.mode === 'gpt-hybrid') && <><Form.Item label={`主体保留：扩展 ${settings.edgeExpansion}px`} tooltip="主体被抠掉太多时调大；背景残留时调小"><Slider min={0} max={8} step={1} value={settings.edgeExpansion} onChange={(edgeExpansion) => patchSettings({ edgeExpansion })} marks={{ 0: '精确', 2: '推荐', 8: '保留更多' }} /></Form.Item><Form.Item label={`边缘柔化：${settings.edgeFeather}px`} tooltip="减少锯齿；过大会让边缘发虚"><Slider min={0} max={4} step={1} value={settings.edgeFeather} onChange={(edgeFeather) => patchSettings({ edgeFeather })} marks={{ 0: '清晰', 1: '推荐', 4: '柔和' }} /></Form.Item></>}</Form><Text type="secondary">{settings.mode === 'local' ? '浏览器本地处理，不需要 API Key。主体被误删时提高“主体保留”。' : settings.mode === 'hsv-only' ? '直接从原图边缘识别纯色背景并转换为 Alpha，不请求 AI，也不运行本地抠图模型。' : settings.mode === 'gpt-direct' ? 'GPT 直接返回透明 PNG，不经过本地模型。系统会检测 Alpha；若未检测到透明通道，会保留原始返回供调试。' : settings.mode === 'gpt-color-key' ? '复刻 ChatGPT 下载附件流程：GPT 只生成纯色底，浏览器分析 HSV 色域、去除色边并输出 RGBA PNG，不运行本地抠图模型。' : 'GPT 先生成高反差纯色底，本地模型再生成透明 Alpha；可通过 AI 返回图检查底色效果。'}</Text></div>;

  return <div className="background-removal-page"><section className="hero-strip background-removal-hero"><div><Text className="eyebrow">BACKGROUND REMOVER</Text><Title level={2}>一键智能抠图，直接生成透明背景</Title><Paragraph className="hero-description">可选择本地像素级抠图、GPT + Alpha Matting，或由 GPT 直接返回透明 PNG。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 上传待抠图图片" extra={<Space><Text type="secondary">{items.length} 张</Text>{items.length > 0 && <Popconfirm title="清空全部图片？" onConfirm={clearAll}><Button danger size="small" icon={<ClearOutlined />}>清空</Button></Popconfirm>}</Space>}><Upload.Dragger accept={ACCEPTED.join(',')} multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击批量上传 PNG / JPEG / WebP</p></Upload.Dragger>{items.length > 0 && <div className="background-source-grid">{items.map((item) => <Card key={item.id} size="small"><Image src={item.sourceUrl} /><Button danger type="text" block icon={<DeleteOutlined />} disabled={item.status === 'running'} onClick={() => removeItem(item.id)}>删除</Button></Card>)}</div>}</Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>准备处理 {items.length} 张图片</Title><Text type="secondary">{settings.mode === 'hsv-only' ? '直接识别并移除现有高反差背景，不产生任何 AI 请求' : settings.mode === 'gpt-direct' ? 'GPT 直接输出透明 PNG，不执行本地抠图，尽量避免边缘再次处理' : settings.mode === 'gpt-color-key' ? 'GPT 生成高反差纯色底，再按 HSV 色域转换透明 Alpha，不重新识别或裁切主体' : settings.mode === 'gpt-hybrid' ? 'GPT 识别复杂主体 + 本地 Alpha Matting，最终稳定输出透明 PNG' : '点击后直接生成透明 PNG；首次处理需要加载本地抠图模型'}</Text></div><Button type="primary" size="large" icon={<RocketOutlined />} loading={busy} disabled={!items.length} onClick={() => void run()}>一键批量抠图</Button></Flex>{items.length > 0 && <Progress style={{ marginTop: 16 }} percent={Math.round(completed / items.length * 100)} status={busy ? 'active' : successful.length ? 'success' : 'normal'} />}</Card>
    <section className="results-section">
      <Flex justify="space-between" align="center" wrap gap={8}><div><Title level={3}>透明背景结果</Title><Text type="secondary">GPT 模式可切换查看 AI 原始返回图，方便定位语义分离或透明化阶段的问题</Text></div><Button icon={<DownloadOutlined />} disabled={!successful.length} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Flex>
      {items.length ? <Image.PreviewGroup preview={{ onOpenChange: (open) => { if (!open) setPreviewCompareOriginal(false); }, onChange: () => setPreviewCompareOriginal(false), actionsRender: (originalNode) => <>{originalNode}<Tooltip title={previewCompareOriginal ? '查看处理结果' : '查看原图'}><button type="button" className={previewCompareOriginal ? 'scene-preview-compare-action is-active' : 'scene-preview-compare-action'} onClick={() => setPreviewCompareOriginal((current) => !current)}><EyeOutlined /></button></Tooltip></>, imageRender: (originalNode, info) => previewCompareOriginal && previewableItems[info.current] ? cloneElement(originalNode as ReactElement<{ src?: string; alt?: string }>, { src: previewableItems[info.current].sourceUrl, alt: `${previewableItems[info.current].file.name} 原图` }) : originalNode }}><div className="logo-replace-results">{items.map((item) => <Card key={item.id} size="small" title={item.file.name} extra={<Space>{item.aiResultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.aiResultBlob!, `${sanitizeFileName(item.file.name)}_AI返回.png`)}>AI 原图</Button>}{item.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadBlob(item.resultBlob!, `${sanitizeFileName(item.file.name)}_透明.png`)} />}</Space>}>
        <div className="replace-result-image transparent-result-bg">{previewUrl(item) ? <Image src={previewUrl(item)} /> : <div className={`task-state-card is-${item.status}`}><Text strong>{item.status === 'running' ? item.stage || '模型处理中' : item.status === 'failed' ? '处理失败' : '等待处理'}</Text><Text type="secondary">{item.error}</Text>{item.status === 'running' && <Progress percent={item.progress || 0} size="small" />}</div>}</div>
        {(item.aiResultUrl || item.resultUrl) && <Segmented block size="small" style={{ marginTop: 8 }} value={previewModes[item.id] || (item.resultUrl ? 'result' : 'ai')} onChange={(value) => setPreviewModes((current) => ({ ...current, [item.id]: value as PreviewMode }))} options={[{ label: '原图', value: 'source' }, ...(item.aiResultUrl ? [{ label: 'AI 返回', value: 'ai' }] : []), ...(item.resultUrl ? [{ label: item.resultMode === 'gpt-direct' ? 'GPT 透明返回' : '透明结果', value: 'result' }] : [])]} />}
        <div className="background-result-footer">
          <div className="background-result-status"><Tag color={item.status === 'success' ? 'success' : item.status === 'failed' ? 'error' : item.status === 'running' ? 'processing' : 'default'}>{item.status}</Tag>{item.alphaStatus && <Tag color={item.alphaStatus === 'valid' ? 'success' : 'warning'}>{item.alphaStatus === 'valid' ? '已检测到透明 Alpha' : '未检测到透明 Alpha'}</Tag>}{item.matteColor && <Tag><span style={{ display: 'inline-block', width: 10, height: 10, marginRight: 5, borderRadius: 2, verticalAlign: -1, background: item.matteColor, border: '1px solid #999' }} />底色 {item.matteColor}</Tag>}</div>
          <div className="background-result-actions"><Button size="small" icon={<ReloadOutlined />} disabled={busy} onClick={() => void run([item])}>按当前参数重抠</Button>{item.resultBlob && <Button size="small" type="primary" ghost icon={<ThunderboltOutlined />} loading={item.vectorStatus === 'converting'} onClick={() => void vectorize(item)}>{item.vectorBlob ? '按当前参数重新矢量化' : '转为矢量图'}</Button>}{item.vectorBlob && <Button size="small" icon={<DownloadOutlined />} disabled={item.vectorStatus === 'converting'} onClick={() => downloadBlob(item.vectorBlob!, `${sanitizeFileName(item.file.name)}_矢量.svg`)}>下载 SVG</Button>}</div>
        </div>
      </Card>)}</div></Image.PreviewGroup> : <Empty description="处理结果会显示在这里" />}
    </section>
    {!settingsHost && <aside className="logo-settings">{panel}{outputPanel}{vectorEnginePanel}</aside>}{settingsHost && createPortal(<>{panel}{outputPanel}{vectorEnginePanel}</>, settingsHost)}
  </div>;
}
