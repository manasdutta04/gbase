import { StorageAdapter, FileResult, FileEntry, BatchOp, RateLimitInfo, RateLimitError, ConflictError, AuthenticationError } from 'gbase';

export interface GitHubAdapterConfig {
  token: string;
  owner: string;
  repo: string;
  branch?: string;     // default: 'main'
  debug?: boolean;
}

export class GitHubAdapter implements StorageAdapter {
  private config: GitHubAdapterConfig;
  private baseUrl = 'https://api.github.com';

  constructor(config: GitHubAdapterConfig) {
    this.config = config;
    this.config.branch = this.config.branch || 'main';
  }

  private get headers() {
    return {
      'Authorization': `Bearer ${this.config.token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    };
  }

  private async request(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
    let lastError: Error | null = null;
    
    for (let i = 0; i < retries; i++) {
      try {
        const response = await fetch(`${this.baseUrl}${url}`, {
          ...options,
          headers: { ...this.headers, ...options.headers },
        });

        if (response.status === 401) {
          throw new AuthenticationError('GitHub API token is invalid or missing scopes.');
        }

        if (response.status === 403 || response.status === 429) {
          const limit = response.headers.get('x-ratelimit-limit');
          const remaining = response.headers.get('x-ratelimit-remaining');
          if (remaining === '0') {
            const reset = response.headers.get('x-ratelimit-reset');
            const retryAfter = reset ? parseInt(reset) * 1000 - Date.now() : 60000;
            throw new RateLimitError('GitHub API rate limit exceeded.', Math.max(retryAfter, 0));
          }
        }

        if (response.status === 409) {
          throw new ConflictError('Concurrent modification detected (SHA mismatch).', url);
        }

        return response;
      } catch (err: any) {
        if (err instanceof AuthenticationError || err instanceof RateLimitError || err instanceof ConflictError) {
          throw err;
        }
        lastError = err;
        // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
      }
    }
    
    throw lastError || new Error(`Failed to fetch ${url} after ${retries} retries`);
  }

  async readFile(path: string, branch: string): Promise<FileResult | null> {
    const response = await this.request(`/repos/${this.config.owner}/${this.config.repo}/contents/${path}?ref=${branch}`);
    
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Failed to read file: ${response.statusText}`);

    const data: any = await response.json();
    return {
      content: Buffer.from(data.content, 'base64').toString('utf-8'),
      sha: data.sha,
      encoding: 'utf-8',
    };
  }

  async writeFile(path: string, content: string, commitMessage: string, sha?: string): Promise<void> {
    const body: any = {
      message: commitMessage,
      content: Buffer.from(content, 'utf-8').toString('base64'),
      branch: this.config.branch,
    };
    if (sha) body.sha = sha;

    const response = await this.request(`/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`Failed to write file: ${response.statusText}`);
  }

  async deleteFile(path: string, sha: string, commitMessage: string): Promise<void> {
    const body = {
      message: commitMessage,
      sha,
      branch: this.config.branch,
    };

    const response = await this.request(`/repos/${this.config.owner}/${this.config.repo}/contents/${path}`, {
      method: 'DELETE',
      body: JSON.stringify(body),
    });

    if (!response.ok) throw new Error(`Failed to delete file: ${response.statusText}`);
  }

  async listFiles(dir: string, branch: string): Promise<FileEntry[]> {
    // We use the git trees API as it's better for listing and filtering
    // First, get the commit of the branch
    const refRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branch}`);
    if (refRes.status === 404) return []; // Branch might not exist yet
    if (!refRes.ok) throw new Error(`Failed to get ref: ${refRes.statusText}`);
    const refData: any = await refRes.json();
    const commitSha = refData.object.sha;

    // Get the tree
    const treeRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/trees/${commitSha}?recursive=1`);
    if (!treeRes.ok) throw new Error(`Failed to get tree: ${treeRes.statusText}`);
    const treeData: any = await treeRes.json();

    return treeData.tree
      .filter((item: any) => item.path.startsWith(dir) && item.path !== dir)
      .map((item: any) => ({
        path: item.path.substring(dir.length > 0 ? dir.length + 1 : 0), // Relative path
        sha: item.sha,
        size: item.size || 0,
        type: item.type === 'tree' ? 'dir' : 'file',
      }));
  }

  async batchWrite(ops: BatchOp[], commitMessage: string, branch: string): Promise<void> {
    if (ops.length === 0) return;

    // 1. Get current branch reference
    const refRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branch}`);
    if (!refRes.ok) throw new Error(`Failed to get ref: ${refRes.statusText}`);
    const refData: any = await refRes.json();
    const latestCommitSha = refData.object.sha;

    // 2. Get the commit to find the base tree
    const commitRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/commits/${latestCommitSha}`);
    if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.statusText}`);
    const commitData: any = await commitRes.json();
    const baseTreeSha = commitData.tree.sha;

    // 3. Create a new tree with the modifications
    const treeItems = ops.map(op => {
      if (op.op === 'write') {
        return {
          path: op.path,
          mode: '100644', // file
          type: 'blob',
          content: op.content,
        };
      } else {
        // To delete a file in a tree, set sha to null
        return {
          path: op.path,
          mode: '100644',
          type: 'blob',
          sha: null,
        };
      }
    });

    const createTreeRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems,
      }),
    });
    if (!createTreeRes.ok) throw new Error(`Failed to create tree: ${createTreeRes.statusText}`);
    const newTreeData: any = await createTreeRes.json();
    const newTreeSha = newTreeData.sha;

    // 4. Create a new commit
    const createCommitRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: commitMessage,
        tree: newTreeSha,
        parents: [latestCommitSha],
      }),
    });
    if (!createCommitRes.ok) throw new Error(`Failed to create commit: ${createCommitRes.statusText}`);
    const newCommitData: any = await createCommitRes.json();
    const newCommitSha = newCommitData.sha;

    // 5. Update the reference
    const updateRefRes = await this.request(`/repos/${this.config.owner}/${this.config.repo}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({
        sha: newCommitSha,
        force: false,
      }),
    });
    if (!updateRefRes.ok) throw new Error(`Failed to update ref: ${updateRefRes.statusText}`);
  }

  async ensureRepo(): Promise<void> {
    const res = await this.request(`/repos/${this.config.owner}/${this.config.repo}`);
    if (res.status === 404) {
      const createRes = await this.request(`/user/repos`, {
        method: 'POST',
        body: JSON.stringify({
          name: this.config.repo,
          private: true,
          auto_init: true, // Need an initial commit to get a branch
        }),
      });
      if (!createRes.ok) throw new Error(`Failed to create repository: ${createRes.statusText}`);
    } else if (!res.ok) {
      throw new Error(`Failed to check repository: ${res.statusText}`);
    }
  }

  async rateLimit(): Promise<RateLimitInfo> {
    const res = await this.request(`/rate_limit`);
    if (!res.ok) throw new Error(`Failed to get rate limit: ${res.statusText}`);
    const data: any = await res.json();
    return {
      limit: data.rate.limit,
      remaining: data.rate.remaining,
      used: data.rate.used,
      resetsAt: new Date(data.rate.reset * 1000).toISOString(),
    };
  }
}
