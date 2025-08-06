/* renderer.js – full version */
(async () => {
    /* ── imports ───────────────────────────────────────────── */
    const { ipcRenderer } = require('electron');
    const { dialog, BrowserWindow } = require('@electron/remote');
    const path = require('path');
    const fs = require('fs');
    const os = require('os');
    const { spawn } = require('child_process');
    const ffmpegPath = require('ffmpeg-static-electron').path;

    /* ── DOM refs ──────────────────────────────────────────── */
    const recBtn = document.querySelector('.rec-btn');
    const stopBtn = document.querySelector('.stop-btn');
    const settingsBtn = document.querySelector('.settings-btn');
    const closeBtn = document.querySelector('.close-btn');
    const clock = document.getElementById('clock');

    /* ── load preferences once ─────────────────────────────── */
    let prefs = await ipcRenderer.invoke('get-settings');
    let selectedSourceId = prefs.selectedScreenId || null;
    let defaultFolder = prefs.saveFolder || null;
    let videoFormat = prefs.videoFormat || 'webm';

    /* live update when settings window saves */
    ipcRenderer.on('settings-updated', (_, obj) => {
        prefs = { ...prefs, ...obj };
        selectedSourceId = prefs.selectedScreenId;
        defaultFolder = prefs.saveFolder;
        videoFormat = prefs.videoFormat;
    });

    /* ── state vars ────────────────────────────────────────── */
    let mediaRecorder, chunks = [], timerRef, t0;

    /* ── helpers ───────────────────────────────────────────── */
    const pad = n => String(Math.floor(n)).padStart(2, '0');
    const hms = ms => {
        const s = (ms / 1000) | 0;
        return `${pad(s / 3600)} : ${pad((s / 60) % 60)} : ${pad(s % 60)}`;
    };

    const lock = () => {
        recBtn.disabled = true;
        recBtn.style.pointerEvents = 'none';
        recBtn.style.cursor = 'not-allowed';
        recBtn.style.backgroundImage = "url('assets/images/Record-Button-Activate.svg')";
        clock.style.color = '#AF2031';
    };
    const unlock = () => {
        recBtn.disabled = false;
        recBtn.style.pointerEvents = 'auto';
        recBtn.style.cursor = '';
        recBtn.style.backgroundImage = '';
        clock.style.color = '#D9D9D9';
    };

    /* ── pick a screen (modal from main) ───────────────────── */
    async function pickScreen() {
        selectedSourceId = await ipcRenderer.invoke('pick-screen').catch(() => null);
        prefs.selectedScreenId = selectedSourceId;
    }

    /* ── build a MediaStream for that screen ───────────────── */
    function streamFor(id) {
        return navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                mandatory: {
                    chromeMediaSource: 'desktop',
                    chromeMediaSourceId: id,
                    maxFrameRate: 30
                }
            }
        });
    }

    /* ── start recording ───────────────────────────────────── */
    async function startRec() {
        if (mediaRecorder?.state === 'recording') return;
        if (!selectedSourceId) await pickScreen();
        if (!selectedSourceId) return;             // user cancelled

        const stream = await streamFor(selectedSourceId);

        const wantMp4 = videoFormat === 'mp4';
        const MP4 = 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
        const opts = wantMp4 && MediaRecorder.isTypeSupported(MP4) ? { mimeType: MP4 } : {};
        mediaRecorder = new MediaRecorder(stream, opts);

        chunks = [];
        mediaRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        mediaRecorder.onstop = saveFile;

        mediaRecorder.start();
        lock();
        t0 = Date.now();
        timerRef = setInterval(() => (clock.textContent = hms(Date.now() - t0)), 1000);
    }

    /* ── save & (if needed) transcode ──────────────────────── */
    async function saveFile() {
        clearInterval(timerRef);
        clock.textContent = '00 : 00 : 00';
        unlock();

        /* what did MediaRecorder actually give us? */
        const recordedMime = mediaRecorder.mimeType || 'video/webm';
        const srcExt = recordedMime.includes('mp4') ? 'mp4' : 'webm';

        /* write raw chunks to a temp file */
        const tempFile = path.join(os.tmpdir(), `capture-${Date.now()}.${srcExt}`);
        fs.writeFileSync(
            tempFile,
            Buffer.from(await new Blob(chunks, { type: recordedMime }).arrayBuffer())
        );

        /* destination dialog honours user's chosen format */
        const targetExt = videoFormat;                       // 'mp4' or 'webm'
        const startDir = defaultFolder || os.homedir();
        const dlg = await dialog.showSaveDialog({
            defaultPath: path.join(startDir, `recording-${Date.now()}.${targetExt}`),
            filters: [{ name: 'Video', extensions: [targetExt] }]
        });
        if (dlg.canceled) { fs.unlinkSync(tempFile); return; }

        const finalPath = dlg.filePath.endsWith(`.${targetExt}`)
            ? dlg.filePath
            : `${dlg.filePath}.${targetExt}`;

        // if container already matches → copy
        if (srcExt === targetExt) {
            await showCopyProgress(tempFile, finalPath, afterSave);
            return;         // all done
        }

        /* need to transcode (only mp4 path for now) */
        if (targetExt === 'mp4') {
            return transcodeToMp4(tempFile, finalPath);
        }

        /* targetExt === 'webm' but we recorded mp4 (rare) */
        fs.copyFileSync(tempFile, finalPath);     // simplest fallback
        fs.unlinkSync(tempFile);
        afterSave(finalPath);
    }
    // progress bar for webm format
    //  Copy a file while streaming progress (0‒1) to progress.html, then call cb(finalPath) once complete.
    function showCopyProgress(srcPath, destPath, cb) {
        return new Promise(resolve => {
            const progressWin = new BrowserWindow({
                width: 320, height: 80, resizable: false, modal: true,
                parent: require('@electron/remote').getCurrentWindow(), frame: false, transparent: true, backgroundColor: '#00000000',
                alwaysOnTop: true, center: true, webPreferences: { nodeIntegration: true, contextIsolation: false }
            }); progressWin.loadFile('progress.html');

            progressWin.webContents.once('did-finish-load', () => {
                const { size } = fs.statSync(srcPath); let copied = 0;
                progressWin.webContents.send('progress', 0);
                const read = fs.createReadStream(srcPath);
                const write = fs.createWriteStream(destPath);
                read.on('data', chunk => {
                    copied += chunk.length; progressWin.webContents.send('progress', Math.min(copied / size, 1));
                });

                write.on('close', () => {
                    fs.unlinkSync(srcPath);
                    progressWin.webContents.send('progress', 1);
                    setTimeout(() => {
                        progressWin.close(); cb(destPath);     // afterSave()
                        resolve();
                    }, 500);            // 0.5-sec linger at 100 %
                });
                read.pipe(write);
            });
        });
    }

    /* run ffmpeg + show progress window for mp4 format */
    function transcodeToMp4(src, dest) {
        const progressWin = new BrowserWindow({
            width: 320, height: 80, resizable: false, modal: true,
            parent: require('@electron/remote').getCurrentWindow(),
            frame: false, transparent: true, backgroundColor: '#00000000',
            alwaysOnTop: true, center: true,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });
        progressWin.loadFile('progress.html');

        const totalMs = Date.now() - t0;          // rough duration
        const ff = spawn(ffmpegPath, [
            '-i', src,
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22',
            '-c:a', 'aac', '-b:a', '192k',
            '-movflags', '+faststart',
            '-progress', 'pipe:1', '-nostats',
            dest
        ]);

        ff.stdout.on('data', d => {
            const str = d.toString();
            /* prefer microseconds, fall back to HH:MM:SS.MICRO */
            let done = null;

            const m1 = /out_time_ms=(\d+)/.exec(str);
            if (m1) {
                done = +m1[1] / (totalMs * 1000);          // micro → milli
            } else {
                const m2 = /out_time=(\d+):(\d+):(\d+\.\d+)/.exec(str);
                if (m2) {
                    const secs = (+m2[1]) * 3600 + (+m2[2]) * 60 + parseFloat(m2[3]);
                    done = secs * 1000 / totalMs;
                }
            }
            if (done !== null) {
                progressWin.webContents.send('progress', Math.min(done, 1));
            }
        });

        ff.on('close', code => {
            fs.unlinkSync(src);
            if (code === 0) {
                /* make absolutely sure the bar shows 100 % */
                progressWin.webContents.send('progress', 1);

                setTimeout(() => {  /* leave visible for 500ms before closing */
                    progressWin.close();
                    afterSave(dest);            // persist prefs, etc.
                }, 500);                      // 0.5 s
            } else {
                progressWin.close();
                dialog.showErrorBox('FFmpeg error', `Transcoding failed (${code}).`);
            }
        });

    }

    /* remember prefs & persist */
    function afterSave(finalPath) {
        defaultFolder = path.dirname(finalPath);
        prefs.saveFolder = defaultFolder;
        prefs.selectedScreenId = selectedSourceId;
        prefs.videoFormat = videoFormat;
        ipcRenderer.invoke('settings-save', prefs);
    }

    /* ── UI event wiring ───────────────────────────────────── */
    settingsBtn.addEventListener('click', () => ipcRenderer.invoke('open-settings'));
    recBtn.addEventListener('click', startRec);
    stopBtn.addEventListener('click', () => mediaRecorder?.stop());
    closeBtn.addEventListener('click', () =>
        require('@electron/remote').getCurrentWindow().close());

})();
