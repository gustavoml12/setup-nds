import type { OrcaWorkerApi } from 'orca/worker'
import type { AuditAnswer, CloneAnswer, FixAnswer, GitlabAnswer, IssuesAnswer, StepStatus } from './protocol'
import type { StepId, StepStatusValue } from './steps'
import { AUDIT_MARKER, FIX_MARKER, STEPS, auditCommand, fixCommand, parseAudit } from './steps'
import { DEADLINES, closeQuietly, markerLine, runStep, type Host } from './runner'
import { detectPlatform } from './platform'
import { CLONE_MARKER, ISSUES_MARKER, authLoginCommand, cloneCommand, dedupePaths, issuesCommand, parseIssues } from './gitlab'

type ActiveRun = { terminalId: string; marker: string }

type WorkspaceResolution =
  | { kind: 'found'; workspaceId: string; path: string }
  | { kind: 'absent' }
  | { kind: 'error'; detail: string }

export default function activate(orca: OrcaWorkerApi): void {
  const host: Host = { call: (method, params) => orca.host.call(method as never, params as never) }

  const runs = new Map<StepId, ActiveRun>()

  // Uma operação por vez: duas ao mesmo tempo disputam o workspace e embaralham os marcadores.
  let tail: Promise<unknown> = Promise.resolve()
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = tail.then(operation, operation)
    tail = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async function workspaceOf(): Promise<WorkspaceResolution> {
    try {
      const context = (await host.call('workspace.readContext', {})) as { workspaceId?: string } | null
      if (!context?.workspaceId) return { kind: 'absent' }
      const listed = (await host.call('workspace.list', {})) as {
        workspaces: { id: string; path: string }[]
      }
      const found = listed.workspaces.find((workspace) => workspace.id === context.workspaceId)
      if (!found) return { kind: 'absent' }
      return { kind: 'found', workspaceId: found.id, path: found.path }
    } catch (error) {
      return { kind: 'error', detail: messageOf(error) }
    }
  }

  async function audit(): Promise<AuditAnswer> {
    const workspace = await workspaceOf()
    if (workspace.kind === 'absent') return { platform: null, steps: [], noWorkspace: true }
    if (workspace.kind === 'error') return { platform: null, steps: [], error: workspace.detail }

    const platform = detectPlatform(workspace.path)
    if (!platform) return { platform: null, steps: [], error: 'não consegui determinar o sistema operacional desta máquina' }

    let output: string
    try {
      output = await runStep(host, 'setup: audit', auditCommand(platform), [AUDIT_MARKER], DEADLINES.audit)
    } catch (error) {
      return { platform, steps: [], error: messageOf(error) }
    }

    const values = parseAudit(output)
    const steps: StepStatus[] = STEPS.map((step) => {
      const status = statusFor(step.id, values)
      return { id: step.id, title: step.title, group: step.group, status, detail: detailFor(status) }
    })
    return { platform, steps }
  }

  async function fix(stepId: StepId): Promise<FixAnswer> {
    const step = STEPS.find((candidate) => candidate.id === stepId)
    if (!step) return { done: true, ok: false, detail: `etapa desconhecida: ${stepId}` }

    const existing = runs.get(stepId)
    if (existing) {
      try {
        const output = await readTerminal(existing.terminalId)
        if (markerLine(output, existing.marker) === -1) return { done: false, ok: false, detail: 'ainda executando…' }
        await closeQuietly(host, existing.terminalId)
        runs.delete(stepId)
        return { done: true, ok: !output.includes('NEED_ADMIN') && !output.includes('NO_PKG_MANAGER'), detail: summaryOf(output) }
      } catch (error) {
        // O terminal morreu ou foi fechado: limpa o registro pra um novo start poder nascer.
        runs.delete(stepId)
        await closeQuietly(host, existing.terminalId)
        return { done: true, ok: false, detail: messageOf(error) }
      }
    }

    const workspace = await workspaceOf()
    if (workspace.kind === 'absent') return { done: true, ok: false, detail: 'abra uma pasta no Orca para eu poder rodar os comandos' }
    if (workspace.kind === 'error') return { done: true, ok: false, detail: workspace.detail }

    const platform = detectPlatform(workspace.path)
    if (!platform) return { done: true, ok: false, detail: 'não consegui determinar o sistema operacional' }

    const command = fixCommand(stepId, platform)
    if (command === null) return { done: true, ok: false, detail: 'esta etapa tem correção própria; use o botão dela' }

    let terminalId: string
    try {
      const created = (await host.call('terminal.create', {
        workspaceId: workspace.workspaceId,
        title: `setup: ${stepId}`,
        command
      })) as { terminalId: string }
      terminalId = created.terminalId
    } catch (error) {
      return { done: true, ok: false, detail: messageOf(error) }
    }

    runs.set(stepId, { terminalId, marker: FIX_MARKER })
    return { done: false, ok: false, detail: 'executando…' }
  }

  async function readTerminal(terminalId: string): Promise<string> {
    const read = (await host.call('terminal.read', { terminalId, maxLines: 200 })) as { lines: string[] }
    return read.lines.join('\n')
  }

  async function gitlab(): Promise<GitlabAnswer> {
    const workspace = await workspaceOf()
    if (workspace.kind === 'absent') return { started: false, detail: 'abra uma pasta no Orca primeiro' }
    if (workspace.kind === 'error') return { started: false, detail: workspace.detail }
    try {
      // Terminal que fica aberto: o aluno digita o login. Não é efêmero e não é fechado aqui.
      await host.call('terminal.create', {
        workspaceId: workspace.workspaceId,
        title: 'setup: login no GitLab',
        command: authLoginCommand()
      })
      return { started: true, detail: 'terminal aberto — faça o login e clique em Verificar' }
    } catch (error) {
      return { started: false, detail: messageOf(error) }
    }
  }

  async function issues(): Promise<IssuesAnswer> {
    const workspace = await workspaceOf()
    if (workspace.kind === 'absent') return { issues: [], error: 'abra uma pasta no Orca primeiro' }
    if (workspace.kind === 'error') return { issues: [], error: workspace.detail }
    const platform = detectPlatform(workspace.path)
    if (!platform) return { issues: [], error: 'não consegui determinar o sistema operacional' }
    try {
      const output = await runStep(host, 'setup: issues', issuesCommand(platform), [ISSUES_MARKER], DEADLINES.issues)
      return parseIssues(output)
    } catch (error) {
      return { issues: [], error: messageOf(error) }
    }
  }

  async function clone(): Promise<CloneAnswer> {
    const workspace = await workspaceOf()
    if (workspace.kind === 'absent') return { done: true, ok: false, cloned: [], failed: [], detail: 'abra uma pasta no Orca primeiro' }
    if (workspace.kind === 'error') return { done: true, ok: false, cloned: [], failed: [], detail: workspace.detail }
    const platform = detectPlatform(workspace.path)
    if (!platform) return { done: true, ok: false, cloned: [], failed: [], detail: 'não consegui determinar o sistema operacional' }

    const listed = await issues()
    if (listed.error) return { done: true, ok: false, cloned: [], failed: [], detail: listed.error }
    const paths = dedupePaths(listed.issues)
    if (paths.length === 0) {
      return { done: true, ok: true, cloned: [], failed: [], detail: 'nenhuma issue atribuída a você no momento' }
    }

    try {
      const output = await runStep(host, 'setup: clone', cloneCommand(paths, workspace.path, platform), [CLONE_MARKER], DEADLINES.clone)
      const failed = paths
        .filter((path) => output.toLowerCase().includes('fatal') && output.includes(path))
        .map((path) => ({ path, reason: 'o git reportou erro — veja o terminal' }))
      const cloned = paths.filter((path) => !failed.some((item) => item.path === path))
      return { done: true, ok: failed.length === 0, cloned, failed, detail: failed.length === 0 ? `${cloned.length} projeto(s) baixado(s)` : 'alguns projetos falharam' }
    } catch (error) {
      return { done: true, ok: false, cloned: [], failed: paths.map((path) => ({ path, reason: messageOf(error) })), detail: messageOf(error) }
    }
  }

  orca.panels.handle('setup.audit', () => enqueue(audit))
  orca.panels.handle('setup.fix', ({ stepId }) => enqueue(() => fix(stepId)))
  orca.panels.handle('setup.gitlab', () => enqueue(gitlab))
  orca.panels.handle('setup.clone', () => enqueue(clone))
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function detailFor(status: StepStatusValue): string | undefined {
  if (status === 'skip') return 'não instalado — ok se você não usa este agente'
  if (status === 'unknown') return 'não consegui verificar'
  if (status === 'missing') return 'faltando'
  return undefined
}

function statusFor(stepId: StepId, values: Map<string, StepStatusValue>): StepStatusValue {
  // A auditoria emite a chave sem hífen (`OCPLUGINS`, `GLABAUTH`, `CLAUDE`…).
  const key = stepId.replace(/-/g, '').toUpperCase()
  return values.get(key) ?? 'unknown'
}

function summaryOf(output: string): string {
  if (output.includes('NEED_ADMIN')) return 'sem permissão de administrador — rode o comando como admin'
  if (output.includes('NO_PKG_MANAGER')) return 'nenhum gerenciador de pacotes encontrado (brew/apt/dnf)'
  return 'concluído'
}
