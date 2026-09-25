#!/usr/bin/env python3
"""Month-to-date leads received per rep (Pipedrive) -> config/office.repLeads.
A rep "received" a lead if it was added this month and they own it now — open
leads still in the inbox plus ones already converted to working deals.
Usage: leads-update.py <pipedrive-token> <gcloud-access-token>
"""
import sys, json, datetime, urllib.request, collections

PD, TOKEN = sys.argv[1], sys.argv[2]
month_start = datetime.date.today().replace(day=1).isoformat()

# Pipedrive user id -> the exact "Sales Rep" spelling the PBS sheet uses
# (the office board leaderboard keys rows by that spelling).
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

def get(url):
    with urllib.request.urlopen(url) as r:
        return json.load(r)

counts = collections.Counter()

start = 0
while True:  # open leads added this month
    d = get(f"https://api.pipedrive.com/v1/leads?limit=500&start={start}&sort=add_time%20DESC&api_token={PD}")
    rows = d.get("data") or []
    stop = False
    for l in rows:
        if l["add_time"] < month_start: stop = True; break
        counts[l.get("owner_id")] += 1
    pag = d.get("additional_data", {}).get("pagination", {})
    if stop or not pag.get("more_items_in_collection"): break
    start = pag["next_start"]

start = 0
while True:  # deals created this month (converted leads / worked customers)
    d = get(f"https://api.pipedrive.com/v1/deals?limit=500&start={start}&sort=add_time%20DESC&api_token={PD}")
    rows = d.get("data") or []
    stop = False
    for dl in rows:
        if dl["add_time"] < month_start: stop = True; break
        uid = dl.get("user_id")
        if isinstance(uid, dict): uid = uid.get("id")
        counts[uid] += 1
    pag = d.get("additional_data", {}).get("pagination", {})
    if stop or not pag.get("more_items_in_collection"): break
    start = pag["next_start"]

rep_leads = {PD_TO_PBS[u]: n for u, n in counts.items() if u in PD_TO_PBS}

fields = {k: {"integerValue": str(v)} for k, v in rep_leads.items()}
fields["asOf"] = {"stringValue": datetime.date.today().isoformat()}
body = {"fields": {"repLeads": {"mapValue": {"fields": fields}}}}
url = ("https://firestore.googleapis.com/v1/projects/gen-lang-client-0753805028/"
       "databases/vacnortheast1/documents/config/office?updateMask.fieldPaths=repLeads")
req = urllib.request.Request(url, data=json.dumps(body).encode(), method="PATCH",
    headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
with urllib.request.urlopen(req) as r:
    json.load(r)
print("repLeads written:", dict(sorted(rep_leads.items(), key=lambda x: -x[1])))
