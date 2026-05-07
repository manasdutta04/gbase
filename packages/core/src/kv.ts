import { GBaseConfig } from './config';
import { Cache } from './cache';
import { decryptContent, encryptContent } from './encryption';

export class KeyValue {
  private config: GBaseConfig;
  private cache: Cache;
  private storePath = 'kv/store.json';

  constructor(config: GBaseConfig, cache: Cache) {
    this.config = config;
    this.cache = cache;
  }

  private async loadStore(): Promise<{ data: Record<string, any>; sha?: string }> {
    const branch = this.config.branch || 'main';
    const cached = this.cache.get(this.storePath);
    if (cached) {
      return { data: JSON.parse(cached.content), sha: cached.sha };
    }

    const file = await this.config.adapter.readFile(this.storePath, branch);
    if (!file) {
      return { data: {} };
    }

    const content = this.config.encryption?.enabled 
      ? decryptContent(file.content, this.config.encryption.key) 
      : file.content;

    const data = JSON.parse(content);
    this.cache.set(this.storePath, content, file.sha);
    return { data, sha: file.sha };
  }

  private async saveStore(data: Record<string, any>, sha?: string): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const finalContent = this.config.encryption?.enabled
      ? encryptContent(content, this.config.encryption.key)
      : content;
    
    await this.config.adapter.writeFile(this.storePath, finalContent, 'kv: update store', sha);
    // Since we don't know the new SHA without another API call or relying on adapter return (which we don't have), 
    // we clear the cache so it fetches fresh next time.
    this.cache.delete(this.storePath);
  }

  async get<T = any>(key: string): Promise<T | null> {
    const { data } = await this.loadStore();
    return data[key] !== undefined ? data[key] : null;
  }

  async set(key: string, value: any): Promise<void> {
    const { data, sha } = await this.loadStore();
    data[key] = value;
    await this.saveStore(data, sha);
  }

  async has(key: string): Promise<boolean> {
    const { data } = await this.loadStore();
    return data[key] !== undefined;
  }

  async delete(key: string): Promise<void> {
    const { data, sha } = await this.loadStore();
    if (data[key] !== undefined) {
      delete data[key];
      await this.saveStore(data, sha);
    }
  }

  async setMany(obj: Record<string, any>): Promise<void> {
    const { data, sha } = await this.loadStore();
    Object.assign(data, obj);
    await this.saveStore(data, sha);
  }

  async deleteMany(keys: string[]): Promise<void> {
    const { data, sha } = await this.loadStore();
    let changed = false;
    for (const key of keys) {
      if (data[key] !== undefined) {
        delete data[key];
        changed = true;
      }
    }
    if (changed) {
      await this.saveStore(data, sha);
    }
  }

  async increment(key: string, by = 1): Promise<void> {
    const { data, sha } = await this.loadStore();
    const current = typeof data[key] === 'number' ? data[key] : 0;
    data[key] = current + by;
    await this.saveStore(data, sha);
  }

  async decrement(key: string, by = 1): Promise<void> {
    await this.increment(key, -by);
  }

  async toggle(key: string): Promise<void> {
    const { data, sha } = await this.loadStore();
    const current = !!data[key];
    data[key] = !current;
    await this.saveStore(data, sha);
  }

  async keys(): Promise<string[]> {
    const { data } = await this.loadStore();
    return Object.keys(data);
  }

  async getAll(): Promise<Record<string, any>> {
    const { data } = await this.loadStore();
    return data;
  }

  async size(): Promise<number> {
    const { data } = await this.loadStore();
    return Object.keys(data).length;
  }

  async clear(): Promise<void> {
    const { sha } = await this.loadStore();
    await this.saveStore({}, sha);
  }
}
