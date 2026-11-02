// Optional artwork regeneration. The production build only copies the completed PNG.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2),
  at = args.indexOf("--playwright");
const { chromium } = await (at >= 0
  ? import(pathToFileURL(resolve(args[at + 1])).href)
  : import("playwright"));
const asset = async (name) =>
  Buffer.from(
    await readFile(new URL(`../public/${name}`, import.meta.url)),
  ).toString("base64");
const [body, display, meadow] = await Promise.all([
  asset("fonts/nunito-latin.woff2"),
  asset("fonts/pixelify-latin.woff2"),
  asset("meadow.svg"),
]);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html lang="en"><head><style>
    @font-face{font-family:Nunito;src:url(data:font/woff2;base64,${body});font-weight:400 700}
    @font-face{font-family:Pixelify;src:url(data:font/woff2;base64,${display});font-weight:700}
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:#ccebd3;color:#373c31;font-family:Nunito,sans-serif}
    img{position:absolute;top:120px;width:1200px;height:645px;image-rendering:pixelated}
    header{position:relative;background:#faf9f2;height:225px;padding:32px 60px}p,h1{margin:0}p{font-size:24px;color:#625449}
    .brand{font-family:Pixelify,sans-serif;font-weight:700;font-size:36px;margin-bottom:12px;color:#373c31}h1{font-family:Pixelify,sans-serif;font-weight:700;font-size:58px;line-height:1.1;margin-bottom:12px;letter-spacing:-2px}
  </style></head><body><img alt="" src="data:image/svg+xml;base64,${meadow}"><header><p class="brand">HamsterRun</p><h1>Small paws. Big adventures.</h1><p>A little hamster game on Sepolia. Testnet only.</p></header></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: fileURLToPath(new URL("../public/share.png", import.meta.url)),
  });
  console.log("Generated the complete local 1200×630 share card.");
} finally {
  await browser.close();
}
