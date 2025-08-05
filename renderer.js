const { ipcRenderer } = require('electron');
const { desktopCapturer } = require('electron');   // still used to build stream
const { dialog, BrowserWindow, screen } = require('@electron/remote');
const fs = require('fs');
const parent = require('@electron/remote').getCurrentWindow();
// To save in MP4 format
const ffmpegPath = require('ffmpeg-static-electron').path;
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const recBtn = document.querySelector('.rec-btn');
const stopBtn = document.querySelector('.stop-btn');
const settingsBtn = document.querySelector('.settings-btn');
const clock = document.getElementById('clock');

let prefs = await ipcRenderer.invoke('get-settings');  // load json once

/* apply remembered screen / format / folder */
selectedSourceId = prefs.selectedScreenId || null;
let defaultFolder = prefs.saveFolder || null;
let videoFormat = prefs.videoFormat || 'webm';

let mediaRecorder, chunks = [];
let selectedSourceId = null, timerRef, t0;

/* helpers */
const pad = n => String(Math.floor(n)).padStart(2, '0');
const hms = ms => { const s = ms / 1000 | 0; return `${pad(s / 3600)} : ${pad((s / 60) % 60)} : ${pad(s % 60)}` };
const lock = () => {
    recBtn.disabled = true;
    recBtn.style.pointerEvents = 'none'; // block any further clicks
    recBtn.style.cursor = 'not-allowed';
    recBtn.style.backgroundImage = "url('img/Record-Button-Activate.svg')";
    clock.style.color = '#AF2031';
};
const unlock = () => {
    recBtn.disabled = false;
    recBtn.style.pointerEvents = 'auto';  // re‑enable clicks
    recBtn.style.cursor = ''; // reset cursor
    recBtn.style.backgroundImage = "";
    clock.style.color = '#D9D9D9';
};

/* ask main‑process to open picker window and return chosen screen id */
async function pickScreen() {
    selectedSourceId = await ipcRenderer.invoke('pick-screen').catch(() => null);
    if (selectedSourceId) console.log('Chosen screen id', selectedSourceId);
}

function streamFor(id) {
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxFrameRate: 30 } }
    });
}

async function startRec() {
    if (mediaRecorder?.state === 'recording') return;
    if (!selectedSourceId) await pickScreen();
    if (!selectedSourceId) return; // user cancelled
    try {
        const stream = await streamFor(selectedSourceId);

        // mediaRecorder = new MediaRecorder(stream);
        const useMp4 = videoFormat === 'mp4';
        const MP4 = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        // const mediaOpts = MediaRecorder.isTypeSupported(MP4) ? { mimeType: MP4 } : {};
        const mediaOpts = useMp4 && MediaRecorder.isTypeSupported(MP4) ? { mimeType: MP4 } : {};
        mediaRecorder = new MediaRecorder(stream, mediaOpts);
        chunks = [];
        mediaRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        mediaRecorder.onstop = saveFile;


        mediaRecorder.start();
        lock();

        t0 = Date.now();
        timerRef = setInterval(() => clock.textContent = hms(Date.now() - t0), 1000);
    } catch (err) { console.error(err); }
}
// Saving in WebM format
// async function saveFile() {
//     clearInterval(timerRef);
//     clock.textContent = '00 : 00 : 00';
//     unlock();
//     // const blob = new Blob(chunks, { type: 'video/webm' });
//     // const buffer = Buffer.from(await blob.arrayBuffer());
//     // const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: `recording-${Date.now()}.webm` });
//     // if (!canceled && filePath) fs.writeFileSync(filePath, buffer);
//     const fullMime = mediaRecorder.mimeType || 'video';
//     // const fullMime = mediaRecorder.mimeType || 'video/webm';
//     const ext = fullMime.includes('mp4') ? 'mp4' : 'webm';
//     const blob = new Blob(chunks, { type: fullMime });
//     const buffer = Buffer.from(await blob.arrayBuffer());

//     const { canceled, filePath } = await dialog.showSaveDialog({
//         defaultPath: `recording-${Date.now()}.${ext}`,
//         filters: [{ name: 'Video', extensions: [ext] }]
//     });
//     if (!canceled && filePath) fs.writeFileSync(filePath, buffer);
// }

// Saving recording in MP4 format
// async function saveFile() {
//     clearInterval(timerRef); clock.textContent = '00 : 00 : 00'; unlock();

//     /* Save the raw capture (WebM or MP4) to a temp file */
//     const fullMime = mediaRecorder.mimeType || 'video/webm';
//     const srcExt = fullMime.includes('mp4') ? 'mp4' : 'webm';
//     const tempRaw = path.join(os.tmpdir(), `capture-${Date.now()}.${srcExt}`);
//     fs.writeFileSync(tempRaw, Buffer.from(await new Blob(chunks, { type: fullMime }).arrayBuffer()));

//     /* Ask where to put the final MP4 */
//     const { canceled, filePath } = await dialog.showSaveDialog({
//         defaultPath: `recording-${Date.now()}.mp4`,
//         filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
//     });
//     if (canceled || !filePath) { fs.unlinkSync(tempRaw); return; }

//     /* If we ALREADY recorded MP4, just rename / copy */
//     if (srcExt === 'mp4') {
//         fs.copyFileSync(tempRaw, filePath.endsWith('.mp4') ? filePath : `${filePath}.mp4`); fs.unlinkSync(tempRaw); return;
//     }

//     /* Otherwise transcode with the bundled FFmpeg */
//     const args = [
//         '-i', tempRaw,
//         '-c:v', 'libx264',      // H.264
//         '-preset', 'veryfast',
//         '-crf', '22',
//         '-c:a', 'aac',
//         '-b:a', '192k',
//         '-movflags', '+faststart',
//         filePath
//     ];

//     // Only log warnings and errors
//     const ff = spawn(ffmpegPath, ['-loglevel', 'warning', ...args], { stdio: 'ignore' });

//     // Default terminal output during transcoding
//     // const ff = spawn(ffmpegPath, args, { stdio: 'inherit' });

//     // ff.on('close', code => {
//     //     fs.unlinkSync(tempRaw);
//     //     if (code !== 0) dialog.showErrorBox('FFmpeg error', `Transcoding failed (code ${code}).`);
//     // });

//     ff.stderr.on('data', d => {
//         const m = /time=(\\d+):(\\d+):(\\d+\\.\\d+)/.exec(d.toString());
//         if (m) /* update UI */;
//     });

// }


async function saveFile() {
    clearInterval(timerRef); clock.textContent = '00 : 00 : 00'; unlock();

    /* ── 1. write raw capture (webm/mp4) to a temp file ───────────────── */
    const fullMime = mediaRecorder.mimeType || 'video/webm';

    // const srcExt = fullMime.includes('mp4') ? 'mp4' : 'webm';
    // const tmpSrc = path.join(os.tmpdir(), `capture-${Date.now()}.${srcExt}`);
    // fs.writeFileSync(tmpSrc, Buffer.from(await new Blob(chunks, { type: fullMime }).arrayBuffer()));
    const ext = fullMime.includes('mp4') ? 'mp4' : 'webm';
    const rawBlob = new Blob(chunks, { type: fullMime });
    const tempFile = path.join(os.tmpdir(), `capture-${Date.now()}.${ext}`);
    fs.writeFileSync(tempFile, Buffer.from(await rawBlob.arrayBuffer()));

    // /* 2. ask where to save the final MP4 */
    // const { canceled, filePath } = await dialog.showSaveDialog({
    //     defaultPath: `recording-${Date.now()}.mp4`,
    //     filters: [{ name: 'MP4 video', extensions: ['mp4'] }]
    // });
    // if (canceled || !filePath) { fs.unlinkSync(tmpSrc); return; }
    // /* 3. if already mp4, just copy */
    // if (srcExt === 'mp4') {
    //     fs.copyFileSync(tmpSrc, filePath);
    //     fs.unlinkSync(tmpSrc);
    //     return;
    // }

    /* default folder logic */
    const startDir = defaultFolder || os.homedir();
    const dlg = await dialog.showSaveDialog({
        defaultPath: path.join(startDir, `recording-${Date.now()}.${ext}`),
        filters: [{ name: 'Video', extensions: [ext] }]
    });
    if (dlg.canceled) { fs.unlinkSync(tempFile); return; }
    const finalPath = dlg.filePath;

    /* 4. show a small progress window */
    const parent = require('@electron/remote').getCurrentWindow();
    const { width } = screen.getPrimaryDisplay().workArea;
    // const progressWin = new BrowserWindow({
    //     width: 320, height: 80,
    //     frame: false,
    //     resizable: false,
    //     modal: true,
    //     parent,
    //     alwaysOnTop: true,
    //     movable: false,
    //     minimizable: false,
    //     webPreferences: { nodeIntegration: true, contextIsolation: false }
    // });
    const progressWin = new BrowserWindow({
        width: 320, height: 80, resizable: false, modal: true, parent,
        transparent: true, backgroundColor: '#00000000', frame: false, titleBarStyle: 'hidden',
        alwaysOnTop: true, center: true, webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    progressWin.center(); progressWin.setMenuBarVisibility(false);
    //     const html = `
    //   <html><body style="margin:10px;background:#1e1e1e;color:#ddd;
    //                      font-family:sans-serif;display:flex;flex-direction:column;
    //                      align-items:center;justify-content:center">
    //       <div>Saving MP4… <span id="pct">0</span>%</div>
    //       <progress id="bar" value="0" max="1" style="width:90%;height:6px"></progress>
    //   </body></html>
    // `;
    //     progressWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    progressWin.loadFile('progress.html');   // ← use the new standalone file
    // progressWin.loadURL(`data:text/html,
    // <html>
    //     <body style="margin:0;background:#1e1e1e;color:#ddd;
    //                    font-family:sans-serif;display:flex;flex-direction:column;
    //                    align-items:center;justify-content:center">
    //             <div>Saving MP4… 
    //                 <span id=pct>0</span>%
    //             </div>
    //         <progress id=bar style="width:90%;height:6px">
    //         </progress>
    //     </body>
    // </html>`);

    /* 5. run FFmpeg with progress output */
    const args = [
        '-i', tmpSrc,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
        '-c:a', 'aac', '-b:a', '192k',
        '-movflags', '+faststart',
        '-progress', 'pipe:1',        // key=value lines on stdout
        '-nostats',                   // suppress the console bar
        filePath
    ];

    const ff = spawn(ffmpegPath, args);

    /* total duration of source (secs) — ffprobe is over-kill; parse MediaRecorder time: */
    const totalMs = Date.now() - t0;         // VERY close approximation

    ff.stdout.on('data', d => {
        const m = /out_time_ms=(\d+)/.exec(d.toString());
        if (m) {
            const done = Math.min(+m[1] / (totalMs * 1000), 1);   // 0 → 1
            progressWin.webContents.send('progress', done);       // <<< send to html
        }
    });

    // ff.stdout.on('data', d => {
    //     // out_time_ms gives microseconds encoded so far
    //     const m = /out_time_ms=(\d+)/.exec(d.toString());
    //     if (m) {
    //         const micros = Number(m[1]);
    //         const done = Math.min(micros / (totalMs * 1000), 1);  // micro ➜ milli
    //         progressWin.webContents.executeJavaScript(`
    //   document.getElementById('bar').value = ${done};
    //   document.getElementById('pct').textContent = ${(done * 100).toFixed(0)};
    // `);
    //     }
    // });

    ff.on('close', code => {
        fs.unlinkSync(tmpSrc);
        progressWin.close();
        if (code !== 0)
            dialog.showErrorBox('FFmpeg error', `Transcoding failed (code ${code}).`);
    });

    /* remember folder & screen for next run */
    defaultFolder = path.dirname(finalPath);
    prefs.saveFolder = defaultFolder;
    prefs.selectedScreenId = selectedSourceId;
    prefs.videoFormat = videoFormat;

    ipcRenderer.invoke('settings-save', prefs);   // persist to JSON
}





const closeBtn = document.querySelector('.close-btn');
// settingsBtn.addEventListener('click', pickScreen);
settingsBtn.addEventListener('click', () => ipcRenderer.invoke('open-settings'));
recBtn.addEventListener('click', startRec);
stopBtn.addEventListener('click', () => mediaRecorder?.stop());
closeBtn.addEventListener('click', () => require('@electron/remote').getCurrentWindow().close());