#!/usr/bin/env python3
"""Throwaway GTK3 X11 test application for Foundry Computer Use proof.

Forced onto X11 so xdotool/wmctrl/AT-SPI can address THIS window without touching
unrelated Wayland-native apps (Cursor, ChatGPT, the installed War Room).
"""
import os
import sys

os.environ.setdefault("GDK_BACKEND", "x11")

import gi
gi.require_version("Gtk", "3.0")
from gi.repository import Gtk, Gdk, GLib

MARKER = "FOUNDRY_CU_MARKER_ALPHA"
TITLE = "Foundry Computer Use Test"


class FoundryCuWindow(Gtk.Window):
    def __init__(self) -> None:
        super().__init__(title=TITLE)
        self.set_default_size(520, 420)
        self.set_wmclass("foundry-cu-test", "FoundryComputerUseTest")
        self.connect("destroy", Gtk.main_quit)

        box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL, spacing=8)
        box.set_border_width(12)
        self.add(box)

        self.marker = Gtk.Label(label=MARKER)
        self.marker.set_name("foundry-cu-marker")
        box.pack_start(self.marker, False, False, 0)

        self.entry = Gtk.Entry()
        self.entry.set_placeholder_text("type here")
        self.entry.set_name("foundry-cu-entry")
        box.pack_start(self.entry, False, False, 0)

        self.button = Gtk.Button(label="Click Me")
        self.button.set_name("foundry-cu-button")
        self.click_count = 0
        self.status = Gtk.Label(label="clicks=0")
        self.button.connect("clicked", self.on_click)
        box.pack_start(self.button, False, False, 0)
        box.pack_start(self.status, False, False, 0)

        scrolled = Gtk.ScrolledWindow()
        scrolled.set_min_content_height(120)
        self.text = Gtk.TextView()
        self.text.get_buffer().set_text("\n".join(f"scroll-line-{i}" for i in range(40)))
        scrolled.add(self.text)
        box.pack_start(scrolled, True, True, 0)

        self.chooser = Gtk.FileChooserButton(title="Foundry CU file", action=Gtk.FileChooserAction.OPEN)
        self.chooser.set_name("foundry-cu-file")
        self.file_label = Gtk.Label(label="file=(none)")
        self.chooser.connect("file-set", self.on_file)
        box.pack_start(self.chooser, False, False, 0)
        box.pack_start(self.file_label, False, False, 0)

        clip_btn = Gtk.Button(label="Copy Marker")
        clip_btn.connect("clicked", self.on_copy)
        box.pack_start(clip_btn, False, False, 0)

    def on_click(self, _btn) -> None:
        self.click_count += 1
        self.status.set_text(f"clicks={self.click_count}")

    def on_file(self, chooser) -> None:
        name = chooser.get_filename() or "(none)"
        self.file_label.set_text(f"file={os.path.basename(name)}")

    def on_copy(self, _btn) -> None:
        clip = Gtk.Clipboard.get(Gdk.SELECTION_CLIPBOARD)
        clip.set_text(MARKER, -1)
        clip.store()


def main() -> int:
    win = FoundryCuWindow()
    win.show_all()
    # Keep it on screen long enough for the proof; the Node side closes it.
    GLib.timeout_add_seconds(180, Gtk.main_quit)
    Gtk.main()
    return 0


if __name__ == "__main__":
    sys.exit(main())
