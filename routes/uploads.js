// uploads: routes registered by server.js. What it needs from server.js comes through `deps` (read when a route runs); what server.js needs from it is returned.
import multer from 'multer';
import path from 'node:path';
import { readdir } from 'node:fs/promises';

export function registerUploads(app, deps) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: deps.UPLOAD_DIR,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const base = path.basename(file.originalname, ext).toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40) || 'map';
        cb(null, `${base}-${Date.now().toString(36)}${ext}`);
      }
    }),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = file.mimetype.startsWith('image/') && deps.IMAGE_EXT.has(path.extname(file.originalname).toLowerCase());
      cb(ok ? null : Object.assign(new Error('Only PNG, JPG, WEBP or GIF images are allowed'), { status: 400 }), ok);
    }
  });

  app.post('/api/upload', upload.single('map'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file received (field name must be "map")' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  app.get('/api/maps', deps.asyncRoute(async (_req, res) => {
    const files = await deps.pictureFiles();
    res.json({ maps: files.map((f) => `/uploads/${f}`) });
  }));

  app.get('/api/tokens', deps.asyncRoute(async (_req, res) => {
    const files = (await readdir(deps.TOKEN_DIR)).filter((f) => deps.TOKEN_URL_RE.test(`/tokens/${f}`)).sort();
    res.json({ tokens: files.map((f) => `/tokens/${f}`) });
  }));
}
