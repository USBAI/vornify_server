const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri);

async function connectToDatabase() {
    try {
        await client.connect();
        console.log('Connected to MongoDB successfully');
        
        // Test the connection
        const adminDb = client.db().admin();
        const result = await adminDb.ping();
        console.log('MongoDB ping result:', result);
        
        return client;
    } catch (error) {
        console.error('Error connecting to MongoDB:', error);
        throw error;
    }
}

module.exports = { connectToDatabase, client }; 