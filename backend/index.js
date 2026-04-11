const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(express.json());

const allowedOrigins = [process.env.FRONTEND_URL, 'http://localhost:5173'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) callback(null, true);
        else callback(new Error('Not allowed by CORS'));
    }
}));

// Request logger for debugging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url}`);
    next();
});

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("MongoDB Connected"))
    .catch(err => console.log(err));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/notes', require('./routes/notes'));

// Catch-all route for 404 debugging
app.use((req, res) => {
    res.status(404).json({ msg: `Route ${req.method} ${req.url} not found` });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));