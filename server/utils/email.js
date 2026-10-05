import nodemailer from 'nodemailer';

export const sendEmail = async (to, subject, text, html) => {
  const emailUser = process.env.EMAIL_USER || process.env.EMAIL_USERNAME;
  const emailPass = process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD;
  const fromOverride = process.env.SMTP_FROM || process.env.EMAIL_FROM;

  if (!emailUser || !emailPass) {
    console.log('[email] Skipping real email send (no creds configured). To:', to, 'Subject:', subject);
    return;
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: emailUser,
        pass: emailPass
      }
    });

    const mailOptions = {
      from: fromOverride || emailUser,
      to,
      subject,
      text,
      html
    };

    await transporter.sendMail(mailOptions);
    console.log('[email] ✅ Email sent successfully to:', to);
  } catch (err) {
    console.error('[email] ⚠️ Failed to send email via SMTP:', err?.message || err);
    // Suppress error so auth/check-email API flow does not throw 500 when SMTP/network is unreachable
  }
};