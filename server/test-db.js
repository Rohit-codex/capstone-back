import 'dotenv/config';
import mongoose from 'mongoose';

const uri = process.env.MONGODB_URI;

console.log('----------------------------------------');
console.log('Testing MongoDB Connection...');
console.log('URI from env:', uri ? uri.replace(/:([^:@]+)@/, ':****@') : 'UNDEFINED');
console.log('----------------------------------------');

if (!uri) {
    console.error('❌ MONGODB_URI is missing in .env file');
    process.exit(1);
}

mongoose.connect(uri)
    .then(() => {
        console.log('✅ Successfully connected to MongoDB Atlas!');
        console.log('Connection state:', mongoose.connection.readyState);
        return mongoose.connection.close();
    })
    .then(() => {
        console.log('Requested connection close.');
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Connection failed:', err.message);
        if (err.message.includes('bad auth')) {
            console.error('👉 Hint: Check your username and password.');
        } else if (err.message.includes('ECONNREFUSED')) {
            console.error('👉 Hint: Check if your IP is whitelisted in Atlas Network Access.');
        }
        process.exit(1);
    });
