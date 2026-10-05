# MongoDB Atlas Setup Guide

## 1. Create MongoDB Atlas Account
1. Go to [MongoDB Atlas](https://www.mongodb.com/atlas)
2. Sign up for a free account
3. Create a new cluster (choose the free M0 tier)

## 2. Configure Database Access
1. Go to "Database Access" in the left sidebar
2. Click "Add New Database User"
3. Create a user with:
   - Username: `dastavez-user`
   - Password: Generate a strong password
   - Database User Privileges: "Read and write to any database"

## 3. Configure Network Access
1. Go to "Network Access" in the left sidebar
2. Click "Add IP Address"
3. For development: Click "Allow Access from Anywhere" (0.0.0.0/0)
4. For production: Add your specific IP addresses

## 4. Get Connection String
1. Go to "Clusters" in the left sidebar
2. Click "Connect" on your cluster
3. Choose "Connect your application"
4. Copy the connection string
5. Replace `<password>` with your database user password
6. Replace `<dbname>` with `dastavez`

## 5. Update Environment Variables
Add to your `.env` file:
```bash
MONGODB_URI=mongodb+srv://dastavez-user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/dastavez?retryWrites=true&w=majority
```

## 6. Test Connection
Run the server and check for successful MongoDB connection:
```bash
npm start
```

You should see: `✅ Connected to MongoDB`

## 7. MongoDB Compass (Optional)
1. Download [MongoDB Compass](https://www.mongodb.com/products/compass)
2. Use the same connection string to connect
3. Browse your database and collections

## 8. Production Considerations
- Use environment variables for all sensitive data
- Set up proper IP whitelisting
- Enable MongoDB Atlas monitoring
- Set up automated backups
- Use connection pooling for better performance
