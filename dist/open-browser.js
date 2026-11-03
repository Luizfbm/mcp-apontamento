import { spawn } from 'node:child_process';
export async function openExternal(url) {
    const platform = process.platform;
    const command = platform === 'win32' ? 'rundll32' : platform === 'darwin' ? 'open' : 'xdg-open';
    const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    await new Promise((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
    });
}
