# Temporary files for chat images

Pasted, dropped, and selected chat images are still sent as inline image inputs
and shown in the composer and conversation. Pi Web also saves the received image
bytes to temporary files on the server and appends their absolute paths, numbered
in attachment order, to the agent's message. Local file and image tools can use
these paths without asking the user to locate or save the image again (#635).

Files are created before the prompt is submitted. A failed write rejects the
submission and removes that batch's partial files. A rejected prompt preflight
also removes its batch; a provider failure after acceptance preserves the files
for follow-up work. Normal prompts, streaming prompts, steering and follow-ups
use the same storage path.

## Storage and lifetime

- Files live below the OS temporary directory (`os.tmpdir()`, normally `$TMPDIR`
  on Unix) in a private `pi-web-clipboard-v1-<pid>-<random>/batch-<random>` directory.
- File names are `pi-web-clipboard-<uuid>.<extension>`. The extension comes from
  the declared image MIME type; client-supplied names and paths are never used.
- Directories use mode `0700` and files use `0600` on POSIX systems. Windows
  access remains governed by the user's temporary-directory ACLs.
- The existing limits of 10 images and 10 MiB per image remain. Malformed Base64
  and MIME types without a supported file extension are rejected. This is not a
  full image decoder: existing image decoding remains the responsibility of the
  browser, model provider and image tools.
- Files belong to the server process, so releasing an idle session wrapper,
  reloading its tools, or forking a session does not immediately delete them.
- The process checks hourly and removes its temporary files after 24 hours of
  inactivity. New prompt/steering/follow-up submissions refresh that period;
  active agent work and queued messages defer expiry for all images in the
  process. These files are not a durable storage API or a disk quota mechanism.
- Normal process exit removes its files. On the next image upload and hourly
  thereafter, directories older than 24 hours whose owning process no longer
  exists are collected. Live or unverifiable owners, other users' directories
  on POSIX, unrelated names and symlinks are skipped. PID reuse conservatively
  delays collection. Cleanup errors are logged by the server.

Paths can expire or disappear on restart or OS temporary-directory cleanup.
Historical messages keep their inline image data, but their old paths are not
automatically recreated. Reattach the image when a fresh path is needed. No
cross-session or cross-process path permanence is promised. The file browser's
allowed roots are not broadened to include the whole temporary directory.

## Image fidelity

The temporary file contains exactly the bytes received by the server. The
existing browser compression still applies: images larger than 1 MiB, except
GIFs, may be resized to a maximum 1024-pixel side and encoded as JPEG at 0.85
quality when that produces a smaller payload. This feature does not archive
the original upload before compression.

The paths are local to the server. A model receives the inline image and the
path annotation; whether it calls a file tool depends on the task and enabled
tools. Providing a path does not give a text-only model vision capability.

## Verification

`lib/image-materialization.test.mjs` covers byte preservation, limits, private
permissions, isolated batches, partial-write rollback and garbage collection.
`lib/rpc-manager-images.test.mjs` checks all message entry points, rejection
versus acceptance cleanup, wrapper disposal and actual Pi `read` tool access.
The browser suite creates non-sensitive JPEG/PNG fixtures, exercises picker,
paste and drop on desktop/mobile, and checks the inputs at the SDK extension
boundary against readable server files. It does not contact a model provider.
