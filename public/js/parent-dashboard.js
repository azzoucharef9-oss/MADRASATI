"use strict";

const PARENT_TOKEN_KEY = "parentToken";

const elements = {
  liveBanner: document.getElementById("live-class-banner"),
  joinLiveClassButton: document.getElementById("join-live-class-btn"),
  dashboardError: document.getElementById("dashboard-error"),
  loadingState: document.getElementById("loading-state"),
  dashboardContent: document.getElementById("dashboard-content"),
  studentAvatar: document.getElementById("student-avatar"),
  studentName: document.getElementById("student-name"),
  studentLevel: document.getElementById("student-level"),
  paymentStatus: document.getElementById("payment-status"),
  paymentAmount: document.getElementById("payment-amount"),
  enrollmentSubjects: document.getElementById("enrollment-subjects"),
  mathNote: document.getElementById("math-note"),
  physicsNote: document.getElementById("physics-note"),
  logoutButton: document.getElementById("logout-btn"),
  materialsList: document.getElementById("materials-list"),
  attendanceCount: document.getElementById("attendance-count"),
};

let socket = null;
let currentStudent = null;
let currentLobbyLevel = null;

function clearParentSession() {
  [
    PARENT_TOKEN_KEY,
    "parentPhone",
    "studentName",
    "level",
    "studentLevel",
    "studentId",
    "currentStudent",
    "student",
    "loggedInStudent",
    "userRole",
  ].forEach((key) => sessionStorage.removeItem(key));
}

function redirectToParentLogin() {
  clearParentSession();
  window.location.replace("./parent-login.html");
}

function getParentToken() {
  const token = sessionStorage.getItem(PARENT_TOKEN_KEY);

  if (!token) {
    redirectToParentLogin();
    return null;
  }

  return token;
}

function showError(message = "") {
  if (!elements.dashboardError) {
    return;
  }

  elements.dashboardError.textContent = message;
  elements.dashboardError.classList.toggle("is-visible", Boolean(message));
}

function clearError() {
  showError();
}

function setLiveClassVisible(isVisible) {
  elements.liveBanner?.classList.toggle("is-visible", Boolean(isVisible));
}

function getInitials(name) {
  const words = String(name || "تلميذ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return (
    words
      .slice(0, 2)
      .map((word) => word.charAt(0))
      .join("") || "ت"
  );
}

function renderStudent(student) {
  elements.studentAvatar.textContent = getInitials(student.studentName);
  elements.studentName.textContent = student.studentName;
  elements.studentLevel.textContent = student.level;
  elements.mathNote.textContent = student.mathNote || "لا توجد ملاحظات حالياً.";
  elements.physicsNote.textContent = student.physicsNote || "لا توجد ملاحظات حالياً.";

  const paymentStage = student.paymentStage || (student.paymentStatus ? "PAID" : "UNPAID");
  const isPaid = paymentStage === "PAID";
  const paymentLabel =
    paymentStage === "PAID"
      ? "تم الدفع بنجاح"
      : paymentStage === "PROMISED"
        ? "اتصل بالأستاذ وسيدفع"
        : "في انتظار الدفع";
  elements.paymentStatus.textContent = paymentLabel;
  elements.paymentStatus.classList.toggle("is-paid", isPaid);
  elements.paymentStatus.classList.toggle("is-unpaid", !isPaid);

  const hasAmountDue = Number.isInteger(student.amountDue);
  elements.paymentAmount.hidden = !hasAmountDue;
  elements.paymentAmount.textContent = hasAmountDue
    ? `المبلغ المطلوب: ${student.amountDue.toLocaleString("ar-DZ")} دج`
    : "";

  const enrolledSubjects = [];
  if (student.mathEnrollment) enrolledSubjects.push("الرياضيات");
  if (student.physicsEnrollment) enrolledSubjects.push("الفيزياء");
  elements.enrollmentSubjects.textContent = enrolledSubjects.length
    ? enrolledSubjects.join(" و ")
    : "لم تُحدد المواد بعد";
}

/**
 * Save the exact identity required by student-live.js immediately before any
 * viewer handoff. These fields are not authorization credentials; the parent
 * JWT remains separate and is never exposed to the viewer as a socket token.
 */
function persistStudentSession(student) {
  sessionStorage.setItem("studentName", student.studentName);
  sessionStorage.setItem("level", student.level);
  sessionStorage.setItem("studentLevel", student.level);
  sessionStorage.setItem("studentId", student.id);
  sessionStorage.setItem("currentStudent", JSON.stringify(student));
}

async function parentFetch(url, options = {}) {
  const token = getParentToken();
  if (!token) {
    throw new Error("انتهت جلسة الولي.");
  }

  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401 || response.status === 403) {
    redirectToParentLogin();
    throw new Error("انتهت الجلسة أو لا تملك صلاحية الوصول إلى هذه البيانات.");
  }

  return response;
}

function formatMaterialDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "تاريخ غير متاح";
  }

  return new Intl.DateTimeFormat("ar-DZ", { dateStyle: "medium" }).format(date);
}

function isSafeMaterialUrl(fileUrl) {
  return /^\/uploads\/[A-Za-z0-9_.%\-]+$/.test(String(fileUrl || ""));
}

function renderMaterials(materials) {
  if (!elements.materialsList) {
    return;
  }

  elements.materialsList.replaceChildren();

  if (!materials.length) {
    const empty = document.createElement("p");
    empty.className = "materials-empty";
    empty.textContent = "لا توجد ملفات حالياً";
    elements.materialsList.append(empty);
    return;
  }

  for (const material of materials) {
    if (!isSafeMaterialUrl(material.fileUrl)) {
      continue;
    }

    const link = document.createElement("a");
    link.className = "material-list-item";
    link.href = material.fileUrl;
    link.download = "";
    link.setAttribute("aria-label", `تحميل الملف: ${material.title || "ملف تعليمي"}`);

    const icon = document.createElement("span");
    icon.className = "material-list-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▣";

    const copy = document.createElement("span");
    copy.className = "material-list-copy";

    const title = document.createElement("strong");
    title.className = "material-list-title";
    title.textContent = String(material.title || "ملف تعليمي");

    const date = document.createElement("small");
    date.className = "material-list-date";
    date.textContent = `أُضيف في ${formatMaterialDate(material.createdAt)}`;

    const downloadIcon = document.createElement("span");
    downloadIcon.className = "material-download-icon";
    downloadIcon.setAttribute("aria-hidden", "true");
    downloadIcon.textContent = "↓";

    copy.append(title, date);
    link.append(icon, copy, downloadIcon);
    elements.materialsList.append(link);
  }

  if (!elements.materialsList.childElementCount) {
    renderMaterials([]);
  }
}

async function loadMaterials(level) {
  if (!elements.materialsList || !level) {
    return;
  }

  elements.materialsList.replaceChildren();
  const loading = document.createElement("p");
  loading.className = "materials-empty";
  loading.textContent = "جارٍ تحميل الملفات...";
  elements.materialsList.append(loading);

  try {
    const response = await parentFetch(`/api/materials/${encodeURIComponent(level)}`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "تعذر تحميل الملفات حالياً.");
    }

    renderMaterials(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) {
      return;
    }

    console.error("Unable to load course materials:", error);
    elements.materialsList.replaceChildren();
    const unavailable = document.createElement("p");
    unavailable.className = "materials-empty";
    unavailable.textContent = "تعذر تحميل الملفات حالياً.";
    elements.materialsList.append(unavailable);
  }
}

function updateAttendanceCount(value) {
  if (elements.attendanceCount) {
    elements.attendanceCount.textContent = String(value);
  }
}

async function loadAttendanceCount(studentId) {
  if (!studentId) {
    updateAttendanceCount(0);
    return;
  }

  try {
    const response = await parentFetch(
      `/api/attendance/student/${encodeURIComponent(studentId)}`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || "تعذر تحميل سجل الحضور.");
    }

    updateAttendanceCount(Array.isArray(payload.data) ? payload.data.length : 0);
  } catch (error) {
    if (/انتهت الجلسة/.test(error.message)) {
      return;
    }

    console.error("Unable to load attendance count:", error);
    updateAttendanceCount(0);
  }
}

function emitLobbyJoin(level) {
  if (!level || !socket?.connected) {
    return;
  }

  currentLobbyLevel = level;

  socket.emit("join_level_lobby", { level }, (response) => {
    if (!response?.ok) {
      showError(
        response?.message || response?.error || "تعذر متابعة حالة الحصة المباشرة."
      );
      return;
    }

    // The acknowledgement restores the existing state; subsequent events keep
    // it current while the parent remains on this dashboard.
    setLiveClassVisible(Boolean(response.isClassLive));
  });
}

async function loadDashboard() {
  const parentPhone = sessionStorage.getItem("parentPhone");

  if (!parentPhone || !getParentToken()) {
    return;
  }

  clearError();
  elements.loadingState.hidden = false;
  elements.dashboardContent.hidden = true;
  setLiveClassVisible(false);

  try {
    const response = await parentFetch(
      `/api/students/parent/${encodeURIComponent(parentPhone)}`,
      { headers: { Accept: "application/json" } }
    );
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload.error || payload.message || "تعذر تحميل بيانات التلميذ.");
    }

    currentStudent = payload;
    persistStudentSession(currentStudent);
    renderStudent(currentStudent);

    elements.dashboardContent.hidden = false;
    emitLobbyJoin(currentStudent.level);
    void loadAttendanceCount(currentStudent.id);
  } catch (error) {
    if (!/انتهت الجلسة/.test(error.message)) {
      console.error("Unable to load parent dashboard:", error);
      showError(error.message || "تعذر تحميل بيانات التلميذ. حاول مرة أخرى.");
    }
  } finally {
    elements.loadingState.hidden = true;
  }
}

function enterLiveClass() {
  if (!currentStudent) {
    showError("تعذر فتح الحصة قبل تحميل بيانات التلميذ.");
    return;
  }

  if (!currentStudent.liveAccessEnabled) {
    showError(
      "لم تقم بالدفع ولم تخبر الأستاذ أنك ستدفع. يجب الاتصال به على الرقم 0556960950 فورًا."
    );
    return;
  }

  persistStudentSession(currentStudent);
  window.location.assign("./student-live.html");
}

function logout() {
  clearParentSession();
  window.location.replace("./parent-login.html");
}

function initializeLobbySocket() {
  // Socket.io is loaded by parent-dashboard.html before this script.
  if (typeof io !== "function") {
    showError("تعذر متابعة حالة الحصة المباشرة حالياً.");
    return;
  }

  socket = io();

  socket.on("connect", () => {
    if (currentStudent?.level) {
      emitLobbyJoin(currentStudent.level);
    }
  });

  socket.on("live_class_started", (data = {}) => {
    if (!currentStudent || (data.level && data.level !== currentStudent.level)) {
      return;
    }

    setLiveClassVisible(true);
  });

  socket.on("live_class_ended", (data = {}) => {
    if (!currentStudent || (data.level && data.level !== currentStudent.level)) {
      return;
    }

    setLiveClassVisible(false);
  });

  socket.on("disconnect", () => {
    // Never leave an unverified positive state visible while the status socket
    // is unavailable. The ACK restores it once Socket.io reconnects.
    setLiveClassVisible(false);
  });

  socket.on("classroom_error", (data = {}) => {
    if (data.event === "join_level_lobby" && data.message) {
      showError(data.message);
    }
  });
}

if (!getParentToken()) {
  // getParentToken has already initiated the login redirect.
} else {
  elements.joinLiveClassButton?.addEventListener("click", enterLiveClass);
  elements.logoutButton?.addEventListener("click", logout);
  initializeLobbySocket();
  loadDashboard();
}
