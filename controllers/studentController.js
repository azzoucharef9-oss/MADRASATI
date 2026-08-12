"use strict";

const { PrismaClient, Prisma } = require("@prisma/client");
const { normalizeParentPhone } = require("../utils/phone");

const prisma = new PrismaClient();

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const PAYMENT_STAGES = new Set(["PAID", "UNPAID", "PROMISED"]);
const MAX_AMOUNT_DUE = 10_000_000;

class RequestValidationError extends Error {}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Parse an optional URL query value as a positive safe integer. The page-size
 * ceiling prevents clients from bypassing the pagination contract.
 */
function parsePositiveInteger(value, fallback, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === "") {
    return fallback;
  }

  if (Array.isArray(value) || !/^\d+$/.test(String(value))) {
    throw new RequestValidationError(`${label} يجب أن يكون رقماً صحيحاً موجباً.`);
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new RequestValidationError(
      `${label} يجب أن يكون بين 1 و${maximum.toLocaleString("en-US")}.`
    );
  }

  return parsed;
}

function parsePagination(query) {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE, "رقم الصفحة");
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT, "حجم الصفحة", MAX_LIMIT);
  const skip = (page - 1) * limit;

  if (!Number.isSafeInteger(skip)) {
    throw new RequestValidationError("رقم الصفحة كبير جداً.");
  }

  return { page, limit, skip };
}

/** POST /api/students/register — public student registration. */
async function registerStudent(req, res) {
  console.log('Register student request body:', req.body);
  try {
    const studentName = normalizeText(req.body?.studentName);
    const parentPhone = normalizeParentPhone(req.body?.parentPhone);
    const level = normalizeText(req.body?.level);

    if (!studentName || !parentPhone || !level) {
      return res.status(400).json({
        error: "اسم التلميذ ورقم هاتف الولي والمستوى الدراسي حقول مطلوبة.",
      });
    }

    const existingStudent = await prisma.student.findUnique({
      where: { parentPhone },
      select: { id: true },
    });

    if (existingStudent) {
      return res.status(400).json({
        error: "رقم هاتف الولي مسجل بالفعل.",
      });
    }

    const student = await prisma.student.create({
      data: {
        studentName,
        parentPhone,
        level,
        paymentStatus: false,
        paymentStage: "UNPAID",
        amountDue: null,
        mathEnrollment: true,
        physicsEnrollment: true,
        liveAccessEnabled: false,
        mathNote: "",
        physicsNote: "",
      },
    });

    return res.status(201).json({
      status: "success",
      data: student,
    });
  } catch (error) {
    // A concurrent registration can still race the pre-check; retain the same
    // client-safe response for Prisma's unique constraint violation.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return res.status(400).json({ error: "رقم هاتف الولي مسجل بالفعل." });
    }

    console.error("Student registration failed:", error);
    return res.status(500).json({ error: "تعذر تسجيل التلميذ حالياً." });
  }
}

/** GET /api/students/parent/:phone — ownership is enforced by middleware. */
async function getStudentForParent(req, res) {
  try {
    const parentPhone = normalizeParentPhone(req.params.phone);
    const student = await prisma.student.findUnique({
      where: { parentPhone },
    });

    if (!student) {
      return res.status(404).json({ error: "رقم الهاتف غير مسجل." });
    }

    return res.status(200).json(student);
  } catch (error) {
    console.error("Parent student lookup failed:", error);
    return res.status(500).json({ error: "تعذر تحميل بيانات التلميذ حالياً." });
  }
}

/**
 * GET /api/students/level/:level?page=1&limit=50
 *
 * Returns a stable, bounded teacher roster page and total count metadata. Both
 * database operations use the same level condition and run concurrently.
 */
async function getStudentsByLevel(req, res) {
  try {
    const level = normalizeText(req.params.level);
    if (!level) {
      return res.status(400).json({ error: "المستوى الدراسي مطلوب." });
    }

    const { page, limit, skip } = parsePagination(req.query);
    const where = { level };

    const [totalRecords, students] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return res.status(200).json({
      status: "success",
      data: students,
      meta: {
        totalRecords,
        currentPage: page,
        totalPages: Math.ceil(totalRecords / limit),
        limit,
      },
    });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return res.status(400).json({ error: error.message });
    }

    console.error("Paginated level roster lookup failed:", error);
    return res.status(500).json({ error: "تعذر تحميل قائمة التلاميذ حالياً." });
  }
}

/** PUT /api/students/:id — teacher-only authorization is enforced by middleware. */
async function updateStudentStatusAndNotes(req, res) {
  try {
    const { id } = req.params;
    const {
      paymentStage,
      amountDue,
      mathEnrollment,
      physicsEnrollment,
      liveAccessEnabled,
      mathNote,
      physicsNote,
    } = req.body || {};
    const normalizedAmount = amountDue === null || amountDue === "" ? null : Number(amountDue);

    if (
      !PAYMENT_STAGES.has(paymentStage) ||
      (normalizedAmount !== null &&
        (!Number.isSafeInteger(normalizedAmount) ||
          normalizedAmount < 0 ||
          normalizedAmount > MAX_AMOUNT_DUE)) ||
      typeof mathEnrollment !== "boolean" ||
      typeof physicsEnrollment !== "boolean" ||
      (!mathEnrollment && !physicsEnrollment) ||
      typeof liveAccessEnabled !== "boolean" ||
      typeof mathNote !== "string" ||
      typeof physicsNote !== "string"
    ) {
      return res.status(400).json({
        error: "بيانات الاشتراك والدفع والمبلغ وصلاحية الحصة أو الملاحظات غير صحيحة. يجب اختيار مادة واحدة على الأقل.",
      });
    }

    const student = await prisma.student.update({
      where: { id },
      data: {
        paymentStatus: paymentStage === "PAID",
        paymentStage,
        amountDue: normalizedAmount,
        mathEnrollment,
        physicsEnrollment,
        liveAccessEnabled,
        mathNote: mathNote.trim(),
        physicsNote: physicsNote.trim(),
      },
    });

    return res.status(200).json({
      status: "success",
      data: student,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    console.error("Student update failed:", error);
    return res.status(500).json({ error: "تعذر تحديث بيانات التلميذ حالياً." });
  }
}

module.exports = {
  registerStudent,
  getStudentForParent,
  getStudentsByLevel,
  updateStudentStatusAndNotes,
};
