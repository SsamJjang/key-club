/**
 * Key Club — semester standing email.
 *
 * Mails the members who are behind on club hours for the semester, from
 * the member_hours_standing view (supabase/010_hours_standing.sql). Two
 * versions of one email:
 *
 *   behind  "Hold on... you got some catching up to do!"
 *   danger  the urgent version: membership at risk
 *
 * Each email lists the hours we've recorded for that member this semester,
 * then the upcoming service events they can sign up for to catch up
 * (upcoming_service_events, same SQL file).
 *
 * SETUP: add this file to the SAME Apps Script project as
 * WeeklyHoursEmail.gs. It reuses the SUPABASE_URL and SUPABASE_SERVICE_KEY
 * script properties, so there is nothing new to configure. Then:
 *   1. Run previewStandingRecipients() — logs who would get which email
 *   2. With SEND_TO_MEMBERS = false, run sendStandingEmails() — test to your list
 *   3. Set SEND_TO_MEMBERS = true, then run createStandingTrigger() — Wednesdays 6 PM
 *
 * Respects the weekly email on/off switch in Admin -> Settings.
 */

// true  = every Behind/Danger member gets their own email.
// false = TEST: one Behind + one Danger email (real member data) to each address below.
var SEND_TO_MEMBERS = false;
var TEST_RECIPIENTS = [
  // 'you@example.com',
];
// CC'd on every member email when SEND_TO_MEMBERS is true.
var CC_ON_MEMBER_EMAILS = ['27lee.daheun@gcssongdo.co.kr', 'choi.jenny@gcssongdo.co.kr'];

var STANDING_TIERS = ['behind', 'danger'];

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Scheduled by createStandingTrigger(). Emails every behind/danger member. */
function sendStandingEmails() {
  stRun_({ dryRun: false });
}

/** Lists who would get which email, in the execution log. Sends nothing. */
function previewStandingRecipients() {
  stRun_({ dryRun: true });
}

// ---------------------------------------------------------------------------

function stConfig_() {
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

function stFetch_(path, options) {
  var cfg = stConfig_();
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
  if (code < 200 || code >= 300) throw new Error('Supabase ' + code + ' on ' + path + ': ' + text);
  return text ? JSON.parse(text) : null;
}

function stSettings_() {
  var settings = stFetch_('/rest/v1/club_settings?select=*&limit=1')[0];
  if (!settings) throw new Error('club_settings row is missing. Run the SQL migrations first.');
  return settings;
}

/** Every upcoming event with room left, soonest first. */
function stUpcoming_() {
  var rows = stFetch_('/rest/v1/upcoming_service_events?select=*&order=on_date,starts_time');
  return rows
    .filter(function (e) { return e.spots_left === null || Number(e.spots_left) > 0; });
}

function stMailOptions_(mail, settings) {
  var match = /^\s*(.+?)\s*</.exec(settings.email_from || '');
  var options = {
    htmlBody: mail.html,
    name: match ? match[1] : settings.club_name + ' Hour Tracker',
  };
  if (settings.email_reply_to) options.replyTo = settings.email_reply_to;
  if (mail.inlineImages) options.inlineImages = mail.inlineImages;
  return options;
}

function stRun_(opts) {
  var settings = stSettings_();

  if (!SEND_TO_MEMBERS && !opts.dryRun) {
    var to = TEST_RECIPIENTS.length ? TEST_RECIPIENTS : [Session.getActiveUser().getEmail()];
    var all = stFetch_('/rest/v1/member_hours_standing?select=*&tier=in.(' + STANDING_TIERS.join(',') +
      ')&order=tier,club_hours,full_name');
    var ups = stUpcoming_();
    var lg = stLogo_(settings);
    STANDING_TIERS.forEach(function (tier) {
      var sample = all.filter(function (r) { return r.tier === tier; })[0];
      if (!sample) { Logger.log('No %s members right now — skipped that version.', tier); return; }
      var mail = buildStandingEmail_(sample, settings, lg, ups);
      to.forEach(function (addr) {
        MailApp.sendEmail(addr, '[TEST ' + tier + ' → ' + sample.full_name + '] ' + mail.subject,
          mail.text, stMailOptions_(mail, settings));
      });
    });
    Logger.log('TEST sent to %s. No members were emailed.', to.join(', '));
    return;
  }

  if (!settings.weekly_email_enabled && !opts.dryRun) {
    Logger.log('Member emails are switched off in Admin -> Settings. Nothing sent.');
    return;
  }

  var rows = stFetch_(
    '/rest/v1/member_hours_standing?select=*&tier=in.(' + STANDING_TIERS.join(',') + ')' +
      '&order=tier,club_hours,full_name'
  );
  var upcoming = stUpcoming_();

  if (opts.dryRun) {
    Logger.log('DRY RUN — %s recipient(s), nothing sent:', rows.length);
    rows.forEach(function (r) {
      Logger.log('  [%s] %s <%s> — %s hrs logged (expected %s), %s more club hrs needed',
        r.tier, r.full_name, r.email, Number(r.club_hours), Number(r.pace),
        Number(r.club_hours_still_needed));
    });
    Logger.log('Upcoming events in the email (%s):', upcoming.length);
    upcoming.forEach(function (e) {
      Logger.log('  %s — %s (%s)', e.on_date, e.title, e.hours_tbd ? 'hrs TBA' : e.service_hours ? e.service_hours + ' hrs' : 'no hours set');
    });
    return;
  }

  if (rows.length === 0) {
    Logger.log('Nobody is behind. Nothing sent.');
    stLogRun_(0, []);
    return;
  }

  // Who already got this week's email — a re-run (e.g. the next day, after
  // the quota ran out) only mails the rest.
  var props = PropertiesService.getScriptProperties();
  var weekKey = 'STANDING_SENT_' + stWeekKey_();
  var already = JSON.parse(props.getProperty(weekKey) || '[]');
  var todo = rows.filter(function (r) { return already.indexOf(String(r.email).toLowerCase()) === -1; });
  if (todo.length === 0) {
    Logger.log('Everyone (%s) already got this week’s email. Nothing sent.', rows.length);
    return;
  }

  // Gmail counts every recipient, CCs included: each email costs 1 + CCs.
  var cost = 1 + CC_ON_MEMBER_EMAILS.length;
  var capacity = Math.floor(MailApp.getRemainingDailyQuota() / cost);
  var batch = todo.slice(0, capacity);
  if (batch.length === 0) {
    throw new Error('Gmail daily limit is used up (' + todo.length + ' members still waiting). ' +
      'Run sendStandingEmails again tomorrow — already-mailed members are skipped.');
  }

  var logo = stLogo_(settings);
  var sent = 0;
  var failures = [];
  for (var i = 0; i < batch.length; i++) {
    var row = batch[i];
    try {
      var mail = buildStandingEmail_(row, settings, logo, upcoming);
      var options = stMailOptions_(mail, settings);
      if (CC_ON_MEMBER_EMAILS.length) options.cc = CC_ON_MEMBER_EMAILS.join(',');
      MailApp.sendEmail(row.email, mail.subject, mail.text, options);
      sent++;
      already.push(String(row.email).toLowerCase());
      props.setProperty(weekKey, JSON.stringify(already));
    } catch (err) {
      failures.push(row.email + ': ' + err.message);
      if (/too many times|quota|limit/i.test(err.message)) break; // out of quota: stop, resume tomorrow
    }
  }

  var left = todo.length - sent;
  Logger.log('Sent %s, failed %s, still waiting %s', sent, failures.length, left);
  failures.forEach(function (f) { Logger.log('  FAILED %s', f); });
  if (left > 0) {
    Logger.log('Not everyone got it (Gmail daily limit). Run sendStandingEmails again tomorrow — ' +
      'the %s already mailed this week are skipped.', already.length);
  }
  stLogRun_(sent, failures);
}

/** Monday of this week (Seoul), e.g. "2026-11-09" — one send per member per week. */
function stWeekKey_() {
  var now = new Date(Date.now() + 9 * 3600 * 1000); // Seoul
  var day = (now.getUTCDay() + 6) % 7;              // Mon = 0
  var monday = new Date(now.getTime() - day * 86400 * 1000);
  return monday.toISOString().slice(0, 10);
}

/**
 * Forget who got this week's email, so the next sendStandingEmails() mails
 * everyone again. Only for re-sending on purpose.
 */
function resetStandingSentThisWeek() {
  PropertiesService.getScriptProperties().deleteProperty('STANDING_SENT_' + stWeekKey_());
  Logger.log('Cleared. The next run mails every Behind/Danger member again.');
}

function stLogRun_(sent, failures) {
  try {
    stFetch_('/rest/v1/email_log', {
      method: 'post',
      payload: JSON.stringify({
        kind: 'semester_standing',
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
// The email — GCS Key Club navy and gold, same layout as the membership fee
// reminder. Table-based so it holds together in Gmail and Outlook.
// ---------------------------------------------------------------------------

var ST_NAVY = '#063b70';
var ST_NAVY_2 = '#0a4a87';
var ST_GOLD = '#f4c400';
var ST_INK = '#102b45';
var ST_MUTED = '#71869a';
var ST_BODY = '#445c70';
var ST_RED = '#d6453a';
var ST_LINE = '#dfe6ec';

/**
 * The logo, attached inline (Gmail drops data: URIs). It's served by the
 * club site from public/email-logo.png. If it can't be fetched the email
 * still sends, with "KEY CLUB" lettering where the logo would be.
 */
function stLogo_(settings) {
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

function stEsc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

var ST_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

function stParts_(iso) {
  var p = String(iso).split('-');
  return { y: Number(p[0]), m: Number(p[1]) - 1, d: Number(p[2]) };
}

/** 2026-12-18 -> "December 18th" */
function stLongDate_(iso) {
  var p = stParts_(iso);
  var d = p.d;
  var suffix = (d % 100 >= 11 && d % 100 <= 13) ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' })[d % 10] || 'th';
  return ST_MONTHS[p.m] + ' ' + d + suffix;
}

/** 2026-12-18 -> "Dec 18" */
function stShortDate_(iso) {
  var p = stParts_(iso);
  return ST_MONTHS[p.m].slice(0, 3) + ' ' + p.d;
}

function stWeekday_(iso) {
  var p = stParts_(iso);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()];
}

/** "14:30:00" -> "2:30 PM" */
function stTime_(t) {
  if (!t) return '';
  var p = String(t).split(':');
  var h = Number(p[0]);
  return ((h + 11) % 12 + 1) + ':' + p[1] + ' ' + (h < 12 ? 'AM' : 'PM');
}

function stHrs_(n) {
  return n + ' hour' + (Number(n) === 1 ? '' : 's');
}

function stLabel_(text, color) {
  return '<div style="font-size:14px;letter-spacing:2px;font-weight:800;color:' + (color || ST_MUTED) +
    ';text-transform:uppercase;">' + text + '</div>';
}

function stPara_(html) {
  return '<p style="font-size:16px;line-height:1.75;color:' + ST_BODY + ';margin:20px 0 0;">' + html + '</p>';
}

function stTile_(label, value, bg, last, valueColor) {
  return '<td width="33.33%" valign="top" style="background:' + bg + ';padding:24px 20px;' +
    (last ? '' : 'border-right:2px solid #ffffff;') + '">' +
    '<div style="font-size:10px;letter-spacing:2px;font-weight:900;color:' + ST_GOLD + ';">' + label + '</div>' +
    '<div style="font-size:22px;font-weight:900;color:' + (valueColor || '#ffffff') + ';margin-top:9px;">' + value + '</div>' +
    '</td>';
}

function stCircleLogo_(logo, size) {
  var img = Math.round(size * 0.92);
  var inner = logo
    ? '<img src="' + logo.src + '" width="' + img + '" height="' + img + '" alt="Key Club GCS" ' +
      'style="display:inline-block;vertical-align:middle;border:0;outline:none;max-width:' + img + 'px;height:auto;">'
    : '<span style="font-size:' + Math.round(size * 0.16) + 'px;font-weight:900;letter-spacing:1px;color:' +
      ST_NAVY + ';vertical-align:middle;">KEY CLUB</span>';
  return '<div style="width:' + size + 'px;height:' + size + 'px;background:#ffffff;border-radius:50%;' +
    'display:inline-block;text-align:center;line-height:' + size + 'px;overflow:hidden;">' + inner + '</div>';
}

/** The words that differ between the two versions. */
function stCopy_(danger, v) {
  if (danger) {
    return {
      subject: 'Urgent: your Key Club membership is at risk (' + v.club + ' / ' + v.goal + ' hours)',
      hero: 'SERVICE HOURS<br>AT RISK',
      headline: 'YOOOOOO - You GOTTA Start Volunteering!',
      intro: 'You have <b>' + stHrs_(v.club) + '</b> logged to your profile this semester. ' +
        'That’s quite behind the plan, and there are only ' + v.weeksText + ' left.',
      ask: 'You need <b>' + v.needed + ' more hours at Key Club by ' + v.deadline + '</b>. ' +
        'Sign up for the events below to reach the ' + v.clubMin +
        '-hour internal volunteering goal to retain your membership.',
      upcomingTitle: 'Sign up now',
    };
  }
  return {
    subject: 'Key Club: you got some catching up to do (' + v.club + ' / ' + v.goal + ' hours)',
    hero: 'SERVICE HOURS<br>CHECK-IN',
    headline: 'Hold on... you got some catching up to do! 😱',
    intro: 'You have <b>' + stHrs_(v.club) + '</b> logged to your profile this semester. ' +
      'You’re a little behind what’s planned, and there are only ' + v.weeksText + ' left.',
    ask: 'You need <b>' + v.needed + ' more hours at Key Club by ' + v.deadline + '</b>. ' +
      'Signing up for an event or two will let you reach the ' + v.clubMin +
      '-hour internal volunteering goal.',
    upcomingTitle: 'Catch up here',
  };
}

function stUpcomingRows_(upcoming, siteUrl) {
  if (!upcoming.length) {
    return '<tr><td style="padding:16px 0;border-bottom:1px solid ' + ST_LINE + ';font-size:16px;color:' + ST_BODY + ';">' +
      'New events are on the way — check the club site soon.</td></tr>';
  }
  var base = siteUrl ? siteUrl.replace(/\/$/, '') + '/post/' : null;
  return upcoming.map(function (e) {
    var p = stParts_(e.on_date);
    var meta = [stWeekday_(e.on_date), stTime_(e.starts_time), e.location].filter(Boolean).join(' · ');
    var hours = e.hours_tbd ? 'HRS TBA' : Number(e.service_hours) > 0 ? '+' + Number(e.service_hours) + ' HR' + (Number(e.service_hours) === 1 ? '' : 'S') : '';
    var spots = e.spots_left !== null && Number(e.spots_left) <= 5
      ? '<div style="font-size:12px;font-weight:800;color:' + ST_RED + ';margin-top:4px;">' +
        e.spots_left + ' spot' + (Number(e.spots_left) === 1 ? '' : 's') + ' left</div>'
      : '';
    var title = base
      ? '<a href="' + stEsc_(base + e.slug) + '" style="color:' + ST_NAVY + ';text-decoration:none;">' + stEsc_(e.title) + '</a>'
      : stEsc_(e.title);
    var signup = base
      ? '<a href="' + stEsc_(base + e.slug) + '" style="display:inline-block;margin-top:8px;font-size:12px;' +
        'letter-spacing:1.5px;font-weight:900;color:' + ST_NAVY + ';text-decoration:none;">SIGN UP →</a>'
      : '';
    return '<tr>' +
      // Date block
      '<td width="74" valign="top" style="padding:14px 0;">' +
      '<div style="width:58px;background:' + ST_NAVY + ';text-align:center;padding:8px 0 9px;">' +
      '<div style="font-size:11px;letter-spacing:2px;font-weight:900;color:' + ST_GOLD + ';">' +
      ST_MONTHS[p.m].slice(0, 3).toUpperCase() + '</div>' +
      '<div style="font-size:24px;line-height:1.1;font-weight:900;color:#ffffff;">' + p.d + '</div>' +
      '</div></td>' +
      // What and when
      '<td valign="top" style="padding:14px 0;border-bottom:1px solid ' + ST_LINE + ';">' +
      '<div style="font-size:17px;font-weight:900;color:' + ST_NAVY + ';">' + title + '</div>' +
      (meta ? '<div style="font-size:14px;color:' + ST_MUTED + ';margin-top:4px;">' + stEsc_(meta) + '</div>' : '') +
      spots + signup +
      '</td>' +
      // Hours pill
      '<td valign="top" align="right" style="padding:16px 0 14px 12px;border-bottom:1px solid ' + ST_LINE + ';white-space:nowrap;">' +
      (hours
        ? '<span style="display:inline-block;background:' + ST_GOLD + ';color:' + ST_NAVY + ';font-size:12px;' +
          'letter-spacing:1px;font-weight:900;padding:7px 10px;">' + hours + '</span>'
        : '') +
      '</td></tr>';
  }).join('');
}

function buildStandingEmail_(row, settings, logo, upcoming) {
  var danger = row.tier === 'danger';
  var firstName = String(row.full_name).split(/\s+/)[0];
  var club = Number(row.club_hours) || 0;
  var clubMin = Number(row.club_min);
  var goal = Number(row.goal);
  var needed = Number(row.club_hours_still_needed);
  // Rounded up: 37 days left reads as "about 6 weeks".
  var weeks = Math.max(1, Math.ceil(Number(row.days_left) / 7));
  var events = Array.isArray(row.events) ? row.events : [];
  upcoming = upcoming || [];

  var v = {
    club: club, goal: goal, clubMin: clubMin, needed: needed,
    deadline: stLongDate_(row.due_on),
    weeksText: weeks === 1 ? 'about a week' : 'about ' + weeks + ' weeks',
  };
  var copy = stCopy_(danger, v);
  var accent = danger ? ST_RED : ST_GOLD;

  // Hours already logged, numbered.
  var loggedRows = events.length
    ? events.map(function (e, i) {
        var n = i + 1;
        return '<tr>' +
          '<td width="58" valign="top" style="padding:15px 0;">' +
          '<div style="width:38px;height:38px;background:' + ST_GOLD + ';text-align:center;line-height:38px;' +
          'font-size:17px;font-weight:900;color:' + ST_NAVY + ';">' + (n < 10 ? '0' + n : n) + '</div></td>' +
          '<td valign="top" style="padding:14px 0;border-bottom:1px solid ' + ST_LINE + ';">' +
          '<div style="font-size:12px;letter-spacing:2px;font-weight:900;color:' + ST_MUTED + ';text-transform:uppercase;">' +
          stShortDate_(e.served_on) + '</div>' +
          '<div style="font-size:17px;font-weight:900;color:' + ST_NAVY + ';margin-top:4px;">' + stEsc_(e.event) + '</div></td>' +
          '<td valign="top" align="right" style="padding:14px 0 14px 12px;border-bottom:1px solid ' + ST_LINE + ';white-space:nowrap;">' +
          '<div style="font-size:12px;letter-spacing:2px;font-weight:900;color:' + ST_MUTED + ';">HOURS</div>' +
          '<div style="font-size:17px;font-weight:900;color:' + ST_NAVY + ';margin-top:4px;">' + Number(e.hours) + '</div></td>' +
          '</tr>';
      }).join('') +
      '<tr><td></td>' +
      '<td style="padding:14px 0 0;font-size:12px;letter-spacing:2px;font-weight:900;color:' + ST_NAVY + ';">TOTAL</td>' +
      '<td align="right" style="padding:14px 0 0;font-size:20px;font-weight:900;color:' + ST_NAVY + ';">' + club + '</td></tr>'
    : '<tr><td style="padding:14px 0;border-bottom:1px solid ' + ST_LINE + ';font-size:16px;color:' + ST_BODY + ';">' +
      'No Key Club hours logged to your profile yet this semester.</td></tr>';

  var allEvents = settings.site_url
    ? '<tr><td style="padding:22px 46px 0;"><a href="' + stEsc_(settings.site_url.replace(/\/$/, '') + '/events') + '" ' +
      'style="display:inline-block;background:' + ST_NAVY + ';color:#ffffff;text-decoration:none;' +
      'padding:13px 22px;font-size:13px;letter-spacing:2px;font-weight:900;">SEE ALL EVENTS</a></td></tr>'
    : '';

  var html =
    '<div style="margin:0;padding:0;background:#e8edf2;font-family:Arial,Helvetica,sans-serif;color:' + ST_INK + ';">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#e8edf2;">' +
    '<tr><td align="center" style="padding:28px 10px 40px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="max-width:760px;background:#ffffff;border-collapse:collapse;">' +

    // Gold top bar
    '<tr><td style="height:9px;background:' + ST_GOLD + ';font-size:0;line-height:0;">&nbsp;</td></tr>' +

    // Hero
    '<tr><td style="background:' + ST_NAVY + ';padding:34px 42px 40px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td valign="middle" width="152">' + stCircleLogo_(logo, 128) + '</td>' +
    '<td valign="middle" style="padding-left:24px;">' +
    '<div style="font-size:11px;letter-spacing:3.5px;font-weight:800;color:' + ST_GOLD +
    ';text-transform:uppercase;margin-bottom:10px;">GCS KEY CLUB · ' + stEsc_(row.semester).toUpperCase() + '</div>' +
    '<div style="font-size:38px;line-height:1.02;font-weight:900;color:#ffffff;letter-spacing:-1px;">' + copy.hero + '</div>' +
    '<div style="font-size:14px;line-height:1.5;color:#d8e5ef;margin-top:14px;">Caring — Our Way of Life</div>' +
    '</td></tr></table></td></tr>' +

    // Gold strip
    '<tr><td style="background:' + ST_GOLD + ';padding:12px 42px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    '<td style="font-size:12px;font-weight:900;letter-spacing:2.5px;color:' + ST_NAVY + ';text-transform:uppercase;">KEY CLUB</td>' +
    '<td align="right" style="font-size:12px;font-weight:900;color:' + ST_NAVY + ';">GAONNURI CHRISTIAN SCHOOL</td>' +
    '</tr></table></td></tr>' +

    // Dear ..., headline, first paragraph
    '<tr><td style="padding:42px 46px 8px;">' +
    stLabel_('Dear ' + stEsc_(firstName) + ',') +
    '<div style="font-size:34px;line-height:1.12;font-weight:900;color:' + ST_NAVY + ';margin-top:8px;">' + copy.headline + '</div>' +
    '<div style="height:4px;width:58px;background:' + accent + ';margin-top:18px;"></div>' +
    stPara_(copy.intro) +
    '</td></tr>' +

    // Stat tiles — out of the full 25
    '<tr><td style="padding:28px 46px 14px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>' +
    stTile_('HOURS LOGGED', club + ' / ' + goal, ST_NAVY, false) +
    stTile_('KEY CLUB HOURS NEEDED', needed + ' more', ST_NAVY_2, false, danger ? '#ffb4ad' : null) +
    stTile_('DUE BY', stShortDate_(row.due_on), ST_NAVY, true) +
    '</tr></table></td></tr>' +

    // Hours logged
    '<tr><td style="padding:28px 46px 12px;">' + stLabel_('Your hours this semester') + '</td></tr>' +
    '<tr><td style="padding:0 46px 6px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' + loggedRows + '</table>' +
    '</td></tr>' +

    // Second paragraph
    '<tr><td style="padding:10px 46px 0;">' + stPara_(copy.ask) + '</td></tr>' +

    // Upcoming volunteering
    '<tr><td style="padding:40px 46px 4px;">' +
    stLabel_('Upcoming volunteering', danger ? ST_RED : ST_MUTED) +
    '<div style="font-size:26px;line-height:1.15;font-weight:900;color:' + ST_NAVY + ';margin-top:6px;">' +
    copy.upcomingTitle + '</div>' +
    '</td></tr>' +
    '<tr><td style="padding:4px 46px 0;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    stUpcomingRows_(upcoming, settings.site_url) + '</table>' +
    '</td></tr>' +
    allEvents +
    '<tr><td style="height:44px;font-size:0;line-height:0;">&nbsp;</td></tr>' +

    // Footer
    '<tr><td style="background:' + ST_NAVY + ';padding:28px 46px;">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">' +
    '<div style="font-size:13px;letter-spacing:2.5px;font-weight:900;color:' + ST_GOLD + ';">' +
    'LEADERSHIP • CHARACTER BUILDING • CARING • INCLUSIVENESS</div>' +
    '<div style="font-size:12px;line-height:1.5;color:#c6d7e4;margin-top:8px;">' +
    'GAONNURI CHRISTIAN SCHOOL • KEY CLUB INTERNATIONAL</div>' +
    '</td><td align="right" valign="middle" width="76" style="padding-left:16px;">' + stCircleLogo_(logo, 60) +
    '</td></tr></table></td></tr>' +

    '</table></td></tr></table></div>';

  var plain = function (s) { return s.replace(/<[^>]+>/g, '').replace(/’/g, "'"); };
  var text =
    'Dear ' + firstName + ',\n' +
    plain(copy.headline) + '\n\n' +
    plain(copy.intro) + '\n\n' +
    'Hours logged: ' + club + ' / ' + goal + '   Key Club hours needed: ' + needed + ' more   Due by: ' +
    stShortDate_(row.due_on) + '\n\n' +
    'Your hours this semester:\n' +
    (events.length
      ? events.map(function (e, i) {
          return (i + 1) + '. ' + e.event + ' (' + stShortDate_(e.served_on) + ') — ' + Number(e.hours);
        }).join('\n') + '\nTotal: ' + club
      : 'None logged yet.') +
    '\n\n' + plain(copy.ask) + '\n\n' +
    'Upcoming volunteering:\n' +
    (upcoming.length
      ? upcoming.map(function (e) {
          return '- ' + stWeekday_(e.on_date) + ' ' + stShortDate_(e.on_date) + ': ' + e.title + ' (' +
            (e.hours_tbd ? 'hrs TBA' : Number(e.service_hours) > 0 ? '+' + Number(e.service_hours) + ' hrs' : 'see event') + ')' +
            (settings.site_url ? ' ' + settings.site_url.replace(/\/$/, '') + '/post/' + e.slug : '');
        }).join('\n')
      : 'New events are on the way — check the club site soon.') +
    '\n\nGaonnuri Christian School • Key Club International\n';

  var mail = { subject: copy.subject, html: html, text: text };
  if (logo && logo.blob) mail.inlineImages = { keyclubLogo: logo.blob };
  return mail;
}

// ---------------------------------------------------------------------------
// Trigger management
// ---------------------------------------------------------------------------

/** Wednesdays, 6–7 PM in the project's timezone (set it to Seoul). */
function createStandingTrigger() {
  deleteStandingTrigger();
  ScriptApp.newTrigger('sendStandingEmails')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
    .atHour(18)
    .create();
  Logger.log('Scheduled: Wednesdays at 18:00 (%s).', Session.getScriptTimeZone());
}

/** Cancels the standing email. */
function deleteStandingTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendStandingEmails') ScriptApp.deleteTrigger(t);
  });
}
