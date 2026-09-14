# AGENTS.md — valcar-voz

Este arquivo governa o trabalho do Codex neste repositório. Instruções atuais do responsável prevalecem sobre relatos históricos. `CLAUDE.md`, quando existente, é contexto para investigação: confronte decisões com código, testes e documentação vigente; não herde autorização para aprovar, fazer merge ou publicar.

## Como trabalhar

- Confirme branch, commit e alterações existentes antes de editar; preserve trabalho de outras pessoas.
- Neste trabalho de fundação, use exclusivamente a branch já existente `codex/agents-foundation`: somente este `AGENTS.md`, sem mudança funcional, migration, configuração de ambiente, deploy ou alteração de `main`. Mostre o diff completo dos quatro arquivos antes de abrir PRs. Não faça merge.
- Em trabalhos posteriores, mantenha PRs pequenos e focados. Não faça rebase, force-push ou merge por instrução histórica do Claude. Descreva mudança, motivo, validação executada e limitações.
- Leia `package.json`, CI, documentação e os chamadores do fluxo afetado. Use os scripts existentes para testes/lint/build; não invente comandos ausentes nem execute scripts operacionais como se fossem testes.
- Comunique resultado e riscos em português simples. Distinga evidência medida, hipótese e pendência.

## Regras compartilhadas do Grupo Valcar

- Uma regra de negócio tem uma fonte de verdade. Reutilize o módulo, configuração ou função de banco responsável; consumidores derivam dela. Não replique decisões em telas, prompts ou serviços. Contratos entre repositórios precisam de casos de compatibilidade.
- “Não sabemos” é diferente de “não”. Ausência de dado, falha de consulta e resposta negativa devem ser distinguíveis; não transforme desconhecido em zero, sucesso ou autorização.
- Meça antes de concluir: informe fonte, período, denominador e exclusões. Verifique o comportamento que falhou e, quando possível, confirme por outro caminho. Texto histórico, teste verde e deploy iniciado não provam estado atual da produção.
- Teste comportamento e não implementação: entradas, saídas, efeitos e ausência de efeitos indevidos. Asserções sobre texto, nomes ou trechos de código podem complementar uma guarda arquitetural, mas não substituem executar o comportamento.
- Toda correção de regressão exige teste que falhe ao reintroduzir o defeito. Confira que a mutação realmente mudou o código, observe a falha pelo motivo esperado, restaure e confirme o teste verde. Não enfraqueça testes para acomodar o defeito.
- Mudanças financeiras, boletos, cancelamentos, comissões, cobrança e onboarding são de alto risco. Registre regra/fonte, impacto nos quatro sistemas, cenários de borda, evidências de validação e recuperação antes da revisão independente.
- Preserve unicidade e operações concorrentes com garantias do banco; alinhe migrations, constraints e valores escritos. Trate erros retornados pelas integrações e pelo Supabase, não apenas exceções.
- Preserve idempotência, rastreabilidade e recuperação dos estados interrompidos. Exceções de negócio auditadas não autorizam contornar autenticação nem isolamento de ambiente.
- Não exponha segredos, dados pessoais, mensagens, gravações ou boletos reais em commits, fixtures ou logs. Use dados sintéticos ou anonimizados.
- Nenhuma alteração deve ir automaticamente para produção. CI verde não autoriza deploy. O agente que implementa não aprova nem faz merge do próprio PR; revisão e aprovação devem ser independentes, com liberação de produção explícita pelo responsável.

## Homologação e efeitos externos

- Falhe fechado: banco, ambiente ou destino desconhecido nunca pode produzir efeito externo, inclusive por chamada indireta, fila, cron, webhook, e-mail ou voz.
- Confirme a identidade e o isolamento dos recursos efetivos. Nome de branch, faixa na tela, URL de preview e credencial válida não comprovam homologação.
- Nenhuma variável de ambiente pode promover um ambiente não produtivo a produção. Overrides existentes não autorizam reclassificar banco, substituir a identidade de produção ou liberar ambiente desconhecido.
- Dados de produção só podem ir para homologação anonimizados antes da transferência, incluindo conteúdo livre, anexos e gravações. Prefira dados sintéticos.
- Previews não podem apontar inadvertidamente para bancos, filas, Storage, APIs, webhooks ou serviços de produção. Não copie o conjunto de variáveis/segredos de produção; confira cada dependência e mantenha efeitos externos bloqueados até comprovar isolamento.
- Documentação de governança não instala travas de execução. Ao encontrar divergência entre estas regras e o código, registre a lacuna e mantenha a operação bloqueada; corrija apenas em trabalho funcional autorizado.

## Arquitetura e invariantes locais

- Serviço Node.js/ESM com Express, WebSocket e WebRTC (`werift`) em `server.js`: liga a perna da Meta à do navegador e reporta eventos/gravações ao Conversas. `copiloto.js` envia áudio ao serviço de copiloto do repositório Robô; `mulaw.js` converte PCM16 para mu-law.
- `VOZ_SECRET` é obrigatório: preserve a interrupção do boot quando ausente. Nunca introduza segredo padrão, fallback fraco ou log do segredo.
- Preserve a comparação de `x-voz-secret` em tempo constante com `crypto.timingSafeEqual` e tratamento seguro de tamanhos diferentes. Autenticação e validação de assinaturas devem usar comparação em tempo constante; nunca dispense validação para facilitar teste.
- Lacuna conhecida na fundação: `verificarTicketVoz` ainda compara a assinatura HMAC com `!==`. A comparação em tempo constante está comprovada no cabeçalho, não no ticket. Preserve validação de assinatura e expiração; a correção do ticket fica para trabalho funcional autorizado.
- `VOZ_DEV` e uma página de operador não comprovam isolamento. Não faça ligações reais nem envie áudio, mensagens ou eventos a serviços reais para testar documentação.
- Não presuma que a porta única de mensagens do Conversas cubra este serviço: `server.js` possui `metaCalls` e `metaMessages` próprios, além de callbacks ao Conversas. Não há módulo de ambiente equivalente ao dos irmãos nesta base; homologação com efeitos externos permanece bloqueada até comprovar isolamento de todos os destinos.
- Preserve o protocolo do copiloto (`start`, `media`, `stop`), a separação cliente/operador e o reaproveitamento do PCM já decodificado. Não duplique aqui roteiro, transcrição ou regra de onboarding.
- O copiloto é opcional e inerte sem `COPILOTO_WS_URL`; falha dele não deve derrubar a ligação. Isso não autoriza fallback para um serviço de produção nem ignorar falhas de autenticação.

## Validação

- `package.json` declara Node >=18: `npm run check` verifica os três módulos e `npm test` executa `test/*.test.js`. Não há scripts de lint ou build; `npm start` inicia um serviço com efeitos externos.
- A base consultada não contém `CLAUDE.md`, README, documento de homologação nem workflow de CI. Não invente instruções desses arquivos nem presuma cobertura.
- `test/mulaw.test.js` cobre o codec; não certifica autenticação, isolamento, WebRTC ou entrega das sugestões. Alterações futuras nesses fluxos exigem cenários próprios com rede substituída e dados sintéticos.
