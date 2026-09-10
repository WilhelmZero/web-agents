
import {expect,it,vi,afterEach} from 'vitest';
import {runTaskQueue} from './task-queue';
import {expansionInsets,prepareOutpaint} from './outpaint';
import {buildPrompt} from './prompts.mjs';
import {buildReviewPrompt} from './quality-review.mjs';
import {DEFAULTS} from './processing.mjs';
afterEach(()=>vi.unstubAllGlobals());
it('caps concurrency, isolates failures and stops queued work',async()=>{
 let active=0,max=0,cancelled=false;const release:(()=>void)[]=[],started:string[]=[];
 const items=['a','b','c','d'].map(id=>({id,run:async()=>{started.push(id);active++;max=Math.max(max,active);await new Promise<void>(r=>release.push(r));active--;if(id==='a')throw Error('failed');}}));
 const status=vi.fn();const p=runTaskQueue(items,2,()=>cancelled,status);expect(started).toEqual(['a','b']);
 release[0]();await vi.waitFor(()=>expect(started).toEqual(['a','b','c']));cancelled=true;release[1]();release[2]();await p;
 expect(max).toBe(2);expect(started).not.toContain('d');expect(status).toHaveBeenCalledWith('a','failed');expect(status).toHaveBeenCalledWith('b','done');
});
it('creates real directional padding and closes image resources',async()=>{
 let dims:number[]=[];const draw=vi.fn(),close=vi.fn(),image=new Blob(['image']),padded=new Blob(['padded']);
 vi.stubGlobal('createImageBitmap',vi.fn(async()=>({width:100,height:200,close})));
 vi.stubGlobal('OffscreenCanvas',class{constructor(w:number,h:number){dims=[w,h];}getContext(){return{drawImage:draw};}convertToBlob(){return Promise.resolve(padded);}});
 expect(await prepareOutpaint(image,{enabled:false,instructions:''})).toBe(image);expect(createImageBitmap).not.toHaveBeenCalled();
 expect(await prepareOutpaint(image,{enabled:true,instructions:'右侧'})).toBe(padded);expect(dims).toEqual([152,248]);expect(close).toHaveBeenCalled();expect(expansionInsets('').left).toBe(.25);
 const prompt=buildPrompt({hasReference:true,editMode:true,outpaint:{enabled:true,instructions:'右侧'}});expect(prompt).toContain('original frame is NOT a crop boundary');expect(prompt).toContain('Do not merely shrink');
 expect(buildReviewPrompt(DEFAULTS,'',{enabled:true,instructions:'右侧'})).toContain('set subjects below 60');
});
