/**
 * Key Club — Member On-Track Report.
 *
 * Emails you the same table as the "Key Club Member On-Track Report" sheet:
 * one row per active member, sorted by tier, with their Key Club hours,
 * what's still needed, and every event behind the total. The table is in
 * the email body, and the same thing is attached as a PDF named like the
 * sheet export ("11_11_2026 Key Club Member On-Track Report.pdf").
 *
 * Reads the member_hours_standing view (supabase/010_hours_standing.sql),
 * the same data StandingEmail.gs uses, so the numbers always match.
 *
 * SETUP: add this file to the SAME Apps Script project as the other Key
 * Club emails. It reuses the SUPABASE_URL and SUPABASE_SERVICE_KEY script
 * properties. Then:
 *   1. Run sendOnTrackReport(): the report comes to you right away
 *   2. Optional: run createOnTrackTrigger() to get it every Wednesday at
 *      5 PM, an hour before the standing emails go to members
 *
 * Members never get this email. It only goes to the addresses below.
 */

// Who gets the report. Empty = the Google account that owns the script.
var OT_RECIPIENTS = [
  // 'you@example.com',
];

// Tier order and the labels/colours from the sheet.
var OT_TIERS = {
  complete:  { label: '1. 25+ Hours', bg: '#b6d7a8' },
  club_done: { label: '2. 10+ Hours', bg: '#d9ead3' },
  on_pace:   { label: '3. On pace',   bg: '#fff2cc' },
  behind:    { label: '4. Behind',    bg: '#f4cccc' },
  danger:    { label: '5. Danger',    bg: '#e6b8af' },
};
var OT_ORDER = ['complete', 'club_done', 'on_pace', 'behind', 'danger'];

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Builds the report and emails it now. */
function sendOnTrackReport() {
  var report = buildOnTrackReport_();
  var to = otRecipients_();
  MailApp.sendEmail({
    to: to.join(','),
    subject: report.title,
    htmlBody: report.html,
    body: report.text,
    name: 'Key Club Hour Tracker',
    attachments: [report.pdf],
  });
  Logger.log('Sent "%s" (%s members) to %s', report.title, report.count, to.join(', '));
}

/** Logs the rows and saves the PDF to your Drive. Emails nobody. */
function previewOnTrackReport() {
  var report = buildOnTrackReport_();
  var file = DriveApp.createFile(report.pdf);
  Logger.log('%s members. PDF preview: %s', report.count, file.getUrl());
  Logger.log(report.text);
}

/** Every Wednesday, 5 to 6 PM in the project's time zone (set it to Seoul). */
function createOnTrackTrigger() {
  deleteOnTrackTrigger();
  ScriptApp.newTrigger('sendOnTrackReport')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.WEDNESDAY)
    .atHour(17)
    .create();
  Logger.log('Scheduled: Wednesdays at 17:00 (%s).', Session.getScriptTimeZone());
}

function deleteOnTrackTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendOnTrackReport') ScriptApp.deleteTrigger(t);
  });
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function otRecipients_() {
  return OT_RECIPIENTS.length ? OT_RECIPIENTS : [Session.getEffectiveUser().getEmail()];
}

function otFetch_(path) {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    throw new Error('Missing script properties. Add SUPABASE_URL and SUPABASE_SERVICE_KEY ' +
      'under Project Settings -> Script properties.');
  }
  var res = UrlFetchApp.fetch(url.replace(/\/$/, '') + path, {
    muteHttpExceptions: true,
    headers: { apikey: key, Authorization: 'Bearer ' + key },
  });
  var code = res.getResponseCode();
  var text = res.getContentText();
  if (code < 200 || code >= 300) throw new Error('Supabase ' + code + ' on ' + path + ': ' + text);
  return text ? JSON.parse(text) : null;
}

/**
 * Sheet order: by tier, then whoever has the most still to do first, then
 * by name.
 */
function otRows_() {
  var rows = otFetch_('/rest/v1/member_hours_standing?select=*');
  rows.sort(function (a, b) {
    return (OT_ORDER.indexOf(a.tier) - OT_ORDER.indexOf(b.tier)) ||
      (Number(b.total_still_needed) - Number(a.total_still_needed)) ||
      String(a.full_name).localeCompare(String(b.full_name));
  });
  return rows;
}

/** 10.5 -> "10.5", 4 -> "4", 0.6667 -> "0.67" */
function otNum_(n) {
  return String(Math.round(Number(n || 0) * 100) / 100);
}

/** ["Plogging (4.0h)", ...] oldest first, or ["N/A"]. */
function otEvents_(row) {
  var events = Array.isArray(row.events) ? row.events : [];
  if (!events.length) return ['N/A'];
  return events.map(function (e) {
    return e.event + ' (' + Number(e.hours).toFixed(1) + 'h)';
  });
}

function otEsc_(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

var OT_COLUMNS = ['Tier', 'Full Name', 'Grade', 'Club Hours', 'Club Hours Still Needed',
  'Total Hours Still Needed', 'Times Served', 'Last Served', 'Events', 'Email'];

function buildOnTrackReport_() {
  var rows = otRows_();
  var tz = Session.getScriptTimeZone() || 'Asia/Seoul';
  var now = new Date();
  var title = Utilities.formatDate(now, tz, 'MM_dd_yyyy') + ' Key Club Member On-Track Report';

  var cell = 'padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:middle;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000000;';
  var head = '<tr>' + OT_COLUMNS.map(function (c) {
    return '<th style="padding:8px 10px;background:#d9d9d9;border-top:1px solid #000000;' +
      'border-bottom:1px solid #000000;font-family:Arial,Helvetica,sans-serif;font-size:11px;' +
      'font-weight:bold;color:#000000;text-align:' + (c === 'Tier' || c === 'Events' || c === 'Email' ? 'center' : 'left') +
      ';white-space:nowrap;">' + c + '</th>';
  }).join('') + '</tr>';

  var body = rows.map(function (r) {
    var tier = OT_TIERS[r.tier] || { label: r.tier, bg: '#ffffff' };
    var last = r.last_served_on || 'N/A';
    return '<tr>' +
      '<td style="' + cell + 'background:' + tier.bg + ';white-space:nowrap;width:110px;">' + otEsc_(tier.label) + '</td>' +
      '<td style="' + cell + 'white-space:nowrap;">' + otEsc_(r.full_name) + '</td>' +
      '<td style="' + cell + '">' + otEsc_(r.grade == null ? '' : r.grade) + '</td>' +
      '<td style="' + cell + '">' + otNum_(r.club_hours) + '</td>' +
      '<td style="' + cell + '">' + otNum_(r.club_hours_still_needed) + '</td>' +
      '<td style="' + cell + '">' + otNum_(r.total_still_needed) + '</td>' +
      '<td style="' + cell + '">' + otEsc_(r.times_served) + '</td>' +
      '<td style="' + cell + 'white-space:nowrap;">' + otEsc_(last) + '</td>' +
      '<td style="' + cell + 'font-size:10px;line-height:1.35;">' + otEvents_(r).map(otEsc_).join('<br>') + '</td>' +
      '<td style="' + cell + 'white-space:nowrap;">' + otEsc_(r.email) + '</td>' +
      '</tr>';
  }).join('');

  var table =
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;">' +
    head + body + '</table>';

  var html =
    '<div style="font-family:Arial,Helvetica,sans-serif;color:#000000;">' +
    '<div style="font-size:16px;font-weight:bold;margin:0 0 4px;">' + otEsc_(title.replace(/_/g, '/')) + '</div>' +
    '<div style="font-size:12px;color:#555555;margin:0 0 14px;">' + rows.length + ' active members</div>' +
    table + '</div>';

  var pdf = otSheetPdf_(rows, title);

  var text = OT_COLUMNS.join(' | ') + '\n' + rows.map(function (r) {
    var tier = OT_TIERS[r.tier] || { label: r.tier };
    return [tier.label, r.full_name, r.grade, otNum_(r.club_hours), otNum_(r.club_hours_still_needed),
      otNum_(r.total_still_needed), r.times_served, r.last_served_on || 'N/A',
      otEvents_(r).join('; '), r.email].join(' | ');
  }).join('\n');

  return { title: title, html: html, text: text, pdf: pdf, count: rows.length };
}

// ---------------------------------------------------------------------------
// The PDF. Google's HTML-to-PDF converter throws away colours, widths and
// landscape, so this does what the original did: lay the table out in a
// Google Sheet, export that sheet as a PDF, then delete the sheet.
// ---------------------------------------------------------------------------

// Column widths in pixels, matching the sheet the report came from.
var OT_WIDTHS = [130, 120, 55, 80, 160, 165, 95, 90, 230, 230];

function otSheetPdf_(rows, title) {
  var ss = SpreadsheetApp.create(title);
  var id = ss.getId();
  try {
    var sh = ss.getSheets()[0];
    var cols = OT_COLUMNS.length;
    var values = [OT_COLUMNS].concat(rows.map(function (r) {
      var tier = OT_TIERS[r.tier] || { label: r.tier };
      return [tier.label, r.full_name, r.grade == null ? '' : String(r.grade),
        otNum_(r.club_hours), otNum_(r.club_hours_still_needed), otNum_(r.total_still_needed),
        String(r.times_served), r.last_served_on || 'N/A', otEvents_(r).join('\n'), r.email];
    }));

    var all = sh.getRange(1, 1, values.length, cols);
    // Plain text everywhere, so numbers sit on the left like the original.
    all.setNumberFormat('@').setValues(values)
      .setFontFamily('Arial').setFontSize(9).setVerticalAlignment('middle')
      .setHorizontalAlignment('left').setWrap(false);

    // Header: grey, bold, centred, black rule above and below.
    sh.getRange(1, 1, 1, cols)
      .setBackground('#d9d9d9').setFontWeight('bold').setFontSize(10)
      .setHorizontalAlignment('center')
      .setBorder(true, true, true, true, false, false, '#000000', SpreadsheetApp.BorderStyle.SOLID);
    sh.setFrozenRows(1); // repeats the header on page 2

    if (rows.length) {
      // Tier colour on the first column only.
      sh.getRange(2, 1, rows.length, 1).setBackgrounds(rows.map(function (r) {
        return [(OT_TIERS[r.tier] || { bg: '#ffffff' }).bg];
      }));
      // Events stack one per line and are a size smaller, like the sheet.
      sh.getRange(2, 9, rows.length, 1).setWrap(true).setFontSize(8);
    }

    OT_WIDTHS.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
    sh.setRowHeight(1, 28);
    for (var i = 0; i < rows.length; i++) {
      var lines = Math.max(1, otEvents_(rows[i]).length);
      sh.setRowHeight(i + 2, Math.max(26, 12 * lines + 14));
    }
    // Drop the empty grid around the table so the export is just the table.
    if (sh.getMaxColumns() > cols) sh.deleteColumns(cols + 1, sh.getMaxColumns() - cols);
    if (sh.getMaxRows() > values.length) sh.deleteRows(values.length + 1, sh.getMaxRows() - values.length);
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + id + '/export' +
      '?format=pdf&size=letter&portrait=false&fitw=true' +
      '&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED' +
      '&fzr=true&top_margin=0.75&bottom_margin=0.75&left_margin=0.5&right_margin=0.5' +
      '&gid=' + sh.getSheetId();
    var res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) {
      throw new Error('PDF export failed (' + res.getResponseCode() + '): ' + res.getContentText().slice(0, 200));
    }
    return res.getBlob().setName(title + '.pdf');
  } finally {
    // The sheet was only scaffolding.
    DriveApp.getFileById(id).setTrashed(true);
  }
}
