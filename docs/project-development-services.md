# Project development services

Pi Web can control the local development processes listed in a project's `Procfile.dev`. Put the file at the project root. For example, a Node project with `dev` and `worker:dev` package scripts could use:

```procfile
web: npm run dev
worker: npm run worker:dev
```

Each non-empty line has the form `name: command`. The name identifies the service in Pi Web, and the command is run from the project directory. Blank lines and lines starting with `#` are ignored. Use a different name for each service.

The project button in the sidebar starts all configured services, or stops them when they are running. Hover or open its service menu to see individual statuses and controls. Click a service name to open its live logs in the right panel. Closing that panel leaves the process running; use its Stop control or the project button to stop it.

Reading `Procfile.dev` only discovers the services. Pi Web runs a command after you explicitly start it from the sidebar or service panel. Commands run through the platform shell, so use commands you trust.
