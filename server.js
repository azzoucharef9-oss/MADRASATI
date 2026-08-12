// server.js
// Online Tutoring Platform — Express API, static frontend, and Socket.io WebRTC signaling.
//
// WebRTC media does not pass through this server. Socket.io only relays the SDP/ICE
// messages required for each teacher <-> student peer connection.

require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const { PrismaClient } = require("@prisma/client");
const { Server } = require("socket.io");

const prisma = new PrismaClient();

const app = express();
const httpServer = http.createServer(app);

// Railway terminates TLS at its proxy. Trusting exactly one proxy is required
// for correct protocol/IP handling without trusting arbitrary forwarded headers.
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.disable("x-powered-by");
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
        "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "media-src": ["'self'", "blob:"],
        "connect-src": ["'self'", "https:", "wss:"],
        "script-src": ["'self'"],
        "object-src": ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), microphone=(self), display-capture=(self)"
  );
  next();
});

// Set CLIENT_ORIGIN to the Railway domain (and any custom domains), separated
// by commas. ENABLE_OPEN_CORS=true is a prototype-only escape hatch and must
// not be used for a production deployment handling authenticated data.
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const openCorsEnabled = process.env.ENABLE_OPEN_CORS === "true";

function isOriginAllowed(origin) {
  // Non-browser requests such as Railway health checks do not include Origin.
  return !origin || openCorsEnabled || allowedOrigins.includes(origin);
}

const corsOptions = {
  origin(origin, callback) {
    if (isOriginAllowed(origin)) {
      return callback(null, true);
    }

    return callback(new Error("Origin is not allowed by CORS policy."));
  },
  methods: ["GET", "POST", "PUT", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json({ limit: "100kb" }));

// Simple request logger
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  if (req.method === 'POST' && req.url.includes('/api/students/register')) {
    console.log('Register request body:', req.body);
  }
  next();
});

// REST API routes. Authentication is mounted before protected student routes
// so both login endpoints and resource endpoints remain available under /api.
const authRoutes = require("./routes/authRoutes");
const studentRoutes = require("./routes/studentRoutes");
const attendanceRoutes = require("./routes/attendanceRoutes");

app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/attendance", attendanceRoutes);

// Course-material uploads are intentionally disabled. Block the legacy public
// path before the general static middleware so old files cannot be downloaded.
app.use("/uploads", (_req, res) => {
  res.status(410).json({ error: "تم إيقاف ميزة المواد التعليمية." });
});

// Serve index.html, the registration flow, and the portal pages from /public.
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

const io = new Server(httpServer, {
  cors: corsOptions,
  // These values make transient network interruptions less likely to terminate
  // a classroom socket immediately. They do not affect WebRTC media streams.
  pingInterval: 25_000,
  pingTimeout: 60_000,
});

/**
 * Maps each study level to its active teacher socket ID.
 *
 * This is intentionally in-memory for the single-process deployment used in
 * this phase. If the app is horizontally scaled, replace this with a shared
 * Socket.io adapter (such as Redis) plus shared classroom state.
 */
const activeTeachersByLevel = new Map();
// Stores the subject selected for each active level: MATH or PHYSICS.
const activeSubjectByLevel = new Map();

/**
 * Tracks only active WebRTC classroom sockets, keyed by socket ID. Passive
 * parent lobby sockets are deliberately excluded because they are not peers.
 * Value shape: { role: "teacher" | "student", level: string, name: string }
 */
const users = new Map();

const MAX_LEVEL_LENGTH = 100;
const MAX_NAME_LENGTH = 120;
const MAX_CHAT_MESSAGE_LENGTH = 800;
const ACTIVE_SUBJECTS = new Set(["MATH", "PHYSICS"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Return a trimmed string, or an empty string for a non-string input. */
function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidLevel(level) {
  return level.length > 0 && level.length <= MAX_LEVEL_LENGTH;
}

function isValidActiveSubject(subject) {
  return ACTIVE_SUBJECTS.has(subject);
}

function isValidStudentName(studentName) {
  return studentName.length > 0 && studentName.length <= MAX_NAME_LENGTH;
}

function normalizeChatMessage(value) {
  const message = normalizeText(value);
  return message.length > 0 && message.length <= MAX_CHAT_MESSAGE_LENGTH ? message : "";
}

function isValidStudentId(studentId) {
  return UUID_PATTERN.test(studentId);
}

function isValidSocketId(socketId) {
  return typeof socketId === "string" && socketId.trim().length > 0;
}

/** Validate the minimum shape of a browser RTCSessionDescriptionInit object. */
function isValidSessionDescription(sdp) {
  return (
    sdp &&
    typeof sdp === "object" &&
    typeof sdp.type === "string" &&
    typeof sdp.sdp === "string" &&
    sdp.sdp.length > 0
  );
}

/**
 * A null ICE candidate is valid and represents end-of-candidates. Otherwise,
 * ensure that the object resembles RTCIceCandidateInit before relaying it.
 */
function isValidIceCandidate(candidate) {
  return (
    candidate === null ||
    (candidate &&
      typeof candidate === "object" &&
      typeof candidate.candidate === "string")
  );
}

/** Validate bounded, normalized teacher annotation data before relaying it. */
function isValidAnnotationSegment(data) {
  const coordinates = [data?.x0, data?.y0, data?.x1, data?.y1];
  const lineWidth = Number(data?.lineWidth);

  return (
    coordinates.every(
      (coordinate) =>
        Number.isFinite(Number(coordinate)) &&
        Number(coordinate) >= 0 &&
        Number(coordinate) <= 1
    ) &&
    typeof data?.color === "string" &&
    /^#[0-9a-fA-F]{6}$/.test(data.color) &&
    Number.isFinite(lineWidth) &&
    lineWidth >= 1 &&
    lineWidth <= 12
  );
}

function acknowledge(acknowledgement, payload) {
  if (typeof acknowledgement === "function") {
    acknowledgement(payload);
  }
}

function emitClassroomError(socket, event, message, acknowledgement) {
  const payload = { event, message };
  socket.emit("classroom_error", payload);
  acknowledge(acknowledgement, { ok: false, ...payload });
}

function isInLevelRoom(socket, level) {
  return Boolean(socket && socket.rooms && socket.rooms.has(level));
}

/**
 * Verify that the source and target sockets are current members of the same
 * level room. This is the key privacy boundary for direct signaling.
 */
function shareSameClassroom(sourceSocket, targetSocket, level) {
  return (
    Boolean(targetSocket) &&
    sourceSocket.data.roomLevel === level &&
    targetSocket.data.roomLevel === level &&
    isInLevelRoom(sourceSocket, level) &&
    isInLevelRoom(targetSocket, level)
  );
}

function resetClassroomData(socket, level) {
  if (socket.data.roomLevel === level) {
    socket.data.roomLevel = null;
    socket.data.role = null;
    socket.data.studentName = null;
    socket.data.studentId = null;
  }
}

/**
 * Close a class for every currently connected participant. The class-ended
 * event is emitted before sockets leave, ensuring viewer pages can react.
 */
async function closeClassroom(level, reason) {
  const participants = await io.in(level).fetchSockets();

  // Revoke authority first so no signaling event can be accepted while the
  // room is being cleaned up asynchronously.
  activeTeachersByLevel.delete(level);
  activeSubjectByLevel.delete(level);

  io.to(level).emit("class_ended", { level, reason });
  // Parent dashboards join a separate passive lobby. They receive only the
  // live-state change—not attendee data, WebRTC signals, or media.
  io.to(`${level}_lobby`).emit("live_class_ended", { level, reason });

  await Promise.all(
    participants.map(async (participant) => {
      await participant.leave(level);
      users.delete(participant.id);
      resetClassroomData(participant, level);
    })
  );

  return participants.length;
}

io.on("connection", (socket) => {
  console.info(`[Socket.io] Client connected: ${socket.id}`);

  // Socket data is server-owned after room entry and is used for authorization.
  socket.data.role = null;
  socket.data.roomLevel = null;
  socket.data.studentName = null;
  socket.data.studentId = null;
  socket.data.lobbyLevel = null;

  /**
   * Parent dashboards observe a passive room for the student's level. Lobby
   * members never join the WebRTC classroom room and receive no peer details.
   * Payload: { level }
   */
  socket.on("join_level_lobby", async (data = {}, acknowledgement) => {
    try {
      const level = normalizeText(data.level);

      if (!isValidLevel(level)) {
        return emitClassroomError(
          socket,
          "join_level_lobby",
          "المستوى الدراسي غير صالح.",
          acknowledgement
        );
      }

      if (socket.data.lobbyLevel && socket.data.lobbyLevel !== level) {
        await socket.leave(`${socket.data.lobbyLevel}_lobby`);
      }

      await socket.join(`${level}_lobby`);
      socket.data.lobbyLevel = level;

      const teacherSocketId = activeTeachersByLevel.get(level);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;
      const isClassLive = Boolean(teacherSocket && isInLevelRoom(teacherSocket, level));

      // A parent who opens the dashboard after the teacher starts must still
      // see the banner; they should not have to wait for another start event.
      const subject = activeSubjectByLevel.get(level) || null;
      if (isClassLive) {
        socket.emit("live_class_started", { level, subject });
      } else if (teacherSocketId) {
        activeTeachersByLevel.delete(level);
        activeSubjectByLevel.delete(level);
      }

      acknowledge(acknowledgement, { ok: true, level, subject, isClassLive });
    } catch (error) {
      console.error("[Socket.io] join_level_lobby failed:", error);
      emitClassroomError(
        socket,
        "join_level_lobby",
        "تعذر متابعة حالة الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Teacher starts a classroom for exactly one study level.
   * Payload: { level, subject }
   */
  socket.on("teacher_start_room", async (data = {}, acknowledgement) => {
    try {
      const level = normalizeText(data.level);
      const subject = normalizeText(data.subject).toUpperCase();

      if (!isValidLevel(level)) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "المستوى الدراسي غير صالح.",
          acknowledgement
        );
      }

      if (!isValidActiveSubject(subject)) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "اختر مادة صالحة للحصة: الرياضيات أو الفيزياء.",
          acknowledgement
        );
      }

      // A socket must leave/end its current room instead of silently changing
      // role or level, which avoids orphaned classroom state.
      if (socket.data.roomLevel && socket.data.roomLevel !== level) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "أنهِ أو غادر القسم الحالي قبل بدء قسم جديد.",
          acknowledgement
        );
      }

      if (socket.data.role && socket.data.role !== "teacher") {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "هذه الجلسة منضمة بالفعل إلى القسم كتلميذ.",
          acknowledgement
        );
      }

      const currentTeacherSocketId = activeTeachersByLevel.get(level);
      const currentTeacherSocket = currentTeacherSocketId
        ? io.sockets.sockets.get(currentTeacherSocketId)
        : null;

      // At this stage a level accepts one active broadcaster. Authentication
      // middleware should later ensure that only an authenticated teacher can
      // initiate this event.
      if (currentTeacherSocket && currentTeacherSocket.id !== socket.id) {
        return emitClassroomError(
          socket,
          "teacher_start_room",
          "توجد حصة مباشرة نشطة لهذا المستوى بالفعل.",
          acknowledgement
        );
      }

      // Clear a stale mapping left by an unexpectedly terminated process/socket.
      if (!currentTeacherSocket && currentTeacherSocketId) {
        activeTeachersByLevel.delete(level);
        activeSubjectByLevel.delete(level);
      }

      await socket.join(level);
      socket.data.role = "teacher";
      socket.data.roomLevel = level;
      socket.data.studentName = null;
      activeTeachersByLevel.set(level, socket.id);
      activeSubjectByLevel.set(level, subject);
      users.set(socket.id, { role: "teacher", level, name: "الأستاذ" });

      // Notify only passive parent dashboards that observe this exact level.
      io.to(`${level}_lobby`).emit("live_class_started", { level, subject });
      socket.emit("room_ready", { level, subject, role: "teacher" });
      acknowledge(acknowledgement, { ok: true, level, subject, role: "teacher" });
      console.info(`[Socket.io] Teacher ${socket.id} started room: ${level} (${subject})`);
    } catch (error) {
      console.error("[Socket.io] teacher_start_room failed:", error);
      emitClassroomError(
        socket,
        "teacher_start_room",
        "تعذر بدء الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Student joins the live class for one level.
   * Payload: { level, studentId }. The server resolves the name and level from
   * the database; a client-supplied name is never used for attendance logging.
   */
  socket.on("student_join_room", async (data = {}, acknowledgement) => {
    try {
      const level = normalizeText(data.level);
      const studentId = normalizeText(data.studentId);

      if (!isValidLevel(level) || !isValidStudentId(studentId)) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "بيانات الالتحاق بالحصة غير صالحة.",
          acknowledgement
        );
      }

      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          studentName: true,
          level: true,
          liveAccessEnabled: true,
          mathEnrollment: true,
          physicsEnrollment: true,
        },
      });

      if (!student || student.level !== level || !isValidStudentName(student.studentName)) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "تعذر التحقق من بيانات التلميذ لهذا المستوى.",
          acknowledgement
        );
      }

      if (!student.liveAccessEnabled) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "لم تقم بالدفع ولم تخبر الأستاذ أنك ستدفع. يجب الاتصال به على الرقم 0556960950 فورًا.",
          acknowledgement
        );
      }

      const studentName = student.studentName;

      if (socket.data.roomLevel && socket.data.roomLevel !== level) {
        return emitClassroomError(
          socket,
          "student_join_room",
          "هذه الجلسة منضمة بالفعل إلى قسم آخر.",
          acknowledgement
        );
      }

      if (socket.data.role && socket.data.role !== "student") {
        return emitClassroomError(
          socket,
          "student_join_room",
          "هذه الجلسة مخصّصة للأستاذ ولا يمكنها الانضمام كتلميذ.",
          acknowledgement
        );
      }

      const teacherSocketId = activeTeachersByLevel.get(level);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;

      // Do not add students to a room without a reachable broadcaster.
      if (!teacherSocket || !isInLevelRoom(teacherSocket, level)) {
        activeTeachersByLevel.delete(level);
        activeSubjectByLevel.delete(level);
        socket.emit("room_unavailable", {
          level,
          message: "لا توجد حصة مباشرة نشطة لهذا المستوى حالياً.",
        });
        return acknowledge(acknowledgement, {
          ok: false,
          error: "لا توجد حصة مباشرة نشطة لهذا المستوى حالياً.",
        });
      }

      const activeSubject = activeSubjectByLevel.get(level);
      const isEligibleForActiveSubject =
        (activeSubject === "MATH" && student.mathEnrollment) ||
        (activeSubject === "PHYSICS" && student.physicsEnrollment);

      if (!isEligibleForActiveSubject) {
        const message =
          activeSubject === "PHYSICS"
            ? "أنت لست مؤهلًا لحضور هذه الحصة لأنها فيزياء وأنت لم تسجل في الفيزياء."
            : activeSubject === "MATH"
              ? "أنت لست مؤهلًا لحضور هذه الحصة لأنها رياضيات وأنت لم تسجل في الرياضيات."
              : "تعذر التحقق من مادة الحصة الحالية. يرجى إعادة المحاولة.";
        return emitClassroomError(socket, "student_join_room", message, acknowledgement);
      }

      const isAlreadyJoined =
        socket.data.role === "student" &&
        socket.data.roomLevel === level &&
        isInLevelRoom(socket, level);

      // A repeated join emit from the same socket must not inflate history.
      // A genuinely new connection deliberately creates a new attendance entry.
      if (!isAlreadyJoined) {
        await prisma.attendance.create({
          data: { studentId: student.id, level },
        });
      }

      await socket.join(level);
      socket.data.role = "student";
      socket.data.roomLevel = level;
      socket.data.studentName = studentName;
      socket.data.studentId = student.id;
      users.set(socket.id, { role: "student", level, name: studentName, studentId: student.id });

      socket.emit("room_joined", {
        level,
        role: "student",
        teacherSocketId,
      });

      // Only the active teacher receives the student identity/socket ID.
      // Other students receive no attendee or signaling information.
      if (!isAlreadyJoined) {
        io.to(teacherSocketId).emit("student_joined", {
          socketId: socket.id,
          studentName,
        });
      }

      acknowledge(acknowledgement, {
        ok: true,
        level,
        role: "student",
        teacherSocketId,
      });
      console.info(`[Socket.io] Student ${socket.id} joined room: ${level}`);
    } catch (error) {
      console.error("[Socket.io] student_join_room failed:", error);
      emitClassroomError(
        socket,
        "student_join_room",
        "تعذر الانضمام إلى الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Relay an SDP offer from the active teacher to exactly one student.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_offer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_offer",
        "تعذر توجيه عرض الاتصال إلى هذا التلميذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_offer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay an SDP answer from a student to the active teacher only.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_answer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "student" ||
      activeTeachersByLevel.get(level) !== targetSocketId ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "teacher"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_answer",
        "تعذر توجيه رد الاتصال إلى الأستاذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_answer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay a follow-up SDP offer after a teacher has explicitly approved a
   * student's microphone. This route remains student -> active teacher only;
   * it cannot be used to contact another student.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_renegotiation_offer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "student" ||
      activeTeachersByLevel.get(level) !== targetSocketId ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "teacher"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_renegotiation_offer",
        "تعذر توجيه عرض تحديث الصوت إلى الأستاذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_renegotiation_offer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay the teacher's answer to a student's approved-microphone offer.
   * Payload: { targetSocketId, sdp }
   */
  socket.on("webrtc_renegotiation_answer", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !isValidSessionDescription(data.sdp) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "webrtc_renegotiation_answer",
        "تعذر توجيه رد تحديث الصوت إلى التلميذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_renegotiation_answer", {
      sdp: data.sdp,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Relay one ICE candidate between an active teacher and one of that level's
   * students. Student-to-student routing is rejected by design.
   * Payload: { targetSocketId, candidate }
   */
  socket.on("webrtc_ice_candidate", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    const isTeacherToStudent =
      socket.data.role === "teacher" &&
      activeTeachersByLevel.get(level) === socket.id &&
      targetSocket?.data.role === "student";

    const isStudentToTeacher =
      socket.data.role === "student" &&
      activeTeachersByLevel.get(level) === targetSocketId &&
      targetSocket?.data.role === "teacher";

    if (
      !isValidSocketId(targetSocketId) ||
      !isValidIceCandidate(data.candidate) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      (!isTeacherToStudent && !isStudentToTeacher)
    ) {
      return emitClassroomError(
        socket,
        "webrtc_ice_candidate",
        "تعذر توجيه معلومات الاتصال الشبكي.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("webrtc_ice_candidate", {
      candidate: data.candidate,
      fromSocketId: socket.id,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * A student raises a hand. The level and name in the client payload are not
   * trusted; the server uses the level/name saved at join time instead.
   * Payload: { level, studentName } (accepted for frontend compatibility)
   */
  socket.on("student_raise_hand", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const teacherSocketId = activeTeachersByLevel.get(level);
    const teacherSocket = teacherSocketId
      ? io.sockets.sockets.get(teacherSocketId)
      : null;

    if (
      socket.data.role !== "student" ||
      !isValidLevel(level || "") ||
      !teacherSocket ||
      !shareSameClassroom(socket, teacherSocket, level)
    ) {
      return emitClassroomError(
        socket,
        "student_raise_hand",
        "لا يمكنك رفع اليد خارج حصة نشطة.",
        acknowledgement
      );
    }

    io.to(teacherSocketId).emit("hand_raised", {
      socketId: socket.id,
      studentName: socket.data.studentName,
      level,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Teacher directly opens or closes a same-level student's microphone.
   * This command is independent of hand-raising, while preserving the same
   * room and role authorization boundaries.
   * Payload: { targetSocketId, enabled }
   */
  socket.on("teacher_set_mic", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);
    const enabled = data.enabled !== false;

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "teacher_set_mic",
        "تعذر تغيير حالة مايك هذا التلميذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit(
      enabled ? "permission_granted" : "microphone_revoked",
      { level }
    );
    acknowledge(acknowledgement, { ok: true, enabled });
  });

  // Kept as a compatibility route for teacher pages that are still open while
  // the new client bundle is being deployed.
  socket.on("teacher_approve_mic", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const targetSocketId = normalizeText(data.targetSocketId);
    const targetSocket = io.sockets.sockets.get(targetSocketId);

    if (
      socket.data.role !== "teacher" ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isValidSocketId(targetSocketId) ||
      !shareSameClassroom(socket, targetSocket, level) ||
      targetSocket.data.role !== "student"
    ) {
      return emitClassroomError(
        socket,
        "teacher_approve_mic",
        "تعذر منح الإذن لهذا التلميذ.",
        acknowledgement
      );
    }

    io.to(targetSocketId).emit("permission_granted", { level });
    acknowledge(acknowledgement, { ok: true, enabled: true });
  });

  /**
   * Relay a normalized canvas segment only from the active teacher to other
   * sockets in the same classroom. The payload's level is ignored deliberately:
   * the level is taken from server-owned room membership.
   */
  socket.on("draw_data", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;

    if (
      socket.data.role !== "teacher" ||
      !isValidLevel(level || "") ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isInLevelRoom(socket, level) ||
      !isValidAnnotationSegment(data)
    ) {
      return emitClassroomError(
        socket,
        "draw_data",
        "لا تملك صلاحية إرسال الشروحات إلى هذه الحصة.",
        acknowledgement
      );
    }

    const segment = {
      x0: Number(data.x0),
      y0: Number(data.y0),
      x1: Number(data.x1),
      y1: Number(data.y1),
      color: data.color,
      lineWidth: Number(data.lineWidth),
    };

    socket.to(level).emit("receive_draw_data", segment);
    acknowledge(acknowledgement, { ok: true });
  });

  /** Clear the synchronized canvas for every student in the active room. */
  socket.on("clear_board", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;

    if (
      socket.data.role !== "teacher" ||
      !isValidLevel(level || "") ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isInLevelRoom(socket, level)
    ) {
      return emitClassroomError(
        socket,
        "clear_board",
        "لا تملك صلاحية مسح لوحة هذه الحصة.",
        acknowledgement
      );
    }

    socket.to(level).emit("board_cleared");
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Send a student's question only to the active teacher for the student's
   * current room. Client-provided level and name are ignored deliberately.
   */
  socket.on("student_send_message", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const teacherSocketId = activeTeachersByLevel.get(level);
    const teacherSocket = teacherSocketId
      ? io.sockets.sockets.get(teacherSocketId)
      : null;
    const message = normalizeChatMessage(data.message);

    if (
      socket.data.role !== "student" ||
      !isValidLevel(level || "") ||
      !message ||
      !teacherSocket ||
      teacherSocket.data.role !== "teacher" ||
      !shareSameClassroom(socket, teacherSocket, level)
    ) {
      return emitClassroomError(
        socket,
        "student_send_message",
        "تعذر إرسال السؤال إلى الأستاذ. تأكد من اتصال الحصة.",
        acknowledgement
      );
    }

    // This is intentionally a direct socket emission—not a level-room broadcast.
    io.to(teacherSocketId).emit("student_message_received", {
      level,
      studentName: socket.data.studentName,
      message,
    });
    acknowledge(acknowledgement, { ok: true });
  });

  /** Broadcast an active teacher's reply to only the students in that level. */
  socket.on("teacher_send_message", (data = {}, acknowledgement) => {
    const level = socket.data.roomLevel;
    const message = normalizeChatMessage(data.message);

    if (
      socket.data.role !== "teacher" ||
      !isValidLevel(level || "") ||
      !message ||
      activeTeachersByLevel.get(level) !== socket.id ||
      !isInLevelRoom(socket, level)
    ) {
      return emitClassroomError(
        socket,
        "teacher_send_message",
        "تعذر إرسال الرسالة إلى الحصة.",
        acknowledgement
      );
    }

    socket.to(level).emit("teacher_message_received", { level, message });
    acknowledge(acknowledgement, { ok: true });
  });

  /**
   * Active teacher ends their class and removes every socket from the level.
   * Payload: { level }
   */
  socket.on("teacher_end_class", async (data = {}, acknowledgement) => {
    try {
      const level = normalizeText(data.level);

      if (
        !isValidLevel(level) ||
        socket.data.role !== "teacher" ||
        socket.data.roomLevel !== level ||
        activeTeachersByLevel.get(level) !== socket.id ||
        !isInLevelRoom(socket, level)
      ) {
        return emitClassroomError(
          socket,
          "teacher_end_class",
          "لا تملك صلاحية إنهاء هذه الحصة.",
          acknowledgement
        );
      }

      const participantCount = await closeClassroom(level, "teacher_ended");
      acknowledge(acknowledgement, { ok: true, level, participantCount });
      console.info(`[Socket.io] Teacher ${socket.id} ended room: ${level}`);
    } catch (error) {
      console.error("[Socket.io] teacher_end_class failed:", error);
      emitClassroomError(
        socket,
        "teacher_end_class",
        "تعذر إنهاء الحصة الآن. حاول مرة أخرى.",
        acknowledgement
      );
    }
  });

  /**
   * Resolve classroom departure using the presence map. A student departure is
   * sent only to the active teacher; a teacher departure alerts viewers before
   * the existing class-close path removes every remaining socket and record.
   */
  socket.on("disconnect", (reason) => {
    const user = users.get(socket.id);
    users.delete(socket.id);
    console.info(`[Socket.io] Client disconnected: ${socket.id} (${reason})`);

    if (!user) {
      return;
    }

    const { role, level, name } = user;

    if (role === "student") {
      const teacherSocketId = activeTeachersByLevel.get(level);
      const teacherSocket = teacherSocketId
        ? io.sockets.sockets.get(teacherSocketId)
        : null;

      if (teacherSocket && teacherSocket.id !== socket.id) {
        io.to(teacherSocket.id).emit("student_left", {
          socketId: socket.id,
          studentName: name,
        });
      }
      return;
    }

    if (role === "teacher" && activeTeachersByLevel.get(level) === socket.id) {
      // Notify the private classroom immediately so viewers can show a clear
      // connection-loss state before class_ended performs full room cleanup.
      io.to(level).emit("teacher_disconnected", { level });

      // `closeClassroom` is intentionally not awaited because Socket.io invokes
      // disconnect listeners synchronously. Errors are handled to avoid an
      // unhandled rejection during cleanup.
      closeClassroom(level, "teacher_disconnected").catch((error) => {
        console.error("[Socket.io] disconnect cleanup failed:", error);
      });
    }
  });
});

// Terminal Express error handler. Route-specific handlers can return useful
// 4xx responses; unexpected errors are logged server-side and never expose a
// stack trace or internal database detail to clients.
app.use((error, _req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  console.error("Unhandled Express error:", error);
  return res.status(500).json({
    status: "error",
    error: "حدث خطأ غير متوقع في الخادم. حاول مرة أخرى لاحقاً.",
  });
});

const PORT = process.env.PORT || 3000;

async function shutdown(signal) {
  console.info(`Received ${signal}; closing HTTP server and Prisma connection.`);

  httpServer.close(async (serverError) => {
    try {
      await prisma.$disconnect();
    } catch (prismaError) {
      console.error("Prisma shutdown error:", prismaError);
    }

    process.exit(serverError ? 1 : 0);
  });

  // Do not allow a hung WebRTC/Socket.io connection to prevent Railway from
  // terminating the process without Prisma cleanup.
  setTimeout(() => process.exit(1), 10_000).unref();
}

if (require.main === module) {
  httpServer.listen(PORT, () => {
    console.info(`Server listening on port ${PORT}`);
  });

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}

// Exporting makes the API and Socket.io server testable without binding a port.
module.exports = { app, httpServer, io };
