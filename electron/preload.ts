import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopApi, DesktopCreateJobRequest, DesktopResourceSnapshot } from '../src/desktop/types';

const api: DesktopApi = {
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickOutputDirectory: () => ipcRenderer.invoke('desktop:pick-output'),
  pickInputDirectory: () => ipcRenderer.invoke('desktop:pick-input'),
  getRuntimeInfo: () => ipcRenderer.invoke('desktop:runtime-info'),
  setLaunchAtLogin: (value) => ipcRenderer.invoke('desktop:set-launch-at-login', value),
  getSecretState: () => ipcRenderer.invoke('desktop:secret-state'),
  setSecrets: (value) => ipcRenderer.invoke('desktop:set-secrets', value),
  createJob: (request: DesktopCreateJobRequest) => ipcRenderer.invoke('desktop:create-job', request),
  listJobs: () => ipcRenderer.invoke('desktop:list-jobs'),
  getJobItems: (jobId) => ipcRenderer.invoke('desktop:job-items', jobId),
  getJobEvents: (jobId) => ipcRenderer.invoke('desktop:job-events', jobId),
  pauseJob: (jobId) => ipcRenderer.invoke('desktop:pause-job', jobId),
  resumeJob: (jobId) => ipcRenderer.invoke('desktop:resume-job', jobId),
  cancelJob: (jobId) => ipcRenderer.invoke('desktop:cancel-job', jobId),
  retryJob: (jobId) => ipcRenderer.invoke('desktop:retry-job', jobId),
  pauseAll: () => ipcRenderer.invoke('desktop:pause-all'), resumeAll: () => ipcRenderer.invoke('desktop:resume-all'),
  revealPath: (path) => ipcRenderer.invoke('desktop:reveal-path', path), openPath: (path) => ipcRenderer.invoke('desktop:open-path', path),
  readThumbnail: (path) => ipcRenderer.invoke('desktop:read-thumbnail', path),
  getResourceSnapshot: () => ipcRenderer.invoke('desktop:resource-snapshot'),
  onJobsChanged(callback) { const listener = () => callback(); ipcRenderer.on('desktop:jobs-changed', listener); return () => ipcRenderer.removeListener('desktop:jobs-changed', listener); },
  onResourcesChanged(callback) { const listener = (_event: Electron.IpcRendererEvent, snapshot: DesktopResourceSnapshot) => callback(snapshot); ipcRenderer.on('desktop:resources-changed', listener); return () => ipcRenderer.removeListener('desktop:resources-changed', listener); },
};

contextBridge.exposeInMainWorld('desktop', api);
