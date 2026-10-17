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
  COUNT_CHARACTER: ['The # count syntax belongs to multi-event rules.', 'Count with an outcome instead: $n = count(metadata.id).'],
  UNQUOTED_IP: ['An IP address needs quotes.', 'Write principal.ip = "10.9.4.22".'],
  UNEXPECTED_CHARACTER: ['There is a character here Search does not expect.', 'Check for stray punctuation, smart quotes or a missing operator.'],
  MULTI_EVENT: ['Two different event variables were used.', 'This trainer runs single-event queries. Use one variable such as $e, or none.'],
  UNKNOWN_FIELD: ['That field name is not in the dataset.', 'Check the spelling against the field list in the desk; UDM paths are dotted and lower case.'],
  EXPECTED_FIELD: ['A field name was expected here.', 'Conditions start with a UDM field such as principal.hostname.'],
  EXPECTED_VALUE: ['A value was expected after the operator.', 'Text and enums go in double quotes; numbers are bare; patterns go between slashes.'],
  UNQUOTED_ENUM: ['An enum value needs double quotes.', 'Write metadata.event_type = "USER_LOGIN", quotes included.'],
  EXPECTED_PAREN: ['A parenthesis is missing or unbalanced.', 'Every ( needs a ), including around function arguments.'],
  EXPECTED_COMMA: ['A comma was expected between function arguments.', 'Example: net.ip_in_range_cidr(target.ip, "203.0.113.0/24").'],
  UNSUPPORTED_FUNCTION: ['That function is real Google syntax this trainer does not run.', 'Here you can use re.regex and net.ip_in_range_cidr. The others are documented on the YARA-L functions pages.'],
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
  EXPECTED_COLON: ['A section name needs a colon.', 'Write match:, outcome:, condition:, order: or limit:.'],
  MISSING_FILTER: ['The query starts with a section but has no filter.', 'Put at least one condition before match: or outcome:.'],
  BINDING_CONTEXT: ['A placeholder cannot be set inside OR or NOT.', 'Move $name = field to its own line at the top level.'],
  BINDING_DUPLICATE: ['The same placeholder was set twice.', 'Set each $name once.'],
  UNBOUND_VARIABLE: ['A $name was used that was never set.', 'Add $name = field in the filter before using it in match or outcome.'],
  GROUPED_FIELD_HERE: ['Grouped fields such as ip or hostname work in the filter only.', 'In match or outcome, name the exact field, such as principal.hostname.'],
  CIDR_NEEDS_IP: ['net.ip_in_range_cidr needs an IP field.', 'Use principal.ip or target.ip as the first argument.'],
  REGEX_ON_NUMBER: ['A regex cannot be applied to a numeric field.', 'Compare numbers with =, <, > and friends.'],
  NUMBER_NEEDS_NUMBER: ['This numeric field was compared with text.', 'Write numbers bare: target.port = 443.'],
  NOCASE_ON_NUMBER: ['nocase only applies to text.', 'Remove nocase from the numeric comparison.'],
  STRING_NEEDS_QUOTES: ['This text field was compared with a bare number or word.', 'Put the value in double quotes.'],
  STRING_OPERATOR: ['Text fields compare with = and != only.', 'Use < and > for numbers.'],
  UNSUPPORTED_SECTION: ['That section is real Google syntax this trainer does not run.', 'dedup, option and unselect are documented; this course covers match, outcome, condition, order and limit.'],
  UNEXPECTED_TOKEN: ['Something appears after the filter that is not a section.', 'After the conditions, only match:, outcome:, condition:, order: and limit: may follow.'],
  SECTION_ORDER: ['Sections are out of order.', 'The order is match, outcome, condition, order, limit.'],
  TOO_MANY_KEYS: ['Too many grouping keys.', 'Group by four fields or fewer.'],
  OVER_WINDOW: ['over by itself is the rule-engine window, which Search does not support.', 'In Search write by 5m or over every 5m.'],
  BAD_WINDOW: ['The time window after by is not valid.', 'Write by 5m, by 1h or by 1d.'],
  DUPLICATE_KEY: ['The same key appears twice in match.', 'List each grouping key once.'],
  OUTCOME_NAME: ['Each outcome needs a $name.', 'Write $failures = count(metadata.id).'],
  OUTCOME_SHADOWS_BINDING: ['An outcome reused a placeholder name.', 'Give the outcome a different $name.'],
  EXPECTED_AGGREGATE: ['An aggregate function was expected.', 'Use count, count_distinct, sum, max or min.'],
  UNSUPPORTED_AGGREGATE: ['That aggregate is real Google syntax this trainer does not run.', 'Here you can use count, count_distinct, sum, max and min.'],
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
    if (detail.field) extra = ` (field: ${detail.field})`;
    else if (detail.name) extra = ` (${detail.name})`;
    else if (detail.fn) extra = ` (${detail.fn})`;
    else if (detail.section) extra = ` (${detail.section})`;
    else if (detail.word) extra = ` (${detail.word})`;
    else if (detail.char) extra = ` ('${detail.char}')`;
  }
  // fix is the general advice; examples is a separate sentence the UI can set on its own line.
  return { title: title + extra, fix, examples: exampleText(detail) };
}
