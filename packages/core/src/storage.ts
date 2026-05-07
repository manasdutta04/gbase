import { GBaseConfig } from './config';
import { FileEntry } from './adapter';

export interface StorageInfo extends FileEntry {}

export class FileStorage {
  private config: GBaseConfig;
  private prefix = 'storage/';

  constructor(config: GBaseConfig) {
    this.config = config;
  }

  private normalizePath(path: string): string {
    return `${this.prefix}${path.replace(/^\/+/, '')}`;
  }

  async upload(remotePath: string, content: Buffer | string): Promise<void> {
    const path = this.normalizePath(remotePath);
    const contentStr = Buffer.isBuffer(content) ? content.toString('base64') : content;
    // For buffers, we assume base64 is handled by adapter. Our adapter API requires a string content.
    // If we want to support base64 fully, the adapter interface could be expanded, but for v0 string/base64 is fine.
    await this.config.adapter.writeFile(path, contentStr, `storage: upload ${remotePath}`);
  }

  async download(remotePath: string): Promise<Buffer> {
    const path = this.normalizePath(remotePath);
    const branch = this.config.branch || 'main';
    const file = await this.config.adapter.readFile(path, branch);
    
    if (!file) {
      throw new Error(`File not found: ${remotePath}`);
    }

    return file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : Buffer.from(file.content, 'utf-8');
  }

  async delete(remotePath: string): Promise<void> {
    const path = this.normalizePath(remotePath);
    const branch = this.config.branch || 'main';
    const file = await this.config.adapter.readFile(path, branch);
    
    if (file) {
      await this.config.adapter.deleteFile(path, file.sha, `storage: delete ${remotePath}`);
    }
  }

  async exists(remotePath: string): Promise<boolean> {
    const path = this.normalizePath(remotePath);
    const branch = this.config.branch || 'main';
    const file = await this.config.adapter.readFile(path, branch);
    return !!file;
  }

  async list(prefix = ''): Promise<StorageInfo[]> {
    const path = this.normalizePath(prefix);
    const branch = this.config.branch || 'main';
    const files = await this.config.adapter.listFiles(path, branch);
    return files;
  }

  async info(remotePath: string): Promise<StorageInfo | null> {
    const path = this.normalizePath(remotePath);
    const parts = path.split('/');
    const dir = parts.slice(0, -1).join('/');
    const filename = parts[parts.length - 1];
    
    const branch = this.config.branch || 'main';
    const files = await this.config.adapter.listFiles(dir, branch);
    
    const file = files.find(f => f.path === filename || f.path === path);
    return file || null;
  }

  getUrl(remotePath: string): string {
    throw new Error('Not implemented: requires specific provider logic. Implement locally or wait for v1.');
  }
}
