import { useEffect, useRef, useState } from "react";
import { Button, Image } from "antd";
import type { PetResult } from "../services/petStickers/types";
export default function PetStickerPreview({
  results,
  currentId,
  open,
  onOpenChange,
  onChange,
  onDownload,
}: {
  results: PetResult[];
  currentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (id: string) => void;
  onDownload: (id: string) => void;
}) {
  const cache = useRef(new Map<string, { blob: Blob; url: string }>());
  const [items, setItems] = useState<{ id: string; src: string }[]>([]);
  useEffect(() => {
    const visible = results.filter((r) => r.preview);
    const ids = new Set(visible.map((r) => r.id));
    for (const [id, c] of cache.current)
      if (!ids.has(id)) {
        URL.revokeObjectURL(c.url);
        cache.current.delete(id);
      }
    const next = visible.map((r) => {
      let c = cache.current.get(r.id);
      if (!c || c.blob !== r.preview) {
        if (c) URL.revokeObjectURL(c.url);
        c = { blob: r.preview!, url: URL.createObjectURL(r.preview!) };
        cache.current.set(r.id, c);
      }
      return { id: r.id, src: c.url };
    });
    setItems(next);
  }, [results]);
  useEffect(
    () => () => {
      for (const c of cache.current.values()) URL.revokeObjectURL(c.url);
      cache.current.clear();
    },
    [],
  );
  return (
    <Image.PreviewGroup
      items={items.map((i) => ({
        src: i.src,
        alt: results.find((r) => r.id === i.id)?.layout.letter,
      }))}
      preview={{
        open,
        onOpenChange,
        current: Math.max(
          0,
          items.findIndex((i) => i.id === currentId),
        ),
        onChange: (index) => {
          if (items[index]) onChange(items[index].id);
        },
        toolbarRender: (node) => (
          <>
            {node}
            <Button onClick={() => onDownload(currentId)}>下载原尺寸</Button>
          </>
        ),
      }}
    />
  );
}
