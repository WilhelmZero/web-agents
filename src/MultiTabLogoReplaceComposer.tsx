import { App, Alert, Button, Card, Empty, Flex, InputNumber, Modal, Space, Tag, Typography, Upload } from 'antd';
import { FileImageOutlined, FolderOpenOutlined, RocketOutlined, SyncOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import LogoReplaceComposer from './LogoReplaceComposer';
import PsdLogoImportModal from './PsdLogoImportModal';

const { Title, Text, Paragraph } = Typography;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const DB_NAME = 'scene-studio.multi-tab-logo-replace.v1';
const STORE = 'batches';

interface FolderGroup { id: string; name: string; path: string; files: File[] }
interface SharedBatch { id: string; createdAt: number; groups: FolderGroup[]; logos: File[]; globalConcurrency?: number }

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}

async function saveBatch(batch: SharedBatch) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(batch); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
  db.close();
}

async function readBatch(id: string) {
  const db = await openDb();
  const result = await new Promise<SharedBatch | undefined>((resolve, reject) => { const request = db.transaction(STORE).objectStore(STORE).get(id); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  db.close(); return result;
}

export function groupFolderFiles(files: File[]): FolderGroup[] {
  const groups = new Map<string, FolderGroup>();
  files.filter((file) => IMAGE_TYPES.includes(file.type)).forEach((file) => {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relativePath.split('/').filter(Boolean); const directories = parts.slice(0, -1);
    const leaf = directories.at(-1) || '未分组'; const parent = directories.at(-2);
    const name = parent === leaf ? leaf : leaf; const path = directories.join('/');
    const id = encodeURIComponent(path || name);
    const group = groups.get(id) || { id, name, path, files: [] }; group.files.push(file); groups.set(id, group);
  });
  return [...groups.values()].sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'));
}

function injectFiles(input: HTMLInputElement | null, files: File[]) {
  if (!input || !files.length) return false;
  const transfer = new DataTransfer(); files.forEach((file) => transfer.items.add(file));
  input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true })); return true;
}

interface Props { apiKey: string; openAiApiKey: string; apiBaseUrl: string | null; connectionMode: 'direct' | 'proxy'; onRequestKey: () => void; settingsHost?: HTMLElement | null; onSessionStateChange?: (value: boolean) => void }

export default function MultiTabLogoReplaceComposer(props: Props) {
  const { message } = App.useApp(); const params = new URLSearchParams(location.search);
  const batchId = params.get('batch'); const groupId = params.get('group'); const worker = params.get('worker') === '1';
  const [groups, setGroups] = useState<FolderGroup[]>([]); const [logos, setLogos] = useState<File[]>([]); const [tabLimit, setTabLimit] = useState(4);
  const [globalConcurrency, setGlobalConcurrency] = useState(6);
  const [activeBatchId, setActiveBatchId] = useState<string>();
  const [pendingPsdFile, setPendingPsdFile] = useState<File>();
  const [blockedWorkerUrls, setBlockedWorkerUrls] = useState<Array<{ name: string; url: string }>>([]);
  const [workerBatch, setWorkerBatch] = useState<SharedBatch>(); const [workerGroup, setWorkerGroup] = useState<FolderGroup>(); const [injected, setInjected] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null); const loadedLogoKeys = useRef(new Set<string>());
  const [channel, setChannel] = useState<BroadcastChannel>();
  useEffect(() => { if (typeof BroadcastChannel === 'undefined') return; const next = new BroadcastChannel('scene-studio-logo-tabs'); setChannel(next); return () => next.close(); }, []);

  useEffect(() => {
    if (!worker || !batchId || !groupId) return;
    void readBatch(batchId).then((batch) => { const group = batch?.groups.find((item) => item.id === groupId); setWorkerBatch(batch); setWorkerGroup(group); props.onSessionStateChange?.(Boolean(group)); });
  }, [worker, batchId, groupId, props.onSessionStateChange]);

  useEffect(() => {
    if (!workerBatch || !workerGroup || injected) return;
    const timer = window.setTimeout(() => {
      const root = rootRef.current; if (!root) return;
      const sceneInput = root.querySelector<HTMLInputElement>('.logo-replace-integrated input[type="file"][accept="image/png,image/jpeg,image/webp"]');
      const logoInput = root.querySelector<HTMLInputElement>('.logo-replace-integrated input[type="file"][accept*=".psd"]');
      const sceneOk = injectFiles(sceneInput, workerGroup.files); const logoOk = injectFiles(logoInput, workerBatch.logos);
      workerBatch.logos.forEach((file) => loadedLogoKeys.current.add(`${file.name}:${file.size}:${file.lastModified}`));
      if (sceneOk && logoOk) { setInjected(true); channel?.postMessage({ type: 'worker-ready', batchId, groupId, count: workerGroup.files.length }); }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [workerBatch, workerGroup, injected, channel, batchId, groupId]);

  useEffect(() => {
    if (!worker || !channel || !batchId) return;
    channel.onmessage = (event) => { if (event.data?.type !== 'logos-updated' || event.data.batchId !== batchId) return; void readBatch(batchId).then((batch) => {
      if (!batch) return; setWorkerBatch(batch); const fresh = batch.logos.filter((file) => !loadedLogoKeys.current.has(`${file.name}:${file.size}:${file.lastModified}`));
      if (fresh.length) { const input = rootRef.current?.querySelector<HTMLInputElement>('.logo-replace-integrated input[type="file"][accept*=".psd"]') || null; injectFiles(input, fresh); fresh.forEach((file) => loadedLogoKeys.current.add(`${file.name}:${file.size}:${file.lastModified}`)); message.success(`已同步 ${fresh.length} 个公共 Logo`); }
    }); };
  }, [worker, channel, batchId, message]);

  useEffect(() => {
    if (!worker || !workerBatch?.globalConcurrency || !navigator.locks) return;
    const originalFetch = window.fetch.bind(window); const slots = workerBatch.globalConcurrency;
    window.fetch = async (...args) => {
      const target = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : args[0].url;
      if (!/generativelanguage\.googleapis\.com|api\.openai\.com|\/api\/gemini/i.test(target)) return originalFetch(...args);
      while (true) {
        for (let index = 0; index < slots; index += 1) {
          const result = await navigator.locks.request(`scene-studio-ai-slot-${index}`, { ifAvailable: true }, async (lock) => lock ? originalFetch(...args) : undefined);
          if (result) return result;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 120));
      }
    };
    return () => { window.fetch = originalFetch; };
  }, [worker, workerBatch?.globalConcurrency]);

  const openWorkers = async () => {
    if (!groups.length) return void message.warning('请先选择包含各组图片的根文件夹'); if (!logos.length) return void message.warning('请先上传公共 Logo');
    const selected = groups.slice(0, tabLimit); const id = `batch-${Date.now()}`;
    const placeholders = selected.map((_group, index) => window.open('', `scene-studio-logo-worker-${id}-${index}`));
    await saveBatch({ id, createdAt: Date.now(), groups, logos, globalConcurrency });
    setActiveBatchId(id);
    const targets = selected.map((group) => { const url = new URL(location.href); url.searchParams.set('tool', 'logo-replace-tabs'); url.searchParams.set('worker', '1'); url.searchParams.set('batch', id); url.searchParams.set('group', group.id); url.searchParams.set('folder', group.name); return { name: group.name, url: url.toString() }; });
    const blocked: typeof targets = [];
    targets.forEach((target, index) => { const opened = placeholders[index]; if (opened) opened.location.href = target.url; else blocked.push(target); });
    setBlockedWorkerUrls(blocked); if (blocked.length) message.warning(`${blocked.length} 个标签被浏览器拦截，请在弹窗中逐个打开或允许本站弹出窗口`);
    if (selected.length < groups.length) message.info(`已打开 ${selected.length} 组，其余 ${groups.length - selected.length} 组可提高同时标签数后再次打开`);
  };
  const syncLogos = async () => { const id = activeBatchId || batchId; if (!id) return; const batch = await readBatch(id); if (!batch) return; batch.logos = logos; await saveBatch(batch); channel?.postMessage({ type: 'logos-updated', batchId: id }); message.success('公共 Logo 更新已广播'); };

  if (worker) return <div ref={rootRef}><Alert type={injected ? 'success' : 'info'} showIcon title={workerGroup ? `工作标签：${workerGroup.name}` : '正在加载分组任务'} description={workerGroup ? `${workerGroup.path} · ${workerGroup.files.length} 张场景图 · 公共 Logo ${workerBatch?.logos.length || 0} 个${injected ? '，已自动导入' : '，正在自动导入…'}` : '请保留主控标签页以便接收公共 Logo 更新。'} style={{ marginBottom: 16 }} /><LogoReplaceComposer {...props} /></div>;

  return <div className="multi-tab-logo-page"><section className="hero-strip logo-replace-hero"><div><Text className="eyebrow">MULTI-TAB LOGO REPLACER</Text><Title level={2}>一个主控页，分发多组 Logo 替换任务</Title><Paragraph className="hero-description">一次选择场景根文件夹和公共 Logo，每个最深层子目录自动分配到独立标签页；工作页完整使用现有 Logo 替换功能。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title="1. 选择场景根文件夹"><Upload.Dragger directory multiple showUploadList={false} accept="image/png,image/jpeg,image/webp" beforeUpload={(file, fileList) => { if (file.uid === fileList.at(-1)?.uid) { const next = groupFolderFiles(fileList as File[]); setGroups(next); message.success(`识别到 ${next.length} 个图片分组`); } return Upload.LIST_IGNORE; }}><FolderOpenOutlined style={{ fontSize: 34, color: '#7654dd' }} /><p className="ant-upload-text">拖拽或点击选择场景根文件夹</p><p className="ant-upload-hint">支持“测试图片/AM058/AM058”这类两层目录，按最深层图片目录自动分组</p></Upload.Dragger>{groups.length ? <div className="folder-group-grid">{groups.map((group) => <Card key={group.id} size="small"><FolderOpenOutlined /> <Text strong>{group.name}</Text><br /><Text type="secondary">{group.path} · {group.files.length} 张</Text></Card>)}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择文件夹后显示分组" />}</Card>
    <Card className="workflow-card" title="2. 上传所有标签共用的 Logo"><Upload.Dragger multiple showUploadList accept="image/png,image/jpeg,image/webp,.psd,image/vnd.adobe.photoshop" beforeUpload={(file) => { const next = file as File; if (next.name.toLowerCase().endsWith('.psd') || next.type === 'image/vnd.adobe.photoshop') setPendingPsdFile(next); else setLogos((current) => [...current, next]); return false; }} onRemove={(file) => setLogos((current) => current.filter((item) => !(item.name === file.name && item.size === file.size))) }><FileImageOutlined style={{ fontSize: 30 }} /><p>拖拽或选择公共 Logo / PSD</p></Upload.Dragger><Flex gap={8} wrap style={{ marginTop: 12 }}>{logos.map((logo) => <Tag key={`${logo.name}-${logo.lastModified}`}>{logo.name}</Tag>)}</Flex>{activeBatchId && <Button icon={<SyncOutlined />} onClick={() => void syncLogos()}>同步到已打开标签</Button>}</Card>
    <Card className="action-card"><Flex justify="space-between" align="center" wrap gap={12}><div><Title level={4} style={{ margin: 0 }}>准备分发 {groups.length} 组任务</Title><Text type="secondary">公共 Logo {logos.length} 个；Web Locks 将所有标签的 AI 请求合计限制在 {globalConcurrency} 个</Text></div><Space wrap><Text>同时打开</Text><InputNumber min={1} max={10} value={tabLimit} onChange={(value) => setTabLimit(value || 1)} /><Text>个标签</Text><Text>全局并发</Text><InputNumber min={1} max={12} value={globalConcurrency} onChange={(value) => setGlobalConcurrency(value || 1)} /><Button type="primary" size="large" icon={<RocketOutlined />} onClick={() => void openWorkers()}>保存批次并打开标签</Button></Space></Flex></Card>
    <Alert type="info" showIcon title="公共 Logo 采用批次锁定" description="工作标签从 IndexedDB 读取同一组 Logo；新增公共 Logo 后可广播同步。为避免运行中的校验基准变化，删除或替换 Logo 建议创建新批次。" />
    <PsdLogoImportModal file={pendingPsdFile} onClose={() => setPendingPsdFile(undefined)} onImport={(files) => { setLogos((current) => [...current, ...files]); message.success(`已加入 ${files.length} 个 PSD Logo 图层`); }} />
    <Modal title="部分工作标签被浏览器拦截" open={blockedWorkerUrls.length > 0} footer={<Button onClick={() => setBlockedWorkerUrls([])}>关闭</Button>} onCancel={() => setBlockedWorkerUrls([])}><Alert type="warning" showIcon title="请允许本站弹出窗口，或点击下方按钮逐个打开" description="这是浏览器的多弹窗安全限制；批次已经保存，不需要重新选择文件夹和 Logo。" style={{ marginBottom: 14 }} /><Flex vertical gap={8}>{blockedWorkerUrls.map((target) => <Button key={target.url} icon={<RocketOutlined />} onClick={() => { const opened = window.open(target.url, '_blank'); if (opened) setBlockedWorkerUrls((current) => current.filter((item) => item.url !== target.url)); }}>{target.name} · 打开工作标签</Button>)}</Flex></Modal>
  </div>;
}
