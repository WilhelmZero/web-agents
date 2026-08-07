import { CheckOutlined, DownloadOutlined, EyeInvisibleOutlined, EyeOutlined, FileImageOutlined, FileZipOutlined, LinkOutlined, SearchOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Checkbox, ColorPicker, Empty, Flex, Form, Image, Input, InputNumber, Radio, Segmented, Space, Switch, Tag, Typography, Upload } from 'antd';
import JSZip from 'jszip';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { canvasToPngBlob, parsePsdLogoLayers, renderPsdLogoLayer, safePsdLayerName, type LogoFitMode, type LogoQualityMode, type PsdLogoLayer } from './services/psdLogoExport';
import { downloadBlob } from './utils';
import { reportTaskProgress } from './services/taskProgress';

const { Title, Text, Paragraph } = Typography;
interface FileInfo { name: string; width: number; height: number }

export default function PsdLogoExportComposer({ onSessionStateChange, settingsHost }: { onSessionStateChange?: (value: boolean) => void; settingsHost?: HTMLElement | null }) {
  const { message } = App.useApp();
  const [layers, setLayers] = useState<PsdLogoLayer[]>([]); const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set()); const [activeId, setActiveId] = useState('');
  const [fileInfo, setFileInfo] = useState<FileInfo>(); const [query, setQuery] = useState(''); const [loading, setLoading] = useState(false); const [exporting, setExporting] = useState(false);
  const [exportCompleted, setExportCompleted] = useState(0); const [exportTotal, setExportTotal] = useState(0); const [exportFailed, setExportFailed] = useState(0);
  const [width, setWidth] = useState(1024); const [height, setHeight] = useState(1024); const [linked, setLinked] = useState(true); const [mode, setMode] = useState<LogoFitMode>('contain'); const [quality, setQuality] = useState<LogoQualityMode>('sharp'); const [background, setBackground] = useState<string | null>(null); const [pattern, setPattern] = useState('{layerName}');
  const active = layers.find((layer) => layer.id === activeId) || layers[0]; const shown = useMemo(() => layers.filter((layer) => `${layer.name} ${layer.path}`.toLowerCase().includes(query.toLowerCase())), [layers, query]);
  useEffect(() => onSessionStateChange?.(layers.length > 0), [layers.length, onSessionStateChange]);
  useEffect(() => { reportTaskProgress({ id: 'logo-export', label: '批量导出 Logo', completed: exportCompleted, total: exportTotal, failed: exportFailed, running: exporting }); }, [exportCompleted, exportTotal, exportFailed, exporting]);
  const reset = () => { setLayers([]); setSelectedIds(new Set()); setActiveId(''); setFileInfo(undefined); setQuery(''); setBackground(null); };
  const load = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.psd')) { message.error('请选择 PSD 文件'); return false; }
    setLoading(true);
    try {
      const { psd, layers: parsed } = parsePsdLogoLayers(await file.arrayBuffer()); if (!parsed.length) throw new Error('未找到可导出的像素图层');
      const maxWidth = Math.max(...parsed.map((layer) => layer.width)); const maxHeight = Math.max(...parsed.map((layer) => layer.height));
      setLayers(parsed); setSelectedIds(new Set(parsed.map((layer) => layer.id))); setActiveId(parsed[0].id); setWidth(maxWidth); setHeight(maxHeight); setFileInfo({ name: file.name, width: psd.width, height: psd.height }); message.success(`已读取 ${parsed.length} 个像素图层`);
    } catch (error) { message.error(error instanceof Error ? `PSD 解析失败：${error.message}` : 'PSD 解析失败'); }
    finally { setLoading(false); }
    return false;
  };
  const changeWidth = (value: number | null) => { const next = Math.min(8192, Math.max(1, value || 1)); if (linked) setHeight(Math.max(1, Math.round(height * next / width))); setWidth(next); };
  const changeHeight = (value: number | null) => { const next = Math.min(8192, Math.max(1, value || 1)); if (linked) setWidth(Math.max(1, Math.round(width * next / height))); setHeight(next); };
  const toggle = (id: string) => setSelectedIds((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const exportAll = async () => {
    const targets = layers.filter((layer) => selectedIds.has(layer.id)); if (!targets.length) return void message.warning('请至少选择一个图层');
    setExporting(true); setExportCompleted(0); setExportTotal(targets.length); setExportFailed(0);
    try {
      const zip = new JSZip(); const used = new Set<string>();
      for (let index = 0; index < targets.length; index += 1) {
        const layer = targets[index]; const base = safePsdLayerName(pattern.replaceAll('{layerName}', layer.name).replaceAll('{index}', String(index + 1).padStart(2, '0'))); let filename = `${base}.png`; let suffix = 2;
        while (used.has(filename.toLowerCase())) filename = `${base}-${suffix++}.png`; used.add(filename.toLowerCase());
        zip.file(filename, await canvasToPngBlob(await renderPsdLogoLayer(layer.canvas, width, height, mode, quality, background)));
        setExportCompleted(index + 1);
      }
      downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${safePsdLayerName(fileInfo?.name.replace(/\.psd$/i, '') || 'logos')}-${width}x${height}.zip`); message.success(`已导出 ${targets.length} 个 PNG`);
    } catch (error) { setExportFailed(1); message.error(error instanceof Error ? error.message : '导出失败'); }
    finally { setExporting(false); }
  };
  const upscale = active ? (mode === 'cover' ? Math.max(width / active.width, height / active.height) : Math.min(width / active.width, height / active.height)) : 1;
  const settings = <div className="settings-panel psd-export-settings"><Title level={4}>导出设置</Title><Form layout="vertical">
    <Form.Item label="画布大小"><Flex gap={8} align="center"><InputNumber aria-label="导出宽度" min={1} max={8192} value={width} onChange={changeWidth} addonAfter="px" /><LinkOutlined style={{ color: linked ? '#7c3aed' : '#999' }} /><InputNumber aria-label="导出高度" min={1} max={8192} value={height} onChange={changeHeight} addonAfter="px" /></Flex><Flex justify="space-between" style={{ marginTop: 10 }}><Text>保持比例</Text><Switch checked={linked} onChange={setLinked} /></Flex></Form.Item>
    <Form.Item label="适配方式"><Segmented block value={mode} onChange={(value) => setMode(value as LogoFitMode)} options={[{ value: 'contain', label: '适应' }, { value: 'cover', label: '填充' }, { value: 'stretch', label: '拉伸' }]} /><Text type="secondary" className="field-help">{mode === 'contain' ? '完整显示图层，空白保持透明' : mode === 'cover' ? '铺满画布并裁切超出部分' : '图层拉伸至指定尺寸'}</Text></Form.Item>
    <Form.Item label="清晰度"><Radio.Group block optionType="button" buttonStyle="solid" value={quality} onChange={(event) => setQuality(event.target.value)} options={[{ value: 'sharp', label: 'Logo 清晰' }, { value: 'smooth', label: '平滑' }, { value: 'pixel', label: '像素' }]} /></Form.Item>
    {upscale > 2 && <Alert type="warning" showIcon title={`当前图层将放大约 ${upscale.toFixed(1)} 倍`} description="高质量缩放能优化边缘，但无法恢复 PSD 中不存在的细节。" style={{ marginBottom: 16 }} />}
    <Form.Item label="画布背景"><Segmented block value={background ? 'color' : 'transparent'} onChange={(value) => setBackground(value === 'color' ? background || '#ffffff' : null)} options={[{ value: 'transparent', label: '透明' }, { value: 'color', label: '纯色' }]} />{background && <ColorPicker showText value={background} onChange={(_, hex) => setBackground(hex)} style={{ marginTop: 10, width: '100%' }} />}</Form.Item>
    <Form.Item label="文件命名" extra="可使用 {layerName} 和 {index}"><Input value={pattern} onChange={(event) => setPattern(event.target.value)} /></Form.Item>
    <Card size="small"><Flex gap={10} align="center"><div className="transparent-swatch" style={background ? { background } : undefined} /><div><Text type="secondary">输出格式</Text><br /><Text strong>PNG · {background ? background.toUpperCase() : '透明背景'}</Text></div></Flex></Card>
    <Button block type="primary" size="large" icon={<DownloadOutlined />} loading={exporting} disabled={!selectedIds.size} onClick={() => void exportAll()} style={{ marginTop: 18 }}>导出 {selectedIds.size} 个图层</Button><Button block onClick={reset} style={{ marginTop: 8 }}>重新选择 PSD</Button>
  </Form></div>;
  return <div className="psd-logo-export-composer">{settingsHost && createPortal(settings, settingsHost)}
    <section className="hero-strip psd-export-hero"><div><Text className="eyebrow">PSD LOGO EXPORTER</Text><Title level={2}>批量导出 Logo 图层</Title><Paragraph className="hero-description">浏览器本地解析 PSD，将包括隐藏图层在内的像素图层批量导出为透明 PNG。</Paragraph></div><div className="hero-orb" /></section>
    <Card className="workflow-card" title={<Space><span className="step-badge">1</span>选择 PSD 文件</Space>} extra={fileInfo && <Tag color="success" icon={<CheckOutlined />}>{fileInfo.width} × {fileInfo.height}px</Tag>}>
      {!layers.length ? <Upload.Dragger accept=".psd,image/vnd.adobe.photoshop" showUploadList={false} beforeUpload={(file) => { void load(file as File); return false; }} disabled={loading}><p className="ant-upload-drag-icon"><FileZipOutlined /></p><p className="ant-upload-text">拖拽或点击选择 PSD 文件</p><p className="ant-upload-hint">文件仅在当前浏览器本地解析，不会上传</p></Upload.Dragger> : <Alert type="success" showIcon title={fileInfo?.name} description={`已识别 ${layers.length} 个可导出像素图层，包含隐藏图层和组内图层。`} />}
    </Card>
    {layers.length ? <div className="psd-export-workspace"><Card className="psd-layer-panel" title={<Flex justify="space-between"><span>图层</span><Button size="small" onClick={() => setSelectedIds(selectedIds.size === layers.length ? new Set() : new Set(layers.map((layer) => layer.id)))}>{selectedIds.size === layers.length ? '取消全选' : '全选'} · {selectedIds.size}/{layers.length}</Button></Flex>}><Input prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索图层" allowClear /><div className="psd-layer-list">{shown.map((layer) => <div key={layer.id} className={`psd-layer-row${active?.id === layer.id ? ' is-active' : ''}`}><Checkbox checked={selectedIds.has(layer.id)} onChange={() => toggle(layer.id)} /><button type="button" onClick={() => setActiveId(layer.id)}><span>{layer.hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}</span><span className="transparent-grid"><img src={layer.previewUrl} alt="" /></span><span><Text strong ellipsis={{ tooltip: layer.path }}>{layer.name}</Text><Text type="secondary">{layer.width} × {layer.height}</Text></span></button></div>)}{!shown.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配图层" />}</div></Card>
      <Card className="psd-preview-panel" title="透明图层预览" extra={active && <Text type="secondary">{active.width} × {active.height}px</Text>}>{active ? <div className="psd-preview-canvas" style={background ? { background } : undefined}><Image src={active.previewUrl} alt={`${active.name} 预览`} /></div> : <Empty />}</Card></div> : null}
    {!settingsHost && <aside className="logo-settings">{settings}</aside>}
  </div>;
}
