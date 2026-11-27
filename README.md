# Cifras — songbook pessoal

Banco de cifras pessoal feito para tocar olhando o tablet:

- **Graus do campo harmônico** no lugar dos acordes (`1 4 5 6m`), com o acorde básico embaixo (`G C D Em`).
- **Acorde básico**: `G7M(9)` vira `G`, `Am7(11)` vira `Am`, `F#m7(b5)` vira `F#°`.
- **Tempos de cada acorde**: bolinhas = tempos, compassos com barras, acordes longos atravessando compassos. Ajuste tocando no acorde (⏱ Tempos).
- **Mapa em uma página**: a música inteira cabe na tela (o app ajusta fonte e colunas), com a forma da música no topo (Intro › Verso › Refrão ×2…).
- **Medley lado a lado**: várias músicas em colunas, cada uma com tom/capo próprio, e a **dica de virada** entre elas.
- **Tocar junto**: percorre o mapa no andamento, acendendo acorde e tempo, com metrônomo.
- Funciona **sem internet** e sincroniza entre tablet e celular pela **Cloudflare**.

O levantamento completo da versão antiga (problemas encontrados e o que mudou) está em
[`docs/LEVANTAMENTO.md`](docs/LEVANTAMENTO.md).

---

## Como usar

1. **＋ Nova cifra** → cole a cifra inteira (do Cifra Club, por exemplo). Título, artista, tom e
   capotraste são detectados sozinhos; a prévia do mapa aparece ao lado.
2. **Salvar** → abre a música no **Mapa** (graus + compassos). **Letra** mostra a letra com os acordes.
   Partes repetidas aparecem **uma vez só** (mesmo nome, como "Refrão", ou mesmos acordes); os chips no
   topo mostram a ordem da música, quantas vezes tocar cada parte (×2) e **≈** quando aquela vez tem
   alguma diferença (a **Letra** mostra cada vez como está escrita). Dá para desligar em Ajustes.
3. Na barra de cima: **tom** (− +) transpõe o que soa; **capo** (− +) muda as formas; **↺** volta ao original.
4. **⏱ Tempos** → toque num acorde e escolha quantos tempos ele dura (ou marque "linha inteira").
5. **▶** toca junto no andamento. Toque no botão **bpm** no ritmo da música para marcar o andamento (*tap tempo*).
6. **Aa** → exibição: graus ou acordes em destaque, números ou romanos, baixo, cores, etc.
7. **Medley**: na biblioteca, **⧉ Lado a lado** → toque nas músicas na ordem → **Abrir**.
   Ou, dentro de uma música, o botão **⧉** adiciona a um medley.
   - **Compacto** (padrão no medley): as linhas de cada parte ficam lado a lado, sem o início da letra —
     cabe muito mais com a letra maior. **Detalhado** volta ao mapa completo.
   - **✂ Partes**: em cada coluna, escolha só as partes que você toca no medley (ex.: Refrão e Solo).
     As outras somem da tela, a letra cresce, e a dica de virada passa a usar o fim da última parte
     escolhida e o começo da primeira parte da próxima música.
   - O modo compacto também pode ser usado numa música sozinha (**Aa** → Mapa compacto, ou em Ajustes).

### Como escrever tempos e repetições (opcional)

| Escreva | Significa |
|---|---|
| (nada) | cada acorde = 1 compasso |
| `Em:2` | Em por 2 tempos (`G:8` = 2 compassos) |
| `\| G \| D Em \| C . . D \|` | barras de compasso; acordes no mesmo compasso dividem o compasso; cada `.` = +1 tempo |
| `%` dentro de `\| \|` | repete o compasso anterior |
| `[Refrão] (2x)` | repete a seção |
| linha terminando em `(2x)` | repete a linha (na última linha do parágrafo, repete o parágrafo) |
| linha `Tom: A` antes de uma seção | mudança de tom a partir dali |
| `[G]Toda [D]terra` | formato ChordPro também funciona |

---

## Publicar na Cloudflare (uma vez)

O app é um **Cloudflare Worker** que serve os arquivos de `public/` e guarda as cifras num banco **D1**.
Tudo cabe no plano gratuito.

### Opção A — pelo painel, sem terminal (recomendado)

1. Em <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Import a repository**.
2. Conecte o GitHub e escolha `carlooswillian/cifras-app-v2` (branch `main` depois do merge).
3. Deixe os comandos padrão (deploy: `npx wrangler deploy`) e clique em **Deploy**.
   O banco D1 `cifras-db` é criado automaticamente no primeiro deploy, e as tabelas na primeira sincronização.
4. No Worker criado → **Settings** → **Variables and Secrets** → **Add**:
   tipo **Secret**, nome `APP_PASSWORD`, valor = a senha que você quiser → **Deploy**.
5. Abra o endereço `https://cifras-app-v2.<seu-subdominio>.workers.dev` no tablet → **Ajustes** → digite a senha.
6. No tablet: menu do navegador → **Adicionar à tela de início** (abre como app, em tela cheia).

Depois disso, cada alteração enviada ao GitHub publica sozinha.

### Opção B — pelo terminal

```bash
npm install
npx wrangler login
npx wrangler deploy                    # cria o Worker e o banco D1
npx wrangler secret put APP_PASSWORD   # define a senha
```

> Se o seu wrangler não criar o banco sozinho: `npx wrangler d1 create cifras-db` e copie o
> `database_id` mostrado para o `wrangler.jsonc`.

### Trazer as músicas da versão antiga

No app novo → **Ajustes** → **Importar da versão antiga** (a URL do Google Apps Script já vem
preenchida) → **Importar músicas antigas**. A marcação antiga de tempos `Bm(4)` vira `Bm:4`.

> **Importante:** os repositórios são públicos e a URL antiga não tem senha — qualquer pessoa
> poderia apagar suas músicas por ela. Depois de importar, **arquive a implantação** do Apps Script
> (Apps Script → Implantar → Gerenciar implantações → Arquivar).

---

## Desenvolvimento

```bash
npm install
npm test            # testes da parte musical (node --test)
echo 'APP_PASSWORD=teste' > .dev.vars
npm run dev         # http://localhost:8787 com banco D1 local
```

Estrutura:

```
public/            o app (HTML/CSS/JS puro, sem build) — PWA offline
  js/music/        lógica musical pura e testada (acordes, tons, graus, leitura da cifra, mapa)
  js/ui/           desenho do mapa/letra, ajuste em 1 página, "tocar junto"
  js/store.js      banco local (IndexedDB) + sincronização com o Worker
src/worker.js      Worker da Cloudflare: /api/health e /api/sync (D1, senha via APP_PASSWORD)
test/              testes + cifras de exemplo
```

A versão antiga (arquivo único `index.html`) continua no branch `main` e no histórico do Git.
