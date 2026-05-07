import 'dotenv/config'
import { GBase } from './packages/core/dist'
import { GitHubAdapter } from './packages/adapter-github/dist'

const adapter = new GitHubAdapter({
  token: process.env.GITHUB_TOKEN!,
  owner: process.env.GITHUB_OWNER!,
  repo: process.env.GITHUB_REPO!,
})

const db = new GBase({ adapter })

async function run() {
  const health = await db.health();
  console.log('Health:', health);
  const users = db.collection('users')
  await users.create({ name: 'Alice', role: 'admin' })
  console.log(await users.findAll())
}
run();