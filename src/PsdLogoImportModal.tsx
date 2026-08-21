import { EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { Alert, Button, Checkbox, Empty, Flex, Image, Modal, Segmented, Spin, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { canvasToPngBlob, defaultPsdLogoLayerIds, parsePsdLogoLayers, safePsdLayerName, type PsdLogoLayer } from './services/psdLogoExport';

const { Text } = Typography;
const MAX_PSD_SIZE = 200 * 1024 * 1024;

export default function PsdLogoImportModal({ file, onClose, onImport }: { file?: File; onClose: () => void; onImport: (files: File[]) => void }) {
  const [layers, setLayers] = useState<PsdLogoLayer[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [previewBackground, setPreviewBackground] = useState('transparent');

  useEffect(() => {
    if (!file) { setLayers([]); setSelectedIds(new Set()); setError(''); return; }
    let cancelled = false;
    setLoading(true); setError(''); setLayers([]);
    void (async () => {
      try {
        if (!file.size || file.size > MAX_PSD_SIZE) throw new Error('PSD 文件需小于 200MB 且不能为空');
        const parsed = parsePsdLogoLayers(await file.arrayBuffer()).layers;
        if (!parsed.length) throw new Error('未找到可导入的像素图层');
        if (!cancelled) { setLayers(parsed); setSelectedIds(defaultPsdLogoLayerIds(parsed)); }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'PSD 解析失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  const importLayers = async () => {
    const selected = layers.filter((layer) => selectedIds.has(layer.id));
    if (!selected.length) return;
    setImporting(true);
    try {
      const files = await Promise.all(selected.map(async (layer) => new File([await canvasToPngBlob(layer.canvas)], `${safePsdLayerName(layer.name)}.png`, { type: 'image/png' })));
      onImport(files);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'PSD 图层导入失败');
    } finally {
      setImporting(false);
    }
  };

  return <Modal title={`选择要导入的 PSD Logo 图层${file ? ` · ${file.name}` : ''}`} open={Boolean(file)} width={920} okText={`导入 ${selectedIds.size} 个 Logo`} cancelText="取消" confirmLoading={importing} okButtonProps={{ disabled: loading || Boolean(error) || !selectedIds.size }} onOk={() => void importLayers()} onCancel={onClose}>
    <Alert type="info" showIcon title="图层按原始分辨率导入，背景保持透明" description="隐藏图层也会显示并默认选中；名称为“背景”的图层默认不选。" style={{ marginBottom: 14 }} />
    {error ? <Alert type="error" showIcon title="PSD 解析失败" description={error} /> : loading ? <Flex justify="center" align="center" style={{ minHeight: 220 }}><Spin tip="正在解析 PSD 图层…" /></Flex> : layers.length ? <>
      <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 12 }}><Text type="secondary">已选择 {selectedIds.size}/{layers.length}</Text><Flex gap={8} align="center" wrap><Text type="secondary">预览底色</Text><Segmented size="small" value={previewBackground} onChange={(value) => setPreviewBackground(String(value))} options={[{ label: '透明棋盘格', value: 'transparent' }, { label: '白底', value: '#ffffff' }, { label: '黑底', value: '#000000' }]} /><Button size="small" onClick={() => setSelectedIds(selectedIds.size === layers.length ? new Set() : new Set(layers.map((layer) => layer.id)))}>{selectedIds.size === layers.length ? '取消全选' : '全选'}</Button></Flex></Flex>
      <Image.PreviewGroup><div className="psd-logo-import-list">{layers.map((layer) => <label key={layer.id} className="psd-logo-import-row"><Checkbox checked={selectedIds.has(layer.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); event.target.checked ? next.add(layer.id) : next.delete(layer.id); return next; })} /><span className={`psd-logo-layer-preview${previewBackground === 'transparent' ? ' logo-checkerboard' : ''}`} style={previewBackground === 'transparent' ? undefined : { backgroundColor: previewBackground }} onClick={(event) => event.preventDefault()}><Image src={layer.previewUrl} alt={`${layer.name} 图层预览`} preview={{ mask: <><EyeOutlined /> 放大</> }} /></span><span className="psd-logo-import-copy"><Text strong ellipsis={{ tooltip: layer.path }}>{layer.name}</Text><Text type="secondary">{layer.width} × {layer.height}px · {layer.hidden ? '隐藏图层' : '可见图层'}</Text></span>{layer.hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}</label>)}</div></Image.PreviewGroup>
    </> : <Empty description="没有可导入图层" />}
  </Modal>;
}
