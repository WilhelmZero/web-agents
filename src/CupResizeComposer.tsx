import {
  ClearOutlined,
  DownloadOutlined,
  DragOutlined,
  EditOutlined,
  EyeOutlined,
  FileImageOutlined,
  HighlightOutlined,
  RocketOutlined,
  StopOutlined,
  UndoOutlined,
  RedoOutlined,
  UnlockOutlined,
  LockOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Divider,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Radio,
  Segmented,
  Select,
  Slider,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { cloneElement, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_CUP_RESIZE_SETTINGS, MODEL_CAPABILITIES, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import { CUP_RESIZE_PROMPT, inferBorderColor, rgbToHex } from './services/cupResize';
import { generateCupResizeImage } from './services/gemini';
import { generateCupResizeOpenAi } from './services/logoReplaceOpenAi';
import { reportTaskProgress } from './services/taskProgress';
import { readLocalStorage } from './storage';
import type { CupResizeSettings } from './types';
import { downloadBlob, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';

const { Dragger } = Upload;
const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
type ToolMode = 'move' | 'brush' | 'rect' | 'ellipse';
type Point = { x: number; y: number };
type Scale = { x: number; y: number };
type CropEdges = { top: number; right: number; bottom: number; left: number };
type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';
const GPT_MODELS = ['gpt-image-2', 'gpt-image-2-2026-04-21'] as const;
const isOpenAiModel = (model: CupResizeSettings['imageModel']): model is typeof GPT_MODELS[number] => model.startsWith('gpt-image-');
const MODEL_OPTIONS = [{ label: 'GPT', options: [{ value: 'gpt-image-2', label: 'GPT Image 2（推荐）' }, { value: 'gpt-image-2-2026-04-21', label: 'GPT Image 2（2026-04-21）' }] }, { label: 'Gemini', options: Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label })) }];

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = url;
  });
}

function CurtainCompare({ before, beforeLabel, after }: { before: string; beforeLabel: string; after: string }) {
  const [position, setPosition] = useState(50);
  const update = (clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setPosition(Math.max(0, Math.min(100, (clientX - rect.left) / Math.max(1, rect.width) * 100)));
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    update(event.clientX, event.currentTarget);
  };
  return <div className="cup-curtain-compare" role="slider" tabIndex={0} aria-label={`${beforeLabel}与生成图拉幕对比`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(position)} onPointerDown={pointerDown} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event.clientX, event.currentTarget); }} onKeyDown={(event) => { if (event.key === 'ArrowLeft') setPosition((value) => Math.max(0, value - 2)); if (event.key === 'ArrowRight') setPosition((value) => Math.min(100, value + 2)); }}>
    <img src={after} alt="AI 生成图" />
    <div className="cup-curtain-before" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}><img src={before} alt="最终指导合成图" /></div>
    <span className="cup-curtain-label is-before">{beforeLabel}</span><span className="cup-curtain-label is-after">生成图</span>
    <div className="cup-curtain-divider" style={{ left: `${position}%` }}><span>↔</span></div>
  </div>;
}

function CupPlacementCanvas({
  sceneUrl,
  cupUrl,
  cupScale,
  crop,
  aspectLocked,
  fillColor,
  mode,
  brushSize,
  position,
  onPositionChange,
  onScaleChange,
  onDetectedColor,
  onCompositeChange,
  clearToken,
  undoToken,
  redoToken,
  onHistoryChange,
}: {
  sceneUrl: string;
  cupUrl: string;
  cupScale: Scale;
  crop: CropEdges;
  aspectLocked: boolean;
  fillColor: string;
  mode: ToolMode;
  brushSize: number;
  position: Point;
  onPositionChange: (position: Point) => void;
  onScaleChange: (scale: Scale) => void;
  onDetectedColor: (color: string) => void;
  onCompositeChange: (blob?: Blob) => void;
  clearToken: number;
  undoToken: number;
  redoToken: number;
  onHistoryChange: (undoCount: number, redoCount: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HTMLImageElement | undefined>(undefined);
  const cupRef = useRef<HTMLImageElement | undefined>(undefined);
  const paintRef = useRef<HTMLCanvasElement | undefined>(undefined);
  const shapePreviewRef = useRef<{ start: Point; current: Point; mode: 'rect' | 'ellipse' } | undefined>(undefined);
  const undoStackRef = useRef<ImageData[]>([]);
  const redoStackRef = useRef<ImageData[]>([]);
  const commandReadyRef = useRef(false);
  const dragRef = useRef<{ start: Point; last: Point; action: 'move' | 'paint' | ResizeHandle; startScale: Scale } | undefined>(undefined);
  const positionRef = useRef(position);
  const scaleRef = useRef(cupScale);
  const boundsRef = useRef<{ left: number; top: number; width: number; height: number } | undefined>(undefined);
  const [cursor, setCursor] = useState('default');
  positionRef.current = position;
  scaleRef.current = cupScale;

  const cupGeometry = useCallback(() => {
    const cup = cupRef.current;
    if (!cup) return undefined;
    const sourceX = cup.naturalWidth * crop.left / 100;
    const sourceY = cup.naturalHeight * crop.top / 100;
    const sourceWidth = cup.naturalWidth * (1 - (crop.left + crop.right) / 100);
    const sourceHeight = cup.naturalHeight * (1 - (crop.top + crop.bottom) / 100);
    const width = Math.max(1, sourceWidth * scaleRef.current.x);
    const height = Math.max(1, sourceHeight * scaleRef.current.y);
    return { sourceX, sourceY, sourceWidth, sourceHeight, width, height, left: positionRef.current.x - width / 2, top: positionRef.current.y - height / 2 };
  }, [crop]);

  const render = useCallback((showControls = true) => {
    const canvas = canvasRef.current;
    const scene = sceneRef.current;
    const cup = cupRef.current;
    const paint = paintRef.current;
    if (!canvas || !scene || !cup || !paint) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(scene, 0, 0, canvas.width, canvas.height);
    context.drawImage(paint, 0, 0);
    const shapePreview = shapePreviewRef.current;
    if (shapePreview) {
      const width = shapePreview.current.x - shapePreview.start.x;
      const height = shapePreview.current.y - shapePreview.start.y;
      context.save(); context.fillStyle = fillColor; context.globalAlpha = .78;
      if (shapePreview.mode === 'rect') context.fillRect(shapePreview.start.x, shapePreview.start.y, width, height);
      else { context.beginPath(); context.ellipse(shapePreview.start.x + width / 2, shapePreview.start.y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2); context.fill(); }
      context.restore();
    }
    const geometry = cupGeometry();
    if (!geometry) return;
    const { sourceX, sourceY, sourceWidth, sourceHeight, width: renderedWidth, height: renderedHeight, left, top } = geometry;
    boundsRef.current = { left, top, width: renderedWidth, height: renderedHeight };
    context.fillStyle = fillColor;
    context.fillRect(left, top, renderedWidth, renderedHeight);
    context.drawImage(cup, sourceX, sourceY, sourceWidth, sourceHeight, left, top, renderedWidth, renderedHeight);
    if (mode === 'move' && showControls) {
      context.save();
      context.strokeStyle = '#1677ff';
      context.lineWidth = Math.max(2, canvas.width / 700);
      context.setLineDash([10, 7]);
      context.strokeRect(left, top, renderedWidth, renderedHeight);
      context.setLineDash([]);
      const handleSize = Math.max(12, canvas.width / 70);
      context.fillStyle = '#ffffff';
      context.strokeStyle = '#1677ff';
      [[left, top], [left + renderedWidth, top], [left + renderedWidth, top + renderedHeight], [left, top + renderedHeight]].forEach(([x, y]) => { context.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize); context.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize); });
      context.restore();
    }
  }, [cupGeometry, fillColor, mode]);

  const exportComposite = useCallback(() => {
    render(false);
    canvasRef.current?.toBlob((blob) => { onCompositeChange(blob || undefined); render(true); }, 'image/png');
  }, [onCompositeChange, render]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadImage(sceneUrl), loadImage(cupUrl)]).then(([scene, cup]) => {
      if (cancelled) return;
      const scale = Math.min(1, 2048 / Math.max(scene.naturalWidth, scene.naturalHeight));
      const width = Math.max(1, Math.round(scene.naturalWidth * scale));
      const height = Math.max(1, Math.round(scene.naturalHeight * scale));
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const paint = document.createElement('canvas');
      paint.width = width;
      paint.height = height;
      const sampler = document.createElement('canvas');
      sampler.width = cup.naturalWidth;
      sampler.height = cup.naturalHeight;
      const samplerContext = sampler.getContext('2d', { willReadFrequently: true });
      samplerContext?.drawImage(cup, 0, 0);
      if (samplerContext) onDetectedColor(rgbToHex(inferBorderColor(samplerContext.getImageData(0, 0, sampler.width, sampler.height))));
      sceneRef.current = scene;
      cupRef.current = cup;
      paintRef.current = paint;
      undoStackRef.current = [];
      redoStackRef.current = [];
      onHistoryChange(0, 0);
      onPositionChange({ x: width / 2, y: height / 2 });
      requestAnimationFrame(() => { render(); exportComposite(); });
    }).catch(() => onCompositeChange(undefined));
    return () => { cancelled = true; };
  }, [cupUrl, sceneUrl]);

  useEffect(() => { render(); const timer = window.setTimeout(exportComposite, 120); return () => window.clearTimeout(timer); }, [render, exportComposite, cupScale, crop, fillColor, mode, position]);
  const snapshotPaint = () => {
    const paint = paintRef.current; const context = paint?.getContext('2d');
    if (!paint || !context) return;
    undoStackRef.current.push(context.getImageData(0, 0, paint.width, paint.height));
    if (undoStackRef.current.length > 30) undoStackRef.current.shift();
    redoStackRef.current = [];
    onHistoryChange(undoStackRef.current.length, 0);
  };
  useEffect(() => {
    if (!commandReadyRef.current) { commandReadyRef.current = true; return; }
    const paint = paintRef.current; const context = paint?.getContext('2d'); if (!paint || !context) return;
    snapshotPaint(); context.clearRect(0, 0, paint.width, paint.height); render(); exportComposite();
  }, [clearToken]);
  useEffect(() => {
    if (!undoToken) return;
    const paint = paintRef.current; const context = paint?.getContext('2d'); const previous = undoStackRef.current.pop(); if (!paint || !context || !previous) return;
    redoStackRef.current.push(context.getImageData(0, 0, paint.width, paint.height)); context.putImageData(previous, 0, 0); onHistoryChange(undoStackRef.current.length, redoStackRef.current.length); render(); exportComposite();
  }, [undoToken]);
  useEffect(() => {
    if (!redoToken) return;
    const paint = paintRef.current; const context = paint?.getContext('2d'); const next = redoStackRef.current.pop(); if (!paint || !context || !next) return;
    undoStackRef.current.push(context.getImageData(0, 0, paint.width, paint.height)); context.putImageData(next, 0, 0); onHistoryChange(undoStackRef.current.length, redoStackRef.current.length); render(); exportComposite();
  }, [redoToken]);

  const point = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  };
  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const current = point(event);
    let action: 'move' | 'paint' | ResizeHandle = 'paint';
    if (mode === 'move' && boundsRef.current) {
      const { left, top, width, height } = boundsRef.current;
      const hit = Math.max(18, event.currentTarget.width / 45);
      const corners: Array<[ResizeHandle, number, number]> = [['nw', left, top], ['ne', left + width, top], ['se', left + width, top + height], ['sw', left, top + height]];
      action = corners.find(([, x, y]) => Math.abs(current.x - x) <= hit && Math.abs(current.y - y) <= hit)?.[0] || 'move';
    }
    if (action === 'paint' && (mode === 'brush' || mode === 'rect' || mode === 'ellipse')) snapshotPaint();
    setCursor(action === 'move' ? 'grabbing' : action === 'nw' || action === 'se' ? 'nwse-resize' : action === 'ne' || action === 'sw' ? 'nesw-resize' : 'crosshair');
    dragRef.current = { start: current, last: current, action, startScale: { ...scaleRef.current } };
  };
  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const current = point(event);
    if (!drag) {
      if (mode !== 'move' || !boundsRef.current) return setCursor(mode === 'brush' ? 'crosshair' : 'crosshair');
      const { left, top, width, height } = boundsRef.current;
      const hit = Math.max(18, event.currentTarget.width / 45);
      const nwse = (Math.abs(current.x - left) <= hit && Math.abs(current.y - top) <= hit) || (Math.abs(current.x - left - width) <= hit && Math.abs(current.y - top - height) <= hit);
      const nesw = (Math.abs(current.x - left - width) <= hit && Math.abs(current.y - top) <= hit) || (Math.abs(current.x - left) <= hit && Math.abs(current.y - top - height) <= hit);
      setCursor(nwse ? 'nwse-resize' : nesw ? 'nesw-resize' : 'grab');
      return;
    }
    if (drag.action === 'move') {
      onPositionChange({ x: positionRef.current.x + current.x - drag.last.x, y: positionRef.current.y + current.y - drag.last.y });
    } else if (drag.action !== 'paint') {
      const directionX = drag.action.includes('e') ? 1 : -1;
      const directionY = drag.action.includes('s') ? 1 : -1;
      const bounds = boundsRef.current;
      if (bounds) {
        const nextX = Math.max(.03, drag.startScale.x * (1 + directionX * (current.x - drag.start.x) / Math.max(1, bounds.width)));
        const nextY = Math.max(.03, drag.startScale.y * (1 + directionY * (current.y - drag.start.y) / Math.max(1, bounds.height)));
        const uniform = Math.max(.03, (nextX + nextY) / 2);
        onScaleChange(aspectLocked ? { x: uniform, y: uniform } : { x: nextX, y: nextY });
      }
    } else if (mode === 'brush') {
      const context = paintRef.current?.getContext('2d');
      if (context) {
        context.strokeStyle = fillColor;
        context.lineWidth = brushSize * canvasRef.current!.width / Math.max(1, canvasRef.current!.getBoundingClientRect().width);
        context.lineCap = 'round';
        context.beginPath(); context.moveTo(drag.last.x, drag.last.y); context.lineTo(current.x, current.y); context.stroke();
        render();
      }
    } else if (drag.action === 'paint' && (mode === 'rect' || mode === 'ellipse')) {
      shapePreviewRef.current = { start: drag.start, current, mode };
      render();
    }
    drag.last = current;
  };
  const pointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const current = point(event);
    const context = paintRef.current?.getContext('2d');
    if (context && drag.action === 'paint' && (mode === 'rect' || mode === 'ellipse')) {
      context.fillStyle = fillColor;
      const width = current.x - drag.start.x;
      const height = current.y - drag.start.y;
      if (mode === 'rect') context.fillRect(drag.start.x, drag.start.y, width, height);
      else { context.beginPath(); context.ellipse(drag.start.x + width / 2, drag.start.y + height / 2, Math.abs(width / 2), Math.abs(height / 2), 0, 0, Math.PI * 2); context.fill(); }
    }
    shapePreviewRef.current = undefined;
    dragRef.current = undefined;
    setCursor(mode === 'move' ? 'grab' : 'crosshair');
    render(); exportComposite();
  };

  return <div className="cup-resize-canvas"><canvas ref={canvasRef} style={{ cursor }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /></div>;
}

export default function CupResizeComposer({ apiKey, openAiApiKey, apiBaseUrl, connectionMode, onRequestKey, onSessionStateChange, settingsHost }: {
  apiKey: string;
  openAiApiKey: string;
  apiBaseUrl: string | null;
  connectionMode: 'direct' | 'proxy';
  onRequestKey: () => void;
  onSessionStateChange?: (hasContent: boolean) => void;
  settingsHost?: HTMLElement | null;
}) {
  const { message } = AntApp.useApp();
  const [settings, setSettings] = useState<CupResizeSettings>(() => readLocalStorage(STORAGE_KEYS.cupResizeSettings, DEFAULT_CUP_RESIZE_SETTINGS as CupResizeSettings));
  const [scene, setScene] = useState<File>();
  const [cup, setCup] = useState<File>();
  const [sceneUrl, setSceneUrl] = useState<string>();
  const [cupUrl, setCupUrl] = useState<string>();
  const [cupScale, setCupScale] = useState<Scale>({ x: 0.35, y: 0.35 });
  const [aspectLocked, setAspectLocked] = useState(true);
  const [crop, setCrop] = useState<CropEdges>({ top: 0, right: 0, bottom: 0, left: 0 });
  const [fillColor, setFillColor] = useState('#ffffff');
  const [mode, setMode] = useState<ToolMode>('move');
  const [brushSize, setBrushSize] = useState(42);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [composite, setComposite] = useState<Blob>();
  const [compositeUrl, setCompositeUrl] = useState<string>();
  const [clearToken, setClearToken] = useState(0);
  const [undoToken, setUndoToken] = useState(0);
  const [redoToken, setRedoToken] = useState(0);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [instructionPrompt, setInstructionPrompt] = useState(() => readLocalStorage(STORAGE_KEYS.cupResizeInstruction, CUP_RESIZE_PROMPT));
  const [supplementalPrompt, setSupplementalPrompt] = useState(() => readLocalStorage(STORAGE_KEYS.cupResizePrompt, '给杯子倒上半杯酒'));
  const [result, setResult] = useState<{ blob: Blob; url: string; mimeType: string }>();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewOriginal, setPreviewOriginal] = useState(false);
  const [comparisonSource, setComparisonSource] = useState<'scene' | 'guide'>('scene');
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'failed'>('idle');
  const [error, setError] = useState<string>();
  const aborter = useRef<AbortController | undefined>(undefined);

  useEffect(() => localStorage.setItem(STORAGE_KEYS.cupResizeSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.cupResizeInstruction, JSON.stringify(instructionPrompt)), [instructionPrompt]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.cupResizePrompt, JSON.stringify(supplementalPrompt)), [supplementalPrompt]);
  useEffect(() => onSessionStateChange?.(Boolean(scene || cup || result)), [scene, cup, result, onSessionStateChange]);
  useEffect(() => reportTaskProgress({ id: 'cup-resize', label: '杯子大小精确调整', completed: status === 'success' || status === 'failed' ? 1 : 0, total: status === 'idle' ? 0 : 1, failed: status === 'failed' ? 1 : 0, running: status === 'running' }), [status]);
  useEffect(() => { if (!composite) return setCompositeUrl(undefined); const url = URL.createObjectURL(composite); setCompositeUrl(url); return () => URL.revokeObjectURL(url); }, [composite]);
  useEffect(() => () => { sceneUrl && URL.revokeObjectURL(sceneUrl); cupUrl && URL.revokeObjectURL(cupUrl); result?.url && URL.revokeObjectURL(result.url); }, []);

  const select = (kind: 'scene' | 'cup', file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type) || !file.size || file.size > 20 * 1024 * 1024) { message.error('仅支持不超过 20MB 的 PNG、JPEG 或 WebP 图片'); return false; }
    setResult(undefined); setStatus('idle'); setError(undefined);
    if (kind === 'scene') { sceneUrl && URL.revokeObjectURL(sceneUrl); setScene(file); setSceneUrl(URL.createObjectURL(file)); }
    else { cupUrl && URL.revokeObjectURL(cupUrl); setCup(file); setCupUrl(URL.createObjectURL(file)); setCrop({ top: 0, right: 0, bottom: 0, left: 0 }); }
    return false;
  };
  const patchSettings = (patch: Partial<CupResizeSettings>) => setSettings((current) => {
    const next = { ...current, ...patch };
    return patch.imageModel && !isOpenAiModel(patch.imageModel) ? { ...next, ...normalizeSettingsForModel(patch.imageModel, '1:1', next.imageSize) } : next;
  });
  const generate = async () => {
    const openAi = isOpenAiModel(settings.imageModel);
    if ((openAi && !openAiApiKey) || (!openAi && (!apiKey || (connectionMode === 'proxy' && !apiBaseUrl)))) { onRequestKey(); return void message.warning(openAi ? '请先配置 OpenAI API Key' : '请先配置 Gemini API Key'); }
    if (!scene || !cup || !composite) return void message.warning('请上传场景图和杯子白底图，并完成位置与大小调整');
    result?.url && URL.revokeObjectURL(result.url); setResult(undefined); setError(undefined); setStatus('running');
    const controller = new AbortController(); aborter.current = controller;
    try {
      const guideFile = new File([composite], 'cup-placement-guide.png', { type: 'image/png' });
      const generated = isOpenAiModel(settings.imageModel)
        ? await generateCupResizeOpenAi({ apiKey: openAiApiKey, model: settings.imageModel, compositeGuide: guideFile, prompt: `${instructionPrompt.trim() || CUP_RESIZE_PROMPT}${supplementalPrompt.trim() ? `\n用户补充要求：${supplementalPrompt.trim()}` : ''}`, quality: settings.imageQuality, signal: controller.signal })
        : await generateCupResizeImage({ apiKey, apiBaseUrl, model: settings.imageModel, compositeGuide: composite, prompt: instructionPrompt.trim() || CUP_RESIZE_PROMPT, supplementalPrompt, imageSize: settings.imageSize, signal: controller.signal });
      setResult({ blob: generated.blob, url: URL.createObjectURL(generated.blob), mimeType: generated.mimeType }); setStatus('success');
    } catch (reason) {
      if (controller.signal.aborted) setStatus('idle');
      else { setStatus('failed'); setError(reason instanceof Error ? reason.message : '生成失败'); }
    } finally { aborter.current = undefined; }
  };
  const clearAll = () => {
    aborter.current?.abort(); sceneUrl && URL.revokeObjectURL(sceneUrl); cupUrl && URL.revokeObjectURL(cupUrl); result?.url && URL.revokeObjectURL(result.url);
    setScene(undefined); setCup(undefined); setSceneUrl(undefined); setCupUrl(undefined); setComposite(undefined); setResult(undefined); setStatus('idle'); setError(undefined);
  };
  const resultName = useMemo(() => `${sanitizeFileName(scene?.name || '杯子大小调整')}_cup-resized.${mimeExtension(result?.mimeType)}`, [scene?.name, result?.mimeType]);
  const comparisonUrl = comparisonSource === 'scene' ? sceneUrl : compositeUrl;
  const comparisonLabel = comparisonSource === 'scene' ? '上传原图' : '指导图';
  const setScaleAxis = (axis: keyof Scale, value: number) => setCupScale((current) => aspectLocked ? { x: value, y: value } : { ...current, [axis]: value });
  const setCropEdge = (edge: keyof CropEdges, value: number) => setCrop((current) => ({ ...current, [edge]: value }));
  const scaleControls = <div className="cup-resize-control-stack">
    <Flex justify="space-between" align="center"><Text strong>杯子缩放</Text><Space size={6}><Text type="secondary">锁定比例</Text><Switch size="small" checked={aspectLocked} checkedChildren={<LockOutlined />} unCheckedChildren={<UnlockOutlined />} onChange={setAspectLocked} /></Space></Flex>
    <div><Flex justify="space-between"><Text>宽度</Text><InputNumber size="small" min={3} max={300} value={Math.round(cupScale.x * 100)} addonAfter="%" onChange={(value) => setScaleAxis('x', (value || 3) / 100)} /></Flex><Slider min={.03} max={3} step={.01} value={cupScale.x} onChange={(value) => setScaleAxis('x', value)} /></div>
    <div><Flex justify="space-between"><Text>高度</Text><InputNumber size="small" min={3} max={300} value={Math.round(cupScale.y * 100)} addonAfter="%" onChange={(value) => setScaleAxis('y', (value || 3) / 100)} disabled={aspectLocked} /></Flex><Slider min={.03} max={3} step={.01} value={cupScale.y} onChange={(value) => setScaleAxis('y', value)} disabled={aspectLocked} /></div>
  </div>;
  const cropControls = <div className="cup-resize-control-stack"><Text strong>白底画布四边裁切</Text><Text type="secondary">正数裁切，负数向外扩展并填充识别到的底色</Text><div className="cup-crop-grid">{(['top', 'right', 'bottom', 'left'] as const).map((edge) => <div className="cup-crop-edge-control" key={edge}><Flex align="center" justify="space-between" gap={6}><Text>{{ top: '上', right: '右', bottom: '下', left: '左' }[edge]}</Text><InputNumber size="small" min={-100} max={45} value={crop[edge]} addonAfter="%" onChange={(value) => setCropEdge(edge, value || 0)} /></Flex><Slider min={-100} max={45} value={crop[edge]} onChange={(value) => setCropEdge(edge, value)} /></div>)}</div></div>;
  const settingsPanel = <div className="settings-panel"><Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>融合设置</Title><Tag color="blue">精确尺寸</Tag></Flex><Divider /><Form layout="vertical"><Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={MODEL_OPTIONS} /></Form.Item>{isOpenAiModel(settings.imageModel) ? <Form.Item label="生成质量"><Segmented block value={settings.imageQuality} onChange={(imageQuality) => patchSettings({ imageQuality: imageQuality as CupResizeSettings['imageQuality'] })} options={[{ value: 'low', label: '低' }, { value: 'medium', label: '中' }, { value: 'high', label: '高' }]} /></Form.Item> : <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as CupResizeSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item>}</Form><Divider titlePlacement="start">杯子位置</Divider><Flex gap={8}><InputNumber addonBefore="X" value={Math.round(position.x)} onChange={(value) => setPosition((current) => ({ ...current, x: value || 0 }))} style={{ width: '50%' }} /><InputNumber addonBefore="Y" value={Math.round(position.y)} onChange={(value) => setPosition((current) => ({ ...current, y: value || 0 }))} style={{ width: '50%' }} /></Flex><Divider titlePlacement="start">图层调整</Divider>{scaleControls}<Divider />{cropControls}<Divider titlePlacement="start">画笔参数</Divider><div className="cup-resize-control"><Flex justify="space-between"><Text>画笔大小</Text><Text>{brushSize}px</Text></Flex><Slider min={6} max={180} value={brushSize} onChange={setBrushSize} /></div><Divider titlePlacement="start">核心提示词</Divider><Flex justify="space-between" align="center" style={{ marginBottom: 8 }}><Text type="secondary">可自定义 AI 融合规则；留空时使用默认提示词。</Text><Button size="small" onClick={() => setInstructionPrompt(CUP_RESIZE_PROMPT)}>恢复默认</Button></Flex><Input.TextArea value={instructionPrompt} onChange={(event) => setInstructionPrompt(event.target.value)} placeholder="输入杯子尺寸与场景融合的核心提示词" autoSize={{ minRows: 6, maxRows: 16 }} maxLength={6000} showCount /><Divider titlePlacement="start">补充提示词</Divider><Input.TextArea value={supplementalPrompt} onChange={(event) => setSupplementalPrompt(event.target.value)} placeholder="可留空；例如：给杯子倒上半杯酒" autoSize={{ minRows: 3, maxRows: 8 }} maxLength={1000} showCount /><Text type="secondary">留空时只执行杯子与场景的自然融合。</Text><Divider /><Alert type="info" showIcon title="涂抹范围不决定杯子大小" description="杯子的最终宽高和位置严格来自指导合成图；涂抹区域只用于恢复旧杯子后方的场景。" /></div>;

  return <div className="cup-resize-page">
    <section className="hero-strip cup-resize-hero"><div><Text className="eyebrow">PRECISION CUP PLACEMENT</Text><Title level={2}>精确调整场景里的杯子大小</Title><Paragraph className="hero-description">先按像素确定杯子的位置、尺寸和白底画布，再让 AI 只完成自然融合。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><FileImageOutlined /><span>上传场景图与杯子白底图</span></Space>} extra={<Button type="text" danger disabled={!scene && !cup} onClick={clearAll}>清空</Button>}>
      <div className="cup-resize-upload-grid">{(['scene', 'cup'] as const).map((kind) => { const file = kind === 'scene' ? scene : cup; const url = kind === 'scene' ? sceneUrl : cupUrl; return <div key={kind}><Text strong>{kind === 'scene' ? '场景图' : '杯子白底图'}</Text>{url ? <div className="cup-resize-upload-preview"><Image src={url} preview /><Upload accept={ACCEPTED_TYPES.join(',')} showUploadList={false} beforeUpload={(next) => select(kind, next)}><Button>更换图片</Button></Upload><Text type="secondary" ellipsis={{ tooltip: file?.name }}>{file?.name}</Text></div> : <Dragger accept={ACCEPTED_TYPES.join(',')} multiple={false} showUploadList={false} beforeUpload={(next) => select(kind, next)}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">上传{kind === 'scene' ? '场景图' : '杯子白底图'}</p></Dragger>}</div>; })}</div>
    </Card>
    {sceneUrl && cupUrl && <Card className="workflow-card" title={<Space><EditOutlined /><span>编辑指导合成图</span></Space>} extra={compositeUrl ? <Image width={44} height={44} src={compositeUrl} preview={{ mask: '预览' }} /> : null}>
      <Alert type="warning" showIcon title="先涂抹挡住原杯子，再切换移动工具放置新杯子" description="杯子白底图始终位于最上层；画布放大超过原图时会用自动识别的底色填充。" style={{ marginBottom: 14 }} />
      <div className="cup-resize-canvas-workspace"><Flex className="cup-resize-canvas-toolbar" gap={8} align="center" wrap><Radio.Group className="cup-resize-tool-modes" value={mode} onChange={(event) => setMode(event.target.value)} optionType="button" buttonStyle="solid"><Radio.Button value="move"><DragOutlined /> 移动杯子</Radio.Button><Radio.Button value="brush"><HighlightOutlined /> 画笔</Radio.Button><Radio.Button value="rect">矩形填充</Radio.Button><Radio.Button value="ellipse">椭圆填充</Radio.Button></Radio.Group><Divider orientation="vertical" /><Text>填充色</Text><input aria-label="填充色" type="color" value={fillColor} onChange={(event) => setFillColor(event.target.value)} /><code>{fillColor}</code><Button onClick={() => setClearToken((value) => value + 1)} icon={<ClearOutlined />}>清除涂抹</Button><Button aria-label="撤销涂抹" disabled={!historyState.undo} onClick={() => setUndoToken((value) => value + 1)} icon={<UndoOutlined />}>撤销</Button><Button aria-label="重做涂抹" disabled={!historyState.redo} onClick={() => setRedoToken((value) => value + 1)} icon={<RedoOutlined />}>重做</Button></Flex><CupPlacementCanvas sceneUrl={sceneUrl} cupUrl={cupUrl} cupScale={cupScale} crop={crop} aspectLocked={aspectLocked} fillColor={fillColor} mode={mode} brushSize={brushSize} position={position} onPositionChange={setPosition} onScaleChange={setCupScale} onDetectedColor={setFillColor} onCompositeChange={setComposite} clearToken={clearToken} undoToken={undoToken} redoToken={redoToken} onHistoryChange={(undo, redo) => setHistoryState({ undo, redo })} /></div>
    </Card>}
    <Card className="action-card"><Flex justify="space-between" align="center" gap={12} wrap><div><Title level={4} style={{ margin: 0 }}>生成自然融合结果</Title><Text type="secondary">严格锁定指导图中的杯子位置、大小与轮廓</Text></div><Space>{status === 'running' && <Button danger icon={<StopOutlined />} onClick={() => aborter.current?.abort()}>停止</Button>}<Button size="large" type="primary" icon={<RocketOutlined />} loading={status === 'running'} onClick={() => void generate()}>开始融合</Button></Space></Flex>{status === 'running' && <GeneratingImage progressKey="cup-resize-current" status="running" percent={1} />}{error && <Alert style={{ marginTop: 14 }} type="error" showIcon title="融合失败" description={error} />}</Card>
    <Card className="workflow-card" title="生成结果" extra={result ? <Space wrap><Text type="secondary">对比基准</Text><Segmented size="small" value={comparisonSource} onChange={(value) => setComparisonSource(value as 'scene' | 'guide')} options={[{ value: 'scene', label: '上传原图' }, { value: 'guide', label: '指导图' }]} /><Button icon={<EyeOutlined />} onClick={() => { setPreviewOriginal(false); setPreviewOpen(true); }}>放大查看</Button><Button type="primary" icon={<DownloadOutlined />} onClick={() => downloadBlob(result.blob, resultName)}>下载图片</Button></Space> : null}>{result && comparisonUrl ? <><CurtainCompare before={comparisonUrl} beforeLabel={comparisonLabel} after={result.url} /><Image className="cup-result-preview-source" src={result.url} preview={{ visible: previewOpen, onVisibleChange: (visible) => { setPreviewOpen(visible); if (!visible) setPreviewOriginal(false); }, actionsRender: (originalNode) => <>{originalNode}<Tooltip title={previewOriginal ? '查看生成图' : `查看${comparisonLabel}`}><button type="button" className={previewOriginal ? 'scene-preview-compare-action is-active' : 'scene-preview-compare-action'} onClick={() => setPreviewOriginal((current) => !current)}><EyeOutlined /></button></Tooltip></>, imageRender: (originalNode) => previewOriginal ? cloneElement(originalNode as ReactElement<{ src?: string; alt?: string }>, { src: comparisonUrl, alt: comparisonLabel }) : originalNode }} /></> : <div className="inpaint-empty-result"><Text type="secondary">AI 融合结果会显示在这里</Text></div>}</Card>
    {!settingsHost && <aside className="logo-settings">{settingsPanel}</aside>}{settingsHost && createPortal(settingsPanel, settingsHost)}
  </div>;
}
