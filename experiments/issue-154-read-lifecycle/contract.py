#!/usr/bin/env python3
"""Proposed trace acceptance checker, not a host implementation or a production test.
A future host adapter must record operations/counters at the real ports and feed these checks.
"""
import json
from pathlib import Path
import sys
import unittest

MUTATIONS = {'apply', 'register', 'cancel_schedule', 'control_write', 'fact_append',
             'private_write', 'import', 'prune', 'file_protection_write', 'command_execute'}


def check_trace(trace):
    errors = []
    running = set()
    attempted = set()
    observation = None
    acquired = {}
    for event in trace:
        kind = event['event']
        if event.get('operation') in {'readSnapshot', 'onboardingRead'} and kind in MUTATIONS:
            errors.append('display read performed ' + kind)
        if kind == 'evidence_acquired':
            acquired[event['evidenceID']] = event
        if kind == 'observation':
            if observation and event['evidenceID'] != observation['evidenceID'] and event.get('status', 'applied') == 'applied':
                proof = acquired.get(event['evidenceID'])
                if not proof or proof['kind'] not in {'apply', 'readback'} or proof['result'] != 'accepted' or not proof['contextValid']:
                    errors.append('new observation lacks accepted port evidence')
                elif proof['at'] != event['observedAt'] or event['validUntil'] > proof['boundary']:
                    errors.append('new observation exceeds evidence time/boundary')
            if observation and event['evidenceID'] == observation['evidenceID']:
                if event['validUntil'] > observation['validUntil'] or event['observedAt'] != observation['observedAt']:
                    errors.append('same evidence was renewed')
            if event.get('status') == 'applied' and event['now'] >= event['validUntil']:
                errors.append('expired observation presented as applied')
            observation = event
        if kind == 'work_start':
            key = event['key']
            if key in running:
                errors.append('duplicate in-flight work')
            if event.get('automatic') and key in attempted:
                errors.append('same failed/unknown cause retried automatically')
            running.add(key)
        if kind == 'work_finish':
            key = event['key']
            if key not in running:
                errors.append('completion without start')
            running.discard(key)
            if event['result'] in {'failed', 'unknown'}:
                attempted.add(key)
        if kind == 'prune':
            if event['policyRevision'] != event['currentPolicyRevision'] or event['metadataRevision'] != event['currentMetadataRevision']:
                errors.append('prune used stale policy or metadata')
            if not set(event['deletedIDs']).issubset(event['verifiedDeletedIDs']):
                errors.append('prune deleted an unverified rule')
        if kind == 'maintenance_batch':
            if event['processed'] > event['limit'] or event['limit'] > 100 or not event['locksSeparated']:
                errors.append('maintenance exceeded work/lock contract')
            if event.get('ackedWithoutPrivateCommit') or event.get('crossedDeletionCutoff'):
                errors.append('maintenance lost commit/cutoff ordering')
        if kind == 'command_execute' and (event.get('cause') == 'privateCompletion' or not event.get('submitted', True)):
            errors.append('completion/read executed an unsubmitted or already activated candidate')
        if kind == 'completion':
            if event['ruleID'] != event['boundRuleID'] or event['commandID'] != event['boundCommandID']:
                errors.append('completion replaced stable identities')
            if not event['submitted'] or not event['activated'] or event['restoredClearedText'] or event['recreatedRemovedRule']:
                errors.append('completion violated submission/activation/current-private-state contract')
        if kind == 'private_delivery' and event['accepted']:
            if event['epoch'] != event['currentEpoch'] or event['generation'] < event['latestAvailabilityGeneration']:
                errors.append('stale private delivery was adopted')
            if event.get('revision', 0) < event.get('revisionFloor', 0):
                errors.append('private body below known durable revision was adopted')
    return errors


class ContractTests(unittest.TestCase):
    def test_current_amplification_is_rejected_as_target_read(self):
        trace = [{'event': x, 'operation': 'readSnapshot'} for x in ['apply', 'control_write', 'fact_append', 'import', 'private_write']]
        self.assertEqual(len(check_trace(trace)), 5)

    def test_read_and_expired_unknown_are_allowed_without_new_evidence(self):
        self.assertEqual(check_trace([
            dict(event='observation', evidenceID='e1', now=9, observedAt=1, validUntil=10, status='applied'),
            dict(event='observation', evidenceID='e1', now=10, observedAt=1, validUntil=10, status='unknown')]), [])
        self.assertTrue(check_trace([
            dict(event='observation', evidenceID='e1', now=9, observedAt=1, validUntil=10),
            dict(event='observation', evidenceID='e1', now=10, observedAt=10, validUntil=20)]))

    def test_new_readback_may_establish_new_evidence(self):
        self.assertEqual(check_trace([
            dict(event='observation', evidenceID='e1', now=9, observedAt=1, validUntil=10),
            dict(event='evidence_acquired', evidenceID='readback2', kind='readback', result='accepted', contextValid=True, at=10, boundary=20),
            dict(event='observation', evidenceID='readback2', now=10, observedAt=10, validUntil=20)]), [])

    def test_new_evidence_id_without_a_port_sample_is_rejected(self):
        self.assertTrue(check_trace([
            dict(event='observation', evidenceID='e1', now=9, observedAt=1, validUntil=10),
            dict(event='observation', evidenceID='invented', now=10, observedAt=10, validUntil=20)]))

    def test_coalesce_and_retry_only_for_new_cause_or_explicit_action(self):
        start = dict(event='work_start', key='foreground:epoch2', automatic=True)
        finish = dict(event='work_finish', key='foreground:epoch2', result='unknown')
        self.assertTrue(check_trace([start, start]))
        self.assertTrue(check_trace([start, finish, start]))
        self.assertEqual(check_trace([start, finish, dict(start, key='authorization:epoch3')]), [])
        self.assertEqual(check_trace([start, finish, dict(start, automatic=False)]), [])

    def test_stale_prune_and_batch_bounds_are_rejected(self):
        prune = dict(event='prune', policyRevision=1, currentPolicyRevision=2, metadataRevision=2,
                     currentMetadataRevision=3, deletedIDs=['new-rule'], verifiedDeletedIDs=['old-rule'])
        self.assertEqual(len(check_trace([prune])), 2)
        self.assertTrue(check_trace([dict(event='maintenance_batch', processed=101, limit=100, locksSeparated=True)]))
        self.assertEqual(check_trace([dict(event='maintenance_batch', processed=100, limit=100, locksSeparated=True)]), [])

    def test_private_completion_never_executes_control_or_changes_ids(self):
        self.assertTrue(check_trace([dict(event='command_execute', cause='privateCompletion', submitted=True)]))
        completion = dict(event='completion', ruleID='r', boundRuleID='r', commandID='c', boundCommandID='c',
                          submitted=True, activated=True, restoredClearedText=False, recreatedRemovedRule=False)
        self.assertEqual(check_trace([completion]), [])
        for key, value in [('ruleID', 'r2'), ('submitted', False), ('restoredClearedText', True), ('recreatedRemovedRule', True)]:
            self.assertTrue(check_trace([dict(completion, **{key: value})]))

    def test_late_private_delivery_uses_request_start_token(self):
        ready = dict(event='private_delivery', accepted=True, epoch=1, currentEpoch=2, generation=4, latestAvailabilityGeneration=5)
        self.assertTrue(check_trace([ready]))
        self.assertEqual(check_trace([dict(ready, epoch=2, generation=6)]), [])
        self.assertTrue(check_trace([dict(ready, epoch=2, generation=6, revision=2, revisionFloor=3)]))
        self.assertEqual(check_trace([dict(ready, epoch=2, generation=6, revision=3, revisionFloor=3)]), [])


if __name__ == '__main__':
    if len(sys.argv) == 2:
        errors = check_trace(json.loads(Path(sys.argv[1]).read_text()))
        print(json.dumps({'accepted': not errors, 'violations': errors}, indent=2))
        raise SystemExit(bool(errors))
    unittest.main()
