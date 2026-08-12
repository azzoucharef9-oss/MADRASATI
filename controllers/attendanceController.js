"use strict";

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET /api/attendance/student/:id
 *
 * A teacher can inspect any registered student. A parent is limited to the
 * student record whose parent phone matches the verified JWT claim.
 */
async function getAttendanceForStudent(req, res) {
  const studentId = typeof req.params.id === "string" ? req.params.id.trim() : "";

  if (!UUID_PATTERN.test(studentId)) {
    return res.status(400).json({ error: "معرّف التلميذ غير صالح." });
  }

  try {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, parentPhone: true },
    });

    if (!student) {
      return res.status(404).json({ error: "التلميذ غير موجود." });
    }

    const isTeacher = req.user?.role === "teacher";
    const isOwningParent =
      req.user?.role === "parent" &&
      typeof req.user.phone === "string" &&
      req.user.phone === student.parentPhone;

    if (!isTeacher && !isOwningParent) {
      return res.status(403).json({
        error: "لا تملك صلاحية الاطلاع على سجل حضور هذا التلميذ.",
      });
    }

    const attendances = await prisma.attendance.findMany({
      where: { studentId: student.id },
      orderBy: { joinedAt: "desc" },
      select: {
        id: true,
        level: true,
        joinedAt: true,
      },
    });

    return res.status(200).json({
      status: "success",
      data: attendances,
    });
  } catch (error) {
    console.error("Attendance retrieval failed:", error);
    return res.status(500).json({ error: "تعذر تحميل سجل الحضور حالياً." });
  }
}

module.exports = { getAttendanceForStudent };
