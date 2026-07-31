import {
  ApiOutlined,
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BulbOutlined,
  CheckCircleFilled,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExperimentOutlined,
  EyeOutlined,
  FileImageOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  HighlightOutlined,
  KeyOutlined,
  MenuFoldOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SaveOutlined,
  SettingOutlined,
  StopOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Attachments, FileCard } from '@ant-design/x';
import {
  Alert,
  App as AntApp,
  Badge,
  Button,
  Card,
  Divider,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Form,
  Grid,
  Image,
  Input,
  InputNumber,
  Layout,
  List,
  Menu,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BUILT_IN_SCENE_PRESETS, DEFAULT_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import LogoComposer from './LogoComposer';
import InpaintComposer from './InpaintComposer';
import ProductDetailComposer from './ProductDetailComposer';
import GeneratingImage from './GeneratingImage';
import { useLanguage } from './i18n';
import { readLocalStorage } from './storage';
import {
  downloadAllZip,
  downloadGroupZip,
  downloadTask,
  makeResultGroups,
  taskFileName,
} from './services/downloads';
import { generateSceneImage, optimizePrompt, testProxyConnection } from './services/gemini';
import type {
  AppSettings,
  CreationTool,
  GenerationTask,
  ImageModel,
  ProductImage,
  PromptItem,
  PromptPreset,
  ResultGroup,
} from './types';
import {
  buildTasks,
  createId,
  estimateImageCost,
  normalizeSettingsForModel,
  sanitizeFileName,
  splitPrompts,
} from './utils';

const { Header, Sider, Content } = Layout;
const { Text, Title, Paragraph } = Typography;
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function SettingsPanel({
  settings,
  onChange,
  taskCount,
  prompts,
  onOptimizeAll,
  optimizingAll,
}: {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
  taskCount: number;
  prompts: PromptItem[];
  onOptimizeAll: () => void;
  optimizingAll: boolean;
}) {
  const capability = MODEL_CAPABILITIES[settings.imageModel];
  const cost = estimateImageCost(settings.imageModel, settings.imageSize, taskCount);

  return (
    <div className="settings-panel">
      <Flex align="center" justify="space-between">
        <Title level={4} style={{ margin: 0 }}>生成设置</Title>
        <Tag color="purple">本地配置</Tag>
      </Flex>
      <Divider />
      <Form layout="vertical" size="middle">
        <Form.Item label="图片模型">
          <Select
            value={settings.imageModel}
            onChange={(imageModel: ImageModel) => onChange({ imageModel })}
            options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({
              value,
              label: item.label,
            }))}
          />
          <Text type="secondary" className="field-help">{capability.description}</Text>
        </Form.Item>
        <Form.Item label="画面比例">
          <Select
            value={settings.aspectRatio}
            onChange={(aspectRatio) => onChange({ aspectRatio })}
            options={capability.aspectRatios.map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item label="输出分辨率">
          <Segmented
            block
            value={settings.imageSize}
            onChange={(imageSize) => onChange({ imageSize: imageSize as AppSettings['imageSize'] })}
            options={capability.imageSizes}
          />
        </Form.Item>
        <Form.Item label="任务组合">
          <Radio.Group
            value={settings.combinationMode}
            onChange={(event) => onChange({ combinationMode: event.target.value })}
          >
            <Space orientation="vertical">
              <Radio value="cartesian">全量组合</Radio>
              <Radio value="paired">一一对应</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item label="并发任务数">
          <InputNumber
            min={1}
            max={6}
            value={settings.concurrency}
            onChange={(concurrency) => onChange({ concurrency: concurrency || 1 })}
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>

      <Divider titlePlacement="start">提示词工具</Divider>
      <Form layout="vertical">
        <Form.Item label="优化模型">
          <Select
            value={settings.optimizerModel}
            onChange={(optimizerModel) => onChange({ optimizerModel })}
            options={[
              { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
              { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' },
              { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
            ]}
          />
        </Form.Item>
      </Form>
      <Button
        block
        icon={<BulbOutlined />}
        loading={optimizingAll}
        disabled={!prompts.some((item) => item.content.trim())}
        onClick={onOptimizeAll}
      >
        一键优化全部提示词
      </Button>

      <Card className="price-card" variant="borderless">
        <Flex justify="space-between" align="end">
          <Statistic title="预计价格" value={cost} precision={Math.max(cost < 0.01 ? 4 : 3, 3)} prefix="$" />
          <Tag>{taskCount} 个任务</Tag>
        </Flex>
        <Paragraph type="secondary" className="price-note">
          按标准层输出与单张输入图估算，不含无法预知的文本、思考及提示词优化 token。
          <a href={PRICING.source} target="_blank" rel="noreferrer"> 官方定价</a>
          （{PRICING.updatedAt}）
        </Paragraph>
      </Card>
    </div>
  );
}

function ResultGroupCard({
  group,
  onOpen,
  onDownload,
}: {
  group: ResultGroup;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const successImages = group.tasks.filter((task) => task.resultUrl).slice(0, 3);
  const queueStatus = group.tasks.some((task) => task.status === 'running')
    ? 'running'
    : group.tasks.some((task) => task.status === 'waiting')
      ? 'waiting'
      : undefined;
  return (
    <Card
      hoverable
      className="result-group-card"
      onClick={onOpen}
      actions={[
        <Tooltip title="展开全部" key="open"><EyeOutlined /></Tooltip>,
        <Tooltip title="下载该组" key="download">
          <DownloadOutlined onClick={(event) => { event.stopPropagation(); onDownload(); }} />
        </Tooltip>,
      ]}
    >
      <div className="result-stack">
        {successImages.length ? successImages.map((task, index) => (
          <img
            key={task.id}
            src={task.resultUrl}
            alt=""
            style={{ '--stack-index': index } as React.CSSProperties}
          />
        )) : (
          queueStatus
            ? <GeneratingImage status={queueStatus} percent={(group.successCount / group.tasks.length) * 100} />
            : <div className="group-placeholder"><FileImageOutlined /></div>
        )}
      </div>
      <Flex gap={10} align="center" className="group-meta">
        <img src={group.product.previewUrl} alt={group.product.name} className="source-thumb" />
        <div className="group-copy">
          <Text strong ellipsis={{ tooltip: group.product.name }}>{sanitizeFileName(group.product.name)}</Text>
          <Space size={4} wrap>
            <Tag color="success">{group.successCount} 成功</Tag>
            {group.failedCount > 0 && <Tag color="error">{group.failedCount} 失败</Tag>}
            <Tag>{group.tasks.length} 张</Tag>
          </Space>
        </div>
      </Flex>
    </Card>
  );
}

function AppContent() {
  const { message, modal } = AntApp.useApp();
  const { language, setLanguage } = useLanguage();
  const screens = Grid.useBreakpoint();
  const compact = !screens.xl;
  const [settings, setSettings] = useState<AppSettings>(() =>
    readLocalStorage(STORAGE_KEYS.settings, DEFAULT_SETTINGS),
  );
  const [products, setProducts] = useState<ProductImage[]>([]);
  const [prompts, setPrompts] = useState<PromptItem[]>([{ id: createId(), content: '' }]);
  const [presets, setPresets] = useState<PromptPreset[]>(() =>
    readLocalStorage<Array<PromptPreset & { prompts?: string[] }>>(STORAGE_KEYS.presets, [])
      .map((preset) => ({ ...preset, content: preset.content || preset.prompts?.find((item) => item.trim()) || '' }))
      .filter((preset) => preset.content.trim()),
  );
  const allScenePresets: PromptPreset[] = [
    ...BUILT_IN_SCENE_PRESETS,
    ...presets,
  ];
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [activePromptId, setActivePromptId] = useState(prompts[0].id);
  const [creationTool, setCreationTool] = useState<CreationTool>('scene');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [logoSettingsHost, setLogoSettingsHost] = useState<HTMLElement | null>(null);
  const [inpaintSettingsHost, setInpaintSettingsHost] = useState<HTMLElement | null>(null);
  const [productDetailSettingsHost, setProductDetailSettingsHost] = useState<HTMLElement | null>(null);
  const [logoHasSession, setLogoHasSession] = useState(false);
  const [inpaintHasSession, setInpaintHasSession] = useState(false);
  const [productDetailHasSession, setProductDetailHasSession] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [splitMode, setSplitMode] = useState<'delimiter' | 'newline'>('delimiter');
  const [delimiter, setDelimiter] = useState('---');
  const [activeGroup, setActiveGroup] = useState<ResultGroup | null>(null);
  const [optimizationPreview, setOptimizationPreview] = useState<Array<{ id: string; original: string; optimized: string }> | null>(null);
  const [optimizingAll, setOptimizingAll] = useState(false);
  const [testingProxy, setTestingProxy] = useState(false);
  const runningIds = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const productsRef = useRef(products);
  const settingsRef = useRef(settings);

  useEffect(() => { productsRef.current = products; }, [products]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(presets)), [presets]);
  useEffect(() => () => {
    products.forEach((product) => URL.revokeObjectURL(product.previewUrl));
    tasks.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
  }, []);

  const validPromptCount = prompts.filter((prompt) => prompt.content.trim()).length;
  const estimatedTaskCount = settings.combinationMode === 'paired'
    ? Math.min(products.length, validPromptCount)
    : products.length * validPromptCount;
  const groups = useMemo(() => makeResultGroups(products, tasks), [products, tasks]);
  const completedCount = tasks.filter((task) => ['success', 'failed', 'stopped'].includes(task.status)).length;
  const successCount = tasks.filter((task) => task.status === 'success').length;
  const isProcessing = tasks.some((task) => ['waiting', 'running'].includes(task.status));
  const uploadItems: UploadFile[] = products.map((product) => ({
    uid: product.id,
    name: product.name,
    status: 'done',
    url: product.previewUrl,
    thumbUrl: product.previewUrl,
    originFileObj: product.file as UploadFile['originFileObj'],
  }));
  const activeDelimiter = splitMode === 'newline' ? '\n' : delimiter;
  const splitPreview = useMemo(
    () => splitPrompts(bulkText, activeDelimiter),
    [bulkText, activeDelimiter],
  );
  const apiBaseUrl = settings.connectionMode === 'proxy'
    ? settings.proxyUrl.trim().replace(/\/+$/, '')
    : null;
  const sceneHasSession = Boolean(products.length || tasks.length || prompts.some((item) => item.content.trim()));

  const handleTestProxy = async () => {
    if (!settings.proxyUrl.trim()) {
      message.warning('请先填写代理地址');
      return;
    }
    setTestingProxy(true);
    try {
      await testProxyConnection(settings.proxyUrl);
      message.success('代理连接成功');
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误';
      message.error(`代理连接失败：${detail}。请检查地址、Worker 部署状态和 ALLOWED_ORIGINS`);
    } finally {
      setTestingProxy(false);
    }
  };

  useEffect(() => {
    if (!sceneHasSession && !logoHasSession && !inpaintHasSession && !productDetailHasSession) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [sceneHasSession, logoHasSession, inpaintHasSession, productDetailHasSession]);

  const patchSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (patch.imageModel) {
        const normalized = normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize);
        if (normalized.imageSize !== next.imageSize || normalized.aspectRatio !== next.aspectRatio) {
          message.info('已按模型能力调整比例或分辨率');
        }
        return { ...next, ...normalized };
      }
      return next;
    });
  }, [message]);

  const addFiles = useCallback((files: File[]) => {
    const accepted: ProductImage[] = [];
    files.forEach((file) => {
      if (!ACCEPTED_TYPES.includes(file.type)) {
        message.error(`${file.name}：仅支持 PNG、JPEG、WebP`);
      } else if (!file.size || file.size > MAX_IMAGE_SIZE) {
        message.error(`${file.name}：文件需小于 20MB 且不能为空`);
      } else {
        accepted.push({
          id: createId(),
          file,
          name: file.name,
          mimeType: file.type,
          previewUrl: URL.createObjectURL(file),
        });
      }
    });
    if (accepted.length) setProducts((current) => [...current, ...accepted]);
    return false;
  }, [message]);

  const removeProduct = (uid: string) => {
    setProducts((current) => {
      const removed = current.find((product) => product.id === uid);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((product) => product.id !== uid);
    });
  };

  const updatePrompt = (id: string, content: string) =>
    setPrompts((current) => current.map((item) => item.id === id ? { ...item, content } : item));

  const movePrompt = (index: number, direction: -1 | 1) => {
    setPrompts((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removePrompt = (id: string) =>
    setPrompts((current) => {
      if (current.length === 1) return [{ ...current[0], content: '' }];
      const next = current.filter((item) => item.id !== id);
      if (activePromptId === id) setActivePromptId(next[0].id);
      return next;
    });

  const runOptimization = async (items: PromptItem[]) => {
    if (!settings.apiKey) {
      setKeyOpen(true);
      message.warning('请先配置 API Key');
      return;
    }
    if (settings.connectionMode === 'proxy' && !apiBaseUrl) {
      setKeyOpen(true);
      message.warning('请先配置代理地址');
      return;
    }
    const valid = items.filter((item) => item.content.trim());
    if (!valid.length) return;
    setOptimizingAll(true);
    try {
      const results: Array<{ id: string; original: string; optimized: string }> = [];
      for (const item of valid) {
        const optimized = await optimizePrompt({
          apiKey: settings.apiKey,
          model: settings.optimizerModel,
          prompt: item.content.trim(),
          apiBaseUrl,
        });
        results.push({ id: item.id, original: item.content, optimized });
      }
      setOptimizationPreview(results);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setOptimizingAll(false);
    }
  };

  const executeTask = useCallback(async (task: GenerationTask) => {
    if (runningIds.current.has(task.id)) return;
    const product = productsRef.current.find((item) => item.id === task.productId);
    if (!product) return;
    runningIds.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const currentSettings = settingsRef.current;
      const result = await generateSceneImage({
        apiKey: currentSettings.apiKey,
        model: currentSettings.imageModel,
        prompt: task.prompt,
        image: product.file,
        aspectRatio: currentSettings.aspectRatio,
        imageSize: currentSettings.imageSize,
        signal: controller.signal,
        apiBaseUrl: currentSettings.connectionMode === 'proxy'
          ? currentSettings.proxyUrl.trim().replace(/\/+$/, '')
          : null,
      });
      const resultUrl = URL.createObjectURL(result.blob);
      setTasks((current) => current.map((item) => item.id === task.id
        ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType }
        : item));
    } catch (error) {
      const stopped = controller.signal.aborted;
      setTasks((current) => current.map((item) => item.id === task.id
        ? { ...item, status: stopped ? 'stopped' : 'failed', error: stopped ? '任务已停止' : error instanceof Error ? error.message : '生成失败' }
        : item));
    } finally {
      runningIds.current.delete(task.id);
      aborters.current.delete(task.id);
    }
  }, []);

  useEffect(() => {
    const available = Math.max(0, settings.concurrency - runningIds.current.size);
    if (!available) return;
    tasks
      .filter((task) => task.status === 'waiting' && !runningIds.current.has(task.id))
      .slice(0, available)
      .forEach((task) => void executeTask(task));
  }, [tasks, settings.concurrency, executeTask]);

  const startGeneration = () => {
    if (!settings.apiKey) {
      setKeyOpen(true);
      message.warning('请先配置 API Key');
      return;
    }
    if (settings.connectionMode === 'proxy' && !apiBaseUrl) {
      setKeyOpen(true);
      message.warning('请先配置代理地址');
      return;
    }
    if (!products.length) return void message.warning('请至少上传一张产品图');
    if (!validPromptCount) return void message.warning('请至少填写一条提示词');
    try {
      tasks.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
      setTasks(buildTasks(products, prompts, settings.combinationMode));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法创建任务');
    }
  };

  const stopTasks = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => current.map((task) =>
      task.status === 'waiting' ? { ...task, status: 'stopped', error: '任务已停止' } : task,
    ));
  };

  const retryTask = (id: string) =>
    setTasks((current) => current.map((task) => task.id === id
      ? { ...task, status: 'waiting', error: undefined, retryCount: task.retryCount + 1 }
      : task));

  const savePreset = () => {
    const content = prompts.find((item) => item.id === activePromptId)?.content.trim()
      || prompts.find((item) => item.content.trim())?.content.trim();
    if (!content) return void message.warning('当前输入框没有可保存的提示词');
    modal.confirm({
      title: '保存提示词预设',
      content: <Input id="preset-name-input" placeholder="例如：极简摄影棚" autoFocus />,
      onOk: () => {
        const input = document.getElementById('preset-name-input') as HTMLInputElement | null;
        const name = input?.value.trim();
        if (!name) throw new Error('请输入预设名称');
        setPresets((current) => {
          const existing = current.find((preset) => preset.name === name);
          if (existing) return current.map((preset) => preset.id === existing.id ? { ...preset, content, prompts: undefined, updatedAt: Date.now() } : preset);
          return [...current, { id: createId(), name, content, updatedAt: Date.now() }];
        });
        message.success('预设已保存');
      },
    });
  };

  const renamePreset = (preset: PromptPreset) => {
    let nextName = preset.name;
    modal.confirm({
      title: '重命名预设',
      content: <Input defaultValue={preset.name} onChange={(event) => { nextName = event.target.value; }} />,
      onOk: () => setPresets((current) => current.map((item) => item.id === preset.id ? { ...item, name: nextName.trim() || item.name } : item)),
    });
  };

  const applyScenePreset = (preset: PromptPreset) => {
    const targetId = prompts.some((item) => item.id === activePromptId) ? activePromptId : prompts[0].id;
    updatePrompt(targetId, preset.content);
    setActivePromptId(targetId);
  };

  const downloadAll = async () => {
    const failed = tasks.filter((task) => task.status !== 'success').length;
    if (!successCount) return void message.warning('暂无可下载的成功结果');
    if (failed) message.warning(`ZIP 仅包含 ${successCount} 个成功结果，已跳过 ${failed} 个未成功任务`);
    await downloadAllZip(groups, settings.imageModel);
  };

  const settingsPanel = (
    <SettingsPanel
      settings={settings}
      onChange={patchSettings}
      taskCount={estimatedTaskCount}
      prompts={prompts}
      onOptimizeAll={() => void runOptimization(prompts)}
      optimizingAll={optimizingAll}
    />
  );

  return (
    <Layout className="app-shell">
      <Header className="topbar">
        <Flex align="center" justify="space-between" gap={16}>
          <Flex align="center" gap={12}>
            <div className="brand-mark"><ExperimentOutlined /></div>
            <div className="brand-copy">
              <Title level={3} className="brand-title">Scene Studio</Title>
              <Text type="secondary" className="brand-subtitle">AI 商业场景图工作台</Text>
            </div>
            <Divider orientation="vertical" className="header-divider" />
            <Tag icon={<AppstoreOutlined />} color="purple">{creationTool === 'scene' ? '场景图生成' : creationTool === 'logo' ? 'Logo 合成' : creationTool === 'inpaint' ? '局部重绘' : '详情长图生成'}</Tag>
          </Flex>
          <Space>
            <Segmented
              size="small"
              value={language}
              onChange={(value) => setLanguage(value as 'zh-CN' | 'en-US')}
              options={[
                { label: '中文', value: 'zh-CN', icon: <GlobalOutlined /> },
                { label: 'EN', value: 'en-US' },
              ]}
            />
            {creationTool === 'scene' && tasks.length > 0 && (
              <Badge status={isProcessing ? 'processing' : 'success'} text={`${completedCount}/${tasks.length}`} />
            )}
            {compact && <Button icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)}>设置</Button>}
            <Button
              type={settings.apiKey ? 'default' : 'primary'}
              icon={settings.apiKey ? <CheckCircleFilled /> : <KeyOutlined />}
              onClick={() => setKeyOpen(true)}
            >
              {settings.apiKey ? 'Key 已配置' : '配置 API Key'}
            </Button>
          </Space>
        </Flex>
      </Header>

      <Layout className="workspace-layout">
        <Sider width={214} className="nav-sider" breakpoint="lg" collapsedWidth={64}>
          <Menu
            mode="inline"
            selectedKeys={[creationTool]}
            onClick={({ key }) => {
              if (key === 'scene' || key === 'logo' || key === 'inpaint' || key === 'product-detail') setCreationTool(key);
            }}
            items={[
              { key: 'create', type: 'group', label: '创作工具', children: [
                { key: 'scene', icon: <FileImageOutlined />, label: '场景图生成' },
                { key: 'logo', icon: <ExperimentOutlined />, label: 'Logo 合成' },
                { key: 'inpaint', icon: <HighlightOutlined />, label: '局部重绘' },
                { key: 'product-detail', icon: <FolderOpenOutlined />, label: '详情长图生成' },
                { key: 'video', icon: <VideoCameraOutlined />, label: '视频生成', disabled: true },
              ] },
              { key: 'manage', type: 'group', label: '管理', children: [
                { key: 'history', icon: <MenuFoldOutlined />, label: '历史记录', disabled: true },
              ] },
            ]}
          />
          <div className="sider-foot">
            <ApiOutlined />
            <Text type="secondary">{settings.connectionMode === 'proxy' ? 'Cloudflare 代理' : 'Gemini 直连'}</Text>
          </div>
        </Sider>

        <Content className="main-content">
          <div className="content-inner">
            <div hidden={creationTool !== 'logo'}>
              <LogoComposer
                apiKey={settings.apiKey}
                apiBaseUrl={apiBaseUrl}
                connectionMode={settings.connectionMode}
                onRequestKey={() => setKeyOpen(true)}
                onSessionStateChange={setLogoHasSession}
                settingsHost={logoSettingsHost}
              />
            </div>
            <div hidden={creationTool !== 'inpaint'}>
              <InpaintComposer
                apiKey={settings.apiKey}
                apiBaseUrl={apiBaseUrl}
                connectionMode={settings.connectionMode}
                onRequestKey={() => setKeyOpen(true)}
                onSessionStateChange={setInpaintHasSession}
                settingsHost={inpaintSettingsHost}
              />
            </div>
            <div hidden={creationTool !== 'product-detail'}>
              <ProductDetailComposer
                apiKey={settings.apiKey}
                apiBaseUrl={apiBaseUrl}
                connectionMode={settings.connectionMode}
                onRequestKey={() => setKeyOpen(true)}
                onSessionStateChange={setProductDetailHasSession}
                settingsHost={productDetailSettingsHost}
              />
            </div>
            <div hidden={creationTool !== 'scene'}>
            <section className="hero-strip">
              <div>
                <Text className="eyebrow">SCENE GENERATOR</Text>
                <Title level={2}>把白底产品图放进真实世界</Title>
                <Paragraph className="hero-description">上传产品、组合提示词，批量生成风格一致的商业场景图。</Paragraph>
              </div>
              <div className="hero-orb" />
            </section>

            <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传产品白底图</span></Space>} extra={<Text type="secondary">{products.length} 张</Text>}>
              <Attachments
                items={uploadItems}
                overflow="wrap"
                accept={ACCEPTED_TYPES.join(',')}
                multiple
                beforeUpload={(file) => addFiles([file as File])}
                onRemove={(file) => { removeProduct(file.uid); return true; }}
                placeholder={{
                  icon: <FileImageOutlined />,
                  title: '拖拽、点击或粘贴产品图',
                  description: 'PNG / JPEG / WebP，单张不超过 20MB',
                }}
              />
              <Upload
                showUploadList={false}
                accept={ACCEPTED_TYPES.join(',')}
                multiple
                beforeUpload={(file) => addFiles([file as File])}
              >
                <Button icon={<PlusOutlined />} className="upload-fallback">选择图片</Button>
              </Upload>
            </Card>

            <Card
              className="workflow-card"
              title={<Space><span className="step-badge">2</span><span>编写场景提示词</span></Space>}
              extra={<Space><Button onClick={() => setBulkOpen(true)}>批量粘贴</Button><Button type="primary" ghost icon={<PlusOutlined />} onClick={() => setPrompts((current) => [...current, { id: createId(), content: '' }])}>新增一行</Button></Space>}
            >
              <div className="prompt-list">
                {prompts.map((prompt, index) => (
                  <div className={prompt.id === activePromptId ? 'prompt-row is-active' : 'prompt-row'} key={prompt.id}>
                    <div className="prompt-index">{String(index + 1).padStart(2, '0')}</div>
                    <Input.TextArea
                      value={prompt.content}
                      onFocus={() => setActivePromptId(prompt.id)}
                      onChange={(event) => updatePrompt(prompt.id, event.target.value)}
                      placeholder="例如：产品放置在浅色洞石台面上，晨光从左侧窗户照入，背景为柔焦现代客厅……"
                      autoSize={{ minRows: 2, maxRows: 5 }}
                      showCount
                      maxLength={2000}
                    />
                    <Space orientation="vertical" size={1}>
                      <Tooltip title="优化此条"><Button type="text" icon={<BulbOutlined />} onClick={() => void runOptimization([prompt])} /></Tooltip>
                      <Tooltip title="复制"><Button type="text" icon={<CopyOutlined />} onClick={() => setPrompts((current) => [...current.slice(0, index + 1), { id: createId(), content: prompt.content }, ...current.slice(index + 1)])} /></Tooltip>
                      <Space size={0}>
                        <Button type="text" size="small" disabled={index === 0} icon={<ArrowUpOutlined />} onClick={() => movePrompt(index, -1)} />
                        <Button type="text" size="small" disabled={index === prompts.length - 1} icon={<ArrowDownOutlined />} onClick={() => movePrompt(index, 1)} />
                      </Space>
                      <Tooltip title="删除"><Button type="text" danger icon={<DeleteOutlined />} onClick={() => removePrompt(prompt.id)} /></Tooltip>
                    </Space>
                  </div>
                ))}
              </div>
              <Flex justify="space-between" align="center" gap={10} wrap className="scene-preset-bar">
                <Space wrap>
                  {allScenePresets.map((preset) => (
                    <Dropdown
                      key={preset.id}
                      trigger={['contextMenu']}
                      menu={preset.builtIn ? { items: [] } : {
                        items: [
                          { key: 'rename', label: '重命名预设' },
                          { key: 'delete', danger: true, label: '删除预设' },
                        ],
                        onClick: ({ key }) => {
                          if (key === 'rename') renamePreset(preset);
                          if (key === 'delete') setPresets((current) => current.filter((item) => item.id !== preset.id));
                        },
                      }}
                    >
                      <span className="prompt-preset-trigger" onContextMenu={(event) => event.preventDefault()}>
                        <Tag className="prompt-preset-tag" onClick={() => applyScenePreset(preset)}>{preset.name}</Tag>
                      </span>
                    </Dropdown>
                  ))}
                </Space>
                <Button size="small" icon={<SaveOutlined />} onClick={savePreset}>保存当前输入框为预设</Button>
              </Flex>
              <Text type="secondary" className="scene-preset-help">点击预设会写入当前选中的提示词输入框；右键自定义预设可重命名或删除。</Text>
            </Card>

            <Card className="action-card">
              <Flex justify="space-between" align="center" gap={16} wrap>
                <div>
                  <Title level={4} style={{ margin: 0 }}>准备生成 {estimatedTaskCount} 张场景图</Title>
                  <Text type="secondary">
                    {settings.combinationMode === 'cartesian'
                      ? `${products.length} 张产品图 × ${validPromptCount} 条提示词`
                      : `按顺序一一对应 · ${products.length} 张产品图 / ${validPromptCount} 条提示词`}
                  </Text>
                </div>
                <Space>
                  {isProcessing && <Button danger icon={<StopOutlined />} onClick={stopTasks}>停止任务</Button>}
                  <Button size="large" type="primary" icon={<RocketOutlined />} loading={isProcessing} onClick={startGeneration}>
                    {isProcessing ? '正在生成' : '开始生成'}
                  </Button>
                </Space>
              </Flex>
              {tasks.length > 0 && (
                <div className="overall-progress">
                  <Progress percent={Math.round((completedCount / tasks.length) * 100)} status={isProcessing ? 'active' : successCount ? 'success' : 'exception'} />
                  <Space wrap>
                    <Tag color="processing">{tasks.filter((task) => task.status === 'running').length} 生成中</Tag>
                    <Tag color="success">{successCount} 成功</Tag>
                    <Tag color="error">{tasks.filter((task) => task.status === 'failed').length} 失败</Tag>
                  </Space>
                </div>
              )}
            </Card>

            <section className="results-section">
              <Flex justify="space-between" align="center">
                <div>
                  <Title level={3}>生成结果</Title>
                  <Text type="secondary">按产品图自动分组，点击卡片查看全部结果</Text>
                </div>
                <Button icon={<DownloadOutlined />} disabled={!successCount} onClick={() => void downloadAll()}>下载全部</Button>
              </Flex>
              {groups.length ? (
                <div className="results-grid">
                  {groups.map((group) => (
                    <ResultGroupCard
                      key={group.product.id}
                      group={group}
                      onOpen={() => setActiveGroup(group)}
                      onDownload={() => void downloadGroupZip(group, settings.imageModel)}
                    />
                  ))}
                </div>
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成上方设置后，结果会按产品显示在这里" />
              )}
            </section>

            <Alert
              type="info"
              showIcon
              title="关于生成内容"
              description="所有 Nano Banana 生成图片均包含 SynthID 水印。请确保你拥有上传图片的必要权利，并遵守 Gemini API 使用政策。"
            />
            </div>
          </div>
        </Content>

        {!compact && creationTool === 'scene' && <Sider width={330} theme="light" className="settings-sider">{settingsPanel}</Sider>}
        {!compact && creationTool === 'logo' && (
          <Sider width={330} theme="light" className="settings-sider">
            <div ref={setLogoSettingsHost} />
          </Sider>
        )}
        {!compact && creationTool === 'inpaint' && (
          <Sider width={330} theme="light" className="settings-sider">
            <div ref={setInpaintSettingsHost} />
          </Sider>
        )}
        {!compact && creationTool === 'product-detail' && (
          <Sider width={330} theme="light" className="settings-sider">
            <div ref={setProductDetailSettingsHost} />
          </Sider>
        )}
      </Layout>

      <Drawer title="生成设置" size={360} open={settingsOpen} onClose={() => setSettingsOpen(false)} destroyOnHidden>
        {creationTool === 'scene'
          ? settingsPanel
          : compact
            ? <div ref={creationTool === 'logo' ? setLogoSettingsHost : creationTool === 'inpaint' ? setInpaintSettingsHost : setProductDetailSettingsHost} />
            : null}
      </Drawer>

      <Modal title="配置 Gemini API" open={keyOpen} onCancel={() => setKeyOpen(false)} onOk={() => setKeyOpen(false)} okText="保存到本地">
        <Alert
          type="warning"
          showIcon
          title="Key 会保存在当前浏览器"
          description={settings.connectionMode === 'proxy'
            ? 'Key 与代理地址保存在当前浏览器，请求将通过你配置的代理转发到 Gemini。'
            : 'Key 保存在当前浏览器，并由浏览器直接请求 Gemini。请勿在不受信任的设备上配置。'}
          style={{ marginBottom: 16 }}
        />
        <Form layout="vertical">
          <Form.Item label="连接方式">
            <Segmented
              block
              value={settings.connectionMode}
              onChange={(connectionMode) => patchSettings({ connectionMode: connectionMode as AppSettings['connectionMode'] })}
              options={[
                { label: 'Gemini 直连', value: 'direct' },
                { label: 'Cloudflare 代理', value: 'proxy' },
              ]}
            />
          </Form.Item>
          {settings.connectionMode === 'proxy' && (
            <Form.Item label="代理地址" extra="可填写 Worker 根地址或以 /v1beta 结尾的地址">
              <Space.Compact block>
                <Input
                  value={settings.proxyUrl}
                  onChange={(event) => patchSettings({ proxyUrl: event.target.value })}
                  placeholder="https://scene-studio-gemini-proxy.example.workers.dev"
                  allowClear
                />
                <Button icon={<ApiOutlined />} loading={testingProxy} onClick={handleTestProxy}>
                  测试连通性
                </Button>
              </Space.Compact>
            </Form.Item>
          )}
          <Form.Item label="Gemini API Key" style={{ marginBottom: 0 }}>
        <Input.Password
          value={settings.apiKey}
          onChange={(event) => patchSettings({ apiKey: event.target.value.trim() })}
          prefix={<KeyOutlined />}
          placeholder="AIza..."
          autoComplete="off"
        />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量粘贴提示词"
        open={bulkOpen}
        onCancel={() => setBulkOpen(false)}
        onOk={() => {
          if (!splitPreview.length) return void message.warning('没有切割出有效提示词');
          setPrompts((current) => [
            ...current.filter((item) => item.content.trim()),
            ...splitPreview.map((content) => ({ id: createId(), content })),
          ]);
          setBulkText('');
          setBulkOpen(false);
        }}
        okText={`新增 ${splitPreview.length} 条`}
      >
        <Form layout="vertical">
          <Form.Item label="分割方式">
            <Segmented
              block
              value={splitMode}
              onChange={(value) => setSplitMode(value as 'delimiter' | 'newline')}
              options={[
                { label: '自定义符号', value: 'delimiter' },
                { label: '按回车分割', value: 'newline' },
              ]}
            />
          </Form.Item>
          {splitMode === 'delimiter' && (
            <Form.Item label="分隔符">
              <Input value={delimiter} onChange={(event) => setDelimiter(event.target.value)} />
            </Form.Item>
          )}
          <Form.Item label="粘贴内容">
            <Input.TextArea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              rows={8}
              placeholder={splitMode === 'newline'
                ? '第一条提示词\n第二条提示词\n第三条提示词'
                : `第一条提示词\n${delimiter}\n第二条提示词`}
            />
          </Form.Item>
        </Form>
        <Text type="secondary">预览：将新增 {splitPreview.length} 条，空白段会被忽略。</Text>
      </Modal>

      <Modal
        title={`提示词优化预览（${optimizationPreview?.length || 0} 条）`}
        width={760}
        open={Boolean(optimizationPreview)}
        onCancel={() => setOptimizationPreview(null)}
        onOk={() => {
          if (!optimizationPreview) return;
          setPrompts((current) => current.map((item) => {
            const match = optimizationPreview.find((preview) => preview.id === item.id);
            return match ? { ...item, originalContent: match.original, content: match.optimized } : item;
          }));
          setOptimizationPreview(null);
          message.success('已应用优化结果');
        }}
        okText="确认替换"
      >
        <List
          dataSource={optimizationPreview || []}
          renderItem={(item, index) => (
            <List.Item>
              <div className="optimization-item">
                <Text strong>提示词 {index + 1}</Text>
                <Text type="secondary">原文</Text>
                <Paragraph>{item.original}</Paragraph>
                <Text type="success">优化后</Text>
                <Paragraph>{item.optimized}</Paragraph>
              </div>
            </List.Item>
          )}
        />
      </Modal>

      <Modal
        title={activeGroup ? `${sanitizeFileName(activeGroup.product.name)} · ${activeGroup.successCount}/${activeGroup.tasks.length}` : '结果详情'}
        width={980}
        open={Boolean(activeGroup)}
        onCancel={() => setActiveGroup(null)}
        footer={activeGroup ? [
          <Button key="close" onClick={() => setActiveGroup(null)}>关闭</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} disabled={!activeGroup.successCount} onClick={() => void downloadGroupZip(activeGroup, settings.imageModel)}>下载该组 ZIP</Button>,
        ] : null}
      >
        {activeGroup && (
          <>
            <Image.PreviewGroup>
              <div className="detail-image-grid">
                {activeGroup.tasks.filter((task) => task.resultUrl).map((task) => (
                  <div className="detail-image-item" key={task.id}>
                    <Image src={task.resultUrl} alt={task.prompt} />
                    <Flex justify="space-between" align="center">
                      <Text ellipsis={{ tooltip: task.prompt }}>提示词 {task.promptIndex + 1}</Text>
                      <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadTask(task, settings.imageModel)} />
                    </Flex>
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
            <Divider titlePlacement="start">文件与任务</Divider>
            <FileCard.List
              items={activeGroup.tasks.filter((task) => task.resultUrl).map((task) => ({
                name: taskFileName(task, settings.imageModel),
                byte: task.resultBlob?.size,
                src: task.resultUrl,
                type: 'image',
                imageProps: {
                  preview: false,
                  alt: `提示词 ${task.promptIndex + 1} 的生成结果`,
                },
              }))}
              overflow="wrap"
            />
            {activeGroup.tasks.some((task) => task.status === 'failed') && (
              <List
                className="failed-list"
                dataSource={activeGroup.tasks.filter((task) => task.status === 'failed')}
                renderItem={(task) => (
                  <List.Item actions={[<Button key="retry" icon={<ReloadOutlined />} onClick={() => retryTask(task.id)}>重试</Button>]}>
                    <List.Item.Meta title={`提示词 ${task.promptIndex + 1}`} description={task.error} />
                  </List.Item>
                )}
              />
            )}
          </>
        )}
      </Modal>
    </Layout>
  );
}

export default function App() {
  return <AntApp><AppContent /></AntApp>;
}
