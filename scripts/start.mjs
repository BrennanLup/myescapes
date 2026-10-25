// PLACEHOLDER (orchestrator). Owned by workstream 20: Local Run.
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
if (!existsSync('node_modules')) execSync('npm install', { stdio: 'inherit' })
execSync('npm run build', { stdio: 'inherit' })
execSync('npm run serve', { stdio: 'inherit' })
