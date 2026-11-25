import { defineCheck } from 'orca/testing'
import type { StepStatus } from './protocol'

const steps: StepStatus[] = [
  { id: 'vscode', title: 'VS Code', group: 'ferramentas', status: 'ok' },
  { id: 'git', title: 'Git', group: 'ferramentas', status: 'missing' },
  { id: 'node', title: 'Node.js LTS', group: 'ferramentas', status: 'ok' },
  { id: 'claude', title: 'Claude Code', group: 'agentes', status: 'skip' },
  { id: 'gemini', title: 'Gemini CLI', group: 'agentes', status: 'unknown' },
  { id: 'glab-auth', title: 'Login no GitLab da NDS', group: 'gitlab', status: 'missing' }
]

export default defineCheck({
  semWorkspace: { requests: { 'setup.audit': () => ({ platform: null, steps: [], noWorkspace: true }) } },
  pronto: { requests: { 'setup.audit': () => ({ platform: 'darwin', steps }) } },
  falha: { requests: { 'setup.audit': () => { throw new Error('boom') } } }
})
