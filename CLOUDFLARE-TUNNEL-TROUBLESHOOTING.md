# Cloudflare Tunnel Troubleshooting — GodMuscleGears

## Infrastructure Overview

| Subdomain | Tunnel Name | Tunnel ID | Routes To |
|-----------|-------------|-----------|-----------|
| `ai.godmusclegears.com` | `gmg-trt-tunnel` | `9e9da049-9017-4411-878c-a1baf430a88b` | `localhost:5678` (n8n) |
| `n8n.godmusclegears.com` | `n8n-tunnel` | *(see Cloudflare dashboard)* | `localhost:5678` (n8n) |

- **Oracle Cloud VM IP:** `193.122.248.225`
- **SSH key:** `C:\Users\LESTER\Downloads\ssh-key-2026-06-14.key`
- **n8n Docker container:** `n8n` — runs on port `5678`
- **n8n dashboard:** `http://193.122.248.225.nip.io:5678`
- **Cloudflared config:** `/home/ubuntu/.cloudflared/config.yml`

---

## Symptom: Chat widget shows "Connection issue. Please try again in a moment."

This error comes from the chat widget's `.catch()` block — meaning the request to the webhook URL failed completely (not an n8n error, a network/tunnel error).

**Most likely cause:** The Cloudflare tunnel for `ai.godmusclegears.com` is broken (returns HTTP 530).

---

## How to Diagnose

### Step 1 — Test the webhook directly
SSH into the Oracle server and run:
```bash
ssh -i "C:\Users\LESTER\Downloads\ssh-key-2026-06-14.key" ubuntu@193.122.248.225

curl -s -o /dev/null -w '%{http_code}' -X POST https://ai.godmusclegears.com/webhook/godmuscle-trt-chatbot/chat \
  -H "Content-Type: application/json" \
  -d '{"action":"sendMessage","sessionId":"test","chatInput":"hello"}'
```

| Response | Meaning |
|----------|---------|
| `200` or `422` | Tunnel is working — problem is elsewhere (check n8n workflow) |
| `530` | Tunnel is broken — follow fix below |
| Connection refused | n8n Docker container is down — restart it |

### Step 2 — Check if n8n is running
```bash
docker ps | grep n8n
curl -s -o /dev/null -w '%{http_code}' http://localhost:5678/healthz
```
Should show `200`. If not, restart: `docker start n8n`

### Step 3 — Check if cloudflared is running
```bash
ps aux | grep cloudflared | grep -v grep
```
Should show at least one process. If not, restart it (see below).

---

## Fix: HTTP 530 on ai.godmusclegears.com

530 means Cloudflare can't route traffic to the origin. Two things can cause this:

### Fix A — Re-register the DNS route (most common)
Run this on the Oracle server:
```bash
cloudflared tunnel route dns --overwrite-dns 9e9da049-9017-4411-878c-a1baf430a88b ai.godmusclegears.com
```
Expected output: `Added CNAME ai.godmusclegears.com which will route to this tunnel`

### Fix B — Restore ai.godmusclegears.com in the cloudflared config
Check the config:
```bash
cat /home/ubuntu/.cloudflared/config.yml
```

It must contain `ai.godmusclegears.com` in the ingress rules. If missing, edit the file:
```bash
cat > /home/ubuntu/.cloudflared/config.yml << 'EOF'
tunnel: 9e9da049-9017-4411-878c-a1baf430a88b
credentials-file: /home/ubuntu/.cloudflared/9e9da049-9017-4411-878c-a1baf430a88b.json

ingress:
  - hostname: ai.godmusclegears.com
    service: http://localhost:5678
  - hostname: n8n.godmusclegears.com
    service: http://localhost:5678
  - service: http_status:404
EOF
```

Then restart cloudflared:
```bash
pkill cloudflared
nohup cloudflared tunnel --config /home/ubuntu/.cloudflared/config.yml run gmg-trt-tunnel > /home/ubuntu/cloudflared.log 2>&1 &
```

Wait 5–10 seconds, then re-test.

---

## Fix: n8n workflow shows "Error in workflow"

This is an n8n-side error — the tunnel is working but the workflow failed internally.

1. Open n8n dashboard: `http://193.122.248.225.nip.io:5678`
2. Go to the **TRT Chatbot** workflow → **Executions** tab
3. Click the latest failed execution to see which node errored
4. Common causes:
   - **Groq/OpenAI API key expired** — update the credential in the node settings
   - **Window Buffer Memory node** — usually caused by a malformed test request, not a real issue. Check if real chat messages succeed.
   - **Workflow deactivated** — click **Publish** (top right) to re-activate

---

## Why This Broke Originally (June 2026)

When `n8n.godmusclegears.com` was created for Meta verification, two things got broken for `ai.godmusclegears.com`:

1. The cloudflared config ingress rules were updated to only include `n8n.godmusclegears.com`, removing `ai.godmusclegears.com`
2. The Cloudflare DNS CNAME for `ai.godmusclegears.com` was pointing to a stale tunnel ID

**Fix applied:** Re-added `ai.godmusclegears.com` to the config ingress rules and ran `cloudflared tunnel route dns --overwrite-dns` to update the CNAME.

**Prevention:** Whenever you create a new tunnel or modify the cloudflared config, always verify that `ai.godmusclegears.com` is still in the ingress rules and re-run the `--overwrite-dns` command if needed.

---

## Quick Reference Commands

```bash
# SSH into Oracle server
ssh -i "C:\Users\LESTER\Downloads\ssh-key-2026-06-14.key" ubuntu@193.122.248.225

# Check n8n container
docker ps | grep n8n

# Check cloudflared running
ps aux | grep cloudflared | grep -v grep

# View cloudflared logs
tail -50 /home/ubuntu/cloudflared.log

# Re-register ai subdomain to tunnel
cloudflared tunnel route dns --overwrite-dns 9e9da049-9017-4411-878c-a1baf430a88b ai.godmusclegears.com

# Restart cloudflared
pkill cloudflared && nohup cloudflared tunnel --config /home/ubuntu/.cloudflared/config.yml run gmg-trt-tunnel > /home/ubuntu/cloudflared.log 2>&1 &

# Restart n8n
docker restart n8n
```
