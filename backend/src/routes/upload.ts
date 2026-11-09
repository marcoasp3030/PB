import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";

const router = Router();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || "5242880"); // 5MB

// Ensure upload directories exist
["avatars", "platform-assets"].forEach((bucket) => {
  const dir = path.join(UPLOAD_DIR, bucket);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const bucket = req.params.bucket;
    if (!["avatars", "platform-assets"].includes(bucket)) {
      return cb(new Error("Bucket inválido"), "");
    }
    cb(null, path.join(UPLOAD_DIR, bucket));
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;
    if (!allowed.test(file.originalname)) {
      return cb(new Error("Tipo de arquivo não permitido"));
    }
    cb(null, true);
  },
});

// ============================================
// POST /api/upload/:bucket
// ============================================
// Logos/arquivos da plataforma só por admin; avatar qualquer usuário logado
function bucketGuard(req: Request, res: Response, next: () => void) {
  if (req.params.bucket === "platform-assets" && !["admin", "superadmin"].includes(req.user!.role)) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  next();
}

router.post("/:bucket", bucketGuard, upload.single("file"), (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: "Nenhum arquivo enviado" });
  }

  const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`;
  const url = `${apiUrl}/uploads/${req.params.bucket}/${req.file.filename}`;

  res.json({
    url,
    filename: req.file.filename,
    size: req.file.size,
  });
});

// ============================================
// DELETE /api/upload/:bucket/:filename
// ============================================
router.delete("/:bucket/:filename", (req: Request, res: Response) => {
  if (!["admin", "superadmin"].includes(req.user!.role)) {
    return res.status(403).json({ error: "Acesso restrito a administradores" });
  }
  const { bucket, filename } = req.params;
  // Bloqueia path traversal (ex.: bucket "../..")
  if (!["avatars", "platform-assets"].includes(bucket) || !/^[\w.-]+$/.test(filename) || filename.startsWith(".")) {
    return res.status(400).json({ error: "Arquivo inválido" });
  }
  const filePath = path.join(UPLOAD_DIR, bucket, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Arquivo não encontrado" });
  }

  try {
    fs.unlinkSync(filePath);
    res.json({ message: "Arquivo excluído" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as uploadRouter };
