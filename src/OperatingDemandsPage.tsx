import { useCallback, useEffect, useState } from 'react';
import { Attachments } from '@ant-design/x';
import { Alert, Badge, Button, Card, Checkbox, Col, Divider, Drawer, Dropdown, Empty, Form, Image, Input, InputNumber, List, Modal, Row, Select, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import { BellOutlined, DeleteOutlined, DownOutlined, EditOutlined, FileImageOutlined, PlusOutlined, ReloadOutlined, RocketOutlined } from '@ant-design/icons';
import type { CreationTool } from './types';

type Language = 'zh-CN' | 'en-US';
type Role = 'operator' | 'artist' | 'admin' | 'custom';
type Asset = { assetId: string; role: 'source' | 'reference'; name: string };
type ImageRequirements = { content: string; width: number | null; height: number | null; ratio: number | null; dpi: number | null; maxMB: number | null; minLongestEdge?: number | null; source?: { url?: string; checkedAt?: string; status?: string } };
type Specification = ImageRequirements & { id: string; customized?: boolean; referenceLinks: string[]; referenceAssetIds: string[] };
type Content = { title: string; description: string; type: string | null; platform: string | null; presetId: string | null; assets: Asset[]; commonRequirements?: ImageRequirements & { count: number }; specifications: Specification[]; links: string[] };
type Analysis = { tool: CreationTool | null; rationale: string; executable: boolean; parameters: { model: string; prompts: string[] } };
export type Demand = { id: string; creator: string; assignee: string | null; status: string; revision: number; content: Content; analysis: Analysis | null; updatedAt: string; operations: Array<{ id: string; kind: string; revision: number; status: string; error: string | null; result?: Array<{ index: number; status: string; resultId?: string; error?: string }> }> };
type Preset = { id: string; platform: string | null; type: string | null; name: string; nameZh?: string; requirements: Array<Partial<Specification>> };
type Account = { username: string; role: Role; allowedTools: string[]; source: string; disabled?: boolean };

const TYPES = [ ['main', '首图', 'Main image'], ['dimensions', '尺寸图', 'Dimension image'], ['logo-design', 'LOGO 设计图', 'Logo design'], ['scene', '场景图', 'Scene image'] ] as const;
const LEGACY_CUSTOM_LOGO = ['custom-logo', '客户定制 LOGO', 'Custom logo'] as const;
const PLATFORMS = ['AMAZON', 'ETSY', 'TEMU', 'SHEIN', 'EBAY', 'TIKTOK', 'WAYFAIR', 'WALMART'];
const ROLES: Array<[Role, string, string]> = [['operator','运营','Operator'], ['artist','美工','Artist'], ['admin','管理员','Administrator'], ['custom','自定义','Custom']];
const freshRequirements = (): ImageRequirements & { count: number } => ({ content: '', width: null, height: null, ratio: null, dpi: null, maxMB: null, minLongestEdge: null, count: 1 });
const freshSpec = (): Specification => ({ id: crypto.randomUUID(), content: '', width: null, height: null, ratio: null, dpi: null, maxMB: null, referenceLinks: [], referenceAssetIds: [] });
const freshContent = (): Content => ({ title: '', description: '', type: null, platform: null, presetId: null, assets: [], commonRequirements: freshRequirements(), specifications: [], links: [] });
function editableContent(content: Content): Content {
  const copy = structuredClone(content);
  const oldCommonContent = copy.commonRequirements?.content?.trim();
  if (oldCommonContent && !copy.description.includes(oldCommonContent)) copy.description = `${copy.description.trim()}\n${oldCommonContent}`.trim();
  if (copy.commonRequirements) copy.commonRequirements.content = '';
  return copy;
}
const requirementKeys = ['content', 'width', 'height', 'ratio', 'dpi', 'maxMB', 'minLongestEdge'] as const;
function hasWrittenRequirements(content: Content) {
  return Boolean(content.description.trim()) || (content.commonRequirements?.count || 1) > 1 || requirementKeys.some((key) => Boolean(content.commonRequirements?.[key]))
    || content.specifications.some((spec) => spec.customized !== false && requirementKeys.some((key) => Boolean(spec[key])));
}
function describePreset(preset: Preset, en: boolean) {
  return preset.requirements.map((spec, index) => [
    `${en ? 'Image' : '第'} ${index + 1}${en ? '' : ' 张'}`,
    spec.content,
    spec.width && spec.height ? `${spec.width} × ${spec.height} px` : null,
    spec.ratio && !(spec.width && spec.height) ? `${en ? 'ratio' : '比例'} ${spec.ratio}` : null,
    spec.dpi ? `${spec.dpi} DPI` : null,
    spec.maxMB ? `${en ? 'max' : '最大'} ${spec.maxMB} MB` : null,
    spec.minLongestEdge ? `${en ? 'longest edge ≥' : '最长边 ≥'} ${spec.minLongestEdge} px` : null,
  ].filter(Boolean).join(' · ')).join('\n');
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  if (!response.ok) {
    const value = await response.json().catch(() => ({}));
    throw new Error(value.error || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const lines = (value: string) => value.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
function localizedError(value: unknown, language: Language) {
  const detail = value instanceof Error ? value.message : String(value);
  if (language === 'en-US') return detail;
  if (/OPENAI_API_KEY|Configure a openai/i.test(detail)) return '服务端未配置 OpenAI Key，后台分析或生成无法执行';
  if (/Image type is required|Platform is required/i.test(detail)) return '请先选择做图类型和平台';
  if (/stale|changed/i.test(detail)) return '需求已更新，请刷新后重试';
  if (/source image|required.*source/i.test(detail)) return '自动执行需要上传待处理图片';
  if (/permission|access denied|Admin required/i.test(detail)) return '当前账号没有此操作权限';
  if (/too large|Upload too large/i.test(detail)) return '文件或请求超过大小限制';
  return `操作失败：${detail}`;
}

function SpecificationEditor({ value, onChange, onRemove, assets, language }: {
  value: Specification; onChange: (value: Specification) => void; onRemove: () => void; assets: Asset[]; language: Language;
}) {
  const en = language === 'en-US';
  const patch = (part: Partial<Specification>) => {
    const next = { ...value, ...part };
    if (next.width && next.height) next.ratio = next.width / next.height;
    onChange(next);
  };
  return <Card size="small" style={{ marginBottom: 12 }} extra={<Button danger type="text" icon={<DeleteOutlined />} onClick={onRemove} />}>
    <Space direction="vertical" style={{ width: '100%' }}>
      <Input.TextArea value={value.content} onChange={(e) => patch({ content: e.target.value })} placeholder={en ? 'Content for this image' : '这一张图片的内容'} autoSize={{ minRows: 2, maxRows: 5 }} />
      <Space wrap>
        <InputNumber min={1} max={10000} value={value.width} onChange={(width) => patch({ width })} addonAfter="px" placeholder={en ? 'Width' : '宽'} />
        <InputNumber min={1} max={10000} value={value.height} onChange={(height) => patch({ height })} addonAfter="px" placeholder={en ? 'Height' : '高'} />
        <InputNumber min={0.1} step={0.01} value={value.ratio} disabled={Boolean(value.width && value.height)} onChange={(ratio) => patch({ ratio })} addonBefore={en ? 'Ratio' : '比例'} />
        <InputNumber min={1} value={value.dpi} onChange={(dpi) => patch({ dpi })} addonAfter="DPI" />
        <InputNumber min={0.1} step={0.1} value={value.maxMB} onChange={(maxMB) => patch({ maxMB })} addonAfter="MB" placeholder={en ? 'Size limit' : '大小限制'} />
        <InputNumber min={1} value={value.minLongestEdge} onChange={(minLongestEdge) => patch({ minLongestEdge })} addonAfter="px" placeholder={en ? 'Min longest edge' : '最长边下限'} />
      </Space>
      <Input.TextArea value={value.referenceLinks.join('\n')} onChange={(e) => patch({ referenceLinks: lines(e.target.value) })} placeholder={en ? 'Reference links, one per line' : '参考链接，每行一个'} autoSize={{ minRows: 1, maxRows: 3 }} />
      <Select mode="multiple" style={{ width: '100%' }} value={value.referenceAssetIds} onChange={(referenceAssetIds) => patch({ referenceAssetIds })}
        placeholder={en ? 'Reference images for this output' : '这张成品对应的参考图片'} options={assets.filter((asset) => asset.role === 'reference').map((asset) => ({ label: asset.name, value: asset.assetId }))} />
      {value.source?.status && <Typography.Text type="secondary">{value.source.status === 'unverified' ? (en ? 'Unverified suggestion' : '待核验建议') : (en ? 'Platform source' : '平台来源')} · {value.source.checkedAt || ''} {value.source.url && <a href={value.source.url} target="_blank" rel="noreferrer">{en ? 'Source' : '来源'}</a>}</Typography.Text>}
    </Space>
  </Card>;
}

function CommonRequirementsEditor({ value, onChange, language }: {
  value: ImageRequirements & { count: number }; onChange: (value: ImageRequirements & { count: number }) => void; language: Language;
}) {
  const en = language === 'en-US';
  const patch = (part: Partial<ImageRequirements & { count: number }>) => {
    const next = { ...value, ...part };
    if (next.width && next.height) next.ratio = next.width / next.height;
    onChange(next);
  };
  return <Space direction="vertical" style={{ width: '100%' }}>
    <Space wrap>
      <InputNumber min={1} max={20} value={value.count} onChange={(count) => patch({ count: count || 1 })} addonAfter={en ? 'images' : '张'} aria-label={en ? 'Image count' : '图片张数'} />
      <InputNumber min={1} max={10000} value={value.width} onChange={(width) => patch({ width })} addonAfter="px" placeholder={en ? 'Width' : '宽'} />
      <InputNumber min={1} max={10000} value={value.height} onChange={(height) => patch({ height })} addonAfter="px" placeholder={en ? 'Height' : '高'} />
      <InputNumber min={0.1} step={0.01} value={value.ratio} disabled={Boolean(value.width && value.height)} onChange={(ratio) => patch({ ratio })} addonBefore={en ? 'Ratio' : '比例'} />
      <InputNumber min={1} value={value.dpi} onChange={(dpi) => patch({ dpi })} addonAfter="DPI" />
      <InputNumber min={0.1} step={0.1} value={value.maxMB} onChange={(maxMB) => patch({ maxMB })} addonAfter="MB" placeholder={en ? 'Size limit' : '大小限制'} />
      <InputNumber min={1} value={value.minLongestEdge} onChange={(minLongestEdge) => patch({ minLongestEdge })} addonAfter="px" placeholder={en ? 'Min longest edge' : '最长边下限'} />
    </Space>
    {value.source?.status && <Typography.Text type="secondary">{value.source.status === 'unverified' ? (en ? 'Unverified suggestion' : '待核验建议') : (en ? 'Platform source' : '平台来源')} · {value.source.checkedAt || ''} {value.source.url && <a href={value.source.url} target="_blank" rel="noreferrer">{en ? 'Source' : '来源'}</a>}</Typography.Text>}
  </Space>;
}

export default function OperatingDemandsPage({ language, username, admin, toolOptions, onOpenTool, focusedId }: {
  language: Language; username: string; admin: boolean; toolOptions: Array<{ key: CreationTool; label: string }>;
  onOpenTool: (tool: CreationTool, demand: Demand) => void; focusedId?: string | null;
}) {
  const en = language === 'en-US';
  const t = (zh: string, english: string) => en ? english : zh;
  const [demands, setDemands] = useState<Demand[]>([]);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [artists, setArtists] = useState<Array<{ username: string }>>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Demand | null | undefined>(undefined);
  const [draft, setDraft] = useState<Content>(freshContent);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [presetEdit, setPresetEdit] = useState<Preset | null | undefined>(undefined);
  const [accountEdit, setAccountEdit] = useState<Partial<Account> | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [analysisEdits, setAnalysisEdits] = useState<Record<string, Analysis['parameters']>>({});
  const [tab, setTab] = useState('demands');

  const refresh = useCallback(async () => {
    try {
      const [newDemands, newPresets, newArtists] = await Promise.all([
        api<Demand[]>('/api/demands'), api<Preset[]>('/api/demand-presets'), api<Array<{ username: string }>>('/api/accounts/assignable'),
      ]);
      setDemands(newDemands); setPresets(newPresets); setArtists(newArtists);
      if (admin) setAccounts(await api<Account[]>('/api/accounts'));
    } catch (error) { message.error(localizedError(error, language)); }
    finally { setLoading(false); }
  }, [admin]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 6000); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { if (focusedId) setTab('demands'); }, [focusedId]);

  const save = async () => {
    if (!draft.type || !draft.platform) return message.warning(t('请先选择做图类型和平台', 'Select an image type and platform first'));
    if (!draft.description.trim()) return message.warning(t('请填写具体做图需求', 'Enter the image production brief'));
    setBusy(true);
    try {
      await api<Demand>('/api/demands', json('POST', { id: editing?.id, revision: editing?.revision, assignee, content: draft }));
      setEditing(undefined); message.success(t('需求已保存，AI 正在分析参数', 'Request saved; AI is analyzing parameters')); await refresh();
    } catch (error) { message.error(localizedError(error, language)); } finally { setBusy(false); }
  };
  const upload = async (files: File[] | FileList | null, role: Asset['role']) => {
    if (!files) return;
    setBusy(true);
    try {
      const uploaded: Asset[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error(t('只支持 20 MB 以内的图片', 'Only images up to 20 MB are supported'));
        const result = await api<{ id: string }>('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Tool': 'operating-demand', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        uploaded.push({ assetId: result.id, role, name: file.name });
      }
      setDraft((previous) => ({ ...previous, assets: [...previous.assets, ...uploaded] }));
    } catch (error) { message.error(localizedError(error, language)); } finally { setBusy(false); }
  };
  const applyPreset = (preset: Preset, base: Content, confirmOverwrite = true) => {
    const apply = () => {
      const first = preset.requirements[0] || {};
      const presetBrief = String(first.content || '').trim();
      const currentBrief = base.description.trim();
      setDraft({ ...base, presetId: preset.id,
        description: presetBrief && !currentBrief.includes(presetBrief) ? [currentBrief, presetBrief].filter(Boolean).join('\n') : currentBrief,
        commonRequirements: { ...freshRequirements(), ...Object.fromEntries(requirementKeys.filter((key) => key !== 'content').map((key) => [key, first[key] ?? null])),
          ratio: first.width && first.height ? first.width / first.height : first.ratio ?? null,
          count: Math.max(1, preset.requirements.length), source: first.source },
        specifications: preset.requirements.length > 1 ? preset.requirements.map((item) => ({ ...freshSpec(), ...item, id: crypto.randomUUID(), customized: true, referenceLinks: [], referenceAssetIds: [] })) : [] });
    };
    if (!confirmOverwrite || !hasWrittenRequirements(base)) return apply();
    Modal.confirm({ title: t('应用预设并覆盖已填写的图片要求？', 'Apply preset and replace existing image requirements?'),
      content: <div><Typography.Text strong>{en ? preset.name : preset.nameZh || preset.name}</Typography.Text>
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{describePreset(preset, en)}</Typography.Paragraph></div>,
      okText: t('应用预设', 'Apply preset'), cancelText: t('保留已填写内容', 'Keep current requirements'), onOk: apply });
  };
  const chooseClassification = (part: Pick<Content, 'type' | 'platform'>) => {
    const next = { ...draft, ...part, presetId: null };
    if (!next.type || !next.platform) return setDraft(next);
    const candidates = presets.filter((preset) => (preset.platform === next.platform || preset.platform === null) && (preset.type === next.type || preset.type === null));
    const score = (preset: Preset) => Number(preset.platform === next.platform) * 2 + Number(preset.type === next.type);
    candidates.sort((a, b) => score(b) - score(a));
    if (candidates[0]?.id === draft.presetId) return setDraft({ ...next, presetId: draft.presetId });
    setDraft(next);
    if (candidates[0]) applyPreset(candidates[0], next);
  };
  const setSpec = (id: string, value: Specification) => setDraft((previous) => ({ ...previous, specifications: previous.specifications.map((item) => item.id === id ? { ...value, customized: true } : item) }));
  const addImageRequirement = () => setDraft((previous) => {
    const specifications = [...previous.specifications];
    const index = specifications.findIndex((item) => item.customized === false);
    const target = index < 0 ? specifications.length : index;
    specifications[target] = { ...(specifications[target] || freshSpec()), customized: true };
    return { ...previous, specifications, commonRequirements: { ...(previous.commonRequirements || freshRequirements()), count: Math.max(previous.commonRequirements?.count || 1, target + 1) } };
  });
  const action = async (url: string, method = 'POST', body?: unknown): Promise<boolean> => { setBusy(true); try { await api(url, body ? json(method, body) : { method }); await refresh(); return true; } catch (error) { message.error(localizedError(error, language)); return false; } finally { setBusy(false); } };
  const savePreset = async () => {
    if (!presetEdit) return;
    if (!presetEdit.name.trim() || !presetEdit.requirements.length) return message.warning(t('请填写名称及至少一张图片要求', 'Add a name and at least one image requirement'));
    if (await action(`/api/demand-presets/${presetEdit.id}`, 'PUT', presetEdit)) setPresetEdit(undefined);
  };
  const saveAccount = async () => {
    if (!accountEdit?.username || !accountEdit.role) return;
    if (await action(accountEdit.source ? `/api/accounts/${accountEdit.username}` : '/api/accounts', accountEdit.source ? 'PUT' : 'POST', { ...accountEdit, password })) { setAccountEdit(null); setPassword(''); }
  };

  return <div className="operating-demands-page">
    <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start">
      <div><Typography.Title level={2} style={{ marginBottom: 4 }}>{t('做图需求', 'Image production requests')}</Typography.Title><Typography.Text type="secondary">{t('需求、分配、参数建议与服务器任务集中管理', 'Requests, assignments, suggested parameters and server jobs')}</Typography.Text></div>
      <Button type="primary" icon={<PlusOutlined />} onClick={() => { setDraft(freshContent()); setAssignee(null); setEditing(null); }}>{t('新建需求', 'New request')}</Button>
    </Space>
    <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'demands', label: t('需求记录', 'Requests'), children: <Spin spinning={loading}><List dataSource={demands} locale={{ emptyText: <Empty description={t('暂无需求', 'No requests')} /> }} renderItem={(demand) => {
        const analyzing = demand.operations.some((op) => op.kind === 'analyze' && op.revision === demand.revision && ['queued','running'].includes(op.status));
        const analysisOperation = demand.operations.find((op) => op.kind === 'analyze' && op.revision === demand.revision);
        const currentRun = demand.operations.find((op) => op.kind === 'execute' && op.revision === demand.revision);
        const parameters = analysisEdits[demand.id] || demand.analysis?.parameters;
        return <List.Item key={demand.id} id={`demand-${demand.id}`} style={focusedId === demand.id ? { background: '#f1edff', borderRadius: 12, padding: 16 } : {}}>
          <Card style={{ width: '100%' }} title={<Space wrap><span>{demand.content.title || demand.content.description.slice(0, 60)}</span><Tag>{TYPES.find((item) => item[0] === demand.content.type)?.[en ? 2 : 1] || (demand.content.type === LEGACY_CUSTOM_LOGO[0] ? LEGACY_CUSTOM_LOGO[en ? 2 : 1] : t('未指定类型', 'No type'))}</Tag><Tag>{demand.content.platform || t('未指定平台', 'No platform')}</Tag><Tag color={demand.status === 'completed' ? 'success' : 'processing'}>{demand.status === 'completed' ? t('已完成', 'Completed') : t('进行中', 'Open')}</Tag></Space>}
            extra={<Space><Typography.Text type="secondary">{demand.creator} → {demand.assignee || t('未分配', 'Unassigned')}</Typography.Text><Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(demand); setDraft(editableContent(demand.content)); setAssignee(demand.assignee); }}>{t('编辑', 'Edit')}</Button></Space>}>
            <Typography.Paragraph>{demand.content.description}</Typography.Paragraph>
            <Space wrap>{demand.content.assets.map((asset) => <Tag key={asset.assetId}>{asset.role === 'source' ? t('原图', 'Source') : t('参考', 'Reference')} · {asset.name}</Tag>)}</Space>
            <Divider style={{ margin: '12px 0' }} />
            {analyzing ? <Tag icon={<ReloadOutlined spin />} color="processing">{t('AI 正在分析参数', 'AI is analyzing parameters')}</Tag> : demand.analysis ? <>
              <Typography.Text>{demand.analysis.rationale}</Typography.Text><br />
              <Space wrap style={{ marginTop: 10 }}><Tag color="purple">{demand.analysis.tool || t('人工处理', 'Manual')}</Tag><Tag>{parameters?.model}</Tag></Space>
              {parameters?.prompts.map((prompt, index) => <Input.TextArea key={index} style={{ marginTop: 8 }} value={prompt} autoSize={{ minRows: 2, maxRows: 4 }} aria-label={`${t('第', 'Image ')}${index + 1}${t('张提示词', ' prompt')}`}
                onChange={(event) => setAnalysisEdits((current) => ({ ...current, [demand.id]: { ...parameters, prompts: parameters.prompts.map((p, i) => i === index ? event.target.value : p) } }))} />)}
              <Space wrap style={{ marginTop: 10 }}>
                <Select size="small" value={parameters?.model} style={{ width: 230 }} options={['gpt-image-2.5-flare','gpt-image-2.5-sunburst'].map((value) => ({ value }))} onChange={(model) => parameters && setAnalysisEdits((current) => ({ ...current, [demand.id]: { ...parameters, model } }))} />
                <Button size="small" onClick={async () => { if (await action(`/api/demands/${demand.id}/analysis`, 'PUT', { revision: demand.revision, parameters })) setAnalysisEdits((current) => { const next = { ...current }; delete next[demand.id]; return next; }); }}>{t('保存建议参数', 'Save suggested parameters')}</Button>
                {demand.analysis.executable && <><Button type="primary" icon={<RocketOutlined />} loading={busy} disabled={Boolean(analysisEdits[demand.id])} title={analysisEdits[demand.id] ? t('请先保存建议参数', 'Save parameters first') : undefined} onClick={() => action(`/api/demands/${demand.id}/execute`)}>{t('一键执行', 'Run automatically')}</Button>
                  <Dropdown menu={{ items: [{ key: 'custom', label: t('自定义参数', 'Custom parameters') }], onClick: () => demand.analysis?.tool && onOpenTool(demand.analysis.tool, demand) }}><Button disabled={Boolean(analysisEdits[demand.id])} icon={<DownOutlined />} aria-label={t('执行选项', 'Execution options')} /></Dropdown></>}
              </Space>
            </> : <Alert type="warning" showIcon message={t('尚无 AI 参数建议', 'No AI parameters yet')}
              description={<Space direction="vertical"><span>{analysisOperation?.error ? localizedError(analysisOperation.error, language) : t('请等待分析，或检查服务端 Key', 'Wait for analysis or check the server key')}</span>
                {analysisOperation && ['failed','interrupted'].includes(analysisOperation.status) && <Button size="small" onClick={() => action(`/api/demands/${demand.id}/retry/${analysisOperation.id}`)}>{t('重新分析', 'Retry analysis')}</Button>}</Space>} />}
            {currentRun && <Alert style={{ marginTop: 12 }} type={currentRun.status === 'completed' ? 'success' : currentRun.status === 'failed' ? 'warning' : 'info'}
              message={`${t('服务器执行', 'Server execution')}: ${currentRun.status}`}
              description={<><div>{currentRun.error && localizedError(currentRun.error, language)}</div>{currentRun.result?.map((item) => <div key={item.index}>#{item.index + 1}: {item.resultId ? t('已归档至生成结果', 'Archived in generated results') : item.error ? localizedError(item.error, language) : item.status}</div>)}
                {['failed','interrupted'].includes(currentRun.status) && <Button size="small" onClick={() => action(`/api/demands/${demand.id}/retry/${currentRun.id}`)}>{t('重试失败项', 'Retry failed items')}</Button>}</>} />}
            {demand.status === 'open' && (admin || demand.assignee === username) && <Button style={{ marginTop: 12 }} size="small" icon={<BellOutlined />} onClick={() => action(`/api/demands/${demand.id}/complete`)}>{t('标记完成', 'Mark complete')}</Button>}
          </Card>
        </List.Item>;
      }} /></Spin> },
      { key: 'presets', label: t('图片要求预设', 'Image presets'), children: <><Button icon={<PlusOutlined />} onClick={() => setPresetEdit({ id: crypto.randomUUID(), platform: null, type: null, name: '', requirements: [freshSpec()] })}>{t('新增预设', 'Add preset')}</Button><List dataSource={presets} renderItem={(preset) => <List.Item actions={[<Button key="edit" size="small" onClick={() => setPresetEdit(structuredClone(preset))}>{t('编辑', 'Edit')}</Button>, <Button key="delete" danger size="small" onClick={() => Modal.confirm({ title: t('删除预设？', 'Delete preset?'), onOk: () => action(`/api/demand-presets/${preset.id}`, 'DELETE') })}>{t('删除', 'Delete')}</Button>]}><List.Item.Meta title={en ? preset.name : preset.nameZh || preset.name} description={`${preset.platform || '—'} · ${preset.requirements.length} ${t('张图片', 'images')}`} /></List.Item>} /></> },
      ...(admin ? [{ key: 'accounts', label: t('账号管理', 'Accounts'), children: <><Button icon={<PlusOutlined />} onClick={() => setAccountEdit({ username: '', role: 'operator', allowedTools: [] })}>{t('新建账号', 'Create account')}</Button><List dataSource={accounts} renderItem={(account) => <List.Item actions={account.source === 'database' ? [<Button key="edit" size="small" onClick={() => setAccountEdit(account)}>{t('编辑', 'Edit')}</Button>] : []}><List.Item.Meta title={account.username} description={`${ROLES.find((role) => role[0] === account.role)?.[en ? 2 : 1]} · ${account.source}`} /></List.Item>} /></> }] : []),
    ]} />
    <Drawer title={editing ? t('编辑做图需求', 'Edit request') : t('新建做图需求', 'New request')} open={editing !== undefined} width="min(760px, 100vw)" onClose={() => setEditing(undefined)} extra={<Button type="primary" loading={busy} onClick={() => void save()}>{t('保存需求', 'Save request')}</Button>}>
      <Form layout="vertical">
        <Row gutter={12}><Col span={12}><Form.Item label={t('做图类型', 'Image type')} required extra={t('黑白 Logo 需求会根据描述自动识别，无需选择专门类型。', 'Black-and-white logo requests are recognized from the brief; no separate type is needed.')}><Select value={draft.type} placeholder={t('请选择做图类型', 'Select image type')} options={[...TYPES.map(([value, zh, english]) => ({ value, label: en ? english : zh })), ...(draft.type === LEGACY_CUSTOM_LOGO[0] ? [{ value: LEGACY_CUSTOM_LOGO[0], label: en ? LEGACY_CUSTOM_LOGO[2] : LEGACY_CUSTOM_LOGO[1], disabled: true }] : [])]} onChange={(type) => chooseClassification({ type, platform: draft.platform })} /></Form.Item></Col>
          <Col span={12}><Form.Item label={t('平台', 'Platform')} required><Select value={draft.platform} placeholder={t('请选择平台', 'Select platform')} options={PLATFORMS.map((value) => ({ value }))} onChange={(platform) => chooseClassification({ type: draft.type, platform })} /></Form.Item></Col></Row>
        <Form.Item label={t('图片要求预设（可更换）', 'Image preset (optional override)')} extra={t('选好类型和平台会自动带入匹配预设；已有要求时先确认。', 'Choosing a type and platform applies a matching preset; existing requirements require confirmation.')}><Select allowClear value={draft.presetId} options={presets.filter((item) => (!item.platform || item.platform === draft.platform) && (!item.type || item.type === draft.type)).map((item) => ({ value: item.id, label: en ? item.name : item.nameZh || item.name }))} onChange={(id) => { const preset = presets.find((item) => item.id === id); if (preset) applyPreset(preset, draft); else setDraft({ ...draft, presetId: null }); }} /></Form.Item>
        <Form.Item label={t('标题（选填）', 'Title (optional)')}><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Form.Item>
        <Form.Item label={t('具体做图需求', 'Image production brief')} required><Input.TextArea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} /></Form.Item>
        <Form.Item label={t('负责美工', 'Assigned artist')}><Select allowClear value={assignee} options={artists.map((item) => ({ value: item.username }))} onChange={(value) => setAssignee(value || null)} /></Form.Item>
        <Divider>{t('所有图片的共同要求', 'Requirements for all images')}</Divider>
        <CommonRequirementsEditor value={draft.commonRequirements || { ...freshRequirements(), count: Math.max(1, draft.specifications.length) }} language={language} onChange={(commonRequirements) => setDraft((previous) => ({ ...previous, commonRequirements: { ...commonRequirements,
          count: Math.max(commonRequirements.count, previous.specifications.reduce((last, item, index) => item.customized === false ? last : index + 1, 1)) } }))} />
        <Divider>{t('上传素材', 'Upload assets')}</Divider>
        <Typography.Paragraph type="secondary">{t('自动执行使用第一张待处理图片；参考效果图只作风格参考。不需要上传时也可以先保存需求。', 'Automatic runs use the first source image; style references only guide the AI. You can save a request without uploading yet.')}</Typography.Paragraph>
        <div className="operating-upload-grid">
          {(['source', 'reference'] as const).map((role) => <Attachments key={role} items={[]} overflow="wrap" accept="image/*" multiple
            beforeUpload={(file) => { void upload([file as File], role); return false; }}
            placeholder={{ icon: <FileImageOutlined />, title: role === 'source' ? t('拖拽、点击或粘贴待处理图片', 'Drag, click, or paste source images') : t('拖拽、点击或粘贴参考效果图', 'Drag, click, or paste style references'), description: t('PNG / JPEG / WebP，单张不超过 20 MB', 'PNG / JPEG / WebP, up to 20 MB each') }} />)}
        </div>
        <List size="small" dataSource={draft.assets} renderItem={(asset) => <List.Item actions={[<Button key="remove" danger size="small" icon={<DeleteOutlined />} onClick={() => setDraft((value) => ({ ...value, assets: value.assets.filter((item) => item.assetId !== asset.assetId) }))} />]}>
          <Space><Image width={56} height={56} style={{ objectFit: 'contain' }} src={`/api/assets/${asset.assetId}`} /><Typography.Text>{asset.name}</Typography.Text><Tag color={asset.role === 'source' ? 'purple' : 'blue'}>{asset.role === 'source' ? t('待处理图片', 'Source image') : t('参考效果图', 'Style reference')}</Tag><Button size="small" onClick={() => setDraft((value) => ({ ...value, assets: value.assets.map((item) => item.assetId === asset.assetId ? { ...item, role: item.role === 'source' ? 'reference' : 'source' } : item) }))}>{t('切换用途', 'Switch use')}</Button></Space>
        </List.Item>}/>
        <Button style={{ marginTop: 12 }} icon={<PlusOutlined />} onClick={addImageRequirement}>{t('添加单张图片的特殊要求', 'Add requirements for one image')}</Button>
        {draft.specifications.some((spec) => spec.customized !== false) && <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>{t('留空的单张字段会沿用上方所有图片的共同要求。', 'Blank per-image fields inherit the requirements for all images above.')}</Typography.Paragraph>}
        {draft.specifications.map((spec, index) => spec.customized === false ? null : <div key={spec.id} style={{ marginTop: 12 }}><Typography.Text strong>{t('第', 'Image ')}{index + 1}{t('张的特殊要求', ' overrides')}</Typography.Text><SpecificationEditor value={spec} assets={draft.assets} language={language} onChange={(value) => setSpec(spec.id, value)} onRemove={() => setDraft((previous) => ({ ...previous, specifications: previous.specifications.map((item) => item.id === spec.id ? { ...freshSpec(), id: item.id, customized: false } : item) }))} /></div>)}
        <Form.Item label={t('通用参考链接，每行一个（选填）', 'General reference links, one per line (optional)')}><Input.TextArea value={draft.links.join('\n')} onChange={(e) => setDraft({ ...draft, links: lines(e.target.value) })} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
      </Form>
    </Drawer>
    <Drawer title={t('编辑共享预设', 'Edit shared preset')} open={presetEdit !== undefined} width="min(700px, 100vw)" onClose={() => setPresetEdit(undefined)} extra={<Button type="primary" onClick={() => void savePreset()}>{t('保存预设', 'Save preset')}</Button>}>
      {presetEdit && <Space direction="vertical" style={{ width: '100%' }}><Input value={presetEdit.name} placeholder={t('英文名称', 'English name')} onChange={(e) => setPresetEdit({ ...presetEdit, name: e.target.value })} /><Input value={presetEdit.nameZh} placeholder={t('中文名称', 'Chinese name')} onChange={(e) => setPresetEdit({ ...presetEdit, nameZh: e.target.value })} />
        <Space><Select allowClear placeholder={t('平台', 'Platform')} value={presetEdit.platform} style={{ width: 180 }} options={PLATFORMS.map((value) => ({ value }))} onChange={(platform) => setPresetEdit({ ...presetEdit, platform: platform || null })} /><Select allowClear placeholder={t('类型', 'Type')} value={presetEdit.type} style={{ width: 180 }} options={[...TYPES.map(([value, zh, english]) => ({ value, label: en ? english : zh })), ...(presetEdit.type === LEGACY_CUSTOM_LOGO[0] ? [{ value: LEGACY_CUSTOM_LOGO[0], label: en ? LEGACY_CUSTOM_LOGO[2] : LEGACY_CUSTOM_LOGO[1], disabled: true }] : [])]} onChange={(type) => setPresetEdit({ ...presetEdit, type: type || null })} /></Space>
        {presetEdit.requirements.map((spec, index) => <div key={index}><SpecificationEditor value={{ ...freshSpec(), ...spec, id: spec.id || String(index), referenceLinks: [], referenceAssetIds: [] }} assets={[]} language={language}
          onChange={(next) => setPresetEdit((current) => current && ({ ...current, requirements: current.requirements.map((item, i) => i === index ? { ...next, source: item.source } : item) }))}
          onRemove={() => setPresetEdit((current) => current && ({ ...current, requirements: current.requirements.filter((_, i) => i !== index) }))} />
          <Space wrap style={{ marginBottom: 12 }}><Input style={{ width: 250 }} placeholder={t('平台来源 URL', 'Source URL')} value={spec.source?.url} onChange={(e) => setPresetEdit((current) => current && ({ ...current, requirements: current.requirements.map((item, i) => i === index ? { ...item, source: { ...item.source, url: e.target.value } } : item) }))} />
            <Select style={{ width: 150 }} value={spec.source?.status || 'unverified'} options={[{ value: 'unverified', label: t('待核验', 'Unverified') }, { value: 'recommendation', label: t('平台建议', 'Recommendation') }, { value: 'requirement', label: t('平台要求', 'Requirement') }]} onChange={(status) => setPresetEdit((current) => current && ({ ...current, requirements: current.requirements.map((item, i) => i === index ? { ...item, source: { ...item.source, status, checkedAt: new Date().toISOString().slice(0, 10) } } : item) }))} />
          </Space></div>)}
        <Button onClick={() => setPresetEdit((current) => current && ({ ...current, requirements: [...current.requirements, freshSpec()] }))}>{t('增加图片要求', 'Add requirement')}</Button>
      </Space>}
    </Drawer>
    <Modal title={accountEdit?.source ? t('编辑账号', 'Edit account') : t('新建账号', 'Create account')} open={Boolean(accountEdit)} onCancel={() => setAccountEdit(null)} onOk={() => void saveAccount()} okText={t('保存', 'Save')}>
      {accountEdit && <Space direction="vertical" style={{ width: '100%' }}><Input placeholder={t('账号', 'Username')} disabled={Boolean(accountEdit.source)} value={accountEdit.username} onChange={(e) => setAccountEdit({ ...accountEdit, username: e.target.value })} /><Input.Password placeholder={accountEdit.source ? t('新密码（留空则不修改）', 'New password (blank to keep)') : t('密码至少 12 位', 'Password, at least 12 characters')} value={password} onChange={(e) => setPassword(e.target.value)} /><Select value={accountEdit.role} options={ROLES.map(([value, zh, english]) => ({ value, label: en ? english : zh }))} onChange={(role) => setAccountEdit({ ...accountEdit, role })} />
        {accountEdit.role === 'custom' && <Checkbox.Group value={accountEdit.allowedTools} options={toolOptions.map((item) => ({ label: item.label, value: item.key }))} onChange={(allowedTools) => setAccountEdit({ ...accountEdit, allowedTools: allowedTools.map(String) })} />}
        {accountEdit.source && <Checkbox checked={Boolean(accountEdit.disabled)} onChange={(e) => setAccountEdit({ ...accountEdit, disabled: e.target.checked })}>{t('停用账号', 'Disable account')}</Checkbox>}</Space>}
    </Modal>
  </div>;
}

export function DemandTodoButton({ language, onOpen }: { language: Language; onOpen: (id?: string) => void }) {
  const [todos, setTodos] = useState<Demand[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void api<Demand[]>('/api/demands/todos').then((data) => { if (alive) setTodos(data); }).catch(() => {});
    load(); const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  const en = language === 'en-US';
  return <Dropdown trigger={['click']} menu={{ items: todos.length ? todos.map((item) => ({ key: item.id, label: item.content.title || item.content.description.slice(0, 50) })) : [{ key: 'empty', disabled: true, label: en ? 'No pending requests' : '暂无待办需求' }], onClick: ({ key }) => key !== 'empty' && onOpen(key) }}>
    <Badge count={todos.length} size="small"><Button icon={<BellOutlined />}>{en ? 'To-dos' : '代办提醒'}</Button></Badge>
  </Dropdown>;
}
