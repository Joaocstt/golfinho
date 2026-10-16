# Avisos de permissão no aplicativo

**Design aprovado:** avisar quando uma tarefa precisar de permissão, destacar a aba e oferecer “Abrir pedido”, sem mudar o foco automaticamente. Cobrir Terminal e Chat.

**Arquitetura:** um hook no App acompanha eventos de todas as tarefas, inclusive abas fechadas. Aprovações do Chat usam os eventos estruturados existentes. O Terminal usa detecção conservadora de perguntas explícitas de aprovação acompanhadas das opções de resposta, normalizando sequências ANSI e juntando fragmentos de saída. A notificação nunca aprova nem envia comandos.

- [x] Testar perguntas reconhecidas, saída fragmentada/colorida, falsos positivos e eventos duplicados.
- [x] Implementar o detector e estado de pedidos por tarefa e origem; resolver Chat pelo evento de resposta e Terminal por entrada enviada com sucesso ou fim da execução.
- [x] Mostrar avisos e indicadores, abrir a tarefa e a aba correspondente apenas por ação do usuário, preservando a divisão e a proteção de edição não salva.
- [x] Validar tipos, testes relacionados e build; revisar ciclo de vida e encaminhamento dos IDs.

**Limite:** o Terminal oferece texto livre, sem evento estruturado de aprovação. O detector cobre formatos explícitos conhecidos de Codex e Claude; uma mudança de texto ou idioma da CLI pode exigir novos padrões. Sem inferir pedidos por silêncio ou tempo de execução.

**Verificação:** checagem de tipos, build e 71 testes relacionados aprovados. A revisão identificou dois casos corrigidos com regressão: manter a proteção do editor ao abrir um pedido já visível e ignorar saída atrasada de CLI encerrada. Validação visual indisponível nesta sessão, sem navegador conectado.
