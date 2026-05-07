import { nanoid } from 'nanoid';
import { BatchOp } from './adapter';
import { GBaseConfig } from './config';
import { Cache } from './cache';
import { encryptContent, decryptContent } from './encryption';
import { NotFoundError } from './errors';
import { CollectionOptions } from './collection';

export class Transaction {
  private config: GBaseConfig;
  private cache: Cache;
  private ops: BatchOp[] = [];
  private indices: Record<string, { index: Record<string, any>; sha?: string }> = {};
  private kvData: { data: Record<string, any>; sha?: string } | null = null;
  private kvStorePath = 'kv/store.json';

  constructor(config: GBaseConfig, cache: Cache) {
    this.config = config;
    this.cache = cache;
  }

  private serializeRecord(data: any): string {
    const content = JSON.stringify(data, null, 2);
    return this.config.encryption?.enabled
      ? encryptContent(content, this.config.encryption.key)
      : content;
  }

  private deserializeRecord(content: string): any {
    const jsonString = this.config.encryption?.enabled
      ? decryptContent(content, this.config.encryption.key)
      : content;
    return JSON.parse(jsonString);
  }

  private async loadIndex(name: string): Promise<{ index: Record<string, any>; sha?: string }> {
    if (this.indices[name]) return this.indices[name];

    const indexPath = `collections/${name}/_index.json`;
    const branch = this.config.branch || 'main';
    const cached = this.cache.get(indexPath);
    
    if (cached) {
      this.indices[name] = { index: JSON.parse(cached.content), sha: cached.sha };
      return this.indices[name];
    }

    const file = await this.config.adapter.readFile(indexPath, branch);
    if (!file) {
      this.indices[name] = { index: {} };
    } else {
      this.indices[name] = { index: JSON.parse(file.content), sha: file.sha };
    }
    
    return this.indices[name];
  }

  private async loadKv(): Promise<{ data: Record<string, any>; sha?: string }> {
    if (this.kvData) return this.kvData;

    const branch = this.config.branch || 'main';
    const cached = this.cache.get(this.kvStorePath);
    if (cached) {
      this.kvData = { data: JSON.parse(cached.content), sha: cached.sha };
      return this.kvData;
    }

    const file = await this.config.adapter.readFile(this.kvStorePath, branch);
    if (!file) {
      this.kvData = { data: {} };
    } else {
      const content = this.config.encryption?.enabled 
        ? decryptContent(file.content, this.config.encryption.key) 
        : file.content;
      this.kvData = { data: JSON.parse(content), sha: file.sha };
    }
    return this.kvData;
  }

  // Intercept write ops to buffer them instead of calling adapter
  private addWriteOp(path: string, content: string, sha?: string) {
    // Overwrite existing op for the same path if exists
    const existingIdx = this.ops.findIndex(o => o.path === path);
    if (existingIdx >= 0) {
      this.ops[existingIdx] = { op: 'write', path, content, sha };
    } else {
      this.ops.push({ op: 'write', path, content, sha });
    }
  }

  private addDeleteOp(path: string, sha?: string) {
    const existingIdx = this.ops.findIndex(o => o.path === path);
    if (existingIdx >= 0) {
      this.ops[existingIdx] = { op: 'delete', path, sha: sha || '' };
    } else {
      this.ops.push({ op: 'delete', path, sha: sha || '' });
    }
  }

  collection<T extends Record<string, any>>(name: string) {
    const tx = this;
    return {
      async create(data: Partial<T>): Promise<T> {
        const id = data.id || nanoid();
        const record = { ...data, id } as unknown as T;

        const { index } = await tx.loadIndex(name);
        index[id] = record;

        tx.addWriteOp(`collections/${name}/${id}.json`, tx.serializeRecord(record));
        return record;
      },
      async update(id: string, changes: Partial<T>): Promise<T> {
        const { index } = await tx.loadIndex(name);
        if (!index[id]) {
          throw new NotFoundError(`Record ${id} not found in collection ${name}`, id);
        }

        const updatedData = { ...index[id], ...changes } as unknown as T;
        index[id] = updatedData;

        // Fetch SHA of existing file for atomic safety if possible
        const recordPath = `collections/${name}/${id}.json`;
        const file = await tx.config.adapter.readFile(recordPath, tx.config.branch || 'main');
        
        tx.addWriteOp(recordPath, tx.serializeRecord(updatedData), file?.sha);
        return updatedData;
      },
      async delete(id: string): Promise<void> {
        const { index } = await tx.loadIndex(name);
        if (!index[id]) return;

        delete index[id];

        const recordPath = `collections/${name}/${id}.json`;
        const file = await tx.config.adapter.readFile(recordPath, tx.config.branch || 'main');
        
        if (file) {
          tx.addDeleteOp(recordPath, file.sha);
        }
      }
    };
  }

  kv() {
    const tx = this;
    return {
      async set(key: string, value: any): Promise<void> {
        const { data } = await tx.loadKv();
        data[key] = value;
      },
      async delete(key: string): Promise<void> {
        const { data } = await tx.loadKv();
        if (data[key] !== undefined) {
          delete data[key];
        }
      }
    };
  }

  async commit(): Promise<void> {
    // Flush all indices
    for (const [name, { index, sha }] of Object.entries(this.indices)) {
      this.addWriteOp(`collections/${name}/_index.json`, JSON.stringify(index, null, 2), sha);
      this.cache.delete(`collections/${name}/_index.json`);
    }

    // Flush KV
    if (this.kvData) {
      const content = JSON.stringify(this.kvData.data, null, 2);
      const finalContent = this.config.encryption?.enabled
        ? encryptContent(content, this.config.encryption.key)
        : content;
      this.addWriteOp(this.kvStorePath, finalContent, this.kvData.sha);
      this.cache.delete(this.kvStorePath);
    }

    if (this.ops.length === 0) return;

    await this.config.adapter.batchWrite(this.ops, 'db: transaction commit', this.config.branch || 'main');
  }
}
