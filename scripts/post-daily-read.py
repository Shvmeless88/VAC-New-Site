#!/usr/bin/env python3
"""Post the owner-approved Daily Read to the office board.
Part of the morning routine's sign-off flow: Claude drafts the bullets in chat,
the OWNER approves (or edits) them, and only then is this script run. Do not
run with bullets the owner has not seen.
Usage: post-daily-read.py <bullets.json> <gcloud-access-token>
bullets.json: {"asOf": "Sep 25", "bullets": ["<b>Rep</b>: ...", ...]}
"""
import sys, json, urllib.request

data = json.load(open(sys.argv[1]))
TOKEN = sys.argv[2]
bullets = data["bullets"]
body = {"fields": {"aiSummary": {"mapValue": {"fields": {
    "asOf": {"stringValue": data.get("asOf", "")},
    "bullets": {"arrayValue": {"values": [{"stringValue": b} for b in bullets]}}}}}}}
url = ("https://firestore.googleapis.com/v1/projects/gen-lang-client-0753805028/"
       "databases/vacnortheast1/documents/config/office?updateMask.fieldPaths=aiSummary")
req = urllib.request.Request(url, data=json.dumps(body).encode(), method="PATCH",
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    json.load(r)
print(f"daily read posted: {len(bullets)} bullets, asOf {data.get('asOf','')}")
