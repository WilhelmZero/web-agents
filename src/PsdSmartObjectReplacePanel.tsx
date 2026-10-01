import { CheckCircleOutlined, DownloadOutlined, FileImageOutlined, ReloadOutlined, SafetyCertificateOutlined, UploadOutlined, WarningOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Empty, Flex, Input, Select, Space, Spin, Table, Tag, Typography, Upload, message } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import {
  parsePsdSmartObjectTemplate,
  replacePsdSmartObjects,
  type SmartObjectTargetSummary,
} from './services/psdSmartObjectReplace';

const { Paragraph, Text, Title } = Typography;

interface TemplateInfo {
  name: string;
  width: number;
  height: number;
  targets: SmartObjectTargetSummary[];
}

interface GeneratedOutput {
  psd: Blob;
  format: 'psd' | 'psb';
  png: Blob;
  previewUrl: string;
  replacedCount: number;
  warnings: string[];
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG 生成失败')), 'image/png'));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function PsdSmartObjectReplacePanel({ onSessionStateChange }: { onSessionStateChange?: (value: boolean) => void }) {
  const bufferRef = useRef<ArrayBuffer | undefined>(undefined);
  const [template, setTemplate] = useState<TemplateInfo>();
  const [prefix, setPrefix] = useState('LOGO');
  const [logos, setLogos] = useState<File[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [scanning, setScanning] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState<GeneratedOutput>();

  useEffect(() => onSessionStateChange?.(Boolean(template)), [onSessionStateChange, template]);
  useEffect(() => () => { if (output?.previewUrl) URL.revokeObjectURL(output.previewUrl); }, [output]);

  const supportedTargets = useMemo(() => template?.targets.filter((target) => target.severity !== 'blocked') || [], [template]);

  const assignDefaults = (targets: SmartObjectTargetSummary[], files: File[]) => {
    if (!files.length) return;
    setAssignments((current) => {
      const next = { ...current };
      targets.filter((target) => target.severity !== 'blocked').forEach((target, index) => {
        if (!next[target.id]) next[target.id] = files[index % files.length].name;
      });
      return next;
    });
  };

  const scan = async (buffer: ArrayBuffer, filename: string, nextPrefix = prefix) => {
    setScanning(true); setOutput(undefined);
    try {
      const parsed = await parsePsdSmartObjectTemplate(buffer, nextPrefix);
      const next = { name: filename, ...parsed };
      bufferRef.current = buffer;
      setTemplate(next);
      setAssignments({});
      assignDefaults(next.targets, logos);
      if (!next.targets.length) message.warning(`没有找到名称以“${nextPrefix}”开头的智能对象`);
      else message.success(`已扫描 ${next.targets.length} 个逻辑 Logo 位`);
    } catch (error) {
      setTemplate(undefined); bufferRef.current = undefined;
      message.error(error instanceof Error ? error.message : 'PSD 扫描失败');
    } finally { setScanning(false); }
  };

  const addLogos = (files: File[]) => {
    const byName = new Map(logos.map((file) => [file.name, file]));
    files.forEach((file) => byName.set(file.name, file));
    const next = [...byName.values()];
    setLogos(next); assignDefaults(template?.targets || [], next); setOutput(undefined);
  };

  const generate = async () => {
    if (!bufferRef.current || !template) return;
    const fileMap = new Map(logos.map((file) => [file.name, file]));
    const replacements = supportedTargets.flatMap((target) => {
      const file = fileMap.get(assignments[target.id]);
      return file ? [{ targetId: target.id, file }] : [];
    });
    if (!replacements.length) return void message.warning('请至少为一个兼容目标分配 Logo');
    setGenerating(true);
    try {
      const result = await replacePsdSmartObjects(bufferRef.current, replacements, prefix);
      const png = await canvasToBlob(result.preview);
      const psdBytes = new Uint8Array(result.psdData.byteLength); psdBytes.set(result.psdData);
      const psd = new Blob([psdBytes.buffer], { type: 'image/vnd.adobe.photoshop' });
      const previewUrl = URL.createObjectURL(png);
      setOutput((current) => {
        if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
        return { psd, format: result.format, png, previewUrl, replacedCount: result.replacedCount, warnings: result.previewWarnings };
      });
      message.success(`已替换 ${result.replacedCount} 个智能对象实例`);
    } catch (error) { message.error(error instanceof Error ? error.message : '替换失败'); }
    finally { setGenerating(false); }
  };

  const baseName = template?.name.replace(/\.(psd|psb)$/i, '') || 'template';
  const downloadPackage = async () => {
    if (!output) return;
    const zip = new JSZip();
    zip.file(`${baseName}_replaced.${output.format}`, output.psd); zip.file(`${baseName}_preview.png`, output.png);
    downloadBlob(await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' }), `${baseName}_replaced.zip`);
  };

  return <div className="psd-smart-replace-panel">
    <section className="hero-strip psd-replace-hero"><div><Text className="eyebrow">PSD SMART OBJECT REPLACER</Text><Title level={2}>免 Photoshop 替换智能对象 Logo</Title><Paragraph className="hero-description">先扫描模板兼容性，只替换可以安全处理的内嵌栅格智能对象。源文件始终不会被覆盖。</Paragraph></div><div className="hero-orb" /></section>

    <Card title={<Space><SafetyCertificateOutlined />模板兼容性扫描</Space>}>
      <Flex gap={10} wrap align="center">
        <Upload accept=".psd,.psb,image/vnd.adobe.photoshop" showUploadList={false} beforeUpload={(file) => { void file.arrayBuffer().then((buffer) => scan(buffer, file.name)); return false; }}>
          <Button icon={<UploadOutlined />} loading={scanning}>{template ? '更换 PSD / PSB' : '选择 PSD / PSB'}</Button>
        </Upload>
        <Space.Compact><Button disabled>目标图层前缀</Button><Input value={prefix} onChange={(event) => setPrefix(event.target.value)} onPressEnter={() => bufferRef.current && void scan(bufferRef.current, template?.name || 'template.psd', prefix)} style={{ width: 210 }} /></Space.Compact>
        <Button icon={<ReloadOutlined />} disabled={!bufferRef.current} onClick={() => bufferRef.current && void scan(bufferRef.current, template?.name || 'template.psd', prefix)}>重新扫描</Button>
        {template ? <Text type="secondary">{template.name} · {template.width} × {template.height}px</Text> : null}
      </Flex>
      {!template && !scanning ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传模板后会检查智能对象类型、内嵌数据、Warp 和智能滤镜" /> : null}
      {scanning ? <Flex justify="center" style={{ padding: 44 }}><Spin description="正在解析智能对象…" /></Flex> : null}
      {template ? <Table rowKey="id" pagination={false} size="small" style={{ marginTop: 16 }} dataSource={template.targets} columns={[
        { title: '目标', dataIndex: 'name', render: (name, row) => <Space orientation="vertical" size={0}><Text strong>{name}</Text><Text type="secondary" ellipsis={{ tooltip: row.path }} style={{ maxWidth: 300 }}>{row.path}</Text></Space> },
        { title: '内部画布', render: (_, row) => `${row.width} × ${row.height}` },
        { title: '实例', dataIndex: 'instanceCount', width: 72 },
        { title: '兼容性', render: (_, row) => <Space orientation="vertical" size={2}><Tag color={row.severity === 'blocked' ? 'error' : row.severity === 'warning' ? 'warning' : 'success'} icon={row.severity === 'blocked' ? <WarningOutlined /> : <CheckCircleOutlined />}>{row.severity === 'blocked' ? '已阻止' : row.severity === 'warning' ? '可替换，有预览差异' : '完全兼容'}</Tag>{row.reasons.map((reason) => <Text key={reason} type="secondary" style={{ fontSize: 12 }}>{reason}</Text>)}</Space> },
        { title: 'Logo', width: 230, render: (_, row) => <Select allowClear disabled={row.severity === 'blocked'} value={assignments[row.id]} placeholder="选择 Logo" style={{ width: '100%' }} options={logos.map((file) => ({ label: file.name, value: file.name }))} onChange={(value) => setAssignments((current) => ({ ...current, [row.id]: value }))} /> },
      ]} /> : null}
    </Card>

    {template ? <Card title={<Space><FileImageOutlined />替换素材</Space>}>
      <Flex gap={10} wrap align="center">
        <Upload accept="image/png,image/jpeg,image/webp" multiple showUploadList={false} beforeUpload={(file, files) => { if (file.uid === files[0]?.uid) addLogos(files as File[]); return false; }}><Button icon={<UploadOutlined />}>添加 Logo 图片</Button></Upload>
        <Text type="secondary">按目标顺序循环分配；同一逻辑 Logo 位的多个效果层会使用同一张图。</Text>
      </Flex>
      {logos.length ? <Flex gap={8} wrap style={{ marginTop: 12 }}>{logos.map((file) => <Tag key={file.name} closable onClose={(event) => { event.preventDefault(); setLogos((current) => current.filter((item) => item.name !== file.name)); }}>{file.name}</Tag>)}</Flex> : null}
      <Alert style={{ marginTop: 16 }} type="info" showIcon message="输出说明" description="PSD 会保留原图层结构和外层变换；PNG 是浏览器合成预览。带 Photoshop 专有效果或蒙版的模板，请以生成 PSD 在兼容编辑器中的结果为准。" />
      <Button type="primary" size="large" icon={<SafetyCertificateOutlined />} loading={generating} disabled={!supportedTargets.length || !logos.length} onClick={() => void generate()} style={{ marginTop: 16 }}>生成替换结果</Button>
    </Card> : null}

    {output ? <Card title="替换结果" extra={<Tag color="success">已替换 {output.replacedCount} 个实例</Tag>}>
      {output.warnings.length ? <Alert type="warning" showIcon message="浏览器预览存在兼容性提示" description={output.warnings.join('；')} style={{ marginBottom: 12 }} /> : null}
      <div className="psd-replace-result"><div className="transparent-grid"><img src={output.previewUrl} alt="替换后的 PSD 合成预览" /></div><Flex vertical gap={10}>
        <Button type="primary" icon={<DownloadOutlined />} onClick={() => void downloadPackage()}>下载 PSD + PNG</Button>
        <Button icon={<DownloadOutlined />} onClick={() => downloadBlob(output.psd, `${baseName}_replaced.${output.format}`)}>仅下载 {output.format.toUpperCase()}</Button>
        <Button icon={<DownloadOutlined />} onClick={() => downloadBlob(output.png, `${baseName}_preview.png`)}>仅下载 PNG 预览</Button>
      </Flex></div>
    </Card> : null}
  </div>;
}
