// Spike 002 check: at what resolution do screencast frames arrive for each scale-factor setup?
import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';

const jpegSize = (b: Buffer) => { // read SOF0/SOF2 dimensions
  for (let i = 2; i < b.length; ) {
    if (b[i] !== 0xff) return null;
    const m = b[i + 1]; const len = b.readUInt16BE(i + 2);
    if (m === 0xc0 || m === 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return null;
};

for (const [name, args, dsf] of [
  ['emulated dsf 2', [], 2],
  ['--force-device-scale-factor=2 + emulated 2', ['--force-device-scale-factor=2'], 2],
  ['--force-device-scale-factor=2, no emulation dsf', ['--force-device-scale-factor=2'], undefined]
] as const) {
  const dir = await mkdtemp(join(import.meta.dir, '../../../data/spike-002', 'dsf-'));
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, channel: 'chromium', viewport: { width: 1440, height: 828 }, deviceScaleFactor: dsf, args: [...args] });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.setContent('<body style="font:16px sans-serif">Sharpness test <span id=t></span><script>let n=0;setInterval(()=>t.textContent=n++,50)</script>');
  const cdp = await ctx.newCDPSession(page);
  const sizes: string[] = []; let kb = 0;
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    const b = Buffer.from(data, 'base64'); kb += b.length / 1024;
    if (sizes.length < 2) sizes.push(`${jpegSize(b)} meta ${metadata.deviceWidth}x${metadata.deviceHeight}`);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 2880, maxHeight: 1656 });
  await page.waitForTimeout(1500);
  console.log(name, '| dpr in page', await page.evaluate(() => devicePixelRatio), '| frame', sizes[0]);
  await ctx.close();
}
