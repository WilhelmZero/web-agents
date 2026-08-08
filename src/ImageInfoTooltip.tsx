import { Tooltip } from 'antd';
import { useEffect, useState, type ReactNode } from 'react';

interface ImageInfoTooltipProps {
  src?: string;
  children: ReactNode;
}

function gcd(left: number, right: number): number {
  let a = left; let b = right;
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function formatImageRatio(width: number, height: number) {
  const divisor = gcd(width, height);
  const ratioWidth = width / divisor; const ratioHeight = height / divisor;
  if (Math.max(ratioWidth, ratioHeight) <= 30) return `${ratioWidth}:${ratioHeight}`;
  return width >= height ? `${(width / height).toFixed(2)}:1` : `1:${(height / width).toFixed(2)}`;
}

export default function ImageInfoTooltip({ src, children }: ImageInfoTooltipProps) {
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSize(undefined); setFailed(false);
    if (!src) return;
    const image = new window.Image();
    image.onload = () => setSize({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => setFailed(true);
    image.src = src;
    return () => { image.onload = null; image.onerror = null; };
  }, [src]);

  const title = size
    ? `分辨率 ${size.width} × ${size.height} · 比例 ${formatImageRatio(size.width, size.height)}`
    : failed ? '无法读取图片分辨率' : '正在读取图片信息…';

  return <Tooltip title={title} mouseEnterDelay={0.15}>{children}</Tooltip>;
}
