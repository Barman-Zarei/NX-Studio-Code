// NX Studio Code LEGACY (MIT). node-pty 1.2 ships only ConPTY (Windows 10 1809 / build 18309+); it has no winpty, so on
// Windows 7/8 the integrated terminal could not start at all. NxPipePty is a BASIC fallback with the subset of the IPty
// interface that VS Code uses: the shell runs with piped stdio (no TTY) and the editor does local echo and line editing.
// Limits: no colours from TTY-aware programs, no full-screen/interactive programs, Ctrl+C cannot interrupt, no resize.
import { spawn, ChildProcess } from 'node:child_process';
import * as path from 'node:path';

type Listener<T> = (e: T) => void;
class Ev<T> { private l: Listener<T>[] = []; fire(e: T) { for (const f of this.l.slice()) { f(e); } } on = (f: Listener<T>) => { this.l.push(f); return { dispose: () => { this.l = this.l.filter(x => x !== f); } }; }; }

export interface NxPipePtyOptions { cwd?: string; env?: Record<string, string | undefined>; cols?: number; rows?: number }

export class NxPipePty {
	readonly pid: number; readonly process: string; cols: number; rows: number;
	private readonly child: ChildProcess; private line = ''; private esc = 0;
	private readonly data = new Ev<string>(); private readonly exit = new Ev<{ exitCode: number; signal?: number }>();
	readonly onData = this.data.on; readonly onExit = this.exit.on;

	constructor(file: string, args: string | string[], options: NxPipePtyOptions) {
		this.cols = options.cols ?? 80; this.rows = options.rows ?? 24; this.process = path.basename(file);
		const verbatim = typeof args === 'string'; // Windows command-line string
		this.child = spawn(file, verbatim ? [args as string] : (args as string[]), { cwd: options.cwd, env: options.env as NodeJS.ProcessEnv, windowsHide: true, windowsVerbatimArguments: verbatim, stdio: 'pipe' });
		this.pid = this.child.pid ?? 0;
		const out = (b: Buffer) => this.data.fire(b.toString('utf8').replace(/\r?\n/g, '\r\n'));
		this.child.stdout?.on('data', out); this.child.stderr?.on('data', out);
		this.child.on('error', (e) => { this.data.fire(`\r\nCould not start the shell: ${e.message}\r\n`); this.exit.fire({ exitCode: 1 }); });
		this.child.on('close', (code, signal) => this.exit.fire({ exitCode: code ?? 1, signal: signal ? 1 : undefined }));
		setImmediate(() => this.data.fire('[NX] This Windows version has no pseudoterminal (ConPTY). Basic terminal mode: no colours from TTY-aware programs, Ctrl+C cannot interrupt, interactive programs are not supported.\r\n'));
	}

	write(data: string | Buffer): void {
		const s = typeof data === 'string' ? data : data.toString('binary');
		for (const ch of s) {
			if (this.esc) { // swallow ESC [ ... <letter> sequences (arrows, home, end ...)
				if (this.esc === 1) { this.esc = ch === '[' || ch === 'O' ? 2 : 0; } else if (/[A-Za-z~]/.test(ch)) { this.esc = 0; }
				continue;
			}
			if (ch === '\x1b') { this.esc = 1; continue; }
			if (ch === '\r' || ch === '\n') { this.data.fire('\r\n'); this.child.stdin?.write(this.line + '\r\n'); this.line = ''; continue; }
			if (ch === '\x7f' || ch === '\b') { if (this.line.length) { this.line = this.line.slice(0, -1); this.data.fire('\b \b'); } continue; }
			if (ch === '\x03') { this.line = ''; this.data.fire('^C\r\n'); continue; }
			if (ch === '\x04') { this.child.stdin?.end(); continue; } // Ctrl+D = EOF
			if (ch < ' ') { continue; }
			this.line += ch; this.data.fire(ch);
		}
	}
	resize(cols: number, rows: number): void { this.cols = cols; this.rows = rows; }
	clear(): void { /* no console buffer to clear */ }
	pause(): void { this.child.stdout?.pause(); this.child.stderr?.pause(); }
	resume(): void { this.child.stdout?.resume(); this.child.stderr?.resume(); }
	kill(): void { try { this.child.kill(); } catch (e) { /* already gone */ } }
}
