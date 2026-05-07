# GBase
[![npm](https://img.shields.io/npm/v/gbase)](https://www.npmjs.com/package/gbase)
[![npm](https://img.shields.io/npm/dm/gbase)](https://www.npmjs.com/package/gbase)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)


**Zero-cost, version-controlled database powered by Git.**

GBase turns any Git repository (GitHub, GitLab, or Bitbucket) into a lightweight, durable, and free database with a MongoDB-like API. Perfect for hobby projects, static sites, and serverless applications.

---

## Features

- **Provider Agnostic**: Native adapters for GitHub, GitLab, and Bitbucket.
- **MongoDB-like API**: Familiar `find`, `create`, `update`, `delete` methods.
- **Key-Value Store**: Simple global key-value management.
- **File Storage**: Use your repository as a CDN for static assets.
- **Encrypted at Rest**: Built-in AES-256 encryption for your sensitive data.
- **Relations**: Cross-collection references with lazy loading via `.populate()`.
- **Zod Validation**: Built-in schema validation.
- **Zero Infrastructure**: No servers, no costs, just Git.
- **Power CLI**: Interactive setup, data health checks, and cross-provider migration.

---

## Installation

```bash
# Core engine
npm install gbase

# Choose your adapter
npm install @gbase/github
# or
npm install @gbase/gitlab
# or
npm install @gbase/bitbucket
```

---

## Quick Start

### 1. Initialize via CLI
Run the interactive setup wizard in your project root:
```bash
npx @gbase/cli init
```

### 2. Basic Usage

```typescript
import { GBase } from 'gbase';
import { GitHubAdapter } from '@gbase/github';
import { z } from 'zod';

const db = new GBase({
  adapter: new GitHubAdapter({
    token: process.env.GITHUB_TOKEN!,
    owner: 'user',
    repo: 'my-db',
  })
});

// Define a collection with schema
const users = db.collection('users', {
  schema: z.object({
    name: z.string(),
    email: z.string().email(),
  })
});

async function main() {
  // Create a record
  await users.create({ name: 'Alice', email: 'alice@example.com' });

  // Find records
  const alice = await users.findOne({ name: 'Alice' });
  console.log(alice);
}
```

---

## Relations & Lazy Loading

GBase supports cross-collection references.

```typescript
import { ref } from 'gbase';

const posts = db.collection('posts');
const users = db.collection('users');

// Create a post referencing a user
await posts.create({
  title: 'Hello World',
  author: ref('users', 'alice-id')
});

// Fetch post and populate author
const post = await posts.findById('post-id');
const populated = await posts.populate(post, ['author']);

console.log(populated.author.name); // 'Alice'
```

---

## CLI Commands

| Command | Description |
| --- | --- |
| `init` | Interactive setup wizard |
| `health` | Check connectivity and rate limits |
| `studio` | Launch a visual database manager (Dark Mode) |
| `export <collection>` | Export data to JSON/CSV/NDJSON |
| `import <collection> <file>` | Seed data from JSON or CSV |
| `migrate --from <env1> --to <env2>` | Move data between providers/repos |

---

## Repo Structure

GBase organizes your data cleanly within your repository:
- `/collections/{name}/_index.json` (Record metadata for fast queries)
- `/collections/{name}/{id}.json` (Document content)
- `/kv/store.json` (Key-value data)
- `/storage/{path}` (Binary files)

---

## License
MIT © GBase Team
