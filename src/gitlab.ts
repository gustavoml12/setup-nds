import type { CmdPlatform, Platform } from './platform'
import { cmdPlatform } from './platform'
import { markerLine } from './runner'
import type { IssueRow } from './protocol'

export const GITLAB_BASE = 'https://nds.unirv.edu.br/gitlab'
export const GITLAB_HOST_ARG = 'nds.unirv.edu.br/gitlab'
export const ISSUES_MARKER = 'ISSUES_DONE'
export const CLONE_MARKER = 'CLONE_DONE'

export function shellQuote(value: string, platform: CmdPlatform): string {
  if (platform === 'win32') return `'${value.replace(/'/g, "''")}'`
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function markerEcho(marker: string, platform: CmdPlatform): string {
  const head = marker.replace(/_.*$/, '')
  const tail = marker.slice(head.length)
  return platform === 'win32'
    ? `Write-Output ('${head}' + '${tail}')`
    : `echo ${head}""${tail}`
}

/** Terminal NÃO efêmero: o aluno digita login/senha/token. Quem chama não o fecha.
 *  O comando é o mesmo nos dois dialetos — `glab` é o mesmo binário. */
export function authLoginCommand(): string {
  return `glab auth login --hostname ${GITLAB_HOST_ARG}`
}

/** Uma chamada só: o username sai do próprio JSON (sem jq), depois as issues atribuídas a
 *  ele em toda a instância. `glab issue list` não serve — exige contexto de repo ou grupo. */
export function issuesCommand(platform: Platform): string {
  const block = cmdPlatform(platform)
  if (block === 'win32') {
    return (
      `$U = (glab api user 2>$null | ConvertFrom-Json).username; ` +
      `if ([string]::IsNullOrWhiteSpace($U)) { "NO""_USER" } else { ` +
      `glab api "issues?scope=all&state=opened&assignee_username=$U&per_page=100" 2>$null | Out-String -Stream | Where-Object { $_ -ne '' } | ForEach-Object { $_ }; ` +
      `}; ${markerEcho(ISSUES_MARKER, block)}`
    )
  }
  return (
    `U=$(glab api user 2>/dev/null | tr -d '\\n' | sed -n 's/.*"username":"\\([^"]*\\)".*/\\1/p'); ` +
    `if [ -z "$U" ]; then echo NO""_USER; ` +
    `else glab api "issues?scope=all&state=opened&assignee_username=$U&per_page=100" 2>/dev/null | tr -d '\\n'; echo; fi; ` +
    markerEcho(ISSUES_MARKER, block)
  )
}

export function cloneCommand(
  paths: readonly string[],
  workspacePath: string,
  platform: Platform
): string {
  const block = cmdPlatform(platform)
  const cd = block === 'win32' ? `Set-Location ${shellQuote(workspacePath, block)}` : `cd ${shellQuote(workspacePath, block)}`
  const marker = markerEcho(CLONE_MARKER, block)
  if (paths.length === 0) return `${cd}; ${marker}`

  if (block === 'win32') {
    const each = paths
      .map(
        (path) =>
          `if (-not (Test-Path -Path ${shellQuote(path, block)})) { git clone ${shellQuote(`${GITLAB_BASE}/${path}.git`, block)} }`
      )
      .join('; ')
    return `${cd}; ${each}; ${marker}`
  }

  const each = paths
    .map(
      (path) =>
        `[ -d ${shellQuote(path, block)} ] || git clone ${shellQuote(`${GITLAB_BASE}/${path}.git`, block)}`
    )
    .join('; ')
  return `${cd}; ${each}; ${marker}`
}

/** `.../gitlab/<GRUPO>/Proj/-/issues/12` → `<GRUPO>/Proj`. O host tem path (`/gitlab`),
 *  por isso o prefixo sai da constante, não de um `hostname` solto. */
export function projectPathFromWebUrl(url: string): string | null {
  const prefix = `${GITLAB_BASE}/`
  if (!url.startsWith(prefix)) return null
  const rest = url.slice(prefix.length)
  const end = rest.indexOf('/-/issues/')
  if (end <= 0) return null
  const path = rest.slice(0, end)
  return path.includes(' ') ? null : path
}

function rowFromIssue(raw: unknown): IssueRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const url = typeof record.web_url === 'string' ? record.web_url : ''
  const path = projectPathFromWebUrl(url)
  if (!path) return null
  const rawNumber = record.iid ?? record.number
  const number = Number(rawNumber)
  if (!Number.isFinite(number)) return null
  return { path, number, title: String(record.title ?? ''), url }
}

export interface ParsedIssues {
  issues: IssueRow[]
  error?: string
}

/**
 * Lê `issuesCommand`'s output. O `[` inicial pode já ter sido cortado pela retenção de 200
 * linhas do terminal: cada `{` vira candidato a primeiro objeto e `[{…}]` reconstitui o
 * array com as issues completas que sobraram. A parte cortada é perdida, nunca inventada.
 */
export function parseIssues(output: string): ParsedIssues {
  if (markerLine(output, ISSUES_MARKER) === -1) return { issues: [], error: 'não recebi resposta do glab' }
  if (markerLine(output, 'NO_USER') !== -1) return { issues: [], error: 'não consegui identificar seu usuário no GitLab' }

  const end = output.lastIndexOf(']')
  if (end !== -1) {
    for (let at = output.indexOf('['); at !== -1 && at < end; at = output.indexOf('[', at + 1)) {
      try {
        const parsed: unknown = JSON.parse(output.slice(at, end + 1))
        if (Array.isArray(parsed)) return { issues: parsed.map(rowFromIssue).filter(isRow) }
      } catch {
        /* este `[` não abre o array real; tenta o próximo */
      }
    }
    for (let at = output.indexOf('{'); at !== -1 && at < end; at = output.indexOf('{', at + 1)) {
      try {
        const parsed: unknown = JSON.parse(`[${output.slice(at, end + 1)}`)
        if (Array.isArray(parsed)) return { issues: parsed.map(rowFromIssue).filter(isRow) }
      } catch {
        /* este `{` não abre um objeto completo */
      }
    }
  }
  return { issues: [], error: 'não consegui ler as issues (glab ausente ou sem permissão?)' }
}

function isRow(row: IssueRow | null): row is IssueRow {
  return row !== null
}

export function dedupePaths(rows: readonly IssueRow[]): string[] {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const row of rows) {
    if (seen.has(row.path)) continue
    seen.add(row.path)
    paths.push(row.path)
  }
  return paths
}
