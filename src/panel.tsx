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
import type { AuditAnswer, StepStatus } from './protocol'
import type { StepId } from './steps'

type UiState =
  | { kind: 'loading' }
  | { kind: 'no_workspace' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; steps: StepStatus[]; note?: string }

const state = atom<UiState>('state', { kind: 'loading' })
/** Etapa em curso; null = nada rodando. Trava o resto dos botões. */
const busy = atom<StepId | null>('busy', null)

const GLYPH = { ok: '✔', missing: '✘', skip: '–', unknown: '?' } as const
const LABEL = { ok: 'ok', missing: 'falta', skip: 'não usado', unknown: '?' } as const

async function audit(): Promise<void> {
  set(state, { kind: 'loading' })
  try {
    const answer: AuditAnswer = await plugin.request('setup.audit')
    if (answer.noWorkspace) {
      set(state, { kind: 'no_workspace' })
      return
    }
    set(state, answer.error ? { kind: 'error', message: answer.error } : { kind: 'ready', steps: answer.steps })
  } catch (error) {
    set(state, { kind: 'error', message: String(error) })
  }
}

/** Rechama `setup.fix` até `done`: o pedido tem teto de 120 s e o winget pode passar disso. */
async function fix(stepId: StepId): Promise<void> {
  set(busy, stepId)
  try {
    for (;;) {
      const answer = await plugin.request('setup.fix', { stepId }, { timeoutMs: 120_000 })
      if (answer.done) {
        set(state, readyWithNote(answer.ok ? 'concluído' : answer.detail))
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 1500))
    }
  } catch (error) {
    set(state, { kind: 'error', message: String(error) })
  } finally {
    set(busy, null)
  }
}

async function loginGitlab(): Promise<void> {
  set(busy, 'glab-auth')
  try {
    const answer = await plugin.request('setup.gitlab')
    set(state, readyWithNote(answer.detail))
  } catch (error) {
    set(state, { kind: 'error', message: String(error) })
  } finally {
    set(busy, null)
  }
}

async function cloneProjects(): Promise<void> {
  set(busy, 'clone')
  try {
    const answer = await plugin.request('setup.clone')
    set(state, readyWithNote(answer.detail))
  } catch (error) {
    set(state, { kind: 'error', message: String(error) })
  } finally {
    set(busy, null)
  }
}

function readyWithNote(note?: string): UiState {
  const current = read(state)
  if (current.kind !== 'ready') return current
  return { kind: 'ready', steps: current.steps, note }
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
      <EmptyState
        icon="folder"
        title="Abra uma pasta no Orca"
        description="Preciso de um workspace aberto para rodar os comandos da instalação. Depois clique em Verificar."
      />
    )
  }

  if (current.kind === 'error') {
    return (
      <Stack gap="md">
        <Callout tone="danger" title="Não consegui verificar">
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

      {current.note && <Callout tone="accent">{current.note}</Callout>}

      <List label="Etapa">
        {current.steps.map((step) => (
          <ListItem
            key={step.id}
            title={`${GLYPH[step.status]} ${step.title} — ${LABEL[step.status]}`}
            description={step.detail}
            icon={step.group === 'gitlab' ? 'globe' : step.group === 'agentes' ? 'bot' : 'package'}
            disabled={running !== null}
            onPress={() => (step.id === 'glab-auth' ? void loginGitlab() : step.id === 'clone' ? void cloneProjects() : void fix(step.id))}
          />
        ))}
      </List>

      {missing.length > 0 && (
        <Button
          onPress={() => {
            void (async () => {
              for (const step of missing) {
                await fix(step.id)
                await audit()
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
        {running !== null ? 'Executando… veja o terminal do Orca.' : 'Auditoria completa. Clique em Verificar para de novo.'}
      </Text>
    </Stack>
  )
}
