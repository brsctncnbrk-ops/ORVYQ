import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';
import {sha256File} from './hash.js';
import {readJson, writeJson} from './io.js';

interface SourceEntry {
  id: string;
  url: string;
  domain: string;
  active: boolean;
  primary: boolean;
  required: boolean;
  license_or_basis: string;
}

function pngDimensions(buffer: Buffer): {width: number; height: number} {
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') throw new Error('capture is not a valid PNG');
  return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureSources(projectDir: string): Promise<{captured: number; optionalFailures: string[]}> {
  const catalog = await readJson<{sources: SourceEntry[]}>(path.join(projectDir, 'research', 'source_catalog.json'));
  const active = catalog.sources.filter((source) => source.active && source.primary);
  const browser = await chromium.launch({headless: true});
  const outputDir = path.join(projectDir, 'assets', 'captures');
  await mkdir(outputDir, {recursive: true});
  const optionalFailures: string[] = [];
  let captured = 0;
  try {
    for (const source of active) {
      const expectedHost = new URL(source.url).hostname;
      if (!(expectedHost === source.domain || expectedHost.endsWith(`.${source.domain}`))) {
        throw new Error(`${source.id}: URL host does not match allowlisted domain ${source.domain}`);
      }
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const page = await browser.newPage({viewport: {width: 1920, height: 1080}, deviceScaleFactor: 1});
        try {
          const response = await page.goto(source.url, {waitUntil: 'domcontentloaded', timeout: 45_000});
          if (!response || response.status() >= 400) throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
          const finalHost = new URL(page.url()).hostname;
          if (!(finalHost === source.domain || finalHost.endsWith(`.${source.domain}`))) throw new Error(`redirected outside allowlisted domain to ${finalHost}`);
          await page.waitForTimeout(2500);
          await page.screenshot({path: path.join(outputDir, `${source.id}.png`), fullPage: false});
          const file = path.join(outputDir, `${source.id}.png`);
          const bytes = await readFile(file);
          const dimensions = pngDimensions(bytes);
          if (dimensions.width < 1920 || dimensions.height < 1080) throw new Error(`capture resolution ${dimensions.width}x${dimensions.height} is below 1920x1080`);
          await writeJson(path.join(outputDir, `${source.id}.provenance.json`), {
            source_id: source.id,
            requested_url: source.url,
            final_url: page.url(),
            domain: source.domain,
            captured_at: new Date().toISOString(),
            resolution: dimensions,
            sha256: await sha256File(file),
            license_or_basis: source.license_or_basis,
          });
          captured += 1;
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await sleep(1000 * 2 ** (attempt - 1));
        } finally {
          await page.close();
        }
      }
      if (lastError) {
        const message = `${source.id}: ${String(lastError)}`;
        if (source.required) throw new Error(message);
        optionalFailures.push(message);
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(outputDir, '.capture-complete'), `${new Date().toISOString()}\n`, 'utf8');
  return {captured, optionalFailures};
}
