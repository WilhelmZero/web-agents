
import {useEffect,useImperativeHandle,useMemo} from 'react';
import {render,fireEvent,screen,waitFor,cleanup} from '@testing-library/react';
import {it,expect,vi,afterEach} from 'vitest';
import BatchEngravingComposer from './BatchEngravingComposer';
import type {SavedTask} from '../services/engraving/types';
import {DEFAULTS} from '../services/engraving/processing.mjs';
const calls=vi.hoisted(()=>({start:vi.fn(),stop:vi.fn()}));
vi.mock('../CustomMonochromeLogoComposer',()=>({EngravingTaskComposer:({initialFile,onTaskState,controllerRef,scope}:{initialFile?:File;onTaskState:(v:unknown)=>void;controllerRef:React.Ref<unknown>;scope?:string})=>{
 const task=useMemo<SavedTask>(()=>({version:1,fileName:initialFile?.name||'',original:initialFile,params:{...DEFAULTS}}),[initialFile]);
 useEffect(()=>onTaskState({task,busy:false,ready:!!initialFile,loaded:true}),[task,onTaskState]);
 useImperativeHandle(controllerRef,()=>({start:async()=>{calls.start(scope||'default');},stop:()=>calls.stop(scope||'default')}));
 return <div>编辑任务：{initialFile?.name||'空'}</div>;
}}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.clearAllMocks();});
it('imports multiple files into distinct mounted tasks and starts each once',async()=>{
 vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:vi.fn(()=> 'blob:qa'),revokeObjectURL:vi.fn()}));
 const view=render(<BatchEngravingComposer openAiApiKey="test" onConfigureKey={vi.fn()}/>);
 const input=view.container.querySelector('input[type=file]')!;
 await waitFor(()=>expect(input).not.toBeDisabled());
 fireEvent.change(input,{target:{files:[new File(['a'],'A.png',{type:'image/png'}),new File(['b'],'B.png',{type:'image/png'})]}});
 await screen.findByRole('button',{name:'切换任务 A.png'});await screen.findByRole('button',{name:'切换任务 B.png'});
 expect(screen.getByText('编辑任务：B.png')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'切换任务 A.png'}));expect(screen.getByText('编辑任务：A.png')).toBeVisible();expect(screen.getByText('编辑任务：B.png')).not.toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'全部生成'}));
 await waitFor(()=>expect(calls.start).toHaveBeenCalledTimes(2));expect(new Set(calls.start.mock.calls.map(c=>c[0])).size).toBe(2);
 expect(JSON.parse(sessionStorage.getItem('custom-monochrome-logo:workspace:v1')!)).toHaveLength(2);
},20000);
