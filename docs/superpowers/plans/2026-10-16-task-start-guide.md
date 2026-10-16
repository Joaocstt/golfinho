# Orientação inicial da tarefa

**Objetivo:** apresentar o próximo passo no Terminal de tarefas em rascunho.

**Design aprovado:** painel central com o título “Tudo pronto para começar”, orientação para iniciar e acompanhar o agente, referências a Diff e Checks e botão “Colocar na fila”. O painel desaparece quando a tarefa sai de rascunho.

**Implementação:**

- [x] Em `src/renderer/App.tsx`, apresentar o painel no lugar do Terminal somente quando `task.status === "draft"`. Reutilizar `act("queue")` e `busy` no botão.
- [x] Em `src/renderer/style.css`, centralizar o painel com largura de leitura limitada, espaçamento e rolagem para áreas menores.
- [x] Executar `npm run typecheck`, `npm test -- tests/ui.test.tsx tests/terminal.test.tsx` e `npm run build`. Revisar o diff para confirmar a condição de exibição e a reutilização da ação existente.

Alteração visual reversível: usar as verificações existentes, sem adicionar testes que apenas reproduzam a marcação do painel.

**Resultado:** checagem de tipos e build aprovados; 26 testes existentes passaram. Dependências instaladas com `npm ci --ignore-scripts`. Layout revisado pelo código, sem inspeção visual no aplicativo.
