import {
  ClearOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EyeOutlined,
  FileImageOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  ColorPicker,
  Empty,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Radio,
  Segmented,
  Select,
  Space,
  Statistic,
  Switch,
  Tag,
  Typography,
  Upload,
} from 'antd';
import JSZip from 'jszip';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DEFAULT_LOGO_REPLACE_SETTINGS, MODEL_CAPABILITIES, PRICING, STORAGE_KEYS } from './constants';
import GeneratingImage from './GeneratingImage';
import { buildLogoReplacementInstruction, generateLogoReplacement } from './services/gemini';
import { assignReplacementLogos, buildLogoReplaceTasks } from './services/logoReplaceUtils';
import { readLocalStorage } from './storage';
import type { LogoAsset, LogoReplaceSettings, LogoReplaceTask } from './types';
import { createId, downloadBlob, estimateImageCost, mimeExtension, normalizeSettingsForModel, sanitizeFileName } from './utils';

const { Text, Title, Paragraph } = Typography;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

function statusText(status: LogoReplaceTask['status']) {
  if (status === 'waiting') return '排队中';
  if (status === 'running') return '生成中';
  if (status === 'success') return '替换成功';
  if (status === 'failed') return '替换失败';
  return '已停止';
}

function fileName(task: LogoReplaceTask, scene: LogoAsset, model: string) {
  return `${String(task.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(scene.name)}_${String(task.copyIndex + 1).padStart(2, '0')}_${model}.${mimeExtension(task.resultMimeType)}`;
}

export default function LogoReplaceComposer({
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
  const [settings, setSettings] = useState<LogoReplaceSettings>(() => {
    const stored = readLocalStorage(STORAGE_KEYS.logoReplaceSettings, {} as Partial<LogoReplaceSettings> & { logoEffect?: string });
    const legacyEffect = (stored as { logoEffect?: string }).logoEffect;
    const glassEngravingEnabled = stored.glassEngravingEnabled ?? (!legacyEffect || legacyEffect === 'glass-engrave' || legacyEffect === 'laser-engrave');
    const woodEngravingEnabled = stored.woodEngravingEnabled ?? (legacyEffect === 'wood-engrave' || legacyEffect === 'deboss' || legacyEffect === 'emboss');
    const customEngravingEnabled = stored.customEngravingEnabled ?? legacyEffect === 'custom-engrave';
    return { ...(DEFAULT_LOGO_REPLACE_SETTINGS as LogoReplaceSettings), ...stored, glassEngravingEnabled, woodEngravingEnabled, customEngravingEnabled };
  });  const [scenes, setScenes] = useState<LogoAsset[]>([]);
  const [oldLogo, setOldLogo] = useState<LogoAsset>();
  const [newLogos, setNewLogos] = useState<LogoAsset[]>([]);
  const [randomSeed, setRandomSeed] = useState(() => createId());
  const [manualLogoAssignments, setManualLogoAssignments] = useState<Record<string, string>>({});
  const [compareOriginalIds, setCompareOriginalIds] = useState<Set<string>>(() => new Set());
  const [tasks, setTasks] = useState<LogoReplaceTask[]>([]);
  const runningIds = useRef(new Set<string>());
  const aborters = useRef(new Map<string, AbortController>());
  const scenesRef = useRef(scenes);
  const oldLogoRef = useRef(oldLogo);
  const newLogosRef = useRef(newLogos);
  const settingsRef = useRef(settings);

  useEffect(() => { scenesRef.current = scenes; }, [scenes]);
  useEffect(() => { oldLogoRef.current = oldLogo; }, [oldLogo]);
  useEffect(() => { newLogosRef.current = newLogos; }, [newLogos]);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  useEffect(() => localStorage.setItem(STORAGE_KEYS.logoReplaceSettings, JSON.stringify(settings)), [settings]);
  useEffect(() => onSessionStateChange?.(Boolean(scenes.length || oldLogo || newLogos.length || tasks.length)), [scenes.length, oldLogo, newLogos.length, tasks.length, onSessionStateChange]);

  const validateFile = (file: File) => {
    if (!ACCEPTED_TYPES.includes(file.type)) return void message.error(`${file.name}：仅支持 PNG、JPEG、WebP`);
    if (!file.size || file.size > MAX_IMAGE_SIZE) return void message.error(`${file.name}：文件需小于 20MB 且不能为空`);
    return true;
  };
  const makeAsset = (file: File): LogoAsset => ({ id: createId(), file, name: file.name, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
  const resetTasks = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => {
      current.forEach((task) => task.resultUrl && URL.revokeObjectURL(task.resultUrl));
      return [];
    });
    setCompareOriginalIds(new Set());
  };
  const addScenes = (files: File[]) => {
    const assets = files.filter((file) => validateFile(file) === true).map(makeAsset);
    if (assets.length) {
      resetTasks();
      setScenes((current) => [...current, ...assets]);
    }
    return false;
  };
  const removeScene = (id: string) => {
    resetTasks();
    setScenes((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };
  const setOldLogoAsset = (file: File) => {
    if (validateFile(file) !== true) return false;
    resetTasks();
    const next = makeAsset(file);
    setOldLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return next; });
    return false;
  };
  const clearOldLogo = () => {
    resetTasks();
    setOldLogo((current) => { if (current) URL.revokeObjectURL(current.previewUrl); return undefined; });
  };
  const addNewLogos = (files: File[]) => {
    const assets = files.filter((file) => validateFile(file) === true).map(makeAsset);
    if (assets.length) {
      resetTasks();
      setNewLogos((current) => [...current, ...assets]);
    }
    return false;
  };
  const removeNewLogo = (id: string) => {
    resetTasks();
    setManualLogoAssignments((current) => Object.fromEntries(Object.entries(current).filter(([, logoId]) => logoId !== id)));
    setNewLogos((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };
  const patchSettings = (patch: Partial<LogoReplaceSettings>) => setSettings((current) => {
    const next = { ...current, ...patch };
    if (patch.imageModel) return { ...next, ...normalizeSettingsForModel(patch.imageModel, next.aspectRatio, next.imageSize) };
    return next;
  });

  const defaultReplacementPrompt = useMemo(() => buildLogoReplacementInstruction({
    hasOldLogo: Boolean(oldLogo),
    logoColorMode: settings.logoColorMode,
    customLogoColor: settings.customLogoColor,
    glassEngravingEnabled: settings.glassEngravingEnabled,
    woodEngravingEnabled: settings.woodEngravingEnabled,
    customEngravingEnabled: settings.customEngravingEnabled,
    woodEngravingStyle: settings.woodEngravingStyle,
    customWoodEngravingMethod: settings.customWoodEngravingMethod,
    customEngravingObject: settings.customEngravingObject,
    engravingMethod: settings.engravingMethod,
  }), [oldLogo, settings.logoColorMode, settings.customLogoColor, settings.glassEngravingEnabled, settings.woodEngravingEnabled, settings.customEngravingEnabled, settings.woodEngravingStyle, settings.customWoodEngravingMethod, settings.customEngravingObject, settings.engravingMethod]);
  const pairings = useMemo(
    () => assignReplacementLogos(scenes, newLogos, settings.randomAssignLogos, randomSeed, manualLogoAssignments),
    [scenes, newLogos, settings.randomAssignLogos, randomSeed, manualLogoAssignments],
  );

  const executeTask = useCallback(async (task: LogoReplaceTask) => {
    if (runningIds.current.has(task.id)) return;
    const scene = scenesRef.current.find((item) => item.id === task.sceneId);
    const replacement = newLogosRef.current.find((item) => item.id === task.newLogoId);
    if (!scene || !replacement) return;
    runningIds.current.add(task.id);
    const controller = new AbortController();
    aborters.current.set(task.id, controller);
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'running', error: undefined } : item));
    try {
      const currentSettings = settingsRef.current;
      const result = await generateLogoReplacement({
        apiKey,
        model: currentSettings.imageModel,
        scene: scene.file,
        oldLogo: oldLogoRef.current?.file,
        newLogo: replacement.file,
        logoColorMode: currentSettings.logoColorMode,
        customLogoColor: currentSettings.customLogoColor,
        promptOverride: currentSettings.customizeReplacementPrompt && currentSettings.replacementPrompt.trim()
          ? currentSettings.replacementPrompt.trim()
          : buildLogoReplacementInstruction({ hasOldLogo: Boolean(oldLogoRef.current), logoColorMode: currentSettings.logoColorMode, customLogoColor: currentSettings.customLogoColor, glassEngravingEnabled: currentSettings.glassEngravingEnabled, woodEngravingEnabled: currentSettings.woodEngravingEnabled, customEngravingEnabled: currentSettings.customEngravingEnabled, woodEngravingStyle: currentSettings.woodEngravingStyle, customWoodEngravingMethod: currentSettings.customWoodEngravingMethod, customEngravingObject: currentSettings.customEngravingObject, engravingMethod: currentSettings.engravingMethod }),
        aspectRatio: currentSettings.ratioMode === 'fixed' ? currentSettings.aspectRatio : undefined,
        imageSize: currentSettings.imageSize,
        signal: controller.signal,
        apiBaseUrl,
      });
      const resultUrl = URL.createObjectURL(result.blob);
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: 'success', resultBlob: result.blob, resultUrl, resultMimeType: result.mimeType } : item));
    } catch (error) {
      const stopped = controller.signal.aborted;
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, status: stopped ? 'stopped' : 'failed', error: stopped ? '任务已停止' : error instanceof Error ? error.message : 'Logo 替换失败' } : item));
    } finally {
      runningIds.current.delete(task.id);
      aborters.current.delete(task.id);
    }
  }, [apiKey, apiBaseUrl]);

  useEffect(() => {
    const available = Math.max(0, settings.concurrency - runningIds.current.size);
    tasks.filter((task) => task.status === 'waiting' && !runningIds.current.has(task.id)).slice(0, available).forEach((task) => void executeTask(task));
  }, [tasks, settings.concurrency, executeTask]);

  const start = () => {
    if (!apiKey) return onRequestKey();
    if (connectionMode === 'proxy' && !apiBaseUrl) { message.warning('请先配置代理地址'); return onRequestKey(); }
    if (!scenes.length) return void message.warning('请至少上传一张已贴 Logo 的场景图');
    if (!newLogos.length) return void message.warning('请至少上传一个新 Logo');
    if (pairings.some((pairing) => !pairing.logo)) return void message.warning('存在尚未匹配新 Logo 的场景图');
    resetTasks();
    setCompareOriginalIds(new Set());
    setTasks(buildLogoReplaceTasks(pairings, settings.copiesPerScene));
  };
  const stop = () => {
    aborters.current.forEach((controller) => controller.abort());
    setTasks((current) => current.map((task) => task.status === 'waiting' ? { ...task, status: 'stopped' } : task));
  };
  const retry = (id: string) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const next = { ...task, status: 'running' as const, error: undefined, retryCount: task.retryCount + 1 };
    setTasks((current) => current.map((item) => item.id === id ? next : item));
    void executeTask(next);
  };
  const clearResults = () => resetTasks();
  const successful = tasks.filter((task) => task.status === 'success' && task.resultBlob);
  const processing = tasks.some((task) => task.status === 'waiting' || task.status === 'running');
  const completed = tasks.filter((task) => ['success', 'failed', 'stopped'].includes(task.status)).length;
  const taskCount = scenes.length * settings.copiesPerScene;
  const groups = useMemo(() => scenes.map((scene) => ({ scene, tasks: tasks.filter((task) => task.sceneId === scene.id) })).filter((group) => group.tasks.length), [scenes, tasks]);
  const downloadTask = (task: LogoReplaceTask) => {
    const scene = scenes.find((item) => item.id === task.sceneId);
    if (scene && task.resultBlob) downloadBlob(task.resultBlob, fileName(task, scene, settings.imageModel));
  };
  const downloadAll = async () => {
    const zip = new JSZip();
    groups.forEach((group) => {
      const target = settings.copiesPerScene > 1 ? zip.folder(`${String(group.tasks[0]?.sceneIndex + 1).padStart(2, '0')}_${sanitizeFileName(group.scene.name)}`)! : zip;
      group.tasks.forEach((task) => { if (task.resultBlob) target.file(fileName(task, group.scene, settings.imageModel), task.resultBlob); });
    });
    downloadBlob(await zip.generateAsync({ type: 'blob' }), 'SceneStudio_Logo替换结果.zip');
  };

  const settingsPanel = (
    <div className="settings-panel logo-replace-settings-panel">
      <Flex justify="space-between"><Title level={4} style={{ margin: 0 }}>替换设置</Title><Tag color="cyan">REPLACE</Tag></Flex>
      <Form layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item label="Logo 分配方式">
          <Flex justify="space-between" align="center"><Text>随机分配新 Logo</Text><Switch checked={settings.randomAssignLogos} onChange={(randomAssignLogos) => { patchSettings({ randomAssignLogos }); resetTasks(); }} /></Flex>
          <Text type="secondary" className="field-help">关闭时场景图与新 Logo 必须数量一致并按顺序配对；开启后允许数量不同。</Text>
        </Form.Item>
        <Form.Item label="新 Logo 颜色">
          <Select value={settings.logoColorMode} onChange={(logoColorMode) => patchSettings({ logoColorMode })} options={[
            { value: 'original', label: '保持原色' }, { value: 'white', label: '白色' }, { value: 'black', label: '黑色' }, { value: 'custom', label: '自定义颜色' },
          ]} />
          {settings.logoColorMode === 'custom' && <Flex gap={8} align="center" style={{ marginTop: 10 }}><ColorPicker value={settings.customLogoColor} onChange={(_, hex) => patchSettings({ customLogoColor: hex })} /><Text code>{settings.customLogoColor}</Text></Flex>}
        </Form.Item>
        <Form.Item label="玻璃 Logo 工艺">
          <Flex justify="space-between" align="center"><Text>玻璃激光磨砂雕刻</Text><Switch checked={settings.glassEngravingEnabled} onChange={(glassEngravingEnabled) => patchSettings({ glassEngravingEnabled })} /></Flex>
          <Text type="secondary" className="field-help">默认开启。仅在 Logo 位于玻璃载体时生效，呈半透明乳白或雾化蚀刻质感，并保留透光、折射和曲面效果。</Text>
        </Form.Item>
        <Form.Item label="木盒 Logo 工艺">
          <Flex justify="space-between" align="center"><Text>启用木盒独立雕刻</Text><Switch checked={settings.woodEngravingEnabled} onChange={(woodEngravingEnabled) => patchSettings({ woodEngravingEnabled })} /></Flex>
          {settings.woodEngravingEnabled && <>
            <Select style={{ marginTop: 10 }} value={settings.woodEngravingStyle} onChange={(woodEngravingStyle) => patchSettings({ woodEngravingStyle })} options={[
              { value: 'dark-burn', label: '深色激光烧蚀（深黑高对比）' },
              { value: 'natural-recessed', label: '原木浅雕 / 凹刻（同色低对比）' },
              { value: 'custom', label: '自定义木盒雕刻方式' },
            ]} />
            {settings.woodEngravingStyle === 'dark-burn' && <Text type="secondary" className="field-help">图案呈深棕至黑色，边缘清晰，同时保留木纹和自然焦痕。</Text>}
            {settings.woodEngravingStyle === 'natural-recessed' && <Text type="secondary" className="field-help">不做黑色填充，通过浅凹槽、切削纹理和自然阴影显示 Logo。</Text>}
            {settings.woodEngravingStyle === 'custom' && <Input.TextArea style={{ marginTop: 10 }} value={settings.customWoodEngravingMethod} placeholder="输入木盒雕刻方式、深浅、颜色和表面效果" autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => patchSettings({ customWoodEngravingMethod: event.target.value })} />}
          </>}
        </Form.Item>
        <Form.Item label="自定义物体 Logo 工艺">
          <Flex justify="space-between" align="center"><Text>启用自定义载体雕刻</Text><Switch checked={settings.customEngravingEnabled} onChange={(customEngravingEnabled) => patchSettings({ customEngravingEnabled })} /></Flex>
          {settings.customEngravingEnabled && <>
            <Input style={{ marginTop: 10 }} value={settings.customEngravingObject} placeholder="输入雕刻载体，例如：深蓝色皮革盒" onChange={(event) => patchSettings({ customEngravingObject: event.target.value })} />
            <Input.TextArea style={{ marginTop: 10 }} value={settings.engravingMethod} placeholder="输入具体雕刻方式、颜色、深浅和材质效果" autoSize={{ minRows: 2, maxRows: 4 }} onChange={(event) => patchSettings({ engravingMethod: event.target.value })} />
          </>}
        </Form.Item>        <Form.Item label="替换提示词">
          <Flex justify="space-between" align="center" style={{ marginBottom: 8 }}>
            <Text>自定义编辑</Text>
            <Switch checked={settings.customizeReplacementPrompt} onChange={(customizeReplacementPrompt) => patchSettings({ customizeReplacementPrompt, replacementPrompt: customizeReplacementPrompt ? (settings.replacementPrompt.trim() || defaultReplacementPrompt) : settings.replacementPrompt })} />
          </Flex>
          <Input.TextArea value={settings.customizeReplacementPrompt ? settings.replacementPrompt : defaultReplacementPrompt} readOnly={!settings.customizeReplacementPrompt} autoSize={{ minRows: 6, maxRows: 12 }} onChange={(event) => patchSettings({ replacementPrompt: event.target.value })} />
          <Flex justify="space-between" align="center" gap={8} style={{ marginTop: 8 }}><Text type="secondary" className="field-help">这里显示的完整提示词就是实际发送给模型的文本。</Text>{settings.customizeReplacementPrompt && <Button size="small" onClick={() => patchSettings({ replacementPrompt: defaultReplacementPrompt })}>恢复默认</Button>}</Flex>
          <Text type="secondary" className="field-help">图片按“场景图、可选旧 Logo、新 Logo”的顺序作为独立图片内容提交。</Text>
        </Form.Item>
        <Form.Item label="图片模型"><Select value={settings.imageModel} onChange={(imageModel) => patchSettings({ imageModel })} options={Object.entries(MODEL_CAPABILITIES).map(([value, item]) => ({ value, label: item.label }))} /></Form.Item>
        <Form.Item label="画面比例">
          <Radio.Group value={settings.ratioMode} onChange={(event) => patchSettings({ ratioMode: event.target.value })}><Radio value="original">跟随场景原图</Radio><Radio value="fixed">指定比例</Radio></Radio.Group>
          {settings.ratioMode === 'fixed' && <Select style={{ marginTop: 10 }} value={settings.aspectRatio} onChange={(aspectRatio) => patchSettings({ aspectRatio })} options={MODEL_CAPABILITIES[settings.imageModel].aspectRatios.map((value) => ({ value, label: value }))} />}
        </Form.Item>
        <Form.Item label="输出分辨率"><Segmented block value={settings.imageSize} onChange={(imageSize) => patchSettings({ imageSize: imageSize as LogoReplaceSettings['imageSize'] })} options={MODEL_CAPABILITIES[settings.imageModel].imageSizes} /></Form.Item>
        <Form.Item label="每张场景生成张数"><InputNumber min={1} max={8} value={settings.copiesPerScene} onChange={(copiesPerScene) => patchSettings({ copiesPerScene: copiesPerScene || 1 })} style={{ width: '100%' }} /></Form.Item>
        <Form.Item label="并发任务数"><InputNumber min={1} max={6} value={settings.concurrency} onChange={(concurrency) => patchSettings({ concurrency: concurrency || 1 })} style={{ width: '100%' }} /></Form.Item>
      </Form>
      <Card className="price-card" variant="borderless"><Statistic title="预计价格" prefix="$" precision={3} value={estimateImageCost(settings.imageModel, settings.imageSize, taskCount) + taskCount * PRICING.models[settings.imageModel].inputImage * (oldLogo ? 2 : 1)} /><Text type="secondary">按 {taskCount} 个请求与 {oldLogo ? 3 : 2} 张输入参考图估算。</Text></Card>
    </div>
  );

  const oldLogoCard = (
    <div className="replace-logo-slot">
      {oldLogo ? <><Image src={oldLogo.previewUrl} alt="旧 Logo" /><Space><Upload showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => setOldLogoAsset(file as File)}><Button size="small" icon={<ReloadOutlined />}>替换</Button></Upload><Button size="small" danger icon={<DeleteOutlined />} onClick={clearOldLogo}>删除</Button></Space></> : <Upload.Dragger showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => setOldLogoAsset(file as File)}><p className="ant-upload-drag-icon"><PlusOutlined /></p><p className="ant-upload-text">上传旧 Logo（选填）</p><p className="ant-upload-hint">PNG / JPEG / WebP</p></Upload.Dragger>}
    </div>
  );
  return (
    <div className="logo-replace-page">
      <section className="hero-strip logo-replace-hero"><div><Text className="eyebrow">LOGO REPLACER</Text><Title level={2}>批量替换场景中的品牌 Logo</Title><Paragraph className="hero-description">识别场景中的旧 Logo 并替换为新 Logo，其他内容严格保持不变。</Paragraph></div><div className="hero-orb" /></section>
      <Card className="workflow-card" title={<Space><span className="step-badge">1</span><span>上传已贴 Logo 的场景图</span></Space>} extra={<Text type="secondary">{scenes.length} 张</Text>}>
        {!scenes.length && <Upload.Dragger multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><p className="ant-upload-drag-icon"><FileImageOutlined /></p><p className="ant-upload-text">拖拽、点击或粘贴场景图</p><p className="ant-upload-hint">支持多张 PNG / JPEG / WebP，单张不超过 20MB</p></Upload.Dragger>}
        {!!scenes.length && <Image.PreviewGroup><div className="replace-scene-grid">{scenes.map((scene) => <div className="replace-scene-card" key={scene.id}><Image src={scene.previewUrl} alt={scene.name} preview={{ mask: <EyeOutlined /> }} /><Button type="text" danger block icon={<DeleteOutlined />} onClick={() => removeScene(scene.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addScenes([file as File])}><button type="button" className="scene-product-add"><PlusOutlined /><span>继续添加图片</span></button></Upload></div></Image.PreviewGroup>}
      </Card>
      <Card className="workflow-card" title={<Space><span className="step-badge">2</span><span>设置旧 Logo 与新 Logo</span></Space>}>
        <Alert type="info" showIcon title="旧 Logo 可不上传" description="上传旧 Logo 能帮助 AI 更准确识别需要替换的标识；新 Logo 必须上传。" style={{ marginBottom: 16 }} />
        <div className="replace-logo-grid">
          <Card size="small" title="旧 Logo（选填）">{oldLogoCard}</Card>
          <div className="replace-arrow"><SwapOutlined /></div>
          <Card size="small" title="新 Logo（可多选）">
            {!newLogos.length ? <Upload.Dragger multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addNewLogos([file as File])}><p className="ant-upload-drag-icon"><PlusOutlined /></p><p className="ant-upload-text">上传一个或多个新 Logo</p><p className="ant-upload-hint">PNG / JPEG / WebP</p></Upload.Dragger> : <Image.PreviewGroup><div className="replace-new-logo-grid">{newLogos.map((logo) => <div className="replace-new-logo-card" key={logo.id}><Image src={logo.previewUrl} alt="新 Logo" /><Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => removeNewLogo(logo.id)}>删除</Button></div>)}<Upload multiple showUploadList={false} accept={ACCEPTED_TYPES.join(',')} beforeUpload={(file) => addNewLogos([file as File])}><button type="button" className="replace-logo-add"><PlusOutlined /><span>添加 Logo</span></button></Upload></div></Image.PreviewGroup>}
          </Card>
        </div>
        {!!scenes.length && !!newLogos.length && <Card size="small" className="replace-pair-preview" title="场景与新 Logo 配对预览" extra={settings.randomAssignLogos && <Button size="small" icon={<ReloadOutlined />} onClick={() => { setRandomSeed(createId()); resetTasks(); }}>重新随机</Button>}>
          {pairings.some((pairing) => !pairing.logo) && <Alert type="error" showIcon title="存在未匹配场景" description="请为未匹配的场景手动指定一个新 Logo，或开启随机分配。" style={{ marginBottom: 12 }} />}
          <div className="replace-pair-preview-grid">{pairings.map(({ scene, logo }, index) => <div className="replace-pair-preview-item" key={scene.id}><Image src={scene.previewUrl} alt={`场景 ${index + 1}`} /><SwapOutlined /><div className="pair-logo-box">{logo ? <Image src={logo.previewUrl} alt={`新 Logo ${index + 1}`} /> : <Text type="danger">未匹配</Text>}</div><Text type="secondary">第 {index + 1} 组</Text><Select aria-label={`手动指定第 ${index + 1} 组 Logo`} value={manualLogoAssignments[scene.id] || ''} onChange={(logoId) => { setManualLogoAssignments((current) => { const next = { ...current }; if (logoId) next[scene.id] = logoId; else delete next[scene.id]; return next; }); resetTasks(); }} options={[{ value: '', label: '跟随自动分配' }, ...newLogos.map((item, logoIndex) => ({ value: item.id, label: `Logo ${logoIndex + 1} · ${item.name}` }))]} /></div>)}</div>
        </Card>}
      </Card>
      <Card className="action-card"><Flex justify="space-between" align="center" gap={16} wrap><div><Title level={4} style={{ margin: 0 }}>准备替换 {taskCount} 张图片</Title><Text type="secondary">{scenes.length} 张场景图 × 每张 {settings.copiesPerScene} 个结果</Text></div><Space>{processing && <Button danger icon={<StopOutlined />} onClick={stop}>停止任务</Button>}<Button type="primary" size="large" icon={<RocketOutlined />} loading={processing} onClick={start}>{processing ? '正在替换' : '开始替换'}</Button></Space></Flex>{!!tasks.length && <Progress style={{ marginTop: 18 }} percent={Math.round((completed / tasks.length) * 100)} status={processing ? 'active' : successful.length ? 'success' : 'exception'} />}</Card>
      <section className="results-section"><Flex justify="space-between" align="center" gap={8} wrap><div><Title level={3}>替换结果</Title><Text type="secondary">每个结果仅改变 Logo</Text></div><Space><Popconfirm title="清空全部替换结果？" onConfirm={clearResults}><Button danger disabled={!tasks.length} icon={<ClearOutlined />}>清空结果</Button></Popconfirm><Button disabled={!successful.length} icon={<DownloadOutlined />} onClick={() => void downloadAll()}>下载全部 ZIP</Button></Space></Flex>
        {tasks.length ? <Image.PreviewGroup><div className="logo-replace-results">{groups.flatMap((group) => group.tasks.map((task) => <Card key={task.id} size="small" title={`场景 ${task.sceneIndex + 1} · 结果 ${task.copyIndex + 1}`} extra={task.resultBlob && <Button type="text" icon={<DownloadOutlined />} onClick={() => downloadTask(task)} />}><div className="replace-result-image">{task.resultUrl ? <Image src={compareOriginalIds.has(task.id) ? group.scene.previewUrl : task.resultUrl} alt={compareOriginalIds.has(task.id) ? "原始场景图" : "Logo 替换结果"} /> : task.status === 'running' ? <GeneratingImage progressKey={task.id} status="running" percent={1} /> : <div className={`task-state-card is-${task.status}`}><Text strong type={task.status === 'failed' ? 'danger' : 'secondary'}>{statusText(task.status)}</Text><Text type="secondary">{task.error || (task.status === 'waiting' ? '等待可用并发任务' : '')}</Text></div>}</div><Flex justify="space-between" align="center" gap={8} style={{ marginTop: 8 }}><Space size={6}><Tag color={task.status === 'success' ? 'success' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'processing' : 'default'}>{statusText(task.status)}</Tag>{task.resultUrl && <Button size="small" icon={<EyeOutlined />} onClick={() => setCompareOriginalIds((current) => { const next = new Set(current); if (next.has(task.id)) next.delete(task.id); else next.add(task.id); return next; })}>{compareOriginalIds.has(task.id) ? '查看生成图' : '原图对比'}</Button>}</Space>{task.status === 'failed' && <Button size="small" icon={<ReloadOutlined />} onClick={() => retry(task.id)}>重试</Button>}</Flex></Card>))}</div></Image.PreviewGroup> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="完成上传并开始替换后，结果会显示在这里" />}
      </section>
      <Alert type="warning" showIcon title="生成式替换提示" description="模型会尽量保持其他区域不变，但生成式图片接口不能保证像素级完全一致；旧 Logo 参考图有助于提高识别准确率。" />
      {!settingsHost && <aside className="logo-settings">{settingsPanel}</aside>}
      {settingsHost && createPortal(settingsPanel, settingsHost)}
    </div>
  );
}
