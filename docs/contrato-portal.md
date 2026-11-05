# Contrato de interface: Portal PVT ↔ MCP de apontamento

Fonte única do combinado entre o Portal (rotas novas de token e Bearer nas rotas de apontamento) e o MCP. Só o coordenador muda este arquivo.

`PORTAL_URL`: produção `https://portal.pvtsoftware.com.br`; desenvolvimento local `http://localhost:3100`.

## Token do MCP

- Formato: `pvtmcp_` + 32 bytes aleatórios em base64url.
- O Portal guarda só o SHA-256 do token.
- Escopo único: `apontamento`.
- Validade absoluta de 90 dias (`expires_in: 7776000`).
- É uma sessão própria do Portal: não cai com logout do navegador nem com a inatividade de 40 min da sessão web.
- O Portal atualiza `last_used_at` a cada uso.

## 1. Autorização no navegador (Authorization Code + PKCE S256)

O MCP abre:

```
GET {PORTAL_URL}/mcp/autorizar?response_type=code&client_id=mcp-apontamento&redirect_uri=http://127.0.0.1:{porta}/callback&code_challenge={challenge}&code_challenge_method=S256&state={state}
```

- Sem sessão web: o Portal manda para `/login?next=<url atual codificada>` e, depois do login, volta para essa URL. `next` só aceita caminho relativo do próprio Portal.
- `redirect_uri` só é aceito com `http`, host `127.0.0.1` ou `localhost`, qualquer porta e caminho `/callback`. Fora disso a página mostra erro e não redireciona.
- A página mostra quem está logado, o que o MCP poderá fazer ("consultar suas agendas e lançar apontamentos em seu nome"), a validade (90 dias) e os botões Autorizar e Cancelar.
- Autorizar: navegador vai para `{redirect_uri}?code={code}&state={state}`.
- Cancelar: navegador vai para `{redirect_uri}?error=access_denied&state={state}`.
- `code`: aleatório, uso único, expira em 5 min, amarrado a usuário, `redirect_uri` e `code_challenge`.

Rota usada pela página (cookie de sessão web):

```
POST /api/mcp/authorize
body: { "client_id": "mcp-apontamento", "redirect_uri": "...", "code_challenge": "...", "code_challenge_method": "S256", "state": "..." }
200: { "redirect": "http://127.0.0.1:53121/callback?code=...&state=..." }
400: { "error": "invalid_request", "error_description": "redirect_uri não permitido" }
401: { "message": "Sessão expirada" }
```

## 2. Troca do code pelo token

```
POST /api/mcp/token            (sem cookie)
Content-Type: application/json
{ "grant_type": "authorization_code", "code": "...", "code_verifier": "...", "redirect_uri": "http://127.0.0.1:53121/callback", "client_id": "mcp-apontamento" }
```

200:

```json
{
  "access_token": "pvtmcp_q8V2...",
  "token_type": "Bearer",
  "expires_in": 7776000,
  "expires_at": "2027-02-01T13:00:00.000Z",
  "scope": "apontamento",
  "username": "caique.moreira"
}
```

400: `{ "error": "invalid_grant" | "invalid_request" | "unsupported_grant_type", "error_description": "..." }`

## 3. Rotas com Bearer do MCP

Cabeçalho: `Authorization: Bearer pvtmcp_...`

```
GET /api/mcp/me
200: { "username": "caique.moreira", "nome": "Caique Moreira", "codcfo": "0013", "scope": "apontamento", "expires_at": "2027-02-01T13:00:00.000Z" }

DELETE /api/mcp/token          (revoga o próprio token; usado pelo comando logout)
204

GET /api/mcp/pendentes?data_inicio=2026-10-01&data_fim=2026-11-03
    (agendas do próprio analista, no período, que ainda não têm apontamento;
     mesma fonte do card de apontamentos pendentes da home; padrão: últimos 30 dias até hoje; período máximo 45 dias)
200: { "pendentes": [ { "id_agenda": "244661", "data": "2026-10-28", "id_projeto": "2250", "projeto": "Implantação RM",
                        "cliente": "", "coordenador": "Fulano", "horas_agendadas": "08:00",
                        "id_tarefa": "28162", "tarefa": "Parametrização" } ] }
200 sem pendências: { "pendentes": [] }
400 período inválido: { "message": "..." }
```

- `cliente` vem vazio na v1 (a sentença de pendentes não traz o cliente).
- `horas_agendadas` vem vazio quando a agenda não aparece na API050 do período.

## 4. Rotas existentes que passam a aceitar o Bearer

Mesmo comportamento, mesmos parâmetros e mesmo corpo de resposta de hoje com cookie. A sessão do token roda com as permissões do próprio analista (inclusive a regra "analista só aponta na própria agenda/CFO").

| Método | Rota | Parâmetros |
|---|---|---|
| GET | `/api/projects-by-date` | `codcfo`, `startDate`, `endDate` (YYYY-MM-DD) |
| GET | `/api/apontador/atividades-agenda` | `idagenda`, `codcfo` |
| POST | `/api/apontador/apontamentos` | corpo `ZMDAPONTAMENTO` (só POST; PUT continua só com cookie) |

Qualquer outra rota chamada com Bearer do MCP: 401.

### Resultado do `POST /api/apontador/apontamentos`

| HTTP | Significado | Status no MCP |
|---|---|---|
| 201 | gravado no RM | `GRAVADO` |
| 200 | foi para aprovação (projeto exige ou atraso > 3 dias úteis); corpo com `message` ou retorno da aprovação | `AGUARDANDO_APROVACAO` |
| 400 | bloqueado pela checagem de consistência do RM ou corpo inválido; `{ "message": "..." }` | `BLOQUEADO` |
| 403 | agenda/CFO não é do analista; `{ "message": "..." }` | `SEM_ACESSO` |
| 500 | erro; `{ "message": "..." }` | `ERRO` |

Corpo enviado pelo MCP (todos os campos de identificação vêm da agenda e de `/api/mcp/me`, nunca do texto do agente):

```json
{
  "ZMDAPONTAMENTO": [{
    "IDAGENDA": "244661", "DTAGENDA": "2026-05-08T00:00:00.000Z", "IDTAREFA": "28162", "IDPRJ": "2250",
    "PROJETO": "<da agenda>", "COORDENADOR": "<da agenda>", "ANALISTA": "<nome do /me>",
    "USUARIO_ANALISTA": "<username do /me>", "CODCFO_ANALISTA": "<codcfo do /me>",
    "HORAINICIO": "08:00", "INTERVALO": "00:00", "HORAFIM": "12:00", "TOTALHORAS": "04:00",
    "DETALHAMENTO": "Descrição da atividade.", "AVANSOFISICO": null, "STATUS": "PENDENTE"
  }]
}
```

## 5. Erros de autenticação (todas as rotas com Bearer)

Token ausente, inválido, expirado, revogado, ou sessão do RM que não renova mais (ex.: senha trocada):

```
401 { "message": "Token do MCP inválido ou expirado.", "code": "mcp_token_invalid" }
```

O MCP, ao receber `code: "mcp_token_invalid"`, descarta o token guardado e refaz a autorização no navegador.

Falha passageira do RM não invalida o token (o MCP mantém o token e só repassa o erro):

```
503 { "message": "RM indisponível, tente de novo em instantes." }   (renovação da sessão do RM falhou por rede/5xx/timeout)
502 { "message": "Falha ao consultar o RM." }                        (/api/mcp/me e /api/mcp/pendentes)
```

## 6. Gestão pelo analista (cookie de sessão web; tela do Portal)

```
GET  /api/mcp/tokens
200: { "tokens": [ { "id": 12, "created_at": "...", "expires_at": "...", "last_used_at": "..." | null, "revoked_at": null } ] }

POST /api/mcp/tokens/revogar   body: { "id": 12 }
204 | 404 { "message": "Token não encontrado" }
```

Lista só os tokens do usuário logado.
