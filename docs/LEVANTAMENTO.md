# Levantamento geral do app de cifras

_Revisão feita em 26/11/2026 sobre `cifras-app` (v1, "MVP 0.6.0") e `cifras-app-v2` (v2.0.3)._

## 1. Resumo

A ideia do app é ótima e as duas versões já tinham boas intuições (graus no lugar
dos acordes, blocos de progressão, medley lado a lado). O motivo de "sempre ter
falhas" não era uma coisa só, e sim a combinação de:

1. **Tudo num único arquivo de ~900 linhas**, sem testes. Cada vez que uma IA
   mexia numa parte (ex.: alinhamento da letra), quebrava outra (ex.: graus), e
   ninguém percebia até usar.
2. **Lógica musical frágil**: o reconhecimento de acordes perdia acordes comuns
   no Brasil (`C#°`, `Bº`, `C7+`, `C6/9`), e a marcação de tempos `Bm(4)`
   batia de frente com a notação brasileira (`A7(4)` é sus4, não "4 tempos").
3. **Tom/capotraste**: o tom digitado era tratado sempre como "som" e os graus
   eram calculados descontando o capo — se o texto do Cifra Club trouxesse o capo
   num formato diferente, **todos os graus saíam deslocados**.
4. **Sem informação de tempo por padrão**: os tempos só apareciam se outra IA
   reescrevesse a cifra com `(4)`, `(2)`.
5. **Backend no Google Apps Script fora do repositório**, sem senha, lento e sem
   funcionar offline.

A versão nova (esta, no `cifras-app-v2`) foi refeita do zero em módulos
pequenos, com **30 testes automáticos** da parte musical, e roda na Cloudflare.

## 2. O que existia

| | v1 (`cifras-app`) | v2 (`cifras-app-v2`) |
|---|---|---|
| Estrutura | 1 arquivo `index.html` (HTML + CSS + JS) | idem |
| Dados | Planilha via Google Apps Script (URL fixa no código) | idem |
| Visões | "Graus (otimizado)" e "Letra + acordes" | + "Letra + graus" em fonte monoespaçada |
| Medley | sugestões vindas do backend, colunas lado a lado | idem |
| Tempos | só se o texto tivesse `Acorde(n)` | idem |
| Histórico | ~50 commits "Update footer version…" | commits automáticos "Hello → Goodbye" |

Versões intermediárias da v2 (no histórico) tentaram raspar o Cifra Club via
proxy público (`allorigins`) e gerar cifras com IA (Groq) — foram abandonadas.

## 3. Problemas encontrados (com exemplos reais testados)

### 3.1 Reconhecimento de acordes
A expressão regular antiga (`CHORD_REGEX`) **não reconhecia**:

| Acorde | Resultado antigo | Consequência |
|---|---|---|
| `C#°`, `Bº`, `F#º7`, `E°` | não é acorde | a linha inteira virava **letra** e os acordes sumiam do mapa |
| `C7+` (7ª maior, comum no Brasil) | não é acorde | idem |
| `C6/9` | não é acorde | idem |

### 3.2 Graus
* Diminutos apareciam como maior/menor: `C#°` em G aparecia como **"b5"**
  (o certo é **#4°**); `Cdim` como "4"; `Bm7(b5)` como "3m" (o certo é **3°**).
* `F#m7(b5)` (o VII grau de G) aparecia como "7m".
* Notas como `Cb` e `E#` davam "?".

### 3.3 Marcação de tempos `(n)`
`A7(4)`, `D(4)`, `G(6)` eram lidos como "4/6 tempos", mas na cifra brasileira
`A7(4)` = A7 com quarta suspensa. Ou seja: **a marcação de tempo era ambígua**.

### 3.4 Tom e capotraste
* Só reconhecia `Capotraste: 2` / `Capo: 2`. O formato "Capotraste na 2ª casa"
  não era lido.
* Com `Tom: A (forma dos acordes no tom de G)` + capo não reconhecido, o app usava
  **A** como referência para acordes escritos em **G** → todos os graus errados
  (G virava "b7", C virava "b3", D virava "4"...).

### 3.5 Estrutura da música
* No modo graus, seções com o mesmo nome eram mostradas **só uma vez** — a ordem
  da música (Intro → Verso → Refrão → …) se perdia, e um último refrão
  diferente (ex.: modulado) ficava escondido.
* A quebra em blocos era sempre de 4 em 4 acordes, sem relação com compassos.

### 3.6 Letra + acordes (v2)
Linha de acordes com `white-space: pre` e letra com `pre-wrap`: em tela estreita a
letra quebrava e os acordes não → desalinhamento.

### 3.7 Backend e segurança
* O código do Apps Script **não está no repositório** (não dá para revisar).
* **Os dois repositórios são públicos** e a URL do Apps Script está no código, sem
  senha: qualquer pessoa que leia o código consegue listar, alterar e **apagar**
  suas cifras. Recomendação: depois de migrar, **desative a implantação** do Apps
  Script (Apps Script → Implantar → Gerenciar implantações → Arquivar).
* A busca chamava o servidor a **cada tecla** (sem espera), e respostas antigas
  podiam sobrescrever as novas.
* Sem cache: sem internet (igreja, ensaio) o app não abria as músicas.

## 4. O que a nova versão faz (e como)

### 4.1 Arquitetura
```
public/            app (HTML/CSS/JS puro, sem etapa de build) — funciona offline (PWA)
  js/music/        lógica musical, sem nada de tela (testada com node --test)
    notes.js       notas, tons, grafia (C#/Db), relativo maior/menor
    chords.js      leitura e simplificação de acordes
    keys.js        graus, detecção de tom, campo harmônico, nomes ao transpor
    parser.js      leitura da cifra (Cifra Club / ChordPro), seções, tempos
    chart.js       "mapa": compassos, repetições, blocos únicos e forma
    transition.js  transposição/capo e dica de virada do medley
  js/ui/           desenho do mapa e da letra, ajuste em 1 página, "tocar junto"
  js/store.js      banco local (IndexedDB) + sincronização
src/worker.js      Cloudflare Worker: serve o app e a API /api/sync (banco D1)
test/              testes automáticos + cifras de exemplo
```

### 4.2 Acordes → acorde básico
Qualquer acorde é reduzido a **maior, menor ou diminuto**:
`G7M(9)→G`, `Am7(11)→Am`, `D4→D`, `C7+→C`, `F#m7(b5)→F#°`, `C#°→C#°`.
O baixo (`D/F#`) fica escondido por padrão (dá para ligar em Exibição).

### 4.3 Tom
1. Se o texto diz "forma dos acordes no tom de G", usa G.
2. Se diz "Tom: A" e tem capo 2, testa **A** e **A − 2 = G** e fica com o que
   combina com os acordes escritos.
3. Sem dica, detecta pelo campo harmônico que melhor explica os acordes
   (pesando duração, primeiro e último acorde) e decide entre maior e relativo
   menor (ex.: presença de B maior indica Em).
4. Você sempre pode fixar o tom no editor.

O **tom que soa** é sempre `tom dos acordes + capo` (+ transposição que você
escolher na tela).

### 4.4 Graus
Números no estilo Nashville (padrão): `1 2m 3m 4 5 6m 7°`, com `b7`, `b6`, `b3`
para empréstimos e `#4°`, `#5°`… para diminutos de passagem. Opção de romanos
(`I IIm IIIm IV V VIm VII°`). Tom menor: por padrão pelo **relativo maior**
(Em = 6m, igual à versão antiga), ou pela tônica (Em = 1m).

### 4.5 Tempos de cada acorde
* **Sem marcação, cada acorde vale 1 compasso** (4 tempos em 4/4).
* Na tela da música, botão **⏱ Tempos**: toque no acorde e escolha 1, 2, 3, 4,
  6, 8… tempos (ou "linha inteira"). O app grava na cifra como `Em:2`, sem
  desalinhar a letra.
* Também aceita barras: `| G | D Em | C . . D |` (acordes no mesmo compasso
  dividem o compasso; cada `.` é mais um tempo) e `%` (repete o compasso).
* Cada acorde mostra **bolinhas = tempos**; acordes longos atravessam compassos
  (aparece "—" na continuação).
* Compassos 3/4, 2/4, 6/8 e 12/8.

### 4.6 Mapa em uma página
* Topo: **campo harmônico** do tom (1=G, 2m=Am…) e a **forma** da música em
  chips coloridos (Intro › 1ª Parte › Refrão ×2 › …).
* Seções com os mesmos acordes viram **um bloco só** (ex.: "Primeira Parte ·
  Segunda Parte"); linhas repetidas viram "×2"; trechos repetidos viram ":‖ ×2".
* Mudança de tom no meio (linha `Tom: A` ou refrão repetido mais alto) é
  detectada e marcada ("Tom F# (sobe 1 tom)").
* O app escolhe **fonte e número de colunas** para caber tudo na tela, sem
  quebrar linhas de até 4 compassos. Funciona em paisagem e retrato.

### 4.7 Medley lado a lado
* Escolha as músicas (na biblioteca, "⧉ Lado a lado"), cada uma vira uma coluna
  com seu mapa ajustado à altura da tela.
* Cada coluna tem **tom e capo próprios**; "Igualar tons" leva todas para o
  campo harmônico da primeira.
* Entre uma música e outra aparece a **virada**: mesmo campo ("pode emendar
  direto") ou mudança de tom com o acorde de ponte (o 5 do novo tom), ex.:
  `G → E → A (sobe 1 tom)`.

### 4.8 Outros
* **Tocar junto**: percorre o mapa no andamento (BPM), acendendo acorde e tempo,
  com clique de metrônomo. Botão "bpm" funciona como *tap tempo*.
* Tela sempre ligada enquanto a música está aberta; tela cheia; tema escuro/claro.
* Funciona **offline**; sincroniza com a nuvem quando há internet (senha).
* Backup em arquivo (baixar/restaurar) e **importação da versão antiga**
  (converte `Bm(4)` → `Bm:4`).

## 5. Limitações conhecidas e próximos passos sugeridos

* O texto do Cifra Club não diz quantos tempos cada acorde dura — o padrão é
  1 compasso por acorde, e o ajuste é manual (mas rápido, pelo ⏱ Tempos).
* "(2x)" no fim de uma linha é interpretado como repetir **aquela linha**; se
  estiver na **última linha de um parágrafo**, repete o parágrafo inteiro. Em
  cifras ambíguas, confira o mapa.
* Ideias para depois: compartilhar medley (link só leitura) com a banda,
  pedal Bluetooth para trocar de música, exportar PDF do mapa.
