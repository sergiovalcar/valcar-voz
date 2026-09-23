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
destrutiva possível**: status, log, show, diff, add, commit, rev-parse, ls-files,
merge-base, blame. `checkout`, `switch`, `restore` e `stash` saíram junto com push, reset,
clean e rebase — `git checkout -f HEAD` descarta alteração não salva e `git stash clear`
apaga o que estava guardado, e nenhuma regra de prefixo separa essas formas das inofensivas.

**⚠️ `git fetch` PARECE LEITURA E NÃO É.** `git fetch --force origin main:refs/heads/x`
sobrescreve a referência local `x` e tira dela os commits que só existiam ali — mesma
classe de `reset` e `update-ref`, que pedem confirmação. Por isso ele não entra com `*`:
entram as formas **exatas** (`git fetch`, `git fetch origin`, `--all`, `--prune`,
`--tags`), onde não existe argumento a mais para escorregar. Buscar uma branch específica
pergunta, porque é ali que o refspec com dois-pontos caberia.

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

`grep`, `jq`, `cat`, `ls`, `wc`, `diff`, `head` e `tail` ficam porque não executam programa
nenhum e não escrevem arquivo. `cp`, `mv`, `rm`, `tee`, `ln`, `dd`, `truncate`, `install`,
`chmod`, `curl` e `wget` perguntam: os primeiros escrevem ou apagam arquivo, os dois
últimos trazem coisa de fora.

**⚠️ E `sort` E `uniq` SAÍRAM DO `allow` — a frase acima os incluía e era FALSA para os
dois.** Dois pareceres do Codex, em repositórios diferentes, acharam as duas metades da
mesma linha: `sort --compress-program=./programa -S 1b entrada-grande.txt` **executa** o
programa indicado quando o `sort` precisa de arquivo temporário (é a mesma capacidade que
tirou o `rg --pre` daqui), e `sort -o destino origem` e `uniq origem destino`
**sobrescrevem** um arquivo que já existe — sem redirecionamento de shell nenhum, que é o
caminho que `cp` e `tee` já pediam para confirmar.

**E o conserto não é uma regra mais apertada, pela razão que o `git fetch` já ensinou neste
arquivo:** o perigo mora numa FLAG e num SEGUNDO OPERANDO, e qualquer curinga os admite.
Não existe, nesta sintaxe, como escrever *"sort sem `-o` e sem `--compress-program`"*. Então
os dois passam a **perguntar**, como `sed`, `awk` e `find` — que saíram por exatamente a
mesma classe de capacidade.

**⚠️ E A FRASE QUE ESTAVA AQUI ERA FALSA — achado [P2] do parecer de 23/09.** Ela dizia
que *"ler ordenado continua livre (`cat x | sort`, `grep … | sort | uniq -c`)"*, e o próprio
exemplo se contradizia: `uniq -c` casa com `Bash(uniq *)`, que está em `ask`. A regra de
prefixo **não sabe** separar leitura de escrita — ela vê a linha de comando, não a intenção.
O custo real é este: **toda** forma de `sort` e `uniq` com argumento passa a pedir
confirmação, inclusive as de leitura. É um incômodo aceito em troca de fechar a execução e a
sobrescrita; dizer que só a escrita seria afetada era o documento prometendo o que a sintaxe
não entrega.

## `git log`, `git diff` e `git show` perderam o curinga — `--output` ESCREVE

**⚠️ ACHADO [P1] DO PARECER DE 23/09, e ele foi REPRODUZIDO antes do conserto:** num
repositório de teste, `git diff --output=alvo.txt` e `git log --output=alvo.txt`
**sobrescreveram** um arquivo existente. Sem redirecionamento de shell, sem `cp`, sem
`Edit` — um argumento. Os três aceitam opções de diff, e com elas o `--output`.

Isso os põe exatamente na classe do `git fetch` deste arquivo: comando que **parece leitura
e não é**. E a resposta é a mesma, porque é a única que a sintaxe permite — as formas
**EXATAS** entram em `allow`, o curinga sai. Onde não existe argumento a mais, não existe
onde `--output` escorregar.

**O que isso custa, dito sem enfeite:** `git log` e `git diff` com argumento fora da lista
curta passam a pedir confirmação, e é o comando que mais se usa aqui. A lista é curta de
propósito: ela envelhece (regra 4), e o preço de faltar uma forma é UMA confirmação, não um
buraco. Alargá-la com curinga seria desfazer o conserto.

**⚠️ E ISTO NÃO FECHA A CLASSE INTEIRA**, pela razão que este arquivo já declara mais
abaixo: qualquer regra com `*` admite um `> caminho` no fim, e a suíte de testes executa
código do repositório. O que o conserto tira é o caminho por ARGUMENTO, que é direto e não
depende de nada disso.

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

**⚠️ E `update_pull_request_branch` VEIO PARA CÁ — achado [P2] do mesmo
parecer.** Ele incorpora a base ao head REMOTO do PR, quer dizer, escreve no
repositório de fora — e estava em `allow` enquanto `git merge`, `git push` e
`push_files` pediam confirmação. Mesma operação, três portas, e uma delas
aberta: é *"filtro que mora numa porta só não é filtro do sistema"* numa lista
de permissão.

`pull_request_review_write` vai junto — é por onde uma sessão aprovaria o próprio PR. E
`create_or_update_file`, `push_files` e `delete_file` escrevem no repositório sem passar
por PR nem por CI.

## Resumo do que este arquivo NÃO promete

- Não impede execução arbitrária (a suíte roda código do repositório, e o repositório é
  editável).
- **Não cobre todo flag que pode vir depois de `git commit -m <mensagem>`** — `--amend`
  cabe ali. Fica dentro do risco aceito, e a razão é declarada em vez de escondida: ele
  reescreve o ÚLTIMO commit local, o anterior continua no `reflog`, e nada sai da máquina
  porque `git push` pergunta. A mensagem precisa do curinga; o resto do subcomando não
  apaga trabalho.
- Não impede, por si, escrita em `.claude/` a partir de um comando de shell.
- Não substitui a permissão do token do GitHub nem a do banco: quem quer que uma operação
  seja **impossível**, e não apenas confirmada, tem de retirá-la da credencial.
