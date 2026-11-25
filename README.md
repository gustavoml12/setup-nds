# Setup Clínica Veterinária

Plugin do [Orca](https://github.com/stablyai/orca) que prepara a máquina do estagiário para o projeto da Clínica Veterinária da NDS.

## O que ele faz

Painel na barra lateral direita, em quatro etapas:

1. **Auditoria**: confere os 12 itens do setup (ferramentas, `glab`, agentes etc.). Se não dá para saber o estado de algo, mostra "desconhecido" em vez de um ✔ falso.
2. **Conserto**: instala o que falta, um item por vez (winget no Windows, gerenciador de pacotes no macOS/Linux).
3. **GitLab**: confere o login do `glab` na NDS e lista as issues atribuídas ao aluno.
4. **Clone**: clona os projetos onde o aluno tem issue.

## Instalação (aluno)

```sh
orca plugin install <owner>/setup-clinica-veterinaria
```

O Orca mostra a lista de acessos abaixo e só instala depois que você aprova.

## Acessos pedidos

| Acesso | Por quê |
|---|---|
| `workspace:read` | saber em qual pasta clonar os projetos |
| `terminal:send` | rodar os comandos de auditoria, instalação, `glab` e `git clone` em terminais temporários |
| `terminal:read` | ler a saída desses comandos para montar o checklist |
| `storage:own` | guardar o estado do setup do próprio plugin |

Sem rede própria: tudo passa por comandos que você pode ver no terminal.

## Nota sobre GitHub e GitLab

O plugin é distribuído pelo GitHub, e o login do aluno é no GitLab da NDS. Já `superpowers` e `ponytail` continuam vindo do GitHub, então precisam de acesso ao GitHub mesmo com o login do GitLab funcionando.

## Limitações

- Testado no macOS; a coluna Windows (winget) ainda não foi validada em máquina real.

## Desenvolvimento

```sh
orca plugin validate .
npx --yes -p typescript tsc -p .
orca plugin test .
orca plugin check .
orca plugin dev watch .
```
