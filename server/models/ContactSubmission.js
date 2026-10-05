import mongoose from 'mongoose';

const contactSubmissionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, default: '' },
  subject: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['contact', 'demo'], default: 'contact' },
  // Additional demo-specific fields
  company: { type: String, default: '' },
  role: { type: String, default: '' },
  teamSize: { type: String, default: '' },
  isRead: { type: Boolean, default: false },
}, {
  timestamps: true
});

const ContactSubmission = mongoose.model('ContactSubmission', contactSubmissionSchema);
export default ContactSubmission;
