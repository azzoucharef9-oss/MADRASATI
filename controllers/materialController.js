"use strict";

const fs = require("fs/promises");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const MAX_TITLE_LENGTH = 160;
const MAX_LEVEL_LENGTH = 100;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidLevel(level) {
  return level.length > 0 && level.length <= MAX_LEVEL_LENGTH;
}

async function deleteUploadedFile(file) {
  if (!file?.path) {
    return;
  }

  try {
    await fs.unlink(file.path);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn("Unable to remove orphaned upload:", error.message);
    }
  }
}

/** POST /api/materials — teacher-only; Multer attaches the validated file. */
async function createMaterial(req, res) {
  const title = normalizeText(req.body?.title);
  const level = normalizeText(req.body?.level);

  if (!title || title.length > MAX_TITLE_LENGTH || !isValidLevel(level)) {
    await deleteUploadedFile(req.file);
    return res.status(400).json({
      error: "عنوان الملف والمستوى الدراسي الصحيحان مطلوبان.",
    });
  }

  if (!req.file) {
    return res.status(400).json({
      error: "اختر ملفاً بصيغة PDF أو PNG أو JPG أولاً.",
    });
  }

  try {
    const material = await prisma.material.create({
      data: {
        title,
        level,
        // The generated disk filename is the only value exposed in the public URL.
        fileUrl: `/uploads/${encodeURIComponent(req.file.filename)}`,
      },
    });

    return res.status(201).json({
      status: "success",
      data: material,
    });
  } catch (error) {
    await deleteUploadedFile(req.file);
    console.error("Material creation failed:", error);
    return res.status(500).json({ error: "تعذر حفظ معلومات الملف حالياً." });
  }
}

/**
 * GET /api/materials/:level
 *
 * Teachers may list any level. A parent can list only the level associated with
 * the parent phone in the signed JWT, so URL manipulation cannot expose another
 * class's document metadata.
 */
async function getMaterialsByLevel(req, res) {
  const level = normalizeText(req.params.level);

  if (!isValidLevel(level)) {
    return res.status(400).json({ error: "المستوى الدراسي غير صالح." });
  }

  try {
    if (req.user?.role === "parent") {
      const student = await prisma.student.findUnique({
        where: { parentPhone: req.user.phone },
        select: { level: true },
      });

      if (!student || student.level !== level) {
        return res.status(403).json({
          error: "لا تملك صلاحية الاطلاع على ملفات هذا المستوى.",
        });
      }
    } else if (req.user?.role !== "teacher") {
      return res.status(403).json({ error: "لا تملك صلاحية الاطلاع على الملفات." });
    }

    const materials = await prisma.material.findMany({
      where: { level },
      orderBy: { createdAt: "desc" },
    });

    return res.status(200).json({
      status: "success",
      data: materials,
    });
  } catch (error) {
    console.error("Material listing failed:", error);
    return res.status(500).json({ error: "تعذر تحميل الملفات حالياً." });
  }
}

module.exports = {
  createMaterial,
  getMaterialsByLevel,
};
