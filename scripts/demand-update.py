#!/usr/bin/env python3
"""Build the Website Demand block for the office board and PATCH it into
config/office (demand field only — deals/adSpend untouched).
Usage: demand-update.py <ga4-week.json> <forsale.json> <interest.json> <token>
ga4-week.json: [{p: "/inventory/<slug>-<docid>", u: users, v: views}, ...]
forsale.json:  [{id, name, body}, ...]  (For Sale cars only)
interest.json: {"SUV & Crossover": n, "Sedan": n, "Truck": n, "Minivan": n, ...}
"""
import json, sys, datetime, urllib.request

ga = json.load(open(sys.argv[1]))
forsale = json.load(open(sys.argv[2]))
interest = json.load(open(sys.argv[3]))
TOKEN = sys.argv[4]

users_by_id = {}
for row in ga:
    doc_id = row["p"].rstrip("/").split("-")[-1]
    if len(doc_id) == 20:
        users_by_id[doc_id] = users_by_id.get(doc_id, 0) + row["u"]

hot = sorted(
    ({"name": c["name"], "users": users_by_id.get(c["id"], 0)} for c in forsale),
    key=lambda x: -x["users"])[:5]
cold = [c["name"] for c in forsale if users_by_id.get(c["id"], 0) <= 2]

body_map = {"SUV & Crossover": "SUV", "Sedan": "Sedan", "Truck": "Truck",
            "Minivan": "Minivan", "Hatchback": "Sedan"}
want = {}
for k, n in interest.items():
    b = body_map.get(k)
    if b: want[b] = want.get(b, 0) + n
have = {}
for c in forsale:
    b = "SUV" if c["body"] in ("SUV", "Van") else (c["body"] or "Other")
    if c["body"] == "Hatchback": b = "Sedan"
    have[b] = have.get(b, 0) + 1

def sv(x): return {"stringValue": str(x)}
def iv(x): return {"integerValue": str(int(x))}
def arr(vals): return {"arrayValue": {"values": vals}}
def mp(d): return {"mapValue": {"fields": d}}

demand = mp({
    "asOf": sv(datetime.date.today().isoformat()),
    "windowDays": iv(7),
    "hot": arr([mp({"name": sv(h["name"]), "users": iv(h["users"])}) for h in hot]),
    "coldCount": iv(len(cold)),
    "cold": arr([sv(n) for n in cold[:8]]),
    "want": mp({k: iv(v) for k, v in want.items()}),
    "have": mp({k: iv(v) for k, v in have.items()}),
})
body = {"fields": {"demand": demand}}
url = ("https://firestore.googleapis.com/v1/projects/gen-lang-client-0753805028/"
       "databases/vacnortheast1/documents/config/office?updateMask.fieldPaths=demand")
req = urllib.request.Request(url, data=json.dumps(body).encode(), method="PATCH",
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    json.load(r)
print("demand written:")
print("  hot:", ", ".join(f'{h["name"]} ({h["users"]})' for h in hot))
print(f"  cold: {len(cold)} cars ≤2 shoppers:", ", ".join(cold[:8]))
print("  want:", want, " have:", have)
