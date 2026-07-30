import {
  BulbOutlined,
  ClearOutlined,
  DownloadOutlined,
  FileImageOutlined,
  HighlightOutlined,
  RocketOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { FileCard } from '@ant-design/x';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Divider,
  Flex,
  Form,
  Input,
  Progress,
  Radio,
  Segmented,
  Select,
  Slider,
  Space,
  Statistic,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_INPAINT_SETTINGS,
  MODEL_CAPABILITIES,
  PRICING,
  STORAGE_KEYS,
} from './constants';
import GeneratingImage from './GeneratingImage';
import { generateInpaintImage, optimizePrompt } from './services/gemini';
import { readLocalStorage } from './storage';
import type { InpaintSettings } from './types';
import {
  downloadBlob,
  estimateImageCost,
  mimeExtension,
  normalizeSettingsForModel,
  sanitizeFileName,
} from './utils';

const { Dragger } = Upload;
const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function MaskCanvas({
  imageUrl,
  onChange,
}: {
  imageUrl: string;
  onChange: (guide?: Blob) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLImageElement | undefined>(undefined);
  const maskRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const pointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const hasMaskRef = useRef(false);
  const [mode, setMode] = useState<'box' | 'brush'>('box');
  const [brushSize, setBrushSize] = useState(42);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const mask = maskRef.current;
    if (!canvas || !scene || !mask) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(scene, 0, 0, canvas.width, canvas.height);
    context.drawImage(mask, 0, 0);
  }, []);

  const clear = useCallback(() => {
    const mask = maskRef.current;
    mask?.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
    hasMaskRef.current = false;
    onChange(undefined);
    render();
  }, [onChange, render]);

  useEffect(() => {
    const image = new window.Image();
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const mask = document.createElement('canvas');
      mask.width = width;
      mask.height = height;
      sceneRef.current = image;
      maskRef.current = mask;
      hasMaskRef.current = false;
      onChange(undefined);
      render();
    };
    image.src = imageUrl;
  }, [imageUrl, onChange, render]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height,
    };
  };
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = point(event);
    if (mode === 'box') clear();
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const previous = pointerRef.current;
    const mask = maskRef.current;
    if (!previous || !mask) return;
    const current = point(event);
    const context = mask.getContext('2d');
    if (!context) return;
    context.fillStyle = 'rgba(255,45,85,.46)';
    context.strokeStyle = 'rgba(255,45,85,.58)';
    if (mode === 'box') {
      context.clearRect(0, 0, mask.width, mask.height);
      context.fillRect(previous.x, previous.y, current.x - previous.x, current.y - previous.y);
    } else {
      context.lineWidth = brushSize * mask.width / Math.max(1, event.currentTarget.getBoundingClientRect().width);
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(previous.x, previous.y);
      context.lineTo(current.x, current.y);
      context.stroke();
      pointerRef.current = current;
    }
    hasMaskRef.current = true;
    render();
  };
  const pointerUp = () => {
    pointerRef.current = undefined;
    const canvas = canvasRef.current;
    if (!canvas || !hasMaskRef.current) return;
    canvas.toBlob((blob) => onChange(blob || undefined), 'image/png');
  };

  return (
    <>
      <Flex gap={16} align="center" wrap className="inpaint-toolbar">
        <Segmented value={mode} onChange={(value) => { setMode(value as typeof mode); clear(); }} options={[{ label: '框选', value: 'box' }, { label: '画笔涂抹', value: 'brush' }]} />
        {mode === 'brush' && <Flex align="center" gap={8} className="inpaint-brush-slider"><Text>画笔大小</Text><Slider min={8} max={120} value={brushSize} onChange={setBrushSize} /></Flex>}
        <Button icon={<ClearOutlined />} onClick={clear}>清除选区</Button>
      </Flex>
      <div className="inpaint-page-canvas">
        <canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} />
      </div>
    </>
  );
}

export default function InpaintComposer({
  apiKey,
  apiBaseUrl,
  connectionMode,
  onRequestKey,
  onSessionStateChange,
  settingsHost,
}: {
  apiKey: string;
  apiBaseUrl: string | null;
  connectionMode: 'direct' | 'proxy';
  onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void;
  settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<InpaintSettings>(() =>
    readLocalStorage(STORAGE_KEYS.inpaintSettings, DEFAULT_INPAINT_SETTINGS as InpaintSettings),
  );
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [maskGuide, setMaskGuide] = useState<Blob>();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<{ blob: Blob; url: string; mimeType: string }>();
  const [status, setStatus] = useState<'idle' | 'waiting' | 'running' | 'success' | 'failed'>('idle');
  const [error, setError] = useState<string>();
  const [optimizing, setOptimizing] = useState(false);
  const aborter = useRef<AbortController | undefined>(undefined);
  const capability = MODEL_CAPABILITIES[settings.imageModel];

  useEffect(() => localStorage.setItem(STORAGE_KEYS.inpaintSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(file || prompt.trim() || result)), [file, prompt, result, onSessionStateChange]);
  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
  }, []);

  const patchSettings = (patch: Partial<InpaintSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      return patch.imageModel ? { ...next, ...normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize) } : next;
    });
  };
  const selectFile = (next: File) => {
    if (!ACCEPTED_TYPES.includes(next.type) || !next.size || next.size > 20 * 1024 * 1024) {
      message.error('仅支持不超过 20MB 的 PNG、JPEG 或 WebP 图片');
      return false;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setMaskGuide(undefined);
    setResult(undefined);
    setStatus('idle');
    return false;
  };
  const checkApi = () => {
    if (!apiKey || (connectionMode === 'proxy' && !apiBaseUrl)) {
      onRequestKey();
      message.warning(!apiKey ? '请先配置 API Key' : '请先配置代理地址');
      return false;
    }
    return true;
  };
  const optimize = async () => {
    if (!checkApi() || !prompt.trim()) return void message.warning('请先输入提示词');
    setOptimizing(true);
    try {
      setPrompt(await optimizePrompt({ apiKey, apiBaseUrl, model: settings.optimizerModel, prompt: `这是严格局部重绘任务，只能修改用户选定区域。${prompt}` }));
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '提示词优化失败');
    } finally {
      setOptimizing(false);
    }
  };
  const generate = async () => {
    if (!checkApi()) return;
    if (!file || !previewUrl) return void message.warning('请先上传一张图片');
    if (!maskGuide) return void message.warning('请先框选或涂抹需要修改的区域');
    if (!prompt.trim()) return void message.warning('请输入局部重绘要求');
    result?.url && URL.revokeObjectURL(result.url);
    setResult(undefined);
    setError(undefined);
    setStatus('waiting');
    const controller = new AbortController();
    aborter.current = controller;
    await Promise.resolve();
    setStatus('running');
    try {
      const generated = await generateInpaintImage({
        apiKey,
        apiBaseUrl,
        model: settings.imageModel,
        prompt: prompt.trim(),
        image: file,
        maskGuide,
        aspectRatio: settings.ratioMode === 'fixed' ? settings.aspectRatio : undefined,
        imageSize: settings.imageSize,
        signal: controller.signal,
      });
      setResult({ blob: generated.blob, url: URL.createObjectURL(generated.blob), mimeType: generated.mimeType });
      setStatus('success');
    } catch (reason) {
      if (controller.signal.aborted) {
        setStatus('idle');
      } else {
        setStatus('failed');
        setError(reason instanceof Error ? reason.message : '局部重绘失败');
      }
    } finally {
      aborter.current = undefined;
    }
  };
  const clearAll = () => {
    aborter.current?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (result) URL.revokeObjectURL(result.url);
    setFile(undefined);
    setPreviewUrl(undefined);
    setMaskGuide(undefined);
    setPrompt('');
    setResult(undefined);
    setStatus('idle');
    setError(undefined);
  };
  const resultName = useMemo(
    () => `${sanitizeFileName(file?.name || '局部重绘')}_inpaint.${mimeExtension(result?.mimeType)}`,
    [file?.name, result?.mimeType],
  );

  const settingsPanel = (
    <div className="settings-panel">
      <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>重绘设置</Title><Tag color="magenta">单图</Tag></Flex>
      <Divider />
      <Form layout="vertical">
        <Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item>
        <Form.Item label="画面比例">
          <Radio.Group value={settings.ratioMode} onChange={(event) => patchSettings({ ratioMode: event.target.value })}><Radio value="original">跟随原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>
          {settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patchSettings({ aspectRatio })} options={capability.aspectRatios.map((value) => ({ value, label: value }))} />}
        </Form.Item>
        <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as InpaintSettings['imageSize'] })} options={capability.imageSizes} /></Form.Item>
        <Form.Item label="提示词优化模型"><Select value={settings.optimizerModel} onChange={(optimizerModel) => patchSettings({ optimizerModel })} options={[{ value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }, { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' }, { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]} /></Form.Item>
      </Form>
      <Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel, settings.imageSize, 1) + PRICING.models[settings.imageModel].inputImage * 2} /><Text type="secondary">按一次请求和两张输入参考图估算。</Text></Card>
    </div>
  );

  return (
    <div className="inpaint-page">
      <section className="hero-strip inpaint-hero"><div><Text className="eyebrow">LOCAL INPAINTING</Text><Title level={2}>只重绘你指定的区域</Title><Paragraph className="hero-description">框选或涂抹局部区域，严格保持图片其他内容与构图不变。</Paragraph></div><div className="hero-orb" /></section>
      <Card className="workflow-card" title={<Space><FileImageOutlined /><span>上传单张原图</span></Space>} extra={<Button type="text" danger disabled={!file} onClick={clearAll}>清空</Button>}>
        {!previewUrl ? (
          <Dragger accept={ACCEPTED_TYPES.join(',')} multiple={false} showUploadList={false} beforeUpload={selectFile}>
            <p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">点击或拖拽上传图片</p><p className="ant-upload-hint">PNG / JPEG / WebP，单张不超过 20MB</p>
          </Dragger>
        ) : (
          <>
            <Alert type="info" showIcon title="红色区域是唯一允许 AI 修改的位置" description="重新选择图片会清除当前选区和生成结果。" style={{ marginBottom: 14 }} />
            <MaskCanvas imageUrl={previewUrl} onChange={setMaskGuide} />
            <Upload accept={ACCEPTED_TYPES.join(',')} showUploadList={false} beforeUpload={selectFile}><Button style={{ marginTop: 12 }}>替换原图</Button></Upload>
          </>
        )}
      </Card>
      <Card className="workflow-card" title={<Space><HighlightOutlined /><span>局部重绘提示词</span></Space>} extra={<Button icon={<ClearOutlined />} onClick={() => setPrompt('')}>清空</Button>}>
        <Input.TextArea rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} maxLength={2000} showCount placeholder="例如：将选中区域的杯子颜色改为磨砂白色，保持其余区域完全不变……" />
        <Flex justify="end" style={{ marginTop: 12 }}><Button icon={<BulbOutlined />} loading={optimizing} onClick={() => void optimize()}>优化提示词</Button></Flex>
      </Card>
      <Card className="action-card">
        <Flex justify="space-between" align="center" gap={12} wrap><div><Title level={4} style={{ margin: 0 }}>生成 1 张局部重绘图</Title><Text type="secondary">仅修改红色选区</Text></div><Space>{status === 'running' && <Button danger icon={<StopOutlined />} onClick={() => aborter.current?.abort()}>停止</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={status === 'running'} onClick={() => void generate()}>开始重绘</Button></Space></Flex>
        {status === 'waiting' && <GeneratingImage status="waiting" percent={0} />}
        {status === 'running' && <Progress style={{ marginTop: 18 }} percent={50} status="active" />}
        {error && <Alert style={{ marginTop: 16 }} type="error" showIcon title="局部重绘失败" description={error} />}
      </Card>
      <section className="results-section">
        <Card
          className="workflow-card inpaint-result-card"
          title={<Space><FileImageOutlined /><span>重绘结果</span></Space>}
          extra={result ? <Button type="primary" icon={<DownloadOutlined />} onClick={() => downloadBlob(result.blob, resultName)}>下载图片</Button> : null}
        >
          {result
            ? <FileCard name={resultName} byte={result.blob.size} src={result.url} type="image" imageProps={{ preview: true }} />
            : <div className="inpaint-empty-result">{status === 'running' ? <GeneratingImage status="running" percent={50} /> : <Text type="secondary">生成结果会显示在这里</Text>}</div>}
        </Card>
      </section>
      {!settingsHost && <aside className="logo-settings">{settingsPanel}</aside>}
      {settingsHost && createPortal(settingsPanel, settingsHost)}
    </div>
  );
}
