"""
@author Codex
@description Exercises guarded input failure accounting with an in-process Win32 substitute; never injects actual keyboard or mouse events.
"""
import ctypes
import importlib.util
import sys
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('guarded', Path(sys.argv.pop(1)))
desktop = importlib.util.module_from_spec(spec)
spec.loader.exec_module(desktop)


class User:
    """Records requested input batches and returns specified native counts without dispatching input."""
    def __init__(self, counts, held=0):
        """Provides deterministic native counts and current held-key state."""
        self.counts = list(counts)
        self.held = held
        self.batches = []

    def GetAsyncKeyState(self, code):
        """Emulates current-down only; the unreliable recently-pressed bit is irrelevant."""
        return 0x8000 if code == self.held else 0

    def SendInput(self, count, batch, size):
        """Copies native structures before returning a bounded injected count."""
        assert size == ctypes.sizeof(desktop.Input)
        self.batches.append([desktop.Input.from_buffer_copy(item) for item in batch])
        return self.counts.pop(0) if self.counts else count


class FaultTests(unittest.TestCase):
    """Verifies business effects, release ownership and action replay suppression at the Python boundary."""
    def setUp(self):
        """Replaces desktop validation only inside this isolated test process."""
        desktop.validate = lambda *_args: {'left': 0, 'top': 0, 'width': 100, 'height': 100}

    def test_complete_key_batch_has_no_extra_releases(self):
        """Normal key completion must not add unconditional global key-up events."""
        desktop.user = User([4])
        result = desktop.execute({}, {'kind': 'key', 'key': 'a', 'modifiers': ['Control']})
        self.assertEqual(result['effect'], 'applied')
        self.assertEqual(len(desktop.user.batches), 1)

    def test_zero_input_is_not_applied_and_has_no_cleanup(self):
        """A zero-insertion first batch must not manufacture unknown state or release user keys."""
        desktop.user = User([0])
        result = desktop.execute({}, {'kind': 'key', 'key': 'a', 'modifiers': ['Control']})
        self.assertEqual(result, {'contractVersion': 1, 'effect': 'not_applied', 'code': 'INPUT_FAILED'})
        self.assertEqual(len(desktop.user.batches), 1)

    def test_partial_releases_only_unmatched_accepted_modifier(self):
        """A completed letter pair must not be released again; only the unmatched Control down is owned."""
        desktop.user = User([3, 1])
        result = desktop.execute({}, {'kind': 'key', 'key': 'a', 'modifiers': ['Control']})
        self.assertEqual(result['effect'], 'unknown')
        self.assertEqual(result['code'], 'PARTIAL_INPUT')
        cleanup = desktop.user.batches[1]
        self.assertEqual([(item.value.keyboard.vk, item.value.keyboard.flags) for item in cleanup], [(17, 2)])
        self.assertEqual(len(desktop.user.batches), 2)

    def test_partial_unicode_releases_only_unmatched_scan(self):
        """Accepted Unicode down/up pairs are removed before cleanup; no literal text is replayed."""
        desktop.user = User([3, 1])
        result = desktop.execute({}, {'kind': 'type', 'text': 'ab'})
        self.assertEqual(result['effect'], 'unknown')
        self.assertEqual([(item.value.keyboard.scan, item.value.keyboard.flags) for item in desktop.user.batches[1]], [(ord('b'), 6)])

    def test_partial_mouse_releases_only_unmatched_button(self):
        """Only the accepted unmatched click down is released without cursor movement or another click."""
        desktop.user = User([1, 1])
        down, up = desktop.Input(), desktop.Input()
        down.value.mouse.flags, up.value.mouse.flags = 2, 4
        with self.assertRaises(desktop.InputFailure):
            desktop.send([down, up])
        self.assertEqual([item.value.mouse.flags for item in desktop.user.batches[1]], [4])

    def test_held_input_rejects_without_submission_or_reset(self):
        """Any already held keyboard or mouse button refuses this call without changing that state."""
        for code in [17, 16, 18, 91, 65, 1]:
            desktop.user = User([], code)
            result = desktop.execute({}, {'kind': 'type', 'text': 'must not type'})
            self.assertEqual(result, {'contractVersion': 1, 'effect': 'not_applied', 'code': 'INPUT_BUSY'})
            self.assertEqual(desktop.user.batches, [])

    def test_failed_later_batch_retains_prior_effect(self):
        """A zero count after an earlier literal batch cannot erase the already inserted prefix."""
        desktop.user = User([16, 0])
        result = desktop.execute({}, {'kind': 'type', 'text': '123456789'})
        self.assertEqual(result['effect'], 'unknown')
        self.assertEqual(len(desktop.user.batches), 2)

    def test_extended_key_flags_survive_partial_cleanup(self):
        """Navigation key cleanup keeps the extended flag from the accepted down event."""
        desktop.user = User([1, 1])
        result = desktop.execute({}, {'kind': 'key', 'key': 'ArrowLeft'})
        self.assertEqual(result['effect'], 'unknown')
        self.assertEqual(desktop.user.batches[0][0].value.keyboard.flags, 1)
        self.assertEqual(desktop.user.batches[1][0].value.keyboard.flags, 3)


if __name__ == '__main__':
    unittest.main()
