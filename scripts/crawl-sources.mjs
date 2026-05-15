import fs from 'node:fs';

async function neeaAdapter() {
  return {
    source: "教育部教育考试院",
    url: "https://www.neea.edu.cn",
    items: [],
    note: 'TODO: implement parser for 教育部教育考试院; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function ieltsAdapter() {
  return {
    source: "IELTS",
    url: "https://ielts.org",
    items: [],
    note: 'TODO: implement parser for IELTS; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function etsAdapter() {
  return {
    source: "ETS",
    url: "https://www.ets.org",
    items: [],
    note: 'TODO: implement parser for ETS; keep data/items.json as curated fallback until parser is verified.'
  };
}

async function pteAdapter() {
  return {
    source: "Pearson PTE",
    url: "https://www.pearsonpte.com",
    items: [],
    note: 'TODO: implement parser for Pearson PTE; keep data/items.json as curated fallback until parser is verified.'
  };
}

const adapters = [neeaAdapter, ieltsAdapter, etsAdapter, pteAdapter];
const existingItemsUrl = new URL('../data/items.json', import.meta.url);
const existingItems = JSON.parse(fs.readFileSync(existingItemsUrl, 'utf8'));
const reports = [];

for (const adapter of adapters) {
  reports.push(await adapter());
}

const harvestedItems = reports.flatMap(report => report.items);
if (harvestedItems.length > 0) {
  fs.writeFileSync(existingItemsUrl, JSON.stringify(harvestedItems, null, 2) + '\n', 'utf8');
  console.log(`crawler wrote ${harvestedItems.length} fetched items`);
} else {
  console.log(`crawler adapters ran; no verified fetched items yet, preserving ${existingItems.length} curated items`);
}

fs.writeFileSync(new URL('../data/crawl-report.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(),
  topicId: "exam-ddl",
  adapters: reports
}, null, 2) + '\n', 'utf8');
