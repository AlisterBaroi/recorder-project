const { desktopCapturer, dialog } = require('electron').remote || require('@electron/remote');
const fs = require('fs');

const recBtn = document.querySelector('.rec-btn');
const stopBtn = document.querySelector('.stop-btn');
const clock = document.getElementById('clock');

let mediaRecorder, chunks = [], timer, t0;

/* helpers */
const pad = n => String(Math.floor(n)).padStart(2, '0');
const hms = ms => { const s = ms / 1000 | 0; return `${pad(s / 3600)} : ${pad((s / 60) % 60)} : ${pad(s % 60)}`; };
const lock = () => { recBtn.disabled = true; recBtn.style.backgroundImage = "url('img/Record-Button-Activate.svg')"; clock.style.color = '#AF2031'; };
const unlock = () => { recBtn.disabled = false; recBtn.style.backgroundImage = "url('img/Record-Button.svg')"; clock.style.color = '#D9D9D9'; };

/* choose first screen (swap for custom picker if you want) */
async function getScreenStream() {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
    const source = sources[0];
    return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: source.id, maxFrameRate: 30 } }
    });
}

async function start() {
    if (mediaRecorder?.state === 'recording') return;
    try {
        const stream = await getScreenStream();

        mediaRecorder = new MediaRecorder(stream);
        chunks = [];
        mediaRecorder.ondataavailable = e => e.data.size && chunks.push(e.data);
        mediaRecorder.onstop = save;

        mediaRecorder.start(); lock();
        t0 = Date.now(); timer = setInterval(() => clock.textContent = hms(Date.now() - t0), 1000);
    } catch (err) { console.error(err); }
}

async function save() {
    clearInterval(timer); clock.textContent = '00 : 00 : 00'; unlock();
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buffer = Buffer.from(await blob.arrayBuffer());
    const { filePath, canceled } = await dialog.showSaveDialog({ defaultPath: `recording-${Date.now()}.webm` });
    if (!canceled && filePath) fs.writeFileSync(filePath, buffer);
}

recBtn.addEventListener('click', start);
stopBtn.addEventListener('click', () => mediaRecorder?.stop());
