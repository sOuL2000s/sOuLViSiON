const express = require('express');
const router = express.Router();
const auth = require('../middleware/authMiddleware');
const Note = require('../models/Note');

// Get all notes for user
router.get('/', auth, async (req, res) => {
    try {
        const notes = await Note.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.json(notes);
    } catch (err) {
        res.status(500).send("Server error");
    }
});

// Create note
router.post('/', auth, async (req, res) => {
    try {
        const { content, type } = req.body;
        const newNote = new Note({
            userId: req.user.id,
            content,
            type
        });
        const note = await newNote.save();
        res.json(note);
    } catch (err) {
        res.status(500).send("Server error");
    }
});

// Delete note
router.delete('/:id', auth, async (req, res) => {
    try {
        const note = await Note.findById(req.params.id);
        if (!note || note.userId.toString() !== req.user.id) {
            return res.status(404).json({ msg: "Note not found" });
        }
        await note.deleteOne();
        res.json({ msg: "Note removed" });
    } catch (err) {
        res.status(500).send("Server error");
    }
});

// Update note (e.g. mark todo as complete)
router.put('/:id', auth, async (req, res) => {
    try {
        const { content, completed } = req.body;
        let note = await Note.findById(req.params.id);
        if (!note || note.userId.toString() !== req.user.id) {
            return res.status(404).json({ msg: "Note not found" });
        }
        note.content = content !== undefined ? content : note.content;
        note.completed = completed !== undefined ? completed : note.completed;
        await note.save();
        res.json(note);
    } catch (err) {
        res.status(500).send("Server error");
    }
});

module.exports = router;