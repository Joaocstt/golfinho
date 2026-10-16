# Marca do Golfinho

`icon.png` é a arte principal, criada com a ferramenta integrada de geração de
imagens. A interface e o favicon usam essa mesma imagem.

Os arquivos derivados ficam versionados para que o release não dependa de geração
de imagens nem de conversores adicionais:

- `icon.ico`: Windows, instalador NSIS e desinstalador (16 a 256 px).
- `icon.icns`: macOS (16 a 1024 px).
- `icons/*.png`: ícones Linux (16 a 512 px).

Para atualizar os formatos após substituir `icon.png`, execute no Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/generate-icons.ps1
```

O electron-builder inclui o PNG e o ICO em `resources/branding` para o ícone da
janela. Os demais formatos são aplicados aos pacotes nativos. Execute o fluxo
normal de release para distribuir a marca; downloads de releases anteriores
continuam com o ícone antigo.

No Windows, `npm run dev` e `npm start` criam e reutilizam um executável local
`Golfinho-dev.exe`, ao lado do runtime do Electron, com ícone e nome próprios.
O `electron.exe` original é preservado. Após atualizar a arte ou as dependências,
o comando reaplica a marca automaticamente. Feche a sessão local anterior antes
de abrir o app novamente para que o Windows use o novo executável.

## Prompt da arte

Use case: logo-brand. Create one finished desktop application icon for Golfinho,
a dark minimal coding workspace for coding agents and Git tasks. A bold elegant
stylized dolphin leaping in a compact curved silhouette, with a very subtle
suggestion of an ocean wave in the sweep of the tail. Modern premium developer-tool
identity. Simple strong geometric organic shapes, very few details, crisp smooth
edges, legible at 16px. Cool silver-white dolphin with restrained icy cyan and
ocean blue shading, on a deep charcoal rounded-square app tile. Centered single
icon, square canvas, tile fills 90% of canvas leaving transparent outer corners
and narrow transparent margins. Dolphin fills most of tile with comfortable
padding. Flat vector-like finish, precise silhouette, no thin strokes, no letters,
no text, no watermark, no mockup, no multiple options. Deliver real alpha
transparency outside the rounded-square tile.
