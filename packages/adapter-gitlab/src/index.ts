import { StorageAdapter, FileResult, FileEntry, BatchOp, RateLimitInfo, RateLimitError, NotFoundError, AuthenticationError } from 'gbase';

export interface GitLabAdapterConfig {
  token: string;
  projectId: string;         // numeric project ID or "namespace/repo" path
  branch?: string;           // default: 'main'
  baseUrl?: string;          // default: 'https://gitlab.com'
  debug?: boolean;
}

export class GitLabAdapter implements StorageAdapter {
  private config: GitLabAdapterConfig;
  private baseUrl: string;

  constructor(config: GitLabAdapterConfig) {
    this.config = config;
    this.config.branch = this.config.branch || 'main';
    this.baseUrl = this.config.baseUrl || 'https://gitlab.com';
    // Ensure projectId is encoded if it's a path
    if (typeof this.config.projectId === 'string') {
      this.config.projectId = encodeURIComponent(this.config.projectId);
    }
  }

  private get headers() {
    return {
      'PRIVATE-TOKEN': this.config.token,
      'Content-Type': 'application/json',
    };
  }

  private async request(url: string, options: RequestInit = {}): Promise<Response> {
    const fullUrl = `${this.baseUrl}/api/v4${url}`;
    const response = await fetch(fullUrl, {
      ...options,
      headers: { ...this.headers, ...options.headers },
    });

    if (response.status === 401) {
      throw new AuthenticationError('GitLab token is invalid.');
    }
    if (response.status === 403) {
      throw new AuthenticationError('Insufficient GitLab token scope.');
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get('Retry-After');
      const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : 60000;
      throw new RateLimitError('GitLab API rate limit exceeded.', waitMs);
    }

    return response;
  }

  private encodePath(path: string): string {
    return encodeURIComponent(path);
  }

  async readFile(path: string, branch: string): Promise<FileResult | null> {
    const res = await this.request(`/projects/${this.config.projectId}/repository/files/${this.encodePath(path)}?ref=${branch}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);

    const data: any = await res.json();
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.blob_id,
      encoding: 'utf-8',
    };
  }

  async writeFile(path: string, content: string, commitMessage: string, sha?: string): Promise<void> {
    const method = sha ? 'PUT' : 'POST';
    const res = await this.request(`/projects/${this.config.projectId}/repository/files/${this.encodePath(path)}`, {
      method,
      body: JSON.stringify({
        branch: this.config.branch,
        content: Buffer.from(content, 'utf-8').toString('base64'),
        commit_message: commitMessage,
        encoding: 'base64',
      }),
    });
    if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
  }

  async deleteFile(path: string, sha: string, commitMessage: string): Promise<void> {
    const res = await this.request(`/projects/${this.config.projectId}/repository/files/${this.encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({
        branch: this.config.branch,
        commit_message: commitMessage,
      }),
    });
    if (!res.ok) throw new Error(`Failed to delete file: ${res.statusText}`);
  }

  async listFiles(dir: string, branch: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    let page = 1;

    while (page) {
      const res = await this.request(`/projects/${this.config.projectId}/repository/tree?path=${encodeURIComponent(dir)}&ref=${branch}&recursive=true&per_page=100&page=${page}`);
      if (res.status === 404) return []; // Directory or branch doesn't exist
      if (!res.ok) throw new Error(`Failed to list files: ${res.statusText}`);

      const data = await res.json() as any[];
      for (const item of data) {
        if (item.type === 'blob') {
          entries.push({
            path: item.path.substring(dir.length > 0 ? dir.length + 1 : 0),
            sha: item.id,
            size: 0, // GitLab tree API doesn't return size by default in v4 unless we do individual checks, so we return 0
            type: 'file',
          });
        }
      }

      const nextPage = res.headers.get('x-next-page');
      page = nextPage ? parseInt(nextPage) : 0;
    }

    return entries;
  }

  async batchWrite(ops: BatchOp[], commitMessage: string, branch: string): Promise<void> {
    if (ops.length === 0) return;

    const actions = ops.map(op => {
      if (op.op === 'write') {
        return {
          action: op.sha ? 'update' : 'create',
          file_path: op.path,
          content: Buffer.from(op.content || '', 'utf-8').toString('base64'),
          encoding: 'base64',
        };
      } else {
        return {
          action: 'delete',
          file_path: op.path,
        };
      }
    });

    const res = await this.request(`/projects/${this.config.projectId}/repository/commits`, {
      method: 'POST',
      body: JSON.stringify({
        branch: branch,
        commit_message: commitMessage,
        actions: actions,
      }),
    });

    if (!res.ok) throw new Error(`Failed to batch write: ${res.statusText}`);
  }

  private async bootstrapRepo(branch: string): Promise<void> {
    const res = await this.request(`/projects/${this.config.projectId}/repository/commits`, {
      method: 'POST',
      body: JSON.stringify({
        branch: branch,
        commit_message: 'Initial commit by gbase',
        actions: [{
          action: 'create',
          file_path: '.gbase/.gitkeep',
          content: Buffer.from('', 'utf-8').toString('base64'),
          encoding: 'base64'
        }]
      })
    });
    if (!res.ok) throw new Error(`Failed to bootstrap repo: ${res.statusText}`);
  }

  async ensureRepo(): Promise<void> {
    const res = await this.request(`/projects/${this.config.projectId}`);
    if (res.status === 404) {
      throw new NotFoundError('GitLab project not found — create it manually and provide the project ID', this.config.projectId);
    }
    if (!res.ok) {
      throw new Error(`Failed to check repository: ${res.statusText}`);
    }

    // Check if default branch exists
    const branch = this.config.branch || 'main';
    const branchRes = await this.request(`/projects/${this.config.projectId}/repository/branches/${branch}`);
    if (branchRes.status === 404) {
      // Bootstrap the repo
      await this.bootstrapRepo(branch);
    } else if (!branchRes.ok) {
      throw new Error(`Failed to check branch: ${branchRes.statusText}`);
    }
  }

  async rateLimit(): Promise<RateLimitInfo> {
    // GitLab does not expose standard rate limit headers nicely on all tier APIs, mock it
    return {
      limit: -1,
      remaining: -1,
      used: -1,
      resetsAt: 'unknown',
    };
  }
}
