import { DeleteOutlined, DownloadOutlined, FileImageOutlined, ReloadOutlined, RocketOutlined, ScanOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Empty, Flex, Form, Image, Input, InputNumber, Segmented, Select, Space, Tag, Typography, Upload } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildPaperTextEditPrompt, editPaperTextOpenAi, recognizePaperTextOpenAi, verifyPaperTextOpenAi, type PaperTextRegion } from './services/paperText';
import { editPaperTextGemini, recognizePaperTextGemini, verifyPaperTextGemini } from './services/gemini';
import { createId, downloadBlob, sanitizeFileName } from './utils';

const { Title, Text, Paragraph } = Typography;
type Provider = 'openai' | 'gemini';
type ItemStatus = 'waiting' | 'recognizing' | 'recognized' | 'editing' | 'done' | 'error';
interface Item { id: string; file: File; url: string; resultUrl?: string; resultBlob?: Blob; regions: PaperTextRegion[]; status: ItemStatus; error?: string; verification?: string }
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

export default function PaperTextComposer({ apiKey, openAiApiKey, apiBaseUrl, onRequestKey, onSessionStateChange, settingsHost }: { apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; onRequestKey: () => void; onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [languageProvider, setLanguageProvider] = useState<Provider>('openai');
  const [imageProvider, setImageProvider] = useState<Provider>('openai');
  const [openAiTextModel, setOpenAiTextModel] = useState('gpt-5.6-luna');
  const [openAiImageModel, setOpenAiImageModel] = useState('gpt-image-2');
  const [geminiTextModel, setGeminiTextModel] = useState('gemini-3.1-flash-lite');
  const [geminiImageModel, setGeminiImageModel] = useState('gemini-3.1-flash-image');
  const [quality, setQuality] = useState('high');
  const [concurrency, setConcurrency] = useState(4);
  const [busy, setBusy] = useState(false);
  const aborter = useRef<AbortController | undefined>(undefined);
  const active = items.find((item) => item.id === activeId) || items[0];
  useEffect(() => onSessionStateChange?.(items.length > 0), [items.length, onSessionStateChange]);
  useEffect(() => () => { aborter.current?.abort(); items.forEach((item) => { URL.revokeObjectURL(item.url); if (item.resultUrl) URL.revokeObjectURL(item.resultUrl); }); }, []);

  const requiredKey = (provider: Provider) => provider === 'openai' ? openAiApiKey : apiKey;
  const ensureKey = (provider: Provider) => { if (requiredKey(provider)) return true; onRequestKey(); message.warning(`请先配置 ${provider === 'openai' ? 'OpenAI' : 'Gemini'} API Key`); return false; };
  const addFiles = (files: File[]) => {
    const next = files.filter((file) => { if (!ACCEPTED.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error(`${file.name}：仅支持 20MB 内的 PNG、JPEG、WebP`); return false; } return true; }).map((file) => ({ id: createId(), file, url: URL.createObjectURL(file), regions: [], status: 'waiting' as const }));
    if (next.length) { setItems((current) => [...current, ...next]); setActiveId((current) => current || next[0].id); }
    return false;
  };
  const removeItem = (id: string) => setItems((current) => { const target = current.find((item) => item.id === id); if (target) { URL.revokeObjectURL(target.url); if (target.resultUrl) URL.revokeObjectURL(target.resultUrl); } const next = current.filter((item) => item.id !== id); if (id === activeId) setActiveId(next[0]?.id); return next; });
  const patch = (id: string, value: Partial<Item>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...value } : item));
  const recognizeOne = async (item: Item, signal: AbortSignal) => {
    patch(item.id, { status: 'recognizing', error: undefined });
    try {
      const regions = languageProvider === 'openai'
        ? await recognizePaperTextOpenAi({ apiKey: openAiApiKey, model: openAiTextModel, image: item.file, signal })
        : await recognizePaperTextGemini({ apiKey, model: geminiTextModel, image: item.file, signal, apiBaseUrl });
      patch(item.id, { status: 'recognized', regions, error: regions.length ? undefined : '未识别到可编辑文字' });
    } catch (error) { patch(item.id, { status: 'error', error: error instanceof Error ? error.message : '识别失败' }); }
  };
  const recognizeAll = async () => {
    if (!ensureKey(languageProvider) || busy) return;
    const jobs = items.filter((item) => item.status !== 'editing'); if (!jobs.length) return;
    setBusy(true); const controller = new AbortController(); aborter.current = controller;
    let cursor = 0; await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => { while (cursor < jobs.length && !controller.signal.aborted) { const item = jobs[cursor++]; await recognizeOne(item, controller.signal); } }));
    setBusy(false); aborter.current = undefined;
  };
  const updateRegion = (index: number, text: string) => active && patch(active.id, { regions: active.regions.map((region, i) => i === index ? { ...region, text } : region) });
  const applyEdit = async () => {
    if (!active || !ensureKey(imageProvider) || !ensureKey(languageProvider)) return;
    const changed = active.regions.filter((region) => region.text !== region.original); if (!changed.length) return void message.warning('请先修改至少一处文字');
    setBusy(true); patch(active.id, { status: 'editing', error: undefined, verification: undefined }); const controller = new AbortController(); aborter.current = controller;
    try {
      let correction = ''; let blob: Blob | undefined; let verification = { ok: false, reason: '尚未复核' };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const prompt = buildPaperTextEditPrompt(active.regions, correction);
        blob = imageProvider === 'openai'
          ? await editPaperTextOpenAi({ apiKey: openAiApiKey, model: openAiImageModel, image: active.file, prompt, quality, signal: controller.signal })
          : await editPaperTextGemini({ apiKey, model: geminiImageModel, image: active.file, prompt, signal: controller.signal, apiBaseUrl });
        verification = languageProvider === 'openai'
          ? await verifyPaperTextOpenAi({ apiKey: openAiApiKey, model: openAiTextModel, image: blob, regions: active.regions, signal: controller.signal })
          : await verifyPaperTextGemini({ apiKey, model: geminiTextModel, image: blob, regions: active.regions, signal: controller.signal, apiBaseUrl });
        if (verification.ok) break; correction = verification.reason;
      }
      if (!blob) throw new Error('图片编辑未返回结果');
      const resultUrl = URL.createObjectURL(blob); if (active.resultUrl) URL.revokeObjectURL(active.resultUrl);
      patch(active.id, { status: 'done', resultBlob: blob, resultUrl, verification: verification.ok ? '复核通过' : `复核未通过：${verification.reason}` });
      verification.ok ? message.success('文字修改完成并通过复核') : message.warning('已生成结果，但自动复核未通过，请检查');
    } catch (error) { patch(active.id, { status: 'error', error: error instanceof Error ? error.message : '修改失败' }); }
    finally { setBusy(false); aborter.current = undefined; }
  };

  const settings = <div className="composer-settings"><Title level={4}>模型设置</Title><Form layout="vertical">
    <Form.Item label="文字识别与复核"><Segmented block value={languageProvider} onChange={(value) => setLanguageProvider(value as Provider)} options={[{ label: 'GPT', value: 'openai' }, { label: 'Gemini', value: 'gemini' }]} /></Form.Item>
    <Form.Item label="语言模型"><Input value={languageProvider === 'openai' ? openAiTextModel : geminiTextModel} onChange={(e) => languageProvider === 'openai' ? setOpenAiTextModel(e.target.value) : setGeminiTextModel(e.target.value)} /></Form.Item>
    <Form.Item label="图片编辑"><Segmented block value={imageProvider} onChange={(value) => setImageProvider(value as Provider)} options={[{ label: 'GPT Image', value: 'openai' }, { label: 'Gemini', value: 'gemini' }]} /></Form.Item>
    <Form.Item label="图片模型"><Input value={imageProvider === 'openai' ? openAiImageModel : geminiImageModel} onChange={(e) => imageProvider === 'openai' ? setOpenAiImageModel(e.target.value) : setGeminiImageModel(e.target.value)} /></Form.Item>
    {imageProvider === 'openai' && <Form.Item label="GPT 图片质量"><Select value={quality} onChange={setQuality} options={['high', 'medium', 'low'].map((value) => ({ value, label: value }))} /></Form.Item>}
    <Form.Item label="批量识别并发"><InputNumber min={1} max={8} value={concurrency} onChange={(value) => setConcurrency(value || 1)} style={{ width: '100%' }} /></Form.Item>
  </Form><Alert type="info" showIcon title="默认使用 GPT 官方直连" description="OpenAI 请求固定直连 api.openai.com，不使用 Gemini 中转或自定义 Base URL。" /></div>;
  const statusLabel = (status: ItemStatus) => ({ waiting: '待识别', recognizing: '识别中', recognized: '可编辑', editing: '修改中', done: '已完成', error: '失败' })[status];
  const changedCount = useMemo(() => active?.regions.filter((r) => r.text !== r.original).length || 0, [active]);

  return <div className="paper-text-composer">
    {settingsHost && createPortal(settings, settingsHost)}
    <section className="hero-strip"><div><Text className="eyebrow">PAPER TEXT EDITOR</Text><Title level={2}>花纸文字修改</Title><Paragraph className="hero-description">批量识别包装花纸文字，逐区域修改，并自动复核生成结果。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span>上传花纸场景图</Space>} extra={<Button icon={<ScanOutlined />} type="primary" loading={busy} disabled={!items.length} onClick={() => void recognizeAll()}>批量识别</Button>}>
      <Upload.Dragger accept={ACCEPTED.join(',')} multiple showUploadList={false} beforeUpload={(file) => addFiles([file as File])}><FileImageOutlined style={{ fontSize: 32 }} /><p>拖拽或点击上传 PNG / JPEG / WebP</p></Upload.Dragger>
      {items.length > 0 && <div className="paper-queue">{items.map((item) => <Card key={item.id} size="small" hoverable className={item.id === active?.id ? 'is-active' : ''} onClick={() => setActiveId(item.id)}><img src={item.resultUrl || item.url} alt="" /><Flex justify="space-between" align="center"><Text ellipsis>{item.file.name}</Text><Tag>{statusLabel(item.status)}</Tag></Flex><Button danger type="text" icon={<DeleteOutlined />} onClick={(e) => { e.stopPropagation(); removeItem(item.id); }} /></Card>)}</div>}
    </Card>
    <Card className="workflow-card" title={<Space><span className="step-badge">2</span>修改识别文字</Space>} extra={active && <Text type="secondary">{active.regions.length} 个区域 · {changedCount} 处已修改</Text>}>
      {!active ? <Empty description="上传并识别图片后开始修改" /> : <div className="paper-editor"><div className="paper-stage"><Image preview src={active.resultUrl || active.url} /><div className="paper-box-layer">{active.regions.map((region, index) => <div key={index} className={region.text !== region.original ? 'paper-box is-changed' : 'paper-box'} style={{ left: `${region.box[0]}%`, top: `${region.box[1]}%`, width: `${region.box[2]}%`, height: `${region.box[3]}%` }}><span>{index + 1}</span></div>)}</div></div><div className="paper-fields">{active.regions.map((region, index) => <Card key={index} size="small" title={`区域 ${index + 1}`} extra={region.text !== region.original && <Tag color="purple">已修改</Tag>}><Text type="secondary">原文：{region.original}</Text><Input.TextArea value={region.text} autoSize={{ minRows: 2, maxRows: 5 }} onChange={(e) => updateRegion(index, e.target.value)} /></Card>)}{active.error && <Alert type="error" showIcon title={active.error} />}{active.verification && <Alert type={active.verification === '复核通过' ? 'success' : 'warning'} showIcon title={active.verification} />}</div></div>}
    </Card>
    <Flex justify="end" gap={12}><Button icon={<ReloadOutlined />} disabled={!active || busy} onClick={() => active && void recognizeOne(active, new AbortController().signal)}>重新识别</Button>{active?.resultBlob && <Button icon={<DownloadOutlined />} onClick={() => downloadBlob(active.resultBlob!, `${sanitizeFileName(active.file.name)}_花纸文字修改.png`)}>下载结果</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={active?.status === 'editing'} disabled={!active || !changedCount || busy} onClick={() => void applyEdit()}>应用文字修改</Button></Flex>
  </div>;
}
