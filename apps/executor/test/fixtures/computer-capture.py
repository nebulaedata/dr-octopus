"""
@author Codex
@description Verifies bounded Pillow capture and rejection semantics with synthetic images, without reading a desktop or injecting input.
"""
import base64
import asyncio
import io
import sys
import unittest
from unittest.mock import patch
from PIL import Image
from product import server
from mcp import types


class CaptureTests(unittest.TestCase):
    """Checks capture invariants independently of real foreground ownership and screenshot drivers."""

    def test_startup_does_not_initialize_unused_backends(self):
        """A fixed Pillow service must not pay for GPU enumeration, NumPy or UI Automation during handshake."""
        forbidden = ('dxcam', 'numpy', 'mss', 'comtypes', 'windows_mcp.uia', 'windows_mcp.desktop.screenshot')
        self.assertFalse([name for name in sys.modules if any(name == prefix or name.startswith(prefix + '.') for prefix in forbidden)])

    def test_capture_protocol_returns_only_finite_safe_refusal_codes(self):
        """Preserves known target refusals while excluding unexpected exception text from both MCP and stderr."""
        target = {'contractVersion': 1, 'desktopSessionId': 'fixture', 'layoutVersion': 'fixture', 'identity': {'hwnd': '123', 'pid': 123, 'processStartedAt': '123'}, 'expectedBoundsPx': {'left': 0, 'top': 0, 'width': 80, 'height': 60}}
        params = types.CallToolRequestParams(name='ExecutorCapture', arguments=target)
        for error, code in [(RuntimeError(value), value) for value in ('TARGET_CHANGED', 'SESSION_UNAVAILABLE', 'CAPTURE_UNVERIFIED', 'CAPTURE_LIMIT')] + [(OSError('secret path and pixels'), 'CAPTURE_FAILED'), (RuntimeError('secret path and pixels'), 'CAPTURE_FAILED')]:
            with self.subTest(code=code), patch.object(server, 'capture', side_effect=error), patch.object(server.sys, 'stderr', io.StringIO()) as stderr:
                result = asyncio.run(server.call_tool(None, params))
            wire = result.model_dump(by_alias=True, exclude_none=True)
            self.assertTrue(wire['isError'])
            self.assertEqual(wire['content'], [])
            self.assertEqual(wire['structuredContent'], {'contractVersion': 1, 'error': {'code': code}})
            self.assertNotIn('secret', stderr.getvalue())
            self.assertIn(code, stderr.getvalue())

    def test_exact_physical_bbox_and_png(self):
        """Uses physical coordinates with all displays and rechecks the target before returning a valid PNG."""
        rect = {'left': -100, 'top': 20, 'width': 80, 'height': 60}
        target = {'owned': 'fixture'}
        with patch.object(server, 'validate', side_effect=[rect, rect]) as validate, patch.object(server.ImageGrab, 'grab', return_value=Image.new('RGB', (80, 60), 'red')) as grab:
            result = server.capture(target)
        grab.assert_called_once_with(bbox=(-100, 20, -20, 80), all_screens=True)
        self.assertEqual(validate.call_count, 2)
        self.assertEqual(result['captureRectPx'], rect)
        with Image.open(io.BytesIO(base64.b64decode(result['image']['data']))) as image:
            self.assertEqual(image.format, 'PNG')
            self.assertEqual(image.size, (80, 60))
            self.assertEqual(image.getpixel((0, 0)), (255, 0, 0))

    def test_negative_virtual_origin_fallback(self):
        """Crops relative to the virtual screen origin when the selected region grab fails."""
        rect = {'left': -100, 'top': -20, 'width': 80, 'height': 60}
        virtual = Image.new('RGB', (300, 200), 'blue')
        virtual.paste('red', (100, 30, 180, 90))
        with patch.object(server, 'validate', side_effect=[rect, rect]), patch.object(server, 'virtual_screen_origin', return_value=(-200, -50)), patch.object(server.ImageGrab, 'grab', side_effect=[OSError('fixture'), virtual]) as grab:
            result = server.capture({})
        self.assertEqual(grab.call_count, 2)
        self.assertEqual(grab.call_args.kwargs, {'all_screens': True})
        with Image.open(io.BytesIO(base64.b64decode(result['image']['data']))) as image:
            self.assertEqual(image.size, (80, 60))
            self.assertEqual(image.getpixel((79, 59)), (255, 0, 0))

    def test_rejected_target_never_captures(self):
        """An identity or foreground rejection cannot acquire desktop pixels."""
        with patch.object(server, 'validate', side_effect=RuntimeError('TARGET_CHANGED')), patch.object(server.ImageGrab, 'grab') as grab:
            with self.assertRaisesRegex(RuntimeError, 'TARGET_CHANGED'):
                server.capture({})
        grab.assert_not_called()

    def test_changed_target_or_wrong_size_never_returns_image(self):
        """Rejects a changed post-capture target or unexpected physical size before returning image bytes."""
        rect = {'left': 0, 'top': 0, 'width': 80, 'height': 60}
        for size, after in [((79, 60), rect), ((80, 60), {**rect, 'left': 1})]:
            with self.subTest(size=size, after=after), patch.object(server, 'validate', side_effect=[rect, after]), patch.object(server.ImageGrab, 'grab', return_value=Image.new('RGB', size)):
                with self.assertRaisesRegex(RuntimeError, 'CAPTURE_UNVERIFIED'):
                    server.capture({})

    def test_downscaled_image_keeps_original_physical_region(self):
        """Limits exported dimensions while retaining the physical coordinate mapping for later actions."""
        rect = {'left': 10, 'top': 20, 'width': 2400, 'height': 1200}
        with patch.object(server, 'validate', side_effect=[rect, rect]), patch.object(server.ImageGrab, 'grab', return_value=Image.new('RGB', (2400, 1200))):
            result = server.capture({})
        self.assertEqual(result['captureRectPx'], rect)
        self.assertEqual(result['imageSizePx'], {'width': 1920, 'height': 960})


if __name__ == '__main__':
    unittest.main()
