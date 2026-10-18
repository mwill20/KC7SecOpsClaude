// Plain-language feedback for every parser, safety and comparison code. Tested for completeness.
export const MESSAGES = Object.freeze({
  EMPTY_QUERY: ['Nothing to run yet.', 'Type at least one condition, such as metadata.event_type = "USER_LOGIN".'],
  STARTER_GAP: ['The starter still has a ___ gap.', 'Replace the three underscores with the missing piece; the Read the query card and the first hint say what kind of piece it is.'],
  QUERY_TOO_LONG: ['That query is bigger than the trainer runs.', 'Keep it under 8 KB and a couple of dozen conditions.'],
  UNCLOSED_STRING: ['A quoted value was opened but never closed.', 'Every " needs a matching " on the same line.'],
  BAD_ESCAPE: ['A backslash inside quotes is escaping something unexpected.', 'Inside double quotes, write \\\\ for one backslash and \\" for a quote.'],
  UNCLOSED_REGEX: ['A regex was opened with / but never closed.', 'Close the pattern with another / before the end of the line.'],
  UNCLOSED_COMMENT: ['A /* comment has no closing */.', 'Add */ or use // for a single-line comment.'],
  BAD_OPERATOR: ['That comparison operator is not one Search knows.', 'Use =, !=, <, <=, > or >=.'],
  LOOKS_LIKE_KQL: ['This looks like KQL, not YARA-L.', 'Search has no pipes. Write conditions as field = "value" on separate lines, and summarise with match: and outcome:.'],
  LOOKS_LIKE_SQL: ['This looks like SQL.', 'Search filters are plain conditions, not SELECT statements.'],
  LOOKS_LIKE_RULE: ['This looks like a detection rule.', 'Search takes the body only: no rule name, braces or meta section.'],
  COUNT_CHARACTER: ['#var counts the events of one variable in a two-event query, inside condition only.', 'Write two event variables joined by a placeholder, then condition: #e1 > 0 and #e2 > 1. In a single-event query count with an outcome instead: $n = count(metadata.id).'],
  UNQUOTED_IP: ['An IP address needs quotes.', 'Write principal.ip = "10.9.4.22".'],
  UNEXPECTED_CHARACTER: ['There is a character here Search does not expect.', 'Check for stray punctuation, smart quotes or a missing operator.'],
  TOO_MANY_EVENT_VARS: ['Three or more event variables in one query is real Google syntax this trainer does not run.', 'Here a query joins at most two event variables ($e1 and $e2) through a shared placeholder. Split a three-way question into two joins.'],
  UNJOINED_VARIABLE: ['Two event variables, but nothing joins them.', 'Set the same placeholder from both events: $e1.principal.user.userid = $account and $e2.principal.user.userid = $account. That placeholder is the join key and goes in match:.'],
  BARE_FIELD_IN_JOIN: ['A field in a two-event query must say which event it belongs to.', 'Write $e1.metadata.event_type = "USER_LOGIN", not metadata.event_type = "USER_LOGIN", so each condition filters one event.'],
  MIXED_EVENT_VARS: ['One condition reads two event variables, which this trainer does not run.', 'Keep each condition on one event ($e1.field = "x") and join the events with a shared placeholder. An OR across two events is real Google syntax reported as not run here.'],
  SHARED_PLACEHOLDER_COMPARED: ['A join placeholder cannot be compared to a value in the filter.', 'It is set by both events, so compare the field of one event instead: $e1.principal.user.userid = "lena.ostrowski".'],
  MATCH_KEY_NOT_SHARED: ['In a two-event query, match: groups by a placeholder both events set.', 'Name the join placeholder, such as $account, under match:. A field of one event or a placeholder only one event sets cannot group a join here.'],
  OUTCOME_NEEDS_VARIABLE: ['In a two-event query, each outcome aggregates one event variable.', 'Write count($e1.metadata.id) or array_distinct($e2.target.ip): the $e1 or $e2 says which events the aggregate reads.'],
  UNKNOWN_EVENT_VAR: ['condition names an event variable the filter never used.', '#e1 and $e1 refer to the variables in the filter above; check the spelling against them.'],
  NON_EXISTENCE: ['A non-existence condition is real Google syntax this trainer does not run.', 'Google documents that a condition needs at least one bounded event: #e2 = 0 or not $e2 asks for events that did not happen, which this trainer cannot answer. Keep bounded tests such as #e2 > 0 or #e2 >= 2.'],
  MULTI_EVENT_NEEDS_MATCH: ['A two-event query needs a match section.', 'Add match: with the join placeholder, for example match: $account over 1h, so the join has a key and a window.'],
  OVER_NEEDS_KEY: ['match: needs a key before the window.', 'Write match: $account over 1h or match: principal.user.userid by 5m. The window alone has nothing to group.'],
  ENTITY_MIX: ['Entity fields (graph.*) and event fields cannot share one filter.', 'Query entities alone (graph.entity.user.userid != ""), or join an event to an entity with two variables: $e.principal.user.userid = $uid and $u.graph.entity.user.userid = $uid.'],
  ENTITY_JOIN_ONLY: ['Joining two entity variables is not run here.', 'Join an event variable to an entity variable; entity-to-entity joins are not part of this trainer.'],
  ENTITY_WINDOW: ['An entity join takes no time window.', 'Entity records are valid over an interval, not at an instant: the event joins the record that was valid at its time. Remove over or by from match:.'],
  UNKNOWN_FIELD: ['That field name is not in the dataset.', 'Check the spelling against the field list in the desk; UDM paths are dotted and lower case.'],
  EXPECTED_FIELD: ['A field name was expected here.', 'Conditions start with a UDM field such as principal.hostname.'],
  EXPECTED_VALUE: ['A value was expected after the operator.', 'Text and enums go in double quotes; numbers are bare; patterns go between slashes.'],
  UNQUOTED_ENUM: ['An enum value needs double quotes.', 'Write metadata.event_type = "USER_LOGIN", quotes included.'],
  EXPECTED_PAREN: ['A parenthesis is missing or unbalanced.', 'Every ( needs a ), including around function arguments.'],
  EXPECTED_COMMA: ['A comma was expected between function arguments.', 'Example: net.ip_in_range_cidr(target.ip, "203.0.113.0/24").'],
  UNSUPPORTED_FUNCTION: ['That function is real Google syntax this trainer does not run.', 'Here you can use re.regex, net.ip_in_range_cidr, timestamp.get_hour, timestamp.get_minute, timestamp.get_date, strings.to_lower, strings.to_upper and strings.concat. The others are documented on the YARA-L functions pages.'],
  TIMESTAMP_FN_NEEDS_TIMESTAMP: ['The timestamp functions take the event timestamp.', 'Write timestamp.get_hour(metadata.event_timestamp, "UTC"); the second argument is the time zone.'],
  TIMEZONE_NEEDS_STRING: ['The time zone is a quoted string.', 'Write "UTC" as the second argument.'],
  TIMEZONE_UNSUPPORTED: ['That time zone is valid in Google SecOps, but this trainer reads the dataset in UTC only.', 'Google accepts TZ database names such as "America/Los_Angeles" and offsets such as "-08:00". Here, write "UTC" (or leave the argument out: Google defaults to GMT) so the hours match the clock times in the results.'],
  STRING_FN_NEEDS_STRING: ['strings.to_lower and strings.to_upper take one text field.', 'Example: strings.to_lower(principal.hostname) = "automation-01". Numeric fields and literals do not belong inside.'],
  CONCAT_NEEDS_ARGS: ['strings.concat joins two or more values.', 'Example: strings.concat(principal.hostname, ":", principal.user.userid).'],
  TIME_AGGREGATE_NEEDS_TIMESTAMP: ['earliest and latest take the event timestamp.', 'Write $first = earliest(metadata.event_timestamp). For other fields use min and max.'],
  CONDITION_ON_ARRAY: ['condition cannot compare a list.', 'array and array_distinct produce lists; count the values with count_distinct if you want a threshold.'],
  ORDER_ON_ARRAY: ['order cannot sort by a list.', 'Sort by a count or a sum instead, and keep the array as a column.'],
  DEDUP_KEY_NOT_GROUPED: ['dedup on a summary table can only use its grouping keys or outcome names.', 'Name a field from match: or a $outcome. On a plain event query, dedup takes any event field or placeholder.'],
  BAD_LIST_NAME: ['A reference list is named with % and a plain name; a data table column as %table.column.', 'Examples: principal.ip in cidr %blocked_ranges, or principal.ip in cidr %gateway_blocks.range. Names use letters, digits and underscores.'],
  EXPECTED_LIST: ['After in, name a reference list with % or a data table column with %table.column.', 'Examples: network.dns.questions.name in %sponsor_domains, or in %station_allowlist.domain. The Lists and tables panel on the desk shows what exists here.'],
  UNKNOWN_LIST: ['That reference list does not exist in this trainer.', 'Open the Lists and tables panel on the desk for the lists and tables bundled here. In a tenant, lists live under Detection > Lists and must exist before a query can name them; a data table column is written %table.column.'],
  UNKNOWN_TABLE: ['That data table does not exist in this trainer.', 'Open the Lists and tables panel on the desk for the tables bundled here. In a tenant, data tables live under Detection > Data tables and must exist before a query can name them.'],
  UNKNOWN_TABLE_COLUMN: ['The data table exists, but not that column.', 'Write %table.column with a column the Lists and tables panel shows for that table.'],
  LIST_AS_VALUE: ['Comparing a field to a reference list or data table with = is rule syntax, not Search.', 'In Search, test membership with in: field in %name, in regex %name or in cidr %name (or %table.column). Joining an event to a data table row with = is documented for rules.'],
  LIST_TYPE_MISMATCH: ['The keyword after in must match the list or column type.', 'A string list or column is used as in %name, a CIDR one as in cidr %name, a regex one as in regex %name. The Lists and tables panel shows each type.'],
  LIST_NEEDS_IP: ['A CIDR list or column tests an IP field.', 'Use principal.ip or target.ip before in cidr %name.'],
  LIST_ON_NUMBER: ['A numeric field cannot be tested against a reference list or data table.', 'Lists and columns hold strings, ranges or patterns; compare numbers with =, < and >.'],
  NOCASE_ON_CIDR_LIST: ['nocase does not apply to a CIDR list or column.', 'Remove nocase; addresses have no case. nocase works with string and regex lists only.'],
  TOO_MANY_LISTS: ['Too many list or table tests in one query: Search allows seven.', 'Google caps in statements at seven per Search query (ten in a rule), counting lists and data-table columns together. Combine the lists or split the question into two queries.'],
  TOO_MANY_REGEX_LISTS: ['Too many in regex tests in one query: Search allows four.', 'Google caps in regex statements at four per Search query (five in a rule). Merge the patterns into one regex list or run two queries.'],
  TOO_MANY_CIDR_LISTS: ['Too many in cidr tests in one query: Search allows two.', 'Google caps in cidr statements at two per Search query (five in a rule). Put the ranges in one CIDR list or run two queries.'],
  EXPECTED_OPERATOR: ['A comparison operator was expected after the field.', 'Example: security_result.action = "FAIL".'],
  BINDING_OPERATOR: ['A placeholder is set with =, nothing else.', 'Write $account = principal.user.userid.'],
  BINDING_SHAPE: ['A placeholder pairs one $name with one field.', 'Write $name = field, with a UDM field on one side.'],
  REGEX_OPERATOR: ['Regex patterns work with = and != only.', 'Use field = /pattern/ or field != /pattern/.'],
  REGEX_EMPTY: ['The regex is empty.', 'Put a pattern between the slashes.'],
  REGEX_TOO_LONG: ['That regex is longer than the trainer accepts.', 'Keep patterns under 80 characters.'],
  REGEX_BACKREFERENCE: ['Backreferences such as \\1 are not RE2.', 'Google uses RE2, which has no backreferences. Rewrite the pattern without them.'],
  REGEX_LOOKAROUND: ['Lookaround such as (?= is not RE2.', 'Google uses RE2, which has no lookaround. Match the text directly instead.'],
  REGEX_NESTED_QUANTIFIER: ['That pattern has a nested repeat that can run away.', 'Avoid shapes like (a+)+. Match one piece at a time.'],
  REGEX_RANGE_TOO_LARGE: ['A {n} repeat in the pattern is too large.', 'Keep counted repeats under 64.'],
  REGEX_INVALID: ['The regex does not parse.', 'Check for an unclosed group or bracket.'],
  BAD_CIDR: ['The CIDR range is not valid.', 'Write it as a quoted string such as "203.0.113.0/24".'],
  EXPECTED_COLON: ['A section name needs a colon.', 'Write match:, outcome:, condition:, dedup:, order: or limit:.'],
  MISSING_FILTER: ['The query starts with a section but has no filter.', 'Put at least one condition before match: or outcome:.'],
  BINDING_CONTEXT: ['A placeholder cannot be set inside OR or NOT.', 'Move $name = field to its own line at the top level.'],
  BINDING_DUPLICATE: ['The same placeholder was set twice by the same event.', 'Set each $name once per event. Setting it from two different events ($e1.x = $k and $e2.y = $k) is how a join is written.'],
  UNBOUND_VARIABLE: ['A $name was used that was never set.', 'Add $name = field in the filter before using it in match or outcome.'],
  GROUPED_FIELD_HERE: ['Grouped fields such as ip or hostname work in the filter only.', 'In match or outcome, name the exact field, such as principal.hostname.'],
  CIDR_NEEDS_IP: ['net.ip_in_range_cidr needs an IP field.', 'Use principal.ip or target.ip as the first argument.'],
  REGEX_ON_NUMBER: ['A regex cannot be applied to a numeric field.', 'Compare numbers with =, <, > and friends.'],
  NUMBER_NEEDS_NUMBER: ['This numeric field was compared with text.', 'Write numbers bare: target.port = 443.'],
  NOCASE_ON_NUMBER: ['nocase only applies to text.', 'Remove nocase from the numeric comparison.'],
  STRING_NEEDS_QUOTES: ['This text field was compared with a bare number or word.', 'Put the value in double quotes.'],
  STRING_OPERATOR: ['Text fields compare with = and != only.', 'Use < and > for numbers.'],
  UNSUPPORTED_SECTION: ['That section is real Google syntax this trainer does not run.', 'option and unselect are documented; this course covers match, outcome, condition, dedup, order and limit.'],
  UNEXPECTED_TOKEN: ['Something appears after the filter that is not a section.', 'After the conditions, only match:, outcome:, condition:, dedup:, order: and limit: may follow.'],
  SECTION_ORDER: ['Sections are out of order.', 'The order is match, outcome, condition, dedup, order, limit.'],
  TOO_MANY_KEYS: ['Too many keys.', 'Group or dedup by four fields or fewer.'],
  OVER_WINDOW: ['over N on a single-event query is the rule-engine window; Google\'s statistics page says Search does not support it.', 'For a time bucket write by 5m or over every 5m. over 1h is accepted here only on a two-event join, as Google\'s conditions page writes it.'],
  BAD_WINDOW: ['The time window after by is not valid.', 'Write by 5m, by 1h or by 1d.'],
  DUPLICATE_KEY: ['The same key appears twice.', 'List each match or dedup key once.'],
  OUTCOME_NAME: ['Each outcome needs a $name.', 'Write $failures = count(metadata.id).'],
  OUTCOME_SHADOWS_BINDING: ['An outcome reused a placeholder name.', 'Give the outcome a different $name.'],
  EXPECTED_AGGREGATE: ['An aggregate function was expected.', 'Use count, count_distinct, sum, max, min, array, array_distinct, earliest or latest.'],
  UNSUPPORTED_AGGREGATE: ['That aggregate is real Google syntax this trainer does not run.', 'Here you can use count, count_distinct, sum, max, min, array, array_distinct, earliest and latest.'],
  AGGREGATE_NEEDS_NUMBER: ['sum, max and min need a numeric field.', 'Use network.sent_bytes, network.received_bytes or target.port.'],
  DUPLICATE_OUTCOME: ['Two outcomes share a name.', 'Give each outcome its own $name.'],
  CONDITION_NEEDS_MATCH: ['condition needs a match section.', 'Group first, then filter the groups. Without grouping, read the single row yourself.'],
  CONDITION_SHAPE: ['condition compares outcome variables to numbers.', 'Example: $failures > 3.'],
  CONDITION_UNKNOWN_OUTCOME: ['condition refers to a $name that is not an outcome.', 'Define it in outcome: first.'],
  CONDITION_NEEDS_NUMBER: ['condition compares against a number.', 'Example: $failures >= 3.'],
  ORDER_UNKNOWN_OUTCOME: ['order refers to a $name that is not an outcome.', 'Sort by a value you calculated in outcome:.'],
  BAD_LIMIT: ['limit needs a whole number from 1 to 1000.', 'Example: limit: 20.'],
  UNEXPECTED: ['The trainer hit an error it did not expect.', 'Simplify the query and try again; if it persists, it is a trainer bug.'],
  // Comparison outcomes
  SAME_EVENTS: ['Same evidence as the reference query.', ''],
  SAME_STATS: ['Same table as the reference query.', ''],
  EXPECTED_STATS: ['The mission asks for a summary table, but this query returns raw events.', 'Add match: and/or outcome: sections.'],
  EXPECTED_EVENTS: ['The mission asks for events, but this query returns a summary table.', 'Remove the match and outcome sections.'],
  EXPECTED_ENTITIES: ['The mission asks for entity records (graph.entity.*), but this query returns something else.', 'Filter on entity fields alone, such as graph.metadata.entity_type = "ASSET", with no match or outcome section.'],
  DIFFERENT_EVENTS: ['The query runs, but it selects different events from the reference.', 'Compare your filter with the question: is the scope too wide, too narrow, or on the wrong field?'],
  DIFFERENT_EVENTS_NARROW: ['The query runs, but it misses events the reference returns.', 'Your filter is too narrow. Loosen one condition at a time: a value spelled differently from the record, a role (principal or target) that does not hold the value, or a condition the question never asked for.'],
  DIFFERENT_EVENTS_WIDE: ['The query runs, but it returns events the reference does not.', 'Your filter is too wide. Add or tighten a condition until only what the question asks for is left: usually the event type, an action or an anchored pattern.'],
  DIFFERENT_STATS_NARROW: ['The table runs, but it is missing rows the reference has.', 'Something upstream of the grouping is too narrow: a filter, or a condition threshold that cuts a row the question wants kept.'],
  DIFFERENT_STATS_VALUES: ['Same rows, different numbers: the grouping matches the reference but a calculated value does not.', 'Check the aggregate: count counts records, count_distinct counts different values, sum adds a numeric field. Then check the field inside the parentheses.'],
  DIFFERENT_STATS_WIDE: ['The table runs, but it has rows the reference does not.', 'Something upstream of the grouping is too wide: a filter that lets extra events in, or a threshold that keeps a row the question wants dropped.'],
  DIFFERENT_GROUPING: ['The query groups by different keys from the reference.', 'Check the fields under match:.'],
  DIFFERENT_OUTCOME_COUNT: ['The query calculates a different number of outcomes.', 'Check how many lines are under outcome:.'],
  DIFFERENT_ORDER: ['Right rows, wrong order.', 'Check the direction (asc or desc) under order:.'],
  DIFFERENT_STATS: ['The query runs, but the table differs from the reference.', 'Check the filter, the grouping key and the aggregate function.'],
});

// Example record IDs for a comparison failure. The IDs come from the dataset side of the comparison, never from the
// learner's text, so nothing typed into the editor is ever echoed back.
const idList = ids => ids.map(id => `"${id}"`).join(', ');
export function exampleText(detail) {
  if (!detail || typeof detail !== 'object') return '';
  const parts = [];
  if (Array.isArray(detail.missingIds) && detail.missingIds.length) parts.push(`Missing from yours, for example: ${idList(detail.missingIds)}.`);
  if (Array.isArray(detail.extraIds) && detail.extraIds.length) parts.push(`Extra in yours, for example: ${idList(detail.extraIds)}.`);
  if (Array.isArray(detail.changedIds) && detail.changedIds.length) parts.push(`Behind a row whose numbers differ, for example: ${idList(detail.changedIds)}.`);
  if (!parts.length) return '';
  const first = (detail.missingIds?.[0] ?? detail.extraIds?.[0] ?? detail.changedIds?.[0]);
  return parts.join(' ') + ` Open one with metadata.id = "${first}" to see which of your conditions it fails or passes.`;
}

export function describe(code, detail) {
  // Comparison codes get a sharper title when the difference is one-sided.
  if ((code === 'DIFFERENT_EVENTS' || code === 'DIFFERENT_STATS') && detail && typeof detail === 'object') {
    const { missing = 0, extra = 0, changed = 0 } = detail;
    if (missing > 0 && !extra && !changed) code += '_NARROW';
    else if (extra > 0 && !missing && !changed) code += '_WIDE';
    else if (changed > 0 && !missing && !extra) code += '_VALUES';
  }
  const [title, fix] = MESSAGES[code] ?? MESSAGES.UNEXPECTED;
  let extra = '';
  if (detail && typeof detail === 'object') {
    if (detail.zone) extra = ` (${detail.zone})`;
    else if (detail.field) extra = ` (field: ${detail.field})`;
    else if (detail.name) extra = ` (${detail.name})`;
    else if (detail.fn) extra = ` (${detail.fn})`;
    else if (detail.section) extra = ` (${detail.section})`;
    else if (detail.word) extra = ` (${detail.word})`;
    else if (detail.char) extra = ` ('${detail.char}')`;
  }
  // fix is the general advice; examples is a separate sentence the UI can set on its own line.
  return { title: title + extra, fix, examples: exampleText(detail) };
}
