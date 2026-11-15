/**
 * Key Club — event reminder emails.
 *
 * Officers click "Remind" next to an event in Admin -> Posts. That queues a
 * row in event_reminders (supabase/013_event_reminders.sql). This script
 * checks the queue every minute, emails everyone the reminder covers, and
 * writes the result back so the Admin page shows "Sent to 23 people".
 *
 *   Signed up    everyone signed up for that date
 *   All members  every active member (officers only, for an officers-only
 *                event). Anyone already signed up gets "see you there"
 *                instead of "sign up".
 *
 * SETUP: add this file to the SAME Apps Script project as
 * WeeklyHoursEmail.gs. It reuses the SUPABASE_URL and SUPABASE_SERVICE_KEY
 * script properties. Then:
 *   1. Run supabase/013_event_reminders.sql in Supabase
 *   2. With ER_SEND_TO_MEMBERS = false, click Remind on an event, then run
 *      processEventReminders() here — the email comes to you only
 *   3. Set ER_SEND_TO_MEMBERS = true, then run createEventReminderTrigger()
 *      once. From then on a click is mailed within about a minute.
 *
 * Not affected by the weekly email switch in Admin -> Settings: a reminder
 * only goes out because an officer asked for it just now.
 */

// true  = every person the reminder covers gets their own email.
// false = TEST: the same emails (real names and data) go to the addresses
//         below instead, labelled with who they would have gone to.
var ER_SEND_TO_MEMBERS = false;
var ER_TEST_RECIPIENTS = [
  // 'you@example.com',
];
// At most this many test emails per reminder, so a test of a 60-person
// reminder doesn't fill your inbox.
var ER_TEST_LIMIT = 3;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Run every minute by createEventReminderTrigger(). Sends what's queued. */
function processEventReminders() {
  erRecoverStuck_();
  var queued = erFetch_('/rest/v1/event_reminders?select=*&status=eq.queued&order=requested_at&limit=5');
  if (!queued || queued.length === 0) return;

  var settings = erSettings_();
  var logo = null;
  queued.forEach(function (req) {
    var claimed = erClaim_(req.id);
    if (!claimed) return; // another run got it first
    if (logo === null) logo = erLogo_(settings) || false;
    try {
      var result = erSend_(claimed, settings, logo || null);
      erFinish_(claimed.id, result.failures.length && result.sent === 0 ? 'failed' : 'sent',
        result.sent, result.note);
      erLogRun_(result.sent, result.failures);
    } catch (err) {
      Logger.log('Reminder %s failed: %s', claimed.id, err.message);
      erFinish_(claimed.id, 'failed', 0, err.message);
    }
  });
}

/** Logs who the oldest queued reminder would go to. Sends nothing. */
function previewEventReminder() {
  var req = erFetch_('/rest/v1/event_reminders?select=*&status=eq.queued&order=requested_at&limit=1')[0];
  if (!req) { Logger.log('Nothing queued. Click Remind on an event first.'); return; }
  var post = erPost_(req.post_id);
  var people = erRecipients_(req, post);
  Logger.log('"%s" (%s) — %s recipient(s):', post.title, req.audience, people.length);
  people.forEach(function (p) {
    Logger.log('  %s <%s>%s', p.full_name, p.email, p.signedUp ? ' — signed up' : '');
  });
}

/** Checks the queue every minute. Run once. */
function createEventReminderTrigger() {
  deleteEventReminderTrigger();
  ScriptApp.newTrigger('processEventReminders').timeBased().everyMinutes(1).create();
  Logger.log('Checking for event reminders every minute.');
}

function deleteEventReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'processEventReminders') ScriptApp.deleteTrigger(t);
  });
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

function erConfig_() {
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

function erFetch_(path, options) {
  var cfg = erConfig_();
  var params = Object.assign(
    {
      muteHttpExceptions: true,
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + cfg.key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
    },
    options || {}
  );
  var res = UrlFetchApp.fetch(cfg.url + path, params);
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Supabase ' + code + ' on ' + path + ': ' + text);
  return text ? JSON.parse(text) : null;
}

function erSettings_() {
  var settings = erFetch_('/rest/v1/club_settings?select=*&limit=1')[0];
  if (!settings) throw new Error('club_settings row is missing. Run the SQL migrations first.');
  return settings;
}

/** queued -> sending, only if it's still queued. Returns the row, or null. */
function erClaim_(id) {
  var rows = erFetch_('/rest/v1/event_reminders?id=eq.' + id + '&status=eq.queued', {
    method: 'patch',
    payload: JSON.stringify({ status: 'sending', claimed_at: new Date().toISOString() }),
  });
  return rows && rows[0] ? rows[0] : null;
}

function erFinish_(id, status, recipients, detail) {
  erFetch_('/rest/v1/event_reminders?id=eq.' + id, {
    method: 'patch',
    payload: JSON.stringify({
      status: status,
      recipients: recipients,
      sent_at: new Date().toISOString(),
      detail: detail ? String(detail).slice(0, 2000) : null,
    }),
  });
}

/**
 * A run that died mid-send (timeout, quota) leaves its row on "sending",
 * which would block that event's Remind button forever. After 15 minutes,
 * call it failed so the officer can try again.
 */
function erRecoverStuck_() {
  var cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  erFetch_('/rest/v1/event_reminders?status=eq.sending&claimed_at=lt.' + encodeURIComponent(cutoff), {
    method: 'patch',
    payload: JSON.stringify({
      status: 'failed',
      sent_at: new Date().toISOString(),
      detail: 'Stopped partway (timed out). Some people may have been emailed already, so check before reminding again.',
    }),
  });
}

function erPost_(id) {
  var post = erFetch_('/rest/v1/posts?select=*&id=eq.' + id)[0];
  if (!post) throw new Error('That event was deleted.');
  return post;
}

/** [{ email, full_name, signedUp }] for one reminder, de-duplicated. */
function erRecipients_(req, post) {
  var active = erFetch_('/rest/v1/members?select=email,full_name,role&active=eq.true');
  var byEmail = {};
  active.forEach(function (m) { byEmail[String(m.email).toLowerCase()] = m; });

  // A series keeps one sign-up list per date; a one-off has a single list.
  var series = (post.event_dates || []).length > 1;
  var signups = erFetch_('/rest/v1/event_signups?select=occurs_on,profile:profiles!user_id(email,full_name)' +
    '&post_id=eq.' + post.id + '&status=eq.going');
  var signed = {};
  signups.forEach(function (s) {
    if (series && req.occurs_on && s.occurs_on !== req.occurs_on) return;
    if (s.profile && s.profile.email) signed[String(s.profile.email).toLowerCase()] = s.profile;
  });

  var out = [];
  if (req.audience === 'members') {
    var officersOnly = post.audience === 'officers';
    Object.keys(byEmail).forEach(function (email) {
      var m = byEmail[email];
      if (officersOnly && m.role !== 'officer' && m.role !== 'admin') return;
      out.push({ email: m.email, full_name: m.full_name, signedUp: !!signed[email] });
    });
  } else {
    Object.keys(signed).forEach(function (email) {
      if (!byEmail[email]) return; // deactivated since signing up
      out.push({ email: byEmail[email].email, full_name: byEmail[email].full_name, signedUp: true });
    });
  }
  out.sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); });
  return out;
}

function erLogRun_(sent, failures) {
  try {
    erFetch_('/rest/v1/email_log', {
      method: 'post',
      payload: JSON.stringify({
        kind: 'event_reminder',
        recipients: sent,
        failures: failures.length,
        detail: failures.slice(0, 20).join(' | ') || null,
      }),
    });
  } catch (err) {
    Logger.log('Could not write email_log: %s', err.message);
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function erSend_(req, settings, logo) {
  var post = erPost_(req.post_id);
  var people = erRecipients_(req, post);
  if (people.length === 0) {
    return { sent: 0, failures: [], note: req.audience === 'signed_up'
      ? 'Nobody is signed up for that date, so nobody was emailed.'
      : 'No active members to email.' };
  }

  var testing = !ER_SEND_TO_MEMBERS;
  var testTo = ER_TEST_RECIPIENTS.length ? ER_TEST_RECIPIENTS : [Session.getEffectiveUser().getEmail()];
  var batch = testing ? people.slice(0, ER_TEST_LIMIT) : people;
  var perEmail = testing ? testTo.length : 1;

  var capacity = Math.floor(MailApp.getRemainingDailyQuota() / perEmail);
  if (capacity <= 0) throw new Error('Gmail daily limit is used up. Try Remind again tomorrow.');
  var skipped = Math.max(0, batch.length - capacity);
  batch = batch.slice(0, capacity);

  var sent = 0;
  var failures = [];
  for (var i = 0; i < batch.length; i++) {
    var person = batch[i];
    try {
      var mail = buildReminderEmail_(person, post, req, settings, logo);
      var options = erMailOptions_(mail, settings);
      if (testing) {
        testTo.forEach(function (addr) {
          MailApp.sendEmail(addr, '[TEST → ' + person.full_name + '] ' + mail.subject, mail.text, options);
        });
      } else {
        MailApp.sendEmail(person.email, mail.subject, mail.text, options);
      }
      sent++;
    } catch (err) {
      failures.push(person.email + ': ' + err.message);
      if (/too many times|quota|limit/i.test(err.message)) {
        skipped += batch.length - i - 1;
        break;
      }
    }
  }

  var notes = [];
  if (testing) {
    notes.push('TEST MODE: ' + sent + ' sample email(s) went to ' + testTo.join(', ') +
      ', not to the ' + people.length + ' member(s). Set ER_SEND_TO_MEMBERS = true in EventReminders.gs.');
  }
  if (skipped) notes.push(skipped + ' not sent because the Gmail daily limit ran out.');
  if (failures.length) notes.push(failures.length + ' failed: ' + failures.slice(0, 10).join(' | '));
  Logger.log('"%s": sent %s, failed %s, skipped %s', post.title, sent, failures.length, skipped);

  return { sent: testing ? 0 : sent, failures: failures, note: notes.join(' ') || null };
}

function erMailOptions_(mail, settings) {
  var match = /^\s*(.+?)\s*</.exec(settings.email_from || '');
  var options = {
    htmlBody: mail.html,
    name: match ? match[1] : (settings.email_from || settings.club_name + ' Key Club'),
  };
  if (settings.email_reply_to) options.replyTo = settings.email_reply_to;
  if (mail.inlineImages) options.inlineImages = mail.inlineImages;
  return options;
}

// ---------------------------------------------------------------------------
// The email — same navy and gold layout as the standing email. Named apart
// (ER_) so both files can share one project.
// ---------------------------------------------------------------------------

var ER_NAVY = '#063b70';
var ER_NAVY_2 = '#0a4a87';
var ER_GOLD = '#f4c400';
var ER_INK = '#102b45';
var ER_MUTED = '#71869a';
var ER_BODY = '#445c70';
var ER_TZ = 'Asia/Seoul';
var ER_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
var ER_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function erLogo_(settings) {
  if (!settings.site_url) return null;
  try {
    var res = UrlFetchApp.fetch(settings.site_url.replace(/\/$/, '') + '/email-logo.png',
      { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return null;
    return { src: 'cid:keyclubLogo', blob: res.getBlob().setName('keyclub-logo.png') };
  } catch (err) {
    Logger.log('Logo fetch failed, sending without it: %s', err.message);
    return null;
  }
}

function erEsc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** "2026-11-21" -> { m, d, weekday } */
function erDay_(iso) {
  var p = String(iso).split('-');
  var y = Number(p[0]), m = Number(p[1]) - 1, d = Number(p[2]);
  return { m: m, d: d, weekday: new Date(Date.UTC(y, m, d)).getUTCDay() };
}

/** "Saturday, November 21" */
function erLongDate_(iso) {
  var p = erDay_(iso);
  return ER_DAYS[p.weekday] + ', ' + ER_MONTHS[p.m] + ' ' + p.d;
}

/** "Sat, Nov 21" */
function erShortDate_(iso) {
  var p = erDay_(iso);
  return ER_DAYS[p.weekday].slice(0, 3) + ', ' + ER_MONTHS[p.m].slice(0, 3) + ' ' + p.d;
}

/** 2.6667 -> "2 hrs 40 min", 1 -> "1 hr", 0.5 -> "30 min" */
function erHours_(value) {
  var total = Math.round(Number(value) * 60);
  var h = Math.floor(total / 60), m = total % 60;
  var hs = h + ' ' + (h === 1 ? 'hr' : 'hrs');
  if (!m) return hs;
  return h ? hs + ' ' + m + ' min' : m + ' min';
}

/** Date, time and hours for the occurrence being reminded about. */
function erWhen_(post, req) {
  var dayIso = req.occurs_on ||
    (post.starts_at ? Utilities.formatDate(new Date(post.starts_at), ER_TZ, 'yyyy-MM-dd') : null);
  var start = '';
  var range = '';
  if (post.starts_at && !post.all_day) {
    start = Utilities.formatDate(new Date(post.starts_at), ER_TZ, 'h:mm a');
    range = start;
    if (post.ends_at) {
      var end = Utilities.formatDate(new Date(post.ends_at), ER_TZ, 'h:mm a');
      // "5:15 to 6:15 PM" when both are PM, "11:00 AM to 1:00 PM" when not.
      range = start.slice(-2) === end.slice(-2)
        ? start.slice(0, -3) + ' to ' + end
        : start + ' to ' + end;
    }
  }
  return {
    long: dayIso ? erLongDate_(dayIso) : 'a date we’ll announce soon',
    short: dayIso ? erShortDate_(dayIso) : 'Date TBA',
    soon: erSoon_(dayIso),
    start: start,
    timeTile: post.all_day ? 'All day' : range || 'TBA',
    hours: post.hours_tbd ? 'TBA' : Number(post.service_hours) > 0 ? erHours_(post.service_hours) : null,
  };
}

/**
 * How a person would say when it is: "today", "tomorrow", "Friday" (this
 * week), or "on November 20" (further out).
 */
function erSoon_(dayIso) {
  if (!dayIso) return 'soon';
  var today = Utilities.formatDate(new Date(), ER_TZ, 'yyyy-MM-dd');
  var a = erDay_(today), b = erDay_(dayIso);
  var ta = Date.UTC(Number(today.slice(0, 4)), a.m, a.d);
  var tb = Date.UTC(Number(dayIso.slice(0, 4)), b.m, b.d);
  var days = Math.round((tb - ta) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1 && days < 7) return ER_DAYS[b.weekday];
  return 'on ' + ER_MONTHS[b.m] + ' ' + b.d;
}

function erCircleLogo_(logo, size) {
  var img = Math.round(size * 0.92);
  var inner = logo
    ? '<img src="' + logo.src + '" width="' + img + '" height="' + img + '" alt="Key Club GCS" ' +
      'style="display:inline-block;vertical-align:middle;border:0;outline:none;max-width:' + img + 'px;height:auto;">'
    : '<span style="font-size:' + Math.round(size * 0.16) + 'px;font-weight:900;letter-spacing:1px;color:' +
      ER_NAVY + ';vertical-align:middle;">KEY CLUB</span>';
  return '<div style="width:' + size + 'px;height:' + size + 'px;background:#ffffff;border-radius:50%;' +
    'display:inline-block;text-align:center;line-height:' + size + 'px;overflow:hidden;">' + inner + '</div>';
}

function erTile_(label, value, bg, last) {
  return '<td width="33.33%" valign="top" style="background:' + bg + ';padding:22px 20px;' +
    (last ? '' : 'border-right:2px solid #ffffff;') + '">' +
    '<div style="font-size:10px;letter-spacing:2px;font-weight:900;color:' + ER_GOLD + ';">' + label + '</div>' +
    '<div style="font-size:19px;line-height:1.25;font-weight:900;color:#ffffff;margin-top:9px;">' + erEsc_(value) + '</div>' +
    '</td>';
}

function erPara_(html) {
  return '<p style="font-size:16px;line-height:1.75;color:' + ER_BODY + ';margin:20px 0 0;">' + html + '</p>';
}

function buildReminderEmail_(person, post, req, settings, logo) {
  var firstName = String(person.full_name).split(/\s+/)[0];
  var when = erWhen_(post, req);
  var signedUp = person.signedUp;
  var link = settings.site_url ? settings.site_url.replace(/\/$/, '') + '/post/' + post.slug : null;
  var dateKey = req.occurs_on ||
    (post.starts_at ? Utilities.formatDate(new Date(post.starts_at), ER_TZ, 'yyyy-MM-dd') : '');
  var cantGoLink = link ? link + '?cantgo=1' + (dateKey ? '&date=' + dateKey : '') : null;
  var title = erEsc_(post.title);

  var whenText = '<b>' + erEsc_(when.long) + '</b>' + (when.start ? ' at <b>' + erEsc_(when.start) + '</b>' : '');
  var where = post.location ? ' We’re meeting at <b>' + erEsc_(post.location) + '</b>.' : '';
  var hoursLine = when.hours && when.hours !== 'TBA'
    ? ' It counts for <b>' + erEsc_(when.hours) + '</b> of service.'
    : '';
  // "See you Friday!" reads like a person; "See you on November 20!" still works.
  var copy = signedUp
    ? {
        subject: 'See you ' + when.soon + ' at ' + post.title,
        headline: 'See you ' + erEsc_(when.soon) + '!',
        intro: 'Just a heads up that you signed up for <b>' + title + '</b>. It’s ' + whenText + '.' +
          where + ' Thanks so much for helping out, we really appreciate it.',
        buttons: [
          { label: 'VIEW EVENT', href: link, primary: true },
          { label: 'I CAN’T GO', href: cantGoLink, primary: false },
        ],
        after: 'If something came up, no worries. Tap <b>I can’t go</b> and your spot opens up for someone else.',
      }
    : {
        subject: post.title + ' is ' + when.soon + '. Can you make it?',
        headline: when.soon === 'soon' ? 'Can you make it?' : 'Can you make it ' + erEsc_(when.soon) + '?',
        intro: 'We’re doing <b>' + title + '</b> on ' + whenText +
          ' and we’d love to have you there.' + where + hoursLine,
        buttons: [{ label: 'SIGN UP', href: link, primary: true }],
        after: 'Spots can fill up, so grab one soon if you’re free.',
      };

  var note = req.note
    ? '<tr><td style="padding:26px 46px 0;">' +
      '<div style="border-left:4px solid ' + ER_GOLD + ';background:#f6f8fa;padding:16px 20px;">' +
      '<div style="font-size:11px;letter-spacing:2px;font-weight:900;color:' + ER_MUTED + ';">A NOTE FROM THE OFFICERS</div>' +
      '<div style="font-size:16px;line-height:1.7;color:' + ER_INK + ';margin-top:6px;">' +
      erEsc_(req.note).replace(/\n/g, '<br>') + '</div></div></td></tr>'
    : '';

  var summary = post.summary
    ? '<tr><td style="padding:0 46px;">' + erPara_(erEsc_(post.summary)) + '</td></tr>'
    : '';

  // Side by side: navy for the main action, outlined for "I can't go".
  var buttonCells = copy.buttons.filter(function (b) { return b.href; }).map(function (b, i) {
    var style = b.primary
      ? 'background:' + ER_NAVY + ';color:#ffffff;border:2px solid ' + ER_NAVY + ';'
      : 'background:#ffffff;color:' + ER_NAVY + ';border:2px solid ' + ER_NAVY + ';';
    return '<td style="padding:' + (i ? '0 0 0 10px' : '0') + ';">' +
      '<a href="' + erEsc_(b.href) + '" style="display:inline-block;' + style + 'text-decoration:none;' +
      'padding:12px 24px;font-size:13px;letter-spacing:2px;font-weight:900;">' + b.label + '</a></td>';
  }).join('');
  var button = buttonCells
    ? '<tr><td style="padding:30px 46px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
      buttonCells + '</tr></table></td></tr>'
    : '';

  var after = copy.after
    ? '<tr><td style="padding:6px 46px 0;">' + erPara_(copy.after) + '</td></tr>'
    : '';

  var html =
    '<div style="margin:0;padding:0;background:#e8edf2;font-family:Arial,Helvetica,sans-serif;color:' + ER_INK + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8edf2;">' +
    '<tr><td align="center" style="padding:28px 10px 40px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="max-width:760px;background:#ffffff;border-collapse:collapse;">' +

    '<tr><td style="height:9px;background:' + ER_GOLD + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +

    // Hero
    '<tr><td style="background:' + ER_NAVY + ';padding:34px 42px 40px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td valign="middle" width="152">' + erCircleLogo_(logo, 128) + '</td>' +
    '<td valign="middle" style="padding-left:24px;">' +
    '<div style="font-size:11px;letter-spacing:3.5px;font-weight:800;color:' + ER_GOLD +
    ';text-transform:uppercase;margin-bottom:10px;">GCS KEY CLUB · ' + erEsc_(when.short).toUpperCase() + '</div>' +
    '<div style="font-size:38px;line-height:1.02;font-weight:900;color:#ffffff;letter-spacing:-1px;">EVENT<br>REMINDER</div>' +
    '<div style="font-size:14px;line-height:1.5;color:#d8e5ef;margin-top:14px;">Caring: Our Way of Life</div>' +
    '</td></tr></table></td></tr>' +

    '<tr><td style="background:' + ER_GOLD + ';padding:12px 42px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-size:12px;font-weight:900;letter-spacing:2.5px;color:' + ER_NAVY + ';text-transform:uppercase;">' +
    (signedUp ? 'YOU’RE SIGNED UP' : 'KEY CLUB') + '</td>' +
    '<td align="right" style="font-size:12px;font-weight:900;color:' + ER_NAVY + ';">GAONNURI CHRISTIAN SCHOOL</td>' +
    '</tr></table></td></tr>' +

    // Greeting, headline, intro
    '<tr><td style="padding:42px 46px 8px;">' +
    '<div style="font-size:14px;letter-spacing:2px;font-weight:800;color:' + ER_MUTED + ';text-transform:uppercase;">Hi ' +
    erEsc_(firstName) + ',</div>' +
    '<div style="font-size:34px;line-height:1.12;font-weight:900;color:' + ER_NAVY + ';margin-top:8px;">' + copy.headline + '</div>' +
    '<div style="height:4px;width:58px;background:' + ER_GOLD + ';margin-top:18px;"></div>' +
    erPara_(copy.intro) +
    '</td></tr>' +

    // Date / time / hours
    '<tr><td style="padding:28px 46px 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    erTile_('DATE', when.short, ER_NAVY, false) +
    erTile_('TIME', when.timeTile, ER_NAVY_2, false) +
    erTile_('SERVICE HOURS', when.hours || 'None', ER_NAVY, true) +
    '</tr></table></td></tr>' +

    (post.location
      ? '<tr><td style="padding:14px 46px 0;font-size:14px;color:' + ER_MUTED + ';">' +
        '<b style="letter-spacing:2px;font-size:11px;">WHERE</b>&nbsp;&nbsp;' + erEsc_(post.location) + '</td></tr>'
      : '') +

    note + summary + button + after +
    '<tr><td style="height:44px;font-size:0;line-height:0;">&nbsp;</td></tr>' +

    // Footer
    '<tr><td style="background:' + ER_NAVY + ';padding:28px 46px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">' +
    '<div style="font-size:13px;letter-spacing:2.5px;font-weight:900;color:' + ER_GOLD + ';">' +
    'LEADERSHIP • CHARACTER BUILDING • CARING • INCLUSIVENESS</div>' +
    '<div style="font-size:12px;line-height:1.5;color:#c6d7e4;margin-top:8px;">' +
    'GAONNURI CHRISTIAN SCHOOL • KEY CLUB INTERNATIONAL</div>' +
    '</td><td align="right" valign="middle" width="76" style="padding-left:16px;">' + erCircleLogo_(logo, 60) +
    '</td></tr></table></td></tr>' +

    '</table></td></tr></table></div>';

  var plain = function (s) {
    return String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/’/g, "'");
  };
  var text =
    'Hi ' + firstName + ',\n\n' +
    plain(copy.headline) + '\n\n' +
    plain(copy.intro) + '\n\n' +
    'Date: ' + when.long + '\n' +
    'Time: ' + when.timeTile + '\n' +
    (post.location ? 'Where: ' + post.location + '\n' : '') +
    'Service hours: ' + (when.hours || 'none') + '\n' +
    (req.note ? '\nA note from the officers:\n' + req.note + '\n' : '') +
    (post.summary ? '\n' + post.summary + '\n' : '') +
    (link ? '\n' + (signedUp ? 'View the event: ' : 'Sign up: ') + link + '\n' : '') +
    (signedUp && cantGoLink ? 'Can’t go? ' + cantGoLink + '\n' : '') +
    (copy.after ? '\n' + plain(copy.after) + '\n' : '') +
    '\nGaonnuri Christian School • Key Club International\n';

  var mail = { subject: copy.subject, html: html, text: text };
  if (logo && logo.blob) mail.inlineImages = { keyclubLogo: logo.blob };
  return mail;
}
