#!/usr/bin/env python3
"""Linux: AT-SPI — insert memory context into the focused editable control."""
from __future__ import annotations

import pathlib
import sys


def main() -> int:
    if len(sys.argv) < 2:
        return 1
    path = pathlib.Path(sys.argv[1])
    if not path.is_file():
        return 1
    text = path.read_text(encoding="utf-8")

    try:
        import pyatspi  # type: ignore
    except ImportError:
        return 2

    try:
        desktop = pyatspi.Registry.getDesktop(0)
    except Exception:
        return 2

    def find_focused(acc):
        try:
            st = acc.getState()
        except Exception:
            return None
        if st.contains(pyatspi.STATE_FOCUSED):
            return acc
        for i in range(acc.childCount):
            child = acc.getChildAtIndex(i)
            found = find_focused(child)
            if found is not None:
                return found
        return None

    focused = find_focused(desktop)
    if focused is None:
        return 3

    target = focused
    et = None
    for _ in range(8):
        try:
            et = target.queryEditableText()
            break
        except Exception:
            try:
                target = target.parent
            except Exception:
                target = None
            if target is None:
                break
    if et is None:
        return 3

    try:
        if hasattr(et, "setTextContents"):
            et.setTextContents(text)
        else:
            try:
                ti = focused.queryText()
                n = ti.characterCount
            except Exception:
                n = 0
            et.insertText(n, "\n" + text)
    except Exception:
        return 4

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
