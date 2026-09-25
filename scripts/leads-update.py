#!/usr/bin/env python3
"""Per-rep month funnel numbers for the office board -> config/office.
Writes two maps (PBS rep-name keyed):
  repDeals — deals created this month per current owner (reliable: deals never
             bounce to the house account).
  repLeads — leads ASSIGNED this month per rep, from the leadAssignRoster the
             server tick records (matches the Google Chat pings). Only written
             once the roster covers the month from the start; Pipedrive's
             current-owner view can't reconstruct it (dead leads bounce back
             to the house account and lose the rep).
Usage: leads-update.py <pipedrive-token> <gcloud-access-token>
"""
import sys, json, datetime, urllib.request, collections

PD, TOKEN = sys.argv[1], sys.argv[2]
month_start = datetime.date.today().replace(day=1).isoformat()

PD_TO_PBS = {
    21348819: "Deven Calda",
    22668698: "Ty Sutton",
    22480059: "Kristian Maki",
    22840705: "Demmerick Stevenson",
    22771097: "Karla Hines",
    23841045: "Connor Gavel",
    24184487: "Mason Thomas",
    31969194: "Dalius Moore",
    24739624: "Monica Anthony",
    17102613: "Alex Sirois",
    24120588: "Luke Porter",
    22174127: "Rodney Spencer",
}

def get(url, method="GET", body=None, auth=None):
    req = urllib.request.Request(url, method=method,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": f"Bearer {auth}", "Content-Type": "application/json"} if auth else {})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

# --- deals created this month by owner ---
deals = collections.Counter(); start = 0
while True:
    d = get(f"https://api.pipedrive.com/v1/deals?limit=500&start={start}&sort=add_time%20DESC&api_token={PD}")
    rows = d.get("data") or []
    stop = False
    for dl in rows:
        if dl["add_time"] < month_start: stop = True; break
        uid = dl.get("user_id")
        if isinstance(uid, dict): uid = uid.get("id")
        deals[uid] += 1
    pag = d.get("additional_data", {}).get("pagination", {})
    if stop or not pag.get("more_items_in_collection"): break
    start = pag["next_start"]
rep_deals = {PD_TO_PBS[u]: n for u, n in deals.items() if u in PD_TO_PBS}

# --- leads assigned this month, from the tick's roster ---
BASE = "https://firestore.googleapis.com/v1/projects/gen-lang-client-0753805028/databases/vacnortheast1/documents"
rows = get(BASE + ":runQuery", "POST", {"structuredQuery": {
    "from": [{"collectionId": "leadAssignRoster"}],
    "where": {"fieldFilter": {"field": {"fieldPath": "addTime"},
              "op": "GREATER_THAN_OR_EQUAL", "value": {"stringValue": month_start}}}}}, TOKEN)
roster = collections.Counter(); earliest = None
for r in rows:
    doc = r.get("document")
    if not doc: continue
    f = doc["fields"]
    oid = int(f.get("ownerId", {}).get("integerValue", 0))
    at = f.get("addTime", {}).get("stringValue", "")
    roster[oid] += 1
    if at and (earliest is None or at < earliest): earliest = at
covers_month = earliest is not None and earliest <= month_start + "T12:00:00"
rep_leads = {PD_TO_PBS[u]: n for u, n in roster.items() if u in PD_TO_PBS} if covers_month else {}

def imap(d, extra=None):
    fields = {k: {"integerValue": str(v)} for k, v in d.items()}
    if extra: fields.update(extra)
    return {"mapValue": {"fields": fields}}

today = datetime.date.today().isoformat()
body = {"fields": {
    "repDeals": imap(rep_deals, {"asOf": {"stringValue": today}}),
    "repLeads": imap(rep_leads, {"asOf": {"stringValue": today}}),
}}
url = BASE + "/config/office?updateMask.fieldPaths=repDeals&updateMask.fieldPaths=repLeads"
get(url, "PATCH", body, TOKEN)
print("repDeals:", dict(sorted(rep_deals.items(), key=lambda x: -x[1])))
print("repLeads (roster):", dict(sorted(rep_leads.items(), key=lambda x: -x[1])) if rep_leads
      else f"not written — roster coverage starts {earliest or 'n/a'} (full from next month)")
