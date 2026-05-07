import { StorageAdapter, FileResult, FileEntry, BatchOp, RateLimitInfo, RateLimitError, NotFoundError, AuthenticationError } from 'gbase';

export interface BitbucketAdapterConfig {
  username: string;          // Bitbucket username
  appPassword: string;       // App password
  workspace: string;         // workspace slug
  repoSlug: string;          // repository slug
  branch?: string;           // default: 'main'
  debug?: boolean;
}

export class BitbucketAdapter implements StorageAdapter {
  private config: BitbucketAdapterConfig;

  constructor(config: BitbucketAdapterConfig) {
    this.config = config;
    this.config.branch = this.config.branch || 'main';
  }

  private get authHeader() {
    return 'Basic ' + Buffer.from(`${this.config.username}:${this.config.appPassword}`).toString('base64');
  }

  private async request(url: string, options: RequestInit = {}): Promise<Response> {
    const fullUrl = `https://api.bitbucket.org/2.0${url}`;
    const headers: any = {
      'Authorization': this.authHeader,
      ...options.headers,
    };
    
    // We don't want to set Content-Type for FormData, fetch does it automatically
    
    const response = await fetch(fullUrl, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      throw new AuthenticationError('Bitbucket authentication failed. Check username and app password.');
    }
    if (response.status === 403) {
      throw new AuthenticationError('Check Bitbucket app password permissions: repository read+write required.');
    }
    if (response.status === 429) {
      throw new RateLimitError('Bitbucket API rate limit exceeded.', 60000);
    }

    return response;
  }

  async readFile(path: string, branch: string): Promise<FileResult | null> {
    const res = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/src/${branch}/${path}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to read file: ${res.statusText}`);

    const content = await res.text();

    // Get SHA
    const commitRes = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/commits?path=${path}&pagelen=1`);
    let sha = '';
    if (commitRes.ok) {
      const commitData: any = await commitRes.json();
      if (commitData.values && commitData.values.length > 0) {
        sha = commitData.values[0].hash;
      }
    }

    return {
      content: content,
      sha: sha,
      encoding: 'utf-8',
    };
  }

  async writeFile(path: string, content: string, commitMessage: string, sha?: string): Promise<void> {
    const form = new FormData();
    form.append('branch', this.config.branch!);
    form.append('message', commitMessage);
    form.append(path, content);

    const res = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/src`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) throw new Error(`Failed to write file: ${res.statusText}`);
  }

  async deleteFile(path: string, sha: string, commitMessage: string): Promise<void> {
    // Bitbucket has no single-file delete via REST. Use the src endpoint with empty content
    // to effectively overwrite, or use the files field to delete. 
    // Best approach: POST to src with the files field listing paths to delete.
    const form = new FormData();
    form.append('branch', this.config.branch!);
    form.append('message', commitMessage);
    form.append('files', path);

    const res = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/src`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) throw new Error(`Failed to delete file: ${res.statusText}`);
  }

  async listFiles(dir: string, branch: string): Promise<FileEntry[]> {
    const entries: FileEntry[] = [];
    let nextUrl = `/repositories/${this.config.workspace}/${this.config.repoSlug}/src/${branch}/${dir}/?max_depth=10&pagelen=100&q=type="commit_file"`;

    while (nextUrl) {
      // url might be full URL if it's from 'next'
      const reqUrl = nextUrl.startsWith('http') 
        ? nextUrl.substring('https://api.bitbucket.org/2.0'.length) 
        : nextUrl;

      const res = await this.request(reqUrl);
      if (res.status === 404) return []; // Directory doesn't exist
      if (!res.ok) throw new Error(`Failed to list files: ${res.statusText}`);

      const data: any = await res.json();
      
      for (const item of data.values) {
        if (item.type === 'commit_file') {
          // item.path is the full path in repo
          entries.push({
            path: item.path.substring(dir.length > 0 ? dir.length + 1 : 0),
            sha: item.commit?.hash || '',
            size: item.size || 0,
            type: 'file',
          });
        }
      }

      nextUrl = data.next || null;
    }

    return entries;
  }

  async batchWrite(ops: BatchOp[], commitMessage: string, branch: string): Promise<void> {
    if (ops.length === 0) return;

    const form = new FormData();
    form.append('branch', branch);
    form.append('message', commitMessage);

    for (const op of ops) {
      if (op.op === 'write') {
        form.append(op.path, op.content);
      } else {
        form.append('files', op.path);
      }
    }

    const res = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/src`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) throw new Error(`Failed to batch write: ${res.statusText}`);
  }

  private async bootstrapRepo(branch: string): Promise<void> {
    const form = new FormData();
    form.append('branch', branch);
    form.append('message', 'Initial commit by gbase');
    form.append('.gbase/.gitkeep', '');

    const res = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/src`, {
      method: 'POST',
      body: form,
    });

    if (!res.ok) throw new Error(`Failed to bootstrap repo: ${res.statusText}`);
  }

  async ensureRepo(): Promise<void> {
    const res = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}`);
    if (res.status === 404) {
      throw new NotFoundError('Bitbucket repository not found — create it manually.', this.config.repoSlug);
    }
    if (!res.ok) {
      throw new Error(`Failed to check repository: ${res.statusText}`);
    }

    // Check if branch exists
    const branch = this.config.branch || 'main';
    const branchRes = await this.request(`/repositories/${this.config.workspace}/${this.config.repoSlug}/refs/branches/${branch}`);
    if (branchRes.status === 404) {
      await this.bootstrapRepo(branch);
    } else if (!branchRes.ok) {
      throw new Error(`Failed to check branch: ${branchRes.statusText}`);
    }
  }

  async rateLimit(): Promise<RateLimitInfo> {
    return {
      limit: -1,
      remaining: -1,
      used: -1,
      resetsAt: 'unknown',
    };
  }
}
