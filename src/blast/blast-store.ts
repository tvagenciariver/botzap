import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BlastCampaign, BlastQueueItem, BlastCampaignStatus } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.resolve(__dirname, '../../data/blast_campaigns.json');

function ensureFile(): void {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function readAll(): BlastCampaign[] {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) as BlastCampaign[];
  } catch {
    return [];
  }
}

function writeAll(campaigns: BlastCampaign[]): void {
  fs.writeFileSync(DATA_FILE, JSON.stringify(campaigns, null, 2), 'utf8');
}

export const blastStore = {
  list(): BlastCampaign[] {
    return readAll();
  },

  get(id: string): BlastCampaign | undefined {
    return readAll().find(c => c.id === id);
  },

  save(campaign: BlastCampaign): void {
    const all = readAll();
    const idx = all.findIndex(c => c.id === campaign.id);
    if (idx >= 0) {
      all[idx] = campaign;
    } else {
      all.push(campaign);
    }
    writeAll(all);
  },

  updateStatus(id: string, status: BlastCampaignStatus, extra?: Partial<BlastCampaign>): BlastCampaign | undefined {
    const all = readAll();
    const idx = all.findIndex(c => c.id === id);
    if (idx < 0) return undefined;
    all[idx] = { ...all[idx], status, ...extra };
    writeAll(all);
    return all[idx];
  },

  updateQueueItem(campaignId: string, item: BlastQueueItem): void {
    const all = readAll();
    const idx = all.findIndex(c => c.id === campaignId);
    if (idx < 0) return;
    const qIdx = all[idx].queue.findIndex(q => q.id === item.id);
    if (qIdx >= 0) {
      all[idx].queue[qIdx] = item;
    }
    writeAll(all);
  },

  delete(id: string): boolean {
    const all = readAll();
    const filtered = all.filter(c => c.id !== id);
    if (filtered.length === all.length) return false;
    writeAll(filtered);
    return true;
  }
};
