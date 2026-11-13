# Serving Pi Web over HTTP/2

Over plain HTTP a browser opens at most six connections to one origin, shared by all of its tabs. Pi Web holds one long-lived event stream per open chat, terminal and watched file. With many of them active at once, other requests (sending a message, opening Settings) wait in the browser until a stream closes.

Pi Web already lets go of a hidden tab's idle streams after 30 seconds, which is enough for most people. If you keep many active pages open at the same time, serve Pi Web over HTTP/2: one connection then carries all the streams. Browsers use HTTP/2 only over HTTPS, so this takes a reverse proxy that terminates TLS. Pi Web itself needs no change.

## Locally, with Caddy

[Caddy](https://caddyserver.com/) serves HTTPS and HTTP/2 with a certificate it creates for `localhost`:

```bash
pi-web
caddy reverse-proxy --from localhost:8443 --to 127.0.0.1:30141
```

Open <https://localhost:8443>. The first run asks for your password to add Caddy's local certificate authority to the system trust store (`caddy trust`); use the address you passed to `--from`, since the certificate is issued for that name. Caddy forwards event streams without buffering and keeps the `Host` header, so Pi Web's host and origin checks accept the requests.

To check, open the browser's developer tools, Network panel, and look at the Protocol column: `h2`.

## Remote access

For another device, a proxy that serves your own domain or private network name works the same way, for example a Caddyfile site block with `reverse_proxy 127.0.0.1:30141`, or `tailscale serve` on a Tailscale network. Keep Pi Web bound to `127.0.0.1` behind it, keep a password set (`PI_WEB_PASSWORD`), and add the external hostname to `PI_WEB_ALLOWED_HOSTS`, as described under Remote Access in the [README](../README.md#remote-access).
