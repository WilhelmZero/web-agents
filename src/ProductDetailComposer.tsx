import {
  AppstoreOutlined,
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Divider,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DEFAULT_PRODUCT_DETAIL_SETTINGS,
  MODEL_CAPABILITIES,
  PRICING,
  STORAGE_KEYS,
} from './constants';
import GeneratingImage from './GeneratingImage';
import {
  analyzeProductDetailPrompts,
  generateProductDetailImage,
} from './services/gemini';
import {
  composeDetailLongImage,
  downloadAllDetailTasks,
  downloadDetailTask,
  extractOverlayTexts,
  replaceOverlayText,
} from './services/productDetailUtils';
import { readLocalStorage } from './storage';
import type {
  ProductDetailPrompt,
  ProductDetailSettings,
  ProductDetailTask,
} from './types';
import {
  createId,
  downloadBlob,
  estimateImageCost,
  normalizeSettingsForModel,
} from './utils';

const { Dragger } = Upload;
const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

export default function ProductDetailComposer({
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
  const { message, modal } = AntApp.useApp();
  const [settings, setSettings] = useState<ProductDetailSettings>(() =>
    readLocalStorage(STORAGE_KEYS.productDetailSettings, DEFAULT_PRODUCT_DETAIL_SETTINGS as ProductDetailSettings),
  );
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [productInfo, setProductInfo] = useState('');
  const [prompts, setPrompts] = useState<ProductDetailPrompt[]>([]);
  const [tasks, setTasks] = useState<ProductDetailTask[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [compositePreviewUrl, setCompositePreviewUrl] = useState<string>();
  const runningIds = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const fileRef = useRef<File | undefined>(undefined);
  const promptsRef = useRef<ProductDetailPrompt[]>([]);
  const settingsRef = useRef(settings);
  const capability = MODEL_CAPABILITIES[settings.imageModel];

  useEffect(() => { fileRef.current = file; }, [file]);
  useEffect(() => { promptsRef.current = prompts; }, [prompts]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.productDetailSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(file || productInfo.trim() || prompts.length || tasks.length)), [file, productInfo, prompts.length, tasks.length, onSessionStateChange]);

  const successfulTasks = tasks.filter((task) => task.resultBlob);
  const processing = tasks.some((task) => task.status === 'waiting' || task.status === 'running');
  const completed = tasks.filter((task) => ['success', 'failed', 'stopped'].includes(task.status)).length;
  const estimatedCost = estimateImageCost(settings.imageModel, settings.imageSize, prompts.length)
    + prompts.length * PRICING.models[settings.imageModel].inputImage;

  const checkApi = () => {
    if (!apiKey || (connectionMode === 'proxy' && !apiBaseUrl)) {
      onRequestKey();
      message.warning(!apiKey ? '请先配置 API Key' : '请先配置代理地址');
      return false;
    }
    return true;
  };
  const clearTaskUrls = (items: ProductDetailTask[]) => items.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
  const selectFile = (next: File) => {
    if (!ACCEPTED_TYPES.includes(next.type) || !next.size || next.size > 20 * 1024 * 1024) {
      message.error('仅支持不超过 20MB 的 PNG、JPEG 或 WebP 图片');
      return false;
    }
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    clearTaskUrls(tasks);
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setPrompts([]);
    setTasks([]);
    return false;
  };
  const clearAll = () => {
    aborters.current.forEach((controller) => controller.abort());
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    clearTaskUrls(tasks);
    setFile(undefined);
    setPreviewUrl(undefined);
    setProductInfo('');
    setPrompts([]);
    setTasks([]);
    if (compositePreviewUrl) URL.revokeObjectURL(compositePreviewUrl);
    setCompositePreviewUrl(undefined);
  };
  const patchSettings = (patch: Partial<ProductDetailSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (patch.imageModel) return { ...next, ...normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize) };
      return next;
    });
  };

  const performAnalysis = async () => {
    if (!checkApi()) return;
    if (!file) return void message.warning('请先上传一张产品白底图');
    if (!productInfo.trim()) return void message.warning('请先填写商品信息');
    setAnalyzing(true);
    try {
      const analyzed = await analyzeProductDetailPrompts({
        apiKey,
        apiBaseUrl,
        model: settings.analyzerModel,
        image: file,
        productInfo: productInfo.trim(),
        count: settings.targetCount,
      });
      clearTaskUrls(tasks);
      setPrompts(analyzed.map((item, index) => ({ id: createId(), index, ...item })));
      setTasks([]);
      message.success(`已生成 ${analyzed.length} 条详情图提示词`);
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '商品分析失败');
    } finally {
      setAnalyzing(false);
    }
  };
  const analyze = () => {
    if (!prompts.length && !tasks.length) return void performAnalysis();
    modal.confirm({
      title: '重新分析商品？',
      content: '现有提示词、任务和生成结果将被清空。',
      okText: '重新分析',
      onOk: performAnalysis,
    });
  };

  const updatePromptContent = (id: string, content: string) => {
    setPrompts((current) => current.map((item) => item.id === id
      ? { ...item, content, overlayTexts: extractOverlayTexts(content) }
      : item));
  };
  const updateOverlay = (promptId: string, index: number, value: string) => {
    setPrompts((current) => current.map((item) => {
      if (item.id !== promptId) return item;
      const previous = item.overlayTexts[index];
      const overlayTexts = item.overlayTexts.map((text, itemIndex) => itemIndex === index ? value : text);
      return { ...item, overlayTexts, content: replaceOverlayText(item.content, previous, value) };
    }));
  };
  const addOverlay = (promptId: string) => {
    setPrompts((current) => current.map((item) => item.id === promptId
      ? { ...item, overlayTexts: [...item.overlayTexts, '新文案'], content: `${item.content.trim()} 画面中清晰显示文字“新文案”。` }
      : item));
  };
  const removeOverlay = (promptId: string, index: number) => {
    setPrompts((current) => current.map((item) => {
      if (item.id !== promptId) return item;
      const value = item.overlayTexts[index];
      return {
        ...item,
        overlayTexts: item.overlayTexts.filter((_, itemIndex) => itemIndex !== index),
        content: item.content.replace(new RegExp(`\\s*[^。]*[“"]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[”"][^。]*。?`), '').trim(),
      };
    }));
  };

  const queuePrompt = (promptId: string) => {
    if (!checkApi()) return;
    const prompt = prompts.find((item) => item.id === promptId);
    if (!file || !prompt?.content.trim()) return void message.warning('图片或提示词不完整');
    setTasks((current) => {
      const existing = current.find((task) => task.promptId === promptId);
      if (existing) return current.map((task) => task.promptId === promptId ? { ...task, status: 'waiting', error: undefined, retryCount: task.retryCount + 1 } : task);
      return [...current, { id: createId(), promptId, status: 'waiting', retryCount: 0 }];
    });
  };
  const queueAll = () => {
    if (!checkApi()) return;
    if (!file || !prompts.length) return void message.warning('请先完成商品分析');
    setTasks((current) => prompts.map((prompt) => {
      const existing = current.find((task) => task.promptId === prompt.id);
      return existing
        ? { ...existing, status: 'waiting' as const, error: undefined, retryCount: existing.retryCount + 1 }
        : { id: createId(), promptId: prompt.id, status: 'waiting' as const, retryCount: 0 };
    }));
  };

  const executeTask = useCallback(async (task: ProductDetailTask) => {
    if (runningIds.current.has(task.id)) return;
    const source = fileRef.current;
    const prompt = promptsRef.current.find((item) => item.id === task.promptId);
    if (!source || !prompt) return;
    runningIds.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const currentSettings = settingsRef.current;
      const generated = await generateProductDetailImage({
        apiKey,
        apiBaseUrl,
        model: currentSettings.imageModel,
        image: source,
        prompt: prompt.content,
        aspectRatio: currentSettings.ratioMode === 'fixed' ? currentSettings.aspectRatio : undefined,
        imageSize: currentSettings.imageSize,
        signal: controller.signal,
      });
      const resultUrl = URL.createObjectURL(generated.blob);
      setTasks((current) => current.map((item) => {
        if (item.id !== task.id) return item;
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
        return { ...item, status: 'success', resultBlob: generated.blob, resultUrl, resultMimeType: generated.mimeType };
      }));
    } catch (reason) {
      setTasks((current) => current.map((item) => item.id === task.id
        ? { ...item, status: controller.signal.aborted ? 'stopped' : 'failed', error: controller.signal.aborted ? '任务已停止' : reason instanceof Error ? reason.message : '生成失败' }
        : item));
    } finally {
      runningIds.current.delete(task.id);
      aborters.current.delete(task.id);
    }
  }, [apiKey, apiBaseUrl]);

  useEffect(() => {
    const available = Math.max(0, settings.concurrency - runningIds.current.size);
    tasks.filter((task) => task.status === 'waiting' && !runningIds.current.has(task.id)).slice(0, available).forEach((task) => void executeTask(task));
  }, [tasks, settings.concurrency, executeTask]);

  const stop = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => current.map((task) => task.status === 'waiting' ? { ...task, status: 'stopped', error: '任务已停止' } : task));
  };
  const clearResults = () => {
    aborters.current.forEach((controller) => controller.abort());
    clearTaskUrls(tasks);
    setTasks([]);
    if (compositePreviewUrl) URL.revokeObjectURL(compositePreviewUrl);
    setCompositePreviewUrl(undefined);
  };

  const buildComposite = async (mode: 'preview' | 'download') => {
    if (!successfulTasks.length) return void message.warning('暂无可合成的成功结果');
    const missing = prompts.length - successfulTasks.length;
    if (missing > 0) message.warning(`长图只包含 ${successfulTasks.length} 张成功结果，跳过 ${missing} 张未成功图片`);
    try {
      const blob = await composeDetailLongImage(tasks, prompts);
      if (mode === 'download') {
        downloadBlob(blob, '商品详情页合成长图.png');
        return;
      }
      if (compositePreviewUrl) URL.revokeObjectURL(compositePreviewUrl);
      setCompositePreviewUrl(URL.createObjectURL(blob));
    } catch (reason) {
      message.error(reason instanceof Error ? reason.message : '详情长图合成失败');
    }
  };

  const settingsPanel = (
    <div className="settings-panel">
      <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>详情页设置</Title><Tag color="blue">单商品</Tag></Flex>
      <Divider />
      <Form layout="vertical">
        <Form.Item label="商品分析语言模型"><Select value={settings.analyzerModel} onChange={(analyzerModel) => patchSettings({ analyzerModel })} options={[{ value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' }, { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' }, { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' }]} /></Form.Item>
        <Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item>
        <Form.Item label="生成张数"><InputNumber min={1} max={10} value={settings.targetCount} onChange={(targetCount) => patchSettings({ targetCount: targetCount || 1 })} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="画面比例"><Radio.Group value={settings.ratioMode} onChange={(event) => patchSettings({ ratioMode: event.target.value })}><Radio value="original">跟随原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>{settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patchSettings({ aspectRatio })} options={capability.aspectRatios.map((value) => ({ value, label: value }))} />}</Form.Item>
        <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as ProductDetailSettings['imageSize'] })} options={capability.imageSizes} /></Form.Item>
        <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item>
      </Form>
      <Card className="price-card" variant="borderless"><Statistic title="预计图片费用" prefix="$" precision={3} value={estimatedCost} /><Text type="secondary">按 {prompts.length || settings.targetCount} 张详情图估算，不含商品分析文本 token。</Text></Card>
    </div>
  );

  return (
    <div className="product-detail-page">
      <section className="hero-strip product-detail-hero"><div><Text className="eyebrow">PRODUCT DETAIL STUDIO</Text><Title level={2}>从白底图规划完整商品详情页</Title><Paragraph className="hero-description">先理解商品，再从不同角度生成可编辑的详情图方案。</Paragraph></div><div className="hero-orb" /></section>
      <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>商品图片与信息</span></Space>} extra={<Button type="text" danger disabled={!file && !productInfo} onClick={clearAll}>清空</Button>}>
        <div className="product-detail-input-grid">
          <div>{previewUrl ? <div className="product-detail-source"><img src={previewUrl} alt="产品白底图" /><Upload accept={ACCEPTED_TYPES.join(',')} showUploadList={false} beforeUpload={selectFile}><Button>替换图片</Button></Upload></div> : <Dragger accept={ACCEPTED_TYPES.join(',')} showUploadList={false} beforeUpload={selectFile}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">上传一张产品白底图</p><p className="ant-upload-hint">PNG / JPEG / WebP，不超过 20MB</p></Dragger>}</div>
          <Input.TextArea value={productInfo} onChange={(event) => setProductInfo(event.target.value)} rows={8} maxLength={3000} showCount placeholder="用自然语言填写商品名称、材质、尺寸、特点、目标用户、使用场景、品牌语气等。模型不会主动编造未提供的信息。" />
        </div>
        <Flex justify="end" style={{ marginTop: 16 }}><Button type="primary" icon={<AppstoreOutlined />} loading={analyzing} onClick={analyze}>{prompts.length ? '重新分析并生成提示词' : `分析并生成 ${settings.targetCount} 条提示词`}</Button></Flex>
      </Card>

      <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>详情图提示词</span></Space>} extra={<Text type="secondary">{prompts.length} 条</Text>}>
        {prompts.length ? <div className="detail-prompt-list">{prompts.map((prompt) => {
          const task = tasks.find((item) => item.promptId === prompt.id);
          return <Card key={prompt.id} size="small" title={`${String(prompt.index + 1).padStart(2, '0')} · ${prompt.title}`} extra={<Button icon={<RocketOutlined />} loading={task?.status === 'running'} onClick={() => queuePrompt(prompt.id)}>生成此图</Button>}>
            <Input.TextArea value={prompt.content} onChange={(event) => updatePromptContent(prompt.id, event.target.value)} autoSize={{ minRows: 4, maxRows: 10 }} maxLength={4000} showCount />
            <Divider titlePlacement="start">上图文案</Divider>
            <Space orientation="vertical" style={{ width: '100%' }}>
              {prompt.overlayTexts.map((text, index) => <Flex key={`${prompt.id}-${index}`} gap={8}><Input value={text} onChange={(event) => updateOverlay(prompt.id, index, event.target.value)} /><Button danger type="text" icon={<DeleteOutlined />} onClick={() => removeOverlay(prompt.id, index)} /></Flex>)}
              {!prompt.overlayTexts.length && <Text type="secondary">该详情图暂无上图文字</Text>}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => addOverlay(prompt.id)}>新增上图文案</Button>
            </Space>
            {task && <Flex gap={8} align="center" style={{ marginTop: 14 }}><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : 'processing'}>{task.status === 'waiting' ? '排队中' : task.status === 'running' ? '生成中' : task.status === 'success' ? '已完成' : task.status === 'failed' ? '失败' : '已停止'}</Tag>{task.error && <Text type="danger">{task.error}</Text>}</Flex>}
          </Card>;
        })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传商品图并填写信息后，让模型规划详情页提示词" />}
      </Card>

      <Card className="action-card">
        <Flex justify="space-between" align="center" gap={12} wrap><div><Title level={4} style={{ margin: 0 }}>生成 {prompts.length} 张商品详情图</Title><Text type="secondary">按提示词顺序与设置并发执行</Text></div><Space>{processing && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} disabled={!prompts.length} loading={processing} onClick={queueAll}>一键生成</Button></Space></Flex>
        {!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round(completed / tasks.length * 100)} status={processing ? 'active' : successfulTasks.length ? 'success' : 'exception'} />}
      </Card>

      <Card className="workflow-card" title={<Space><FileImageOutlined /><span>详情图结果</span></Space>} extra={<Space wrap><Button disabled={!successfulTasks.length} icon={<EyeOutlined />} onClick={() => void buildComposite('preview')}>预览合成长图</Button><Button disabled={!successfulTasks.length} icon={<DownloadOutlined />} onClick={() => void buildComposite('download')}>下载合成长图</Button><Popconfirm title="清空全部生成结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!successfulTasks.length} icon={<DownloadOutlined />} onClick={() => void downloadAllDetailTasks(tasks, prompts, settings.imageModel)}>下载全部 ZIP</Button></Space>}>
        {prompts.length ? <div className="product-detail-results">{prompts.map((prompt) => {
          const task = tasks.find((item) => item.promptId === prompt.id);
          return <Card key={prompt.id} size="small" title={`${prompt.index + 1}. ${prompt.title}`} extra={task?.resultBlob ? <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadDetailTask(task, prompt, settings.imageModel)} /> : null}>
            {task?.resultUrl ? <Image src={task.resultUrl} alt={prompt.title} /> : task?.status === 'running' ? <GeneratingImage status="running" percent={50} /> : task?.status === 'waiting' ? <GeneratingImage status="waiting" percent={0} /> : <div className="detail-result-placeholder"><Text type="secondary">尚未生成</Text></div>}
            {task?.status === 'failed' && <Button icon={<ReloadOutlined />} onClick={() => queuePrompt(prompt.id)}>重试</Button>}
          </Card>;
        })}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="详情图结果会显示在这里" />}
      </Card>

      <Modal title="商品详情页合成长图预览" width={920} open={Boolean(compositePreviewUrl)} onCancel={() => { if (compositePreviewUrl) URL.revokeObjectURL(compositePreviewUrl); setCompositePreviewUrl(undefined); }} footer={compositePreviewUrl ? <Button type="primary" icon={<DownloadOutlined />} onClick={() => void buildComposite('download')}>下载合成长图</Button> : null}>
        {compositePreviewUrl && <Image src={compositePreviewUrl} alt="商品详情页合成长图" width="100%" />}
      </Modal>

      {!settingsHost && <aside className="logo-settings">{settingsPanel}</aside>}
      {settingsHost && createPortal(settingsPanel, settingsHost)}
    </div>
  );
}
