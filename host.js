import { spawn, exec } from 'child_process';
import http from 'http';

console.log("==========================================");
console.log("   UNO ONLINE MULTIPLAYER SERVER HOST");
console.log("==========================================");

console.log("\n[1/3] Starting Local Node.js Backend...");
const server = spawn('node', ['server/index.js'], { stdio: 'inherit' });

console.log("[2/3] Establishing Secure Ngrok Tunnel (Background)...");
const ngrok = spawn('ngrok', ['http', '3001', '--log=stdout'], { shell: true });

console.log("[3/3] Intercepting URL and Generating Magic Link...\n");

setTimeout(() => {
    http.get('http://127.0.0.1:4040/api/tunnels', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            try {
                const json = JSON.parse(data);
                const tunnel = json.tunnels.find(t => t.public_url.startsWith('https'));
                if (!tunnel) {
                    console.log("[ERROR] Could not find an active HTTPS tunnel. Is Ngrok authenticated?");
                    process.exit(1);
                }
                const url = tunnel.public_url;
                const fullUrl = `https://seventyxone.github.io/unogame/?server=${url}`;

                console.log("✅ SYSTEM READY!");
                console.log("==============================================================");
                console.log(" SHARE THIS LINK WITH FRIENDS TO PLAY: ");
                console.log("\n " + fullUrl + "\n");
                console.log("==============================================================");

                // Copy to clipboard (Windows specific)
                exec(`echo ${fullUrl} | clip`, (err) => {
                    if (!err) {
                        console.log("\n(The link has automatically been copied to your clipboard!)");
                    }
                });

                console.log("--------------------------------------------------------------");
                console.log(" Keep this black window open while playing.");
                console.log(" Press Ctrl+C at any time to shut down the server.");
                console.log("--------------------------------------------------------------\n");

            } catch (err) {
                console.log("[ERROR] Failed to parse Ngrok URL layout.", err.message);
            }
        });
    }).on('error', (err) => {
        console.log("[ERROR] Could not reach the local Ngrok API. Ngrok failed to start.");
    });
}, 4000);

// Cleanup child processes securely when the user hits Ctrl+C
process.on('SIGINT', () => {
    console.log("\nShutting down multiplayer servers...");
    if (server) server.kill();
    if (ngrok) ngrok.kill();
    process.exit();
});
