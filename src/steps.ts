import type { CmdPlatform, Platform } from './platform'
import { cmdPlatform } from './platform'
import { markerLine } from './runner'

export const AUDIT_MARKER = 'AUDIT_DONE'
export const FIX_MARKER = 'FIXED_DONE'
export const GITLAB_HOST_ARG = 'nds.unirv.edu.br/gitlab'

export type StepId =
  | 'vscode' | 'git' | 'node' | 'opencode' | 'oc-plugins'
  | 'claude' | 'codex' | 'agy' | 'gemini'
  | 'glab' | 'glab-auth' | 'clone'

export type StepStatusValue = 'ok' | 'missing' | 'skip' | 'unknown'

export interface StepDef {
  id: StepId
  title: string
  group: 'ferramentas' | 'agentes' | 'gitlab'
  /** Fragmento que imprime exatamente uma linha `<ID>=<A|1|0|U>`. */
  check: Record<CmdPlatform, string>
  /** Ausente quando a correção é um handler próprio (`glab-auth`, `clone`). */
  fix?: Record<CmdPlatform, string>
}

/** Linha de dado da auditoria: chave e valor, e mais nada. O eco é uma linha longa e fica
 *  de fora por isso — ver Refinamento 1. */
export const AUDIT_LINE = /^([A-Z][A-Z_0-9]*)=([A10U])[ \t]*$/

const VALUE: Record<string, StepStatusValue> = {
  '1': 'ok',
  '0': 'missing',
  A: 'skip',
  U: 'unknown'
}

// --- fragmentos POSIX ---

const posixTool = (id: string, bin: string): string =>
  `command -v ${bin} >/dev/null 2>&1 && echo ${id}=1 || echo ${id}=0`

/** Presente sem listagem → `U` (não dá pra verificar); presente e incompleto → `0`. */
const posixAgent = (id: string, bin: string, sub: string): string =>
  `command -v ${bin} >/dev/null 2>&1 || echo ${id}=A; ` +
  `L=$("${bin}" ${sub} list 2>/dev/null); ` +
  `command -v ${bin} >/dev/null 2>&1 && { [ -z "$L" ] && echo ${id}=U || ` +
  `{ echo "$L" | grep -qi superpowers && echo "$L" | grep -qi ponytail && echo ${id}=1 || echo ${id}=0; }; }`

const posixPackageManager =
  'if command -v brew >/dev/null 2>&1 then PM=brew; ' +
  'elif command -v apt-get >/dev/null 2>&1 then PM=apt; ' +
  'elif command -v dnf >/dev/null 2>&1 then PM=dnf; ' +
  'else PM=none; fi; '

const posixInstall = (brew: string, apt: string, dnf: string): string =>
  posixPackageManager +
  `if [ "$PM" = brew ]; then ${brew}; ` +
  `elif [ "$PM" = apt ]; then sudo apt-get update -qq && sudo apt-get install -y ${apt}; ` +
  `elif [ "$PM" = dnf ]; then sudo dnf install -y ${dnf}; ` +
  'else echo NO_PKG_MANAGER; fi; '

// --- fragmentos PowerShell ---

const winTool = (id: string, bin: string): string =>
  `if (Get-Command ${bin} -ErrorAction SilentlyContinue) { "${id}=1" } else { "${id}=0" }`

const winAgent = (id: string, bin: string, sub: string): string =>
  `if (-not (Get-Command ${bin} -ErrorAction SilentlyContinue)) { "${id}=A" } else { ` +
  `$L = & ${bin} ${sub} list 2>$null | Out-String; ` +
  `if ([string]::IsNullOrWhiteSpace($L)) { "${id}=U" } elseif ($L -match 'superpowers' -and $L -match 'ponytail') { "${id}=1" } else { "${id}=0" } }`

const winWinget = (id: string): string =>
  `winget install ${id} -e --accept-package-agreements --accept-source-agreements`

/** Quebra o marcador na fonte, nas duas cascas: o eco carrega o texto com as aspas / com o
 *  `+`, a saída carrega o marcador limpo. */
function markerEcho(marker: string, platform: CmdPlatform): string {
  const head = marker.replace(/_.*$/, '')
  const tail = marker.slice(head.length)
  return platform === 'win32'
    ? `Write-Output ('${head}' + '${tail}')`
    : `echo ${head}""${tail}`
}

// --- catálogo ---

export const STEPS: readonly StepDef[] = [
  { id: 'vscode', title: 'VS Code', group: 'ferramentas',
    check: { posix: posixTool('VSCODE', 'code'), win32: winTool('VSCODE', 'code') },
    fix: {
      posix: `${posixInstall('brew install --cask visual-studio-code', 'code', 'code')}${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `${winWinget('Microsoft.VisualStudioCode')}; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'git', title: 'Git', group: 'ferramentas',
    check: { posix: posixTool('GIT', 'git'), win32: winTool('GIT', 'git') },
    fix: {
      posix: `${posixInstall('brew install git', 'git', 'git')}echo GIT""_FIXED; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `${winWinget('Git.Git')}; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'node', title: 'Node.js LTS', group: 'ferramentas',
    check: { posix: posixTool('NODE', 'node'), win32: winTool('NODE', 'node') },
    fix: {
      posix:
        `${posixPackageManager}` +
        `if [ "$PM" = brew ]; then brew install node; ` +
        `elif [ "$PM" = apt ]; then curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs; ` +
        `elif [ "$PM" = dnf ]; then curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - && sudo dnf install -y nodejs; ` +
        `else echo NO_PKG_MANAGER; fi; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `${winWinget('OpenJS.NodeJS.LTS')}; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'opencode', title: 'OpenCode', group: 'ferramentas',
    check: { posix: posixTool('OPENCODE', 'opencode'), win32: winTool('OPENCODE', 'opencode') },
    fix: {
      posix: `npm install -g @opencode/cli || sudo -n npm install -g @opencode/cli || echo NEED_ADMIN; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `npm install -g @opencode/cli || echo NEED_ADMIN; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'oc-plugins', title: 'Plugins do OpenCode (superpowers + ponytail)', group: 'ferramentas',
    check: {
      posix:
        `command -v opencode >/dev/null 2>&1 || echo OCPLUGINS=0; ` +
        `O=$(opencode plugin list 2>/dev/null); ` +
        `[ -z "$O" ] && echo OCPLUGINS=0 || ` +
        `{ echo "$O" | grep -qi superpowers && echo "$O" | grep -qi ponytail && echo OCPLUGINS=1 || echo OCPLUGINS=0; }`,
      win32:
        `if (-not (Get-Command opencode -ErrorAction SilentlyContinue)) { "OCPLUGINS=0" } else { ` +
        `$O = opencode plugin list 2>$null | Out-String; ` +
        `if ($O -match 'superpowers' -and $O -match 'ponytail') { "OCPLUGINS=1" } else { "OCPLUGINS=0" } }`
    },
    fix: {
      posix:
        `opencode plugin add "superpowers@git+https://github.com/obra/superpowers.git"; ` +
        `opencode plugin add @dietrichgebert/ponytail; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32:
        `opencode plugin add "superpowers@git+https://github.com/obra/superpowers.git"; ` +
        `opencode plugin add @dietrichgebert/ponytail; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'claude', title: 'Claude Code', group: 'agentes',
    check: { posix: posixAgent('CLAUDE', 'claude', 'plugin'), win32: winAgent('CLAUDE', 'claude', 'plugin') },
    fix: {
      posix:
        `claude plugin install superpowers@claude-plugins-official -y; ` +
        `claude plugin marketplace add DietrichGebert/ponytail; ` +
        `claude plugin install ponytail@ponytail -y; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32:
        `claude plugin install superpowers@claude-plugins-official -y; ` +
        `claude plugin marketplace add DietrichGebert/ponytail; ` +
        `claude plugin install ponytail@ponytail -y; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'codex', title: 'Codex', group: 'agentes',
    check: { posix: posixAgent('CODEX', 'codex', 'plugin'), win32: winAgent('CODEX', 'codex', 'plugin') },
    fix: {
      posix:
        `codex plugin add superpowers@openai-curated-remote; ` +
        `codex plugin marketplace add DietrichGebert/ponytail; ` +
        `codex plugin add ponytail@ponytail; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32:
        `codex plugin add superpowers@openai-curated-remote; ` +
        `codex plugin marketplace add DietrichGebert/ponytail; ` +
        `codex plugin add ponytail@ponytail; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'agy', title: 'Antigravity', group: 'agentes',
    check: { posix: posixAgent('AGY', 'agy', 'plugin'), win32: winAgent('AGY', 'agy', 'plugin') },
    fix: {
      posix: `agy plugin install https://github.com/obra/superpowers; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `agy plugin install https://github.com/obra/superpowers; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'gemini', title: 'Gemini CLI', group: 'agentes',
    check: { posix: posixAgent('GEMINI', 'gemini', 'extensions'), win32: winAgent('GEMINI', 'gemini', 'extensions') },
    fix: {
      posix: `gemini extensions install https://github.com/obra/superpowers; ${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `gemini extensions install https://github.com/obra/superpowers; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'glab', title: 'GitLab CLI (glab)', group: 'gitlab',
    check: { posix: posixTool('GLAB', 'glab'), win32: winTool('GLAB', 'glab') },
    fix: {
      posix: `${posixInstall('brew install glab', 'glab', 'glab')}${markerEcho(FIX_MARKER, 'posix')}`,
      win32: `${winWinget('GitLab.GitLabCLI')}; ${markerEcho(FIX_MARKER, 'win32')}`
    } },
  { id: 'glab-auth', title: 'Login no GitLab da NDS', group: 'gitlab',
    check: {
      posix: `glab auth status --hostname ${GITLAB_HOST_ARG} >/dev/null 2>&1 && echo GLABAUTH=1 || echo GLABAUTH=0`,
      win32: `if (glab auth status --hostname ${GITLAB_HOST_ARG} 2>$null) { "GLABAUTH=1" } else { "GLABAUTH=0" }`
    } },
  { id: 'clone', title: 'Projetos com issue atribuída', group: 'gitlab',
    check: { posix: `echo CLONE=U`, win32: `"CLONE=U"` } }
]

/** Um único comando de auditoria: só as etapas 1 a 11. `clone` fica de fora — depende de
 *  rede e tornaria toda verificação lenta (spec §5). */
export function auditCommand(platform: Platform): string {
  const block = cmdPlatform(platform)
  const parts = STEPS.filter((step) => step.id !== 'clone').map((step) => step.check[block])
  // `; ` nos dois dialetos: `terminal.create` recebe uma linha só, então o eco também é uma
  // linha só — e por isso nenhuma linha de eco pode casar com o regex de dado exato.
  return [...parts, markerEcho(AUDIT_MARKER, block)].join('; ')
}

export function parseAudit(output: string): Map<string, StepStatusValue> {
  const parsed = new Map<string, StepStatusValue>()
  if (markerLine(output, AUDIT_MARKER) === -1) return parsed
  for (const line of output.split('\n')) {
    const match = AUDIT_LINE.exec(line.trim())
    if (!match) continue
    const value = VALUE[match[2]]
    if (value) parsed.set(match[1], value)
  }
  return parsed
}

export function fixCommand(stepId: StepId, platform: Platform): string | null {
  const step = STEPS.find((candidate) => candidate.id === stepId)
  if (!step?.fix) return null
  return step.fix[cmdPlatform(platform)]
}
