const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { Decimal } = require('decimal.js');

class VornifyPay {
    constructor() {
        if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PUBLIC_KEY) {
            throw new Error('Missing required Stripe configuration');
        }
        this.stripe = stripe;
        this.publicKey = process.env.STRIPE_PUBLIC_KEY;
    }

    validatePaymentData(data) {
        const required = ['amount', 'currency', 'payment_type', 'product_data'];
        const missing = required.filter(field => !data[field]);
        
        if (missing.length > 0) {
            return { 
                isValid: false, 
                error: `Missing required fields: ${missing.join(', ')}` 
            };
        }

        if (!['onetime', 'recurring'].includes(data.payment_type)) {
            return { 
                isValid: false, 
                error: 'Invalid payment_type. Must be either "onetime" or "recurring"' 
            };
        }

        return { isValid: true };
    }

    validateSubscriptionData(data) {
        const required = ['customer_email', 'price_id', 'product_data'];
        const missing = required.filter(field => !data[field]);
        
        if (missing.length > 0) {
            return { 
                isValid: false, 
                error: `Missing required fields: ${missing.join(', ')}` 
            };
        }

        return { isValid: true };
    }

    async processPayment(requestData) {
        try {
            console.log('Processing payment request:', requestData);

            const { command, data = {} } = requestData;

            switch (command) {
                case 'payment':
                    const paymentValidation = this.validatePaymentData(data);
                    if (!paymentValidation.isValid) {
                        return { status: false, error: paymentValidation.error };
                    }
                    return await this.handlePayment(data);

                case 'subscription':
                    const subscriptionValidation = this.validateSubscriptionData(data);
                    if (!subscriptionValidation.isValid) {
                        return { status: false, error: subscriptionValidation.error };
                    }
                    return await this.handleSubscription(data);

                case 'verify':
                    if (!data.payment_intent_id) {
                        return { status: false, error: 'payment_intent_id is required' };
                    }
                    return await this.verifyPayment(data);

                default:
                    return { status: false, error: 'Invalid command' };
            }
        } catch (error) {
            console.error('Payment processing error:', error);
            return { 
                status: false, 
                error: error.message,
                code: error.code || 'unknown_error'
            };
        }
    }

    async handlePayment(data) {
        const { amount, currency, payment_type, product_data } = data;
        
        try {
            const amountInCents = Math.round(new Decimal(amount).times(100).toNumber());

            const metadata = this.prepareMetadata({
                payment_type,
                ...product_data
            });

            const paymentIntent = await this.stripe.paymentIntents.create({
                amount: amountInCents,
                currency: currency.toLowerCase(),
                automatic_payment_methods: { enabled: true },
                metadata,
                description: product_data.description || `Payment for ${product_data.name}`
            });

            return {
                status: true,
                payment_intent_id: paymentIntent.id,
                client_secret: paymentIntent.client_secret,
                public_key: this.publicKey,
                amount,
                currency,
                payment_type,
                product_details: product_data
            };
        } catch (error) {
            console.error('Payment creation error:', error);
            return { status: false, error: error.message };
        }
    }

    async handleSubscription(data) {
        try {
            const { 
                customer_email, 
                price_id, 
                trial_days = 0,
                product_data 
            } = data;

            // Validate price_id format
            if (!price_id.startsWith('price_')) {
                return {
                    status: false,
                    error: 'Invalid price_id format. Must start with "price_"'
                };
            }

            try {
                // Verify the price exists
                await this.stripe.prices.retrieve(price_id);
            } catch (error) {
                return {
                    status: false,
                    error: 'Invalid price_id. Price does not exist.',
                    details: error.message
                };
            }

            // Create or get customer
            let customer;
            try {
                customer = await this.getOrCreateCustomer(customer_email, product_data);
            } catch (error) {
                return {
                    status: false,
                    error: 'Failed to create/retrieve customer',
                    details: error.message
                };
            }

            // Prepare subscription metadata
            const metadata = this.prepareMetadata({
                ...product_data,
                customer_email,
                subscription_type: 'recurring'
            });

            // Create subscription
            const subscription = await this.stripe.subscriptions.create({
                customer: customer.id,
                items: [{ price: price_id }],
                trial_period_days: trial_days,
                payment_behavior: 'default_incomplete',
                payment_settings: { 
                    save_default_payment_method: 'on_subscription',
                    payment_method_types: ['card']
                },
                metadata,
                expand: ['latest_invoice.payment_intent']
            });

            return {
                status: true,
                subscription_id: subscription.id,
                client_secret: subscription.latest_invoice.payment_intent.client_secret,
                public_key: this.publicKey,
                customer_id: customer.id,
                trial_end: subscription.trial_end,
                current_period_end: subscription.current_period_end,
                product_details: product_data
            };
        } catch (error) {
            console.error('Subscription creation error:', error);
            return {
                status: false,
                error: error.message,
                code: error.code || 'subscription_creation_failed'
            };
        }
    }

    async handleRefund(data) {
        try {
            const { payment_intent_id, amount } = data;
            const refundData = { payment_intent: payment_intent_id };

            if (amount) {
                refundData.amount = this.convertAmount(amount);
            }

            const refund = await this.stripe.refunds.create(refundData);

            return {
                status: true,
                refund_id: refund.id,
                amount: this.convertFromSmallestUnit(refund.amount),
                currency: refund.currency
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    async verifyPayment(data) {
        try {
            const { payment_intent_id } = data;
            const paymentIntent = await this.stripe.paymentIntents.retrieve(payment_intent_id);

            return {
                status: true,
                payment_status: paymentIntent.status,
                amount: this.convertFromSmallestUnit(paymentIntent.amount),
                currency: paymentIntent.currency,
                metadata: paymentIntent.metadata
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    // Utility methods
    convertAmount(amount) {
        return Math.round(new Decimal(amount).times(100).toNumber());
    }

    convertFromSmallestUnit(amount) {
        return new Decimal(amount).div(100).toNumber();
    }

    prepareMetadata(data) {
        return Object.entries(data).reduce((acc, [key, value]) => {
            const formattedKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
            acc[formattedKey] = String(value);
            return acc;
        }, {});
    }

    async getOrCreateCustomer(email, metadata = {}) {
        const customers = await this.stripe.customers.list({
            email,
            limit: 1
        });

        if (customers.data.length > 0) {
            return customers.data[0];
        }

        return await this.stripe.customers.create({
            email,
            metadata: this.prepareMetadata(metadata)
        });
    }

    handleError(error) {
        if (error instanceof stripe.errors.StripeError) {
            return {
                status: false,
                error: error.message,
                code: error.code,
                type: error.type
            };
        }
        return {
            status: false,
            error: 'An unexpected error occurred',
            code: 'internal_error'
        };
    }
}

module.exports = VornifyPay; 