/* main.js – full, self-contained */

const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');
const fs = require('fs');

/* ─── Enable @electron/remote in all renderers ─────────────────────── */
const remoteMain = require('@electron/remote/main');
remoteMain.initialize();

/* ─── Command-line flags for desktop capture ───────────────────────── */
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

/* ─── Settings persistence - JSON in userData -────────────────────── */
const storePath = path.join(app.getPath('userData'), 'settings.json');

const defaults = {
    alwaysOnTop: true,
    openPos: 'bottom-centre',         // 'top-centre' | 'middle-centre' | 'bottom-centre'
    saveFolder: null,                 // null = ask each time
    videoFormat: 'webm',               // 'webm' | 'mp4'
    selectedScreenId: null
};

function loadSettings() {
    try { return { ...defaults, ...JSON.parse(fs.readFileSync(storePath, 'utf8')) }; }
    catch { return { ...defaults }; }
}
function saveSettings(obj) {
    fs.writeFileSync(storePath, JSON.stringify({ ...defaults, ...obj }, null, 2));
}

/* create file on first run */
if (!fs.existsSync(storePath)) saveSettings(defaults);

/* IPC for renderers */
ipcMain.handle('get-settings', () => loadSettings());
ipcMain.handle('settings-save', (_, obj) => { saveSettings(obj); broadcast(obj); });
ipcMain.handle('settings-reset', () => { saveSettings(defaults); broadcast(defaults); });

function broadcast(obj) {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('settings-updated', obj));
}

/* ─── Main recorder window ─────────────────────────────────────────── */
function createWindow() {
    const prefs = loadSettings();

    /* position: centre horizontally, vertical based on prefs.openPos */
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const WIN_W = 576, WIN_H = 58;
    const x = Math.round(workArea.x + (workArea.width - WIN_W) / 2);

    let y;
    switch (prefs.openPos) {
        case 'middle-centre': y = workArea.y + (workArea.height - WIN_H) / 2; break;
        case 'top-centre': y = workArea.y + 10; break;
        default: y = workArea.y + workArea.height - WIN_H - 30; // bottom-centre
    }

    const win = new BrowserWindow({
        x, y, width: WIN_W, height: WIN_H,
        resizable: false,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        titleBarStyle: 'hidden',
        alwaysOnTop: prefs.alwaysOnTop,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true
        }
    });

    remoteMain.enable(win.webContents);
    win.removeMenu();
    win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

/* ─── Screen picker – modal with thumbnails ────────────────────────── */
ipcMain.handle('pick-screen', async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });

    return new Promise(resolve => {
        const picker = new BrowserWindow({
            width: sources.length * 340,
            height: 260,
            resizable: false,
            modal: true,
            parent: BrowserWindow.getFocusedWindow(),
            frame: true,
            backgroundColor: '#00000000',
            transparent: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        });

        remoteMain.enable(picker.webContents);
        picker.setMenuBarVisibility(false);
        picker.center();
        picker.loadFile('picker.html');
        picker.setTitle('ScreenPicker');

        picker.webContents.once('did-finish-load', () => {
            picker.webContents.send('screens', sources.map(s => ({
                id: s.id, name: s.name, dataURL: s.thumbnail.toDataURL()
            })));
        });

        ipcMain.once('screen-chosen', (_, id) => { resolve(id); picker.close(); });
    });
});

/* lightweight list for Settings window */
ipcMain.handle('pick-screen-list', async () => {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 90 } });
    BrowserWindow.getFocusedWindow().webContents.send(
        'screens',
        srcs.map(s => ({ id: s.id, name: s.name, dataURL: s.thumbnail.toDataURL() }))
    );
});

/* ─── Settings window ──────────────────────────────────────────────── */
ipcMain.handle('open-settings', async () => {
    const existing = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Settings');
    if (existing) { existing.focus(); return; }

    const parent = BrowserWindow.getFocusedWindow();
    const win = new BrowserWindow({
        width: 640, height: 420,
        resizable: false, modal: true, parent,
        frame: true, transparent: false, backgroundColor: '#00000000',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    remoteMain.enable(win.webContents);
    win.setMenuBarVisibility(false);
    win.center();
    win.setTitle('Settings');
    win.loadFile('settings.html');
});
