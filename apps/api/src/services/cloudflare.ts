import { env } from "process";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied: boolean;
  ttl: number;
}

function getHeaders() {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not configured");
  return {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function getZoneId() {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) throw new Error("CLOUDFLARE_ZONE_ID is not configured");
  return zoneId;
}

export const cloudflare = {
  isEnabled(): boolean {
    return !!process.env.CLOUDFLARE_API_TOKEN && !!process.env.CLOUDFLARE_ZONE_ID;
  },

  async listRecords(): Promise<DnsRecord[]> {
    if (!this.isEnabled()) return [];
    
    const response = await fetch(`${CF_API_BASE}/zones/${getZoneId()}/dns_records`, {
      headers: getHeaders(),
    });
    
    const data = await response.json();
    if (!data.success) throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
    return data.result;
  },

  async createRecord(type: "A" | "CNAME" | "TXT", name: string, content: string, proxied = false): Promise<DnsRecord> {
    const response = await fetch(`${CF_API_BASE}/zones/${getZoneId()}/dns_records`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({
        type,
        name,
        content,
        ttl: 1, // Automatic
        proxied,
        comment: "Created by DBBKP Platform",
      }),
    });

    const data = await response.json();
    if (!data.success) throw new Error(`Cloudflare API error: ${JSON.stringify(data.errors)}`);
    return data.result;
  },

  async deleteRecord(recordId: string): Promise<boolean> {
    const response = await fetch(`${CF_API_BASE}/zones/${getZoneId()}/dns_records/${recordId}`, {
      method: "DELETE",
      headers: getHeaders(),
    });

    const data = await response.json();
    return data.success;
  },

  async deleteRecordByName(name: string): Promise<void> {
    const records = await this.listRecords();
    const record = records.find(r => r.name === name);
    if (record) {
      await this.deleteRecord(record.id);
    }
  }
};
