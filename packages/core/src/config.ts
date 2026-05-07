import { StorageAdapter } from './adapter';

export interface GBaseConfig {
  adapter: StorageAdapter;
  branch?: string;           // default: 'main'
  debug?: boolean;           // default: false
  encryption?: {
    enabled: boolean;
    key: string;
  };
  retry?: {
    enabled: boolean;
    maxRetries: number;
    backoff: 'exponential' | 'linear' | 'fixed';
  };
}
