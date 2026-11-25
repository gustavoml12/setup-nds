import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { assert, describe, test } from 'orca/testing'
import { cloneCommand, issuesCommand, parseClone } from './gitlab'
import { STEPS, auditCommand } from './steps'

const hasShell = (shell: string): boolean => spawnSync(shell, ['-c', 'true']).status === 0

function commands(): { name: string; command: string }[] {
  const list: { name: string; command: string }[] = [{ name: 'audit', command: auditCommand('darwin') }]
  for (const step of STEPS) {
    list.push({ name: `check.posix ${step.id}`, command: step.check.posix })
    if (step.fix) list.push({ name: `fix.posix ${step.id}`, command: step.fix.posix })
  }
  list.push({ name: 'issuesCommand', command: issuesCommand('darwin') })
  list.push({ name: 'cloneCommand', command: cloneCommand(['g/a', "g/it's"], "/tmp/it's dev", 'darwin') })
  list.push({ name: 'cloneCommand vazio', command: cloneCommand([], '/tmp', 'darwin') })
  return list
}

describe('sintaxe de todo comando POSIX gerado (sh -n, sem executar)', () => {
  for (const shell of ['sh', 'bash', 'zsh']) {
    if (!hasShell(shell)) continue
    for (const { name, command } of commands()) {
      test(`${shell} -n: ${name}`, () => {
        const result = spawnSync(shell, ['-n', '-c', command], { encoding: 'utf8' })
        assert.equal(result.status, 0, `${shell}: ${result.stderr}\n${command}`)
      })
    }
  }
})

describe('cloneCommand executado com um git de mentira', () => {
  function sandbox(): { root: string; work: string; env: Record<string, string | undefined>; calls: () => string[] } {
    const root = mkdtempSync(`${tmpdir()}/clone-`)
    const bin = `${root}/bin`
    const work = `${root}/work`
    mkdirSync(bin)
    mkdirSync(work)
    // clone [-q] <url> <dir>: falha para qualquer URL com "falha"; senão cria <dir>.
    writeFileSync(
      `${bin}/git`,
      '#!/bin/sh\necho "$@" >> "$CALLS"\nshift; [ "$1" = -q ] && shift\ncase "$1" in *falha*) echo "fatal: destination path \'x\' already exists" >&2; exit 128;; esac\nmkdir "$2"\n',
      { mode: 0o755 }
    )
    const env = { PATH: `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`, CALLS: `${root}/calls` }
    const calls = (): string[] => (existsSync(env.CALLS) ? readFileSync(env.CALLS, 'utf8').split('\n').filter(Boolean) : [])
    return { root, work, env, calls }
  }
  const run = (command: string, env: Record<string, string | undefined>): string =>
    spawnSync('sh', ['-c', command], { encoding: 'utf8', env }).stdout

  test('segundo clique é idempotente: não clona de novo e continua OK', () => {
    const box = sandbox()
    const paths = ['grupo/Proj']
    const command = cloneCommand(paths, box.work, 'darwin')
    const first = run(command, box.env)
    assert.equal(parseClone(first, paths).cloned.length, 1)
    assert.equal(existsSync(`${box.work}/Proj`), true, 'clonou na pasta do último segmento')
    assert.deepEqual(box.calls().length, 1)
    const second = run(command, box.env)
    assert.equal(box.calls().length, 1, 'a segunda rodada não chamou git')
    assert.deepEqual(parseClone(second, paths).failed, [])
    rmSync(box.root, { recursive: true, force: true })
  })

  test('um repo que falha não contamina os outros', () => {
    const box = sandbox()
    const paths = ['g/boa', 'g/falha', 'g/outra']
    const out = run(cloneCommand(paths, box.work, 'darwin'), box.env)
    const verdict = parseClone(out, paths)
    assert.deepEqual(verdict.cloned, ['g/boa', 'g/outra'])
    assert.deepEqual(verdict.failed.map((f) => f.path), ['g/falha'])
    rmSync(box.root, { recursive: true, force: true })
  })
})
