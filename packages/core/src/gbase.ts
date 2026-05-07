import { GBaseConfig } from './config';
import { Collection, CollectionOptions } from './collection';
import { KeyValue } from './kv';
import { FileStorage } from './storage';
import { Cache } from './cache';

export interface HealthResult {
  status: 'ok' | 'error';
  rateLimit?: any;
  message?: string;
}

export interface SafeConfigInfo {
  branch: string;
  hasEncryption: boolean;
  debug: boolean;
}

export class GBase {
  private config: GBaseConfig;
  private cacheInstance: Cache;

  constructor(config: GBaseConfig) {
    this.config = config;
    this.cacheInstance = new Cache();
    
    // Default values
    this.config.branch = this.config.branch || 'main';
    this.config.debug = this.config.debug || false;
  }

  collection<T extends Record<string, any>>(name: string, options?: CollectionOptions<T>): Collection<T> {
    return new Collection<T>(this.config, this.cacheInstance, name, options);
  }

  kv(): KeyValue {
    return new KeyValue(this.config, this.cacheInstance);
  }

  storage(): FileStorage {
    return new FileStorage(this.config);
  }

  async health(): Promise<HealthResult> {
    try {
      await this.config.adapter.ensureRepo();
      const rateLimitInfo = await this.config.adapter.rateLimit();
      return {
        status: 'ok',
        rateLimit: rateLimitInfo,
      };
    } catch (error: any) {
      return {
        status: 'error',
        message: error.message,
      };
    }
  }

  async rateLimit() {
    return this.config.adapter.rateLimit();
  }

  clearCache(): void {
    this.cacheInstance.clear();
  }

  info(): SafeConfigInfo {
    return {
      branch: this.config.branch!,
      hasEncryption: !!this.config.encryption?.enabled,
      debug: !!this.config.debug,
    };
  }
}
