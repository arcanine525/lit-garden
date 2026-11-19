"""Executable design model, NOT application/Drive client code. Python 3.12 stdlib.

Only FakeDrive retains payloads. Metadata stores hashes, IDs, enums and counters.
Tests explore protocol decisions; they do not prove real network/API behavior.
"""

from dataclasses import dataclass
from hashlib import sha256
from itertools import permutations
import unittest


def digest(payload: bytes) -> str:
    return sha256(payload).hexdigest()


def utf16_slice(text: str, start: int, end: int) -> str:
    # Strict decode deliberately refuses ranges bisecting surrogate pairs.
    return text.encode("utf-16-le")[start * 2:end * 2].decode("utf-16-le")


class Rejected(Exception):
    pass


@dataclass
class Operation:
    key: str
    kind: str
    fingerprint: str
    content_hash: str
    epoch: int
    base: int
    state: str = "reserved"
    result: int | None = None


class FakeDrive:
    def __init__(self):
        self.files: dict[str, bytes] = {}

    def create(self, file_id, payload):
        # Simulate pre-generated ID semantics: 409 on duplicate create.
        if file_id in self.files:
            return 409
        self.files[file_id] = payload
        return 201


class Protocol:
    def __init__(self):
        self.drive = FakeDrive()
        self.operations: dict[str, Operation] = {}
        self.epoch = 1
        self.version = 0
        self.lease_live = True
        self.write_allowed = True
        self.head = None
        self.submissions: dict[int, str] = {}
        self.notifications: set[tuple[str, str]] = set()

    def reserve(self, key, kind, payload, epoch=1, base=0):
        fingerprint = digest(repr((kind, digest(payload), epoch, base)).encode())
        if key in self.operations:
            op = self.operations[key]
            if op.fingerprint != fingerprint:
                raise Rejected("KEY_REUSED")
            return op
        if not self.write_allowed or epoch != self.epoch or base != self.version:
            raise Rejected("POLICY_OR_STALE")
        if any(o.kind == kind and o.state not in {"committed", "rejected"}
               for o in self.operations.values()):
            raise Rejected("OP_IN_PROGRESS")
        op = Operation(key, kind, fingerprint, digest(payload), epoch, base)
        self.operations[key] = op
        return op

    def client_upload(self, key, payload, lose_response=False):
        op = self.operations[key]
        if digest(payload) != op.content_hash:
            raise Rejected("PAYLOAD_CHANGED")
        # This can still arrive at Drive after cancellation/takeover.
        status = self.drive.create("file:" + key, payload)
        if op.state not in {"committed", "rejected"}:
            op.state = "unknown" if lose_response else "drive_verified"
        return status

    def takeover(self):
        self.epoch += 1
        self.lease_live = True

    def cancel(self, key):
        op = self.operations[key]
        if op.state == "committed":
            raise Rejected("ALREADY_COMMITTED")
        op.state = "rejected"

    def reconcile(self, key, fail_before_commit=False):
        op = self.operations[key]
        if op.state in {"committed", "rejected"}:
            return op.result
        payload = self.drive.files.get("file:" + key)
        if payload is None:
            # Reconciliation never calls create. A later in-flight create remains possible.
            op.state = "needs_client"
            return None
        if digest(payload) != op.content_hash:
            op.state = "rejected"
            raise Rejected("INTEGRITY")
        if not self.write_allowed or op.epoch != self.epoch:
            op.state = "rejected"
            raise Rejected("POLICY_OR_STALE")
        if op.kind == "autosave" and (not self.lease_live or op.base != self.version):
            op.state = "rejected"
            raise Rejected("STALE_WRITER")
        if fail_before_commit:
            # T2 rolled back, no metadata result/notification may become visible.
            op.state = "unknown"
            return None
        if op.kind == "submit":
            ordinal = len(self.submissions) + 1
            self.submissions[ordinal] = "file:" + key
            op.result = ordinal
        elif op.kind == "autosave":
            self.head = "file:" + key
            self.version += 1
            op.result = self.version
        else:
            raise AssertionError("unmodelled kind")
        # A real implementation commits the above and these fields in one DB transaction.
        op.state = "committed"
        return op.result


class ReviewModel:
    """Hashes only, one submission. SQL transaction serializes these method calls."""

    def __init__(self):
        self.history = [{"c1": digest(b"original comment and anchor")}]
        self.pending = {}
        self.frozen = {}
        self.messages = set()
        self.notifications = set()
        self.operations = {}

    def reserve_reply(self, key, publication, comment):
        if publication != len(self.history):
            raise Rejected("PUBLICATION_CHANGED")
        if comment not in self.history[-1]:
            raise Rejected("COMMENT_NOT_CURRENT")
        self.pending[comment] = (key, self.history[-1][comment])

    def publish(self, key, candidate, base, all_scores=True, drive_ok=True):
        if key in self.operations:
            return self.operations[key]
        if base != len(self.history):
            raise Rejected("PUBLICATION_CHANGED")
        if not all_scores:
            raise Rejected("INCOMPLETE_SCORES")
        locked = {**self.frozen, **{c: pair[1] for c, pair in self.pending.items()}}
        if any(candidate.get(c) != h for c, h in locked.items()):
            raise Rejected("COMMENT_LOCKED")
        if not drive_ok:
            return None  # Existing current stays visible.
        self.history.append(candidate.copy())
        self.operations[key] = len(self.history)
        self.notifications.add((key, "returned"))
        return len(self.history)

    def commit_reply(self, key, comment):
        if key in self.messages:
            return
        pending_key, pinned = self.pending[comment]
        if pending_key != key:
            raise Rejected("WRONG_OPERATION")
        self.frozen[comment] = pinned
        self.messages.add(key)
        self.notifications.add((key, "reply"))
        del self.pending[comment]

    def read(self, role, revision=None):
        if role == "admin":
            raise Rejected("FORBIDDEN")
        if role == "student" and revision not in {None, len(self.history)}:
            raise Rejected("SUPERSEDED")
        return self.history[(revision or len(self.history)) - 1].copy()


class LibraryDeleteModel:
    def __init__(self):
        self.state = "active"
        self.featured = True
        self.files = {"manifest": "pending", "pdf": "pending", "old-draft": "pending"}

    def begin(self):
        self.state = "deleting"
        self.featured = False

    def verify_file(self, name, outcome):
        self.files[name] = "trashed" if outcome == "verified_trashed" else "unknown"
        if all(state == "trashed" for state in self.files.values()):
            self.state = "deleted"

    def readable(self):
        return self.state == "active"


class ProtocolScenarios(unittest.TestCase):
    def test_utf16_repeated_quote_and_nfd_anchor_fixture(self):
        projection = "Hoa nở. 👩🏽‍🏫 a\u0306\u0301 Hoa nở.\n"
        second_start = len(projection[:projection.rindex("Hoa nở.")].encode("utf-16-le")) // 2
        self.assertEqual(utf16_slice(projection, second_start, second_start + 7), "Hoa nở.")
        self.assertNotEqual(second_start, projection.rindex("Hoa nở."))
        self.assertIn("a\u0306\u0301", projection)  # NFD must not become NFC after hashing.
        with self.assertRaises(UnicodeDecodeError):
            utf16_slice(projection, 8, 9)  # First half of the emoji surrogate pair.

    def test_crash_after_drive_success(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        p.client_upload("s1", b"writing", lose_response=True)
        self.assertEqual(p.submissions, {})
        self.assertEqual(p.reconcile("s1"), 1)
        self.assertEqual(p.operations["s1"].state, "committed")

    def test_t2_rollback_then_reconcile(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        p.client_upload("s1", b"writing")
        p.reconcile("s1", fail_before_commit=True)
        self.assertEqual(p.submissions, {})
        self.assertEqual(p.reconcile("s1"), 1)

    def test_duplicate_create_and_submit_ack_lost(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        self.assertEqual(p.client_upload("s1", b"writing"), 201)
        for _ in range(3):
            self.assertEqual(p.client_upload("s1", b"writing"), 409)
            self.assertEqual(p.reconcile("s1"), 1)
        self.assertEqual(len(p.submissions), 1)
        self.assertEqual(len(p.drive.files), 1)

    def test_different_payload_same_key_rejected(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        with self.assertRaisesRegex(Rejected, "KEY_REUSED"):
            p.reserve("s1", "submit", b"changed")

    def test_second_key_while_submit_unknown_rejected(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        with self.assertRaisesRegex(Rejected, "OP_IN_PROGRESS"):
            p.reserve("s2", "submit", b"writing")

    def test_intentional_same_content_new_submission_allowed(self):
        p = Protocol()
        for key in ("s1", "s2"):
            p.reserve(key, "submit", b"writing")
            p.client_upload(key, b"writing")
            p.reconcile(key)
        self.assertEqual(len(p.submissions), 2)

    def test_no_server_payload_after_crash_before_upload(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        p.reconcile("s1")
        self.assertEqual(p.operations["s1"].state, "needs_client")
        self.assertEqual(p.drive.files, {})
        self.assertEqual(p.submissions, {})
        self.assertNotIn(b"writing", vars(p.operations["s1"]).values())

    def test_autosave_never_creates_submission(self):
        p = Protocol()
        p.reserve("d1", "autosave", b"draft")
        p.client_upload("d1", b"draft")
        p.reconcile("d1")
        self.assertEqual(p.submissions, {})
        self.assertEqual(p.head, "file:d1")

    def test_stale_write_finishes_after_new_head(self):
        p = Protocol()
        p.reserve("old", "autosave", b"old draft")
        p.takeover()
        p.cancel("old")  # releasing target mutex; external request may still arrive.
        p.reserve("new", "autosave", b"new draft", epoch=2)
        p.client_upload("new", b"new draft")
        p.reconcile("new")
        p.client_upload("old", b"old draft")
        p.reconcile("old")
        self.assertEqual(p.head, "file:new")
        self.assertEqual(p.drive.files[p.head], b"new draft")

    def test_takeover_and_finalize_both_serial_orders(self):
        for order in permutations(("takeover", "finalize")):
            with self.subTest(order=order):
                p = Protocol()
                p.reserve("old", "autosave", b"old")
                p.client_upload("old", b"old")
                for event in order:
                    try:
                        p.takeover() if event == "takeover" else p.reconcile("old")
                    except Rejected:
                        pass
                self.assertEqual(p.version, 1 if order[0] == "finalize" else 0)

    def test_expiry_rejects_draft_finalize(self):
        p = Protocol()
        p.reserve("d1", "autosave", b"draft")
        p.client_upload("d1", b"draft")
        p.lease_live = False
        with self.assertRaisesRegex(Rejected, "STALE_WRITER"):
            p.reconcile("d1")
        self.assertIsNone(p.head)

    def test_close_barrier_and_finalize_both_orders(self):
        for barrier in ("close", "archive", "remove", "suspend"):
            for order in permutations(("barrier", "finalize")):
                with self.subTest(barrier=barrier, order=order):
                    p = Protocol()
                    p.reserve("s1", "submit", b"writing")
                    p.client_upload("s1", b"writing")
                    for event in order:
                        if event == "barrier":
                            p.write_allowed = False
                        else:
                            try:
                                p.reconcile("s1")
                            except Rejected:
                                pass
                    self.assertEqual(len(p.submissions), int(order[0] == "finalize"))
                    p.write_allowed = True
                    p.reconcile("s1")
                    self.assertEqual(len(p.submissions), int(order[0] == "finalize"))

    def test_cancel_then_late_create_never_submits(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        p.cancel("s1")
        p.client_upload("s1", b"writing")
        p.reconcile("s1")
        self.assertEqual(p.submissions, {})

    def test_external_content_change_rejected(self):
        p = Protocol()
        p.reserve("s1", "submit", b"writing")
        p.client_upload("s1", b"writing")
        p.drive.files["file:s1"] = b"external change"
        with self.assertRaisesRegex(Rejected, "INTEGRITY"):
            p.reconcile("s1")
        self.assertEqual(p.submissions, {})

    def test_reply_wins_publish_of_changed_comment_rejected(self):
        r = ReviewModel()
        r.reserve_reply("m1", 1, "c1")
        with self.assertRaisesRegex(Rejected, "COMMENT_LOCKED"):
            r.publish("p2", {"c1": digest(b"edited")}, 1)
        r.commit_reply("m1", "c1")
        with self.assertRaisesRegex(Rejected, "COMMENT_LOCKED"):
            r.publish("p2", {}, 1)  # Cannot evade freeze by deleting/renaming ID.

    def test_publish_wins_reply_against_old_content_rejected(self):
        r = ReviewModel()
        r.publish("p2", {"c1": digest(b"edited")}, 1)
        with self.assertRaisesRegex(Rejected, "PUBLICATION_CHANGED"):
            r.reserve_reply("m1", 1, "c1")

    def test_draft_failed_publish_and_hidden_history(self):
        r = ReviewModel()
        original = r.read("student")
        changed = {"c1": digest(b"edited")}
        self.assertIsNone(r.publish("p2", changed, 1, drive_ok=False))
        self.assertEqual(r.read("student"), original)
        self.assertEqual(r.publish("p2", changed, 1), 2)
        self.assertEqual(r.publish("p2", changed, 1), 2)
        self.assertEqual(len(r.history), 2)
        self.assertEqual(len(r.notifications), 1)
        with self.assertRaisesRegex(Rejected, "SUPERSEDED"):
            r.read("student", 1)
        self.assertEqual(r.read("teacher", 1), original)
        with self.assertRaisesRegex(Rejected, "FORBIDDEN"):
            r.read("admin")

    def test_incomplete_review_and_optional_overall(self):
        r = ReviewModel()
        with self.assertRaisesRegex(Rejected, "INCOMPLETE_SCORES"):
            r.publish("p2", {}, 1, all_scores=False)
        self.assertEqual(r.publish("p2", {}, 1), 2)  # Overall/comment may be empty.

    def test_reply_retry_deduplicates_message_and_notification(self):
        r = ReviewModel()
        r.reserve_reply("m1", 1, "c1")
        r.commit_reply("m1", "c1")
        r.commit_reply("m1", "c1")
        self.assertEqual(len(r.messages), 1)
        self.assertEqual(len(r.notifications), 1)
        self.assertEqual(r.publish("p2", r.read("student"), 1), 2)

    def test_library_partial_delete_stays_hidden_and_retries_remaining(self):
        item = LibraryDeleteModel()
        item.begin()
        item.verify_file("manifest", "verified_trashed")
        item.verify_file("pdf", "403")
        item.verify_file("old-draft", "404")
        self.assertEqual(item.state, "deleting")
        self.assertFalse(item.readable())
        self.assertFalse(item.featured)
        item.verify_file("pdf", "verified_trashed")
        item.verify_file("old-draft", "verified_trashed")
        self.assertEqual(item.state, "deleted")


if __name__ == "__main__":
    unittest.main(verbosity=2)
