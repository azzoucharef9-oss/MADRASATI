"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

const { verifyToken, isTeacher } = require("../middleware/authMiddleware");
const { createMaterial, getMaterialsByLevel } = require("../controllers/materialController");

const router = express.Router();
// UPLOAD_DIR is mounted to durable storage in production; preview falls back to public/uploads.
const uploadDirectory =
  process.env.UPLOAD_DIR || path.join(__dirname, "..", "public", "uploads");
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

const acceptedFiles = new Map([
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
]);

// Ensure disk storage is ready before Multer receives a teacher-authenticated file.
fs.mkdirSync(uploadDirectory, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadDirectory),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

function fileFilter(_req, file, callback) {
  const extension = path.extname(file.originalname).toLowerCase();
  const expectedMimeType = acceptedFiles.get(extension);

  if (!expectedMimeType || file.mimetype !== expectedMimeType) {
    return callback(
      new Error("يسمح برفع ملفات PDF أو PNG أو JPG/JPEG فقط."),
      false
    );
  }

  return callback(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    files: 1,
    fileSize: MAX_FILE_SIZE_BYTES,
  },
});

// Multer runs only after the teacher JWT and role have been checked.
router.post("/", verifyToken, isTeacher, upload.single("file"), createMaterial);
router.get("/:level", verifyToken, getMaterialsByLevel);

// Keep Multer errors in the JSON API contract rather than returning an HTML error.
router.use((error, _req, res, next) => {
  if (!error) {
    return next();
  }

  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res.status(400).json({ error: "الحد الأقصى لحجم الملف هو 10 ميغابايت." });
    }

    return res.status(400).json({ error: "تعذر معالجة الملف المرفوع." });
  }

  if (error.message === "يسمح برفع ملفات PDF أو PNG أو JPG/JPEG فقط.") {
    return res.status(400).json({ error: error.message });
  }

  return next(error);
});

module.exports = router;
