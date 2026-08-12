"use strict";

const ARABIC_DIGIT_MAP = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

/**
 * Returns one stable database representation for a guardian's mobile number.
 * It accepts Arabic numerals, spaces and the common local shorthand that omits
 * the initial zero (for example, 556960950 becomes 0556960950).
 */
function normalizeParentPhone(value) {
  if (typeof value !== "string") {
    return "";
  }

  let phone = value
    .trim()
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGIT_MAP[digit])
    .replace(/[^0-9+]/g, "");

  if (phone.startsWith("+")) {
    phone = phone.slice(1);
  }

  // Algerian country-code notation: +213 5xx xxx xxx → 05xx xxx xxx.
  if (/^2135\d{8}$/.test(phone)) {
    phone = `0${phone.slice(3)}`;
  }

  // Local shorthand frequently entered without its leading zero.
  if (/^5\d{8}$/.test(phone)) {
    phone = `0${phone}`;
  }

  return phone;
}

module.exports = { normalizeParentPhone };
