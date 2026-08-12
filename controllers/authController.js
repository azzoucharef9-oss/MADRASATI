"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { PrismaClient } = require("@prisma/client");
const { normalizeParentPhone } = require("../utils/phone");

const prisma = new PrismaClient();

const JWT_ISSUER = "online-tutoring-platform";
const JWT_AUDIENCE = "online-tutoring-platform-web";
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "8h";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short.");
  }

  return secret;
}

function createToken(payload) {
  return jwt.sign(payload, getJwtSecret(), {
    algorithm: "HS256",
    expiresIn: JWT_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

/** Compare passcodes without leaking matching-prefix timing information. */
function safeEquals(receivedValue, expectedValue) {
  if (typeof receivedValue !== "string" || typeof expectedValue !== "string") {
    return false;
  }

  const received = Buffer.from(receivedValue);
  const expected = Buffer.from(expectedValue);

  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}

/**
 * POST /api/auth/teacher
 * Body: { passcode }
 *
 * The prompt's development passcode remains the fallback for compatibility.
 * Set TEACHER_PASSCODE in the deployment environment instead of committing a
 * real credential to source control.
 */
async function teacherLogin(req, res) {
  try {
    const { passcode } = req.body || {};
    const expectedPasscode = process.env.TEACHER_PASSCODE || "123654789";

    if (!safeEquals(passcode, expectedPasscode)) {
      return res.status(401).json({ error: "رمز دخول الأستاذ غير صحيح." });
    }

    const token = createToken({ role: "teacher" });

    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: JWT_EXPIRES_IN,
      role: "teacher",
    });
  } catch (error) {
    console.error("Teacher login failed:", error);

    return res.status(500).json({
      error: "تعذر إتمام تسجيل الدخول حالياً. تحقق من إعدادات الخادم.",
    });
  }
}

/**
 * POST /api/auth/parent
 * Body: { parentPhone }
 *
 * The parent JWT is bound to both their phone number and the matching student
 * UUID. Protected routes use the signed phone claim to prevent URL changes
 * from exposing another child's record.
 */
async function parentLogin(req, res) {
  try {
    const parentPhone = normalizeParentPhone(req.body?.parentPhone);

    if (!parentPhone) {
      return res.status(400).json({ error: "رقم هاتف الولي مطلوب." });
    }

    const student = await prisma.student.findUnique({
      where: { parentPhone },
      select: {
        id: true,
        studentName: true,
        parentPhone: true,
        level: true,
        paymentStage: true,
        amountDue: true,
        mathEnrollment: true,
        physicsEnrollment: true,
        liveAccessEnabled: true,
      },
    });

    if (!student) {
      return res.status(404).json({ error: "رقم الهاتف غير مسجل." });
    }

    const token = createToken({
      role: "parent",
      phone: student.parentPhone,
      studentId: student.id,
    });

    return res.status(200).json({
      token,
      tokenType: "Bearer",
      expiresIn: JWT_EXPIRES_IN,
      role: "parent",
      parentPhone: student.parentPhone,
      student: {
        id: student.id,
        studentName: student.studentName,
        level: student.level,
        paymentStage: student.paymentStage,
        amountDue: student.amountDue,
        mathEnrollment: student.mathEnrollment,
        physicsEnrollment: student.physicsEnrollment,
        liveAccessEnabled: student.liveAccessEnabled,
      },
    });
  } catch (error) {
    console.error("Parent login failed:", error);

    return res.status(500).json({
      error: "تعذر إتمام تسجيل الدخول حالياً. تحقق من إعدادات الخادم.",
    });
  }
}

module.exports = {
  teacherLogin,
  parentLogin,
};
