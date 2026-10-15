# Quickstart — validação ponta a ponta

1. `npm install && npm run build`
2. Postgres local: `DATABASE_URL=postgres://... STORAGE_DRIVER=local ADMIN_EMAIL=... ADMIN_PASSWORD=... npm start`
3. Abra `http://localhost:3000` e entre com o admin.
4. Em outra janela abra `http://localhost:3000/tv` → aparece um código.
5. Painel → Telas → "+ Adicionar tela" → digite o código, escolha Consolação / Salão → confirmar.
6. Mídia → arraste uma imagem e um MP4 → Playlists → nova → adicione → Publicar.
7. Programação → "Publicar" playlist para a TV → a janela do player troca em até 30 s.
8. Dashboard: TV online, versão "recebida" igual à publicada.
9. Feche o servidor: o player continua tocando. Reabra: TV volta a online.

Automatizado: `npm test` (unit + integração) e `npm run e2e` (fluxo acima com 2 TVs em Chromium).
