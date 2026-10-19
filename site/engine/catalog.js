// UDM fields the engine understands. Names checked against Google's UDM field list on 2026-10-17.
// The dataset is fictional and flat: repeated UDM fields (security_result, dns questions, email.to)
// are modelled as single values here. See docs/LIMITATIONS.md.
export const FIELDS = Object.freeze({
  'metadata.event_type': 'enum',
  'metadata.id': 'string',
  'metadata.event_timestamp.seconds': 'number',
  'metadata.product_name': 'string',
  'security_result.action': 'enum',
  'security_result.summary': 'string',
  'principal.user.userid': 'string',
  'principal.user.title': 'string',
  'target.user.userid': 'string',
  'principal.hostname': 'string',
  'target.hostname': 'string',
  'principal.ip': 'ip',
  'target.ip': 'ip',
  'target.port': 'number',
  'principal.process.file.full_path': 'string',
  'target.process.file.full_path': 'string',
  'target.process.command_line': 'string',
  'target.file.full_path': 'string',
  'target.url': 'string',
  'network.dns.questions.name': 'string',
  'network.sent_bytes': 'number',
  'network.received_bytes': 'number',
  'network.email.from': 'string',
  'network.email.to': 'string',
  'network.email.subject': 'string',
  // Entity context (Google: statistics page queries entity data in Search with graph.entity.* fields; entity records
  // are valid over a time range). The trainer bundles a small station directory (content/entities.json): users and
  // assets with validity intervals. Field names mirror UDM entity nouns; label and role values are the station's own.
  'graph.metadata.entity_type': 'enum',
  'graph.metadata.product_name': 'string',
  'graph.metadata.event_metadata.event_timestamp.seconds': 'number',
  'graph.metadata.interval.start_time.seconds': 'number',
  'graph.metadata.interval.end_time.seconds': 'number',
  'graph.entity.user.userid': 'string',
  'graph.entity.user.title': 'string',
  'graph.entity.user.department': 'string',
  'graph.entity.user.managers.userid': 'string',
  'graph.entity.user.employment_status': 'enum',
  'graph.entity.user.account_type': 'enum',
  'graph.entity.user.attribute.roles.name': 'string',
  'graph.entity.user.attribute.labels.remote_access': 'string',
  'graph.entity.asset.hostname': 'string',
  'graph.entity.asset.ip': 'ip',
  'graph.entity.asset.attribute.roles.name': 'string',
  'graph.entity.asset.attribute.labels.owner': 'string',
  'graph.entity.asset.attribute.labels.criticality': 'string',
});
export const EVENT_FIELDS = Object.freeze(Object.fromEntries(Object.entries(FIELDS).filter(([f]) => !f.startsWith('graph.'))));
export const ENTITY_FIELDS = Object.freeze(Object.fromEntries(Object.entries(FIELDS).filter(([f]) => f.startsWith('graph.'))));
export const ENTITY_TYPES = Object.freeze(['USER', 'ASSET']);
export const EMPLOYMENT_STATUSES = Object.freeze(['ACTIVE', 'TERMINATED']);
export const ACCOUNT_TYPES = Object.freeze(['NAMED', 'SHARED', 'SERVICE']);

export const EVENT_TYPES = Object.freeze([
  'USER_LOGIN', 'PROCESS_LAUNCH', 'NETWORK_CONNECTION', 'NETWORK_DNS',
  'EMAIL_TRANSACTION', 'FILE_CREATION', 'SCHEDULED_TASK_CREATION',
]);
export const ACTIONS = Object.freeze(['ALLOW', 'BLOCK', 'FAIL', 'QUARANTINE', 'UNKNOWN_ACTION']);

// Google's field is metadata.event_timestamp; this flat dataset carries its seconds. Either spelling resolves to the
// stored field, so earliest(metadata.event_timestamp) and timestamp.get_hour(metadata.event_timestamp, "UTC") read as
// the docs write them.
// graph.entity.hostname and graph.entity.ip are the forms the statistics page writes; this flat directory stores them
// under the asset noun, so both spellings resolve to the stored field.
export const ALIASES = Object.freeze({ 'metadata.event_timestamp': 'metadata.event_timestamp.seconds', 'graph.metadata.event_metadata.event_timestamp': 'graph.metadata.event_metadata.event_timestamp.seconds', 'graph.entity.hostname': 'graph.entity.asset.hostname', 'graph.entity.ip': 'graph.entity.asset.ip' });
export const TIMESTAMP_FIELD = 'metadata.event_timestamp.seconds';
// Entity records (Part C) carry their own timestamp; the time functions and earliest/latest accept either.
export const ENTITY_TIMESTAMP_FIELD = 'graph.metadata.event_metadata.event_timestamp.seconds';
export const TIMESTAMP_FIELDS = Object.freeze([TIMESTAMP_FIELD, ENTITY_TIMESTAMP_FIELD]);
// Entity fields are the graph.* paths (Google: statistics page, graph.entity.hostname and graph.entity.ip examples).
export const isEntityField = f => typeof f === 'string' && f.startsWith('graph.');
// Entity records as the executor and the UI read them: id, type, product, the validity interval (seconds) and the
// entity fields above. The join form documented for rules, $e.principal.user.userid = $u.graph.entity.user.userid,
// is run here against these records and labelled as rule-context syntax to verify in a tenant.
export const ENTITY_ID_PREFIX = 'ent-';

// Outcome aggregates (Google: "Analyze search data with statistics"). array and array_distinct return lists, truncated
// to 1,000 elements in Search; earliest and latest return timestamps.
export const AGGREGATES = Object.freeze(['count', 'count_distinct', 'sum', 'max', 'min', 'array', 'array_distinct', 'earliest', 'latest']);
export const ARRAY_AGGREGATES = Object.freeze(['array', 'array_distinct']);
export const TIME_AGGREGATES = Object.freeze(['earliest', 'latest']);

// Functions the trainer runs in filters and placeholders (Google: YARA-L 2.0 functions). Each names the type it
// returns; the parser checks argument shapes and the executor evaluates them per event.
export const FUNCTIONS = Object.freeze({
  'timestamp.get_hour': { returns: 'number', doc: 'hour of the timestamp, 0 to 23, in the named time zone' },
  'timestamp.get_minute': { returns: 'number', doc: 'minute of the timestamp, 0 to 59, in the named time zone' },
  'timestamp.get_date': { returns: 'string', doc: 'the date as YYYY-MM-DD in the named time zone' },
  'strings.to_lower': { returns: 'string', doc: 'the string in lower case' },
  'strings.to_upper': { returns: 'string', doc: 'the string in upper case' },
  'strings.concat': { returns: 'string', doc: 'the arguments joined into one string' },
});
// Time zones the trainer renders. Google accepts TZ database names and UTC offsets; this dataset is read in UTC only.
export const TIME_ZONES = Object.freeze(['UTC', 'GMT']);

// Reference list and data-table column types (Google: "Use reference lists and data tables in YARA-L 2.0", verified by
// the owner on 2026-10-18 against the live page): a STRING list or column is used as `field in %name`, a REGEX one as
// `field in regex %name`, a CIDR one as `field in cidr %name`; a data table column is named %table_name.column_name
// in the same three forms. not and nocase combine with them (nocase for STRING and REGEX only). Lists are bundled
// from content/lists.json and tables from content/tables.json; in a tenant they live under Detection > Lists and
// Detection > Data tables. Google's "Reference lists" page (same date) says reference lists are being replaced by data
// tables, existing lists are migrated automatically, and legacy reference lists retire in July 2027.
export const LIST_TYPES = Object.freeze(['string', 'cidr', 'regex']);
export const LISTS_RETIRE = 'July 2027';

// Google documentation the engine follows, recorded for the About page and docs. Verified by the owner on 2026-10-18
// against the live pages (the build container cannot reach docs.cloud.google.com; the owner read each page and the
// facts recorded in this file and in docs/EVALUATION.md are theirs). The functions page says the time functions'
// zone defaults to GMT and accepts TZ names, offsets, "UTC" and "GMT". The deduplication page places dedup after
// match/outcome on an aggregated query (keys: match or outcome fields) and on plain queries allows any non-repeated,
// non-grouped field or placeholder, with dedup before order in every example.
export const DOCS = Object.freeze([
  ['https://docs.cloud.google.com/chronicle/docs/investigation/search-syntax-reference', 'Understand search syntax'],
  ['https://docs.cloud.google.com/chronicle/docs/investigation/statistics-aggregations-in-udm-search', 'Analyze search data with statistics'],
  ['https://docs.cloud.google.com/chronicle/docs/investigation/deduplication-yaral', 'Deduplicate search results'],
  ['https://docs.cloud.google.com/chronicle/docs/detection/yara-l-2-0-functions/timestamp-get_hour', 'YARA-L 2.0 functions: timestamp.get_hour'],
  ['https://docs.cloud.google.com/chronicle/docs/reference/reference-lists', 'Reference lists (replaced by data tables; legacy lists retire in July 2027)'],
  ['https://docs.cloud.google.com/chronicle/docs/yara-l/reference-list-syntax', 'Use reference lists and data tables in YARA-L 2.0'],
  ['https://docs.cloud.google.com/chronicle/docs/investigation/yara-l-2-0-conditions', 'Use conditions in search and dashboards'],
  ['https://docs.cloud.google.com/chronicle/docs/investigation/udm-search-vs-rules-results', 'UDM search compared with rule results (Search and rules run on different engines; counts differ)'],
  ['https://docs.cloud.google.com/chronicle/docs/detection/yara-l-2-0-syntax', 'YARA-L 2.0 language syntax (rule shape, match over N, mandatory condition, allow_zero_values; facts recorded by the owner\'s reviewer on 2026-10-18)'],
  ['https://docs.cloud.google.com/chronicle/docs/reference/udm-field-list', 'UDM field list'],
]);

// Zero values, as UDM reports them for missing fields (Google: "Filter missing, zero, and uninitialized values").
export function zeroValue(field) {
  const t = FIELDS[field];
  return t === 'number' ? 0 : t === 'enum' && field === 'security_result.action' ? 'UNKNOWN_ACTION' : '';
}

export const LIMITS = Object.freeze({
  bytes: 8192, tokens: 1024, depth: 12, atoms: 24, outcomes: 6, matchKeys: 4, limitMax: 1000,
  regexLength: 80, regexSubject: 512,
  arrayMax: 1000,     // Search truncates array and array_distinct to 1,000 elements
  listRefs: 7,        // Search caps in statements (lists and data-table columns) at 7 per query (rules: 10)
  regexListRefs: 4,   // of which at most 4 may be `in regex` (rules: 5)
  cidrListRefs: 2,    // and at most 2 may be `in cidr` (rules: 5)
  dedupKeys: 4, concatArgs: 6,
  eventVars: 2,       // event variables in one Search query: two, joined by shared placeholders; more is reported as not run here
  ruleListRefs: 10, ruleRegexListRefs: 5, ruleCidrListRefs: 5, // the rule-engine limits for the same in tests (Google, verified 2026-10-18)
  ruleWindowMax: 48 * 3600, // the longest match window a rule may slide here (Google rules allow up to 48 hours)
  ruleMetaValue: 400,  // one meta value
});

// Rule mode (chapter 11). The facts the trainer follows were verified by the owner's reviewer on 2026-10-18 against the
// live pages and are authoritative for this trainer: a YARA-L 2.0 rule has the shape
//   rule name { meta: ... events: ... match: $key over 1h outcome: ... condition: ... }
// in rules every field is written with an event variable ($e.metadata.event_type); match uses `over N`, a sliding
// window; condition is mandatory; Search and rules run on different engines, evaluate different time windows and
// handle repeated fields and dedup differently, so counts differ ("UDM search compared with rule results"); match
// variables skip zero values unless allow_zero_values is set in options; the rule-engine data-table join is
// $e.field = %table.column; reference lists and tables are usable in events and outcome.
export const RULE_META_REQUIRED = Object.freeze(['author', 'description', 'severity']);
export const RULE_SEVERITIES = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RULE_OPTIONS = Object.freeze({ allow_zero_values: 'boolean' });
