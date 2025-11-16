const fs = require('fs/promises');
const { program } = require('commander');
const http = require('http');

program
    .requiredOption('-h, --host <host>', 'server host')
    .requiredOption('-p, --port <port>', 'server port', parseInt)
    .requiredOption('-c, --cache <path>', 'cache directory path');

program.parse(process.argv);

const options = program.opts();

async function setupCache() {
    try {
        await fs.mkdir(options.cache, { recursive: true });
        console.log(`cache directory '${options.cache}' created`);
    } catch (err) {
        console.error(`error creating cache directory: ${err.message}`);
        process.exit(1);
    }
}

async function startServer() {
    await setupCache();

    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Server running!\n');
    });

    server.listen(options.port, options.host, () => {
        console.log(`

  Server running at http://${options.host}:${options.port}
  Cache: ${options.cache}

        `);
    });
}

startServer();