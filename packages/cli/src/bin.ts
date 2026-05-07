#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import express from 'express';
import { GBase } from 'gbase';
import { GitHubAdapter } from '@gbase/github';
import { GitLabAdapter } from '@gbase/gitlab';
import { BitbucketAdapter } from '@gbase/bitbucket';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import 'dotenv/config';

const program = new Command();
program.name('gbase').description('CLI for gbase database').version('0.1.0');

async function loadConfig() {
  let provider = process.env.GBASE_PROVIDER;
  if (!provider) {
    if (process.env.GBASE_OWNER && process.env.GBASE_TOKEN && !process.env.GBASE_USERNAME) {
      provider = 'github';
    } else if (process.env.GBASE_PROJECT_ID) {
      provider = 'gitlab';
    } else if (process.env.GBASE_WORKSPACE) {
      provider = 'bitbucket';
    }
  }

  if (!provider) {
    console.error(chalk.red('No configuration found. Please run `npx gbase init` first.'));
    process.exit(1);
  }

  let adapter;
  if (provider.toLowerCase() === 'github') {
    adapter = new GitHubAdapter({
      token: process.env.GBASE_TOKEN!,
      owner: process.env.GBASE_OWNER!,
      repo: process.env.GBASE_REPO!,
      branch: process.env.GBASE_BRANCH || 'main',
    });
  } else if (provider.toLowerCase() === 'gitlab') {
    adapter = new GitLabAdapter({
      token: process.env.GBASE_TOKEN!,
      projectId: process.env.GBASE_PROJECT_ID!,
      baseUrl: process.env.GBASE_BASE_URL,
      branch: process.env.GBASE_BRANCH || 'main',
    });
  } else if (provider.toLowerCase() === 'bitbucket') {
    adapter = new BitbucketAdapter({
      username: process.env.GBASE_USERNAME!,
      appPassword: process.env.GBASE_APP_PASSWORD!,
      workspace: process.env.GBASE_WORKSPACE!,
      repoSlug: process.env.GBASE_REPO_SLUG!,
      branch: process.env.GBASE_BRANCH || 'main',
    });
  } else {
    console.error(chalk.red(`Unknown provider: ${provider}`));
    process.exit(1);
  }

  const db = new GBase({
    adapter: adapter,
    branch: process.env.GBASE_BRANCH || 'main',
    encryption: process.env.GBASE_ENCRYPTION_KEY ? {
      enabled: true,
      key: process.env.GBASE_ENCRYPTION_KEY
    } : undefined
  });

  return { adapter, db, provider: provider.toLowerCase() };
}

program
  .command('init')
  .description('Interactive setup wizard')
  .action(async () => {
    const { provider } = await inquirer.prompt([{
      type: 'list', name: 'provider', message: 'Which provider?', choices: ['GitHub', 'GitLab', 'Bitbucket']
    }]);

    let configValues: any = { GBASE_PROVIDER: provider };

    if (provider === 'GitHub') {
      const answers = await inquirer.prompt([
        { name: 'token', message: 'GitHub token:' },
        { name: 'owner', message: 'Repository owner:' },
        { name: 'repo', message: 'Repository name:' }
      ]);
      configValues.GBASE_TOKEN = answers.token;
      configValues.GBASE_OWNER = answers.owner;
      configValues.GBASE_REPO = answers.repo;
    } else if (provider === 'GitLab') {
      const answers = await inquirer.prompt([
        { name: 'token', message: 'GitLab token:' },
        { name: 'projectId', message: 'Project ID or "namespace/repo":' },
        { name: 'baseUrl', message: 'Base URL (leave empty for https://gitlab.com):' }
      ]);
      configValues.GBASE_TOKEN = answers.token;
      configValues.GBASE_PROJECT_ID = answers.projectId;
      if (answers.baseUrl) configValues.GBASE_BASE_URL = answers.baseUrl;
    } else if (provider === 'Bitbucket') {
      const answers = await inquirer.prompt([
        { name: 'username', message: 'Bitbucket username:' },
        { name: 'appPassword', message: 'App password:' },
        { name: 'workspace', message: 'Workspace slug:' },
        { name: 'repoSlug', message: 'Repository slug:' }
      ]);
      configValues.GBASE_USERNAME = answers.username;
      configValues.GBASE_APP_PASSWORD = answers.appPassword;
      configValues.GBASE_WORKSPACE = answers.workspace;
      configValues.GBASE_REPO_SLUG = answers.repoSlug;
    }

    const { branch } = await inquirer.prompt([
      { name: 'branch', message: 'Branch name (default: main):', default: 'main' }
    ]);
    configValues.GBASE_BRANCH = branch;

    const { encrypt } = await inquirer.prompt([
      { type: 'confirm', name: 'encrypt', message: 'Enable encryption?', default: false }
    ]);

    if (encrypt) {
      const key = crypto.randomBytes(32).toString('hex');
      console.log(chalk.yellow(`\nGenerated encryption key: ${key}`));
      console.log(chalk.red('⚠️ SAVE THIS KEY SECURELY. IT CANNOT BE RECOVERED!\n'));
      configValues.GBASE_ENCRYPTION_KEY = key;
    }

    const { configType } = await inquirer.prompt([
      { type: 'list', name: 'configType', message: 'Where to write config?', choices: ['.env', 'gbase.config.ts', 'both'] }
    ]);

    let envContent = '';
    let tsContent = 'export default {\n';

    for (const [key, value] of Object.entries(configValues)) {
      envContent += `${key}=${value}\n`;
      tsContent += `  ${key}: '${value}',\n`;
    }
    tsContent += '};\n';

    if (configType === '.env' || configType === 'both') {
      fs.writeFileSync('.env', envContent);
      console.log(chalk.green('✅ Wrote .env'));
    }
    if (configType === 'gbase.config.ts' || configType === 'both') {
      fs.writeFileSync('gbase.config.ts', tsContent);
      console.log(chalk.green('✅ Wrote gbase.config.ts'));
    }

    // Set process.env so loadConfig can use it now
    for (const [key, value] of Object.entries(configValues)) {
      process.env[key] = value as string;
    }

    const spinner = ora('Verifying connection...').start();
    try {
      const { adapter, db } = await loadConfig();
      await adapter.ensureRepo();
      spinner.succeed('Connection verified! Repository is ready.');
      
      console.log(chalk.blue('\nSummary:'));
      console.log(`Provider: ${provider}`);
      console.log(`Branch: ${branch}`);
      console.log(`Encryption: ${encrypt ? 'Enabled' : 'Disabled'}`);
    } catch (err: any) {
      spinner.fail(`Failed to verify connection: ${err.message}`);
    }
  });

program
  .command('health')
  .description('Check database health')
  .action(async () => {
    const { adapter, db, provider } = await loadConfig();
    const spinner = ora('Checking health...').start();
    try {
      const health = await db.health();
      const files = await adapter.listFiles('collections', process.env.GBASE_BRANCH || 'main');
      const collections = Array.from(new Set(files.map(f => f.path.split('/')[0])));
      
      spinner.stop();
      console.log(chalk.bold('\nGBase Health Report'));
      console.log('-------------------');
      console.log(`Provider:     ${provider}`);
      console.log(`Branch:       ${process.env.GBASE_BRANCH || 'main'}`);
      
      if (health.rateLimit) {
        const resetStr = health.rateLimit.resetsAt !== 'unknown' 
          ? new Date(health.rateLimit.resetsAt).toLocaleTimeString() 
          : 'unknown';
        console.log(`Rate limit:   ${health.rateLimit.remaining} remaining / ${health.rateLimit.limit} total (resets at ${resetStr})`);
      } else {
        console.log(`Rate limit:   not available`);
      }
      
      console.log(`Collections:  ${collections.length > 0 ? collections.join(', ') : 'None'}`);
      console.log(`Status:       ${health.status === 'ok' ? chalk.green('healthy') : chalk.red('error')}`);
    } catch (err: any) {
      spinner.stop();
      console.error(chalk.red(`Error checking health: ${err.message}`));
    }
  });

program
  .command('export <collection>')
  .description('Export all records from a collection')
  .option('--format <format>', 'json|csv|ndjson', 'json')
  .option('--out <filepath>', 'Output file path')
  .action(async (collectionName, options) => {
    const { db } = await loadConfig();
    const spinner = ora(`Fetching records from ${collectionName}...`).start();
    try {
      const col = db.collection(collectionName);
      const records = await col.findAll();
      spinner.stop();

      let output = '';
      if (options.format === 'json') {
        output = JSON.stringify(records, null, 2);
      } else if (options.format === 'ndjson') {
        output = records.map(r => JSON.stringify(r)).join('\n');
      } else if (options.format === 'csv') {
        if (records.length === 0) {
          output = '';
        } else {
          const keys = Object.keys(records[0]);
          const header = keys.join(',');
          const rows = records.map(r => keys.map(k => {
            const val = r[k];
            const str = val === null || val === undefined ? '' : String(val);
            return `"${str.replace(/"/g, '""')}"`;
          }).join(','));
          output = [header, ...rows].join('\n');
        }
      } else {
        throw new Error(`Unknown format: ${options.format}`);
      }

      if (options.out) {
        fs.writeFileSync(options.out, output);
        console.log(chalk.green(`Exported ${records.length} records to ${options.out}`));
      } else {
        console.log(output);
      }
    } catch (err: any) {
      spinner.stop();
      console.error(chalk.red(`Export failed: ${err.message}`));
    }
  });

program
  .command('studio')
  .description('Start the local studio UI')
  .action(async () => {
    const { adapter, db, provider } = await loadConfig();
    const app = express();
    app.use(express.json());

    const HTML = `
<!DOCTYPE html>
<html>
<head>
  <title>gbase studio</title>
  <style>
    body { font-family: -apple-system, system-ui, sans-serif; margin: 0; display: flex; height: 100vh; }
    .sidebar { width: 250px; background: #f4f4f5; border-right: 1px solid #e4e4e7; padding: 1rem; overflow-y: auto; }
    .main { flex: 1; display: flex; flex-direction: column; }
    .header { height: 50px; border-bottom: 1px solid #e4e4e7; display: flex; align-items: center; padding: 0 1rem; background: white; }
    .content { flex: 1; padding: 1rem; overflow-y: auto; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.5rem; cursor: pointer; border-radius: 4px; }
    li:hover { background: #e4e4e7; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem; border: 1px solid #e4e4e7; text-align: left; }
    th { background: #f4f4f5; }
    .json-editor { width: 100%; height: 300px; font-family: monospace; }
  </style>
</head>
<body>
  <div class="sidebar">
    <h3>Collections</h3>
    <ul id="colList"></ul>
    <hr>
    <div style="cursor:pointer; padding:0.5rem;" onclick="loadKV()">Key-Value Store</div>
  </div>
  <div class="main">
    <div class="header">
      <strong style="margin-right:auto">gbase studio</strong>
      <span style="color:#71717a">Provider: ${provider} | Branch: ${process.env.GBASE_BRANCH || 'main'}</span>
    </div>
    <div class="content" id="content">
      Welcome to gbase studio. Select a collection on the left.
    </div>
  </div>
  <script>
    let activeCollection = null;
    
    async function fetchCollections() {
      const res = await fetch('/api/collections');
      const names = await res.json();
      const list = document.getElementById('colList');
      list.innerHTML = names.map(n => \`<li onclick="loadCollection('\${n}')">\${n}</li>\`).join('');
    }

    async function loadCollection(name) {
      activeCollection = name;
      const res = await fetch(\`/api/collections/\${name}\`);
      const records = await res.json();
      
      if (records.length === 0) {
        document.getElementById('content').innerHTML = \`<h2>\${name}</h2><p>No records.</p><button onclick="createRecord()">New Record</button>\`;
        return;
      }
      
      const keys = Object.keys(records[0]);
      let html = \`<h2>\${name}</h2><button onclick="createRecord()">New Record</button><br><br><table><tr>\`;
      html += keys.map(k => \`<th>\${k}</th>\`).join('');
      html += \`<th>Actions</th></tr>\`;
      
      records.forEach(r => {
        html += \`<tr>\`;
        html += keys.map(k => \`<td>\${JSON.stringify(r[k]).substring(0,50)}</td>\`).join('');
        html += \`<td><button onclick="editRecord('\${r.id}')">Edit</button> <button onclick="deleteRecord('\${r.id}')">Delete</button></td></tr>\`;
      });
      html += '</table>';
      document.getElementById('content').innerHTML = html;
    }

    async function loadKV() {
      activeCollection = null;
      const res = await fetch('/api/kv');
      const kvs = await res.json();
      const keys = Object.keys(kvs);
      
      let html = \`<h2>Key-Value Store</h2><table><tr><th>Key</th><th>Value</th><th>Actions</th></tr>\`;
      keys.forEach(k => {
        html += \`<tr><td>\${k}</td><td>\${JSON.stringify(kvs[k])}</td><td><button onclick="deleteKV('\${k}')">Delete</button></td></tr>\`;
      });
      html += '</table>';
      document.getElementById('content').innerHTML = html;
    }

    function editRecord(id) {
      // In a real app we'd fetch the single record and show an editor
      alert('Edit functionality via API requires providing valid JSON. Please implement via POSTman for now.');
    }
    
    function createRecord() {
      const data = prompt('Enter JSON for new record:');
      if (data) {
        fetch(\`/api/collections/\${activeCollection}\`, {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body: data
        }).then(() => loadCollection(activeCollection));
      }
    }

    function deleteRecord(id) {
      if (confirm('Delete?')) {
        fetch(\`/api/collections/\${activeCollection}/\${id}\`, { method: 'DELETE' })
          .then(() => loadCollection(activeCollection));
      }
    }

    function deleteKV(key) {
      if (confirm('Delete?')) {
        fetch(\`/api/kv/\${key}\`, { method: 'DELETE' })
          .then(() => loadKV());
      }
    }

    fetchCollections();
  </script>
</body>
</html>
    `;

    app.get('/', (req, res) => {
      res.send(HTML);
    });

    app.get('/api/collections', async (req, res) => {
      const files = await adapter.listFiles('collections', process.env.GBASE_BRANCH || 'main');
      const collections = Array.from(new Set(files.map(f => f.path.split('/')[0])));
      res.json(collections);
    });

    app.get('/api/collections/:name', async (req, res) => {
      try {
        const col = db.collection(req.params.name);
        const data = await col.findAll();
        res.json(data);
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.post('/api/collections/:name', async (req, res) => {
      try {
        const col = db.collection(req.params.name);
        const data = await col.create(req.body);
        res.json(data);
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.put('/api/collections/:name/:id', async (req, res) => {
      try {
        const col = db.collection(req.params.name);
        await col.update(req.params.id, req.body);
        res.json({success: true});
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.delete('/api/collections/:name/:id', async (req, res) => {
      try {
        const col = db.collection(req.params.name);
        await col.delete(req.params.id);
        res.json({success: true});
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.get('/api/kv', async (req, res) => {
      try {
        const store = db.kv();
        const data = await store.getAll();
        res.json(data);
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.put('/api/kv/:key', async (req, res) => {
      try {
        const store = db.kv();
        await store.set(req.params.key, req.body.value);
        res.json({success: true});
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.delete('/api/kv/:key', async (req, res) => {
      try {
        const store = db.kv();
        await store.delete(req.params.key);
        res.json({success: true});
      } catch (e: any) { res.status(500).json({error: e.message}) }
    });

    app.listen(4321, () => {
      console.log(chalk.green('gbase studio running at http://localhost:4321 — press Ctrl+C to stop'));
      open('http://localhost:4321');
    });
  });

program.parse(process.argv);
