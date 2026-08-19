// Weekly Key Club hours email.
//
// Triggered by pg_cron every Sunday at 12:00 UTC (21:00 Asia/Seoul).
// Deploy:  supabase functions deploy weekly-hours-email
// Secrets: supabase secrets set RESEND_API_KEY=re_...
//
// Send a test to yourself without emailing the club:
//   POST { "dryRun": true }            -> returns the recipient list, sends nothing
//   POST { "testTo": "you@school.org" } -> sends only to you

import { createClient } from 'jsr:@supabase/supabase-js@2'

interface DigestRow {
  email: string
  full_name: string
  grade: number | null
  graduation_year: number | null
  approved_hours: number
  last_served_on: string | null
}

interface Settings {
  club_name: string
  school_year: string
  hours_goal: number
  email_from: string
  email_reply_to: string | null
  weekly_email_enabled: boolean
  site_url: string | null
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function buildEmail(row: DigestRow, settings: Settings) {
  const goal = Number(settings.hours_goal)
  const hours = Number(row.approved_hours)
  const pct = goal > 0 ? Math.min(100, Math.round((hours / goal) * 100)) : 0
  const remaining = Math.max(0, goal - hours)
  const firstName = escapeHtml(row.full_name.split(/\s+/)[0] ?? row.full_name)
  const done = remaining === 0

  const subject = `${settings.club_name} Hours Update — ${hours}/${goal} hrs (${pct}%)`

  const cta = settings.site_url
    ? `<p style="margin:24px 0 0;font-size:14px;">
         <a href="${escapeHtml(settings.site_url)}"
            style="display:inline-block;background:#1e4a89;color:#ffffff;text-decoration:none;
                   padding:10px 18px;border-radius:8px;font-weight:600;">
           Open the club site
         </a>
       </p>`
    : ''

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f6f7f9;
               font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
               color:#0f2340;">
    <div style="max-width:560px;margin:0 auto;">
      <h1 style="margin:0 0 4px;font-size:22px;">Hi ${firstName}! 👋</h1>
      <p style="margin:0 0 20px;color:#52607a;font-size:14px;">
        Your weekly ${escapeHtml(settings.club_name)} volunteer hour update — ${escapeHtml(settings.school_year)}
      </p>

      <div style="background:#ffffff;border:1px solid #e2e6ed;border-radius:14px;padding:22px;">
        <div style="font-size:34px;font-weight:700;line-height:1;">
          ${hours}
          <span style="font-size:16px;font-weight:400;color:#52607a;">/ ${goal} hours</span>
        </div>

        <div style="margin-top:14px;height:10px;background:#e9edf3;border-radius:999px;overflow:hidden;">
          <div style="width:${Math.max(pct, 2)}%;height:10px;border-radius:999px;
                      background:${done ? '#1a9c6b' : '#e5ad2c'};"></div>
        </div>
        <div style="margin-top:8px;font-size:13px;color:#52607a;">${pct}% complete</div>
      </div>

      <p style="margin:20px 0 0;font-size:15px;">
        ${
          done
            ? `You’ve hit the ${goal}-hour goal. Thank you for showing up all year. 🎉`
            : `You have <strong>${remaining} hour${remaining === 1 ? '' : 's'}</strong> left to reach the ${goal}-hour goal.`
        }
      </p>

      ${
        row.last_served_on
          ? `<p style="margin:8px 0 0;font-size:13px;color:#52607a;">
               Last recorded service: ${escapeHtml(row.last_served_on)}
             </p>`
          : `<p style="margin:8px 0 0;font-size:13px;color:#52607a;">
               No service hours recorded yet this year.
             </p>`
      }

      ${cta}

      <h2 style="margin:28px 0 8px;font-size:16px;">Reminders</h2>
      <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;">
        <li>Hours are entered by officers — tell an officer within <strong>2 weeks</strong> of an event, or they may not be counted.</li>
        <li>You must fulfill <strong>${goal} hours</strong> of volunteer service per year to remain an active member.</li>
        <li>If a number looks wrong, reach out to an officer.</li>
      </ul>

      <hr style="margin:28px 0 12px;border:none;border-top:1px solid #e2e6ed;" />
      <p style="margin:0;font-size:12px;color:#8a97ad;">
        Automated message from the ${escapeHtml(settings.club_name)} hour tracker. Reply with questions.
      </p>
    </div>
  </body>
</html>`

  const text = `Hi ${row.full_name.split(/\s+/)[0]}!

Your weekly ${settings.club_name} volunteer hour update — ${settings.school_year}

${hours} / ${goal} hours (${pct}% complete)

${done ? `You've hit the ${goal}-hour goal. Thank you!` : `You have ${remaining} hour(s) left to reach the ${goal}-hour goal.`}

Reminders:
- Hours are entered by officers. Tell an officer within 2 weeks of an event.
- ${goal} hours of service per year are required to remain an active member.
- If a number looks wrong, reach out to an officer.
${settings.site_url ? `\n${settings.site_url}\n` : ''}
Automated message from the ${settings.club_name} hour tracker.`

  return { subject, html, text }
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendKey = Deno.env.get('RESEND_API_KEY')

    if (!resendKey) {
      return Response.json({ error: 'RESEND_API_KEY is not set' }, { status: 500 })
    }

    const body = await req.json().catch(() => ({}))
    const dryRun = body?.dryRun === true
    const testTo: string | undefined = body?.testTo

    const supabase = createClient(supabaseUrl, serviceKey)

    const { data: settingsRow, error: settingsError } = await supabase
      .from('club_settings')
      .select('*')
      .single()

    if (settingsError) {
      return Response.json({ error: settingsError.message }, { status: 500 })
    }

    const settings = settingsRow as Settings

    // A cron-triggered run respects the kill switch; a manual test does not.
    if (!settings.weekly_email_enabled && !dryRun && !testTo) {
      return Response.json({ skipped: 'weekly_email_enabled is false' })
    }

    const { data, error } = await supabase
      .from('weekly_hours_digest')
      .select('*')
      .order('full_name')

    if (error) return Response.json({ error: error.message }, { status: 500 })

    let recipients = (data ?? []) as DigestRow[]
    if (testTo) recipients = recipients.filter((r) => r.email === testTo)

    if (dryRun) {
      return Response.json({
        dryRun: true,
        count: recipients.length,
        recipients: recipients.map((r) => ({
          email: r.email,
          name: r.full_name,
          hours: Number(r.approved_hours),
        })),
      })
    }

    let sent = 0
    let failed = 0
    const errors: string[] = []

    // Resend's free tier rate-limits bursts, so these go sequentially with
    // a small gap rather than all at once.
    for (const row of recipients) {
      const { subject, html, text } = buildEmail(row, settings)

      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: settings.email_from,
          to: [row.email],
          subject,
          html,
          text,
          ...(settings.email_reply_to ? { reply_to: settings.email_reply_to } : {}),
        }),
      })

      if (res.ok) {
        sent++
      } else {
        failed++
        errors.push(`${row.email}: ${res.status} ${await res.text()}`)
      }

      await new Promise((r) => setTimeout(r, 550))
    }

    await supabase.from('email_log').insert({
      kind: 'weekly_hours',
      recipients: sent,
      failures: failed,
      detail: errors.slice(0, 20).join(' | ') || null,
    })

    return Response.json({ sent, failed, errors: errors.slice(0, 20) })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
})
