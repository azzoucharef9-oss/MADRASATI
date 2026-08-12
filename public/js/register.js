"use strict";

const registerForm = document.getElementById("register-form");
const submitBtn = document.getElementById("submit-btn");
const message = document.getElementById("register-message");
const confirmation = document.getElementById("registration-confirmation");
const confirmationText = document.getElementById("registration-confirmation-text");

function showRegistrationError(text) {
  message.textContent = text;
  message.classList.add("is-error");
  message.hidden = false;
}

if (registerForm && submitBtn && message && confirmation && confirmationText) {
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = new FormData(registerForm);
    const payload = {
      studentName: String(formData.get("studentName") || "").trim(),
      parentPhone: String(formData.get("parentPhone") || "").trim(),
      level: String(formData.get("level") || "").trim(),
    };

    if (!payload.studentName || !payload.parentPhone || !payload.level) {
      showRegistrationError("يرجى ملء جميع الحقول.");
      return;
    }

    message.hidden = true;
    message.textContent = "";
    message.classList.remove("is-error");
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = "جاري التسجيل...";

    try {
      const response = await fetch("/api/students/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "تعذر إتمام التسجيل.");
      }

      const registeredPhone = data?.data?.parentPhone || payload.parentPhone;
      confirmationText.textContent = `تم تأكيد تسجيل ${payload.studentName} بنجاح. سيتم نقلك الآن إلى بوابة الولي.`;
      confirmation.hidden = false;

      // The number never appears in the URL. The parent portal consumes it once
      // from the active browser session and signs in through the protected API.
      window.setTimeout(() => {
        sessionStorage.setItem("pendingParentPhone", registeredPhone);
        window.location.replace("./parent-login.html?autologin=1");
      }, 1400);
    } catch (error) {
      console.error("Student registration failed:", error);
      showRegistrationError(error.message || "حدث خطأ في الاتصال.");
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
} else {
  console.error("Registration page markup is incomplete.");
}
