#!/usr/bin/env python3
"""Morning PBS routine: sheet CSV -> website inventory statuses + both board docs.
Usage: python3 morning-update.py <csv> <gcloud-access-token> <google$> <facebook$> <tiktok$>
"""
import csv, json, re, sys, urllib.request, datetime

CSV_PATH, TOKEN = sys.argv[1], sys.argv[2]
G, F, T = (round(float(x)) for x in sys.argv[3:6])
BASE = "https://firestore.googleapis.com/v1/projects/gen-lang-client-0753805028/databases/vacnortheast1/documents"

def api(url, method="GET", body=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

# ---- 1. current site inventory (vin -> {name, status}) ----
rows = api(BASE + ":runQuery", "POST", {"structuredQuery": {
    "from": [{"collectionId": "inventory"}],
    "select": {"fields": [{"fieldPath": "vin"}, {"fieldPath": "status"}]}}})
if isinstance(rows, dict) and "error" in rows:
    sys.exit("Firestore error: " + json.dumps(rows["error"]))
site = {}
for r in rows:
    doc = r.get("document")
    if not doc: continue
    f = doc.get("fields", {})
    vin = f.get("vin", {}).get("stringValue", "")
    if vin:
        site[vin.strip().upper()] = {"name": doc["name"],
            "status": f.get("status", {}).get("stringValue", "For Sale")}

# ---- 2. parse sheet ----
STATUS_MAP = {"Document Signed": "Pending Sale", "Delivery Scheduled": "Pending Sale",
              "Posted": "Sold", "Delivered to Customer": "Sold"}
deals = []
with open(CSV_PATH, newline="", encoding="utf-8-sig") as fh:
    for row in csv.DictReader(fh):
        raw_date = (row.get("Sold Date") or "").strip()
        m = re.match(r"(\d\d)/(\d\d)/(\d{4})", raw_date)
        if not m: continue
        date = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
        gross_s = (row.get("Deal Gross") or "0").replace(",", "").replace("$", "").strip()
        try: gross = round(float(gross_s))
        except ValueError: gross = 0
        deals.append({
            "date": date,
            "stock": (row.get("Stock") or "").strip(),
            "vin": (row.get("VIN") or "").strip().upper(),
            "status": (row.get("Status") or "").strip(),
            "rep": re.sub(r"\s+", " ", (row.get("Sales Rep") or "").strip()),
            "ymm": re.sub(r"\s+", " ", f"{row.get('Year','')} {row.get('Make','')} {row.get('Model','')}").strip(),
            "trim": (row.get("Trim") or "").strip(),
            "gross": gross,
        })
deals.sort(key=lambda d: d["date"], reverse=True)
print(f"sheet deals: {len(deals)}")

# ---- 3. inventory status patches ----
changed, skipped_downgrade, missing = [], [], []
for d in deals:
    want = STATUS_MAP.get(d["status"])
    if not want or not d["vin"]: continue
    cur = site.get(d["vin"])
    if not cur:
        missing.append(f'{d["vin"]} {d["ymm"]} ({d["status"]})')
        continue
    if cur["status"] == want: continue
    if cur["status"] == "Sold" and want == "Pending Sale":
        skipped_downgrade.append(f'{d["vin"]} {d["ymm"]}')
        continue
    fields = {"status": {"stringValue": want}}
    mask = "updateMask.fieldPaths=status"
    if want == "Sold":
        fields["soldAt"] = {"timestampValue": d["date"] + "T15:00:00Z"}
        mask += "&updateMask.fieldPaths=soldAt"
    api(f'https://firestore.googleapis.com/v1/{cur["name"]}?{mask}', "PATCH", {"fields": fields})
    changed.append(f'{d["ymm"]} {d["vin"][-6:]}: {cur["status"]} -> {want}')

# ---- 4. board docs ----
def deal_value(d, with_gross):
    f = {k: {"stringValue": d[k]} for k in ("date", "stock", "vin", "status", "rep", "ymm", "trim")}
    if with_gross: f["gross"] = {"integerValue": str(d["gross"])}
    return {"mapValue": {"fields": f}}

now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
today = now[:10]
sf = {"fields": {"updatedAt": {"stringValue": now},
      "deals": {"arrayValue": {"values": [deal_value(d, False) for d in deals]}}}}
of = {"fields": {"updatedAt": {"stringValue": now},
      "deals": {"arrayValue": {"values": [deal_value(d, True) for d in deals]}},
      "adSpend": {"mapValue": {"fields": {
          "google": {"integerValue": str(G)}, "facebook": {"integerValue": str(F)},
          "tiktok": {"integerValue": str(T)}, "total": {"integerValue": str(G + F + T)},
          "asOf": {"stringValue": today}}}}}}
api(BASE + "/config/salesfloor", "PATCH", sf)
api(BASE + "/config/office", "PATCH", of)

# ---- 5. summary ----
print(f"inventory patched: {len(changed)}")
for c in changed: print("  ", c)
if skipped_downgrade: print("kept Sold (sheet says pending):", "; ".join(skipped_downgrade))
if missing: print("VINs not on website:", "; ".join(missing))
month = today[:7]
mdeals = [d for d in deals if d["date"][:7] == month]
posted = [d for d in mdeals if d["status"] in ("Posted", "Delivered to Customer")]
print(f"boards: {len(deals)} deals written | {len(mdeals)} this month | "
      f"{len(posted)} posted | gross(posted) ${sum(d['gross'] for d in posted):,} | "
      f"adSpend ${G+F+T:,}")
