# Instalação (para agentes)

1. Instale o MCP e configure os clientes disponíveis:

   ```sh
   npx -y github:Luizfbm/mcp-apontamento setup
   ```

2. Autorize o MCP no navegador que abrir. O setup testa o usuário e as agendas de hoje. Está pronto quando imprimir `Tudo pronto: <nome>, você tem N agendas hoje.`

3. Se o Node.js 20 ou superior estiver ausente, instale com `winget install OpenJS.NodeJS.LTS`, abra um terminal novo e repita o comando.

4. Se o Git não conseguir acessar o repositório privado, execute `gh auth login` com uma conta que tenha acesso ao repositório e repita o setup.

5. Se a autorização expirar, rode `npx -y github:Luizfbm/mcp-apontamento login`.

## O que o MCP faz

O servidor local usa sua conta autorizada do Portal PVT para consultar suas agendas e lançar apontamentos em seu nome. Cada lançamento pede confirmação antes de gravar.

## Ferramentas

- `minhas_agendas`: lista as agendas em um período; por padrão, mostra hoje.
- `atividades_da_agenda`: lista as tarefas elegíveis para uma agenda.
- `apontamentos_pendentes`: lista agendas sem apontamento; por padrão, consulta os últimos 30 dias até hoje.
- `lancar_apontamento`: prepara um apontamento e solicita confirmação. Consulte primeiro a agenda e a atividade, e envie `data_agenda` exatamente como apareceu em `minhas_agendas`. Se a elicitation falhar ou não for suportada, mostre o resumo; depois da confirmação do usuário, chame novamente com `confirmar: true`.

## Configuração

`PORTAL_URL` escolhe o Portal, com padrão `https://portal.pvtsoftware.com.br`. No setup, também é possível usar `--portal-url http://localhost:3100`; o valor informado é salvo nos registros MCP.

O token fica no Gerenciador de Credenciais do Windows quando disponível. Se o armazenamento seguro não puder ser usado, o MCP informa que salvou no arquivo de perfil `%APPDATA%/mcp-apontamento/token.json`.

## Desinstalar

Antes de remover o último registro MCP, execute `npx -y github:Luizfbm/mcp-apontamento logout` para revogar o token no Portal. Depois remova o registro `apontamento` das configurações MCP do Claude Code, Codex, Cursor e Claude Desktop. Apague `%APPDATA%/mcp-apontamento/token.json` se existir.
