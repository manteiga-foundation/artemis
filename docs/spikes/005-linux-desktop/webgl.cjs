// Spike 005, WebGL on a display without a GPU: what Chromium gives a page (the cosmos is WebGL).
const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html,<canvas></canvas>');
  const page = await w.webContents.executeJavaScript(`(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
  })()`);
  const s = app.getGPUFeatureStatus();
  console.log('WEBGL ' + JSON.stringify({ args: process.argv.slice(2).filter((a) => a.startsWith('--')), status: { webgl: s.webgl, webgl2: s.webgl2, gpu_compositing: s.gpu_compositing }, page }));
  app.quit();
});
