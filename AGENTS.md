# Instruções de desenvolvimento

- Requer Node.js 20 ou superior.
- `npm run build` compila TypeScript para `dist/` e atualiza a impressão digital de `src/`.
- `dist/` é versionado porque a instalação via `npx github:` não compila o repositório. Rode `npm run build` após qualquer mudança em `src/`.
- `npm run typecheck` valida os tipos e `npm test` executa as costuras acordadas em `tests/`.
- `tests/dist-sync.test.ts` falha se `dist/` estiver ausente ou desatualizado em relação a `src/`.
- `docs/contrato-portal.md` é o contrato de interface com o Portal; somente o coordenador altera esse arquivo.
- Testes usam Portal HTTP falso. Não conecte ao Portal nem ao RM durante desenvolvimento.
