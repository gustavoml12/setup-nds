import {
  atom,
  Button,
  Callout,
  EmptyState,
  Heading,
  List,
  ListItem,
  plugin,
  read,
  Row,
  set,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { AuditAnswer, CloneAnswer, StepStatus } from './protocol'
import type { StepId } from './steps'

type UiState =
  | { kind: 'loading' }
  | { kind: 'no_workspace' }
  | { kind: 'error'; message: string; title?: string }
  | { kind: 'ready'; steps: StepStatus[]; note?: string; failure?: string; timedOut?: boolean }

const state = atom<UiState>('state', { kind: 'loading' })
/** Etapa em curso; null = nada rodando. Trava o resto dos botões. */
const busy = atom<StepId | null>('busy', null)

const GLYPH = { ok: '✔', missing: '✘', skip: '–', unknown: '?' } as const
const LABEL = { ok: 'ok', missing: 'falta', skip: 'não usado', unknown: 'desconhecido' } as const

/** Só vira botão o que tem o que fazer: faltando, não verificável, ou os handlers próprios.
 *  `ok`/`skip` não instalam nada — um aluno sem `claude` não ganha botão de conserto. */
function actionable(step: StepStatus): boolean {
  return step.status === 'missing' || step.status === 'unknown' || step.id === 'glab-auth' || step.id === 'clone'
}

async function runAction(busyId: StepId, action: () => Promise<boolean>): Promise<boolean> {
  set(busy, busyId)
  try {
    return await action()
  } catch (error) {
    set(state, { kind: 'error', message: String(error) })
    return false
  } finally {
    set(busy, null)
  }
}

async function audit(): Promise<boolean> {
  set(state, { kind: 'loading' })
  try {
    const answer: AuditAnswer = await plugin.request('setup.audit', undefined, { timeoutMs: 120_000 })
    if (answer.noWorkspace) {
      set(state, { kind: 'no_workspace' })
      return true
    }
    if (answer.error) {
      set(state, { kind: 'error', message: answer.error })
      return false
    }
    set(state, { kind: 'ready', steps: answer.steps, timedOut: answer.timedOut })
    return true
  } catch (error) {
    set(state, { kind: 'error', message: String(error) })
    return false
  }
}

/** Rechama `setup.fix` até `done`: o pedido tem teto de 120 s e o winget pode passar disso. */
async function fix(stepId: StepId): Promise<boolean> {
  return runAction(stepId, async () => {
    for (;;) {
      const answer = await plugin.request('setup.fix', { stepId }, { timeoutMs: 120_000 })
      if (answer.done) {
        if (!answer.ok) {
          set(state, { kind: 'error', title: 'Não consegui consertar', message: answer.detail || 'Falha ao executar o conserto' })
          return false
        }
        if (!(await audit())) {
          return false
        }
        set(state, readyWithNote('concluído'))
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  })
}

async function loginGitlab(): Promise<boolean> {
  return runAction('glab-auth', async () => {
    const answer = await plugin.request('setup.gitlab')
    set(state, answer.started ? readyWithNote(answer.detail) : readyWithFailure(answer.detail))
    return answer.started
  })
}

async function cloneProjects(): Promise<boolean> {
  return runAction('clone', async () => {
    const answer = await plugin.request('setup.clone', undefined, { timeoutMs: 120_000 })
    const next = withCloneRow(read(state), answer)
    set(state, answer.ok ? readyWithNote(answer.detail, next) : readyWithFailure(cloneFailure(answer), next))
    return answer.ok
  })
}

function readyWithNote(note?: string, from: UiState = read(state)): UiState {
  if (from.kind !== 'ready') return from
  return { kind: 'ready', steps: from.steps, note }
}

function readyWithFailure(failure: string, from: UiState = read(state)): UiState {
  if (from.kind !== 'ready') return from
  return { kind: 'ready', steps: from.steps, failure }
}

function cloneFailure(answer: CloneAnswer): string {
  if (answer.failed.length === 0) return answer.detail
  return `${answer.detail}: ${answer.failed.map((item) => item.path).join(', ')}`
}

/** O passo 12 reflete o resultado real do clone, em vez de ficar eternamente em `?`. */
function withCloneRow(current: UiState, answer: CloneAnswer): UiState {
  if (current.kind !== 'ready') return current
  const steps = current.steps.map((step) =>
    step.id === 'clone'
      ? { ...step, status: answer.ok ? ('ok' as const) : ('missing' as const), detail: answer.detail }
      : step
  )
  return { ...current, steps }
}

export function setup(ctx: PanelContext): void {
  void audit()
}

export default function Panel() {
  const current = read(state)
  const running = read(busy)

  if (current.kind === 'loading') {
    return (
      <Stack gap="md">
        <Spinner label="Verificando a máquina…" />
      </Stack>
    )
  }

  if (current.kind === 'no_workspace') {
    return (
      <Stack gap="md">
        <EmptyState
          icon="folder"
          title="Abra uma pasta no Orca"
          description="Preciso de um workspace aberto para rodar os comandos da instalação. Depois clique em Verificar."
        />
        <Button onPress={() => void audit()} disabled={running !== null}>
          Verificar
        </Button>
      </Stack>
    )
  }

  if (current.kind === 'error') {
    return (
      <Stack gap="md">
        <Callout tone="danger" title={current.title ?? 'Não consegui verificar'}>
          {current.message}
        </Callout>
        <Button onPress={() => void audit()}>Tentar de novo</Button>
      </Stack>
    )
  }

  const missing = current.steps.filter((step) => step.status === 'missing')

  return (
    <Stack gap="md">
      <Row justify="between">
        <Heading>Setup</Heading>
        <Button variant="ghost" size="sm" icon="refresh" onPress={() => void audit()} disabled={running !== null}>
          Verificar
        </Button>
      </Row>

      {current.timedOut && (
        <Callout tone="warning">A auditoria não terminou a tempo. Clique em Verificar de novo.</Callout>
      )}
      {current.failure && <Callout tone="danger" title="Não deu certo">{current.failure}</Callout>}
      {current.note && <Callout tone="accent">{current.note}</Callout>}

      <List label="Etapa">
        {current.steps.map((step) => (
          <ListItem
            key={step.id}
            title={`${GLYPH[step.status]} ${step.title} — ${LABEL[step.status]}`}
            description={step.detail}
            icon={step.group === 'gitlab' ? 'globe' : step.group === 'agentes' ? 'bot' : 'package'}
            disabled={running !== null || !actionable(step)}
            onPress={
              actionable(step)
                ? () => (step.id === 'glab-auth' ? void loginGitlab() : step.id === 'clone' ? void cloneProjects() : void fix(step.id))
                : undefined
            }
          />
        ))}
      </List>

      {missing.length > 0 && (
        <Button
          onPress={() => {
            void (async () => {
              for (const step of missing) {
                const ok = await fix(step.id)
                if (!ok) break
              }
            })()
          }}
          disabled={running !== null}
        >
          {`Consertar tudo (${missing.length})`}
        </Button>
      )}

      <Button variant="outline" onPress={() => void cloneProjects()} disabled={running !== null}>
        Baixar meus projetos
      </Button>

      <Text muted size="xs">
        {running !== null ? 'Executando… veja o terminal do Orca.' : 'Auditoria completa. Clique em Verificar para conferir de novo.'}
      </Text>
    </Stack>
  )
}
