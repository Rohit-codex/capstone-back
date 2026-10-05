# Law AI - Legal Assistant Platform

A comprehensive legal assistant platform that helps users with legal queries, document analysis, and legal research using advanced AI technology.

---

## Features

### Core Features
- 🤖 AI-powered legal assistance
- 📝 Document analysis and summarization
- 🔍 Legal research and case law analysis
- 💬 Interactive chat interface
- 📱 Responsive design for all devices

### Authentication & User Management
- 🔐 Multi-step login/signup with email verification (OTP)
- 🔑 JWT-based authentication (stateless, secure)
- 🔄 Google OAuth login/signup (infrastructure ready)
- 🔒 Forgot password flow (OTP to email, secure reset)
- 🚫 Rate limiting on authentication endpoints
- 👤 Profile management

### Subscription System
- 💳 Premium and Free user plans
- 🔄 Automatic subscription management
- 💰 Dynamic pricing system
- 🎫 Coupon and discount management
- 📊 Admin dashboard for subscription control

### Payment Integration
- 💳 Secure payment processing with Razorpay
- 🔒 Real-time payment verification
- 📈 Subscription status tracking
- 🎫 Coupon code support
- 📊 Payment history and analytics

### Admin Features
- 👥 User management
- 💰 Subscription price management
- 🎫 Coupon creation and management
- 📊 Financial analytics
- 🔄 System monitoring

---

## Tech Stack

### Frontend
- React.js
- Chakra UI (modern, accessible UI components)
- React Router (multi-step auth flow)
- Axios
- Framer Motion (animations)
- React Toastify (notifications)

### Backend
- Node.js, Express.js
- MongoDB (Mongoose)
- Redis (for caching, OTP, rate limiting)
- JWT Authentication
- Nodemailer (email/OTP)
- Google OAuth (passport-google-oauth20, google-auth-library)
- Express Rate Limit, Helmet (security)

### AI/ML
- Google Gemini API (Generative AI)
- OpenAI GPT-4 (optional)
- Custom document processing

---

## Getting Started

### Prerequisites
- Node.js (v16+)
- MongoDB
- Redis
- Google Cloud OAuth credentials (for Google login)
- Razorpay account

### Environment Variables

```env
# Server
PORT=5000
MONGODB_URI=your_mongodb_uri
JWT_SECRET=your_jwt_secret
EMAIL_USER=your_gmail_address
EMAIL_PASSWORD=your_gmail_app_password
OPENAI_API_KEY=your_openai_api_key
GEMINI_API_KEY=your_google_gemini_api_key

# Google OAuth
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:5000/auth/google/callback

# Razorpay
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
RAZORPAY_WEBHOOK_SECRET=your_webhook_secret

# Redis
REDIS_URL=your_redis_url

# Client
VITE_API_URL=http://localhost:5000
VITE_RAZORPAY_KEY_ID=your_razorpay_key_id
```

---

## Installation

1. Clone the repository
```bash
git clone https://github.com/yourusername/law-ai.git
cd law-ai
```

2. Install dependencies
```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

3. Start the development servers
```bash
# Server
npm run dev

# Client
npm run dev
```

---

## API Documentation

### Authentication
- `POST /auth/check-email` — Check if user exists (step 1 of login/signup)
- `POST /auth/signup` — Register new user (OTP required)
- `POST /auth/login` — User login
- `GET /auth/user` — Get current user info (JWT required)
- `POST /auth/logout` — Logout
- `POST /auth/forgot-password` — Request OTP for password reset
- `POST /auth/verify-reset-otp` — Verify OTP for password reset
- `POST /auth/reset-password` — Reset password using OTP
- *(Google OAuth endpoints: coming soon)*

### Chat
- `POST /api/chat/message` — Send message to AI
- `GET /api/chat/history` — Get chat history
- `DELETE /api/chat/clear` — Clear chat history

### Files
- `POST /api/files/upload` — Upload file (premium/limited for free users)
- `GET /api/files/all` — Get all files
- `POST /api/files/analyze/:fileId` — Analyze file with Gemini AI

### Subscription
- `GET /api/subscription/price` — Get current subscription price
- `POST /api/subscription/order` — Create payment order
- `POST /api/subscription/verify` — Verify payment
- `GET /api/subscription/status` — Get subscription status

### Coupons
- `POST /api/coupons` — Create coupon (admin)
- `GET /api/coupons` — Get all coupons
- `POST /api/coupons/validate` — Validate coupon code

### Admin
- `GET /api/admin/users` — Get all users
- `GET /api/admin/stats` — Get system statistics

---

## Frontend UX Highlights

- Multi-step login/signup with email check, password, and OTP
- “Forgot Password?” flow with OTP and secure reset
- Back arrow for easy navigation between steps
- Consistent, modern spacing and animations
- Responsive and accessible design

---

## Security

- All premium and admin features are enforced server-side (DB-based checks)
- JWT signature verification and stateless auth
- Rate limiting on sensitive endpoints
- OTPs stored securely in Redis with expiry
- No sensitive logic trusted from the client

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

- Google for Gemini API and OAuth
- OpenAI for GPT-4
- Razorpay for payment processing
- Chakra UI for the component library
- MongoDB and Redis for data and caching # dastavez
# dastavez
