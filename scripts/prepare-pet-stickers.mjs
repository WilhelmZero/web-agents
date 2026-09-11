// Offline, non-generative extraction. Coordinates are manually reviewed on a
// 1600px-wide view; source RGB and alpha are copied at native resolution.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
const source = process.argv[2];
if (!source) throw new Error('Supply the original transparent sheet path');
const out = 'public/pet-letter-stickers';
await mkdir(out, { recursive: true });
const meta = await sharp(source).metadata();
const scale = meta.width / 1600;
const regions = [
  ['witch', '黑色巫师猫', 22, 34, 232, 194],
  ['pumpkin-white', '白色南瓜猫', 327, 26, 133, 177],
  ['bat-gray', '灰色蝙蝠猫', 470, 30, 154, 167],
  ['vampire-white', '白色吸血鬼猫', 645, 67, 183, 170],
  ['mummy', '木乃伊猫', 857, 29, 160, 168],
  ['bat-white', '白色蝙蝠猫', 1204, 25, 194, 176],
  ['ghost', '幽灵猫', 236, 229, 145, 162],
  ['cauldron', '坩埚猫', 383, 203, 181, 217],
  ['pumpkin-black', '黑色南瓜猫', 633, 245, 144, 166],
  ['orange', '橙色小猫', 215, 390, 162, 199],
  ['cape-black', '黑色披风猫', 430, 438, 148, 184],
  ['moon', '月亮猫', 29, 590, 172, 168],
  ['vampire-orange', '橙色吸血鬼猫', 839, 724, 123, 151],
  ['blanket', '星星毯子猫', 1269, 613, 139, 117],
  ['star', '星星', 631, 26, 27, 25, 'decoration'],
  ['candy', '糖果', 690, 27, 55, 36, 'decoration'],
  ['bat', '蝙蝠', 42, 26, 66, 40, 'decoration'],
  ['paw', '爪印', 786, 465, 40, 45, 'decoration'],
  ['skull', '小骷髅', 258, 96, 45, 57, 'decoration'],
  ['moon-small', '小月亮', 233, 20, 54, 61, 'decoration'],
  ['candy-green', '绿色糖果', 23, 74, 50, 43, 'decoration'],
  ['bow-candy', '蝴蝶糖果', 546, 183, 73, 47, 'decoration'],
  ['star-black', '黑色星星', 784, 11, 47, 48, 'decoration'],
];
const assets = [];
for (const [id, name, x, y, w, h, kind = 'character'] of regions) {
  const rect = {left: Math.round(x*scale), top: Math.round(y*scale), width: Math.round(w*scale), height: Math.round(h*scale)};
  const raw = await sharp(source).extract(rect).ensureAlpha().raw().toBuffer();
  const seen = new Uint8Array(rect.width*rect.height);
  const groups = [];
  for(let i=0;i<seen.length;i++) {
    if(seen[i] || raw[i*4+3]===0) continue;
    const stack=[i], group=[];seen[i]=1;
    while(stack.length){const p=stack.pop();group.push(p);const px=p%rect.width,py=Math.floor(p/rect.width);
      for(const q of [px>0?p-1:-1,px+1<rect.width?p+1:-1,py>0?p-rect.width:-1,py+1<rect.height?p+rect.width:-1]){
        if(q>=0&&!seen[q]&&raw[q*4+3]>0){seen[q]=1;stack.push(q);}
      }
    } groups.push(group);
  }
  groups.sort((a,b)=>b.length-a.length);
  const keep=new Uint8Array(seen.length);for(const p of groups[0]??[])keep[p]=1;
  // Transparent gaps inside eyes are preserved; unrelated floating decorations
  // are deliberately excluded rather than becoming part of a cat's sprite.
  for(let i=0;i<keep.length;i++)if(kind==='character'&&!keep[i])raw.fill(0,i*4,i*4+4);
  const blob = await sharp(raw,{raw:{width:rect.width,height:rect.height,channels:4}}).png().toBuffer();
  await writeFile(`${out}/${id}.png`, blob);
  assets.push({id, name, kind, src: `${id}.png`, width: rect.width, height: rect.height, sourceRect: rect, reviewed: true, pose: 'full'});
}
await writeFile(`${out}/manifest.json`, JSON.stringify({version:1, id:'halloween-cats-v1', name:'万圣节小猫', assets}, null, 2));
await sharp(source).png().toFile(`${out}/source.png`);
console.log(`Extracted ${assets.length} sprites, preserving native alpha`);
