"use strict";

const parentLoginForm = document.querySelector(
  "#parent-login-form, #login-form, form"
);
const parentPhoneInput = document.querySelector(
  "#parent-phone, #parentPhone, #phone, input[type='tel'], input[name='parentPhone']"
);
const parentLoginError = document.getElementById("login-error");
const parentSubmitButton = parentLoginForm?.querySelector(
  "button[type='submit'], input[type='submit']"
);
const loginQuery = new URLSearchParams(window.location.search);
const shouldAutoLogin = loginQuery.get("autologin") === "1";

function setParentLoginError(message = "") {
  if (!parentLoginError) {
    return;
  }

  parentLoginError.textContent = message;
  parentLoginError.hidden = !message;
}

function setParentSubmitting(isSubmitting) {
  if (!parentSubmitButton) {
    return;
  }

  parentSubmitButton.disabled = isSubmitting;

  if (parentSubmitButton.tagName === "BUTTON") {
    parentSubmitButton.textContent = isSubmitting ? "جارٍ الدخول…" : "دخول";
  }
}

function clearParentSession() {
  [
    "parentToken",
    "parentPhone",
    "studentName",
    "level",
    "studentLevel",
    "currentStudent",
    "pendingParentPhone",
  ].forEach((key) => sessionStorage.removeItem(key));
}

async function handleParentLogin(event) {
  event.preventDefault();
  setParentLoginError();

  const parentPhone = parentPhoneInput?.value?.trim() || "";

  if (!parentPhone) {
    setParentLoginError("يرجى إدخال رقم هاتف الولي.");
    parentPhoneInput?.focus();
    return;
  }

  setParentSubmitting(true);

  try {
    const response = await fetch("/api/auth/parent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPhone }),
    });
    const data = await response.json().catch(() => ({}));

    if (response.status === 404) {
      throw new Error(data.error || "رقم الهاتف غير مسجل.");
    }

    if (!response.ok || !data.token) {
      throw new Error(data.error || "تعذر تسجيل الدخول. حاول مرة أخرى.");
    }

    clearParentSession();
    sessionStorage.setItem("parentToken", data.token);
    sessionStorage.setItem("parentPhone", data.parentPhone || parentPhone);
    sessionStorage.setItem("userRole", "parent");
    window.location.replace("./parent-dashboard.html");
  } catch (error) {
    console.error("Parent JWT login failed:", error);
    setParentLoginError(error.message || "تعذر الاتصال بالخادم. حاول مرة أخرى.");
  } finally {
    setParentSubmitting(false);
  }
}

if (parentLoginForm && parentPhoneInput) {
  parentLoginForm.addEventListener("submit", handleParentLogin);

  // Registration stores the verified phone only for this browser session. The
  // parent portal consumes it once, fills the form, and submits it securely.
  if (shouldAutoLogin) {
    const pendingParentPhone = sessionStorage.getItem("pendingParentPhone");
    if (pendingParentPhone) {
      sessionStorage.removeItem("pendingParentPhone");
      parentPhoneInput.value = pendingParentPhone;
      window.setTimeout(() => parentLoginForm.requestSubmit(), 120);
    }
  }
} else {
  console.error("Parent login markup is missing the form or phone input.");
}
