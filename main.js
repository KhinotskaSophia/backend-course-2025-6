const fs = require('fs/promises');
const { program } = require('commander');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const url = require('url');
const { formidable } = require('formidable');

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

const inventoryDB = {
    // 'uuid': { id: 'uuid', name: '...', description: '...', photoPath: '...' }
};

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', err => reject(err));
    });
}

function sendJSON(res, data, statusCode = 200) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function sendError(res, message, statusCode = 400) {
    sendJSON(res, { error: message }, statusCode);
}

function itemToClient(item) {
    const clientItem = { ...item };
    if (clientItem.photoPath) {
        clientItem.photoUrl = `/inventory/${clientItem.id}/photo`;
    }
    delete clientItem.photoPath; 
    return clientItem;
}

async function startServer() {
    await setupCache();

    const server = http.createServer(async (req, res) => {
        const { pathname, query } = url.parse(req.url, true);
        const method = req.method;
        const originalWriteHead = res.writeHead;

        res.writeHead = (statusCode, headers) => {
            console.log(`[${new Date().toISOString()}] ${method} ${req.url} - ${statusCode}`);
            originalWriteHead.apply(res, [statusCode, headers]);
        };

        const inventoryRegex = /^\/inventory\/([a-zA-Z0-9-]+)$/;
        const photoRegex = /^\/inventory\/([a-zA-Z0-9-]+)\/photo$/;

        try {
            if (pathname === '/RegisterForm.html' && method === 'GET') {
                try {
                    const filePath = path.join(__dirname, 'RegisterForm.html');
                    const fileContent = await fs.readFile(filePath);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(fileContent);
                } catch (err) {
                    sendError(res, 'RegisterForm.html not found', 404);
                }
            
            } else if (pathname === '/SearchForm.html' && method === 'GET') {
                try {
                    const filePath = path.join(__dirname, 'SearchForm.html');
                    const fileContent = await fs.readFile(filePath);
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(fileContent);
                } catch (err) {
                    sendError(res, 'SearchForm.html not found', 404);
                }

            } else if (pathname === '/register' && method === 'POST') {
                const form = formidable({ 
                    uploadDir: options.cache, 
                    keepExtensions: true,
                    maxFileSize: 10 * 1024 * 1024 // 10MB
                });

                form.parse(req, (err, fields, files) => {
                    if (err) {
                        sendError(res, 'Error parsing form data', 500);
                        return;
                    }

                    const inventory_name = Array.isArray(fields.inventory_name) 
                    ? fields.inventory_name[0] : fields.inventory_name;
                    const description = Array.isArray(fields.description) 
                    ? fields.description[0] : fields.description;
                    const photo = files.photo ? (Array.isArray(files.photo) 
                    ? files.photo[0] : files.photo) : null;

                    if (!inventory_name) {
                        if (photo) {
                            fs.unlink(photo.filepath).catch(console.error);
                        }
                        sendError(res, 'inventory_name is required', 400);
                        return;
                    }

                    const id = crypto.randomUUID();
                    const newItem = {
                        id,
                        name: inventory_name,
                        description: description || '',
                        photoPath: photo ? photo.filepath : null 
                    };

                    inventoryDB[id] = newItem;
                    console.log('Registered new item:', newItem);
                    sendJSON(res, itemToClient(newItem), 201); 
                });

            } else if (pathname === '/inventory' && method === 'GET') {
                const allItems = Object.values(inventoryDB).map(itemToClient);
                sendJSON(res, allItems, 200);
            
            } else if (pathname === '/search' && method === 'GET') {
                const { id, includePhoto } = query; 

                const item = inventoryDB[id];
                if (!item) {
                    sendError(res, 'Not Found', 404);
                    return;
                }

                const clientItem = itemToClient(item);

                if (includePhoto === 'on' && clientItem.photoUrl) {
                    clientItem.description = (clientItem.description || '') + ` [Photo Link: ${clientItem.photoUrl}]`;
                }
                
                sendJSON(res, clientItem, 200);

            } else if (pathname === '/search' && method === 'POST') {
                const body = (await readBody(req)).toString();
                const params = new URLSearchParams(body);
                const id = params.get('id');
                const has_photo = params.get('has_photo'); 

                const item = inventoryDB[id];
                if (!item) {
                    sendError(res, 'Not Found', 404);
                    return;
                }

                const clientItem = itemToClient(item);

                if (has_photo === 'on' && clientItem.photoUrl) {
                    clientItem.description = (clientItem.description || '') + 
                    ` [Photo Link: ${clientItem.photoUrl}]`;
                }
                
                sendJSON(res, clientItem, 200);

            } else if (inventoryRegex.test(pathname)) {
                const match = pathname.match(inventoryRegex);
                const id = match[1];
                const item = inventoryDB[id];

                if (!item) {
                    sendError(res, 'Not Found', 404);
                    return;
                }

                if (method === 'GET') {
                    sendJSON(res, itemToClient(item), 200);

                } else if (method === 'PUT') {
                    const body = (await readBody(req)).toString();
                    const { name, description } = JSON.parse(body);

                    if (name) item.name = name;
                    if (description) item.description = description;
                    
                    inventoryDB[id] = item;
                    sendJSON(res, itemToClient(item), 200);

                } else if (method === 'DELETE') {
                    if (item.photoPath) {
                        await fs.unlink(item.photoPath).catch(err => {
                            console.error(`Failed to delete photo: ${err.message}`);
                        });
                    }
                    delete inventoryDB[id];
                    sendJSON(res, { message: `Item ${id} deleted` }, 200);

                } else {
                    sendError(res, 'Method Not Allowed', 405);
                }

            } else if (photoRegex.test(pathname)) {
                const match = pathname.match(photoRegex);
                const id = match[1];
                const item = inventoryDB[id];

                if (!item) {
                    sendError(res, 'Not Found', 404);
                    return;
                }

                if (method === 'GET') {
                    if (!item.photoPath) {
                        sendError(res, 'Photo Not Found', 404);
                        return;
                    }
                    try {
                        const photoData = await fs.readFile(item.photoPath);
                        res.writeHead(200, { 'Content-Type': 'image/jpeg' });
                        res.end(photoData);
                    } catch (readErr) {
                        sendError(res, 'Photo file not found on server', 404);
                    }

                } else if (method === 'PUT') {
                    const newPhotoData = await readBody(req);
                    if (newPhotoData.length === 0) {
                        sendError(res, 'Empty photo data', 400);
                        return;
                    }

                    if (item.photoPath) {
                        await fs.unlink(item.photoPath).catch(console.error);
                    }

                    const newPhotoPath = path.join(options.cache, `photo_${id}_${Date.now()}.jpg`);
                    await fs.writeFile(newPhotoPath, newPhotoData);
                    
                    item.photoPath = newPhotoPath;
                    sendJSON(res, { message: 'Photo updated' }, 200);
                
                } else {
                    sendError(res, 'Method Not Allowed', 405);
                }

            } else {
                sendError(res, 'Not Found', 404);
            }
        
        } catch (err) {
            console.error('Unhandled error:', err);
            sendError(res, 'Internal Server Error', 500);
        }
    });

    server.listen(options.port, options.host, () => {
        console.log(`

  Server running at http://${options.host}:${options.port}
  Cache: ${options.cache}

        `);
    });
}

startServer();