"use strict";

const express = require("express");
const {
  registerStudent,
  getStudentForParent,
  getStudentsByLevel,
  updateStudentStatusAndNotes,
} = require("../controllers/studentController");
const {
  verifyToken,
  isTeacher,
  isParentAccessingOwnRecord,
} = require("../middleware/authMiddleware");

const router = express.Router();

// Public: a new family must be able to register before an account exists.
router.post("/register", registerStudent);

// Parent-only: the signed phone claim must equal the requested URL phone.
router.get("/parent/:phone", verifyToken, isParentAccessingOwnRecord, getStudentForParent);

// Teacher-only: roster access is never available to parent tokens.
router.get("/level/:level", verifyToken, isTeacher, getStudentsByLevel);

// Teacher-only: payment and teacher-note updates are administrative actions.
router.put("/:id", verifyToken, isTeacher, updateStudentStatusAndNotes);

module.exports = router;
