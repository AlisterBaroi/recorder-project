// const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

// contextBridge.exposeInMainWorld('electronAPI', {
//     /* Save file via main process */
//     async saveRecording(blob, name) {
//         const buffer = Buffer.from(await blob.arrayBuffer());
//         return ipcRenderer.invoke('save-recording', buffer, name);
//     },

//     /* Let renderer present its own picker if it wants */
//     async getSources() {
//         return desktopCapturer.getSources({ types: ['screen', 'window', 'tab'] });
//     }
// });
const { contextBridge, ipcRenderer, desktopCapturer } = require('electron');

/* 1️⃣  show ourselves in the DevTools console */
console.log('[preload] loaded & exposing electronAPI');

/* 2️⃣  expose exactly the two functions the renderer expects */
contextBridge.exposeInMainWorld('electronAPI', {
    /** Return every screen / window / tab source */
    async getSources() {
        return desktopCapturer.getSources({ types: ['screen', 'window', 'tab'] });
    },

    /** Ask the main-process to save a Blob */
    async saveRecording(blob, fileName) {
        const buffer = Buffer.from(await blob.arrayBuffer());
        return ipcRenderer.invoke('save-recording', buffer, fileName);
    }
});
