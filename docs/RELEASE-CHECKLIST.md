# Release checklist: real devices

CI tests Windows with named pipes standing in for COM ports and without a
GPU, and Linux in a hidden screen. Some things only a real machine shows:
v0.2.15's Windows serial reader worked with an FTDI adapter and failed with
Cisco's USB console driver, and no test could see it. Before tagging a
release, run this on the build that will ship (the portable `.exe` from a
pre-release works on Windows). It takes about 10 minutes.

Keep it to what the tests can't reach. When something here fails, fix it
and add what you can of it to the e2e suite.

## Windows (a real PC, not a VM, for the GPU items)

- [ ] **Serial, FTDI adapter.** Open a saved serial session, press Enter,
      the prompt appears. Paste a long config (200+ lines, e.g. 40
      class-maps and a policy-map). The paste goes line by line with
      "Pasting line X of Y". Nothing jumps a screenful at a time. The device
      gets every line (`show run | count`).
- [ ] **Serial, Cisco USB console** (mini-USB, Cisco's driver). The same
      paste, the same result.
- [ ] **Telnet and SSH** to a device: logs in from the vault, Send enable
      password works, `show running-config` scrolls without freezing.
- [ ] **GPU drawing on and off** (Settings > Terminal > "Draw the terminal
      with the GPU"): a long `show` output scrolls smoothly both ways, and
      the text is drawn correctly.
- [ ] **Session settings with the vault locked:** change a saved session's
      port or host and Save Changes. It saves, with no password asked.
- [ ] **A second launch** (`thyrion --telnet <host> <port> --title X`)
      opens a tab in the running window.
- [ ] **Upgrade:** the installer over the previous version keeps the
      sessions, the vault and the settings.

## Linux

- [ ] **AppImage** opens a window (not a grey one) on a Wayland desktop.
- [ ] **Serial paste** as above, with the FTDI adapter.
- [ ] **The adapter's latency timer** reads 16 again after Thyrion closes
      the session (`/sys/bus/usb-serial/devices/ttyUSB0/latency_timer`).
