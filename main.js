// const { app, BrowserWindow } = require('electron');
// const { ipcMain, BrowserWindow, desktopCapturer } = require('electron');
const { app, ipcMain, BrowserWindow, desktopCapturer, screen } = require('electron');
const remoteMain = require('@electron/remote/main');   // NEW
remoteMain.initialize();
const fs = require('fs');
const path = require('path');

/* Let the renderer call require('electron') */
app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
app.commandLine.appendSwitch('allow-http-screen-capture');

function createWindow() {
    const prefs = loadSettings();             // ← read json once

    // Get the display where the cursor is (works with multi-monitor setups)
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);

    // Your fixed window size
    // const WIN_W = 600;
    const WIN_W = 576;
    const WIN_H = 58;

    // // Calculate centred X, stick to Y = 0 (top edge)
    // const x = Math.round(display.workArea.x + (display.workArea.width - WIN_W) / 2);
    // // const y = display.workArea.y + 10;   // or +10 if you want a small gap
    // const y = display.workArea.y + (display.workArea.height - WIN_H - 30);   // or +10 if you want a small gap
    let y;
    switch (prefs.openPos) {
        case 'middle-centre':
            y = display.workArea.y + (display.workArea.height - WIN_H) / 2; break;
        // case 'bottom-centre':
        case 'top-centre':
            y = display.workArea.y + 10; break;
        /* Default: bottom-centre */
        default: y = display.workArea.y + display.workArea.height - WIN_H - 30;
    }
    const x = Math.round(display.workArea.x + (display.workArea.width - WIN_W) / 2);

    const win = new BrowserWindow({
        // width: 596,
        // height: 54,
        x, y,                         // ⬅ position
        width: WIN_W,
        height: WIN_H,
        resizable: false,
        transparent: true,                // window itself is see-through
        backgroundColor: '#00000000',     // macOS + Windows want an explicit 0-alpha colour
        frame: false,               // ← no native title-bar / buttons
        titleBarStyle: 'hidden',   // macOS: remove traffic-lights
        alwaysOnTop: prefs.alwaysOnTop,
        webPreferences: {
            nodeIntegration: true,      // ⚠️  Node in renderer
            contextIsolation: false,     // ⚠️  single JS world
            enableRemoteModule: true
        }
    });

    win.removeMenu();
    win.setAlwaysOnTop(true); // always on top, even over fullscreen apps
    win.loadFile('index.html');
    remoteMain.enable(win.webContents);

    // win.webContents.openDevTools({ mode: 'detach' });   // auto-open DevTools
    // if (!app.isPackaged) {                              // only in dev
    //     win.webContents.openDevTools({ mode: 'detach' });
    // }
}


// new picker window
ipcMain.handle('pick-screen', async () => {
    /* gather screens (monitors only) */
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 320, height: 180 } });

    return new Promise((resolve) => {
        const picker = new BrowserWindow({
            width: sources.length * 340,
            height: 260,
            resizable: false,
            modal: true,
            parent: BrowserWindow.getFocusedWindow(),
            webPreferences: { nodeIntegration: true, contextIsolation: false },
            center: true
        });

        picker.setMenuBarVisibility(false);
        picker.loadFile('picker.html');

        /* pass list once the page is ready */
        picker.webContents.once('did-finish-load', () => {
            picker.webContents.send('screens', sources.map(s => ({
                id: s.id,
                name: s.name,
                dataURL: s.thumbnail.toDataURL()
            })));
        });

        /* receive selection */
        ipcMain.once('screen-chosen', (event, id) => {
            resolve(id);
            picker.close();
        });
    });
});
// end here

ipcMain.handle('pick-screen-list', async () => {
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 160, height: 90 } });
    BrowserWindow.getFocusedWindow()
        .webContents.send('screens', srcs.map(s => ({ id: s.id, name: s.name, dataURL: s.thumbnail.toDataURL() })));
});


ipcMain.handle('open-settings', async () => {
    // Re-use an existing window if it’s already open
    const existing = BrowserWindow.getAllWindows()
        .find(w => w.getTitle() === 'Settings');
    if (existing) { existing.focus(); return; }

    const parent = BrowserWindow.getFocusedWindow();
    const win = new BrowserWindow({
        width: 640, height: 420, resizable: false, modal: true, parent,
        frame: false, backgroundColor: '#00000000', transparent: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    win.setMenuBarVisibility(false);
    win.center();                 // open in middle of the parent display
    win.loadFile('settings.html');
});

// Get default settings from settings.json file
const storePath = path.join(app.getPath('userData'), 'settings.json');
// Default settings
const defaults = {
    alwaysOnTop: false,
    openPos: 'top-centre',         // 'top-centre' | 'middle-centre' | 'bottom-centre'
    saveFolder: null,              // null = ask every time
    videoFormat: 'webm',           // 'webm' | 'mp4'
    selectedScreenId: null
};

/* helper */
function loadSettings() {
    try { return { ...defaults, ...JSON.parse(fs.readFileSync(storePath, 'utf8')) }; }
    catch { return { ...defaults }; }
}
function saveSettings(obj) {
    fs.writeFileSync(storePath, JSON.stringify({ ...defaults, ...obj }, null, 2));
}

/* NEW: let renderers fetch the current object */
ipcMain.handle('get-settings', () => loadSettings());

/* ask for current settings */
ipcMain.handle('settings-load', () => loadSettings());

/* save entire object sent from renderer */
ipcMain.handle('settings-save', (_, obj) => { saveSettings(obj); });

/* reset to defaults */
ipcMain.handle('settings-reset', () => { saveSettings(defaults); });




app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });



