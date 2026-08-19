/**
 * Key Club — weekly hours email.
 *
 * Runs on Google's servers for free, sends from your own Google account, and
 * reads its data from the Key Club site's Supabase database. No domain, no DNS,
 * no email service, no spreadsheet.
 *
 * SETUP (once):
 *   1. script.google.com -> New project -> paste this file in
 *   2. Project Settings -> Script properties, add:
 *        SUPABASE_URL          https://YOUR_REF.supabase.co
 *        SUPABASE_SERVICE_KEY  your service_role key (Supabase -> Settings -> API)
 *   3. Project Settings -> Time zone -> (GMT+09:00) Seoul
 *   4. Run sendTestToMe() once and approve the permission prompt
 *   5. Run createWeeklyTrigger() once to schedule Sundays at 9 PM
 *
 * The service key is stored in Script Properties, which only you can read.
 * Never paste it into the code itself.
 */

// ---------------------------------------------------------------------------
// Entry points — these are the functions you run from the Apps Script menu.
// ---------------------------------------------------------------------------

/** Scheduled weekly by createWeeklyTrigger(). Emails every active member. */
function sendWeeklyHoursEmails() {
  run({ dryRun: false });
}

/** Lists who would be emailed, in the execution log. Sends nothing. */
function previewRecipients() {
  run({ dryRun: true });
}

/** Sends exactly one real email, to you. Ignores the on/off switch. */
function sendTestToMe() {
  run({ dryRun: false, testTo: Session.getActiveUser().getEmail(), force: true });
}

// ---------------------------------------------------------------------------

function config_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');

  if (!url || !key) {
    throw new Error(
      'Missing script properties. Add SUPABASE_URL and SUPABASE_SERVICE_KEY ' +
        'under Project Settings -> Script properties.'
    );
  }
  return { url: url.replace(/\/$/, ''), key: key };
}

function fetchJson_(path, options) {
  var cfg = config_();
  var params = Object.assign(
    {
      muteHttpExceptions: true,
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
      },
    },
    options || {}
  );

  var res = UrlFetchApp.fetch(cfg.url + path, params);
  var code = res.getResponseCode();
  var text = res.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Supabase ' + code + ' on ' + path + ': ' + text);
  }
  return text ? JSON.parse(text) : null;
}

function run(opts) {
  opts = opts || {};

  var settings = fetchJson_('/rest/v1/club_settings?select=*&limit=1')[0];
  if (!settings) throw new Error('club_settings row is missing. Run the SQL migrations first.');

  if (!settings.weekly_email_enabled && !opts.dryRun && !opts.force) {
    Logger.log('Weekly email is switched off in Admin -> Settings. Nothing sent.');
    return;
  }

  var rows = fetchJson_('/rest/v1/weekly_hours_digest?select=*&order=full_name');

  if (opts.testTo) {
    rows = rows.filter(function (r) {
      return String(r.email).toLowerCase() === String(opts.testTo).toLowerCase();
    });
    if (rows.length === 0) {
      throw new Error(opts.testTo + ' is not an active member, so there is nothing to send.');
    }
  }

  if (opts.dryRun) {
    Logger.log('DRY RUN — %s recipient(s), nothing sent:', rows.length);
    rows.forEach(function (r) {
      Logger.log('  %s <%s> — %s hrs', r.full_name, r.email, Number(r.approved_hours));
    });
    return;
  }

  // Gmail caps daily sends (100 for consumer accounts, 1,500 for Workspace).
  // Bail out rather than emailing half the club.
  var quota = MailApp.getRemainingDailyQuota();
  if (quota < rows.length) {
    throw new Error(
      'Daily email quota is ' + quota + ' but ' + rows.length + ' members need mail. ' +
        'Nothing sent — try again tomorrow.'
    );
  }

  var sent = 0;
  var failures = [];

  rows.forEach(function (row) {
    try {
      var mail = buildEmail_(row, settings);
      var options = {
        htmlBody: mail.html,
        name: senderName_(settings),
      };
      if (settings.email_reply_to) options.replyTo = settings.email_reply_to;

      MailApp.sendEmail(row.email, mail.subject, mail.text, options);
      sent++;
    } catch (err) {
      failures.push(row.email + ': ' + err.message);
    }
  });

  Logger.log('Sent %s, failed %s', sent, failures.length);
  failures.forEach(function (f) {
    Logger.log('  FAILED %s', f);
  });

  logRun_(sent, failures);
}

/** MailApp always sends from the running account; this sets the display name. */
function senderName_(settings) {
  var match = /^\s*(.+?)\s*</.exec(settings.email_from || '');
  return match ? match[1] : settings.club_name + ' Hour Tracker';
}

function logRun_(sent, failures) {
  try {
    fetchJson_('/rest/v1/email_log', {
      method: 'post',
      payload: JSON.stringify({
        kind: 'weekly_hours',
        recipients: sent,
        failures: failures.length,
        detail: failures.slice(0, 20).join(' | ') || null,
      }),
    });
  } catch (err) {
    Logger.log('Could not write email_log: %s', err.message);
  }
}

function escapeHtml_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildEmail_(row, settings) {
  var goal = Number(settings.hours_goal) || 50;
  var hours = Number(row.approved_hours) || 0;
  var pct = goal > 0 ? Math.min(100, Math.round((hours / goal) * 100)) : 0;
  var remaining = Math.max(0, goal - hours);
  var done = remaining === 0;
  var firstName = String(row.full_name).split(/\s+/)[0];

  var subject =
    settings.club_name + ' Hours Update — ' + hours + '/' + goal + ' hrs (' + pct + '%)';

  var cta = settings.site_url
    ? '<p style="margin:24px 0 0;font-size:14px;">' +
      '<a href="' + escapeHtml_(settings.site_url) + '" ' +
      'style="display:inline-block;background:#1e4a89;color:#ffffff;text-decoration:none;' +
      'padding:10px 18px;border-radius:8px;font-weight:600;">Open the club site</a></p>'
    : '';

  var html =
    '<div style="margin:0;padding:24px;background:#f6f7f9;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
    'color:#0f2340;">' +
    '<div style="max-width:560px;margin:0 auto;">' +
    '<h1 style="margin:0 0 4px;font-size:22px;">Hi ' + escapeHtml_(firstName) + '! 👋</h1>' +
    '<p style="margin:0 0 20px;color:#52607a;font-size:14px;">Your weekly ' +
    escapeHtml_(settings.club_name) + ' volunteer hour update — ' +
    escapeHtml_(settings.school_year) + '</p>' +
    '<div style="background:#ffffff;border:1px solid #e2e6ed;border-radius:14px;padding:22px;">' +
    '<div style="font-size:34px;font-weight:700;line-height:1;">' + hours +
    '<span style="font-size:16px;font-weight:400;color:#52607a;"> / ' + goal + ' hours</span></div>' +
    '<div style="margin-top:14px;height:10px;background:#e9edf3;border-radius:999px;overflow:hidden;">' +
    '<div style="width:' + Math.max(pct, 2) + '%;height:10px;border-radius:999px;background:' +
    (done ? '#1a9c6b' : '#e5ad2c') + ';"></div></div>' +
    '<div style="margin-top:8px;font-size:13px;color:#52607a;">' + pct + '% complete</div>' +
    '</div>' +
    '<p style="margin:20px 0 0;font-size:15px;">' +
    (done
      ? 'You’ve hit the ' + goal + '-hour goal. Thank you for showing up all year. 🎉'
      : 'You have <strong>' + remaining + ' hour' + (remaining === 1 ? '' : 's') +
        '</strong> left to reach the ' + goal + '-hour goal.') +
    '</p>' +
    '<p style="margin:8px 0 0;font-size:13px;color:#52607a;">' +
    (row.last_served_on
      ? 'Last recorded service: ' + escapeHtml_(row.last_served_on)
      : 'No service hours recorded yet this year.') +
    '</p>' +
    cta +
    '<h2 style="margin:28px 0 8px;font-size:16px;">Reminders</h2>' +
    '<ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.7;">' +
    '<li>Hours are entered by officers — tell an officer within <strong>2 weeks</strong> of an event, or they may not be counted.</li>' +
    '<li>You must fulfill <strong>' + goal + ' hours</strong> of volunteer service per year to remain an active member.</li>' +
    '<li>If a number looks wrong, reach out to an officer.</li>' +
    '</ul>' +
    '<hr style="margin:28px 0 12px;border:none;border-top:1px solid #e2e6ed;" />' +
    '<p style="margin:0;font-size:12px;color:#8a97ad;">Automated message from the ' +
    escapeHtml_(settings.club_name) + ' hour tracker. Reply with questions.</p>' +
    '</div></div>';

  var text =
    'Hi ' + firstName + '!\n\n' +
    'Your weekly ' + settings.club_name + ' volunteer hour update — ' + settings.school_year + '\n\n' +
    hours + ' / ' + goal + ' hours (' + pct + '% complete)\n\n' +
    (done
      ? "You've hit the " + goal + '-hour goal. Thank you!'
      : 'You have ' + remaining + ' hour(s) left to reach the ' + goal + '-hour goal.') +
    '\n\nReminders:\n' +
    '- Hours are entered by officers. Tell an officer within 2 weeks of an event.\n' +
    '- ' + goal + ' hours of service per year are required to remain an active member.\n' +
    '- If a number looks wrong, reach out to an officer.\n' +
    (settings.site_url ? '\n' + settings.site_url + '\n' : '');

  return { subject: subject, html: html, text: text };
}

// ---------------------------------------------------------------------------
// Trigger management
// ---------------------------------------------------------------------------

/**
 * Schedules the weekly send for Sunday evening. Apps Script fires within the
 * hour you name, so this lands between 9 and 10 PM in the project's timezone —
 * set that to Seoul under Project Settings.
 */
function createWeeklyTrigger() {
  deleteWeeklyTrigger();

  ScriptApp.newTrigger('sendWeeklyHoursEmails')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(21)
    .create();

  Logger.log('Scheduled: Sundays at 21:00 (%s).', Session.getScriptTimeZone());
}

/** Cancels the weekly send. */
function deleteWeeklyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyHoursEmails') ScriptApp.deleteTrigger(t);
  });
}
