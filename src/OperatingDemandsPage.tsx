import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Checkbox, Col, Divider, Drawer, Dropdown, Empty, Form, Image, Input, InputNumber, List, Modal, Row, Select, Space, Spin, Tabs, Tag, Typography, message } from 'antd';
import { BellOutlined, DeleteOutlined, DownOutlined, EditOutlined, PlusOutlined, ReloadOutlined, RocketOutlined, UploadOutlined } from '@ant-design/icons';
import type { CreationTool } from './types';

type Language = 'zh-CN' | 'en-US';
type Role = 'operator' | 'artist' | 'admin' | 'custom';
type Asset = { assetId: string; role: 'source' | 'reference'; name: string };
type Specification = { id: string; content: string; width: number | null; height: number | null; ratio: number | null; dpi: number | null; maxMB: number | null; minLongestEdge?: number | null; referenceLinks: string[]; referenceAssetIds: string[]; source?: { url?: string; checkedAt?: string; status?: string } };
type Content = { title: string; description: string; type: string | null; platform: string | null; presetId: string | null; assets: Asset[]; specifications: Specification[]; links: string[] };
type Analysis = { tool: CreationTool | null; rationale: string; executable: boolean; parameters: { model: string; prompts: string[] } };
export type Demand = { id: string; creator: string; assignee: string | null; status: string; revision: number; content: Content; analysis: Analysis | null; updatedAt: string; operations: Array<{ id: string; kind: string; revision: number; status: string; error: string | null; result?: Array<{ index: number; status: string; resultId?: string; error?: string }> }> };
type Preset = { id: string; platform: string | null; type: string | null; name: string; nameZh?: string; requirements: Array<Partial<Specification>> };
type Account = { username: string; role: Role; allowedTools: string[]; source: string; disabled?: boolean };

const TYPES = [ ['main', '首图', 'Main image'], ['dimensions', '尺寸图', 'Dimension image'], ['logo-design', 'LOGO 设计图', 'Logo design'], ['scene', '场景图', 'Scene image'], ['custom-logo', '客户定制 LOGO', 'Custom logo'] ] as const;
const PLATFORMS = ['AMAZON', 'ETSY', 'TEMU', 'SHEIN', 'EBAY', 'TIKTOK', 'WAYFAIR', 'WALMART'];
const ROLES: Array<[Role, string, string]> = [['operator','运营','Operator'], ['artist','美工','Artist'], ['admin','管理员','Administrator'], ['custom','自定义','Custom']];
const freshSpec = (): Specification => ({ id: crypto.randomUUID(), content: '', width: null, height: null, ratio: null, dpi: null, maxMB: null, referenceLinks: [], referenceAssetIds: [] });
const freshContent = (): Content => ({ title: '', description: '', type: null, platform: null, presetId: null, assets: [], specifications: [freshSpec()], links: [] });

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
  if (/stale|changed/i.test(detail)) return '需求已更新，请刷新后重试';
  if (/source image|required.*source/i.test(detail)) return '自动执行需要上传并标记待处理原图';
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
    setBusy(true);
    try {
      await api<Demand>('/api/demands', json('POST', { id: editing?.id, revision: editing?.revision, assignee, content: draft }));
      setEditing(undefined); message.success(t('需求已保存，AI 正在分析参数', 'Request saved; AI is analyzing parameters')); await refresh();
    } catch (error) { message.error(localizedError(error, language)); } finally { setBusy(false); }
  };
  const upload = async (files: FileList | null) => {
    if (!files) return;
    setBusy(true);
    try {
      const uploaded: Asset[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/') || file.size > 20 * 1024 * 1024) throw new Error(t('只支持 20 MB 以内的图片', 'Only images up to 20 MB are supported'));
        const result = await api<{ id: string }>('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Tool': 'operating-demand', 'X-File-Name': encodeURIComponent(file.name) }, body: file });
        uploaded.push({ assetId: result.id, role: 'reference', name: file.name });
      }
      setDraft((previous) => ({ ...previous, assets: [...previous.assets, ...uploaded] }));
    } catch (error) { message.error(localizedError(error, language)); } finally { setBusy(false); }
  };
  const applyPreset = (id: string) => {
    const preset = presets.find((item) => item.id === id);
    if (!preset) return;
    setDraft((previous) => ({ ...previous, presetId: id,
      specifications: preset.requirements.map((item) => ({ ...freshSpec(), ...item, id: crypto.randomUUID(), referenceLinks: [], referenceAssetIds: [] })) }));
  };
  const setSpec = (id: string, value: Specification) => setDraft((previous) => ({ ...previous, specifications: previous.specifications.map((item) => item.id === id ? value : item) }));
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
          <Card style={{ width: '100%' }} title={<Space wrap><span>{demand.content.title || demand.content.description.slice(0, 60)}</span><Tag>{TYPES.find((item) => item[0] === demand.content.type)?.[en ? 2 : 1] || t('未指定类型', 'No type')}</Tag><Tag>{demand.content.platform || t('未指定平台', 'No platform')}</Tag><Tag color={demand.status === 'completed' ? 'success' : 'processing'}>{demand.status === 'completed' ? t('已完成', 'Completed') : t('进行中', 'Open')}</Tag></Space>}
            extra={<Space><Typography.Text type="secondary">{demand.creator} → {demand.assignee || t('未分配', 'Unassigned')}</Typography.Text><Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(demand); setDraft(structuredClone(demand.content)); setAssignee(demand.assignee); }}>{t('编辑', 'Edit')}</Button></Space>}>
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
      <Form layout="vertical"><Form.Item label={t('标题（选填）', 'Title (optional)')}><Input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Form.Item>
        <Form.Item label={t('具体做图需求', 'Image production brief')} required><Input.TextArea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} rows={4} /></Form.Item>
        <Row gutter={12}><Col span={12}><Form.Item label={t('做图类型', 'Image type')}><Select allowClear value={draft.type} options={TYPES.map(([value, zh, english]) => ({ value, label: en ? english : zh }))} onChange={(type) => setDraft({ ...draft, type: type || null })} /></Form.Item></Col>
          <Col span={12}><Form.Item label={t('平台', 'Platform')}><Select allowClear value={draft.platform} options={PLATFORMS.map((value) => ({ value }))} onChange={(platform) => setDraft({ ...draft, platform: platform || null })} /></Form.Item></Col></Row>
        <Form.Item label={t('负责美工', 'Assigned artist')}><Select allowClear value={assignee} options={artists.map((item) => ({ value: item.username }))} onChange={(value) => setAssignee(value || null)} /></Form.Item>
        <Form.Item label={t('套用图片要求预设', 'Apply image preset')}><Select allowClear value={draft.presetId} options={presets.filter((item) => (!item.platform || item.platform === draft.platform) && (!item.type || item.type === draft.type)).map((item) => ({ value: item.id, label: en ? item.name : item.nameZh || item.name }))} onChange={(id) => id ? applyPreset(id) : setDraft({ ...draft, presetId: null })} /></Form.Item>
        <Divider>{t('上传图片并标记用途', 'Upload images and set their purpose')}</Divider>
        <label className="operating-upload-label"><UploadOutlined /> {t('上传图片', 'Upload images')}<input type="file" accept="image/*" multiple hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} /></label>
        <List size="small" dataSource={draft.assets} renderItem={(asset) => <List.Item actions={[<Button key="remove" danger size="small" icon={<DeleteOutlined />} onClick={() => setDraft((value) => ({ ...value, assets: value.assets.filter((item) => item.assetId !== asset.assetId) }))} />]}>
          <Space><Image width={56} height={56} style={{ objectFit: 'contain' }} src={`/api/assets/${asset.assetId}`} /><Typography.Text>{asset.name}</Typography.Text><Select value={asset.role} style={{ width: 140 }} options={[{ value: 'source', label: t('待处理原图', 'Source image') }, { value: 'reference', label: t('效果参考', 'Reference') }]} onChange={(role) => setDraft((value) => ({ ...value, assets: value.assets.map((item) => item.assetId === asset.assetId ? { ...item, role } : item) }))} /></Space>
        </List.Item>}/>
        <Form.Item label={t('通用参考链接，每行一个（选填）', 'General reference links, one per line (optional)')}><Input.TextArea value={draft.links.join('\n')} onChange={(e) => setDraft({ ...draft, links: lines(e.target.value) })} autoSize={{ minRows: 1, maxRows: 4 }} /></Form.Item>
        <Divider>{t('逐张图片要求', 'Requirements per image')}</Divider>
        {draft.specifications.map((spec, index) => <div key={spec.id}><Typography.Text strong>{t('第', 'Image ')}{index + 1}{t('张', '')}</Typography.Text><SpecificationEditor value={spec} assets={draft.assets} language={language} onChange={(value) => setSpec(spec.id, value)} onRemove={() => setDraft((previous) => ({ ...previous, specifications: previous.specifications.filter((item) => item.id !== spec.id) }))} /></div>)}
        <Button icon={<PlusOutlined />} onClick={() => setDraft((value) => ({ ...value, specifications: [...value.specifications, freshSpec()] }))}>{t('增加一张图片', 'Add image requirement')}</Button>
      </Form>
    </Drawer>
    <Drawer title={t('编辑共享预设', 'Edit shared preset')} open={presetEdit !== undefined} width="min(700px, 100vw)" onClose={() => setPresetEdit(undefined)} extra={<Button type="primary" onClick={() => void savePreset()}>{t('保存预设', 'Save preset')}</Button>}>
      {presetEdit && <Space direction="vertical" style={{ width: '100%' }}><Input value={presetEdit.name} placeholder={t('英文名称', 'English name')} onChange={(e) => setPresetEdit({ ...presetEdit, name: e.target.value })} /><Input value={presetEdit.nameZh} placeholder={t('中文名称', 'Chinese name')} onChange={(e) => setPresetEdit({ ...presetEdit, nameZh: e.target.value })} />
        <Space><Select allowClear placeholder={t('平台', 'Platform')} value={presetEdit.platform} style={{ width: 180 }} options={PLATFORMS.map((value) => ({ value }))} onChange={(platform) => setPresetEdit({ ...presetEdit, platform: platform || null })} /><Select allowClear placeholder={t('类型', 'Type')} value={presetEdit.type} style={{ width: 180 }} options={TYPES.map(([value, zh, english]) => ({ value, label: en ? english : zh }))} onChange={(type) => setPresetEdit({ ...presetEdit, type: type || null })} /></Space>
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
