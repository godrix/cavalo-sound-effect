# Cavalo Sound — 🐎

> **Sempre que seu código falha — *CAVALO!***

Uma extensão divertida para VS Code que toca os efeitos sonoros icônicos do programa do Rodrigo Faro sempre que algo dá errado: novos erros no código, falha no terminal ou um debug que "faleceu". Nunca mais ignore um erro sem ouvir um **"UI!"** ou um **"CAVALO, AI MAMÃEE!"**.


---

## Funcionalidades

* **Erros de Diagnóstico** — Toca quando surgem novas linhas vermelhas de erro (apenas quando a contagem aumenta).
* **Falhas no Terminal** — Toca quando um comando ou task termina com código de saída diferente de zero.
* **Crashes de Debug** — Toca quando a sessão de depuração encerra com erro. **AI MAMÃE!**
* **Cooldown** — Intervalo anti-spam configurável (padrão 2000 ms) para não fritar seu ouvido.
* **Zero Dependências** — Não precisa de pacotes externos ou players instalados no SO.

## Estrutura de Pastas

```
├── .vscode/
├── media/
│   ├── cavalo.mp3          ← som principal (CAVALO!)
│   ├── aaaai.mp3           ← Aaaai!
│   └── aii-mamae.mp3       ← Aii, mamãe!
├── src/
│   └── extension.ts
├── out/
│   └── extension.js        ← build
├── .vscodeignore
├── package.json
├── tsconfig.json
└── README.md

```

## Início Rápido

1. **Adicione o som** — Coloque seu arquivo `.mp3` / `.wav` / `.ogg` na pasta `media/`. O padrão configurado é `cavalo.mp3`.
2. **Instale as dependências:**
```bash
npm install

```


3. **Compile:**
```bash
npm run compile

```



## Desenvolvimento — Rodar com F5

1. Abra esta pasta no VS Code.
2. Pressione **F5** (*Run → Start Debugging*).
3. Uma nova janela [Extension Development Host] abrirá.
4. Provoque um erro proposital ou use o Command Palette → **Cavalo: Testar Som**.

## Configuração

Abra as **Settings** do VS Code e pesquise por `cavaloSound`:

| Configuração | Tipo | Padrão | Descrição |
| --- | --- | --- | --- |
| `cavaloSound.enabled` | boolean | `true` | Liga/Desliga a zoeira |
| `cavaloSound.playOnDiagnosticsError` | boolean | `true` | Toca nos erros do editor (sublinhados) |
| `cavaloSound.playOnTaskFailure` | boolean | `true` | Toca quando o terminal falha |
| `cavaloSound.playOnDebugFailure` | boolean | `true` | Toca se o debug crashar |
| `cavaloSound.soundFile` | string | `cavalo.mp3` | Nome do arquivo dentro de `media/` |
| `cavaloSound.cooldownMs` | number | `2000` | Milissegundos mínimos entre sons |

## Comandos

| Comando | Descrição |
| --- | --- |
| **Cavalo: Testar Som (ELE GOSTA!)** | Dispara o som manualmente |
| **Cavalo: Ativar ou desativar extensão** | Liga/desliga a extensão sem desinstalar (toggle) |
| **Cavalo: Resetar Contador de Erros** | Reseta a contagem interna de erros para zero |

## Como Funciona

| Gatilho | API Utilizada |
| --- | --- |
| Erros de Código | `vscode.languages.onDidChangeDiagnostics` — dispara se a contagem *aumenta* |
| Falha no Terminal | `vscode.window.onDidCloseTerminal` — checa se `exitStatus.code !== 0` |
| Falha no Debug | `vscode.debug.onDidTerminateDebugSession` — captura o encerramento com erro |

O áudio é reproduzido através de um `WebviewPanel` temporário que executa o som via HTML5 e se auto-destrói após o término.

---

**CAVALO!** 🔊
