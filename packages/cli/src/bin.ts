#!/usr/bin/env node
import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import open from 'open';
import express from 'express';
import fs from 'fs';
import crypto from 'crypto';
import { loadConfig, buildAdapterAndDb, LoadedConfig } from './config.js';

const program = new Command();
program.name('gbase').description('CLI for gbase database').version('0.1.0');

program
  .command('init')
  .description('Interactive setup wizard')
  .action(async () => {
    const { providerChoice } = await inquirer.prompt([{
      type: 'list', name: 'providerChoice', message: 'Which provider?', choices: ['GitHub', 'GitLab', 'Bitbucket']
    }]);

    const provider = providerChoice.toLowerCase() as 'github' | 'gitlab' | 'bitbucket';
    let configValues: any = { GBASE_PROVIDER: provider };

    if (provider === 'github') {
      const answers = await inquirer.prompt([
        { type: 'password', name: 'token', message: 'GitHub token:' },
        { name: 'owner', message: 'Repository owner:' },
        { name: 'repo', message: 'Repository name:' }
      ]);
      configValues.GBASE_TOKEN = answers.token;
      configValues.GBASE_OWNER = answers.owner;
      configValues.GBASE_REPO = answers.repo;
    } else if (provider === 'gitlab') {
      const answers = await inquirer.prompt([
        { type: 'password', name: 'token', message: 'GitLab token:' },
        { name: 'projectId', message: 'Project ID or "namespace/repo":' },
        { name: 'baseUrl', message: 'Base URL (leave empty for https://gitlab.com):', default: 'https://gitlab.com' }
      ]);
      configValues.GBASE_TOKEN = answers.token;
      configValues.GBASE_PROJECT_ID = answers.projectId;
      configValues.GBASE_BASE_URL = answers.baseUrl;
    } else if (provider === 'bitbucket') {
      const answers = await inquirer.prompt([
        { name: 'username', message: 'Bitbucket username:' },
        { type: 'password', name: 'appPassword', message: 'App password:' },
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

    configValues.GBASE_ENCRYPTION_ENABLED = encrypt ? 'true' : 'false';

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
    let tsContent = 'import { GBaseConfig } from "gbase";\n\nexport default {\n';

    for (const [key, value] of Object.entries(configValues)) {
      envContent += `${key}=${value}\n`;
      tsContent += `  ${key}: '${value}',\n`;
    }
    tsContent += '} as any;\n';

    if (configType === '.env' || configType === 'both') {
      fs.writeFileSync('.env', envContent);
      console.log(chalk.green('✅ Wrote .env'));
    }
    if (configType === 'gbase.config.ts' || configType === 'both') {
      fs.writeFileSync('gbase.config.ts', tsContent);
      console.log(chalk.green('✅ Wrote gbase.config.ts'));
    }

    const spinner = ora('Verifying connection...').start();
    try {
      const tempConfig: LoadedConfig = {
        provider,
        token: configValues.GBASE_TOKEN,
        branch: configValues.GBASE_BRANCH,
        owner: configValues.GBASE_OWNER,
        repo: configValues.GBASE_REPO,
        projectId: configValues.GBASE_PROJECT_ID,
        baseUrl: configValues.GBASE_BASE_URL,
        username: configValues.GBASE_USERNAME,
        workspace: configValues.GBASE_WORKSPACE,
        repoSlug: configValues.GBASE_REPO_SLUG,
        appPassword: configValues.GBASE_APP_PASSWORD,
        encryption: encrypt ? { enabled: true, key: configValues.GBASE_ENCRYPTION_KEY } : undefined
      };
      
      const { adapter } = buildAdapterAndDb(tempConfig);
      await adapter.ensureRepo();
      spinner.succeed('Connection verified! Repository is ready.');
      
      console.log(chalk.blue('\nSummary:'));
      console.log(`Provider: ${providerChoice}`);
      console.log(`Branch: ${branch}`);
      console.log(`Encryption: ${encrypt ? 'Enabled' : 'Disabled'}`);
    } catch (err: any) {
      spinner.fail();
      console.error(chalk.red(`Failed to verify connection: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('health')
  .description('Check database health')
  .action(async () => {
    try {
      const config = loadConfig();
      const { adapter, db } = buildAdapterAndDb(config);
      
      const spinner = ora('Checking health...').start();
      const health = await db.health();
      const files = await adapter.listFiles('collections', config.branch);
      const collections = Array.from(new Set(files.map((f: any) => f.path.split('/')[0])));
      
      spinner.stop();
      console.log(chalk.bold('\nGBase Health Report'));
      console.log('-------------------');
      console.log(`Provider:     ${config.provider}`);
      
      let repoStr = '';
      if (config.provider === 'github') repoStr = `${config.owner}/${config.repo}`;
      if (config.provider === 'gitlab') repoStr = `${config.projectId}`;
      if (config.provider === 'bitbucket') repoStr = `${config.workspace}/${config.repoSlug}`;
      
      console.log(`Repository:   ${repoStr}`);
      console.log(`Branch:       ${config.branch}`);
      
      if (health.rateLimit) {
        const resetStr = health.rateLimit.resetsAt !== 'unknown' 
          ? new Date(health.rateLimit.resetsAt).toLocaleTimeString() 
          : 'unknown';
        console.log(`Rate limit:   ${health.rateLimit.remaining} remaining / ${health.rateLimit.limit} total (resets at ${resetStr})`);
      } else {
        console.log(`Rate limit:   not available`);
      }
      
      console.log(`Collections:  ${collections.length > 0 ? collections.join(', ') : '(none)'}`);
      console.log(`Status:       ${health.status === 'ok' ? chalk.green('healthy') : chalk.red('error')} ${health.message ? '- ' + health.message : ''}`);
      
      if (health.status !== 'ok') process.exit(1);
    } catch (err: any) {
      console.error(chalk.red(`Error checking health: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('export <collection>')
  .description('Export all records from a collection')
  .option('--format <format>', 'json|csv|ndjson', 'json')
  .option('--out <filepath>', 'Output file path')
  .action(async (collectionName, options) => {
    try {
      const config = loadConfig();
      const { db } = buildAdapterAndDb(config);
      
      const col = db.collection(collectionName);
      const records = await col.findAll();
      console.error(`Exported ${records.length} records.`); // write to stderr

      let output = '';
      if (options.format === 'json') {
        output = JSON.stringify(records, null, 2);
      } else if (options.format === 'ndjson') {
        output = records.map((r: any) => JSON.stringify(r)).join('\n');
      } else if (options.format === 'csv') {
        if (records.length === 0) {
          output = '';
        } else {
          const keys = Object.keys(records[0]);
          const header = keys.join(',');
          const rows = records.map((r: any) => keys.map(k => {
            const val = r[k];
            let str = '';
            if (val !== null && val !== undefined) {
              str = typeof val === 'object' ? JSON.stringify(val) : String(val);
            }
            return `"${str.replace(/"/g, '""')}"`;
          }).join(','));
          output = [header, ...rows].join('\n');
        }
      } else {
        throw new Error(`Unknown format: ${options.format}`);
      }

      if (options.out) {
        fs.writeFileSync(options.out, output);
        console.error(chalk.green(`Export written to ${options.out}`));
      } else {
        console.log(output);
      }
    } catch (err: any) {
      console.error(chalk.red(`Export failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('studio')
  .description('Start the local studio UI')
  .action(async () => {
    try {
      const config = loadConfig();
      const { adapter, db } = buildAdapterAndDb(config);
      
      const app = express();
      app.use(express.json());

      const HTML = `
  <!DOCTYPE html>
  <html>
  <head>
    <title>gbase studio</title>
    <style>
      body { font-family: monospace; margin: 0; display: flex; height: 100vh; background-color: #0d1117; color: white; }
      .sidebar { width: 250px; background: #161b22; border-right: 1px solid #30363d; padding: 1rem; overflow-y: auto; }
      .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
      .header { height: 50px; border-bottom: 1px solid #30363d; display: flex; align-items: center; padding: 0 1rem; background: #161b22; }
      .content { flex: 1; padding: 1rem; overflow-y: auto; }
      ul { list-style: none; padding: 0; }
      li { padding: 0.5rem; cursor: pointer; border-radius: 4px; }
      li:hover { background: #30363d; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
      th, td { padding: 0.5rem; border: 1px solid #30363d; text-align: left; }
      th { background: #161b22; }
      button { background: #238636; color: white; border: none; padding: 0.5rem 1rem; border-radius: 4px; cursor: pointer; }
      button:hover { background: #2ea043; }
      .btn-danger { background: #da3633; }
      .btn-danger:hover { background: #f85149; }
      textarea { width: 100%; height: 200px; background: #0d1117; color: white; border: 1px solid #30363d; padding: 0.5rem; font-family: monospace; }
    </style>
  </head>
  <body>
    <div class="sidebar">
      <h3>Collections</h3>
      <ul id="colList"></ul>
      <hr style="border-color:#30363d">
      <div style="cursor:pointer; padding:0.5rem;" onclick="loadKV()">Key-Value Store</div>
    </div>
    <div class="main">
      <div class="header">
        <strong style="margin-right:auto">gbase studio</strong>
        <span style="color:#8b949e">Provider: ${config.provider} | Branch: ${config.branch}</span>
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
        
        let html = \`<h2>\${name}</h2><button onclick="showCreateForm()">Add record</button><br><br>\`;
        
        if (records.length === 0) {
          html += \`<p>No records.</p>\`;
          document.getElementById('content').innerHTML = html;
          return;
        }
        
        const keys = Object.keys(records[0]);
        html += \`<table><tr>\`;
        html += \`<th>id</th>\`;
        keys.filter(k => k !== 'id').forEach(k => html += \`<th>\${k}</th>\`);
        html += \`<th>Actions</th></tr>\`;
        
        records.forEach(r => {
          html += \`<tr>\`;
          html += \`<td>\${r.id}</td>\`;
          keys.filter(k => k !== 'id').forEach(k => html += \`<td>\${JSON.stringify(r[k]).substring(0,50)}</td>\`);
          html += \`<td>
            <button onclick='showEditForm(\${JSON.stringify(r)})'>Edit</button> 
            <button class="btn-danger" onclick="deleteRecord('\${r.id}')">Delete</button>
          </td></tr>\`;
        });
        html += '</table>';
        document.getElementById('content').innerHTML = html;
      }

      async function loadKV() {
        activeCollection = null;
        const res = await fetch('/api/kv');
        const kvs = await res.json();
        const keys = Object.keys(kvs);
        
        let html = \`<h2>Key-Value Store</h2><button onclick="showCreateKVForm()">Add key</button><br><br>\`;
        html += \`<table><tr><th>Key</th><th>Value</th><th>Actions</th></tr>\`;
        keys.forEach(k => {
          html += \`<tr><td>\${k}</td><td>\${JSON.stringify(kvs[k])}</td><td>
            <button onclick='showEditKVForm("\${k}", \${JSON.stringify(kvs[k])})'>Edit</button>
            <button class="btn-danger" onclick="deleteKV('\${k}')">Delete</button>
          </td></tr>\`;
        });
        html += '</table>';
        document.getElementById('content').innerHTML = html;
      }

      function showCreateForm() {
        document.getElementById('content').innerHTML = \`
          <h2>Add record to \${activeCollection}</h2>
          <textarea id="jsonEditor">{\n  \n}</textarea><br><br>
          <button onclick="saveNewRecord()">Save</button>
          <button onclick="loadCollection('\${activeCollection}')">Cancel</button>
        \`;
      }

      function showEditForm(record) {
        document.getElementById('content').innerHTML = \`
          <h2>Edit record in \${activeCollection}</h2>
          <textarea id="jsonEditor">\${JSON.stringify(record, null, 2)}</textarea><br><br>
          <button onclick="updateRecord('\${record.id}')">Save</button>
          <button onclick="loadCollection('\${activeCollection}')">Cancel</button>
        \`;
      }
      
      function showCreateKVForm() {
        document.getElementById('content').innerHTML = \`
          <h2>Add KV</h2>
          <input type="text" id="kvKey" placeholder="Key" style="width:100%; padding:0.5rem; margin-bottom:1rem; background:#0d1117; color:white; border:1px solid #30363d;">
          <textarea id="jsonEditor">"value"</textarea><br><br>
          <button onclick="saveNewKV()">Save</button>
          <button onclick="loadKV()">Cancel</button>
        \`;
      }

      function showEditKVForm(key, value) {
        document.getElementById('content').innerHTML = \`
          <h2>Edit KV: \${key}</h2>
          <input type="hidden" id="kvKey" value="\${key}">
          <textarea id="jsonEditor">\${JSON.stringify(value, null, 2)}</textarea><br><br>
          <button onclick="saveNewKV()">Save</button>
          <button onclick="loadKV()">Cancel</button>
        \`;
      }

      function saveNewRecord() {
        try {
          const data = JSON.parse(document.getElementById('jsonEditor').value);
          fetch(\`/api/collections/\${activeCollection}\`, {
            method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
          }).then(() => loadCollection(activeCollection));
        } catch(e) { alert("Invalid JSON: " + e.message); }
      }

      function updateRecord(id) {
        try {
          const data = JSON.parse(document.getElementById('jsonEditor').value);
          fetch(\`/api/collections/\${activeCollection}/\${id}\`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
          }).then(() => loadCollection(activeCollection));
        } catch(e) { alert("Invalid JSON: " + e.message); }
      }

      function saveNewKV() {
        try {
          const key = document.getElementById('kvKey').value;
          const val = JSON.parse(document.getElementById('jsonEditor').value);
          if(!key) return alert("Key required");
          fetch(\`/api/kv/\${key}\`, {
            method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({value: val})
          }).then(() => loadKV());
        } catch(e) { alert("Invalid JSON: " + e.message); }
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

      app.get('/', (req, res) => res.send(HTML));

      app.get('/api/collections', async (req, res) => {
        try {
          const files = await adapter.listFiles('collections', config.branch);
          const collections = Array.from(new Set(files.map((f: any) => f.path.split('/')[0])));
          res.json(collections);
        } catch (e: any) { res.status(500).json({error: e.message}) }
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

      const port = process.env.PORT || 4321;
      app.listen(port, () => {
        console.log(chalk.green(`gbase studio running at http://localhost:${port} — press Ctrl+C to stop`));
        open(`http://localhost:${port}`);
      });
    } catch (err: any) {
      console.error(chalk.red(`Error starting studio: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('migrate')
  .description('Migrate data from one provider/repo to another')
  .requiredOption('--from <path>', 'Path to source .env file')
  .requiredOption('--to <path>', 'Path to destination .env file')
  .action(async (options) => {
    try {
      console.log(chalk.blue('Starting migration...'));
      const sourceConfig = loadConfig(options.from);
      const destConfig = loadConfig(options.to);

      const { adapter: sourceAdapter, db: sourceDb } = buildAdapterAndDb(sourceConfig);
      const { adapter: destAdapter, db: destDb } = buildAdapterAndDb(destConfig);

      const spinner = ora('Fetching source collections...').start();
      const files = await sourceAdapter.listFiles('collections', sourceConfig.branch);
      const collections = Array.from(new Set(files.map((f: any) => f.path.split('/')[0])));
      spinner.succeed(`Found ${collections.length} collections: ${collections.join(', ')}`);

      for (const colName of collections) {
        const colSpinner = ora(`Migrating ${colName}...`).start();
        const records = await sourceDb.collection(colName).findAll();
        
        if (records.length > 0) {
          await destDb.collection(colName).createMany(records);
          colSpinner.succeed(`Migrated ${records.length} records for ${colName}`);
        } else {
          colSpinner.info(`Collection ${colName} is empty, skipping`);
        }
      }

      // KV migration
      const kvSpinner = ora('Migrating KV store...').start();
      const kvs = await sourceDb.kv().getAll();
      const keys = Object.keys(kvs);
      if (keys.length > 0) {
        for (const key of keys) {
          await destDb.kv().set(key, kvs[key]);
        }
        kvSpinner.succeed(`Migrated ${keys.length} KV pairs`);
      } else {
        kvSpinner.info('KV store is empty, skipping');
      }

      console.log(chalk.green('\n✅ Migration complete!'));
    } catch (err: any) {
      console.error(chalk.red(`\nMigration failed: ${err.message}`));
      process.exit(1);
    }
  });

program
  .command('import <collection> <file>')
  .description('Import data from a JSON or CSV file')
  .action(async (collectionName, filePath) => {
    try {
      const config = loadConfig();
      const { db } = buildAdapterAndDb(config);
      const col = db.collection(collectionName);

      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const content = fs.readFileSync(filePath, 'utf-8');
      let records: any[] = [];

      if (filePath.endsWith('.json')) {
        records = JSON.parse(content);
        if (!Array.isArray(records)) records = [records];
      } else if (filePath.endsWith('.csv')) {
        const lines = content.split('\n').filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
        records = lines.slice(1).map(line => {
          const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
          const obj: any = {};
          headers.forEach((h, i) => {
            let val: any = values[i];
            if (val === 'true') val = true;
            else if (val === 'false') val = false;
            else if (!isNaN(Number(val)) && val !== '') val = Number(val);
            obj[h] = val;
          });
          return obj;
        });
      } else {
        throw new Error('Unsupported file format. Use .json or .csv');
      }

      const spinner = ora(`Importing ${records.length} records into ${collectionName}...`).start();
      await col.createMany(records);
      spinner.succeed(`Successfully imported ${records.length} records.`);
    } catch (err: any) {
      console.error(chalk.red(`Import failed: ${err.message}`));
      process.exit(1);
    }
  });

program.parse(process.argv);
