const { spawn } = require('node:child_process')
const { resolve, join } = require('node:path')

const rootDir = resolve(__dirname, '..')
const uiDir = join(rootDir, 'ui')
const nodeExec = process.execPath

// Ensure Rollup uses the pure JS implementation under Playwright.
const env = { ...process.env, ROLLUP_USE_NODE_JS: process.env.ROLLUP_USE_NODE_JS || '1' }

// Launch Vite directly via its bin to avoid relying on pnpm CLI being on PATH.
const viteBin = join(uiDir, 'node_modules', 'vite', 'bin', 'vite.js')
const args = [viteBin, '--host', '127.0.0.1', '--port', '5173']

const child = spawn(nodeExec, args, { stdio: 'inherit', cwd: uiDir, env })

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error('[run-ui-dev] failed to launch pnpm:', error)
  process.exit(1)
})
