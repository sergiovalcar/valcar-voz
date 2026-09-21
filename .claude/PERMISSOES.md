# Por que `settings.json` é assim

Este arquivo existe porque `settings.json` é JSON e não aceita comentário — e as decisões
abaixo são exatamente do tipo que alguém "conserta" de volta por parecerem excesso de zelo.

## A regra que decide tudo: o controle é a AUSÊNCIA do guarda-chuva

As listas `allow`, `ask` e `deny` casam por **prefixo**. Isso quer dizer que **nenhuma
delas consegue descrever uma operação independentemente da ordem dos argumentos**:

    Bash(git push --force*)   NÃO casa com   git push origin --force
    Bash(git reset --hard*)   NÃO casa com   git -C . reset --hard

Escrever mais linhas de `ask` não conserta isso — conserta o caso que está na mesa e
falha na classe vizinha. **A única trava que não depende da ordem dos argumentos é a
operação não estar em `allow`.**

Por isso `Bash(git *)` saiu. `git` entra por subcomando, e só os que **não têm flag
destrutiva possível**: status, log, show, diff, add, commit, fetch, rev-parse, ls-files,
merge-base, blame. `checkout`, `switch`, `restore` e `stash` saíram junto com push, reset,
clean e rebase — `git checkout -f HEAD` descarta alteração não salva e `git stash clear`
apaga o que estava guardado, e nenhuma regra de prefixo separa essas formas das inofensivas.

**Corolário para quem mexer aqui:** toda entrada nova em `allow` que contenha um `*`
precisa ser lida como *"qualquer coisa que venha depois também está liberada"*. Se existe
uma flag destrutiva possível naquele comando, a entrada está errada — o certo é listar o
subcomando seguro, nunca o programa inteiro.

## Os interpretadores: o que saiu e o que isto NÃO promete

`Bash(python3 *)`, `Bash(node *)`, `Bash(npx *)`, `Bash(awk *)`, `Bash(sed *)`,
`Bash(find *)` e `Bash(rg *)` saíram, e cada um por executar código arbitrário a uma
palavra de distância: `python3 -c`, `find -exec`, `awk 'BEGIN{system(...)}'`, `sed` com a
flag `e`, `rg --pre` (que roda um programa em cada arquivo).

**⚠️ E ISTO NÃO ESTABELECE UMA BARREIRA CONTRA EXECUÇÃO ARBITRÁRIA — não tente lê-lo
assim.** `npm test`, `npm run` e `node --test` continuam liberados porque rodar a suíte é
o trabalho; e rodar a suíte é **executar código do próprio repositório**, que a sessão
pode editar. Enquanto `Edit` existir e os testes rodarem, execução arbitrária é possível
por construção. Uma versão anterior deste arquivo afirmava a barreira; era falso, e o
parecer do Codex de 21/09 derrubou com o exemplo do `node --test --require`.

O que este arquivo faz, de verdade, é mais modesto e ainda assim vale: **tira os
interpretadores de uso geral do caminho de uma palavra** e **põe confirmação no que é
destrutivo ou sai para fora**. É redução de superfície e de acidente, não prova de
impossibilidade.

`grep`, `jq`, `cat`, `ls`, `wc`, `sort`, `uniq`, `diff`, `head` e `tail` ficam porque não
executam programa nenhum. `cp`, `mv`, `rm`, `tee`, `ln`, `dd`, `truncate`, `install`,
`chmod`, `curl` e `wget` perguntam: os primeiros escrevem ou apagam arquivo, os dois
últimos trazem coisa de fora.

## `.claude/**` pergunta — e o limite disso está dito

`Edit(.claude/**)` está em `ask` porque, sem isso, a sessão reescreveria este arquivo e se
concederia o que quisesse: trava que quem ela restringe pode apagar sozinho não é trava.

**⚠️ MAS ESTE ARQUIVO NÃO AFIRMA QUE A SESSÃO ESTÁ IMPEDIDA DE ESCREVER EM `.claude/`.**
`cp` saiu do `allow` justamente porque `cp x .claude/settings.json` passava por baixo da
regra de `Edit` — e ele não era o único caminho: se o casador de permissão enxerga a linha
de comando inteira, **qualquer** regra com `*` admite um `> caminho` no fim, e a suíte de
testes executa código do repositório, que escreve onde quiser. Cobrir todos esses caminhos
não é possível nesta sintaxe.

Então a afirmação honesta é esta: a edição direta pergunta, os caminhos de cópia e escrita
mais óbvios perguntam, e o resto é **redução de acidente, não impedimento**. Quem quiser
impedimento de verdade precisa disso fora daqui — permissão de arquivo no sistema, ou
revisão obrigatória deste caminho no repositório.

## Mergear, disparar workflow e aprovar PR perguntam

A sintaxe não sabe separar *"dispare a auditoria"* de *"dispare a publicação"*, nem
*"mergeie este PR já auditado"* de *"mergeie qualquer coisa"*. Como não dá para restringir
por repositório, branch ou workflow, o controle honesto é a confirmação.

Isso também **transforma em mecanismo uma regra que já estava escrita**: publicação só
acontece depois da auditoria e com autorização da direção. Enquanto dependia de eu
lembrar, era promessa.

`pull_request_review_write` vai junto — é por onde uma sessão aprovaria o próprio PR. E
`create_or_update_file`, `push_files` e `delete_file` escrevem no repositório sem passar
por PR nem por CI.

## Resumo do que este arquivo NÃO promete

- Não impede execução arbitrária (a suíte roda código do repositório, e o repositório é
  editável).
- Não impede, por si, escrita em `.claude/` a partir de um comando de shell.
- Não substitui a permissão do token do GitHub nem a do banco: quem quer que uma operação
  seja **impossível**, e não apenas confirmada, tem de retirá-la da credencial.
