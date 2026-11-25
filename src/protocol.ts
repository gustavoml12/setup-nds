// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
import type { Platform } from './platform'
import type { StepId, StepStatusValue } from './steps'

export interface StepStatus {
  id: StepId
  title: string
  group: 'ferramentas' | 'agentes' | 'gitlab'
  status: StepStatusValue
  detail?: string
}

export interface AuditAnswer {
  platform: Platform | null
  steps: StepStatus[]
  /** workspace.readContext devolveu null: o painel mostra a instrução, não um shell. */
  noWorkspace?: boolean
  error?: string
}

export interface FixAnswer {
  /** false ⇒ ainda rodando; o painel rechama `setup.fix` até vir true. */
  done: boolean
  ok: boolean
  detail: string
}

export interface GitlabAnswer {
  started: boolean
  detail: string
}

export interface IssueRow {
  path: string
  number: number
  title: string
  url: string
}

export interface IssuesAnswer {
  issues: IssueRow[]
  error?: string
}

export interface CloneAnswer {
  done: boolean
  ok: boolean
  cloned: string[]
  failed: { path: string; reason: string }[]
  detail: string
}

declare module 'orca' {
  interface PluginRequests {
    /** The total the worker keeps in storage. */
    'counter.get': { output: { total: number } }
    /** Adds `by` to the stored total and answers the new total. */
    'counter.add': { input: { by: number }; output: { total: number } }

    'setup.audit': { output: AuditAnswer }
    'setup.fix': { input: { stepId: StepId }; output: FixAnswer }
    'setup.gitlab': { output: GitlabAnswer }
    'setup.clone': { output: CloneAnswer }
  }
  interface PluginPanelEvents {
    /** Posted to every open panel after the total changes. */
    'counter.changed': { total: number }
  }
}
