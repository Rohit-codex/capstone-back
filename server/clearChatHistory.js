import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Chat from './models/Chat.js';

dotenv.config();

async function clearChatHistory() {
  try {
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    
    const result = await Chat.deleteMany({});
    console.log(`✅ Cleared ${result.deletedCount} chat histories`);

    await mongoose.connection.close();
    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

clearChatHistory();
