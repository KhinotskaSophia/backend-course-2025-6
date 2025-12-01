const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const http = require('http'); 
const express = require('express');
const { program } = require('commander');
const formidable = require('formidable');
const swaggerUi = require("swagger-ui-express");
const swaggerJsdoc = require("swagger-jsdoc");

const inventoryDB = {}; 

program
    .requiredOption('-h, --host <host>', 'server host')
    .requiredOption('-p, --port <port>', 'server port', parseInt)
    .requiredOption('-c, --cache <path>', 'cache directory path');

program.parse(process.argv);
const options = program.opts();

const app = express();

app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function setupCache() {
    try {
        await fs.mkdir(options.cache, { recursive: true });
        console.log(`cache directory '${options.cache}' created`);
    } catch (err) {
        console.error(`error creating cache directory: ${err.message}`);
        process.exit(1);
    }
}

function itemToClient(item) {
    const clientItem = { ...item };
    if (clientItem.photoPath) {
        clientItem.photoUrl = `/inventory/${clientItem.id}/photo`;
    }
    delete clientItem.photoPath; 
    return clientItem;
}

const swaggerDefinition = {
    openapi: '3.0.0',
    info: {
        title: 'Inventory API',
        version: '1.0.0',
        description: 'Express API for Inventory Management',
    },
    servers: [
        {
            url: `http://${options.host}:${options.port}`,
            description: 'Development server',
        },
    ],
};

const swaggerOptions = {
    swaggerDefinition,
    apis: [__filename], 
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);

app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

/**
 * @swagger
 * /RegisterForm.html:
 *  get:
 *      summary: Got Register Form
 *      description: Returns an HTML page with a registration form.
 *      responses:
 *          200:
 *              description: HTML page
 */

app.get('/RegisterForm.html', async (req, res) => {
    const filePath = path.join(__dirname, 'RegisterForm.html');
    try {
        await fs.access(filePath); 
        res.sendFile(filePath);
    } catch (err) {
        res.status(404).json({ error: 'RegisterForm.html not found' });
    }
});

/**
 * @swagger
 * /SearchForm.html:
 *  get:
 *      summary: Got Search Form
 *      description: Returns an HTML page with a search form.
 *      responses:
 *          200:
 *              description: HTML page
 */

app.get('/SearchForm.html', async (req, res) => {
    const filePath = path.join(__dirname, 'SearchForm.html');
    try {
        await fs.access(filePath);
        res.sendFile(filePath);
    } catch (err) {
        res.status(404).json({ error: 'SearchForm.html not found' });
    }
});

/**
 * @swagger
 * /register:
 *  post:
 *      summary: Register new item
 *      description: Creates a new record (multipart/form-data).
 *      requestBody:
 *          required: true
 *          content:
 *              multipart/form-data:
 *                  schema:
 *                      type: object
 *                      required:
 *                          - inventory_name
 *                      properties:
 *                          inventory_name:
 *                              type: string
 *                          description:
 *                              type: string
 *                          photo:
 *                              type: string
 *                              format: binary
 *      responses:
 *          201:
 *              description: Created
 *          400:
 *              description: Bad request
 */

app.post('/register', (req, res, next) => {
    const form = new formidable.IncomingForm({ 
        uploadDir: options.cache, 
        keepExtensions: true,
        maxFileSize: 10 * 1024 * 1024 
    });

    form.parse(req, (err, fields, files) => {
        if (err) {
            return res.status(500).json({ error: 'Error parsing form data' });
        }

        const inventory_name = Array.isArray(fields.inventory_name) ? fields.inventory_name[0] : fields.inventory_name;
        const description = Array.isArray(fields.description) ? fields.description[0] : fields.description;
        const photo = files.photo ? (Array.isArray(files.photo) ? files.photo[0] : files.photo) : null;

        if (!inventory_name) {
            if (photo) fs.unlink(photo.filepath).catch(console.error);
            return res.status(400).json({ error: 'inventory_name is required' });
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
        res.status(201).json(itemToClient(newItem));
    });
});

/**
 * @swagger
 * /inventory:
 *  get:
 *      summary: Getting a list of things
 *      responses:
 *          200:
 *              description: An array of things
 */
app.get('/inventory', (req, res) => {
    const allItems = Object.values(inventoryDB).map(itemToClient);
    res.json(allItems);
});

/**
 * @swagger
 * /inventory/{id}:
 *   get:
 *     summary: Get a single item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Item ID
 *     responses:
 *       200:
 *         description: Item object
 *       404:
 *         description: Not found
 */

app.get('/inventory/:id', (req, res) => {
    const item = inventoryDB[req.params.id];
    if (!item) return res.status(404).json({ error: 'Not Found' });
    res.json(itemToClient(item));
});

/**
 * @swagger
 * /inventory/{id}:
 *   put:
 *     summary: Update name/description
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Item ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated
 *       404:
 *         description: Not found
 */

app.put('/inventory/:id', (req, res) => {
    const id = req.params.id;
    const item = inventoryDB[id];
    if (!item) return res.status(404).json({ error: 'Not Found' });

    const { name, description } = req.body; 

    if (name) item.name = name;
    if (description) item.description = description;
    
    inventoryDB[id] = item;
    res.json(itemToClient(item));
});

/**
 * @swagger
 * /inventory/{id}:
 *   delete:
 *     summary: Delete item
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Item ID 
 *     responses:
 *       200:
 *         description: Deleted
 *       404:
 *         description: Not found
 */

app.delete('/inventory/:id', async (req, res) => {
    const id = req.params.id;
    const item = inventoryDB[id];
    if (!item) return res.status(404).json({ error: 'Not Found' });

    if (item.photoPath) {
        await fs.unlink(item.photoPath).catch(err => {
            console.error(`Failed to delete photo: ${err.message}`);
        });
    }
    delete inventoryDB[id];
    res.json({ message: `Item ${id} deleted` });
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   get:
 *     summary: Getting a photo
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Item ID 
 *     responses:
 *       200:
 *         description: Photo 
 *       404:
 *         description: Photo not found
 */

app.get('/inventory/:id/photo', async (req, res) => {
    const item = inventoryDB[req.params.id];
    if (!item) return res.status(404).json({ error: 'Not Found' });
    if (!item.photoPath) return res.status(404).json({ error: 'Photo Not Found' });

    res.sendFile(path.resolve(item.photoPath), (err) => {
        if (err) res.status(404).json({ error: 'Photo file missing on server' });
    });
});

/**
 * @swagger
 * /inventory/{id}/photo:
 *   put:
 *     summary: Photo update
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Item ID
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               photo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Photo updated
 *       404:
 *         description: Not found
 */

app.put('/inventory/:id/photo', async (req, res) => {
    const id = req.params.id;
    const item = inventoryDB[id];
    if (!item) return res.status(404).json({ error: 'Not Found' });

    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
        const newPhotoData = Buffer.concat(chunks);
        
        if (newPhotoData.length === 0) {
            return res.status(400).json({ error: 'Empty photo data' });
        }

        if (item.photoPath) {
            await fs.unlink(item.photoPath).catch(console.error);
        }

        const newPhotoPath = path.join(options.cache, `photo_${id}_${Date.now()}.jpg`);
        try {
            await fs.writeFile(newPhotoPath, newPhotoData);
            item.photoPath = newPhotoPath;
            res.json({ message: 'Photo updated' });
        } catch (e) {
            res.status(500).json({ error: 'Failed to save photo' });
        }
    });
});

app.get('/search', (req, res) => {
    const { id, includePhoto } = req.query;
    const item = inventoryDB[id];
    
    if (!item) return res.status(404).json({ error: 'Not Found' });

    const clientItem = itemToClient(item);
    if (includePhoto === 'on' && clientItem.photoUrl) {
        clientItem.description = (clientItem.description || '') + ` [Photo Link: ${clientItem.photoUrl}]`;
    }
    res.json(clientItem);
});

/**
 * @swagger
 * /search:
 *   post:
 *     summary: Search for something
 *     requestBody:
 *       required: true
 *       content:
 *         application/x-www-form-urlencoded:
 *           schema:
 *             type: object
 *             required:
 *               - id
 *             properties:
 *               id:
 *                 type: string
 *               includePhoto:
 *                 type: string
 *     responses:
 *       200:
 *         description: Found
 *       404:
 *         description: Not found
 */

app.post('/search', (req, res) => {
    const { id, has_photo } = req.body;
    
    const item = inventoryDB[id];
    if (!item) return res.status(404).json({ error: 'Not Found' });

    const clientItem = itemToClient(item);
    if (has_photo === 'on' && clientItem.photoUrl) {
        clientItem.description = (clientItem.description || '') + ` [Photo Link: ${clientItem.photoUrl}]`;
    }
    res.json(clientItem);
});

app.use((_, res) => res.sendStatus(405));

async function startServer() {
    await setupCache();
    
    app.listen(options.port, options.host, () => {
        console.log(`
  Server running at http://${options.host}:${options.port}
  Cache: ${options.cache}
  Swagger UI at http://${options.host}:${options.port}/docs
        `);
    });
}

startServer();