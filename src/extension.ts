import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { execFile } from "child_process";

/** Som principal em erros (diagnostics, terminal, task, debug). */
const CAVALO_SOUND = "cavalo.mp3" as const;
/** A cada 10 execuções de erro, toca um desses em vez do cavalo. */
const OTHERS_SOUNDS = ["aii-mamae.mp3", "aaaai.mp3"] as const;
/** Som usado no comando "Testar Som (ELE GOSTA!)". */
const TEST_SOUND = "ele-gosta.mp3" as const;

const EVERY_N_PLAY_OTHER = 10;

function getConfig() {
  const cfg = vscode.workspace.getConfiguration("cavaloSound");
  return {
    enabled: cfg.get("enabled", true),
    playOnDiagnosticsError: cfg.get("playOnDiagnosticsError", true),
    playOnTerminalCommandFailure: cfg.get("playOnTerminalCommandFailure", true),
    playOnTaskFailure: cfg.get("playOnTaskFailure", true),
    playOnDebugFailure: cfg.get("playOnDebugFailure", true),
    soundFile: cfg.get("soundFile", "cavalo.mp3"),
    useRandom: cfg.get("useRandom", true),
    cooldownMs: cfg.get("cooldownMs", 2000),
  };
}

// ---------------------------------------------------------------------------
// Sound player — native OS (primary) + webview (fallback)
// ---------------------------------------------------------------------------
class SoundPlayer {
  private _extensionUri: vscode.Uri;
  private _lastPlayTime = 0;
  private _errorPlayCount = 0;
  private _activeProcess: import("child_process").ChildProcess | undefined;
  private _panel: vscode.WebviewPanel | undefined;
  private _disposeTimer: ReturnType<typeof setTimeout> | undefined;
  private _outputChannel: vscode.OutputChannel;

  constructor(extensionUri: vscode.Uri, outputChannel: vscode.OutputChannel) {
    this._extensionUri = extensionUri;
    this._outputChannel = outputChannel;
  }

  /**
   * Toca o som. Para teste (comando ELE GOSTA) usa TEST_SOUND; para erros, a cada
   * EVERY_N_PLAY_OTHER execuções toca um de OTHERS_SOUNDS, senão CAVALO_SOUND.
   */
  play(reason: string, options?: { useTestSound?: boolean }): boolean {
    const cfg = getConfig();
    if (!cfg.enabled) return false;
    const now = Date.now();
    if (now - this._lastPlayTime < cfg.cooldownMs) {
      this._outputChannel.appendLine(`[CavaloSound] Cooldown — ${reason}`);
      return false;
    }
    const soundFile = options?.useTestSound
      ? TEST_SOUND
      : this._resolveSoundFileForError();
    const mediaFolder = vscode.Uri.joinPath(this._extensionUri, "media");
    const soundFilePath = path.join(mediaFolder.fsPath, soundFile);
    if (!fs.existsSync(soundFilePath)) {
      vscode.window.showWarningMessage(`Cavalo Sound: arquivo não encontrado — ${soundFile}`);
      this._outputChannel.appendLine(`[CavaloSound] Arquivo não encontrado: ${soundFilePath}`);
      return false;
    }
    this._lastPlayTime = now;
    this._outputChannel.appendLine(`[CavaloSound] CAVALO! (${soundFile}) — ${reason}`);
    this._playNative(soundFilePath, mediaFolder, soundFile);
    return true;
  }

  /** Com useRandom: a cada 10 execuções um de OTHERS_SOUNDS; senão CAVALO_SOUND. Sem useRandom: usa soundFile. */
  private _resolveSoundFileForError(): string {
    const cfg = getConfig();
    if (!cfg.useRandom) {
      return cfg.soundFile;
    }
    this._errorPlayCount++;
    if (this._errorPlayCount % EVERY_N_PLAY_OTHER === 0) {
      return OTHERS_SOUNDS[Math.floor(Math.random() * OTHERS_SOUNDS.length)];
    }
    return CAVALO_SOUND;
  }

  private _playNative(
    soundFilePath: string,
    mediaFolder: vscode.Uri,
    soundFileName: string
  ): void {
    this._killActiveProcess();
    const args = this._buildNativeArgs(soundFilePath);
    if (!args) {
      this._outputChannel.appendLine(`[CavaloSound] Sem player nativo para "${process.platform}", usando webview.`);
      this._playViaWebview(mediaFolder, soundFileName);
      return;
    }
    const { cmd, cmdArgs, cleanup } = args;
    this._activeProcess = execFile(cmd, cmdArgs, (error) => {
      this._activeProcess = undefined;
      if (cleanup) cleanup();
      if (error) {
        this._outputChannel.appendLine(`[CavaloSound] Falha nativa: ${error.message} — webview.`);
        this._playViaWebview(mediaFolder, soundFileName);
      }
    });
  }

  private _buildNativeArgs(
    filePath: string
  ): { cmd: string; cmdArgs: string[]; cleanup?: () => void } | undefined {
    switch (process.platform) {
      case "win32": {
        const tmpScript = path.join(os.tmpdir(), `cavalo-sound-${Date.now()}.ps1`);
        const scriptContent = [
          "Add-Type -AssemblyName PresentationCore",
          "$p = New-Object System.Windows.Media.MediaPlayer",
          `$p.Open([Uri]'${filePath.replace(/'/g, "''")}')`,
          "Start-Sleep -Milliseconds 200",
          "$p.Play()",
          "$t = 0",
          "while ($p.NaturalDuration.HasTimeSpan -eq $false -and $t -lt 30) { Start-Sleep -Milliseconds 100; $t++ }",
          "if ($p.NaturalDuration.HasTimeSpan) { $ms = [int]$p.NaturalDuration.TimeSpan.TotalMilliseconds + 200; Start-Sleep -Milliseconds $ms } else { Start-Sleep -Seconds 3 }",
          "$p.Close()",
        ].join("\n");
        fs.writeFileSync(tmpScript, scriptContent, "utf8");
        return {
          cmd: "powershell",
          cmdArgs: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", tmpScript],
          cleanup: () => {
            try {
              fs.unlinkSync(tmpScript);
            } catch { /* ignore */ }
          },
        };
      }
      case "darwin":
        return { cmd: "afplay", cmdArgs: [filePath] };
      case "linux":
        return { cmd: "paplay", cmdArgs: [filePath] };
      default:
        return undefined;
    }
  }

  private _killActiveProcess(): void {
    if (this._activeProcess && !this._activeProcess.killed) {
      this._activeProcess.kill();
      this._activeProcess = undefined;
    }
  }

  private _playViaWebview(mediaFolder: vscode.Uri, soundFileName: string): void {
    this._disposePanel();
    const panel = vscode.window.createWebviewPanel(
      "cavaloSoundPlayer",
      "Cavalo Sound",
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, localResourceRoots: [mediaFolder] }
    );
    const soundUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(mediaFolder, soundFileName));
    panel.webview.html = this._getWebviewHtml(soundUri);
    this._panel = panel;
    this._disposeTimer = setTimeout(() => this._disposePanel(), 10000);
    panel.webview.onDidReceiveMessage(
      (msg: { type: string }) => {
        if (msg.type === "ended" || msg.type === "error") this._disposePanel();
      },
      undefined,
      []
    );
    panel.onDidDispose(() => {
      if (this._disposeTimer) {
        clearTimeout(this._disposeTimer);
        this._disposeTimer = undefined;
      }
      this._panel = undefined;
    });
  }

  private _getWebviewHtml(soundUri: vscode.Uri): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>body{margin:0;overflow:hidden;background:transparent;}</style>
</head>
<body>
  <audio id="a" src="${soundUri}" autoplay></audio>
  <script>
    (function(){
      const vscode = acquireVsCodeApi();
      const audio = document.getElementById('a');
      audio.volume = 1.0;
      audio.addEventListener('ended', () => vscode.postMessage({type:'ended'}));
      audio.addEventListener('error', () => vscode.postMessage({type:'error'}));
      audio.play().catch(() => vscode.postMessage({type:'error'}));
    })();
  </script>
</body>
</html>`;
  }

  private _disposePanel(): void {
    if (this._disposeTimer) {
      clearTimeout(this._disposeTimer);
      this._disposeTimer = undefined;
    }
    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
  }

  dispose(): void {
    this._killActiveProcess();
    this._disposePanel();
  }
}

// ---------------------------------------------------------------------------
// Diagnostics — toca quando a contagem de erros *aumenta*
// ---------------------------------------------------------------------------
class DiagnosticsWatcher {
  private _player: SoundPlayer;
  private _outputChannel: vscode.OutputChannel;
  private _disposable: vscode.Disposable;
  private _previousErrorCount = 0;

  constructor(player: SoundPlayer, outputChannel: vscode.OutputChannel) {
    this._player = player;
    this._outputChannel = outputChannel;
    this._previousErrorCount = this._countErrors();
    this._disposable = vscode.languages.onDidChangeDiagnostics(() => this._onDiagnosticsChanged());
  }

  reset(): void {
    this._previousErrorCount = 0;
    this._outputChannel.appendLine("[CavaloSound] Contador de erros resetado.");
  }

  private _onDiagnosticsChanged(): void {
    const cfg = getConfig();
    if (!cfg.enabled || !cfg.playOnDiagnosticsError) return;
    const current = this._countErrors();
    if (current > this._previousErrorCount) {
      this._player.play(`erros de diagnóstico (${this._previousErrorCount} → ${current})`);
    }
    this._previousErrorCount = current;
  }

  private _countErrors(): number {
    let count = 0;
    for (const [, diagnostics] of vscode.languages.getDiagnostics()) {
      for (const d of diagnostics) {
        if (d.severity === vscode.DiagnosticSeverity.Error) count++;
      }
    }
    return count;
  }

  dispose(): void {
    this._disposable.dispose();
  }
}

// ---------------------------------------------------------------------------
// Terminal shell execution (shell integration)
// ---------------------------------------------------------------------------
class TerminalShellExecutionWatcher {
  private _disposable: vscode.Disposable;

  constructor(
    private _player: SoundPlayer,
    private _outputChannel: vscode.OutputChannel
  ) {
    this._disposable = vscode.window.onDidEndTerminalShellExecution((e) => {
      const cfg = getConfig();
      if (!cfg.enabled || !cfg.playOnTerminalCommandFailure) return;
      if (e.exitCode !== undefined && e.exitCode !== 0) {
        this._outputChannel.appendLine(`[CavaloSound] Terminal "${e.terminal.name}" saiu com código ${e.exitCode}`);
        this._player.play(`comando no terminal saiu com código ${e.exitCode}`);
      }
    });
  }

  dispose(): void {
    this._disposable.dispose();
  }
}

// ---------------------------------------------------------------------------
// Terminal close
// ---------------------------------------------------------------------------
class TerminalWatcher {
  private _disposable: vscode.Disposable;

  constructor(
    private _player: SoundPlayer,
    private _outputChannel: vscode.OutputChannel
  ) {
    this._disposable = vscode.window.onDidCloseTerminal((terminal) => {
      const cfg = getConfig();
      if (!cfg.enabled || !cfg.playOnTaskFailure) return;
      const code = terminal.exitStatus?.code;
      if (code !== undefined && code !== 0) {
        this._outputChannel.appendLine(`[CavaloSound] Terminal "${terminal.name}" fechou com código ${code}`);
        this._player.play(`terminal fechou com código ${code}`);
      }
    });
  }

  dispose(): void {
    this._disposable.dispose();
  }
}

// ---------------------------------------------------------------------------
// Task process
// ---------------------------------------------------------------------------
class TaskProcessWatcher {
  private _disposable: vscode.Disposable;

  constructor(
    private _player: SoundPlayer,
    private _outputChannel: vscode.OutputChannel
  ) {
    this._disposable = vscode.tasks.onDidEndTaskProcess((e) => {
      const cfg = getConfig();
      if (!cfg.enabled || !cfg.playOnTaskFailure) return;
      if (e.exitCode !== 0) {
        this._outputChannel.appendLine(`[CavaloSound] Task "${e.execution.task.name}" saiu com código ${e.exitCode}`);
        this._player.play(`task falhou com código ${e.exitCode}`);
      }
    });
  }

  dispose(): void {
    this._disposable.dispose();
  }
}

// ---------------------------------------------------------------------------
// Debug session
// ---------------------------------------------------------------------------
const debugSessionExitCodes = new Map<string, number>();

class DebugWatcher {
  private _disposable: vscode.Disposable;

  constructor(
    private _player: SoundPlayer,
    private _outputChannel: vscode.OutputChannel
  ) {
    this._disposable = vscode.debug.onDidTerminateDebugSession((session) => {
      const cfg = getConfig();
      if (!cfg.enabled || !cfg.playOnDebugFailure) return;
      const exitCode = debugSessionExitCodes.get(session.id);
      debugSessionExitCodes.delete(session.id);
      if (exitCode !== undefined && exitCode !== 0) {
        this._outputChannel.appendLine(`[CavaloSound] Debug "${session.name}" encerrou com código ${exitCode}`);
        this._player.play(`debug encerrou com código ${exitCode}`);
      }
    });
  }

  dispose(): void {
    this._disposable.dispose();
  }
}

class CavaloDebugAdapterTracker implements vscode.DebugAdapterTracker {
  constructor(private _sessionId: string) {}

  onDidSendMessage(message: { type?: string; event?: string; body?: { exitCode?: number } }): void {
    if (
      message.type === "event" &&
      message.event === "exited" &&
      message.body &&
      typeof message.body.exitCode === "number"
    ) {
      debugSessionExitCodes.set(this._sessionId, message.body.exitCode);
    }
  }
}

const cavaloTrackerFactory: vscode.DebugAdapterTrackerFactory = {
  createDebugAdapterTracker(session: vscode.DebugSession) {
    return new CavaloDebugAdapterTracker(session.id);
  },
};

// ---------------------------------------------------------------------------
// Activate
// ---------------------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("Cavalo Sound");
  outputChannel.appendLine("[CavaloSound] CAVALO! Extensão ativada.");

  const player = new SoundPlayer(context.extensionUri, outputChannel);
  const diagWatcher = new DiagnosticsWatcher(player, outputChannel);
  const shellWatcher = new TerminalShellExecutionWatcher(player, outputChannel);
  const termWatcher = new TerminalWatcher(player, outputChannel);
  const taskWatcher = new TaskProcessWatcher(player, outputChannel);
  const debugWatcher = new DebugWatcher(player, outputChannel);
  const trackerDisposable = vscode.debug.registerDebugAdapterTrackerFactory("*", cavaloTrackerFactory);

  context.subscriptions.push(
    outputChannel,
    player,
    diagWatcher,
    shellWatcher,
    termWatcher,
    taskWatcher,
    debugWatcher,
    trackerDisposable,
    vscode.commands.registerCommand("cavaloSound.testSound", () => {
      vscode.window.showInformationMessage("ELE GOSTA! 🐎");
      player.play("teste manual", { useTestSound: true });
    }),
    vscode.commands.registerCommand("cavaloSound.resetErrorCount", () => {
      diagWatcher.reset();
      vscode.window.showInformationMessage("Cavalo Sound: contador de erros resetado.");
    })
  );
}

export function deactivate(): void {}
