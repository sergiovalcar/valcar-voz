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

**⚠️ `git fetch` PARECE LEITURA E NÃO É — E A FORMA EXATA NÃO PROTEGE.** `git fetch --force
origin main:refs/heads/x` sobrescreve a referência local `x` e tira dela os commits que só
existiam ali — mesma classe de `reset` e `update-ref`, que pedem confirmação.

Aqui estavam as cinco formas **sem argumento** (`git fetch`, `git fetch origin`, `--all`,
`--prune`, `--tags`), sob o argumento de que "não existe argumento a mais para escorregar".
**Era falso, e o achado é da auditoria independente de 23/09:** um `git fetch origin` pelado
usa os refspecs **configurados** em `remote.origin.fetch`. Com
`+refs/heads/main:refs/heads/backup` gravado ali, o comando sem argumento nenhum sobrescreve
a branch local `backup` e leva embora o que só existia nela. **Quem decide o destino é a
CONFIGURAÇÃO, não a linha de comando** — então nenhuma forma escrita em `allow` consegue
responder pela operação.

É a guarda que responde a pergunta VIZINHA: ela garante *"não cabe argumento a mais"*, e a
pergunta que importa é *"isto pode escrever numa referência local?"*. Guarda assim passa nos
casos da mesa e falha na classe ao lado — e, pior, o texto aqui **afirmava** a proteção, o
que faz o próximo leitor parar de procurar. Mesma forma que a descrição do robô que prometia
uma trava por tempo de vida quando o código decide por outro fato.

**As cinco saíram, e `Bash(git fetch*)` entrou em `ask`.** `git fetch` passou a pedir
confirmação, como `reset` e `push`. Custa um clique por busca; a alternativa era manter
escrita uma promessa que a ferramenta não cumpre.

**⚠️ E aqui o curinga é o lado SEGURO, ao contrário do que vale em `allow`.** Cinco formas
exatas em `ask` seriam lista à mão (regra 4): a sexta forma — `git fetch --force`, a que
motivou tudo isto — nasceria fora dela. Em `ask` o curinga só pode PEDIR mais confirmação,
nunca liberar; em `allow` ele libera tudo que vier depois. **A mesma escrita muda de
natureza conforme a lista em que está.**

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

Isso os põe na classe do `git fetch` deste arquivo: comando que **parece leitura e não é**.
A resposta aqui é a forma **EXATA** em `allow`, com o curinga fora — onde não existe
argumento a mais, não existe onde `--output` escorregar.

**⚠️ E A DIFERENÇA PARA O `git fetch` É O QUE DECIDE O DESTINO.** Aqui o perigo mora no
ARGUMENTO, então tirar o argumento fecha o buraco. No `fetch` ele mora na CONFIGURAÇÃO
(`remote.origin.fetch`), que a linha de comando não mostra — por isso lá nem a forma exata
serviu, e as cinco saíram para `ask`. **Mesma aparência, causas em lugares diferentes, e por
isso consertos diferentes:** copiar a resposta de um para o outro é o mapa de colunas
emprestado que esta casa já pagou.

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

## `execute_sql` saiu do `allow` — `apply_migration` em `deny` NÃO cobria

**⚠️ ACHADO [P1] DA AUDITORIA INDEPENDENTE DE 23/09, e ele contraria uma decisão da própria
direção.** `mcp__Supabase__execute_sql` estava em `allow`, quer dizer: pré-autorizado. E a
ferramenta não distingue consulta de escrita — `UPDATE`, `DELETE` e DDL entram pela mesma
porta. Ter `apply_migration` em `deny` dava a impressão de que a estrutura estava trancada, e
**a tranca era de UMA porta**: um `alter table` por `execute_sql` passava sem confirmação
nenhuma.

O preço não é hipotético e já está escrito nas regras desta casa: *Claude escreve o `.sql`, a
direção aplica*. Com `execute_sql` pré-autorizado, essa regra dependia só de eu lembrar dela —
e **regra que depende de alguém lembrar é a classe de defeito que produziu as 62 vendas com o
supervisor errado**. Um `delete from jobs` teria a mesma cara de uma contagem.

**Ele NÃO foi para `deny`, e a escolha é deliberada.** Medir no banco é metade do trabalho
desta casa — quase toda regra escrita aqui nasceu de uma consulta. Proibir seria trava sem
escape, e trava sem escape faz contornar por fora. Fora do `allow` ele cai no padrão:
**pergunta**. A capacidade fica, a confirmação volta.

**⚠️ E ISTO NÃO TORNA A ESCRITA IMPOSSÍVEL** — só deixa de ser automática. Quem quiser que
ela não exista tem de tirar do TOKEN do banco, não desta lista; é a mesma ressalva que fecha
este arquivo.

## ⚠️ SAIR DO `allow` NÃO PROVA QUE PERGUNTA — por isso os dois estão escritos em `ask`

**Achado da auditoria independente de 23/09, sobre o conserto anterior deste mesmo arquivo:**
*"Remover `git fetch`, `execute_sql` e `update_pull_request_branch` de `allow` sem incluí-los
explicitamente em `ask` não comprova que pedirão confirmação na configuração efetiva."*

Está certo, e a distinção é a de sempre nesta casa: **o que eu tinha era o PADRÃO da
ferramenta, e padrão não é regra declarada.** Fora das três listas, a operação cai no
comportamento de fábrica — que hoje pergunta, e que nenhum arquivo deste repositório
garante amanhã. Pior: uma linha mais larga noutra lista (um `allow` futuro com curinga, uma
configuração de usuário fora daqui) passaria a cobri-la **sem que nada aqui mudasse**. A
ausência não se defende sozinha; a entrada explícita se defende.

Por isso `Bash(git fetch*)` e `mcp__Supabase__execute_sql` estão **escritos** em `ask`. O
efeito hoje é idêntico ao de antes — e é justamente esse o ponto: o conserto não muda o
comportamento, muda quem responde por ele.

**⚠️ E FOI ESTE CONSERTO QUE ACHOU O TERCEIRO, QUE ERA PIOR: `update_pull_request_branch`
estava escrito aqui como *"VEIO PARA CÁ"* e NÃO ESTAVA EM `ask` nenhum.** Ele tinha saído do
`allow`, o texto anunciou a chegada, e a linha nunca foi escrita — **o arquivo afirmando uma
proteção que a configuração não tinha**, que é exatamente a classe do commit anterior deste
mesmo arquivo (a guarda do `git fetch` por forma exata). Texto e lista discordando é pior que
lista curta: quem lê o texto **para de procurar**.

A lição de método é a que se reaproveita: **o achado dizia "os três"; eu tinha conferido os
dois que me pareciam o pedido.** Foi ao escrever a razão de deixar o terceiro de fora que
precisei olhá-lo — e ele não estava onde o próprio arquivo dizia. *Antes de justificar uma
ausência, confira se ela é ausência.*

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
