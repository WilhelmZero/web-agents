import {
  BulbOutlined,
  CheckOutlined,
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  HolderOutlined,
  HighlightOutlined,
  ReloadOutlined,
  RocketOutlined,
  SaveOutlined,
  StopOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Slider,
  Space,
  Statistic,
  Switch,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { reportTaskProgress } from './services/taskProgress';
import {
  DEFAULT_LOGO_SETTINGS,
  localizeBuiltInLogoPresets,
  MODEL_CAPABILITIES,
  PRICING,
  STORAGE_KEYS,
} from './constants';
import { generateLogoComposite, optimizePrompt } from './services/gemini';
import {
  buildLogoPairs,
  buildLogoTasks,
  createPlacementGuide,
  downloadAllLogoResults,
  downloadLogoGroup,
  downloadLogoTask,
  logoTaskFileName,
  makeLogoResultGroups,
  inpaintGuideToBlob,
  padLogoToSquare,
} from './services/logoUtils';
import { readLocalStorage } from './storage';
import type {
  LogoAsset,
  LogoGenerationTask,
  LogoInpaintMask,
  LogoPair,
  LogoPlacement,
  LogoPromptPreset,
  LogoSettings,
} from './types';
import {
  createId,
  estimateImageCost,
  normalizeSettingsForModel,
  sanitizeFileName,
} from './utils';
import GeneratingImage from './GeneratingImage';
import OriginalCompareImage from './OriginalCompareImage';
import { useLanguage } from './i18n';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const DEFAULT_PLACEMENT: LogoPlacement = { x: 0.5, y: 0.5, width: 0.24, rotation: 0 };

function logoTaskStatusText(status: LogoGenerationTask['status']): string {
  if (status === 'waiting') return '排队中';
  if (status === 'running') return '生成中';
  if (status === 'success') return '生成成功';
  if (status === 'failed') return '生成失败';
  return '已停止';
}

function InpaintPanel({
  pair,
  active,
  onChange,
}: {
  pair?: LogoPair;
  active: boolean;
  onChange: (mask?: LogoInpaintMask) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLImageElement | undefined>(undefined);
  const maskRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const pointerRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const hasMaskRef = useRef(false);
  const [mode, setMode] = useState<LogoInpaintMask['mode']>('box');
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

  const clearMask = useCallback(() => {
    const mask = maskRef.current;
    mask?.getContext('2d')?.clearRect(0, 0, mask.width, mask.height);
    hasMaskRef.current = false;
    render();
  }, [render]);

  useEffect(() => {
    if (!active || !pair?.scene) return;
    const image = new window.Image();
    image.onload = () => {
      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const mask = document.createElement('canvas');
      mask.width = width;
      mask.height = height;
      maskRef.current = mask;
      sceneRef.current = image;
      hasMaskRef.current = false;
      render();
    };
    image.src = pair.scene.previewUrl;
  }, [active, pair?.scene, render]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * event.currentTarget.width / rect.width,
      y: (event.clientY - rect.top) * event.currentTarget.height / rect.height,
    };
  };
  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerRef.current = point(event);
    if (mode === 'box') clearMask();
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const previous = pointerRef.current;
    const mask = maskRef.current;
    if (!previous || !mask) return;
    const current = point(event);
    const context = mask.getContext('2d');
    if (!context) return;
    context.fillStyle = 'rgba(255, 45, 85, 0.46)';
    context.strokeStyle = 'rgba(255, 45, 85, 0.58)';
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
  const stopDrawing = () => {
    pointerRef.current = undefined;
    const canvas = canvasRef.current;
    if (canvas && hasMaskRef.current) onChange({ mode, guideDataUrl: canvas.toDataURL('image/png') });
  };

  return (
    <>
      <Alert type="info" showIcon title="标记唯一允许 AI 修改的区域" description="可框选矩形区域，或用画笔涂抹不规则区域。红色标记只作为引导，不会保留在生成结果中。" style={{ marginBottom: 16 }} />
      <Flex gap={16} align="center" wrap style={{ marginBottom: 12 }}>
        <Segmented value={mode} onChange={(value) => { setMode(value as LogoInpaintMask['mode']); clearMask(); }} options={[{ label: '框选', value: 'box' }, { label: '画笔涂抹', value: 'brush' }]} />
        {mode === 'brush' && <Flex align="center" gap={8} style={{ minWidth: 240 }}><Text>画笔大小</Text><Slider min={8} max={120} value={brushSize} onChange={setBrushSize} style={{ flex: 1 }} /></Flex>}
        <Button icon={<ClearOutlined />} onClick={() => { clearMask(); onChange(undefined); }}>清除标记</Button>
      </Flex>
      <div className="inpaint-canvas-wrap">
        <canvas ref={canvasRef} onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDrawing} onPointerCancel={stopDrawing} />
      </div>
    </>
  );
}

function PlacementEditor({
  pair,
  open,
  onCancel,
  onSave,
}: {
  pair?: LogoPair;
  open: boolean;
  onCancel: () => void;
  onSave: (result: { placement?: LogoPlacement; inpaintMask?: LogoInpaintMask }) => void;
}) {
  const [placement, setPlacement] = useState(DEFAULT_PLACEMENT);
  const [method, setMethod] = useState<'placement' | 'inpaint'>('placement');
  const [inpaintMask, setInpaintMask] = useState<LogoInpaintMask>();
  const editorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | undefined>(undefined);

  useEffect(() => {
    if (open) {
      setPlacement(pair?.placement || DEFAULT_PLACEMENT);
      setInpaintMask(pair?.inpaintMask);
      setMethod(pair?.inpaintMask ? 'inpaint' : 'placement');
    }
  }, [open, pair?.placement, pair?.inpaintMask]);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: placement.x,
      originY: placement.y,
    };
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || !editorRef.current) return;
    const rect = editorRef.current.getBoundingClientRect();
    const x = dragRef.current.originX + (event.clientX - dragRef.current.startX) / rect.width;
    const y = dragRef.current.originY + (event.clientY - dragRef.current.startY) / rect.height;
    setPlacement((current) => ({
      ...current,
      x: Math.max(0.03, Math.min(0.97, x)),
      y: Math.max(0.03, Math.min(0.97, y)),
    }));
  };
  const stopDrag = () => { dragRef.current = undefined; };

  return (
    <Modal
      title="定位 Logo"
      width={820}
      open={open}
      onCancel={onCancel}
      onOk={() => onSave(method === 'placement' ? { placement } : { inpaintMask })}
      okButtonProps={{ disabled: method === 'inpaint' && !inpaintMask }}
      okText="保存定位"
    >
      <Tabs activeKey={method} onChange={(key) => setMethod(key as typeof method)} items={[
        {
          key: 'placement',
          label: '可视化定位',
          children: <>
            <Alert type="info" showIcon title="拖动 Logo 调整位置，并使用下方控件设置大小和旋转" description="定位会作为强参考提交给模型，但生成式模型仍可能产生轻微偏差。" style={{ marginBottom: 16 }} />
            {pair?.scene && pair.logo && (
              <div className="placement-stage" ref={editorRef}>
                <img className="placement-scene" src={pair.scene.previewUrl} alt="场景图" />
                <div className="placement-logo" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={stopDrag} onPointerCancel={stopDrag} style={{ left: `${placement.x * 100}%`, top: `${placement.y * 100}%`, width: `${placement.width * 100}%`, transform: `translate(-50%, -50%) rotate(${placement.rotation}deg)` }}>
                  <img src={pair.logo.previewUrl} alt="Logo" draggable={false} style={{ filter: placement.invertForGuide ? 'invert(1)' : undefined }} /><span><HolderOutlined /></span>
                </div>
              </div>
            )}
            <div className="placement-controls">
              <div><Text>大小</Text><Slider min={0.05} max={0.7} step={0.01} value={placement.width} onChange={(width) => setPlacement((current) => ({ ...current, width }))} /></div>
              <div><Text>旋转</Text><Slider min={-180} max={180} value={placement.rotation} onChange={(rotation) => setPlacement((current) => ({ ...current, rotation }))} /></div>
            </div>
            <Flex justify="space-between" align="center" gap={12} wrap>
              <Space>
                <Switch checked={Boolean(placement.invertForGuide)} onChange={(invertForGuide) => setPlacement((current) => ({ ...current, invertForGuide }))} />
                <div><Text>Logo 颜色反相</Text><br /><Text type="secondary">仅增强定位参考图可见性，不改变最终 Logo 颜色</Text></div>
              </Space>
              <Button onClick={() => setPlacement(DEFAULT_PLACEMENT)}>恢复居中</Button>
            </Flex>
          </>,
        },
        {
          key: 'inpaint',
          label: '局部重绘',
          children: <InpaintPanel pair={pair} active={method === 'inpaint'} onChange={setInpaintMask} />,
        },
      ]} />
    </Modal>
  );
}

function AssetColumn({
  title,
  hint,
  assets,
  onAdd,
  onRemove,
  onReplace,
  onReorder,
  onClear,
}: {
  title: string;
  hint: string;
  assets: LogoAsset[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onReplace: (index: number, file: File) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
}) {
  const [dragIndex, setDragIndex] = useState<number>();
  const [dropIndex, setDropIndex] = useState<number>();

  return (
    <Card
      className="asset-column"
      title={title}
      extra={<Popconfirm title={`清空全部${title}？`} onConfirm={onClear}><Button type="text" danger disabled={!assets.length} icon={<ClearOutlined />}>清空</Button></Popconfirm>}
    >
      <Upload.Dragger
        className="asset-uploader"
        showUploadList={false}
        accept={ACCEPTED_TYPES.join(',')}
        multiple
        beforeUpload={(file) => { onAdd([file as File]); return false; }}
      >
        <p className="ant-upload-drag-icon"><FileImageOutlined /></p>
        <p className="ant-upload-text">上传{title}</p>
        <p className="ant-upload-hint">{hint}</p>
      </Upload.Dragger>
      {!!assets.length && (
        <div className="asset-card-grid">
          {assets.map((asset, index) => (
            <div
              key={asset.id}
              className={`asset-image-card${dropIndex === index ? ' is-drop-target' : ''}${dragIndex === index ? ' is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                if (dragIndex !== undefined && dragIndex !== index) setDropIndex(index);
              }}
              onDragLeave={() => setDropIndex((current) => current === index ? undefined : current)}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndex !== undefined && dragIndex !== index) onReorder(dragIndex, index);
                setDragIndex(undefined);
                setDropIndex(undefined);
              }}
            >
              <div
                className="asset-card-image-wrap"
                draggable
                onDragStart={(event) => {
                  setDragIndex(index);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', asset.id);
                }}
                onDragEnd={() => {
                  setDragIndex(undefined);
                  setDropIndex(undefined);
                }}
                title="拖动图片调整顺序"
              >
                <span className="asset-card-index">{index + 1}</span>
                <img src={asset.previewUrl} alt={asset.name} draggable={false} />
                <span className="asset-drag-hint"><HolderOutlined /> 拖动排序</span>
              </div>
              <div className="asset-card-footer">
                <Upload
                  showUploadList={false}
                  accept={ACCEPTED_TYPES.join(',')}
                  beforeUpload={(file) => { onReplace(index, file as File); return false; }}
                >
                  <Button size="small" type="text" icon={<SwapOutlined />}>替换</Button>
                </Upload>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => onRemove(index)}>删除</Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function LogoComposer({
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
  const { language } = useLanguage();
  const [settings, setSettings] = useState<LogoSettings>(() => ({
    ...(DEFAULT_LOGO_SETTINGS as LogoSettings),
    ...readLocalStorage(STORAGE_KEYS.logoSettings, {} as Partial<LogoSettings>),
  }));
  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [logos, setLogos] = useState<LogoAsset[]>([]);
  const [placements, setPlacements] = useState<Record<number, LogoPlacement | undefined>>({});
  const [inpaintMasks, setInpaintMasks] = useState<Record<number, LogoInpaintMask | undefined>>({});
  const [prompt, setPrompt] = useState('');
  const [customPresets, setCustomPresets] = useState<LogoPromptPreset[]>(() =>
    readLocalStorage(STORAGE_KEYS.logoPresets, []),
  );
  const [tasks, setTasks] = useState<LogoGenerationTask[]>([]);
  const [editingPair, setEditingPair] = useState<LogoPair>();
  const [activeGroupId, setActiveGroupId] = useState<string>();
  const [optimizing, setOptimizing] = useState(false);
  const [optimizedPrompt, setOptimizedPrompt] = useState<string>();
  const runningIds = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const pairsRef = useRef<LogoPair[]>([]);
  const settingsRef = useRef(settings);
  const promptRef = useRef(prompt);

  const pairs = useMemo(
    () => buildLogoPairs(scenes, logos, placements, inpaintMasks),
    [scenes, logos, placements, inpaintMasks],
  );
  const groups = useMemo(() => makeLogoResultGroups(pairs, tasks), [pairs, tasks]);
  const activeGroup = groups.find((group) => group.pair.id === activeGroupId);
  const completePairs = pairs.filter((pair) => pair.scene && pair.logo);
  const isPairingValid = pairs.length > 0 && completePairs.length === pairs.length && scenes.length === logos.length;
  const taskCount = completePairs.length * settings.copiesPerGroup;
  const completedCount = tasks.filter((task) => ['success', 'failed', 'stopped'].includes(task.status)).length;
  const successCount = tasks.filter((task) => task.status === 'success').length;
  const isProcessing = tasks.some((task) => ['waiting', 'running'].includes(task.status));
  useEffect(() => { reportTaskProgress({ id: 'logo-compose', label: 'Logo 合成', completed: completedCount, total: tasks.length, failed: tasks.filter((task) => task.status === 'failed').length, running: isProcessing }); }, [completedCount, tasks, isProcessing]);
  const capability = MODEL_CAPABILITIES[settings.imageModel];
  const allPresets: LogoPromptPreset[] = [
    ...(localizeBuiltInLogoPresets(language) as readonly LogoPromptPreset[]),
    ...customPresets,
  ];

  useEffect(() => { pairsRef.current = pairs; }, [pairs]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => { promptRef.current = prompt; }, [prompt]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.logoSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.logoPresets, JSON.stringify(customPresets)), [customPresets]);
  useEffect(() => {
    onSessionStateChange?.(Boolean(scenes.length || logos.length || tasks.length || prompt.trim()));
  }, [scenes.length, logos.length, tasks.length, prompt, onSessionStateChange]);

  const validateFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      message.error(`${file.name}：仅支持 PNG、JPEG、WebP`);
      return false;
    }
    if (!file.size || file.size > MAX_IMAGE_SIZE) {
      message.error(`${file.name}：文件需小于 20MB 且不能为空`);
      return false;
    }
    return true;
  };
  const makeAsset = (file: File): LogoAsset => ({
    id: createId(),
    file,
    name: file.name,
    mimeType: file.type,
    previewUrl: URL.createObjectURL(file),
  });
  const mutateAssets = (
    setter: React.Dispatch<React.SetStateAction<LogoAsset[]>>,
    mutation: (current: LogoAsset[]) => LogoAsset[],
  ) => {
    if (tasks.length) {
      aborters.current.forEach((controller) => controller.abort());
      tasks.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
      setTasks([]);
      setActiveGroupId(undefined);
    }
    setter((current) => mutation(current));
    setPlacements({});
    setInpaintMasks({});
  };
  const addAssets = (setter: React.Dispatch<React.SetStateAction<LogoAsset[]>>, files: File[]) => {
    const valid = files.filter(validateFile).map(makeAsset);
    if (valid.length) mutateAssets(setter, (current) => [...current, ...valid]);
  };
  const removeAsset = (setter: React.Dispatch<React.SetStateAction<LogoAsset[]>>, index: number) =>
    mutateAssets(setter, (current) => {
      URL.revokeObjectURL(current[index].previewUrl);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  const replaceAsset = (setter: React.Dispatch<React.SetStateAction<LogoAsset[]>>, index: number, file: File) => {
    if (!validateFile(file)) return;
    mutateAssets(setter, (current) => current.map((asset, itemIndex) => {
      if (itemIndex !== index) return asset;
      URL.revokeObjectURL(asset.previewUrl);
      return makeAsset(file);
    }));
  };
  const reorderAsset = (setter: React.Dispatch<React.SetStateAction<LogoAsset[]>>, fromIndex: number, toIndex: number) =>
    mutateAssets(setter, (current) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  const clearAssets = (setter: React.Dispatch<React.SetStateAction<LogoAsset[]>>, assets: LogoAsset[]) => {
    assets.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
    setter([]);
    setPlacements({});
    setInpaintMasks({});
  };

  const patchSettings = (patch: Partial<LogoSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (patch.imageModel) {
        const normalized = normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize);
        return { ...next, ...normalized };
      }
      return next;
    });
  };

  const runOptimization = async () => {
    if (!apiKey) return onRequestKey();
    if (connectionMode === 'proxy' && !apiBaseUrl) {
      message.warning('请先配置代理地址');
      return onRequestKey();
    }
    if (!prompt.trim()) return void message.warning('请先输入提示词');
    setOptimizing(true);
    try {
      const result = await optimizePrompt({
        apiKey,
        model: settings.optimizerModel,
        prompt: `这是 Logo 合成任务。${prompt.trim()}`,
        apiBaseUrl,
      });
      setOptimizedPrompt(result);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提示词优化失败');
    } finally {
      setOptimizing(false);
    }
  };

  const executeTask = useCallback(async (task: LogoGenerationTask) => {
    if (runningIds.current.has(task.id)) return;
    const pair = pairsRef.current.find((item) => item.id === task.pairId);
    if (!pair?.scene || !pair.logo) return;
    runningIds.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const currentSettings = settingsRef.current;
      const guide = currentSettings.useGlassLogoEtchSkill
        ? undefined
        : pair.inpaintMask
          ? await inpaintGuideToBlob(pair.inpaintMask.guideDataUrl)
          : pair.placement
            ? await createPlacementGuide(pair.scene.previewUrl, pair.logo.previewUrl, pair.placement)
            : undefined;
      const requestLogo = currentSettings.useGlassLogoEtchSkill
        ? await padLogoToSquare(pair.logo.file)
        : pair.logo.file;
      const result = await generateLogoComposite({
        apiKey,
        model: currentSettings.imageModel,
        prompt: promptRef.current,
        scene: pair.scene.file,
        logo: requestLogo,
        placementGuide: guide,
        guideMode: currentSettings.useGlassLogoEtchSkill ? undefined : pair.inpaintMask ? 'inpaint' : pair.placement ? 'placement' : undefined,
        guideLogoInverted: Boolean(pair.placement?.invertForGuide),
        aspectRatio: currentSettings.ratioMode === 'fixed' ? currentSettings.aspectRatio : undefined,
        imageSize: currentSettings.imageSize,
        signal: controller.signal,
        apiBaseUrl,
        glassLogoEtch: currentSettings.useGlassLogoEtchSkill ? {
          scaleRatio: currentSettings.glassEtchScaleRatio,
          topMarginRatio: currentSettings.glassEtchTopMarginRatio,
          logoColor: currentSettings.glassEtchLogoColor,
          textureMode: currentSettings.glassEtchTextureMode,
          applyAllCups: currentSettings.glassEtchApplyAllCups,
          outputCoordinateMode: currentSettings.glassEtchOutputCoordinateMode,
        } : undefined,
      });
      const resultUrl = URL.createObjectURL(result.blob);
      setTasks((current) => current.map((item) => item.id === task.id
        ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType }
        : item));
    } catch (error) {
      const stopped = controller.signal.aborted;
      setTasks((current) => current.map((item) => item.id === task.id
        ? { ...item, status: stopped ? 'stopped' : 'failed', error: stopped ? '任务已停止' : error instanceof Error ? error.message : '合成失败' }
        : item));
    } finally {
      runningIds.current.delete(task.id);
      aborters.current.delete(task.id);
    }
  }, [apiKey, apiBaseUrl]);

  useEffect(() => {
    const available = Math.max(0, settings.concurrency - runningIds.current.size);
    tasks
      .filter((task) => task.status === 'waiting' && !runningIds.current.has(task.id))
      .slice(0, available)
      .forEach((task) => void executeTask(task));
  }, [tasks, settings.concurrency, executeTask]);

  const startGeneration = () => {
    if (!apiKey) return onRequestKey();
    if (connectionMode === 'proxy' && !apiBaseUrl) {
      message.warning('请先配置代理地址');
      return onRequestKey();
    }
    if (!isPairingValid) return void message.warning('请确保场景图与 Logo 图数量一致且全部配对');
    if (!settings.useGlassLogoEtchSkill && !prompt.trim()) return void message.warning('请输入 Logo 合成提示词');
    tasks.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
    try {
      setTasks(buildLogoTasks(pairs, settings.copiesPerGroup));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '无法创建任务');
    }
  };
  const stopTasks = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => current.map((task) => task.status === 'waiting' ? { ...task, status: 'stopped' } : task));
  };
  const retryTask = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const retry = { ...task, status: 'running' as const, error: undefined, retryCount: task.retryCount + 1 };
    setTasks((current) => current.map((item) => item.id === id ? retry : item));
    void executeTask(retry);
  };
  const clearResults = () => {
    aborters.current.forEach((controller) => controller.abort());
    tasks.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
    setTasks([]);
    setActiveGroupId(undefined);
  };
  const savePreset = () => {
    if (!prompt.trim()) return void message.warning('请先输入提示词');
    let presetName = '';
    modal.confirm({
      title: '保存 Logo 提示词预设',
      content: <Input placeholder="预设名称" onChange={(event) => { presetName = event.target.value; }} />,
      onOk: () => {
        if (!presetName.trim()) throw new Error('请输入预设名称');
        setCustomPresets((current) => [
          ...current,
          { id: createId(), name: presetName.trim(), content: prompt.trim(), builtIn: false, updatedAt: Date.now() },
        ]);
      },
    });
  };

  const logoSettingsPanel = (
    <div className="settings-panel logo-settings-panel">
      <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>合成设置</Title><Tag color="purple">Logo</Tag></Flex>
      <Divider />
      <Form layout="vertical">
        <Form.Item label="玻璃杯 Logo 雕刻技能">
          <Flex justify="space-between" align="center">
            <Text>使用 glass-logo-etch</Text>
            <Switch checked={settings.useGlassLogoEtchSkill} onChange={(useGlassLogoEtchSkill) => patchSettings({ useGlassLogoEtchSkill })} />
          </Flex>
        </Form.Item>
        {settings.useGlassLogoEtchSkill && (
          <Card size="small" className="glass-etch-skill-card">
            <Alert type="info" showIcon title="技能模式已启用" description="自动识别玻璃杯并按杯体曲率合成；手动定位与局部重绘参考在此模式下不会提交。用户提示词可以留空。" />
            <Form.Item label={`Logo 尺寸比例 · ${Math.round(settings.glassEtchScaleRatio * 100)}%`}>
              <Slider min={0.1} max={0.9} step={0.05} value={settings.glassEtchScaleRatio} onChange={(glassEtchScaleRatio) => patchSettings({ glassEtchScaleRatio })} />
            </Form.Item>
            <Form.Item label={`杯口下边距比例 · ${Math.round(settings.glassEtchTopMarginRatio * 100)}%`}>
              <Slider min={0} max={0.3} step={0.01} value={settings.glassEtchTopMarginRatio} onChange={(glassEtchTopMarginRatio) => patchSettings({ glassEtchTopMarginRatio })} />
            </Form.Item>
            <Form.Item label="Logo 颜色">
              <Segmented block value={settings.glassEtchLogoColor} onChange={(glassEtchLogoColor) => patchSettings({ glassEtchLogoColor: glassEtchLogoColor as LogoSettings['glassEtchLogoColor'] })} options={[{ value: 'white', label: '白色' }, { value: 'black', label: '黑色' }]} />
            </Form.Item>
            <Form.Item label="材质模式">
              <Segmented block value={settings.glassEtchTextureMode} onChange={(glassEtchTextureMode) => patchSettings({ glassEtchTextureMode: glassEtchTextureMode as LogoSettings['glassEtchTextureMode'] })} options={[{ value: 'laser_etch', label: '激光磨砂蚀刻' }, { value: 'print', label: '实色印刷' }]} />
            </Form.Item>
            <Form.Item label="应用范围">
              <Flex justify="space-between" align="center"><Text>应用到所有有效杯子</Text><Switch checked={settings.glassEtchApplyAllCups} onChange={(glassEtchApplyAllCups) => patchSettings({ glassEtchApplyAllCups })} /></Flex>
            </Form.Item>
            <Form.Item label="坐标计算模式">
              <Select value={settings.glassEtchOutputCoordinateMode} onChange={(glassEtchOutputCoordinateMode) => patchSettings({ glassEtchOutputCoordinateMode })} options={[{ value: 'relative_percent', label: '相对比例 [0,1]' }, { value: 'pixel', label: '原图像素' }]} />
            </Form.Item>
          </Card>
        )}
        <Form.Item label="图片模型">
          <Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} />
        </Form.Item>
        <Form.Item label="画面比例">
          <Radio.Group value={settings.ratioMode} onChange={(event) => patchSettings({ ratioMode: event.target.value })}>
            <Radio value="original">跟随场景原图</Radio>
            <Radio value="fixed">指定比例</Radio>
          </Radio.Group>
          {settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patchSettings({ aspectRatio })} options={capability.aspectRatios.map((value) => ({ value, label: value }))} />}
        </Form.Item>
        <Form.Item label="输出分辨率">
          <Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as LogoSettings['imageSize'] })} options={capability.imageSizes} />
        </Form.Item>
        <Form.Item label="每组生成张数">
          <InputNumber min={1} max={8} value={settings.copiesPerGroup} onChange={(copiesPerGroup) => patchSettings({ copiesPerGroup: copiesPerGroup || 1 })} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="并发任务数">
          <InputNumber min={1} max={6} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="提示词优化模型">
          <Select value={settings.optimizerModel} onChange={(optimizerModel) => patchSettings({ optimizerModel })} options={[
            { value: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
            { value: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash' },
            { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
          ]} />
        </Form.Item>
      </Form>
      <Card className="price-card" variant="borderless">
        <Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel, settings.imageSize, taskCount) + taskCount * PRICING.models[settings.imageModel].inputImage} />
        <Text type="secondary">按 {taskCount} 个独立请求估算，双图输入费用为近似值。</Text>
      </Card>
    </div>
  );

  return (
    <div className="logo-page">
      <section className="hero-strip logo-hero">
        <div>
          <Text className="eyebrow">LOGO COMPOSER</Text>
          <Title level={2}>让品牌标识自然融入每个场景</Title>
          <Paragraph className="hero-description">按顺序配对场景与 Logo，可视化定位后批量生成专业合成图。</Paragraph>
        </div>
        <div className="hero-orb" />
      </section>

      <div className={settingsHost ? 'logo-workspace has-external-settings' : 'logo-workspace'}>
        <main>
          <div className="asset-columns">
            <AssetColumn
              title="场景图"
              hint="按上传顺序与 Logo 配对"
              assets={scenes}
              onAdd={(files) => addAssets(setScenes, files)}
              onRemove={(index) => removeAsset(setScenes, index)}
              onReplace={(index, file) => replaceAsset(setScenes, index, file)}
              onReorder={(fromIndex, toIndex) => reorderAsset(setScenes, fromIndex, toIndex)}
              onClear={() => clearAssets(setScenes, scenes)}
            />
            <AssetColumn
              title="Logo 图"
              hint="建议上传透明背景 PNG"
              assets={logos}
              onAdd={(files) => addAssets(setLogos, files)}
              onRemove={(index) => removeAsset(setLogos, index)}
              onReplace={(index, file) => replaceAsset(setLogos, index, file)}
              onReorder={(fromIndex, toIndex) => reorderAsset(setLogos, fromIndex, toIndex)}
              onClear={() => clearAssets(setLogos, logos)}
            />
          </div>

          <Card className="workflow-card" title="配对与 Logo 定位" extra={<Tag color={isPairingValid ? 'success' : 'warning'}>{completePairs.length}/{pairs.length} 组已配对</Tag>}>
            {pairs.length ? (
              <Image.PreviewGroup>
                <div className="pair-grid">
                  {pairs.map((pair) => (
                    <Card key={pair.id} size="small" className={!pair.scene || !pair.logo ? 'pair-card pair-incomplete' : 'pair-card'}>
                      <Flex align="center" gap={10}>
                        <div className="pair-number">{pair.index + 1}</div>
                        {pair.scene
                          ? <Image width={54} height={54} style={{ objectFit: 'cover' }} src={pair.scene.previewUrl} alt={`第 ${pair.index + 1} 组场景图`} preview={{ mask: <EyeOutlined /> }} />
                          : <div className="pair-missing">缺场景</div>}
                        <span>+</span>
                        {pair.logo
                          ? <Image width={54} height={54} className="pair-logo-preview" style={{ objectFit: 'contain', background: '#f6f7fa' }} src={pair.logo.previewUrl} alt={`第 ${pair.index + 1} 组 Logo`} preview={{ mask: <EyeOutlined /> }} />
                          : <div className="pair-missing">缺 Logo</div>}
                      </Flex>
                      <Flex className="pair-actions-row" justify="space-between" align="center" style={{ marginTop: 10 }} gap={6} wrap>
                        {settings.useGlassLogoEtchSkill
                          ? <Tag color="purple">Skill 自动定位</Tag>
                          : pair.inpaintMask
                          ? <Tag icon={<HighlightOutlined />} color="magenta">局部重绘</Tag>
                          : pair.placement
                            ? <Tag icon={<CheckOutlined />} color="success">已定位</Tag>
                            : <Tag>提示词定位</Tag>}
                        <Space className="pair-action-buttons" size={4} wrap>
                          {(pair.placement || pair.inpaintMask) && (
                            <Button size="small" type="text" onClick={() => {
                              setPlacements((current) => ({ ...current, [pair.index]: undefined }));
                              setInpaintMasks((current) => ({ ...current, [pair.index]: undefined }));
                            }}>清除定位</Button>
                          )}
                          <Tooltip title={settings.useGlassLogoEtchSkill ? "技能模式会自动检测杯体并计算 Logo 位置" : undefined}><Button size="small" disabled={!pair.scene || !pair.logo || settings.useGlassLogoEtchSkill} icon={<EditOutlined />} onClick={() => setEditingPair(pair)}>定位 Logo</Button></Tooltip>
                        </Space>
                      </Flex>
                    </Card>
                  ))}
                </div>
              </Image.PreviewGroup>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传两列图片后将按顺序自动配对" />}
          </Card>

          <Card
            className="workflow-card"
            title={<Space><span>Logo 合成提示词</span>{settings.useGlassLogoEtchSkill && <Tag color="purple">可选</Tag>}</Space>}
            extra={<Space><Button icon={<SaveOutlined />} onClick={savePreset}>保存预设</Button><Button icon={<ClearOutlined />} onClick={() => setPrompt('')}>清空</Button></Space>}
          >
            {settings.useGlassLogoEtchSkill && <Alert type="success" showIcon title="当前使用玻璃杯 Logo 雕刻技能" description="无需填写提示词；如填写，将作为技能指令之外的补充要求。" style={{ marginBottom: 12 }} />}
            <Input.TextArea
              rows={5}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={settings.useGlassLogoEtchSkill ? "可选：补充特殊要求；留空将完全按照 glass-logo-etch 技能参数生成" : "描述 Logo 放置位置、载体材质、融合方式、光影和需要保持不变的内容……"}
              showCount
              maxLength={2000}
            />
            <Flex justify="space-between" align="center" style={{ marginTop: 12 }} wrap gap={8}>
              <Space wrap>
                {allPresets.map((preset) => (
                  <Dropdown
                    key={preset.id}
                    trigger={['contextMenu']}
                    menu={preset.builtIn ? { items: [] } : {
                      items: [{ key: 'delete', danger: true, label: '删除预设' }],
                      onClick: () => setCustomPresets((current) => current.filter((item) => item.id !== preset.id)),
                    }}
                  >
                    <Tag className="prompt-preset-tag" onClick={() => setPrompt(preset.content)}>{preset.name}</Tag>
                  </Dropdown>
                ))}
              </Space>
              <Button icon={<BulbOutlined />} loading={optimizing} onClick={() => void runOptimization()}>优化提示词</Button>
            </Flex>
          </Card>

          <Card className="action-card">
            <Flex justify="space-between" align="center" gap={16} wrap>
              <div>
                <Title level={4} style={{ margin: 0 }}>准备生成 {taskCount} 张 Logo 合成图</Title>
                <Text type="secondary">{completePairs.length} 组 × 每组 {settings.copiesPerGroup} 张</Text>
              </div>
              <Space>
                {isProcessing && <Button danger icon={<StopOutlined />} onClick={stopTasks}>停止任务</Button>}
                <Button size="large" type="primary" icon={<RocketOutlined />} loading={isProcessing} onClick={startGeneration}>{isProcessing ? '正在合成' : '开始合成'}</Button>
              </Space>
            </Flex>
            {!!tasks.length && (
              <div className="overall-progress">
                <Progress percent={Math.round((completedCount / tasks.length) * 100)} status={isProcessing ? 'active' : successCount ? 'success' : 'exception'} />
              </div>
            )}
          </Card>

          <section className="results-section">
            <Flex justify="space-between" align="center" gap={8}>
              <div><Title level={3}>合成结果</Title><Text type="secondary">结果按场景图和 Logo 配对组展示</Text></div>
              <Space>
                <Popconfirm title="清空所有生成结果？进行中的请求也会停止。" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm>
                <Button disabled={!successCount} icon={<DownloadOutlined />} onClick={() => void downloadAllLogoResults(groups, settings.imageModel, settings.copiesPerGroup)}>下载全部</Button>
              </Space>
            </Flex>
            {groups.length ? (
              <div className="results-grid">
                {groups.map((group) => (
                  <Card
                    hoverable
                    key={group.pair.id}
                    className="result-group-card"
                    onClick={() => setActiveGroupId(group.pair.id)}
                    actions={[
                      <EditOutlined key="open" />,
                      <DownloadOutlined key="download" onClick={(event) => { event.stopPropagation(); void downloadLogoGroup(group, settings.imageModel); }} />,
                    ]}
                  >
                    <div className="result-stack">
                      {group.tasks.filter((task) => task.resultUrl).slice(0, 3).map((task, index) => (
                        <img key={task.id} src={task.resultUrl} alt="" style={{ '--stack-index': index } as React.CSSProperties} />
                      ))}
                      {!group.successCount && (
                        group.tasks.some((task) => task.status === 'waiting' || task.status === 'running')
                          ? <GeneratingImage
                              progressKey={(group.tasks.find((task) => task.status === 'running') || group.tasks.find((task) => task.status === 'waiting'))?.id}
                              status={group.tasks.some((task) => task.status === 'running') ? 'running' : 'waiting'}
                              percent={group.tasks.some((task) => task.status === 'running') ? 1 : 0}
                            />
                          : group.tasks.some((task) => task.status === 'failed')
                            ? <div className="task-state-card is-failed"><Text strong type="danger">生成失败</Text><Text type="secondary">{group.tasks.filter((task) => task.status === 'failed').length} 个任务失败</Text></div>
                            : <div className="task-state-card is-stopped"><Text strong type="secondary">已停止</Text></div>
                      )}
                    </div>
                    <Flex gap={8} align="center">
                      <img className="source-thumb" src={group.pair.scene?.previewUrl} alt="" />
                      <span>+</span>
                      <img className="source-thumb logo-thumb" src={group.pair.logo?.previewUrl} alt="" />
                      <div className="group-copy"><Text strong>第 {group.pair.index + 1} 组</Text><Text type="secondary">{group.successCount}/{group.tasks.length} 成功</Text></div>
                    </Flex>
                  </Card>
                ))}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="合成结果会显示在这里" />}
          </section>
        </main>

        {!settingsHost && <aside className="logo-settings">{logoSettingsPanel}</aside>}
      </div>

      {settingsHost && createPortal(logoSettingsPanel, settingsHost)}

      <PlacementEditor
        pair={editingPair}
        open={Boolean(editingPair)}
        onCancel={() => setEditingPair(undefined)}
        onSave={({ placement, inpaintMask }) => {
          if (editingPair) {
            setPlacements((current) => ({ ...current, [editingPair.index]: placement }));
            setInpaintMasks((current) => ({ ...current, [editingPair.index]: inpaintMask }));
          }
          setEditingPair(undefined);
        }}
      />

      <Modal
        title="提示词优化预览"
        open={Boolean(optimizedPrompt)}
        onCancel={() => setOptimizedPrompt(undefined)}
        onOk={() => { if (optimizedPrompt) setPrompt(optimizedPrompt); setOptimizedPrompt(undefined); }}
        okText="确认替换"
      >
        <Text type="secondary">原文</Text><Paragraph>{prompt}</Paragraph>
        <Text type="success">优化后</Text><Paragraph>{optimizedPrompt}</Paragraph>
      </Modal>

      <Modal
        title={activeGroup ? `第 ${activeGroup.pair.index + 1} 组 · ${activeGroup.successCount}/${activeGroup.tasks.length}` : '合成结果'}
        width={960}
        open={Boolean(activeGroup)}
        onCancel={() => setActiveGroupId(undefined)}
        footer={activeGroup ? [
          <Button key="close" onClick={() => setActiveGroupId(undefined)}>关闭</Button>,
          <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={() => void downloadLogoGroup(activeGroup, settings.imageModel)}>下载该组 ZIP</Button>,
        ] : null}
      >
        {activeGroup && (
          <>
            <Image.PreviewGroup>
              <div className="detail-image-grid">
                {activeGroup.tasks.map((task) => (
                  <div className="detail-image-item" key={task.id}>
                    {task.resultUrl
                      ? <OriginalCompareImage src={task.resultUrl} originalSrc={activeGroup.pair.scene?.previewUrl} alt={`第 ${task.copyIndex + 1} 张合成图`} />
                      : task.status === 'running'
                        ? <GeneratingImage progressKey={task.id} status="running" percent={1} />
                        : task.status === 'waiting'
                          ? <div className="task-state-card is-waiting"><Text strong>排队中…</Text><Text type="secondary">等待可用并发任务</Text></div>
                          : <div className={`task-state-card is-${task.status}`}>
                              <Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{logoTaskStatusText(task.status)}</Text>
                              <Text type="secondary" ellipsis={{ tooltip: task.error }}>{task.error || (task.status === 'stopped' ? '任务已停止' : '尚未生成图片')}</Text>
                            </div>}
                    <Flex justify="space-between">
                      <Text>结果 {task.copyIndex + 1}</Text>
                      {task.resultUrl && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadLogoTask(task, activeGroup.pair, settings.imageModel)} />}
                      {task.status === 'failed' && <Button type="text" icon={<ReloadOutlined />} onClick={() => retryTask(task.id)}>重试</Button>}
                    </Flex>
                  </div>
                ))}
              </div>
            </Image.PreviewGroup>
            <Divider titlePlacement="start">文件与任务</Divider>
            <List
              className="task-file-list"
              dataSource={activeGroup.tasks}
              renderItem={(task) => (
                <List.Item actions={task.status === 'failed' ? [<Button key="retry" icon={<ReloadOutlined />} onClick={() => retryTask(task.id)}>重试</Button>] : undefined}>
                  <List.Item.Meta
                    title={task.resultBlob ? logoTaskFileName(task, activeGroup.pair, settings.imageModel) : `结果 ${task.copyIndex + 1}`}
                    description={<Space wrap><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'processing' : 'default'}>{logoTaskStatusText(task.status)}</Tag>{task.resultBlob?.size ? <Text type="secondary">{Math.ceil(task.resultBlob.size / 1024)} KB</Text> : null}{task.error ? <Text type="danger">{task.error}</Text> : null}</Space>}
                  />
                </List.Item>
              )}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
