import { EyeOutlined } from '@ant-design/icons';
import { Image, Tooltip } from 'antd';
import { cloneElement, useState, type ComponentProps, type ReactElement } from 'react';

interface Props extends Omit<ComponentProps<typeof Image>, 'preview'> {
  originalSrc?: string;
  originalAlt?: string;
}

export default function OriginalCompareImage({ originalSrc, originalAlt = '原图', ...imageProps }: Props) {
  const [showOriginal, setShowOriginal] = useState(false);
  if (!originalSrc) return <Image {...imageProps} />;
  return <Image {...imageProps} preview={{
    onOpenChange: (open) => { if (!open) setShowOriginal(false); },
    actionsRender: (originalNode) => <>{originalNode}<Tooltip title={showOriginal ? '查看生成图' : '查看原图'}><button type="button" className={showOriginal ? 'scene-preview-compare-action is-active' : 'scene-preview-compare-action'} onClick={() => setShowOriginal((current) => !current)}><EyeOutlined /></button></Tooltip></>,
    imageRender: (originalNode) => showOriginal ? cloneElement(originalNode as ReactElement<{ src?: string; alt?: string }>, { src: originalSrc, alt: originalAlt }) : originalNode,
  }} />;
}
