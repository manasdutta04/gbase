import { nanoid } from 'nanoid';
import { z } from 'zod';
import { GBaseConfig } from './config';
import { Cache } from './cache';
import { BatchOp } from './adapter';
import { encryptContent, decryptContent } from './encryption';
import { ValidationError, NotFoundError } from './errors';

export interface CollectionOptions<T> {
  schema?: z.ZodSchema<T>;
  hooks?: {
    beforeCreate?: (data: Partial<T>) => Promise<Partial<T>> | Partial<T>;
    afterCreate?: (data: T) => Promise<void> | void;
    beforeUpdate?: (id: string, data: Partial<T>) => Promise<Partial<T>> | Partial<T>;
    afterUpdate?: (id: string, data: T) => Promise<void> | void;
    beforeDelete?: (id: string) => Promise<void> | void;
    afterDelete?: (id: string) => Promise<void> | void;
  };
}

export interface IndexData {
  [id: string]: Record<string, any>;
}

export class Collection<T extends Record<string, any>> {
  private config: GBaseConfig;
  private cache: Cache;
  private name: string;
  private options?: CollectionOptions<T>;
  private indexPath: string;

  constructor(config: GBaseConfig, cache: Cache, name: string, options?: CollectionOptions<T>) {
    this.config = config;
    this.cache = cache;
    this.name = name;
    this.options = options;
    this.indexPath = `collections/${this.name}/_index.json`;
  }

  private validate(data: any): asserts data is T {
    if (this.options?.schema) {
      const result = this.options.schema.safeParse(data);
      if (!result.success) {
        throw new ValidationError('Validation failed', result.error.errors.map(e => ({
          field: e.path.join('.'),
          message: e.message
        })));
      }
    }
  }

  private getFilePath(id: string): string {
    return `collections/${this.name}/${id}.json`;
  }

  private async loadIndex(): Promise<{ index: IndexData; sha?: string }> {
    const branch = this.config.branch || 'main';
    const cached = this.cache.get(this.indexPath);
    if (cached) {
      return { index: JSON.parse(cached.content), sha: cached.sha };
    }

    const file = await this.config.adapter.readFile(this.indexPath, branch);
    if (!file) {
      return { index: {} };
    }

    const index = JSON.parse(file.content);
    this.cache.set(this.indexPath, file.content, file.sha);
    return { index, sha: file.sha };
  }

  private serializeRecord(data: any): string {
    const content = JSON.stringify(data, null, 2);
    return this.config.encryption?.enabled
      ? encryptContent(content, this.config.encryption.key)
      : content;
  }

  private deserializeRecord(content: string): T {
    const jsonString = this.config.encryption?.enabled
      ? decryptContent(content, this.config.encryption.key)
      : content;
    return JSON.parse(jsonString) as T;
  }

  async create(data: Partial<T>): Promise<T> {
    const id = data.id || nanoid();
    let record = { ...data, id } as unknown as T;

    if (this.options?.hooks?.beforeCreate) {
      record = (await this.options.hooks.beforeCreate(record)) as T;
    }

    this.validate(record);

    const { index, sha: indexSha } = await this.loadIndex();
    index[id] = record; // Basic indexing of all fields for v0

    const recordPath = this.getFilePath(id);
    const ops: BatchOp[] = [
      {
        op: 'write',
        path: this.indexPath,
        content: JSON.stringify(index, null, 2),
        sha: indexSha,
      },
      {
        op: 'write',
        path: recordPath,
        content: this.serializeRecord(record),
      }
    ];

    await this.config.adapter.batchWrite(ops, `db: create ${this.name}/${id}`, this.config.branch || 'main');
    this.cache.delete(this.indexPath);

    if (this.options?.hooks?.afterCreate) {
      await this.options.hooks.afterCreate(record);
    }

    return record;
  }

  async findById(id: string): Promise<T | null> {
    const recordPath = this.getFilePath(id);
    const cached = this.cache.get(recordPath);
    if (cached) {
      return this.deserializeRecord(cached.content);
    }

    const branch = this.config.branch || 'main';
    const file = await this.config.adapter.readFile(recordPath, branch);
    
    if (!file) return null;
    
    this.cache.set(recordPath, file.content, file.sha);
    return this.deserializeRecord(file.content);
  }

  async findAll(): Promise<T[]> {
    const { index } = await this.loadIndex();
    const ids = Object.keys(index);
    const records: T[] = [];
    
    // In a real scenario with many records, fetching all could hit rate limits or be slow.
    // For v0, we assume reasonable sizes or index filtering.
    for (const id of ids) {
      const record = await this.findById(id);
      if (record) records.push(record);
    }
    return records;
  }

  // Very basic query evaluation for index filtering
  private evaluateQuery(record: Record<string, any>, query: any): boolean {
    for (const [key, value] of Object.entries(query)) {
      if (typeof value === 'object' && value !== null) {
        for (const [op, opVal] of Object.entries(value)) {
          switch (op) {
            case '$eq': if (record[key] !== opVal) return false; break;
            case '$ne': if (record[key] === opVal) return false; break;
            case '$gt': if (record[key] <= opVal) return false; break;
            case '$gte': if (record[key] < opVal) return false; break;
            case '$lt': if (record[key] >= opVal) return false; break;
            case '$lte': if (record[key] > opVal) return false; break;
            case '$in': if (!(opVal as any[]).includes(record[key])) return false; break;
            case '$nin': if ((opVal as any[]).includes(record[key])) return false; break;
            case '$contains': if (!String(record[key]).includes(String(opVal))) return false; break;
            case '$startsWith': if (!String(record[key]).startsWith(String(opVal))) return false; break;
            case '$endsWith': if (!String(record[key]).endsWith(String(opVal))) return false; break;
            case '$exists': if ((record[key] !== undefined) !== opVal) return false; break;
            default: return false; // unknown operator
          }
        }
      } else {
        if (record[key] !== value) return false;
      }
    }
    return true;
  }

  async find(query: any): Promise<T[]> {
    const { index } = await this.loadIndex();
    const matchingIds = Object.keys(index).filter(id => this.evaluateQuery(index[id], query));
    
    const records: T[] = [];
    for (const id of matchingIds) {
      const record = await this.findById(id);
      if (record) records.push(record);
    }
    return records;
  }

  async findOne(query: any): Promise<T | null> {
    const results = await this.find(query);
    return results.length > 0 ? results[0] : null;
  }

  async update(id: string, changes: Partial<T>): Promise<T> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new NotFoundError(`Record ${id} not found in collection ${this.name}`, id);
    }

    let updatedData = { ...existing, ...changes } as T;

    if (this.options?.hooks?.beforeUpdate) {
      const hookResult = await this.options.hooks.beforeUpdate(id, updatedData);
      updatedData = { ...updatedData, ...hookResult } as T;
    }

    this.validate(updatedData);

    const { index, sha: indexSha } = await this.loadIndex();
    index[id] = updatedData;

    const recordPath = this.getFilePath(id);
    const branch = this.config.branch || 'main';
    const existingFile = await this.config.adapter.readFile(recordPath, branch);

    const ops: BatchOp[] = [
      {
        op: 'write',
        path: this.indexPath,
        content: JSON.stringify(index, null, 2),
        sha: indexSha,
      },
      {
        op: 'write',
        path: recordPath,
        content: this.serializeRecord(updatedData),
        sha: existingFile?.sha,
      }
    ];

    await this.config.adapter.batchWrite(ops, `db: update ${this.name}/${id}`, branch);
    this.cache.delete(this.indexPath);
    this.cache.delete(recordPath);

    if (this.options?.hooks?.afterUpdate) {
      await this.options.hooks.afterUpdate(id, updatedData);
    }

    return updatedData;
  }

  async replace(id: string, data: T): Promise<T> {
    const record = { ...data, id }; // Ensure id is retained
    return this.update(id, record as unknown as Partial<T>); // Simplistic implementation for v0
  }

  async delete(id: string): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    if (this.options?.hooks?.beforeDelete) {
      await this.options.hooks.beforeDelete(id);
    }

    const { index, sha: indexSha } = await this.loadIndex();
    delete index[id];

    const recordPath = this.getFilePath(id);
    const branch = this.config.branch || 'main';
    const existingFile = await this.config.adapter.readFile(recordPath, branch);

    const ops: BatchOp[] = [
      {
        op: 'write',
        path: this.indexPath,
        content: JSON.stringify(index, null, 2),
        sha: indexSha,
      }
    ];

    if (existingFile) {
      ops.push({
        op: 'delete',
        path: recordPath,
        sha: existingFile.sha,
      });
    }

    await this.config.adapter.batchWrite(ops, `db: delete ${this.name}/${id}`, branch);
    this.cache.delete(this.indexPath);
    this.cache.delete(recordPath);

    if (this.options?.hooks?.afterDelete) {
      await this.options.hooks.afterDelete(id);
    }
  }

  async exists(id: string): Promise<boolean> {
    const { index } = await this.loadIndex();
    return index[id] !== undefined;
  }

  async count(query?: any): Promise<number> {
    const { index } = await this.loadIndex();
    if (!query) {
      return Object.keys(index).length;
    }
    return Object.keys(index).filter(id => this.evaluateQuery(index[id], query)).length;
  }

  // Batch operations (simplistic implementation for v0 to meet API requirements, could be optimized further)
  async createMany(items: Partial<T>[]): Promise<T[]> {
    const created = [];
    // Ideally this would be one batch write, but for simplicity we do sequential in v0.
    // The prompt asks for single API call per batchWrite, so we should accumulate ops.
    const { index, sha: indexSha } = await this.loadIndex();
    const ops: BatchOp[] = [];
    const results: T[] = [];

    for (const item of items) {
      const id = item.id || nanoid();
      let record = { ...item, id } as unknown as T;
      if (this.options?.hooks?.beforeCreate) {
        record = (await this.options.hooks.beforeCreate(record)) as T;
      }
      this.validate(record);
      
      index[id] = record;
      results.push(record);

      ops.push({
        op: 'write',
        path: this.getFilePath(id),
        content: this.serializeRecord(record),
      });
    }

    ops.push({
      op: 'write',
      path: this.indexPath,
      content: JSON.stringify(index, null, 2),
      sha: indexSha,
    });

    await this.config.adapter.batchWrite(ops, `db: createMany in ${this.name}`, this.config.branch || 'main');
    this.cache.delete(this.indexPath);

    for (const record of results) {
      if (this.options?.hooks?.afterCreate) {
        await this.options.hooks.afterCreate(record);
      }
    }

    return results;
  }

  async updateMany(updates: { id: string; changes: Partial<T> }[]): Promise<void> {
    for (const update of updates) {
      await this.update(update.id, update.changes); // sequential for now to handle hooks/validation properly
    }
  }

  async deleteMany(ids: string[]): Promise<void> {
    const { index, sha: indexSha } = await this.loadIndex();
    const ops: BatchOp[] = [];
    const branch = this.config.branch || 'main';

    for (const id of ids) {
      if (this.options?.hooks?.beforeDelete) {
        await this.options.hooks.beforeDelete(id);
      }
      
      delete index[id];
      const recordPath = this.getFilePath(id);
      const existingFile = await this.config.adapter.readFile(recordPath, branch);
      
      if (existingFile) {
        ops.push({
          op: 'delete',
          path: recordPath,
          sha: existingFile.sha,
        });
      }
    }

    ops.push({
      op: 'write',
      path: this.indexPath,
      content: JSON.stringify(index, null, 2),
      sha: indexSha,
    });

    await this.config.adapter.batchWrite(ops, `db: deleteMany in ${this.name}`, branch);
    this.cache.delete(this.indexPath);

    for (const id of ids) {
      if (this.options?.hooks?.afterDelete) {
        await this.options.hooks.afterDelete(id);
      }
      this.cache.delete(this.getFilePath(id));
    }
  }

  async clear(): Promise<void> {
    const { index } = await this.loadIndex();
    await this.deleteMany(Object.keys(index));
  }
}
