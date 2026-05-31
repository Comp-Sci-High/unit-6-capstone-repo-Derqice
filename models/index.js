// ─────────────────────────────────────────────────────────────────────────────
//  models/index.js  ·  All Mongoose Models for The Dial
// ─────────────────────────────────────────────────────────────────────────────

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ══════════════════════════════════════════════════════════════════════════════
//  USER
// ══════════════════════════════════════════════════════════════════════════════
const userSchema = new Schema({
  firstName:  { type: String, required: true, trim: true },
  lastName:   { type: String, required: true, trim: true },
  email:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:   { type: String },                          // null for Google OAuth users
  googleId:   { type: String },                          // null for email/password users
  role:       { type: String, enum: ['student', 'teacher'], default: 'student' },
  level:      { type: String, enum: ['A1', 'A2', 'B1', 'B2'], default: 'B1' },
  avatar:     { type: String },                          // URL to profile pic
  streak:     { type: Number, default: 0 },
  lastActive: { type: Date, default: Date.now },
defaultLanguage: { type: String, default: 'English' },
autoSave:        { type: Boolean, default: false },
autoVocab:       { type: Boolean, default: true  },
notifPrefs: {
  assignment: { type: Boolean, default: true  },
  streak:     { type: Boolean, default: true  },
  vocab:      { type: Boolean, default: false },
  level:      { type: Boolean, default: true  },
  email:      { type: Boolean, default: false },
},
}, { timestamps: true });

userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// ══════════════════════════════════════════════════════════════════════════════
//  CLASS
// ══════════════════════════════════════════════════════════════════════════════
const classSchema = new Schema({
  name:      { type: String, required: true, trim: true },
  code:      { type: String, required: true, unique: true, uppercase: true },
  teacher:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
  period:    { type: String },
  level:     { type: String, enum: ['A1', 'A2', 'B1', 'B2'], default: 'B1' },
  students:  [{ type: Schema.Types.ObjectId, ref: 'User' }],
  isActive:  { type: Boolean, default: true },
}, { timestamps: true });

classSchema.pre('save', function(next) {
  if (!this.code) {
    this.code = 'CS-' + Math.floor(1000 + Math.random() * 9000);
  }
  next();
});

// ══════════════════════════════════════════════════════════════════════════════
//  ARTICLE
// ══════════════════════════════════════════════════════════════════════════════
const articleSchema = new Schema({
  user:         { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title:        { type: String, required: true, trim: true },
  source:       { type: String, trim: true },
  originalText: { type: String },
  simplified:   { type: String, required: true },
  level:        { type: String, enum: ['A1', 'A2', 'B1', 'B2'], required: true },
  language:     { type: String, default: 'English' },
  progress:     { type: Number, default: 0, min: 0, max: 100 },
  isComplete:   { type: Boolean, default: false },
  assignedBy:   { type: Schema.Types.ObjectId, ref: 'User' },
  dueDate:      { type: Date },
}, { timestamps: true });

// ══════════════════════════════════════════════════════════════════════════════
//  VOCAB
// ══════════════════════════════════════════════════════════════════════════════
const vocabSchema = new Schema({
  user:       { type: Schema.Types.ObjectId, ref: 'User', required: true },
  word:       { type: String, required: true, trim: true },
  definition: { type: String, required: true },
  language:   { type: String, default: 'English' },
  level:      { type: String, enum: ['A1', 'A2', 'B1', 'B2'] },
  article:    { type: Schema.Types.ObjectId, ref: 'Article' },
  clickCount: { type: Number, default: 1 },
}, { timestamps: true });

vocabSchema.index({ user: 1, word: 1 }, { unique: true });

// ══════════════════════════════════════════════════════════════════════════════
//  ASSIGNMENT
// ══════════════════════════════════════════════════════════════════════════════
const assignmentSchema = new Schema({
  teacher:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  class:    { type: Schema.Types.ObjectId, ref: 'Class', required: true },
  url:      { type: String },
  title:    { type: String },
  level:    { type: String, enum: ['A1', 'A2', 'B1', 'B2'] },
  language: { type: String, default: 'English' },
  note:     { type: String },
  dueDate:  { type: Date },
  notify:   { type: Boolean, default: true },
}, { timestamps: true });

// ══════════════════════════════════════════════════════════════════════════════
//  WORD CLICK  (analytics)
// ══════════════════════════════════════════════════════════════════════════════
const wordClickSchema = new Schema({
  student:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
  class:    { type: Schema.Types.ObjectId, ref: 'Class' },
  word:     { type: String, required: true, lowercase: true },
  article:  { type: Schema.Types.ObjectId, ref: 'Article' },
}, { timestamps: true });

// ══════════════════════════════════════════════════════════════════════════════
//  EXPORTS
// ══════════════════════════════════════════════════════════════════════════════
const User       = mongoose.model('User',       userSchema);
const Class      = mongoose.model('Class',      classSchema);
const Article    = mongoose.model('Article',    articleSchema);
const Vocab      = mongoose.model('Vocab',      vocabSchema);
const Assignment = mongoose.model('Assignment', assignmentSchema);
const WordClick  = mongoose.model('WordClick',  wordClickSchema);

module.exports = { User, Class, Article, Vocab, Assignment, WordClick };