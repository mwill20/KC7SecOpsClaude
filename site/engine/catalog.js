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
});

export const EVENT_TYPES = Object.freeze([
  'USER_LOGIN', 'PROCESS_LAUNCH', 'NETWORK_CONNECTION', 'NETWORK_DNS',
  'EMAIL_TRANSACTION', 'FILE_CREATION', 'SCHEDULED_TASK_CREATION',
]);
export const ACTIONS = Object.freeze(['ALLOW', 'BLOCK', 'FAIL', 'QUARANTINE', 'UNKNOWN_ACTION']);

export const AGGREGATES = Object.freeze(['count', 'count_distinct', 'sum', 'max', 'min']);

// Zero values, as UDM reports them for missing fields (Google: "Filter missing, zero, and uninitialized values").
export function zeroValue(field) {
  const t = FIELDS[field];
  return t === 'number' ? 0 : t === 'enum' && field === 'security_result.action' ? 'UNKNOWN_ACTION' : '';
}

export const LIMITS = Object.freeze({
  bytes: 8192, tokens: 1024, depth: 12, atoms: 24, outcomes: 6, matchKeys: 4, limitMax: 1000,
  regexLength: 80, regexSubject: 512,
});
