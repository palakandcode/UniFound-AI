export async function sendOtpEmail({ to, code }) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    throw new Error('Email provider is not configured yet. Add RESEND_API_KEY and EMAIL_FROM to .env.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject: 'UniFind AI verification code',
      html: `<p>Your UniFind AI verification code is <strong>${code}</strong>.</p>
             <p>This code expires in 10 minutes.</p>`
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Email provider error: ${text}`);
  }
}
