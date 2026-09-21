# Por que `settings.json` é assim

Este arquivo existe porque `settings.json` é JSON e não aceita comentário — e as decisões
abaixo são exatamente do tipo que alguém "conserta" de volta por parecerem excesso de zelo.

## A regra que decide tudo: o controle é a AUSÊNCIA do guarda-chuva

As listas `allow`, `ask` e `deny` casam por **prefixo**. Isso quer dizer que **nenhuma
delas consegue descrever uma operação independentemente da ordem dos argumentos**:

    Bash(git push --force*)   NÃO casa com   git push origin --force
    Bash(git reset --hard*)   NÃO casa com   git -C . reset --hard

Escrever mais linhas de `ask` não conserta isso — conserta o caso que está na mesa e
falha na classe vizinha, que é a forma de defeito que esta casa mais paga caro. **A única
trava que não depende da ordem dos argumentos é a operação não estar em `allow`.**

Por isso `Bash(git *)` saiu. `git push`, `git reset`, `git rebase`, `git clean` e
companhia **não aparecem em `allow` sob nenhuma forma**, então qualquer arranjo de
argumentos cai no comportamento padrão, que é perguntar. As entradas de `ask` são a
**segunda camada** e servem de documentação da intenção; elas não são o que protege.

**Corolário que vale para quem mexer aqui:** toda entrada nova em `allow` que contenha um
`*` precisa ser lida como *"qualquer flag que venha depois também está liberada"*. Se
existe uma flag destrutiva possível naquele comando, a entrada está errada — o certo é
listar o subcomando seguro, nunca o programa inteiro.

## Os interpretadores saíram pelo mesmo motivo

`Bash(python3 *)`, `Bash(node *)`, `Bash(npx *)`, `Bash(awk *)`, `Bash(sed *)` e
`Bash(find *)` liberavam, na prática, tudo o que as linhas acima acabaram de recusar —
`python3 -c` executa qualquer coisa, `find -exec` apaga, `awk` tem `system()`. Ficaram
apenas as formas que **executam a suíte do projeto** (`npm test`, `npm run`, `node --test`,
`python3 -m unittest`, `python3 -m pytest`). `npm install` de pacote novo também
pergunta: instalar dependência é trazer código de fora.

`grep`, `rg`, `jq`, `cat`, `ls`, `wc`, `sort`, `uniq`, `diff` e `head`/`tail` ficam porque
não executam nada. `mv` e `rm` perguntam porque sobrescrevem.

## Merge, disparo de workflow e aprovação de PR perguntam

`mcp__github__merge_pull_request`, `mcp__github__actions_run_trigger` e
`mcp__github__pull_request_review_write` saíram de `allow`.

A sintaxe de permissão não sabe distinguir *"dispare o workflow de auditoria"* de
*"dispare o workflow de publicação"*, nem *"mergeie este PR já auditado"* de *"mergeie
qualquer coisa"*. Como não dá para restringir por repositório, branch ou workflow, o
controle honesto é a confirmação.

Isso também **transforma em mecanismo uma regra que já estava escrita**: publicação só
acontece depois da auditoria e com autorização da direção. Enquanto dependia de eu
lembrar, era promessa; agora é a própria ferramenta que pede o aval.

`create_or_update_file`, `push_files` e `delete_file` perguntam pela mesma razão: escrevem
direto no repositório, sem passar por PR nem por CI.

## `Edit(.claude/**)` pergunta

Sem isso, a própria sessão poderia reescrever este arquivo e se conceder o que quisesse —
a trava mais forte do conjunto é inútil se quem ela restringe pode apagá-la sozinho. Ela
continua editável, com confirmação.

## O que este arquivo NÃO promete

Ele restringe o que **esta sessão do Claude Code** faz sem perguntar. Não substitui as
permissões do token do GitHub nem as do banco: quem quer garantir que uma operação é
impossível, e não apenas confirmada, tem de retirá-la da credencial.
