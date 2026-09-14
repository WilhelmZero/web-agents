// Rasterize in the browser image sandbox before the normal PNG worker pipeline.
export function parseSvg(text: string) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("SVG 不支持外部实体，请另存为普通 SVG。");
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const svg = doc.documentElement;
  if (svg.localName !== "svg" || doc.querySelector("parsererror")) throw new Error("SVG 文件无效。");
  for (const node of Array.from(doc.querySelectorAll("*"))) {
    if (["script", "foreignObject", "animate", "animateTransform", "set"].includes(node.localName)) node.remove();
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) node.removeAttributeNode(attr);
      if (attr.localName === "href" && !attr.value.startsWith("#") && !/^data:image\/(png|jpeg|webp);base64,/i.test(attr.value)) throw new Error("SVG 含外部资源，请先嵌入图片后导入。");
    }
  }
  if (/@import|url\(\s*['"]?(?!#)/i.test(new XMLSerializer().serializeToString(svg))) throw new Error("SVG 含外部样式或资源，请先嵌入后导入。");
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[ ,]+/).map(Number);
  const dimension = (name: string, fallback: number) => {
    const raw=svg.getAttribute(name);
    if (!raw || raw.endsWith("%")) return fallback;
    const match=raw.trim().match(/^([0-9.]+)(px|mm|cm|in|pt|pc)?$/);
    if (!match) throw new Error("SVG 尺寸无效。");
    return Number(match[1]) * ({px:1,mm:96/25.4,cm:96/2.54,in:96,pt:96/72,pc:16}[match[2] || "px"] || 1);
  };
  const width=dimension("width",vb.length===4?vb[2]:300),height=dimension("height",vb.length===4?vb[3]:150);
  if (!Number.isFinite(width*height) || width<=0 || height<=0 || width*height>40_000_000) throw new Error("SVG 尺寸无效或超过4000万像素。");
  const ratio=Math.min(1,4096/Math.max(width,height));
  const w=Math.max(1,Math.round(width*ratio)),h=Math.max(1,Math.round(height*ratio));
  svg.setAttribute("xmlns","http://www.w3.org/2000/svg");svg.setAttribute("width",String(w));svg.setAttribute("height",String(h));
  if (!svg.hasAttribute("viewBox")) svg.setAttribute("viewBox",`0 0 ${width} ${height}`);
  return {text:new XMLSerializer().serializeToString(svg),width:w,height:h};
}
export async function rasterizeSvg(file: File): Promise<Blob> {
  if (file.type !== "image/svg+xml" && !/\.svg$/i.test(file.name)) return file;
  if(file.size>20*1024*1024) throw new Error("单张图片最多20MB。");
  const svg=parseSvg(await file.text());
  const url=URL.createObjectURL(new Blob([svg.text],{type:"image/svg+xml"}));
  try {
    const image=new Image(); image.src=url; await image.decode();
    const canvas=document.createElement("canvas");canvas.width=svg.width;canvas.height=svg.height;
    const ctx=canvas.getContext("2d");if(!ctx) throw new Error("无法转换 SVG。");
    ctx.drawImage(image,0,0,svg.width,svg.height);
    return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("SVG 转换失败。")),"image/png"));
  } finally {URL.revokeObjectURL(url);}
}
