const express = require('express');
const router = express.Router();
const VornifyPay = require('../vornifypay/vornifypay');

// Initialize VornifyPay with your Stripe keys
const paymentService = new VornifyPay();

router.post('/', async (req, res) => {
    try {
        // Log incoming request
        console.log('Payment Request:', JSON.stringify(req.body, null, 2));

        // Process the payment using VornifyPay
        const result = await paymentService.processPayment(req.body);
        
        // Log the result
        console.log('Payment Response:', JSON.stringify(result, null, 2));
        
        // Send response
        if (result.status) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('Payment route error:', error);
        res.status(500).json({
            status: false,
            error: 'Internal server error',
            details: error.message
        });
    }
});

module.exports = router; 