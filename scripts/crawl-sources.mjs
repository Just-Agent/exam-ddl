import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const CRAWL_TIMEOUT_MS = Number(process.env.CRAWL_TIMEOUT_MS) || 20000;
const REACHABILITY_TIMEOUT_MS = Number(process.env.REACHABILITY_TIMEOUT_MS) || Math.min(7000, CRAWL_TIMEOUT_MS);
const USER_AGENT = 'Just-DDL-Crawler/1.0 (+https://just-agent.github.io/just-ddl/)';

function extractTitle(html) {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim().slice(0, 200) : null;
}

function fetchViaPowerShell(url) {
  if (process.platform !== 'win32') return null;
  const timeoutSec = Math.max(15, Math.ceil(CRAWL_TIMEOUT_MS / 1000) + 5);
  const escapedUrl = url.replace(/'/g, "''");
  const script = "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); (Invoke-WebRequest -Uri '" + escapedUrl + "' -UseBasicParsing -TimeoutSec " + timeoutSec + " -Headers @{ 'User-Agent'='Mozilla/5.0'; 'Accept-Language'='en-US,en;q=0.9' }).Content";
  for (const command of ['pwsh', 'powershell']) {
    const result = spawnSync(command, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: (timeoutSec + 5) * 1000
    });
    if (result.status === 0 && result.stdout && result.stdout.trim().length > 1000) {
      return result.stdout;
    }
  }
  return null;
}

async function fetchSourcePage(source) {
  const report = {
    sourceId: source.id,
    source: source.name,
    url: source.url,
    items: [],
    reachable: false,
    httpStatus: null,
    finalUrl: null,
    title: null,
    contentLength: null,
    fetchedAt: new Date().toISOString(),
    note: 'Source reachability check only; curated data/items.json preserved until item parser is implemented.',
    error: null
  };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REACHABILITY_TIMEOUT_MS);
    const res = await fetch(source.url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT }
    });
    clearTimeout(timer);
    report.httpStatus = res.status;
    report.finalUrl = res.url;
    const text = await res.text();
    report.contentLength = text.length;
    report.title = extractTitle(text);
    report.reachable = res.status >= 200 && res.status < 400;
    report.note = report.reachable
      ? 'Source reachable. Curated data/items.json preserved until item parser is implemented.'
      : `Source returned HTTP ${res.status}. Curated data/items.json preserved.`;
  } catch (err) {
    report.error = err.name === 'AbortError' ? `Timeout after ${REACHABILITY_TIMEOUT_MS}ms` : err.message;
    report.note = `Source fetch failed: ${report.error}. Curated data/items.json preserved.`;
  }
  return report;
}
async function neeaAdapter() {
  return fetchSourcePage({ id: "neea", name: "教育部教育考试院", url: "https://www.neea.edu.cn" });
}

async function ieltsAdapter() {
  return fetchSourcePage({ id: "ielts", name: "IELTS", url: "https://ielts.org" });
}

async function etsAdapter() {
  return fetchSourcePage({ id: "ets", name: "ETS", url: "https://www.ets.org" });
}

async function pteAdapter() {
  return fetchSourcePage({ id: "pearson", name: "Pearson PTE", url: "https://www.pearsonpte.com" });
}

const adapters = [neeaAdapter, ieltsAdapter, etsAdapter, pteAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
let previousParsedItemCount = null;
try {
  const previousReport = JSON.parse(fs.readFileSync(new URL('../data/crawl-report.json', import.meta.url), 'utf8'));
  previousParsedItemCount = previousReport.parsedItemCount ?? null;
} catch {}
const reports = await Promise.all(adapters.map(adapter => adapter()));

const harvestedItems = reports.flatMap(report => report.items);
const parsedItemCount = reports.reduce((s, r) => s + (r.parsedItemCount || 0), 0);
const parserHealthy = reports.every(r => r.parserHealthy !== false);
const parserDropOk = previousParsedItemCount === null || parsedItemCount >= Math.floor(previousParsedItemCount * 0.5);

function mergeFetchedWithExisting(fetchedItems, currentItems) {
  const merged = new Map();
  for (const item of currentItems) {
    if (item?.id) merged.set(item.id, item);
  }
  for (const item of fetchedItems) {
    if (item?.id) merged.set(item.id, item);
  }
  return [...merged.values()].sort((a, b) => {
    const dateDiff = Date.parse(a.deadline) - Date.parse(b.deadline);
    if (dateDiff !== 0) return dateDiff;
    return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN');
  });
}

if (harvestedItems.length >= 1 && parserHealthy && parserDropOk) {
  const mergedItems = mergeFetchedWithExisting(harvestedItems, existingItems);
  fs.writeFileSync(existingItemsUrl, JSON.stringify(mergedItems, null, 2) + '\n', 'utf8');
  console.log('crawler wrote ' + harvestedItems.length + ' fetched items; preserved/merged total ' + mergedItems.length + ' items');
} else {
  console.log('parser emitted ' + harvestedItems.length + ' items (health gate failed or threshold not met); preserving ' + existingItems.length + ' curated items in data/items.json');
}

const reachableCount = reports.filter(r => r.reachable).length;
console.log('reachability: ' + reachableCount + '/' + reports.length + ' sources reachable');
if (parsedItemCount > 0) console.log('parsedItemCount: ' + parsedItemCount);

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  topicId: "exam-ddl",
  generatedAt: new Date().toISOString(),
  adapterCount: reports.length,
  reachableCount,
  parsedItemCount,
  previousParsedItemCount,
  parserHealthy,
  parserDropOk,
  adapters: reports
}, null, 2) + '\n', 'utf8');
