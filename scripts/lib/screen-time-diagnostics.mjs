// Allowlist exporter for `log show --style ndjson`. Never copy arbitrary OS log properties.
const stages = new Set('callbackEntry actorEntry runtimeOpen serviceReady reconciliationResult callbackError callbackExit authorizationRead policyRegistrationBegin policyRegistrationResult deadlineRegistrationBegin deadlineRegistrationResult deadlineCancellationResult restrictionBegin restrictionResult hostRefreshBegin hostRefreshEnd authorizationProbeBegin authorizationProbeInitial authorizationProbeNotification authorizationProbeEnd directProbeSchedule directProbeApply directProbeClear'.split(' '));
const results = new Set('none accepted rejected uncertain committed requiresRecovery failed ignored reconciliation policyCandidate temporaryGrant paused enabled awaitingReauthorizationConfirmation storageMissing storageBusy storageCorrupt storageSchema storageUnavailable storageOther invalidSelection runtimeUnavailable scheduleUnavailable runtimeBusy otherError authorizationRequired registrationFailure storageFailure osOperationFailure interrupted unknownFailure probeResolved probeTimedOut probeSkippedMainThread probeHostExpiry'.split(' '));
const authorizations = new Set(['notRead', 'approved', 'denied', 'notDetermined', 'unrecognized']);
const activities = new Set(['none', 'rule', 'deadline', 'directProbe', 'unrecognized']);
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function sanitizeScreenTimeDiagnostic(entry) {
  if (!entry || entry.subsystem !== 'com.itoma.screentime' || entry.category !== 'lifecycle') return null;
  if (typeof entry.eventMessage !== 'string' || entry.eventMessage.length > 768) return null;
  const keys = ['v', 'role', 'stage', 'activity', 'ended', 'auth', 'result', 'failure', 'main', 'count', 'revision', 'minute', 'elapsed_ms'];
  const parts = entry.eventMessage.split(' ');
  if (parts.length !== keys.length) return null;
  const fields = {};
  for (let i = 0; i < keys.length; i++) {
    const prefix = `${keys[i]}=`;
    if (!parts[i].startsWith(prefix)) return null;
    fields[keys[i]] = parts[i].slice(prefix.length);
  }
  if (fields.v !== '1' || !['host', 'extension'].includes(fields.role)
      || !stages.has(fields.stage) || !activities.has(fields.activity)
      || !authorizations.has(fields.auth) || !results.has(fields.result) || !results.has(fields.failure)) return null;
  for (const k of ['ended', 'main']) {
    if (!['0', '1', 'true', 'false'].includes(fields[k])) return null;
    fields[k] = fields[k] === '1' || fields[k] === 'true';
  }
  for (const k of ['count', 'revision', 'minute', 'elapsed_ms']) {
    if (!/^-?\d{1,16}$/.test(fields[k])) return null;
    fields[k] = Number(fields[k]);
    if (!Number.isSafeInteger(fields[k]) || fields[k] < -1) return null;
  }
  if (fields.minute > 1439) return null;
  if (typeof entry.timestamp !== 'string' || entry.timestamp.length > 64) return null;
  const time = Date.parse(entry.timestamp);
  if (!Number.isFinite(time)) return null;
  const output = { timestamp: new Date(time).toISOString(), ...fields };
  if (Number.isSafeInteger(entry.processID) && entry.processID >= 0) output.processID = entry.processID;
  for (const k of ['senderImageUUID', 'processImageUUID']) {
    if (typeof entry[k] === 'string' && uuid.test(entry[k])) output[k] = entry[k];
  }
  return output;
}
