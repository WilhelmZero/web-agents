import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
const root='public/pet-letter-stickers';
const generated='C:/Users/Tangson/.codex/generated_images/01a02de9-760e-7c81-b03e-14d2cbeb5733';
const poses=[
 ['witch-top','witch','exec-0ff18ef9-28ab-489a-8091-7d94905fde10.png',.65,.88],
 ['witch-side','witch','exec-f908584c-4790-443e-80c0-9d6707fc3fad.png',.14,.53],
 ['vampire-top','vampire-white','exec-871585bf-1ba5-4683-8ff6-9928a0c40ba3.png',.30,.80],
 ['vampire-side','vampire-white','exec-f7198231-0da7-4132-9d7e-ff77632de8e7.png',.12,.49],
 ['orange-top','orange','exec-a42dd5fc-730e-489b-a729-10702a4f9984.png',.28,.81],
 ['orange-side','orange','exec-4f7b8c67-8c58-431b-a385-dcc267815c39.png',.12,.50],
];
const manifest=JSON.parse(await readFile(`${root}/manifest.json`,'utf8'));
manifest.assets=manifest.assets.filter(a=>a.pose==='full');
for(const [id,characterId,file,cx,cy] of poses){
 const {data,info}=await sharp(`${generated}/${file}`).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 // Chroma key is explicit and absent from these reviewed character palettes.
 for(let i=0;i<data.length;i+=4){
  const chroma=Math.min(data[i],data[i+2])-data[i+1];
  const coverage=1-Math.max(0,Math.min(1,(chroma-65)/130));
  if(coverage<.01){data.fill(0,i,i+4);continue;}
  if(coverage<1){data[i]=Math.max(0,Math.min(255,(data[i]-255*(1-coverage))/coverage));data[i+2]=Math.max(0,Math.min(255,(data[i+2]-255*(1-coverage))/coverage));data[i+3]=Math.round(coverage*255);}
 }
 const png=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).trim({background:'#00000000',threshold:2}).png().toBuffer();
 const m=await sharp(png).metadata();
 await writeFile(`${root}/${id}.png`,png);
 // Store complementary layers. Only a small manually annotated belly area may
 // pass behind the letter. Faces, ears, whiskers and gripping paws stay in front.
 const raw=await sharp(png).raw().toBuffer();const front=Buffer.from(raw),rear=Buffer.from(raw);
 const top=id.endsWith('-top');
 for(let y=0;y<m.height;y++)for(let x=0;x<m.width;x++){
  const p=(y*m.width+x)*4;
  const nx=x/m.width,ny=y/m.height;
  const occluded=top?(nx>.48&&nx<.56&&ny>.82&&ny<.88):(nx>.23&&nx<.29&&ny>.69&&ny<.76);
  const isFront=!occluded;
  (isFront?rear:front).fill(0,p,p+4);
 }
 for(const [suffix,bytes]of [['front',front],['rear',rear]])await sharp(bytes,{raw:{width:m.width,height:m.height,channels:4}}).png().toFile(`${root}/${id}-${suffix}.png`);
 manifest.assets.push({id,name:`${manifest.assets.find(a=>a.id===characterId).name} · ${top?'趴顶':'抱边'}`,characterId,kind:'character',pose:top?'top':'side',reviewed:true,src:`${id}.png`,frontSrc:`${id}-front.png`,rearSrc:`${id}-rear.png`,width:m.width,height:m.height,contact:{x:cx,y:cy},reviewNotes:'人工检查：眼睛、耳朵、爪子、尾巴与服装一致；后腿自然重叠。临时品红底已分离；排版只允许接触区域遮挡。'});
}
await writeFile(`${root}/manifest.json`,JSON.stringify(manifest,null,2));
console.log('Prepared six pose masters and complementary layers');
