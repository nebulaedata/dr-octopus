"""
@author Codex
@description Keeps the isolated embedded interpreter's existing private search roots usable beyond Windows MAX_PATH; does not add ambient paths or desktop behavior.
"""
import sys

if sys.platform == 'win32':
    for index, path in enumerate(sys.path):
        if path.startswith('\\\\?\\'):
            continue
        if path.startswith('\\\\'):
            sys.path[index] = '\\\\?\\UNC\\' + path[2:]
        else:
            sys.path[index] = '\\\\?\\' + path
# comtypes documents gen_dir=None as in-memory typelib generation. Keep runtime
# generated wrappers out of the immutable installation tree and release manifest.
import comtypes.client
comtypes.client.gen_dir = None
