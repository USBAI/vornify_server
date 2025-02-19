const express = require('express');
const router = express.Router();
const VornifyDB = require('../vornifydb/vornifydb');

const db = new VornifyDB();

router.post('/', async (req, res) => {
    try {
        const result = await db.executeOperation(req.body);
        res.json(result);
    } catch (error) {
        console.error('Database operation error:', error);
        res.status(500).json({
            status: false,
            error: 'Internal server error'
        });
    }
});

module.exports = router; 