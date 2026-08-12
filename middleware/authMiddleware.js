"use strict";

const jwt = require("jsonwebtoken");

const JWT_ISSUER = "online-tutoring-platform";
const JWT_AUDIENCE = "online-tutoring-platform-web";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET is missing or too short.");
  }

  return secret;
}

/**
 * Extracts and verifies a JWT from Authorization: Bearer <token>.
 *
 * A 401 response means the credential was not supplied or malformed. A 403
 * response means a supplied credential failed signature, validity, issuer,
 * audience, or expiration checks.
 */
function verifyToken(req, res, next) {
  const authorizationHeader = req.get("authorization") || "";
  const [scheme, token] = authorizationHeader.split(/\s+/);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return res.status(401).json({
      error: "يلزم إرسال رمز دخول صالح بصيغة Bearer للوصول إلى هذا المورد.",
    });
  }

  try {
    const decodedToken = jwt.verify(token, getJwtSecret(), {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });

    req.user = decodedToken;
    return next();
  } catch (error) {
    console.warn("JWT verification rejected:", error.name);

    return res.status(403).json({
      error: "رمز الدخول غير صالح أو منتهي الصلاحية.",
    });
  }
}

/** Restricts a route to a JWT that was issued for the teacher role. */
function isTeacher(req, res, next) {
  if (req.user?.role !== "teacher") {
    return res.status(403).json({
      error: "هذه العملية متاحة للأستاذ فقط.",
    });
  }

  return next();
}

/**
 * Restricts the parent detail endpoint to the specific phone number embedded
 * in the signed parent token. Teachers do not use this endpoint because their
 * roster access is provided through the separately protected level route.
 */
function isParentAccessingOwnRecord(req, res, next) {
  const requestedPhone = typeof req.params.phone === "string" ? req.params.phone.trim() : "";

  if (
    req.user?.role !== "parent" ||
    !req.user.phone ||
    req.user.phone !== requestedPhone
  ) {
    return res.status(403).json({
      error: "لا تملك صلاحية الوصول إلى بيانات هذا التلميذ.",
    });
  }

  return next();
}

module.exports = {
  verifyToken,
  isTeacher,
  isParentAccessingOwnRecord,
};
