import type { CmdPlatform, Platform } from './platform'
import { cmdPlatform } from './platform'
import { markerEcho, markerLine } from './markers'
import type { IssueRow } from './protocol'

export const GITLAB_BASE = 'https://nds.unirv.edu.br/gitlab'
export const GITLAB_HOST_ARG = 'nds.unirv.edu.br/gitlab'
export const ISSUES_MARKER = 'ISSUES_DONE'
export const CLONE_MARKER = 'CLONE_DONE'

export function shellQuote(value: string, platform: CmdPlatform): string {
  if (platform === 'win32') return `'${value.replace(/'/g, "''")}'`
  return `'${value.replace(/'/g, `'\\''`)}'`
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
      `$env:GITLAB_HOST = '${GITLAB_HOST_ARG}'; ` +
      `$U = (glab api user 2>$null | ConvertFrom-Json).username; ` +
      `if ([string]::IsNullOrWhiteSpace($U)) { ('NO' + '_USER') } else { ` +
      `(glab api "issues?scope=all&state=opened&assignee_username=$U&per_page=100" 2>$null) -join ''; ` +
      `}; ${markerEcho(ISSUES_MARKER, block)}`
    )
  }
  return (
    `U=$(GITLAB_HOST=${GITLAB_HOST_ARG} glab api user 2>/dev/null | tr -d '\\n' | sed -n 's/.*"username":"\\([^"]*\\)".*/\\1/p'); ` +
    `if [ -z "$U" ]; then echo NO""_USER; ` +
    `else GITLAB_HOST=${GITLAB_HOST_ARG} glab api "issues?scope=all&state=opened&assignee_username=$U&per_page=100" 2>/dev/null | tr -d '\\n'; echo; fi; ` +
    markerEcho(ISSUES_MARKER, block)
  )
}

/** Pasta onde o git coloca o clone: o último segmento do caminho do projeto. Passada
 *  explicitamente a `git clone` e usada na checagem de existência — um valor só para os dois. */
export function cloneDir(path: string): string {
  return path.split('/').pop() || path
}

/** Marcadores de resultado por repositório, pelo índice em `paths`. */
export const cloneOkMarker = (index: number): string => `CLONE_OK_${index}`
export const cloneErrMarker = (index: number): string => `CLONE_ERR_${index}`

export function cloneCommand(
  paths: readonly string[],
  workspacePath: string,
  platform: Platform
): string {
  const block = cmdPlatform(platform)
  const cd = block === 'win32' ? `Set-Location ${shellQuote(workspacePath, block)}` : `cd ${shellQuote(workspacePath, block)}`
  const marker = markerEcho(CLONE_MARKER, block)
  if (paths.length === 0) return `${cd}; ${marker}`

  const each = paths
    .map((path, index) => {
      const dir = shellQuote(cloneDir(path), block)
      const url = shellQuote(`${GITLAB_BASE}/${path}.git`, block)
      const ok = markerEcho(cloneOkMarker(index), block)
      const err = markerEcho(cloneErrMarker(index), block)
      if (block === 'win32') {
        return (
          `if (Test-Path -Path ${dir}) { ${ok} } else { git clone -q ${url} ${dir}; ` +
          `if ($LASTEXITCODE -eq 0) { ${ok} } else { ${err} } }`
        )
      }
      return `if [ -d ${dir} ] || git clone -q ${url} ${dir}; then ${ok}; else ${err}; fi`
    })
    .join('; ')
  return `${cd}; ${each}; ${marker}`
}

export interface CloneVerdict {
  cloned: string[]
  failed: { path: string; reason: string }[]
}

/** Um veredito por repositório, lido só das linhas `CLONE_OK_n` / `CLONE_ERR_n`. Sem
 *  nenhuma das duas (prazo estourado, linha cortada pela retenção) o repo conta como falha. */
export function parseClone(output: string, paths: readonly string[]): CloneVerdict {
  const verdict: CloneVerdict = { cloned: [], failed: [] }
  paths.forEach((path, index) => {
    if (markerLine(output, cloneOkMarker(index)) !== -1) verdict.cloned.push(path)
    else if (markerLine(output, cloneErrMarker(index)) !== -1) {
      verdict.failed.push({ path, reason: 'o git reportou erro — veja o terminal' })
    } else verdict.failed.push({ path, reason: 'sem resposta do git — veja o terminal' })
  })
  return verdict
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
