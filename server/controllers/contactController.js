import { sendEmail } from '../utils/email.js';
import { AppError } from '../utils/errors.js';
import ContactSubmission from '../models/ContactSubmission.js';

export const sendContactEmail = async (req, res) => {
  try {
    const { name, email, phone, subject, message, type = 'contact', company, role, teamSize } = req.body;

    if (!name || !email || !subject || !message) {
      throw new AppError('All fields are required', 400);
    }

    // Save to database so admin can view it
    const submission = await ContactSubmission.create({
      name, email, phone: phone || '', subject, message,
      type, company: company || '', role: role || '', teamSize: teamSize || ''
    });

    // Also send email notification
    const emailText = `
Name: ${name}
Email: ${email}
Phone: ${phone || 'N/A'}
Subject: ${subject}
Type: ${type}
${company ? `Company: ${company}` : ''}
${role ? `Role: ${role}` : ''}
${teamSize ? `Team Size: ${teamSize}` : ''}

Message:
${message}
    `;

    try {
      await sendEmail(
        process.env.COMPANY_EMAIL,
        `New ${type === 'demo' ? 'Demo Request' : 'Contact'} Submission: ${subject}`,
        emailText
      );
    } catch (emailErr) {
      // Don't fail the request if email sending fails — submission is already saved
      console.warn('Email notification failed (submission was saved):', emailErr?.message);
    }

    res.status(200).json({
      success: true,
      message: 'Your message has been sent successfully!',
      id: submission._id
    });
  } catch (error) {
    throw new AppError(error.message || 'Failed to send message. Please try again later.', 500);
  }
};

// Admin: list all contact/demo submissions
export const listContactSubmissions = async (req, res) => {
  try {
    const type = req.query.type || null; // 'contact' | 'demo' | null (all)
    const filter = type ? { type } : {};
    const submissions = await ContactSubmission.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ success: true, data: submissions, total: submissions.length });
  } catch (error) {
    throw new AppError(error.message || 'Error fetching submissions', 500);
  }
};

// Admin: mark a submission as read
export const markSubmissionRead = async (req, res) => {
  try {
    const { id } = req.params;
    await ContactSubmission.findByIdAndUpdate(id, { isRead: true });
    res.json({ success: true });
  } catch (error) {
    throw new AppError(error.message || 'Error updating submission', 500);
  }
};

// Admin: delete a submission
export const deleteContactSubmission = async (req, res) => {
  try {
    const { id } = req.params;
    await ContactSubmission.findByIdAndDelete(id);
    res.json({ success: true });
  } catch (error) {
    throw new AppError(error.message || 'Error deleting submission', 500);
  }
};