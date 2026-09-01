import { contextBridge } from 'electron';
contextBridge.exposeInMainWorld('mind3d', {});
