"use strict";

const express = require("express");
const { teacherLogin, parentLogin } = require("../controllers/authController");

const router = express.Router();

// Mounted by server.js at /api/auth.
router.post("/teacher", teacherLogin);
router.post("/parent", parentLogin);

module.exports = router;
