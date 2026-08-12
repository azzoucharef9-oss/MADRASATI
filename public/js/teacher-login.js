"use strict";

const teacherLoginForm = document.querySelector(
  "#teacher-login-form, #login-form, form"
);
const teacherPasscodeInput = document.querySelector(
  "#passcode, #teacher-passcode, input[type='password']"
);
const teacherLoginError = document.getElementById("login-error");
const teacherSubmitButton = teacherLoginForm?.querySelector(
  "button[type='submit'], input[type='submit']"
);

function setTeacherLoginError(message = "") {
  if (!teacherLoginError) {
    return;
  }

  teacherLoginError.textContent = message;
  teacherLoginError.hidden = !message;
}

function setTeacherSubmitting(isSubmitting) {
  if (!teacherSubmitButton) {
    return;
  }

  teacherSubmitButton.disabled = isSubmitting;

  if (teacherSubmitButton.tagName === "BUTTON") {
    teacherSubmitButton.textContent = isSubmitting ? "جارٍ الدخول…" : "دخول";
  }
}

function clearTeacherSession() {
  sessionStorage.removeItem("teacherToken");
  sessionStorage.removeItem("teacherAuth"); // Clears the legacy Phase 5 value.
}

async function handleTeacherLogin(event) {
  event.preventDefault();
  setTeacherLoginError();

  const passcode = teacherPasscodeInput?.value?.trim() || "";

  if (!passcode) {
    setTeacherLoginError("يرجى إدخال الرمز السري.");
    teacherPasscodeInput?.focus();
    return;
  }

  setTeacherSubmitting(true);

  try {
    const response = await fetch("/api/auth/teacher", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
      throw new Error("الرمز السري خاطئ");
    }

    if (!response.ok || !data.token) {
      throw new Error(data.error || "تعذر تسجيل الدخول. حاول مرة أخرى.");
    }

    clearTeacherSession();
    sessionStorage.setItem("teacherToken", data.token);
    sessionStorage.setItem("userRole", "teacher");
    window.location.assign("./teacher-dashboard.html");
  } catch (error) {
    console.error("Teacher JWT login failed:", error);
    setTeacherLoginError(error.message || "تعذر الاتصال بالخادم. حاول مرة أخرى.");
  } finally {
    setTeacherSubmitting(false);
  }
}

if (teacherLoginForm && teacherPasscodeInput) {
  teacherLoginForm.addEventListener("submit", handleTeacherLogin);
} else {
  console.error("Teacher login markup is missing the form or password input.");
}
