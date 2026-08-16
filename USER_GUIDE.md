# pi-web User Guide

## Accessing the Web UI

1. Open your browser and navigate to `https://pi06.n8n.tw` (or `http://192.168.1.61:30141` locally).
2. When prompted for authentication:
   - **Username**: `pi` *(The username is fixed by upstream pi-web authentication)*
   - **Password**: `your_complex_password_here`

---

## Workspace & Sessions

- All sessions and agent data are persisted in `${HOME}/.pi/agent` on the host machine.
- The default project workspace inside the UI is mapped to `/workspace` (`/home/wrt/AG/SystemRepair` on the host).
- Additional host directories can be mounted into `docker-compose.yml` under `volumes:` to allow the agent to operate on multiple projects.
