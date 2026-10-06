# Foundry Linux install: why `chrome-sandbox` becomes root-owned

The native Chromium sandbox needs the `chrome-sandbox` helper to be `root:root` with mode `4755`. Foundry never disables the sandbox to get around this.

## What sets the ownership

`applyHelper()` in `desktop/workbench-host/prepare-linux-chrome-sandbox.cjs` runs, in order:

1. `sudo -n sh -c 'chown root:root <helper> && chmod 4755 <helper>'` (works only if sudo is already authorized; never prompts).
2. `pkexec sh -c '<same command>'` (asks the desktop for authorization through polkit).

It is called twice per build-and-install cycle: by the desktop build's after-pack step (`desktop/scripts/after-pack-linux-sandbox.cjs`) on `desktop/dist-release/linux-unpacked/chrome-sandbox`, and by the installer (`lib/native-builder/installerTool.ts`) on the installed copy. The installer writes the outcome to `LINUX_CHROME_SANDBOX.json` in the install directory (`method`: `already`, `sudo-n`, `pkexec`, or `operator-sudo-required`).

## What the 05ab to 05ad installs showed

- 05ab and 05ac: no authorization was available at install time, so the record says `operator-sudo-required` and the operator ran the one printed `sudo chown ... && sudo chmod 4755 ...` command.
- 05ad: the system journal shows a polkit prompt raised and authenticated during the build step (17 seconds between the prompt and the `pkexec` run), then a second `pkexec` for the installed helper 41 seconds later with no new prompt. That second request used the short-lived authorization polkit had just granted. The record says `method: pkexec`.

So root ownership without a manual `sudo` is expected when somebody approves the desktop prompt (or its short-lived approval is still valid), and it is never silent: without an approval the install stops at `operator-sudo-required` with the exact command.

## Checking

`explainSandboxInstall()` (`lib/native-builder/foundrySandboxInstallExplanation.ts`) turns a `LINUX_CHROME_SANDBOX.json` into a plain sentence. `ls -l <helper>` must show `-rwsr-xr-x root root`.
