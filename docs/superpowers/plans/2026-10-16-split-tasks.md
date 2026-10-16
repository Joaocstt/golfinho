# Duas tarefas lado a lado

**Design aprovado:** main e golfinho/fix-layout visíveis simultaneamente, cada tarefa com suas próprias abas e Terminal; divisória ajustável e retorno a um painel.

**Arquitetura:** extrair o painel existente para `TaskWorkspace.tsx`, com estado local por tarefa. O App controla quais tarefas aparecem e qual está em foco. O inspetor acompanha o painel em foco. Reutilizar as ações e processos existentes, sem iniciar outra execução ao dividir.

**Ajuste solicitado durante a implementação:** manter as tarefas abertas montadas ao alternar entre elas ou sair da divisão, preservando aba, arquivo, edição e sessões. Fechar uma aba continua protegendo edições não salvas e encerrando suas sessões de shell conforme o comportamento existente.

- [x] Criar testes de duas tarefas visíveis, abas e ações independentes, fechamento e redimensionamento.
- [x] Extrair o painel e o inspetor de tarefa preservando os comportamentos atuais e os avisos de edição não salva.
- [x] Adicionar ação nas abas de tarefa para abrir ao lado, foco por painel, divisória acessível e retorno ao painel único.
- [x] Executar os testes de interface e Terminal, checagem de tipos e build; revisar diff e encaminhamento dos IDs.

**Verificação:** 59 testes de interface, Terminal, ajuda, arquivos de revisão e coordenador passaram. Checagem de tipos e build aprovados. Revisão identificou e corrigiu proteção de edição e captura de foco por tarefas em segundo plano. Prévia visual bloqueada pela indisponibilidade de navegador na sessão.
