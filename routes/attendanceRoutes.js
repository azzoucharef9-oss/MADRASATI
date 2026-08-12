"use strict";

const express = require("express");
const { verifyToken } = require("../middleware/authMiddleware");
const { getAttendanceForStudent } = require("../controllers/attendanceController");

const router = express.Router();

router.get("/student/:id", verifyToken, getAttendanceForStudent);

module.exports = router;
