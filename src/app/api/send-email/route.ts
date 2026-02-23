import { resend } from '@/lib/resend'

export async function POST(req: Request) {
  try {
    const { to, subject, html } = (await req.json()) as {
      to?: string
      subject?: string
      html?: string
    }

    if (!to || !subject || !html) {
      return Response.json({ error: 'Missing to/subject/html' }, { status: 400 })
    }

    const from = process.env.RESEND_FROM
    if (!from) {
      return Response.json({ error: 'Missing RESEND_FROM env var' }, { status: 500 })
    }

    const data = await resend.emails.send({
      from,
      to,
      subject,
      html,
    })

    return Response.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error'
    return Response.json({ error: message }, { status: 500 })
  }
}
