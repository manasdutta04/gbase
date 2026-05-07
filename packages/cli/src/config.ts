import * as dotenv from 'dotenv'
import * as path from 'path'
import * as fs from 'fs'

export interface LoadedConfig {
  provider: 'github' | 'gitlab' | 'bitbucket'
  token: string
  branch: string
  owner?: string       // github
  repo?: string        // github
  projectId?: string   // gitlab
  baseUrl?: string     // gitlab
  username?: string    // bitbucket
  workspace?: string   // bitbucket
  repoSlug?: string    // bitbucket
  appPassword?: string // bitbucket
  encryption?: { enabled: boolean; key: string }
}

export function loadConfig(cwd: string = process.cwd()): LoadedConfig {
  const envPath = path.join(cwd, '.env')
  if (!fs.existsSync(envPath)) {
    throw new Error('.env not found in current directory. Run "gbase init" first.')
  }
  dotenv.config({ path: envPath })

  const provider = process.env.GBASE_PROVIDER as LoadedConfig['provider']
  if (!provider) throw new Error('GBASE_PROVIDER not set in .env')

  return {
    provider,
    token: process.env.GBASE_TOKEN || '',
    branch: process.env.GBASE_BRANCH || 'main',
    owner: process.env.GBASE_OWNER,
    repo: process.env.GBASE_REPO,
    projectId: process.env.GBASE_PROJECT_ID,
    baseUrl: process.env.GBASE_BASE_URL,
    username: process.env.GBASE_USERNAME,
    workspace: process.env.GBASE_WORKSPACE,
    repoSlug: process.env.GBASE_REPO_SLUG,
    appPassword: process.env.GBASE_APP_PASSWORD,
    encryption: process.env.GBASE_ENCRYPTION_ENABLED === 'true'
      ? { enabled: true, key: process.env.GBASE_ENCRYPTION_KEY || '' }
      : undefined,
  }
}

export function buildAdapterAndDb(config: LoadedConfig) {
  const { GBase } = require('gbase')

  let adapter: any
  if (config.provider === 'github') {
    const { GitHubAdapter } = require('@gbase/github')
    adapter = new GitHubAdapter({
      token: config.token,
      owner: config.owner!,
      repo: config.repo!,
      branch: config.branch,
    })
  } else if (config.provider === 'gitlab') {
    const { GitLabAdapter } = require('@gbase/gitlab')
    adapter = new GitLabAdapter({
      token: config.token,
      projectId: config.projectId!,
      branch: config.branch,
      baseUrl: config.baseUrl,
    })
  } else if (config.provider === 'bitbucket') {
    const { BitbucketAdapter } = require('@gbase/bitbucket')
    adapter = new BitbucketAdapter({
      username: config.username!,
      appPassword: config.appPassword!,
      workspace: config.workspace!,
      repoSlug: config.repoSlug!,
      branch: config.branch,
    })
  } else {
    throw new Error(`Unknown provider: ${config.provider}`)
  }

  const db = new GBase({
    adapter,
    branch: config.branch,
    encryption: config.encryption,
  })

  return { adapter, db }
}
