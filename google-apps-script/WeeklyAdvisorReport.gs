/**
 * Key Club — weekly advisor report.
 *
 * Every Sunday at 9 PM it dumps the entire club database into one organized
 * PDF and emails it to the advisors. Separate from WeeklyHoursEmail.gs, which
 * mails each member their own hour total; this one is the full picture, for
 * the two people who need the full picture.
 *
 * SETUP (once — if WeeklyHoursEmail.gs is already running in this same Apps
 * Script project, steps 1 and 2 are done already, so skip to 3):
 *   1. script.google.com -> the Key Club project -> add this file
 *   2. Project Settings -> Script properties:
 *        SUPABASE_URL          https://YOUR_REF.supabase.co
 *        SUPABASE_SERVICE_KEY  your service_role key (Supabase -> Settings -> API)
 *      Optional:
 *        REPORT_RECIPIENTS     comma-separated, overrides the list below
 *   3. Project Settings -> Time zone -> (GMT+09:00) Seoul
 *   4. Run previewAdvisorReport() once — approve the permission prompt, then
 *      open the PDF link it logs and check it looks right. Emails nobody.
 *   5. Run createAdvisorReportTrigger() once to schedule Sundays at 9 PM.
 *
 * The report ignores the Admin -> Settings weekly-email switch on purpose:
 * that switch governs the member-facing hour emails. To stop this one, run
 * deleteAdvisorReportTrigger().
 */

var REPORT_RECIPIENTS = [
  'choi.jenny@faystonsongdo.org',
  '29kim.sunjoong@faystonsongdo.org',
];

// ---------------------------------------------------------------------------
// Entry points — run these from the Apps Script menu.
// ---------------------------------------------------------------------------

/** Scheduled weekly. Builds the PDF and emails it to the advisors. */
function sendWeeklyAdvisorReport() {
  var report = buildReport_();
  var to = reportRecipients_();

  MailApp.sendEmail({
    to: to.join(','),
    subject: report.subject,
    body: report.body,
    name: report.senderName,
    attachments: [report.pdf],
  });

  Logger.log('Sent "%s" to %s (%s KB)', report.subject, to.join(', '),
    Math.round(report.pdf.getBytes().length / 1024));
  rptLogRun_(to.length, []);
}

/** Builds the PDF, saves it to your Drive, logs the link. Sends no email. */
function previewAdvisorReport() {
  var report = buildReport_();
  var file = DriveApp.createFile(report.pdf);
  Logger.log('Preview saved: %s', file.getUrl());
  Logger.log('Would have emailed: %s', reportRecipients_().join(', '));
}

/** Sends one real report, to you only, so you can see how it lands. */
function sendAdvisorReportTestToMe() {
  var report = buildReport_();
  var me = Session.getActiveUser().getEmail();

  MailApp.sendEmail({
    to: me,
    subject: '[TEST] ' + report.subject,
    body: report.body,
    name: report.senderName,
    attachments: [report.pdf],
  });

  Logger.log('Test report sent to %s', me);
}

// ---------------------------------------------------------------------------
// Supabase access. Named apart from WeeklyHoursEmail.gs's helpers so both
// files can live in one project without clobbering each other.
// ---------------------------------------------------------------------------

function rptConfig_() {
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

function reportRecipients_() {
  var override = PropertiesService.getScriptProperties().getProperty('REPORT_RECIPIENTS');
  if (!override) return REPORT_RECIPIENTS;

  return override
    .split(',')
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return s.length > 0; });
}

function rptFetch_(path, options) {
  var cfg = rptConfig_();
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

/**
 * Every table the report touches, fetched whole and joined in memory. A club
 * roster is a few hundred rows at most, and plain selects avoid depending on
 * PostgREST embed names (hours_log has three foreign keys to profiles).
 */
function loadEverything_() {
  var LIMIT = '&limit=10000';

  return {
    settings: (rptFetch_('/rest/v1/club_settings?select=*&limit=1') || [])[0] || {},
    positions: rptFetch_('/rest/v1/board_positions?select=*&order=sort_order') || [],
    members: rptFetch_('/rest/v1/members?select=*&order=full_name' + LIMIT) || [],
    profiles: rptFetch_('/rest/v1/profiles?select=*&order=full_name' + LIMIT) || [],
    posts: rptFetch_('/rest/v1/posts?select=*&order=created_at.desc' + LIMIT) || [],
    signups: rptFetch_('/rest/v1/event_signups?select=*&order=created_at.desc' + LIMIT) || [],
    hours: rptFetch_('/rest/v1/hours_log?select=*&order=served_on.desc' + LIMIT) || [],
    emailLog: rptFetch_('/rest/v1/email_log?select=*&order=sent_at.desc&limit=25') || [],
  };
}

function rptLogRun_(sent, failures) {
  try {
    rptFetch_('/rest/v1/email_log', {
      method: 'post',
      payload: JSON.stringify({
        kind: 'weekly_advisor_report',
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
// Formatting helpers
// ---------------------------------------------------------------------------

function esc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Seoul';
}

/** Timestamps arrive as ISO strings; render them in the club's timezone. */
function fmtDateTime_(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd HH:mm');
}

function fmtDate_(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd');
}

function dash_(value) {
  return value == null || value === '' ? '—' : esc_(value);
}

function num_(value) {
  var n = Number(value);
  return isNaN(n) ? 0 : n;
}

/** 1 -> "1", 1.5 -> "1.5", so the hour columns do not all read as 1.0. */
function hrs_(value) {
  return (Math.round(num_(value) * 10) / 10).toString();
}

function yes_(value) {
  return value ? 'Yes' : 'No';
}

/** Collapses markdown or HTML down to a short plain-text preview. */
function preview_(text, max) {
  var flat = String(text == null ? '' : text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/[#*_`>\[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, max - 1) + '…';
}

/** Cells are already-escaped HTML — escape at the call site, not here. */
function table_(headers, rows, emptyMessage) {
  if (!rows.length) {
    return '<p class="empty">' + esc_(emptyMessage || 'Nothing to show.') + '</p>';
  }

  var head = headers
    .map(function (h) { return '<th>' + esc_(h) + '</th>'; })
    .join('');

  var body = rows
    .map(function (cells) {
      return '<tr>' + cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    })
    .join('');

  return '<table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table>';
}

function section_(number, title, subtitle, html) {
  return (
    '<section>' +
    '<h2>' + number + '. ' + esc_(title) + '</h2>' +
    (subtitle ? '<p class="sub">' + esc_(subtitle) + '</p>' : '') +
    html +
    '</section>'
  );
}

/**
 * Real <td>s, not flex or display:table divs — the Apps Script HTML-to-PDF
 * converter is an old renderer and only lays out actual table markup reliably.
 * Same reason the two-up block in section 2 is a table.
 */
function kpi_(value, label) {
  return '<td class="kpi"><div class="v">' + esc_(value) + '</div>' +
    '<div class="l">' + esc_(label) + '</div></td>';
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function buildReport_() {
  var db = loadEverything_();
  var now = new Date();
  var weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  var clubName = db.settings.club_name || 'Key Club';
  var schoolYear = db.settings.school_year || '';
  var goal = num_(db.settings.hours_goal) || 50;

  // ----- indexes -------------------------------------------------------
  var profileById = {};
  var profileByEmail = {};
  db.profiles.forEach(function (p) {
    profileById[p.id] = p;
    profileByEmail[String(p.email).toLowerCase()] = p;
  });

  var memberByEmail = {};
  db.members.forEach(function (m) {
    memberByEmail[String(m.email).toLowerCase()] = m;
  });

  var postById = {};
  db.posts.forEach(function (p) { postById[p.id] = p; });

  var positionLabel = {};
  db.positions.forEach(function (p) { positionLabel[p.id] = p.label; });

  var nameOf = function (userId) {
    var p = profileById[userId];
    return p ? p.full_name : '(deleted account)';
  };
  var emailOf = function (userId) {
    var p = profileById[userId];
    return p ? p.email : '—';
  };
  var titleOf = function (postId) {
    var p = postById[postId];
    return p ? p.title : '(deleted post)';
  };

  // ----- hours rolled up per person ------------------------------------
  var EMPTY_TALLY = { approved: 0, pending: 0, rejected: 0, entries: 0, lastServed: null };
  var tally = {};

  db.hours.forEach(function (h) {
    var t = tally[h.user_id];
    if (!t) {
      t = tally[h.user_id] = { approved: 0, pending: 0, rejected: 0, entries: 0, lastServed: null };
    }
    var amount = num_(h.hours);

    t.entries++;
    if (h.status === 'approved') t.approved += amount;
    else if (h.status === 'pending') t.pending += amount;
    else t.rejected += amount;

    // served_on is a plain date string, so lexical comparison is chronological.
    if (h.status === 'approved' && (!t.lastServed || h.served_on > t.lastServed)) {
      t.lastServed = h.served_on;
    }
  });

  var statOf = function (userId) {
    return tally[userId] || EMPTY_TALLY;
  };

  // ----- signups grouped by event --------------------------------------
  var signupsByPost = {};
  db.signups.forEach(function (s) {
    (signupsByPost[s.post_id] || (signupsByPost[s.post_id] = [])).push(s);
  });

  var activeMembers = db.members.filter(function (m) { return m.active; });
  var events = db.posts.filter(function (p) { return p.category === 'event'; });
  var upcoming = events
    .filter(function (p) { return p.starts_at && new Date(p.starts_at) >= now; })
    .sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });

  var totalApproved = 0;
  var totalPending = 0;
  db.hours.forEach(function (h) {
    if (h.status === 'approved') totalApproved += num_(h.hours);
    else if (h.status === 'pending') totalPending += num_(h.hours);
  });

  var weekEntries = db.hours.filter(function (h) { return new Date(h.created_at) >= weekAgo; });
  var weekHours = weekEntries.reduce(function (sum, h) { return sum + num_(h.hours); }, 0);

  var atGoal = activeMembers.filter(function (m) {
    var p = profileByEmail[String(m.email).toLowerCase()];
    return p && statOf(p.id).approved >= goal;
  }).length;

  var generatedAt = Utilities.formatDate(now, tz_(), 'EEEE, d MMMM yyyy, HH:mm z');
  var weekLabel = fmtDate_(weekAgo) + ' to ' + fmtDate_(now);

  // ================= cover =============================================
  var cover =
    '<div class="cover">' +
    '<div class="eyebrow">Weekly Advisor Report</div>' +
    '<h1>' + esc_(clubName) +
    (schoolYear ? ' <span class="year">' + esc_(schoolYear) + '</span>' : '') + '</h1>' +
    '<p class="generated">Generated ' + esc_(generatedAt) +
    '<br/>Covering the week of ' + esc_(weekLabel) + '</p>' +
    '<table class="kpis"><tr>' +
    kpi_(activeMembers.length, 'Active members') +
    kpi_(hrs_(totalApproved), 'Approved hours YTD') +
    kpi_(hrs_(weekHours), 'Hours logged this week') +
    '</tr><tr>' +
    kpi_(atGoal + ' / ' + activeMembers.length, 'At the ' + goal + '-hour goal') +
    kpi_(hrs_(totalPending), 'Hours awaiting review') +
    kpi_(upcoming.length, 'Upcoming events') +
    '</tr></table>' +
    '<p class="note">Everything below is the club database as it stood at generation time. ' +
    'Sections 1 to 5 are the summary; sections 6 to 12 are the complete records.</p>' +
    '</div>';

  // ================= 1. club logistics =================================
  var settingsRows = [
    ['Club name', dash_(db.settings.club_name)],
    ['School year', dash_(db.settings.school_year)],
    ['Annual hours goal', esc_(goal) + ' hours per member'],
    ['Site URL', dash_(db.settings.site_url)],
    ['Email sender', dash_(db.settings.email_from)],
    ['Reply-to', dash_(db.settings.email_reply_to)],
    ['Weekly member hour emails', yes_(db.settings.weekly_email_enabled)],
    ['This report goes to', esc_(reportRecipients_().join(', '))],
    ['Report timezone', esc_(tz_())],
  ];

  var s1 = section_(1, 'Club logistics', 'From Admin then Settings.',
    table_(['Setting', 'Value'], settingsRows));

  // ================= 2. membership at a glance =========================
  var byGrade = {};
  var byRole = { member: 0, officer: 0, admin: 0 };
  activeMembers.forEach(function (m) {
    var g = m.grade == null ? 'Unspecified' : 'Grade ' + m.grade;
    byGrade[g] = (byGrade[g] || 0) + 1;
    if (byRole[m.role] != null) byRole[m.role]++;
  });

  var gradeRows = Object.keys(byGrade).sort().map(function (g) {
    return [esc_(g), String(byGrade[g])];
  });

  var signedIn = activeMembers.filter(function (m) {
    return !!profileByEmail[String(m.email).toLowerCase()];
  }).length;

  var summaryRows = [
    ['Roster rows, all', String(db.members.length)],
    ['Active members', String(activeMembers.length)],
    ['Inactive or archived', String(db.members.length - activeMembers.length)],
    ['Signed in at least once', String(signedIn) + ' of ' + activeMembers.length],
    ['Never signed in', String(activeMembers.length - signedIn)],
    ['Admins', String(byRole.admin)],
    ['Officers', String(byRole.officer)],
    ['Plain members', String(byRole.member)],
    ['Posts, all categories', String(db.posts.length)],
    ['Events', String(events.length) + ' (' + upcoming.length + ' upcoming)'],
    ['Event signups', String(db.signups.length)],
    ['Hour log entries', String(db.hours.length)],
  ];

  var s2 = section_(2, 'Membership at a glance', null,
    '<table class="two-up"><tr>' +
    '<td class="col">' + table_(['Metric', 'Count'], summaryRows) + '</td>' +
    '<td class="col">' + table_(['Grade', 'Active members'], gradeRows, 'No grades recorded.') + '</td>' +
    '</tr></table>');

  // ================= 3. board ==========================================
  var boardRows = [];
  db.positions.forEach(function (pos) {
    var holders = activeMembers.filter(function (m) { return m.board_position === pos.id; });
    if (!holders.length) {
      boardRows.push([esc_(pos.label), '<span class="warn">vacant</span>', '—', '—']);
      return;
    }
    holders.forEach(function (m) {
      boardRows.push([esc_(pos.label), esc_(m.full_name), esc_(m.email), dash_(m.phone)]);
    });
  });

  var s3 = section_(3, 'Board', 'Elected seats, held separately from account role.',
    table_(['Seat', 'Holder', 'Email', 'Phone'], boardRows, 'No board positions defined.'));

  // ================= 4. hours standings ================================
  var standingRows = activeMembers
    .map(function (m) {
      var p = profileByEmail[String(m.email).toLowerCase()];
      return { m: m, st: p ? statOf(p.id) : EMPTY_TALLY };
    })
    .sort(function (a, b) { return b.st.approved - a.st.approved; })
    .map(function (r) {
      var pct = goal > 0 ? Math.min(100, Math.round((r.st.approved / goal) * 100)) : 0;
      var short = Math.max(0, goal - r.st.approved);
      return [
        esc_(r.m.full_name),
        r.m.grade == null ? '—' : esc_(r.m.grade),
        hrs_(r.st.approved),
        hrs_(r.st.pending),
        pct + '%',
        short === 0 ? '<span class="ok">goal met</span>' : hrs_(short),
        r.st.lastServed ? esc_(r.st.lastServed) : '<span class="warn">never</span>',
        String(r.st.entries),
      ];
    });

  var s4 = section_(4, 'Service hours standings',
    'Active members ranked by approved hours against the ' + goal + '-hour goal.',
    table_(['Member', 'Gr', 'Approved', 'Pending', 'Of goal', 'Short by', 'Last served', 'Entries'],
      standingRows, 'No active members on the roster.'));

  // ================= 5. this week ======================================
  var weekHourRows = weekEntries.map(function (h) {
    return [
      esc_(fmtDate_(h.created_at)),
      esc_(nameOf(h.user_id)),
      hrs_(h.hours),
      esc_(h.served_on),
      esc_(preview_(h.description, 70)),
      esc_(h.status),
    ];
  });

  var newSignups = db.signups.filter(function (s) { return new Date(s.created_at) >= weekAgo; });
  var weekSignupRows = newSignups.map(function (s) {
    return [
      esc_(fmtDateTime_(s.created_at)),
      esc_(nameOf(s.user_id)),
      esc_(titleOf(s.post_id)),
      esc_(s.status),
    ];
  });

  var newPosts = db.posts.filter(function (p) { return new Date(p.created_at) >= weekAgo; });
  var weekPostRows = newPosts.map(function (p) {
    return [
      esc_(fmtDate_(p.created_at)),
      esc_(p.category),
      esc_(p.title),
      p.published ? 'Published' : '<span class="warn">Draft</span>',
      p.author_id ? esc_(nameOf(p.author_id)) : '—',
    ];
  });

  var s5 = section_(5, 'This week', weekLabel,
    '<h3>' + weekEntries.length + ' hour entries logged, ' + hrs_(weekHours) + ' hours</h3>' +
    table_(['Logged', 'Member', 'Hrs', 'Served on', 'Description', 'Status'], weekHourRows,
      'No hours were logged this week.') +
    '<h3>' + newSignups.length + ' new event signups</h3>' +
    table_(['When', 'Member', 'Event', 'Status'], weekSignupRows, 'No new signups this week.') +
    '<h3>' + newPosts.length + ' new posts</h3>' +
    table_(['Created', 'Category', 'Title', 'State', 'Author'], weekPostRows,
      'No new posts this week.'));

  // ================= 6. upcoming events ================================
  var upcomingRows = upcoming.map(function (p) {
    var list = signupsByPost[p.id] || [];
    var going = list.filter(function (s) { return s.status === 'going'; }).length;
    var wait = list.length - going;
    return [
      esc_(fmtDateTime_(p.starts_at)),
      esc_(p.title),
      dash_(p.location),
      p.service_hours == null ? '—' : hrs_(p.service_hours),
      String(going) + (p.capacity ? ' / ' + p.capacity : '') + (wait ? ' (+' + wait + ' wait)' : ''),
      yes_(p.signup_open),
      p.published ? 'Published' : '<span class="warn">Draft</span>',
    ];
  });

  var s6 = section_(6, 'Upcoming events', null,
    table_(['Starts', 'Event', 'Location', 'Hrs', 'Signed up', 'Open', 'State'],
      upcomingRows, 'Nothing scheduled.'));

  // ================= 7. event signup rosters ===========================
  var rosterDetail = events
    .slice()
    .sort(function (a, b) { return new Date(b.starts_at || 0) - new Date(a.starts_at || 0); })
    .map(function (p) {
      var list = (signupsByPost[p.id] || []).slice().sort(function (a, b) {
        return String(nameOf(a.user_id)).localeCompare(String(nameOf(b.user_id)));
      });
      var rows = list.map(function (s) {
        return [
          esc_(nameOf(s.user_id)),
          esc_(emailOf(s.user_id)),
          esc_(s.status),
          yes_(s.attended),
          esc_(fmtDateTime_(s.created_at)),
        ];
      });
      var attended = list.filter(function (s) { return s.attended; }).length;

      return (
        '<h3>' + esc_(p.title) + '</h3>' +
        '<p class="sub">' + esc_(fmtDateTime_(p.starts_at)) +
        (p.ends_at ? ' to ' + esc_(fmtDateTime_(p.ends_at)) : '') +
        (p.location ? ' · ' + esc_(p.location) : '') +
        ' · ' + list.length + ' signed up, ' + attended + ' marked attended</p>' +
        table_(['Member', 'Email', 'Status', 'Attended', 'Signed up'], rows, 'Nobody signed up.')
      );
    })
    .join('');

  var s7 = section_(7, 'Event signup rosters',
    'Every event, newest first, with who signed up and who showed.',
    rosterDetail || '<p class="empty">No events exist yet.</p>');

  // ================= 8. full hours log =================================
  var hoursRows = db.hours.map(function (h) {
    return [
      esc_(h.served_on),
      esc_(nameOf(h.user_id)),
      hrs_(h.hours),
      esc_(h.description),
      h.post_id ? esc_(titleOf(h.post_id)) : '—',
      esc_(h.status),
      h.created_by ? esc_(nameOf(h.created_by)) : '—',
      h.reviewed_by
        ? esc_(nameOf(h.reviewed_by)) +
          '<br/><span class="muted">' + esc_(fmtDate_(h.reviewed_at)) + '</span>'
        : '—',
      dash_(h.review_note),
    ];
  });

  var s8 = section_(8, 'Complete service hours log',
    db.hours.length + ' entries, newest service date first.',
    table_(['Served on', 'Member', 'Hrs', 'Description', 'Event', 'Status',
      'Entered by', 'Reviewed by', 'Note'], hoursRows, 'No hours have been logged.'));

  // ================= 9. full roster ====================================
  var rosterRows = db.members.map(function (m) {
    var p = profileByEmail[String(m.email).toLowerCase()];
    return [
      esc_(m.full_name),
      esc_(m.email),
      m.grade == null ? '—' : esc_(m.grade),
      m.graduation_year == null ? '—' : esc_(m.graduation_year),
      dash_(m.phone),
      esc_(m.role),
      m.board_position ? esc_(positionLabel[m.board_position] || m.board_position) : '—',
      m.active ? 'Active' : '<span class="warn">Inactive</span>',
      p ? esc_(fmtDate_(p.created_at)) : '<span class="warn">never signed in</span>',
      esc_(fmtDate_(m.created_at)),
      dash_(m.notes),
    ];
  });

  var s9 = section_(9, 'Complete roster', 'Every row in the members table, inactive included.',
    table_(['Name', 'Email', 'Gr', 'Grad', 'Phone', 'Role', 'Seat', 'Status',
      'Account since', 'Added', 'Notes'], rosterRows, 'The roster is empty.'));

  // ================= 10. profiles ======================================
  var profileRows = db.profiles.map(function (p) {
    var onRoster = memberByEmail[String(p.email).toLowerCase()];
    return [
      esc_(p.full_name),
      esc_(p.email),
      dash_(p.title),
      dash_(p.pronouns),
      p.board_position ? esc_(positionLabel[p.board_position] || p.board_position) : '—',
      esc_(p.role),
      esc_(preview_(p.bio, 90)) || '—',
      onRoster ? 'Yes' : '<span class="warn">no roster row</span>',
      esc_(fmtDate_(p.updated_at)),
    ];
  });

  var s10 = section_(10, 'Member profiles', 'What members have filled in about themselves.',
    table_(['Name', 'Email', 'Title', 'Pronouns', 'Seat', 'Role', 'Bio', 'On roster', 'Updated'],
      profileRows, 'Nobody has signed in yet.'));

  // ================= 11. posts index ===================================
  var postRows = db.posts.map(function (p) {
    return [
      esc_(fmtDate_(p.created_at)),
      esc_(p.category),
      esc_(p.title) + (p.pinned ? ' <span class="pin">pinned</span>' : ''),
      p.published ? 'Published' : '<span class="warn">Draft</span>',
      p.author_id ? esc_(nameOf(p.author_id)) : '—',
      esc_(preview_(p.summary || p.body, 110)),
    ];
  });

  var s11 = section_(11, 'All posts, notices and events', 'Newest first.',
    table_(['Created', 'Category', 'Title', 'State', 'Author', 'Summary'],
      postRows, 'No posts yet.'));

  // ================= 12. delivery log ==================================
  var logRows = db.emailLog.map(function (e) {
    return [
      esc_(fmtDateTime_(e.sent_at)),
      esc_(e.kind),
      String(e.recipients),
      e.failures ? '<span class="warn">' + esc_(e.failures) + '</span>' : '0',
      esc_(preview_(e.detail, 80)) || '—',
    ];
  });

  var s12 = section_(12, 'Automated email log',
    'Last 25 runs of every scheduled email, this report included.',
    table_(['Sent', 'Kind', 'Recipients', 'Failures', 'Detail'], logRows,
      'No sends recorded yet.'));

  // ================= assemble ==========================================
  var html =
    '<!doctype html><html><head><meta charset="utf-8"/><style>' + reportCss_() +
    '</style></head><body>' +
    cover +
    s1 + s2 + s3 + s4 +
    '<div class="break"></div>' + s5 + s6 + s7 +
    '<div class="break"></div>' + s8 +
    '<div class="break"></div>' + s9 + s10 + s11 + s12 +
    '<p class="footer">' + esc_(clubName) + ' · generated ' + esc_(generatedAt) +
    ' · contains member contact details, handle accordingly.</p>' +
    '</body></html>';

  var stamp = Utilities.formatDate(now, tz_(), 'yyyy-MM-dd');
  var base = clubName.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') + '-Report-' + stamp;

  var pdf = Utilities.newBlob(html, MimeType.HTML, base + '.html')
    .getAs(MimeType.PDF)
    .setName(base + '.pdf');

  var body =
    clubName + ' — weekly report for ' + weekLabel + '\n\n' +
    'Active members: ' + activeMembers.length + '\n' +
    'Approved hours year to date: ' + hrs_(totalApproved) + '\n' +
    'Hours logged this week: ' + hrs_(weekHours) + ' across ' + weekEntries.length + ' entries\n' +
    'At the ' + goal + '-hour goal: ' + atGoal + ' of ' + activeMembers.length + '\n' +
    'Hours awaiting review: ' + hrs_(totalPending) + '\n' +
    'Upcoming events: ' + upcoming.length + '\n\n' +
    'The attached PDF has the full breakdown: club settings, board, per-member standings, ' +
    "this week's activity, every event roster, the complete hours log, the full roster, " +
    'member profiles, and every post.\n' +
    (db.settings.site_url ? '\n' + db.settings.site_url + '\n' : '') +
    '\nAutomated, sent every Sunday at 9 PM.';

  return {
    pdf: pdf,
    subject: clubName + ' — Weekly Report, ' + Utilities.formatDate(now, tz_(), 'd MMMM yyyy'),
    body: body,
    senderName: clubName + ' Reports',
  };
}

function reportCss_() {
  return [
    '@page { size: A4 portrait; margin: 34pt 30pt; }',
    'body { font-family: Helvetica, Arial, sans-serif; font-size: 8.5pt; color: #16233a; margin: 0; }',
    '.cover { border-bottom: 3px solid #1e4a89; padding-bottom: 16px; margin-bottom: 18px; }',
    '.eyebrow { font-size: 8pt; letter-spacing: 1.6px; text-transform: uppercase;',
    '           color: #1e4a89; font-weight: bold; }',
    'h1 { font-size: 26pt; margin: 4px 0 2px; color: #0f2340; }',
    'h1 .year { font-size: 13pt; color: #6b7890; font-weight: normal; }',
    '.generated { margin: 0 0 14px; color: #6b7890; font-size: 8.5pt; }',
    '.kpis { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 5px; }',
    'td.kpi { background: #f3f6fb; border: 1px solid #dde4ef; padding: 8px 9px; width: 33%; }',
    '.kpi .v { font-size: 15pt; font-weight: bold; color: #0f2340; line-height: 1.1; }',
    '.kpi .l { font-size: 6.8pt; color: #6b7890; text-transform: uppercase;',
    '          letter-spacing: 0.4px; margin-top: 3px; }',
    '.note { margin: 12px 0 0; font-size: 8pt; color: #6b7890; font-style: italic; }',
    'section { margin: 0 0 20px; }',
    'h2 { font-size: 12.5pt; color: #0f2340; margin: 0 0 2px; padding-bottom: 4px;',
    '     border-bottom: 1.5px solid #1e4a89; }',
    'h3 { font-size: 9.5pt; color: #1e4a89; margin: 14px 0 4px; }',
    '.sub { margin: 0 0 8px; color: #6b7890; font-size: 8pt; }',
    'table { width: 100%; border-collapse: collapse; margin: 0 0 6px; }',
    'th { background: #0f2340; color: #ffffff; text-align: left; font-size: 7.4pt;',
    '     text-transform: uppercase; letter-spacing: 0.4px; padding: 5px 6px; }',
    'td { border-bottom: 1px solid #e4e8ef; padding: 4px 6px; vertical-align: top; font-size: 8.2pt; }',
    'tbody tr:nth-child(even) td { background: #f8fafc; }',
    '.two-up { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 8px 0; }',
    'td.col { vertical-align: top; padding: 0; border-bottom: none; background: none; }',
    '.empty { color: #8a97ad; font-style: italic; font-size: 8pt; margin: 2px 0 8px; }',
    '.warn { color: #b23c17; font-weight: bold; }',
    '.ok { color: #1a7f52; font-weight: bold; }',
    '.muted { color: #8a97ad; font-size: 7.4pt; }',
    '.pin { background: #e5ad2c; color: #3a2c05; font-size: 6.6pt; padding: 1px 4px; border-radius: 3px; }',
    '.break { page-break-before: always; }',
    '.footer { margin-top: 22px; padding-top: 8px; border-top: 1px solid #dde4ef;',
    '          color: #8a97ad; font-size: 7.4pt; }',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Trigger management
// ---------------------------------------------------------------------------

/**
 * Sunday 9 PM in the project's timezone — set that to Seoul under Project
 * Settings. Apps Script fires within the named hour, so it lands 21:00-22:00.
 */
function createAdvisorReportTrigger() {
  deleteAdvisorReportTrigger();

  ScriptApp.newTrigger('sendWeeklyAdvisorReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(21)
    .create();

  Logger.log('Scheduled: Sundays at 21:00 (%s) to %s',
    Session.getScriptTimeZone(), reportRecipients_().join(', '));
}

/** Cancels the weekly report. */
function deleteAdvisorReportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendWeeklyAdvisorReport') ScriptApp.deleteTrigger(t);
  });
}
